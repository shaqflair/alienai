// src/app/api/suggestions/[id]/reject/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- utils ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}
function canEditRole(role: string) {
  const r = safeLower(role);
  return r === "owner" || r === "admin" || r === "editor";
}

async function safeJson(req: Request) {
  return await req.json().catch(() => ({}));
}

/**
 * Next.js route ctx.params is usually: { params: { id: string } }
 * Some of your code uses Promise-wrapped params. Support both safely.
 */
async function readParamId(ctx: any): Promise<string> {
  try {
    const p = ctx?.params;
    if (!p) return "";
    if (typeof p.then === "function") {
      const resolved = await p;
      return safeStr(resolved?.id).trim();
    }
    return safeStr(p?.id).trim();
  } catch {
    return "";
  }
}

async function requireAuth(supabase: any) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function requireProjectMembership(supabase: any, projectId: string, userId: string) {
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) return null;

  const role = safeLower((mem as any).role ?? "viewer");
  return { role, canEdit: canEditRole(role) };
}

/* =========================================================
   POST /api/suggestions/:id/reject
   Body: { projectId: uuid, reason?: string }
   ========================================================= */

export async function POST(req: Request, ctx: any) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const id = await readParamId(ctx);
    if (!id) return NextResponse.json({ ok: false, error: "Missing suggestion id" }, { status: 400 });

    const body = await safeJson(req);
    const projectId = safeStr(body?.projectId).trim();
    const reason = safeStr(body?.reason ?? body?.note ?? "").trim();

    if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });

    // Membership gate (editor/owner/admin)
    const mem = await requireProjectMembership(supabase, projectId, user.id);
    if (!mem) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!mem.canEdit) return NextResponse.json({ ok: false, error: "Requires editor/owner" }, { status: 403 });

    // Fetch suggestion (RLS)
    const { data: existing, error: getErr } = await supabase
      .from("ai_suggestions")
      .select("id, project_id, status, artifact_id, target_artifact_type, suggestion_type, section_key")
      .eq("id", id)
      .eq("project_id", projectId)
      .maybeSingle();

    if (getErr) return NextResponse.json({ ok: false, error: getErr.message }, { status: 500 });
    if (!existing) return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });

    const currStatus = safeLower((existing as any).status);

    // Idempotent: if already terminal, return ok
    if (currStatus !== "proposed" && currStatus !== "suggested") {
      return NextResponse.json({
        ok: true,
        suggestion: { id: (existing as any).id, status: (existing as any).status },
        note: `No change (already ${safeStr((existing as any).status)})`,
      });
    }

    const nowIso = new Date().toISOString();

    // Update to rejected (fits your table constraints)
    const { data: updated, error: updErr } = await supabase
      .from("ai_suggestions")
      .update({
        status: "rejected",
        decided_at: nowIso,
        rejected_at: nowIso,
        actioned_by: user.id,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id,status,decided_at,rejected_at,actioned_by")
      .maybeSingle();

    if (updErr) return NextResponse.json({ ok: false, error: updErr.message }, { status: 500 });
    if (!updated) return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });

    // Best-effort event log (don’t fail if RLS blocks project_events)
    try {
      await supabase.from("project_events").insert({
        project_id: projectId,
        artifact_id: (existing as any).artifact_id ?? null,
        section_key: (existing as any).section_key ?? null,
        event_type: "suggestion_rejected",
        actor_user_id: user.id,
        severity: "info",
        source: "app",
        payload: {
          suggestion_id: id,
          reason: reason || null,
          target_artifact_type: (existing as any).target_artifact_type ?? null,
          suggestion_type: (existing as any).suggestion_type ?? null,
        },
      });
    } catch {
      // ignore
    }

    return NextResponse.json({ ok: true, suggestion: updated });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}