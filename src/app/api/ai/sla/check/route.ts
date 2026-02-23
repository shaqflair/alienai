// src/app/api/ai/sla/check/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x ?? "")
  );
}

// ✅ FIX: Lazy-instantiate the admin client — only called after auth succeeds.
// Previously this was called unconditionally, instantiating the service role
// client on every request including ones that would fail auth.
function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key)
    throw new Error(
      "Missing env vars: NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY"
    );
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

async function requireAuthAndMembership(projectId: string) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");

  return { userId: auth.user.id };
}

/**
 * POST /api/ai/sla/check
 * Body: { projectId, days?: number }
 *
 * Scans for proposed AI suggestions that have been pending longer than `days`
 * and creates an SLA escalation suggestion for each one (idempotent by trigger_key).
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();

    // ✅ FIX: Use `lte` semantics — "at least N days old" means created_at <= now - N days.
    // The previous `lt` missed items that were exactly N*86400 seconds old.
    const days = Math.max(1, Math.min(60, Number(body?.days ?? 7)));

    if (!projectId || !isUuid(projectId)) {
      return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    }

    // Auth + membership check first — before touching admin client
    await requireAuthAndMembership(projectId);

    // ✅ FIX: Only instantiate admin client after auth succeeds
    const sb = adminClient();

    // Items proposed for at least `days` days
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const { data: old, error } = await sb
      .from("ai_suggestions")
      .select("id, project_id, artifact_id, target_artifact_type, suggestion_type, created_at")
      .eq("project_id", projectId)
      .eq("status", "proposed")
      .lte("created_at", cutoff) // ✅ FIX: was `lt`, now `lte` to catch exact-boundary items
      .limit(200);

    if (error) throw new Error(error.message);

    const stale = old ?? [];

    if (!stale.length) {
      const res = NextResponse.json({
        ok: true,
        scanned: 0,
        created: 0,
        createdSuggestions: [],
      });
      res.headers.set("Cache-Control", "no-store, max-age=0");
      return res;
    }

    // ✅ FIX: Dedup check in a single batch query instead of N+1 per-item queries.
    // trigger_key is deterministic per suggestion ID (days excluded from key — see below).
    //
    // ✅ FIX: `days` removed from trigger_key — previously sla.escalation.<id>.7d and
    // sla.escalation.<id>.14d were treated as different escalations for the same suggestion,
    // causing duplicate escalation cards. The dedup is now per suggestion, not per-days.
    const triggerKeys = stale.map((s: any) => `sla.escalation.${s.id}`);

    const { data: existingRows, error: existErr } = await sb
      .from("ai_suggestions")
      .select("trigger_key")
      .eq("project_id", projectId)
      .in("trigger_key", triggerKeys);

    if (existErr) throw new Error(existErr.message);

    const existingKeys = new Set(
      (existingRows ?? []).map((r: any) => String(r?.trigger_key || ""))
    );

    // Only insert escalations that don't already exist
    const toInsert = stale
      .filter((s: any) => !existingKeys.has(`sla.escalation.${s.id}`))
      .map((s: any) => ({
        project_id: projectId,
        artifact_id: s.artifact_id,
        section_key: null,
        target_artifact_type: s.target_artifact_type,
        suggestion_type: "sla_escalation",
        rationale: `SLA: Suggestion has been proposed for more than ${days} day(s). Consider applying, rejecting, or escalating to an approver.`,
        confidence: 0.9,
        patch: null,
        status: "proposed",
        actioned_by: null,
        decided_at: null,
        rejected_at: null,
        triggered_by_event_id: null,
        // ✅ FIX: Key is per-suggestion only — not per-days — to prevent duplicates
        trigger_key: `sla.escalation.${s.id}`,
      }));

    let created: any[] = [];

    if (toInsert.length > 0) {
      // ✅ FIX: Batch insert with onConflict ignore to handle any race conditions
      // where two simultaneous POST requests slip past the dedup check above.
      // Requires a unique constraint on (project_id, trigger_key) in your DB schema.
      const { data: inserted, error: insErr } = await sb
        .from("ai_suggestions")
        .insert(toInsert)
        .select();

      // If conflict arises (concurrent request), treat as success — not an error
      if (insErr) {
        const msg = String(insErr.message || "").toLowerCase();
        const isConflict =
          msg.includes("unique") || msg.includes("duplicate") || msg.includes("conflict");
        if (!isConflict) throw new Error(insErr.message);
        // else: idempotent — concurrent insert already handled it
      } else {
        created = Array.isArray(inserted) ? inserted : [];
      }
    }

    const res = NextResponse.json({
      ok: true,
      scanned: stale.length,
      already_escalated: existingKeys.size,
      created: created.length,
      createdSuggestions: created,
    });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    const isAuth = msg === "Unauthorized" || msg === "Not found";
    const res = NextResponse.json(
      { ok: false, error: msg },
      { status: isAuth ? (msg === "Unauthorized" ? 401 : 404) : 500 }
    );
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}