import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function normalizeProjectCode(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) {
    return `P-${m[1].padStart(5, "0")}`;
  }

  return v.toUpperCase();
}

function extractDigitsAsNumber(input: string): number | null {
  const s = normalizeProjectCode(input);
  const m = String(s).match(/(\d{3,})$/);
  if (!m?.[1]) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

async function resolveProjectId(
  supabase: any,
  args: {
    projectIdRaw: string;
    projectCodeRaw: string;
  }
): Promise<string | null> {
  const projectIdRaw = safeStr(args.projectIdRaw).trim();
  const projectCodeRaw = safeStr(args.projectCodeRaw).trim();

  if (projectIdRaw && isUuid(projectIdRaw)) {
    return projectIdRaw;
  }

  const codeCandidate = projectCodeRaw || projectIdRaw;
  if (!codeCandidate) return null;

  const codeNum = extractDigitsAsNumber(codeCandidate);
  if (codeNum != null) {
    const { data, error } = await supabase
      .from("projects")
      .select("id, project_code")
      .eq("project_code", codeNum)
      .maybeSingle();

    if (!error && data?.id) return safeStr(data.id).trim();
    if (error && !isMissingColumnError(error.message, "project_code")) {
      throw error;
    }
  }

  const normalizedCode = normalizeProjectCode(codeCandidate);
  const fallbackCols = ["code", "human_id", "slug", "reference", "ref"] as const;

  for (const col of fallbackCols) {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq(col, normalizedCode)
      .maybeSingle();

    if (!error && data?.id) return safeStr(data.id).trim();
    if (error && !isMissingColumnError(error.message, col)) {
      throw error;
    }
  }

  return null;
}

/**
 * GET /api/approvals/timeline?project_id=...&artifact_id=... OR &change_id=...
 * Also supports:
 * GET /api/approvals/timeline?project_code=P-00012
 * Project-only queries are valid and return the full project approvals timeline.
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);

    const user = auth?.user;
    if (!user) return jsonErr("Unauthorized", 401);

    const url = new URL(req.url);
    const project_id_raw = safeStr(url.searchParams.get("project_id"));
    const project_code_raw = safeStr(url.searchParams.get("project_code"));
    const artifact_id = safeStr(url.searchParams.get("artifact_id")).trim();
    const change_id = safeStr(url.searchParams.get("change_id")).trim();
    const limitRaw = safeStr(url.searchParams.get("limit"));
    const limit = Math.max(10, Math.min(500, Number(limitRaw || 250) || 250));

    const project_id = await resolveProjectId(supabase, {
      projectIdRaw: project_id_raw,
      projectCodeRaw: project_code_raw,
    });

    if (!project_id || !isUuid(project_id)) {
      return jsonErr("Missing or invalid project_id / project_code", 400);
    }

    if (!artifact_id && !change_id && !project_id) {
      return jsonErr("Provide artifact_id, change_id, or project_id", 400);
    }

    if (artifact_id && !isUuid(artifact_id)) {
      return jsonErr("Invalid artifact_id", 400);
    }

    if (change_id && !isUuid(change_id)) {
      return jsonErr("Invalid change_id", 400);
    }

    const memberQuery = supabase
      .from("project_members")
      .select("role")
      .eq("project_id", project_id)
      .eq("user_id", user.id)
      .maybeSingle();

    const { data: member, error: memErr } = await memberQuery;

    if (memErr) return jsonErr(memErr.message, 500);
    if (!member?.role) return jsonErr("Forbidden", 403);

    let q = supabase
      .from("approval_events")
      .select(
        "id, created_at, action_type, actor_user_id, actor_name, actor_role, comment, meta, step_id, artifact_id, change_id"
      )
      .eq("project_id", project_id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (artifact_id) {
      q = q.eq("artifact_id", artifact_id);
    } else if (change_id) {
      q = q.eq("change_id", change_id);
    }

    const { data: events, error: evErr } = await q;
    if (evErr) return jsonErr(evErr.message, 500);

    const rows = (events ?? [])
      .map((e: any) => ({
        id: e.id,
        created_at: e.created_at,
        action_type: safeStr(e.action_type),
        actor_user_id: e.actor_user_id ?? null,
        actor_name: safeStr(e.actor_name) || null,
        actor_role: safeStr(e.actor_role) || null,
        comment: safeStr(e.comment) || null,
        meta: e.meta ?? null,
        step_id: e.step_id ?? null,
        artifact_id: e.artifact_id ?? null,
        change_id: e.change_id ?? null,
      }))
      .reverse();

    return jsonOk({
      events: rows,
      scope: {
        project_id,
        project_code: project_code_raw ? normalizeProjectCode(project_code_raw) : null,
        artifact_id: artifact_id || null,
        change_id: change_id || null,
      },
    });
  } catch (e: any) {
    return jsonErr("Unexpected error", 500, { message: e?.message || String(e) });
  }
}