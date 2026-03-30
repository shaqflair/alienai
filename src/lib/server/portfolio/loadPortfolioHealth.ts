import "server-only";

import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { computePortfolioHealth } from "@/lib/server/project-health";

type Rag = "G" | "A" | "R";

export type PortfolioHealthFilters = {
  projectId?: string[];
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

export type PortfolioHealthPayload = {
  ok: true;
  score: number | null;
  portfolio_health: number;
  projectCount: number;
  parts: {
    schedule: number | null;
    raid: number | null;
    budget: number | null;
    governance: number | null;
    flow: number | null;
    approvals: number | null;
    activity: number | null;
  };
  projectScores: Record<string, { score: number; rag: Rag }>;
  drivers: any[];
  meta: {
    organisationId: string | null;
    days: 7 | 14 | 30 | 60 | "all";
    windowDays: 7 | 14 | 30 | 60;
    activeFilter?: {
      rawCount: number;
      activeCount: number;
      finalCount: number;
      visibleCount?: number;
      notes: string[];
      completeness?: "full" | "partial" | "empty";
    };
    filters?: any;
    scope?: any;
    notes?: string[];
  };
};

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

export function clampDaysParam(v: any): 7 | 14 | 30 | 60 | "all" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as 7 | 14 | 30 | 60) : 30;
}

export function normalizeWindowDays(
  daysParam: 7 | 14 | 30 | 60 | "all",
): 7 | 14 | 30 | 60 {
  return daysParam === "all" ? 60 : daysParam;
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
  return (
    msg.includes("does not exist") ||
    msg.includes("relation") ||
    msg.includes("42p01")
  );
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

export function parsePortfolioHealthFiltersFromUrl(
  url: URL,
): PortfolioHealthFilters {
  const ids = uniqStrings(
    url.searchParams
      .getAll("projectId")
      .flatMap((x) => x.split(","))
      .map((s) => s.trim()),
  );
  const name = uniqStrings(
    url.searchParams
      .getAll("name")
      .flatMap((x) => x.split(","))
      .map((s) => s.trim()),
  );
  const code = uniqStrings(
    url.searchParams
      .getAll("code")
      .flatMap((x) => x.split(","))
      .map((s) => s.trim()),
  );
  const pm = uniqStrings(
    url.searchParams
      .getAll("pm")
      .flatMap((x) => x.split(","))
      .map((s) => s.trim()),
  );
  const dept = uniqStrings(
    url.searchParams
      .getAll("dept")
      .flatMap((x) => x.split(","))
      .map((s) => s.trim()),
  );

  const out: PortfolioHealthFilters = {};
  if (ids.length) out.projectId = ids;
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}

export function parsePortfolioHealthFiltersFromBody(
  body: any,
): PortfolioHealthFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioHealthFilters = {};

  const ids = uniqStrings(f?.projectId ?? f?.projectIds ?? f?.id);
  const names = uniqStrings(
    f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name,
  );
  const codes = uniqStrings(
    f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code,
  );
  const pms = uniqStrings(
    f?.projectManagerId ??
      f?.projectManagerIds ??
      f?.pm ??
      f?.project_manager_id,
  );
  const depts = uniqStrings(f?.department ?? f?.departments ?? f?.dept);

  if (ids.length) out.projectId = ids;
  if (names.length) out.projectName = names;
  if (codes.length) out.projectCode = codes;
  if (pms.length) out.projectManagerId = pms;
  if (depts.length) out.department = depts;

  return out;
}

function hasAnyFilters(f: PortfolioHealthFilters) {
  return (
    (f.projectId && f.projectId.length) ||
    (f.projectName && f.projectName.length) ||
    (f.projectCode && f.projectCode.length) ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department && f.department.length)
  );
}

async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioHealthFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };

  if (!scopedProjectIds.length) {
    return { projectIds: [], meta: { ...meta, applied: true } };
  }

  if (!hasAnyFilters(filters)) {
    return { projectIds: scopedProjectIds, meta };
  }

  let workingIds = scopedProjectIds;

  if (filters.projectId?.length) {
    const wanted = new Set(
      filters.projectId.map((v) => safeStr(v).trim()).filter(Boolean),
    );
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
      .limit(20000);

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

  const outIds = filtered
    .map((p) => String(p?.id || "").trim())
    .filter(Boolean);

  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };

  return { projectIds: outIds, meta };
}

function scoreToRag(score: number | null): Rag | null {
  if (score == null) return null;
  if (score >= 85) return "G";
  if (score >= 70) return "A";
  return "R";
}

