// src/app/api/wbs/health/bulk/route.ts
// ✅ Org-scoped: all org members can health-check artifacts across their org's active projects.
//    Uses shared resolveOrgActiveProjectScope + filterActiveProjectIds (no more inline scope resolution).
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/**
 * POST { artifactIds: string[] }
 * Returns:
 * { ok: true, items: Record<artifactId, { missing_effort: number; total: number; severity: "ok"|"warning"|"critical"; impact_pct: number; missing_ids: string[] }> }
 */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function safeArr(x: any): any[] { return Array.isArray(x) ? x : []; }

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x || "").trim());
}

function safeJson(x: any) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try { return JSON.parse(String(x)); } catch { return null; }
}

function uniqStrings(xs: any[]): string[] {
  const seen = new Set<string>(); const out: string[] = [];
  for (const x of xs || []) {
    const s = String(x || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s); out.push(s);
  }
  return out;
}

function calcSeverity(missing: number): "ok" | "warning" | "critical" {
  if (missing >= 3) return "critical";
  if (missing >= 1) return "warning";
  return "ok";
}

function calcImpactPct(total: number, missing: number) {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(60, Math.round((missing / total) * 60)));
}

type WbsRow = {
  id?: string; level?: number;
  effort?: string | null;
  estimated_effort_hours?: any; estimatedEffortHours?: any;
  effort_hours?: any; effortHours?: any;
  estimate_hours?: any; estimateHours?: any;
  estimated_effort?: any; estimatedEffort?: any;
};

function asLevel(x: any) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function hasChildren(rows: WbsRow[], idx: number) {
  return !!(rows[idx] && rows[idx+1] && asLevel(rows[idx+1].level) > asLevel(rows[idx].level));
}
function rowHasEffort(row: WbsRow): boolean {
  const keys = ["estimated_effort_hours","estimatedEffortHours","effort_hours","effortHours",
    "estimate_hours","estimateHours","estimated_effort","estimatedEffort"] as const;
  for (const k of keys) {
    const v: any = (row as any)?.[k];
    if (v == null || v === "") continue;
    const n = Number(v); if (Number.isFinite(n) && n > 0) return true;
  }
  const e = String((row as any)?.effort ?? "").trim().toUpperCase();
  return e === "S" || e === "M" || e === "L";
}

function calcWbsFromRows(doc: any) {
  const rows = safeArr(doc?.rows) as WbsRow[];
  if (!rows.length) return { missing: 0, total: 0, missingIds: [] as string[] };

  let total = 0, missing = 0; const missingIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (hasChildren(rows, i)) continue;
    total++;
    if (!rowHasEffort(rows[i])) {
      missing++;
      const rid = rows[i]?.id ? String(rows[i].id) : "";
      if (rid) missingIds.push(rid);
    }
  }

  return { missing, total, missingIds };
}

function pickDoc(r: any) {
  return safeJson(r?.content_json) ?? safeJson(r?.contentJson) ?? safeJson(r?.content) ?? null;
}

export async function POST(req: Request) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401);
  if (!auth?.user) return jsonErr("Unauthorized", 401);

  const body = await req.json().catch(() => null);

  const artifactIds = uniqStrings(safeArr(body?.artifactIds).map((x) => String(x)))
    .filter(isUuid)
    .slice(0, 400);

  if (!artifactIds.length) return jsonErr("No artifactIds provided", 400);

  // ✅ Org-wide scope — replaces inline member-only resolveActiveProjectIds
  const scoped = await resolveOrgActiveProjectScope(supabase, auth.user.id);
  const scopedIds = Array.isArray(scoped?.projectIds) ? scoped.projectIds : [];

  const filtered = await filterActiveProjectIds(supabase, scopedIds);
  const projectIds = Array.isArray(filtered?.projectIds) ? filtered.projectIds : [];

  if (!projectIds.length) {
    return jsonOk({
      items: {},
      meta: {
        projectCount: 0, scope: "org", active_only: true,
        scopeOk: true, scopeError: null,
        filterOk: filtered?.ok ?? true, filterError: filtered?.error ?? null,
        before: scopedIds.length, after: 0,
      },
    });
  }

  // ✅ Only return artifacts inside allowed org projects
  const { data: rows, error } = await supabase
    .from("artifacts")
    .select("id, type, project_id, content_json, content")
    .in("id", artifactIds)
    .in("project_id", projectIds);

  if (error) return jsonErr(error.message, 500);

  const out: Record<string, {
    missing_effort: number; total: number;
    severity: "ok" | "warning" | "critical";
    impact_pct: number; missing_ids: string[];
  }> = {};

  for (const r of rows || []) {
    if (String(r?.type || "").trim().toLowerCase() !== "wbs") continue;

    const doc = pickDoc(r);
    const dtype = String(doc?.type || "").trim().toLowerCase();
    const ver = Number(doc?.version);

    if (dtype === "wbs" && ver === 1 && Array.isArray(doc?.rows)) {
      const { missing, total, missingIds } = calcWbsFromRows(doc);
      out[String(r.id)] = {
        missing_effort: missing, total,
        severity: calcSeverity(missing),
        impact_pct: calcImpactPct(total, missing),
        missing_ids: missingIds,
      };
    } else {
      // Unknown doc shape — emit zero rather than missing key
      out[String(r.id)] = { missing_effort: 0, total: 0, severity: "ok", impact_pct: 0, missing_ids: [] };
    }
  }

  return jsonOk({
    items: out,
    meta: {
      scope: "org", active_only: true,
      scopeOk: true, scopeError: null,
      filterOk: filtered?.ok ?? true, filterError: filtered?.error ?? null,
      requestedIds: artifactIds.length,
      returnedRows: (rows || []).length,
      projectCount: projectIds.length,
      before: scopedIds.length, after: projectIds.length,
    },
  });
}