// src/app/api/portfolio/health/route.ts — v14
// Adds perProject scores to response so HomePage can show live per-project health
// instead of reading stale AI-generated RAG rows from project_health table.

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { computePortfolioHealth } from "@/lib/server/project-health";

export const runtime = "nodejs";

/* ─── response helpers ─── */

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

/* ─── utils ─── */

function clampDaysParam(v: any): 7 | 14 | 30 | 60 | "all" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as 7 | 14 | 30 | 60) : 30;
}

function normalizeWindowDays(daysParam: 7 | 14 | 30 | 60 | "all"): 7 | 14 | 30 | 60 {
  return daysParam === "all" ? 60 : daysParam;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqStrings(xs: any): string[] {
  const arr = Array.isArray(xs) ? xs : xs == null ? [] : [xs];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v =
      safeStr(pc.project_code) || safeStr(pc.code) ||
      safeStr(pc.value) || safeStr(pc.id);
    return v.trim();
  }
  return "";
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/* ─── active project resolver ─── */

const CLOSED_STATUSES = new Set([
  "closed", "cancelled", "canceled", "archived",
  "completed", "done", "inactive",
]);

async function resolveActiveProjectIds(
  supabase: any,
  candidateIds: string[],
  orgId: string | null,
  notes: string[],
): Promise<string[]> {
  if (!candidateIds.length) return [];

  let q = supabase
    .from("projects")
    .select("id, status, deleted_at")
    .in("id", candidateIds)
    .is("deleted_at", null)
    .limit(20000);

  if (orgId) q = q.eq("organisation_id", orgId);

  const { data, error } = await q;

  if (error) {
    notes.push(`DB active-filter failed (${error.message}). Trying helper.`);
    try {
      const maybeActive = await filterActiveProjectIds(supabase, candidateIds);
      const helperIds: string[] = Array.isArray(maybeActive)
        ? maybeActive
        : (maybeActive as any)?.projectIds ?? (maybeActive as any)?.ids ?? [];
      if (helperIds.length) {
        notes.push(`Helper returned ${helperIds.length} active IDs.`);
        return helperIds;
      }
    } catch (e2: any) {
      notes.push(`Helper also failed: ${String(e2?.message || e2)}.`);
    }
    notes.push("Both active-filters failed — returning candidates unfiltered.");
    return candidateIds;
  }

  const rows = Array.isArray(data) ? data : [];
  const activeIds = rows
    .filter((p: any) => !CLOSED_STATUSES.has(String(p?.status ?? "active").toLowerCase().trim()))
    .map((p: any) => String(p.id));

  const excludedCount = candidateIds.length - activeIds.length;
  if (excludedCount > 0) {
    notes.push(`Excluded ${excludedCount} project(s) — closed/archived/deleted.`);
  }
  if (activeIds.length === 0 && candidateIds.length > 0) {
    notes.push("All scoped projects are closed or archived.");
  }

  return activeIds;
}

/* ─── filters ─── */

type PortfolioFilters = {
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

function parseFiltersFromUrl(url: URL): PortfolioFilters {
  const name = uniqStrings(url.searchParams.getAll("name").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const code = uniqStrings(url.searchParams.getAll("code").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const pm   = uniqStrings(url.searchParams.getAll("pm").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const dept = uniqStrings(url.searchParams.getAll("dept").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const out: PortfolioFilters = {};
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length)   out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}

function parseFiltersFromBody(body: any): PortfolioFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioFilters = {};
  const names = uniqStrings(f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name);
  const codes = uniqStrings(f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code);
  const pms   = uniqStrings(f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id);
  const depts = uniqStrings(f?.department ?? f?.departments ?? f?.dept);
  if (names.length) out.projectName = names;
  if (codes.length) out.projectCode = codes;
  if (pms.length)   out.projectManagerId = pms;
  if (depts.length) out.department = depts;
  return out;
}

function hasAnyFilters(f: PortfolioFilters) {
  return (
    (f.projectName && f.projectName.length) ||
    (f.projectCode && f.projectCode.length) ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department && f.department.length)
  );
}

async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) return { projectIds: [], meta: { ...meta, applied: true } };
  if (!hasAnyFilters(filters)) return { projectIds: scopedProjectIds, meta };

  const selectSets = [
    "id, title, project_code, project_manager_id, department",
    "id, title, project_code, project_manager_id",
    "id, title, project_code, department",
    "id, title, project_code",
  ];

  let rows: any[] = [];
  let lastErr: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase
      .from("projects").select(sel).in("id", scopedProjectIds).limit(20000);
    if (!error && Array.isArray(data)) { rows = data; lastErr = null; break; }
    lastErr = error;
    if (!(looksMissingRelation(error) || looksMissingColumn(error))) break;
  }

  if (!rows.length) {
    meta.applied = true;
    meta.notes.push("Could not read projects for filtering; falling back to unfiltered scope.");
    if (lastErr?.message) meta.notes.push(lastErr.message);
    return { projectIds: scopedProjectIds, meta };
  }

  const nameNeedles = (filters.projectName ?? []).map((s) => s.toLowerCase());
  const codeNeedles = (filters.projectCode ?? []).map((s) => s.toLowerCase());
  const pmSet = new Set((filters.projectManagerId ?? []).map((s) => s));
  const deptNeedles = (filters.department ?? []).map((s) => s.toLowerCase());

  const filtered = rows.filter((p) => {
    const title = safeStr(p?.title).toLowerCase();
    const code  = projectCodeLabel(p?.project_code).toLowerCase();
    if (nameNeedles.length && !nameNeedles.some((n) => title.includes(n))) return false;
    if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c)))  return false;
    if (pmSet.size) {
      const pm = safeStr(p?.project_manager_id).trim();
      if (!pm || !pmSet.has(pm)) return false;
    }
    if (deptNeedles.length) {
      const dept = safeStr(p?.department).toLowerCase().trim();
      if (!dept || !deptNeedles.some((d) => dept.includes(d))) return false;
    }
    return true;
  });

  const outIds = filtered.map((p) => String(p?.id || "").trim()).filter(Boolean);
  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };
  return { projectIds: outIds, meta };
}

