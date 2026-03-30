import "server-only";

import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export type PortfolioMilestonesFilters = {
  projectId?: string[];
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

export type PortfolioMilestonesDuePayload = {
  ok: true;
  days: 7 | 14 | 30 | 60;
  count: number;
  meta: {
    organisationId: string | null;
    scope: any;
    filters: any;
    projectCount?: number;
  };
};

function clampDays(x: string | null | undefined, fallback = 30): 7 | 14 | 30 | 60 {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n)
    ? (n as 7 | 14 | 30 | 60)
    : (fallback as 7 | 14 | 30 | 60);
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
      safeStr(pc.project_code) ||
      safeStr(pc.code) ||
      safeStr(pc.value) ||
      safeStr(pc.id);
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

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function hasAnyFilters(f: PortfolioMilestonesFilters) {
  return Boolean(
    (f.projectId && f.projectId.length) ||
      (f.projectName && f.projectName.length) ||
      (f.projectCode && f.projectCode.length) ||
      (f.projectManagerId && f.projectManagerId.length) ||
      (f.department && f.department.length),
  );
}

export function parseMilestonesDueFiltersFromUrl(url: URL): PortfolioMilestonesFilters {
  const ids = uniqStrings(
    url.searchParams.getAll("projectId").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );
  const name = uniqStrings(
    url.searchParams.getAll("name").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );
  const code = uniqStrings(
    url.searchParams.getAll("code").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );
  const pm = uniqStrings(
    url.searchParams.getAll("pm").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );
  const dept = uniqStrings(
    url.searchParams.getAll("dept").flatMap((x) => x.split(",")).map((s) => s.trim()),
  );

  const out: PortfolioMilestonesFilters = {};
  if (ids.length) out.projectId = ids;
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}

export function parseMilestonesDueFiltersFromBody(body: any): PortfolioMilestonesFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioMilestonesFilters = {};

  const ids = uniqStrings(f?.projectId ?? f?.projectIds ?? f?.id);
  const names = uniqStrings(
    f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name,
  );
  const codes = uniqStrings(
    f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code,
  );
  const pms = uniqStrings(
    f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id,
  );
  const depts = uniqStrings(
    f?.department ?? f?.departments ?? f?.dept,
  );

  if (ids.length) out.projectId = ids;
  if (names.length) out.projectName = names;
  if (codes.length) out.projectCode = codes;
  if (pms.length) out.projectManagerId = pms;
  if (depts.length) out.department = depts;
  return out;
}

async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioMilestonesFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) return { projectIds: [], meta: { ...meta, applied: true } };
  if (!hasAnyFilters(filters)) return { projectIds: scopedProjectIds, meta };

  let workingIds = scopedProjectIds;

  if (filters.projectId?.length) {
    const wanted = new Set(filters.projectId.map((v) => safeStr(v).trim()).filter(Boolean));
    workingIds = scopedProjectIds.filter((id) => wanted.has(String(id)));
    meta.notes.push(`Applied explicit projectId scope (${workingIds.length}).`);
    if (
      !filters.projectName?.length &&
      !filters.projectCode?.length &&
      !filters.projectManagerId?.length &&
      !filters.department?.length
    ) {
      meta.applied = true;
      meta.counts = { before: scopedProjectIds.length, after: workingIds.length };
      return { projectIds: workingIds, meta };
    }
  }

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
      .from("projects")
      .select(sel)
      .in("id", workingIds)
      .limit(10000);

    if (!error && Array.isArray(data)) {
      rows = data;
      lastErr = null;
      break;
    }
    lastErr = error;
    if (!(looksMissingRelation(error) || looksMissingColumn(error))) break;
  }

  if (!rows.length) {
    meta.applied = true;
    meta.notes.push("Could not read projects for filtering; falling back to current scope.");
    if (lastErr?.message) meta.notes.push(lastErr.message);
    return { projectIds: workingIds, meta };
  }

  const nameNeedles = (filters.projectName ?? []).map((s) => s.toLowerCase());
  const codeNeedles = (filters.projectCode ?? []).map((s) => s.toLowerCase());
  const pmSet = new Set((filters.projectManagerId ?? []).map((s) => s));
  const deptNeedles = (filters.department ?? []).map((s) => s.toLowerCase());

  const filtered = rows.filter((p) => {
    const title = safeStr(p?.title).toLowerCase();
    const code = projectCodeLabel(p?.project_code).toLowerCase();

    if (nameNeedles.length && !nameNeedles.some((n) => title.includes(n))) return false;
    if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c))) return false;

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