export async function loadPortfolioHealth(input: {
  userId: string;
  days?: unknown;
  filters?: PortfolioHealthFilters;
  supabase?: Awaited<ReturnType<typeof createClient>>;
}): Promise<PortfolioHealthPayload> {
  const supabase = input.supabase ?? (await createClient());

  const daysParam = clampDaysParam(input.days);
  const windowDays = normalizeWindowDays(daysParam);
  const filters = input.filters ?? {};

  const scope = await resolvePortfolioScope(supabase, input.userId);
  const scopeMeta = scope.meta ?? {};
  const orgId = scope.organisationId ?? null;

  const explicitProjectIds = uniqStrings(filters.projectId);

  const rawProjectIds = uniqStrings(
    Array.isArray(scope.rawProjectIds) ? scope.rawProjectIds : [],
  );

  const visibleProjectIdsFromScope = explicitProjectIds.length
    ? explicitProjectIds
    : uniqStrings(Array.isArray(scope.projectIds) ? scope.projectIds : []);

  const activeProjectIdsFromScope = explicitProjectIds.length
    ? explicitProjectIds
    : uniqStrings(Array.isArray(scope.activeProjectIds) ? scope.activeProjectIds : []);

  const emptyResponse: PortfolioHealthPayload = {
    ok: true,
    score: null,
    portfolio_health: 0,
    projectCount: 0,
    parts: {
      schedule: null,
      raid: null,
      budget: null,
      governance: null,
      flow: null,
      approvals: null,
      activity: null,
    },
    projectScores: {},
    drivers: [],
    meta: {
      organisationId: orgId,
      days: daysParam,
      windowDays,
      notes: [],
    },
  };

  if (!orgId && !explicitProjectIds.length) {
    return {
      ...emptyResponse,
      meta: {
        organisationId: null,
        days: daysParam,
        windowDays,
        notes: ["No active organisation resolved."],
        scope: {
          ...scopeMeta,
          rawProjectCount: rawProjectIds.length,
          visibleProjectCount: visibleProjectIdsFromScope.length,
          activeProjectCount: activeProjectIdsFromScope.length,
          completeness: "empty",
        },
      },
    };
  }

  const filteredVisible = await applyProjectFilters(
    supabase,
    visibleProjectIdsFromScope,
    filters,
  );
  const filteredVisibleProjectIds = uniqStrings(filteredVisible.projectIds);

  const activeAllowed = new Set(activeProjectIdsFromScope);
  const filteredActiveProjectIds = filteredVisibleProjectIds.filter((id) =>
    activeAllowed.has(id),
  );

  const completeness: "full" | "partial" | "empty" =
    filteredVisibleProjectIds.length === 0
      ? "empty"
      : filteredActiveProjectIds.length === filteredVisibleProjectIds.length
        ? "full"
        : "partial";

  if (!filteredVisibleProjectIds.length) {
    return {
      ...emptyResponse,
      meta: {
        organisationId: orgId,
        days: daysParam,
        windowDays,
        activeFilter: {
          rawCount: rawProjectIds.length,
          activeCount: activeProjectIdsFromScope.length,
          finalCount: 0,
          visibleCount: 0,
          notes: ["No projects remain after scope and filter application."],
          completeness,
        },
        filters: filteredVisible.meta,
        scope: {
          ...scopeMeta,
          rawProjectCount: rawProjectIds.length,
          visibleProjectCount: visibleProjectIdsFromScope.length,
          activeProjectCount: activeProjectIdsFromScope.length,
          filteredVisibleProjectCount: 0,
          filteredActiveProjectCount: 0,
          explicitProjectIds,
          source: explicitProjectIds.length
            ? "explicit-project-filter"
            : (scopeMeta?.source ?? "unknown"),
          completeness,
        },
        notes: ["No projects in scope after filtering."],
      },
    };
  }

  if (!filteredActiveProjectIds.length) {
    return {
      ...emptyResponse,
      meta: {
        organisationId: orgId,
        days: daysParam,
        windowDays,
        activeFilter: {
          rawCount: rawProjectIds.length,
          activeCount: activeProjectIdsFromScope.length,
          finalCount: 0,
          visibleCount: filteredVisibleProjectIds.length,
          notes: [
            "Projects are visible in scope, but none qualify for active health scoring.",
          ],
          completeness,
        },
        filters: filteredVisible.meta,
        scope: {
          ...scopeMeta,
          rawProjectCount: rawProjectIds.length,
          visibleProjectCount: visibleProjectIdsFromScope.length,
          activeProjectCount: activeProjectIdsFromScope.length,
          filteredVisibleProjectCount: filteredVisibleProjectIds.length,
          filteredActiveProjectCount: 0,
          explicitProjectIds,
          source: explicitProjectIds.length
            ? "explicit-project-filter"
            : (scopeMeta?.source ?? "unknown"),
          completeness,
        },
        notes: ["Visible projects exist, but no active projects remain for scoring."],
      },
    };
  }

  const health = await computePortfolioHealth(
    supabase,
    filteredActiveProjectIds,
    windowDays,
  );
  const scoreValue = health.score ?? 0;

  const projectScores: Record<string, { score: number; rag: Rag }> = {};
  for (const [pid, result] of Object.entries(health.perProject ?? {})) {
    const score = (result as any)?.score;
    if (score == null) continue;
    const rag = scoreToRag(score);
    if (!rag) continue;
    projectScores[pid] = { score, rag };
  }

  return {
    ok: true,
    score: health.score,
    portfolio_health: scoreValue,
    projectCount: filteredActiveProjectIds.length,
    parts: {
      schedule: health.parts.schedule,
      raid: health.parts.raid,
      budget: health.parts.budget,
      governance: health.parts.governance,
      flow: health.parts.budget,
      approvals: health.parts.governance,
      activity: null,
    },
    projectScores,
    drivers: [],
    meta: {
      organisationId: orgId,
      days: daysParam,
      windowDays,
      activeFilter: {
        rawCount: rawProjectIds.length,
        activeCount: activeProjectIdsFromScope.length,
        finalCount: filteredActiveProjectIds.length,
        visibleCount: filteredVisibleProjectIds.length,
        notes: [],
        completeness,
      },
      filters: filteredVisible.meta,
      scope: {
        ...scopeMeta,
        rawProjectCount: rawProjectIds.length,
        visibleProjectCount: visibleProjectIdsFromScope.length,
        activeProjectCount: activeProjectIdsFromScope.length,
        filteredVisibleProjectCount: filteredVisibleProjectIds.length,
        filteredActiveProjectCount: filteredActiveProjectIds.length,
        explicitProjectIds,
        source: explicitProjectIds.length
          ? "explicit-project-filter"
          : (scopeMeta?.source ?? "unknown"),
        completeness,
      },
      notes: [],
    },
  };
}