/* ─── score → rag helper ─── */

function scoreToRag(score: number | null): "G" | "A" | "R" | null {
  if (score == null) return null;
  if (score >= 85) return "G";
  if (score >= 70) return "A";
  return "R";
}

/* ─── handler ─── */

async function handle(req: Request, method: "GET" | "POST") {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user?.id) {
      return jsonErr("Not authenticated", 401, { authErr: authErr?.message });
    }

    const url = new URL(req.url);
    const daysParam = clampDaysParam(url.searchParams.get("days"));
    const windowDays = normalizeWindowDays(daysParam);

    let filters: PortfolioFilters = {};
    if (method === "GET") {
      filters = parseFiltersFromUrl(url);
    } else {
      let body: any = null;
      try { body = await req.json(); } catch {}
      filters = parseFiltersFromBody(body);
    }

    const scope = await resolvePortfolioScope(supabase, auth.user.id);
    const scopeMeta = scope.meta ?? {};
    const orgId = scope.organisationId ?? null;
    const scopedIdsRaw = uniqStrings(
      Array.isArray(scope.rawProjectIds)
        ? scope.rawProjectIds
        : Array.isArray(scope.projectIds)
          ? scope.projectIds
          : [],
    );

    const emptyResponse = {
      score: null,
      portfolio_health: 0,
      projectCount: 0,
      parts: { schedule: null, raid: null, budget: null, governance: null },
      // Empty per-project scores
      projectScores: {} as Record<string, { score: number; rag: "G" | "A" | "R" }>,
      drivers: [],
    };

    if (!orgId) {
      return jsonOk({
        ...emptyResponse,
        meta: { organisationId: null, days: daysParam, windowDays, notes: ["No active organisation resolved."] },
      });
    }

    const activeNotes: string[] = [];
    const activeIds = await resolveActiveProjectIds(supabase, scopedIdsRaw, orgId, activeNotes);

    const filtered = await applyProjectFilters(supabase, activeIds, filters);
    const finalProjectIds = filtered.projectIds;

    if (!finalProjectIds.length) {
      return jsonOk({
        ...emptyResponse,
        meta: {
          organisationId: orgId, days: daysParam, windowDays,
          activeFilter: { rawCount: scopedIdsRaw.length, activeCount: activeIds.length, finalCount: 0, notes: activeNotes },
          filters: filtered.meta,
          scope: { ...scopeMeta, scopedIdsRaw, scopedIdsActive: activeIds },
          notes: ["No active projects in scope after filtering."],
        },
      });
    }

    const health = await computePortfolioHealth(supabase, finalProjectIds, windowDays);
    const scoreValue = health.score ?? 0;

    // Build per-project score map for the HomePage to consume.
    // Shape: { [projectId]: { score: number, rag: "G"|"A"|"R" } }
    const projectScores: Record<string, { score: number; rag: "G" | "A" | "R" }> = {};
    for (const [pid, result] of Object.entries(health.perProject)) {
      if (result.score == null) continue;
      const rag = scoreToRag(result.score);
      if (!rag) continue;
      projectScores[pid] = { score: result.score, rag };
    }

    return jsonOk({
      // New field name
      score: health.score,
      // Legacy alias
      portfolio_health: scoreValue,
      projectCount: health.projectCount,
      parts: {
        schedule:   health.parts.schedule,
        raid:       health.parts.raid,
        budget:     health.parts.budget,
        governance: health.parts.governance,
        // Legacy aliases
        flow:      health.parts.budget,
        approvals: health.parts.governance,
        activity:  null,
      },
      // Per-project live scores — used by HomePage to replace stale RAG rows
      projectScores,
      drivers: [],
      meta: {
        organisationId: orgId,
        days: daysParam,
        windowDays,
        activeFilter: {
          rawCount: scopedIdsRaw.length,
          activeCount: activeIds.length,
          finalCount: finalProjectIds.length,
          notes: activeNotes,
        },
        filters: filtered.meta,
        scope: {
          ...scopeMeta,
          scopedIdsRaw,
          scopedIdsActive: activeIds,
          source: scopeMeta?.source ?? "unknown",
        },
        notes: [],
      },
    });
  } catch (e: any) {
    return jsonErr("Portfolio health route failed", 500, {
      detail: String(e?.message || e),
      stack: process.env.NODE_ENV === "development" ? String(e?.stack || "") : undefined,
    });
  }
}

export async function GET(req: Request) { return handle(req, "GET"); }
export async function POST(req: Request) { return handle(req, "POST"); }