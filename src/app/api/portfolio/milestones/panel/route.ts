// src/app/api/portfolio/milestones/panel/route.ts — REBUILT v5 (SCHEDULE INTELLIGENCE)
// Adds / Fixes:
//   ✅ MP-F1: Supports dashboard filters (GET + POST): name/code/pm/dept
//   ✅ MP-F2: ORG-wide scope uses shared resolvePortfolioScope() helper
//   ✅ MP-F3: Active-only project filtering via filterActiveProjectIds (FAIL-OPEN)
//   ✅ MP-F4: clampDays handles "all" → 60
//   ✅ MP-F5: Cache-Control no-store everywhere
//   ✅ MP-F6: Removes duplicated org-scope resolution logic from route body
//   ✅ MP-F7: resolvePortfolioScope signature fixed (supabase, userId)
//   ✅ MP-F8: Returns rich schedule intelligence payload:
//            - dueSoon
//            - nextMilestone
//            - totalMilestones
//            - hasAny
//            - signals
//            - insight
// Keeps:
//   • Uses get_schedule_milestones_kpis_portfolio RPC for KPI panel
//   • Backward-compatible panel + count response shape
//
// Notes:
// - filterActiveProjectIds contract is normalized (supports either string[] OR { projectIds } return)
// - Also reads schedule_milestones directly to build forward-looking intelligence
// - milestonesDue can safely consume this payload shape on the UI side

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function noStore(res: NextResponse): NextResponse {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: any, status = 200): NextResponse {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function err(message: string, status = 400, meta?: any): NextResponse {
  return noStore(NextResponse.json({ ok: false, error: message, meta }, { status }));
}

/* ---------------- utils ---------------- */

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

function num(x: any, fallback = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function looksMissingRelation(error: any) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(error: any) {
  const msg = String(error?.message || error || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
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

function clampDays(x: any, fallback = 30): 7 | 14 | 30 | 60 {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n)
    ? (n as 7 | 14 | 30 | 60)
    : (fallback as 7 | 14 | 30 | 60);
}

function emptyPanel(days: number) {
  return {
    days,
    due_count: 0,
    overdue_count: 0,
    ai_high_risk_count: 0,
    status_breakdown: { planned: 0, at_risk: 0, overdue: 0 },
    slippage: { avg_slip_days: 0, max_slip_days: 0 },
  };
}

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function addDays(date: Date, days: number) {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function parseDateLike(value: any): Date | null {
  const s = safeStr(value).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function inferTone(args: {
  hasAny: boolean;
  dueSoonCount: number;
  overdueCount: number;
  nextMilestone: any | null;
}): "positive" | "neutral" | "warning" {
  if (!args.hasAny) return "warning";
  if (args.overdueCount > 0) return "warning";
  if (args.dueSoonCount > 0) return "neutral";
  if (args.nextMilestone) return "positive";
  return "positive";
}

function buildInsightSummary(args: {
  windowDays: number;
  hasAny: boolean;
  dueSoonCount: number;
  overdueCount: number;
  nextMilestone: any | null;
}) {
  const { windowDays, hasAny, dueSoonCount, overdueCount, nextMilestone } = args;

  if (!hasAny) {
    return "No milestones defined — schedule visibility limited.";
  }

  if (overdueCount > 0) {
    return `${overdueCount} milestone(s) overdue — schedule risk detected.`;
  }

  if (dueSoonCount > 0) {
    return `${dueSoonCount} milestone(s) due in the next ${windowDays} days.`;
  }

  if (nextMilestone) {
    return `No milestones due in the next ${windowDays} days — next milestone scheduled ahead.`;
  }

  return `No milestones due in the next ${windowDays} days — schedule on track.`;
}

/* ---------------- filters ---------------- */

type PortfolioFilters = {
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

function hasAnyFilters(f: PortfolioFilters) {
  return (
    (f.projectName && f.projectName.length) ||
    (f.projectCode && f.projectCode.length) ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department && f.department.length)
  );
}

function parseFiltersFromUrl(url: URL): PortfolioFilters {
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

  const out: PortfolioFilters = {};
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}

function parseFiltersFromBody(body: any): PortfolioFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioFilters = {};

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

  if (names.length) out.projectName = names;
  if (codes.length) out.projectCode = codes;
  if (pms.length) out.projectManagerId = pms;
  if (depts.length) out.department = depts;
  return out;
}

/** Filter projects within scope, best-effort even if optional columns don't exist. */
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
      .from("projects")
      .select(sel)
      .in("id", scopedProjectIds)
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

/* ---------------- schedule milestone reads ---------------- */

type MilestoneRow = {
  id: string;
  title?: string | null;
  name?: string | null;
  due_date?: string | null;
  target_date?: string | null;
  date?: string | null;
  status?: string | null;
  project_id?: string | null;
  project?: {
    id?: string | null;
    title?: string | null;
    project_code?: string | null;
  } | null;
  projects?: {
    id?: string | null;
    title?: string | null;
    project_code?: string | null;
  } | null;
};

function milestoneTitle(row: MilestoneRow) {
  return safeStr(row.title || row.name).trim() || "Milestone";
}

function milestoneDateValue(row: MilestoneRow) {
  return safeStr(row.due_date || row.target_date || row.date).trim();
}

function projectJoin(row: MilestoneRow) {
  return row.projects ?? row.project ?? null;
}

function normalizeMilestone(row: MilestoneRow) {
  const joined = projectJoin(row);

  return {
    id: safeStr(row.id).trim(),
    title: milestoneTitle(row),
    date: milestoneDateValue(row),
    project_id: safeStr(row.project_id || joined?.id).trim(),
    project_title: safeStr(joined?.title).trim() || null,
    project_code: safeStr(joined?.project_code).trim() || null,
    status: safeStr(row.status).trim() || null,
  };
}

async function getMilestoneRows(
  supabase: any,
  projectIds: string[],
): Promise<MilestoneRow[]> {
  if (!projectIds.length) return [];

  const selectSets = [
    `
      id,
      title,
      due_date,
      status,
      project_id,
      projects:project_id (
        id,
        title,
        project_code
      )
    `,
    `
      id,
      name,
      due_date,
      status,
      project_id,
      projects:project_id (
        id,
        title,
        project_code
      )
    `,
    `
      id,
      title,
      target_date,
      status,
      project_id,
      projects:project_id (
        id,
        title,
        project_code
      )
    `,
    `
      id,
      title,
      due_date,
      project_id,
      projects:project_id (
        id,
        title,
        project_code
      )
    `,
    `
      id,
      title,
      due_date,
      status,
      project_id
    `,
    `
      id,
      name,
      due_date,
      status,
      project_id
    `,
    `
      id,
      title,
      target_date,
      status,
      project_id
    `,
  ];

  let lastError: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase
      .from("schedule_milestones")
      .select(sel)
      .in("project_id", projectIds)
      .limit(5000);

    if (!error && Array.isArray(data)) {
      return data as MilestoneRow[];
    }

    lastError = error;
    if (!(looksMissingColumn(error) || looksMissingRelation(error))) break;
  }

  console.warn("[portfolio/milestones/panel] failed to load schedule_milestones", {
    projectCount: projectIds.length,
    error: safeStr(lastError?.message || lastError),
  });

  return [];
}

/* ---------------- core ---------------- */

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  const failOpen = (reason: string) => ({
    ids: rawIds,
    ok: false,
    error: reason,
  });

  try {
    const r: any = await filterActiveProjectIds(supabase, rawIds);

    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && rawIds.length) {
        return failOpen("active filter returned 0 ids; failing open");
      }
      return { ids, ok: true, error: null as string | null };
    }

    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) {
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

async function handle(
  req: Request,
  opts: { days: 7 | 14 | 30 | 60; filters: PortfolioFilters },
) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id || null;
  if (authErr || !userId) return err("Not authenticated", 401);

  const scope = await resolvePortfolioScope(supabase, userId);
  const scopeMeta = scope.meta ?? {};
  const organisationId = scope.organisationId ?? null;
  const scopedIdsRaw: string[] = uniqStrings(
    Array.isArray(scope.rawProjectIds)
      ? scope.rawProjectIds
      : Array.isArray(scope.projectIds)
        ? scope.projectIds
        : [],
  );

  const active = await normalizeActiveIds(supabase, scopedIdsRaw);
  const scopedIdsActive = active.ids;

  const filtered = await applyProjectFilters(supabase, scopedIdsActive, opts.filters);
  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    const insight = {
      summary: "No active projects in scope — schedule visibility unavailable.",
      tone: "neutral" as const,
    };

    return ok({
      days: opts.days,
      windowDays: opts.days,
      panel: emptyPanel(opts.days),
      count: 0,
      dueSoon: [],
      nextMilestone: null,
      totalMilestones: 0,
      hasAny: false,
      signals: {
        hasOverdue: false,
        overdueCount: 0,
        atRiskCount: 0,
      },
      insight,
      meta: {
        organisationId,
        scope: {
          ...scopeMeta,
          scopedIdsRaw: scopedIdsRaw.length,
          scopedIdsActive: scopedIdsActive.length,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
        filters: filtered.meta,
        projectCount: 0,
        completeness: "empty",
        reason: "NO_ACTIVE_PROJECTS",
      },
    });
  }

  const [{ data: kpiData, error: kpiError }, milestoneRows] = await Promise.all([
    supabase.rpc("get_schedule_milestones_kpis_portfolio", {
      p_project_ids: projectIds,
      p_window_days: opts.days,
    }),
    getMilestoneRows(supabase, projectIds),
  ]);

  if (kpiError) return err(kpiError.message || "RPC failed", 500);

  const row = Array.isArray(kpiData) ? kpiData[0] : kpiData;

  const planned = num(row?.planned);
  const at_risk = num(row?.at_risk);
  const overdue = num(row?.overdue);
  const ai_high_risk = num(row?.ai_high_risk);
  const avg_slip = num(row?.slip_avg_days);
  const max_slip = num(row?.slip_max_days);
  const due_count = num(row?.due_count, planned + at_risk + overdue);

  const panel = {
    days: opts.days,
    due_count,
    overdue_count: overdue,
    ai_high_risk_count: ai_high_risk,
    status_breakdown: { planned, at_risk, overdue },
    slippage: { avg_slip_days: avg_slip, max_slip_days: max_slip },
  };

  const today = startOfTodayUtc();
  const windowEnd = addDays(today, opts.days);

  const normalized = milestoneRows
    .map(normalizeMilestone)
    .filter((m) => m.id && m.date);

  const dated = normalized
    .map((m) => ({
      ...m,
      _date: parseDateLike(m.date),
    }))
    .filter((m) => m._date);

  const dueSoon = dated
    .filter((m) => m._date! >= today && m._date! <= windowEnd)
    .sort((a, b) => a._date!.getTime() - b._date!.getTime())
    .map(({ _date, ...m }) => m);

  const futureMilestones = dated
    .filter((m) => m._date! > windowEnd)
    .sort((a, b) => a._date!.getTime() - b._date!.getTime());

  const nextMilestone =
    dueSoon[0] ??
    (futureMilestones[0]
      ? (() => {
          const { _date, ...m } = futureMilestones[0];
          return m;
        })()
      : null);

  const overdueCount = dated.filter((m) => m._date! < today).length;
  const hasAny = normalized.length > 0;

  const insight = {
    summary: buildInsightSummary({
      windowDays: opts.days,
      hasAny,
      dueSoonCount: dueSoon.length,
      overdueCount,
      nextMilestone,
    }),
    tone: inferTone({
      hasAny,
      dueSoonCount: dueSoon.length,
      overdueCount,
      nextMilestone,
    }),
  };

  return ok({
    days: opts.days,
    windowDays: opts.days,

    // backward-compatible shape
    panel,
    count: due_count,

    // new schedule intelligence shape
    dueSoon,
    nextMilestone,
    totalMilestones: normalized.length,
    hasAny,
    signals: {
      hasOverdue: overdueCount > 0,
      overdueCount,
      atRiskCount: at_risk,
    },
    insight,

    meta: {
      organisationId,
      scope: {
        ...scopeMeta,
        scopedIdsRaw: scopedIdsRaw.length,
        scopedIdsActive: scopedIdsActive.length,
        active_filter_ok: active.ok,
        active_filter_error: active.error,
      },
      filters: filtered.meta,
      projectCount: projectIds.length,
      completeness: hasAny ? "full" : "empty",
      reason: hasAny ? null : "NO_MILESTONES_DEFINED",
    },
  });
}

/* ---------------- routes ---------------- */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"), 30);
    const filters = parseFiltersFromUrl(url);
    return await handle(req, { days, filters });
  } catch (e: any) {
    console.error("[GET /api/portfolio/milestones/panel]", e);
    return err(String(e?.message ?? e ?? "Failed"), 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = clampDays(body?.days ?? body?.windowDays ?? "30", 30);
    const filters = parseFiltersFromBody(body);
    return await handle(req, { days, filters });
  } catch (e: any) {
    console.error("[POST /api/portfolio/milestones/panel]", e);
    return err(String(e?.message ?? e ?? "Failed"), 500);
  }
}