async function normalizeActiveIds(supabase: any, visibleProjectIds: string[]) {
  const failOpen = (reason: string) => ({
    ids: visibleProjectIds,
    ok: false,
    error: reason,
  });

  if (!visibleProjectIds.length) {
    return { ids: [], ok: true, error: null as string | null };
  }

  try {
    const r: any = await filterActiveProjectIds(supabase, visibleProjectIds);

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && visibleProjectIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && visibleProjectIds.length) {
      return failOpen("active filter returned 0 ids; failing open");
    }

    return {
      ids,
      ok: !r?.error,
      error: r?.error ? safeStr(r.error?.message || r.error) : null,
    };
  } catch (e: any) {
    return failOpen(safeStr(e?.message || e || "active filter failed"));
  }
}

async function computeCount(
  supabase: any,
  projectIds: string[],
  days: 7 | 14 | 30 | 60,
) {
  const { data, error } = await supabase.rpc("get_schedule_milestones_kpis_portfolio", {
    p_project_ids: projectIds,
    p_window_days: days,
  });

  if (error) return { ok: false as const, error };

  const row = Array.isArray(data) ? data[0] : data;
  const planned = num(row?.planned);
  const atRisk = num(row?.at_risk);
  const overdue = num(row?.overdue);
  const count = planned + atRisk + overdue;

  return { ok: true as const, row, count };
}

