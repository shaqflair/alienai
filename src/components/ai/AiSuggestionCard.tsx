// src/app/api/ai-suggestions/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

type MemberRole = "viewer" | "editor" | "admin" | "owner";
function normalizeRole(role: unknown): MemberRole {
  const r = String(role ?? "viewer").toLowerCase();
  if (r === "owner" || r === "admin" || r === "editor" || r === "viewer") return r;
  return "viewer";
}
function canAct(role: MemberRole) {
  return role === "owner" || role === "admin" || role === "editor";
}

function sigOf(s: any) {
  const t = String(s?.target_artifact_type ?? "");
  const st = String(s?.suggestion_type ?? "");
  const r = String(s?.rationale ?? "");
  // keep stable + short
  return `${t}||${st}||${r}`.slice(0, 800);
}

/**
 * We want UI to use "suggested". Your DB historically used "proposed".
 * Treat "suggested" as ("suggested" OR "proposed") unless you already migrated.
 */
function expandStatusForQuery(values: string[]) {
  const out = new Set(values.map((v) => String(v ?? "").toLowerCase()).filter(Boolean));
  if (out.has("suggested")) out.add("proposed");
  return Array.from(out);
}

function parseStatusParam(raw: string): { mode: "all" | "single" | "multi"; values: string[] } {
  const s = safeStr(raw).trim().toLowerCase();

  // default: show suggested to match UI expectations
  if (!s) return { mode: "single", values: ["suggested"] };

  if (s === "all" || s === "*" || s === "any") return { mode: "all", values: [] };

  const parts = s
    .split(",")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  if (parts.length <= 1) return { mode: "single", values: [parts[0] ?? "suggested"] };
  return { mode: "multi", values: parts };
}

async function requireAuthAndRole(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) return { user: null as any, role: null as any };

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) return { user: auth.user, role: null as any };

  return { user: auth.user, role: normalizeRole((mem as any).role) };
}

export async function GET(req: Request) {
  const supabase = await createClient();

  const url = new URL(req.url);
  const projectId = safeStr(url.searchParams.get("projectId"));
  const targetType = safeStr(url.searchParams.get("targetArtifactType")); // optional
  const statusRaw = safeStr(url.searchParams.get("status")); // suggested | accepted | dismissed | all | suggested,accepted
  const limit = Math.max(1, Math.min(100, Number(url.searchParams.get("limit") ?? 50)));

  if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
  if (!isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });

  // auth + membership (read)
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { role } = await requireAuthAndRole(supabase, projectId);
  if (!role) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const parsed = parseStatusParam(statusRaw);

  let q = supabase
    .from("ai_suggestions")
    .select(
      "id, project_id, source_event_id, target_artifact_id, target_artifact_type, suggestion_type, patch, rationale, confidence, status, created_at, decided_at, rejected_at, updated_at, actioned_by"
    )
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (targetType) q = q.eq("target_artifact_type", targetType);

  if (parsed.mode === "single") {
    const expanded = expandStatusForQuery([parsed.values[0]]);
    if (expanded.length === 1) q = q.eq("status", expanded[0]);
    else q = q.in("status", expanded);
  } else if (parsed.mode === "multi") {
    const expanded = expandStatusForQuery(parsed.values);
    q = q.in("status", expanded);
  } // "all" => no status filter

  const { data, error } = await q;
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  // de-dupe newest first (already sorted DESC)
  const seen = new Set<string>();
  const deduped: any[] = [];
  for (const s of data ?? []) {
    const key = sigOf(s);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(s);
  }

  return NextResponse.json({ ok: true, suggestions: deduped }, { status: 200 });
}

/**
 * POST /api/ai-suggestions
 * Body: { projectId, id, status: "accepted"|"dismissed" }
 *
 * Uses your schema:
 * - decided_at for accepted
 * - rejected_at for dismissed
 * - updated_at + actioned_by (if columns exist; you said you added them)
 */
export async function POST(req: Request) {
  const supabase = await createClient();

  try {
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const id = safeStr(body?.id).trim();
    const nextStatus = safeStr(body?.status).trim().toLowerCase();

    if (!projectId || !isUuid(projectId)) {
      return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
    }
    if (!id || !isUuid(id)) {
      return NextResponse.json({ ok: false, error: "Invalid id" }, { status: 400 });
    }
    if (!(nextStatus === "accepted" || nextStatus === "dismissed")) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    const { user, role } = await requireAuthAndRole(supabase, projectId);
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    if (!role) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    if (!canAct(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const now = new Date().toISOString();

    const update: any = {
      status: nextStatus,
      updated_at: now,
      actioned_by: user.id,
    };

    if (nextStatus === "accepted") {
      update.decided_at = now;
      update.rejected_at = null;
    } else {
      update.rejected_at = now;
      update.decided_at = null;
    }

    const { data, error } = await supabase
      .from("ai_suggestions")
      .update(update)
      .eq("id", id)
      .eq("project_id", projectId)
      .select("id, status, decided_at, rejected_at, updated_at, actioned_by")
      .maybeSingle();

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    if (!data) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    return NextResponse.json({ ok: true, suggestion: data }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}
