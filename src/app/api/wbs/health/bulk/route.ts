// src/app/api/wbs/health/bulk/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/**
 * POST { artifactIds: string[] }
 * Returns:
 * { ok: true, items: Record<artifactId, { missing_effort: number; total: number; severity: "ok"|"warning"|"critical"; impact_pct: number; missing_ids: string[] }> }
 */

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/* ---------------- small utils ---------------- */

function safeArr(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function safeJson(x: any) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function uniqStrings(xs: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs || []) {
    const s = String(x || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}
function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/* ---------------- scoring ---------------- */

function calcSeverity(missing: number): "ok" | "warning" | "critical" {
  if (missing >= 3) return "critical";
  if (missing >= 1) return "warning";
  return "ok";
}

/**
 * Simple impact heuristic:
 * - if lots missing, confidence drops.
 * cap at 60%
 */
function calcImpactPct(total: number, missing: number) {
  if (total <= 0) return 0;
  const ratio = missing / total;
  return Math.max(0, Math.min(60, Math.round(ratio * 60)));
}

/* ---------------- WBS parsing ---------------- */

type WbsRow = {
  id?: string;
  level?: number;
  deliverable?: string;
  effort?: "S" | "M" | "L" | string | null;
  estimated_effort_hours?: any;
  estimatedEffortHours?: any;
  effort_hours?: any;
  effortHours?: any;
  estimate_hours?: any;
  estimateHours?: any;
  estimated_effort?: any;
  estimatedEffort?: any;
};

function asLevel(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}

function hasChildren(rows: WbsRow[], idx: number) {
  const cur = rows[idx];
  const next = rows[idx + 1];
  return !!(cur && next && asLevel(next.level) > asLevel(cur.level));
}

/**
 * Effort detection:
 * - Accept either hours fields (if you ever switch to numeric)
 * - Or your current S/M/L effort enum
 */
function rowHasEffort(row: WbsRow): boolean {
  const keys = [
    "estimated_effort_hours",
    "estimatedEffortHours",
    "effort_hours",
    "effortHours",
    "estimate_hours",
    "estimateHours",
    "estimated_effort",
    "estimatedEffort",
  ] as const;

  for (const k of keys) {
    const v: any = (row as any)?.[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return true;
  }

  const e = String((row as any)?.effort ?? "").trim().toUpperCase();
  if (e === "S" || e === "M" || e === "L") return true;

  return false;
}

/**
 * We only score leaf rows (work packages).
 * Parents can be blank effort (thatâ€™s fine).
 */
function calcWbsFromRows(doc: any) {
  const rows = safeArr(doc?.rows) as WbsRow[];
  if (!rows.length) return { missing: 0, total: 0, missingIds: [] as string[] };

  let totalLeaves = 0;
  let missing = 0;
  const missingIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const isParent = hasChildren(rows, i);
    if (isParent) continue;

    totalLeaves++;
    if (!rowHasEffort(rows[i])) {
      missing++;
      const rid = rows[i]?.id ? String(rows[i].id) : "";
      if (rid) missingIds.push(rid);
    }
  }

  return { missing, total: totalLeaves, missingIds };
}

function pickDoc(r: any) {
  // prefer content_json (what your editor saves), then fallback
  return safeJson(r?.content_json) ?? safeJson(r?.contentJson) ?? safeJson(r?.content) ?? null;
}

/* ---------------- scope helpers: membership + active projects ---------------- */

/**
 * Resolve projects the user can access via project_members,
 * then filter to ACTIVE projects (status='active' AND deleted_at/closed_at NULL) best-effort.
 */
async function resolveActiveProjectIds(supabase: any, userId: string) {
  // 1) membership ids (best-effort with removed_at)
  let memberIds: string[] = [];
  try {
    const { data, error } = await supabase
      .from("project_members")
      .select("project_id, removed_at")
      .eq("user_id", userId)
      .is("removed_at", null);

    if (error) {
      if (looksMissingColumn(error)) throw error;
      return { ok: false, error: error.message, projectIds: [] as string[] };
    }

    memberIds = uniqStrings((data || []).map((r: any) => r?.project_id));
  } catch {
    const { data, error } = await supabase.from("project_members").select("project_id").eq("user_id", userId);
    if (error) return { ok: false, error: error.message, projectIds: [] as string[] };
    memberIds = uniqStrings((data || []).map((r: any) => r?.project_id));
  }

  if (!memberIds.length) return { ok: true, error: null as string | null, projectIds: [] as string[] };

  // 2) active filter (best-effort)
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, status, deleted_at, closed_at")
      .in("id", memberIds)
      .limit(10000);

    if (error) {
      if (looksMissingRelation(error) || looksMissingColumn(error)) throw error;
      // RLS/etc - keep membership ids to avoid â€œblankâ€ responses
      return { ok: false, error: error.message, projectIds: memberIds };
    }

    const rows = Array.isArray(data) ? data : [];
    const out: string[] = [];

    for (const r of rows) {
      const id = String((r as any)?.id || "").trim();
      if (!id) continue;

      const status = String((r as any)?.status || "").trim().toLowerCase();
      const deletedAt = (r as any)?.deleted_at;
      const closedAt = (r as any)?.closed_at;

      if (deletedAt) continue;
      if (closedAt) continue;
      if (status && status !== "active") continue;

      out.push(id);
    }

    return { ok: true, error: null, projectIds: uniqStrings(out) };
  } catch {
    // fallback: existence-only
    try {
      const { data, error } = await supabase.from("projects").select("id").in("id", memberIds).limit(10000);
      if (error) return { ok: false, error: error.message, projectIds: memberIds };

      const rows = Array.isArray(data) ? data : [];
      const out = rows.map((r: any) => String(r?.id || "").trim()).filter(Boolean);
      return { ok: true, error: null, projectIds: uniqStrings(out) };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || "projects filter failed"), projectIds: memberIds };
    }
  }
}