export async function loadMilestonesDue(input: {
  userId: string;
  days?: unknown;
  filters?: PortfolioMilestonesFilters;
  supabase?: Awaited<ReturnType<typeof createClient>>;
}): Promise<PortfolioMilestonesDuePayload> {
  const supabase = input.supabase ?? (await createClient());
  const days = clampDays(
    input.days == null ? null : String(input.days),
    30,
  );
  const filters = input.filters ?? {};

  const scope = await resolvePortfolioScope(supabase, input.userId);
  const scopeMeta = scope.meta ?? {};
  const organisationId = scope.organisationId ?? null;

  const explicitProjectIds = uniqStrings(filters.projectId);

  // Canonical visible scope should always prefer scope.projectIds.
  const visibleProjectIdsFromScope = explicitProjectIds.length
    ? explicitProjectIds
    : uniqStrings(Array.isArray(scope.projectIds) ? scope.projectIds : []);

  const rawProjectIds = uniqStrings(
    Array.isArray(scope.rawProjectIds) ? scope.rawProjectIds : [],
  );

  const filteredVisible = await applyProjectFilters(
    supabase,
    visibleProjectIdsFromScope,
    filters,
  );
  const filteredVisibleProjectIds = uniqStrings(filteredVisible.projectIds);

  const active = await normalizeActiveIds(supabase, filteredVisibleProjectIds);
  const filteredActiveProjectIds = uniqStrings(active.ids);

  const completeness: "full" | "partial" | "empty" =
    filteredVisibleProjectIds.length === 0
      ? "empty"
      : filteredActiveProjectIds.length === filteredVisibleProjectIds.length
        ? "full"
        : "partial";

  if (!filteredVisibleProjectIds.length) {
    return {
      ok: true,
      days,
      count: 0,
      meta: {
        organisationId,
        scope: {
          ...scopeMeta,
          rawProjectCount: rawProjectIds.length,
          visibleProjectCount: visibleProjectIdsFromScope.length,
          activeProjectCount: 0,
          filteredVisibleProjectCount: 0,
          filteredActiveProjectCount: 0,
          explicitProjectIds,
          source: explicitProjectIds.length
            ? "explicit-project-filter"
            : (scopeMeta?.source ?? "unknown"),
          completeness,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
        filters: filteredVisible.meta,
        projectCount: 0,
      },
    };
  }

  if (!filteredActiveProjectIds.length) {
    return {
      ok: true,
      days,
      count: 0,
      meta: {
        organisationId,
        scope: {
          ...scopeMeta,
          rawProjectCount: rawProjectIds.length,
          visibleProjectCount: visibleProjectIdsFromScope.length,
          activeProjectCount: filteredActiveProjectIds.length,
          filteredVisibleProjectCount: filteredVisibleProjectIds.length,
          filteredActiveProjectCount: 0,
          explicitProjectIds,
          source: explicitProjectIds.length
            ? "explicit-project-filter"
            : (scopeMeta?.source ?? "unknown"),
          completeness,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
        filters: {
          ...filteredVisible.meta,
          notes: [
            ...((filteredVisible.meta?.notes as string[]) ?? []),
            "Projects are visible in scope, but none qualify for active milestone counting.",
          ],
        },
        projectCount: filteredVisibleProjectIds.length,
      },
    };
  }

  const r = await computeCount(supabase, filteredActiveProjectIds, days);
  if (!r.ok) {
    throw new Error(r.error?.message || "RPC failed");
  }

  return {
    ok: true,
    days,
    count: r.count,
    meta: {
      organisationId,
      scope: {
        ...scopeMeta,
        rawProjectCount: rawProjectIds.length,
        visibleProjectCount: visibleProjectIdsFromScope.length,
        activeProjectCount: filteredActiveProjectIds.length,
        filteredVisibleProjectCount: filteredVisibleProjectIds.length,
        filteredActiveProjectCount: filteredActiveProjectIds.length,
        explicitProjectIds,
        source: explicitProjectIds.length
          ? "explicit-project-filter"
          : (scopeMeta?.source ?? "unknown"),
        completeness,
        active_filter_ok: active.ok,
        active_filter_error: active.error,
      },
      filters: filteredVisible.meta,
      projectCount: filteredActiveProjectIds.length,
    },
  };
}
// ✅ loadScheduleIntelligence — rich schedule payload for dashboard
export async function loadScheduleIntelligence(input: {
  userId: string;
  days?: unknown;
  filters?: PortfolioMilestonesFilters;
  supabase?: Awaited<ReturnType<typeof createClient>>;
}) {
  const supabase = input.supabase ?? (await createClient());
  const days = clampDays(input.days == null ? null : String(input.days), 30);
  const scope = await resolvePortfolioScope(supabase, input.userId);
  const visibleIds = uniqStrings(Array.isArray(scope.projectIds) ? scope.projectIds : []);
  const active = await normalizeActiveIds(supabase, visibleIds);
  const projectIds = active.ids;
  if (!projectIds.length) {
    return { ok: true, windowDays: days, dueSoon: [], nextMilestone: null, totalMilestones: 0, hasAny: false, signals: { hasOverdue: false, overdueCount: 0, atRiskCount: 0 }, insight: { summary: 'No active projects in scope.', tone: 'neutral' }, count: 0, meta: { projectCount: 0, completeness: 'empty', reason: 'NO_ACTIVE_PROJECTS' } };
  }
  const today = new Date(); today.setUTCHours(0,0,0,0);
  const windowEnd = new Date(today); windowEnd.setUTCDate(windowEnd.getUTCDate() + days);
  const { data: rows } = await supabase.from('schedule_milestones').select('id,milestone_name,end_date,start_date,status,project_id').in('project_id', projectIds).limit(5000);
  const all = (rows ?? []).map((m: any) => { const dateStr = safeStr(m.end_date || m.start_date).trim(); const d = new Date(dateStr); return { id: String(m.id), title: safeStr(m.milestone_name).trim() || 'Milestone', date: dateStr, status: safeStr(m.status).trim() || null, project_id: safeStr(m.project_id).trim(), project_title: null, project_code: null, _d: d }; }).filter((m: any) => m.date && !isNaN(m._d.getTime()));
  const dueSoon = all.filter((m: any) => m._d >= today && m._d <= windowEnd).sort((a: any, b: any) => a._d - b._d).map(({ _d, ...m }: any) => m);
  const future = all.filter((m: any) => m._d > windowEnd).sort((a: any, b: any) => a._d - b._d);
  const overdueCount = all.filter((m: any) => m._d < today && !['done','completed','closed'].includes((m.status ?? '').toLowerCase())).length;
  const nextMilestone = dueSoon[0] ?? (future.length > 0 ? (({ _d, ...m }) => m)(future[0]) : null);
  const hasAny = all.length > 0;
  const totalCount = dueSoon.length + overdueCount;
  const summary = !hasAny ? 'No milestones defined — schedule visibility limited.' : overdueCount > 0 ? overdueCount + ' milestone(s) overdue — schedule risk detected.' : dueSoon.length > 0 ? dueSoon.length + ' milestone(s) due in the next ' + days + ' days.' : nextMilestone ? 'No milestones due in the next ' + days + ' days — next milestone scheduled ahead.' : 'No milestones due in the next ' + days + ' days — schedule on track.';
  const tone = overdueCount > 0 ? 'warning' : dueSoon.length > 0 ? 'neutral' : 'positive';
  return { ok: true, windowDays: days, dueSoon, nextMilestone, totalMilestones: all.length, hasAny, signals: { hasOverdue: overdueCount > 0, overdueCount, atRiskCount: 0 }, insight: { summary, tone }, count: totalCount, meta: { projectCount: projectIds.length, completeness: hasAny ? 'full' : 'empty', reason: hasAny ? null : 'NO_MILESTONES_DEFINED' } };
}