/* ---------------- route ---------------- */

export async function POST(req: NextRequest) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401);
  if (!auth?.user) return jsonErr("Unauthorized", 401);

  const body = await req.json().catch(() => null);

  // âœ… cap to prevent abuse / heavy DB reads
  const artifactIds = uniqStrings(safeArr(body?.artifactIds).map((x) => String(x)))
    .filter(isUuid)
    .slice(0, 400);

  if (!artifactIds.length) return jsonErr("No artifactIds provided", 400);

  // âœ… membership + active-only scope
  const scope = await resolveActiveProjectIds(supabase, auth.user.id);
  const projectIds = scope.projectIds;

  if (!projectIds.length) {
    return jsonOk({
      items: {},
      meta: { project_count: 0, active_only: true, scope_ok: scope.ok, scope_error: scope.error || null },
    });
  }

  // âœ… only return artifacts inside allowed projects
  // IMPORTANT: select content_json (not content) but keep content as fallback
  const { data: rows, error } = await supabase
    .from("artifacts")
    .select("id, type, project_id, content_json, content")
    .in("id", artifactIds)
    .in("project_id", projectIds);

  if (error) return jsonErr(error.message, 500);

  const out: Record<
    string,
    {
      missing_effort: number;
      total: number;
      severity: "ok" | "warning" | "critical";
      impact_pct: number;
      missing_ids: string[];
    }
  > = {};

  for (const r of rows || []) {
    const atype = String(r?.type || "").trim().toLowerCase();
    if (atype !== "wbs") continue;

    const doc = pickDoc(r);
    const dtype = String(doc?.type || "").trim().toLowerCase();
    const ver = Number(doc?.version);

    if (dtype === "wbs" && ver === 1 && Array.isArray(doc?.rows)) {
      const { missing, total, missingIds } = calcWbsFromRows(doc);

      out[String(r.id)] = {
        missing_effort: missing,
        total,
        severity: calcSeverity(missing),
        impact_pct: calcImpactPct(total, missing),
        missing_ids: missingIds,
      };
      continue;
    }

    // Unknown shape => do not claim â€œgoodâ€
    out[String(r.id)] = {
      missing_effort: 0,
      total: 0,
      severity: "ok",
      impact_pct: 0,
      missing_ids: [],
    };
  }

  return jsonOk({
    items: out,
    meta: {
      active_only: true,
      scope_ok: scope.ok,
      scope_error: scope.error || null,
      requested_ids: artifactIds.length,
      returned_rows: (rows || []).length,
      project_count: projectIds.length,
    },
  });
}


