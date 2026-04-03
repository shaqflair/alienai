import "server-only";

import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export type PortfolioFinancialPlanFilters = {
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

export type PortfolioFinancialPlanSummaryPayload = {
  ok: true;
  total_approved_budget: number | null;
  total_spent: number | null;
  variance_pct: number | null;
  pending_exposure_pct: number | null;
  rag: "G" | "A" | "R";
  currency: string;
  project_ref: string | null;
  artifact_id: string | null;
  project_count: number;
  portfolio: {
    totalBudget: number;
    totalForecast: number;
    totalActual: number;
    totalVariance: number;
    projectCount: number;
    withPlanCount: number;
    variancePct: number | null;
    rag: "G" | "A" | "R";
    meta: {
      totalApprovedBudget: number;
      totalEffectiveBudget: number;
      completeness?: "full" | "partial" | "empty";
      reason?: string | null;
      scope_mode?: string | null;
      rawCount?: number;
      activeCount?: number;
      effectiveCount?: number;
      visibleProjectCount?: number;
      activeProjectCount?: number;
      usedFallback?: boolean;
    };
  };
  projects: Array<{
    projectId: string;
    projectCode: any;
    projectCodeLabel: string | null;
    title: string;
    colour: string;
    status: string;
    startDate: string | null;
    finishDate: string | null;
    role: string;
    hasFinancialPlan: boolean;
    artifactId: string | null;
    lastUpdated: string | null;
    currency: string;
    totals: {
      approvedBudget: number;
      budget: number;
      forecast: number;
      actual: number;
      variance: number;
      variancePct: number | null;
      burnPct: number;
    };
    monthlyBreakdown: Record<
      string,
      { budget: number; forecast: number; actual: number }
    >;
  }>;
  meta: {
    organisationId: string | null;
    scope: any;
    filters: any;
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

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function ragFromVariancePct(pct: number | null): "G" | "A" | "R" {
  if (pct === null) return "G";
  if (pct > 5) return "R";
  if (pct > 0) return "A";
  return "G";
}

function hasAnyFilters(f: PortfolioFinancialPlanFilters) {
  return (
    (f.projectName && f.projectName.length) ||
    (f.projectCode && f.projectCode.length) ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department && f.department.length)
  );
}

export function parseFinancialPlanSummaryFiltersFromUrl(
  url: URL,
): PortfolioFinancialPlanFilters {
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

  const out: PortfolioFinancialPlanFilters = {};
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}

export function parseFinancialPlanSummaryFiltersFromBody(
  body: any,
): PortfolioFinancialPlanFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioFinancialPlanFilters = {};
  const names = uniqStrings(
    f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name,
  );
  const codes = uniqStrings(
    f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code,
  );
  const pms = uniqStrings(
    f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id,
  );
  const depts = uniqStrings(f?.department ?? f?.departments ?? f?.dept);
  if (names.length) out.projectName = names;
  if (codes.length) out.projectCode = codes;
  if (pms.length) out.projectManagerId = pms;
  if (depts.length) out.department = depts;
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

async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioFinancialPlanFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) {
    return { projectIds: [], meta: { ...meta, applied: true } };
  }
  if (!hasAnyFilters(filters)) return { projectIds: scopedProjectIds, meta };

  const selectSets = [
    "id, title, project_code, project_manager_id, department, colour, start_date, finish_date, resource_status",
    "id, title, project_code, project_manager_id, colour, start_date, finish_date, resource_status",
    "id, title, project_code, department, colour, start_date, finish_date, resource_status",
    "id, title, project_code, colour, start_date, finish_date, resource_status",
  ];

  let rows: any[] = [];
  let lastErr: any = null;

  for (const sel of selectSets) {
    const { data, error } = await supabase
      .from("projects")
      .select(sel)
      .in("id", scopedProjectIds)
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
    meta.notes.push("filter fallback");
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

  const outIds = filtered
    .map((p) => String(p?.id || "").trim())
    .filter(Boolean);

  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };
  return { projectIds: outIds, meta, projectRows: rows };
}

function extractBudgetFromContent(content: any): {
  totalApprovedBudget: number;
  totalBudgeted: number;
  totalForecast: number;
  totalActual: number;
  currency: string;
} {
  let totalApprovedBudget = 0;
  let totalBudgeted = 0;
  let totalForecast = 0;
  let totalActual = 0;
  let currency = "GBP";

  if (!content || typeof content !== "object") {
    return { totalApprovedBudget, totalBudgeted, totalForecast, totalActual, currency };
  }

  if (content.currency) currency = safeStr(content.currency);

  const approvedRaw =
    content.total_approved_budget ??
    content.totalApprovedBudget ??
    content.approved_budget ??
    content.approvedBudget ??
    content.total_approved ??
    content.totalApproved ??
    content.approved ??
    content.budget_approved ??
    content.budgetApproved;

  totalApprovedBudget = num(approvedRaw, 0);

  const costLines: any[] = Array.isArray(content.cost_lines)
    ? content.cost_lines
    : Array.isArray(content.costLines)
      ? content.costLines
      : Array.isArray(content.lines)
        ? content.lines
        : Array.isArray(content.items)
          ? content.items
          : [];

  for (const line of costLines) {
    totalBudgeted += num(
      line?.budgeted ?? line?.budget ?? line?.planned ?? line?.amount,
      0,
    );
    totalActual += num(line?.actual ?? line?.actuals ?? line?.spent, 0);
  }

  const monthlyData = content.monthly_data ?? content.monthlyData ?? {};
  try {
    for (const [, months] of Object.entries(monthlyData) as any) {
      for (const [, vals] of Object.entries(months as any)) {
        const v = vals as any;
        totalForecast += num(v?.forecast, 0);
        if (costLines.length === 0) {
          totalBudgeted += num(v?.budget ?? v?.budgeted, 0);
          totalActual += num(v?.actual, 0);
        }
      }
    }
  } catch {}

  if (totalApprovedBudget === 0 && totalBudgeted === 0) {
    totalApprovedBudget = num(content.total ?? content.total_amount ?? content.amount, 0);
    totalBudgeted = num(content.budgeted ?? content.budget, 0);
    totalForecast = num(content.forecast ?? content.total_forecast, totalForecast);
    totalActual = num(content.actual ?? content.total_actual, totalActual);
  }

  return {
    totalApprovedBudget,
    totalBudgeted,
    totalForecast,
    totalActual,
    currency,
  };
}

export async function loadFinancialPlanSummary(input: {
  userId: string;
  filters?: PortfolioFinancialPlanFilters;
  supabase?: Awaited<ReturnType<typeof createClient>>;
}): Promise<PortfolioFinancialPlanSummaryPayload> {
  const supabase = input.supabase ?? (await createClient());
  const filters = input.filters ?? {};

  const scope = await resolvePortfolioScope(supabase, input.userId);
  const scopeMeta = scope.meta ?? {};
  const organisationId = scope.organisationId ?? null;

  const visibleProjectIds = uniqStrings(
    Array.isArray(scope.projectIds) ? scope.projectIds : [],
  );

  const activeProjectIds = uniqStrings(
    Array.isArray(scope.activeProjectIds) ? scope.activeProjectIds : [],
  );

  const rawProjectIds = uniqStrings(
    Array.isArray(scope.rawProjectIds) ? scope.rawProjectIds : [],
  );

  const filteredVisible = await applyProjectFilters(
    supabase,
    visibleProjectIds,
    filters,
  );
  const filteredVisibleProjectIds = uniqStrings(filteredVisible.projectIds);

  const activeAllowed = new Set(activeProjectIds);
  const filteredActiveProjectIds = filteredVisibleProjectIds.filter((id) =>
    activeAllowed.has(id),
  );

  const effectiveProjectIdsForDisplay = filteredVisibleProjectIds;
  const effectiveProjectIdsForScoring =
    filteredActiveProjectIds.length > 0 ? filteredActiveProjectIds : [];

  const completeness: "full" | "partial" | "empty" =
    effectiveProjectIdsForDisplay.length === 0
      ? "empty"
      : effectiveProjectIdsForScoring.length === effectiveProjectIdsForDisplay.length
        ? "full"
        : "partial";

  if (!effectiveProjectIdsForDisplay.length) {
    return {
      ok: true,
      total_approved_budget: null,
      total_spent: null,
      variance_pct: null,
      pending_exposure_pct: null,
      rag: "A",
      currency: "GBP",
      project_ref: null,
      artifact_id: null,
      project_count: 0,
      portfolio: {
        totalBudget: 0,
        totalForecast: 0,
        totalActual: 0,
        totalVariance: 0,
        projectCount: 0,
        withPlanCount: 0,
        variancePct: null,
        rag: "A",
        meta: {
          totalApprovedBudget: 0,
          totalEffectiveBudget: 0,
          completeness,
          reason: safeStr(scopeMeta?.reason || "no_projects_in_scope") || "no_projects_in_scope",
          scope_mode: safeStr(scopeMeta?.mode || "empty") || "empty",
          rawCount: rawProjectIds.length,
          activeCount: activeProjectIds.length,
          effectiveCount: effectiveProjectIdsForDisplay.length,
          visibleProjectCount: effectiveProjectIdsForDisplay.length,
          activeProjectCount: effectiveProjectIdsForScoring.length,
          usedFallback: Boolean(scopeMeta?.usedFallback),
        },
      },
      projects: [],
      meta: {
        organisationId,
        scope: {
          ...scopeMeta,
          rawProjectCount: rawProjectIds.length,
          activeProjectCount: activeProjectIds.length,
          visibleProjectCount: visibleProjectIds.length,
          filteredVisibleProjectCount: effectiveProjectIdsForDisplay.length,
          filteredActiveProjectCount: effectiveProjectIdsForScoring.length,
          completeness,
        },
        filters: filteredVisible.meta,
      },
    };
  }

  let projects: any[] = [];
  if (
    Array.isArray((filteredVisible as any).projectRows) &&
    (filteredVisible as any).projectRows.length
  ) {
    const allow = new Set(effectiveProjectIdsForDisplay);
    projects = (filteredVisible as any).projectRows.filter((p: any) =>
      allow.has(String(p?.id || "").trim()),
    );
    projects.sort((a: any, b: any) =>
      safeStr(a?.title).localeCompare(safeStr(b?.title)),
    );
  } else {
    const { data: projRows, error: projErr } = await supabase
      .from("projects")
      .select("id, title, project_code, colour, start_date, finish_date, resource_status")
      .in("id", effectiveProjectIdsForDisplay)
      .order("title", { ascending: true });

    if (projErr) throw new Error(projErr.message);
    projects = projRows ?? [];
  }

  let artifacts: any[] = [];
  const artTypes = [
    "FINANCIAL_PLAN",
    "financial_plan",
    "financial-plan",
    "financialPlan",
    "FINANCIAL_PLAN_ARTIFACT",
    "budget",
  ];
  const artSel = "id, project_id, content_json, content, updated_at";

  for (const artType of artTypes) {
    const { data, error } = await supabase
      .from("artifacts")
      .select(artSel)
      .in("project_id", effectiveProjectIdsForDisplay)
      .eq("type", artType)
      .order("updated_at", { ascending: false })
      .limit(20000);

    if (!error && Array.isArray(data) && data.length > 0) {
      artifacts = data;
      break;
    }
  }

  const planByProject = new Map<string, any>();
  for (const artifact of artifacts) {
    const pid = String((artifact as any)?.project_id || "").trim();
    if (pid && !planByProject.has(pid)) planByProject.set(pid, artifact);
  }

  let roleByProject = new Map<string, string>();
  try {
    const { data: memberships } = await supabase
      .from("project_members")
      .select("project_id, role, is_active, removed_at")
      .eq("user_id", input.userId)
      .is("removed_at", null)
      .in("project_id", effectiveProjectIdsForDisplay)
      .limit(20000);

    for (const m of memberships ?? []) {
      const pid = String((m as any)?.project_id || "").trim();
      if (pid && !roleByProject.has(pid)) {
        roleByProject.set(pid, safeStr((m as any)?.role).trim() || "viewer");
      }
    }
  } catch {
    roleByProject = new Map();
  }

  // ── Live timesheet actuals ────────────────────────────────────────────────
  // Logic mirrors financial-plan-timesheets.ts:
  //   user → job_title (profiles first, org_members fallback)
  //        → personal rate (user_id match) OR role rate (job_title → role_label)
  //        → days × rate = £ cost
  const liveActualByProject = new Map<string, number>();

  try {
    if (effectiveProjectIdsForDisplay.length > 0 && organisationId) {
      // Step 1: approved weekly timesheet entries
      const { data: wteData } = await supabase
        .from("weekly_timesheet_entries")
        .select("project_id, hours, timesheets!inner(user_id, status)")
        .in("project_id", effectiveProjectIdsForDisplay)
        .eq("timesheets.status", "approved")
        .gt("hours", 0);

      if (wteData && wteData.length > 0) {
        const userIds = [
          ...new Set(
            wteData
              .map((r: any) => r.timesheets?.user_id)
              .filter(Boolean) as string[],
          ),
        ];

        // Step 2: fetch job titles — profiles first, org_members as fallback
        const [{ data: profileData }, { data: memberData }, { data: rateData }] =
          await Promise.all([
            supabase
              .from("profiles")
              .select("user_id, job_title")
              .in("user_id", userIds),
            supabase
              .from("organisation_members")
              .select("user_id, job_title, role")
              .eq("organisation_id", organisationId)
              .in("user_id", userIds),
            // Step 3: fetch ALL day_rate cards for this org
            // (both personal user_id-scoped and role-based user_id-null)
            supabase
              .from("resource_rates")
              .select("user_id, role_label, rate, rate_type")
              .eq("organisation_id", organisationId)
              .eq("rate_type", "day_rate"), // day rates only — no monthly_cost conversion errors
          ]);

        // Build job title map: profiles wins, org_members fills gaps
        const jobTitleByUser = new Map<string, string>();
        for (const m of memberData ?? []) {
          const title = String(m.job_title || m.role || "").trim();
          if (m.user_id && title) jobTitleByUser.set(String(m.user_id), title);
        }
        for (const p of profileData ?? []) {
          const title = String(p.job_title || "").trim();
          if (p.user_id && title) jobTitleByUser.set(String(p.user_id), title);
        }

        // Build rate maps:
        //   personalRateByUser  — user_id IS NOT NULL → highest priority
        //   rateByLabel         — user_id IS NULL, keyed by lowercase role_label
        const personalRateByUser = new Map<string, number>();
        const rateByLabel = new Map<string, number>();

        for (const r of rateData ?? []) {
          if (!r.role_label || !r.rate) continue;
          const rate = Number(r.rate);
          if (r.user_id) {
            // Personal rate — keyed by user_id (first entry wins per user)
            if (!personalRateByUser.has(String(r.user_id))) {
              personalRateByUser.set(String(r.user_id), rate);
            }
          } else {
            // Role-based rate — keyed by lowercase role_label (first entry wins)
            const label = String(r.role_label).toLowerCase().trim();
            if (!rateByLabel.has(label)) {
              rateByLabel.set(label, rate);
            }
          }
        }

        // Step 4: sum approved cost per project
        // Priority: personal rate → role rate via job title
        for (const row of wteData) {
          const pid = String((row as any).project_id ?? "");
          if (!pid) continue;

          const uid  = (row as any).timesheets?.user_id;
          const days = (Number((row as any).hours) || 0) / 8;

          // 1. Try personal rate
          let dayRate = uid ? (personalRateByUser.get(String(uid)) ?? 0) : 0;

          // 2. Fall back to role-based rate via job title
          if (!dayRate && uid) {
            const jobTitle = jobTitleByUser.get(String(uid));
            if (jobTitle) {
              dayRate = rateByLabel.get(jobTitle.toLowerCase().trim()) ?? 0;
            }
          }

          if (dayRate > 0) {
            liveActualByProject.set(
              pid,
              (liveActualByProject.get(pid) ?? 0) + days * dayRate,
            );
          } else {
            console.warn(
              `[loadFinancialPlanSummary] No rate for user ${uid} ` +
              `(job: "${jobTitleByUser.get(String(uid)) ?? "unknown"}") — excluded from actuals`,
            );
          }
        }
      }
    }
  } catch (e) {
    console.warn("[loadFinancialPlanSummary] live timesheet fetch failed:", e);
  }

  const scoringAllowed = new Set(effectiveProjectIdsForScoring);

  const summaries = (projects ?? []).map((project: any) => {
    const pid = String(project?.id || "").trim();
    const artifact = planByProject.get(pid);
    const contentRaw = artifact?.content_json ?? artifact?.content;
    const content = safeJson(contentRaw);

    let hasFinancialPlan = false;
    let extracted = {
      totalApprovedBudget: 0,
      totalBudgeted: 0,
      totalForecast: 0,
      totalActual: 0,
      currency: "GBP",
    };

    if (content && typeof content === "object") {
      hasFinancialPlan = true;
      extracted = extractBudgetFromContent(content);
    }

    const { totalApprovedBudget, totalBudgeted, totalForecast, currency } = extracted;

    // Use live timesheet actual if available (days × rate card),
    // fall back to stored content_json actual
    const totalActual = liveActualByProject.has(pid)
      ? Math.round(liveActualByProject.get(pid)! * 100) / 100
      : extracted.totalActual;

    const effectiveBudget = totalApprovedBudget > 0 ? totalApprovedBudget : totalBudgeted;
    const variance = totalForecast - effectiveBudget;
    const variancePct =
      effectiveBudget > 0
        ? Math.round(((variance / effectiveBudget) * 100) * 10) / 10
        : null;
    const burnPct =
      effectiveBudget > 0
        ? Math.round((totalActual / effectiveBudget) * 100)
        : 0;

    const monthlyBreakdown: Record<
      string,
      { budget: number; forecast: number; actual: number }
    > = {};

    const monthlyData = content?.monthly_data ?? content?.monthlyData ?? null;
    if (monthlyData) {
      try {
        for (const [, months] of Object.entries(monthlyData) as any) {
          for (const [monthKey, vals] of Object.entries(months as any)) {
            const v = vals as any;
            if (!monthlyBreakdown[monthKey]) {
              monthlyBreakdown[monthKey] = { budget: 0, forecast: 0, actual: 0 };
            }
            monthlyBreakdown[monthKey].budget   += num(v?.budget ?? v?.budgeted, 0);
            monthlyBreakdown[monthKey].forecast += num(v?.forecast, 0);
            monthlyBreakdown[monthKey].actual   += num(v?.actual, 0);
          }
        }
      } catch {}
    }

    const includedInScoring = scoringAllowed.has(pid);

    return {
      projectId: pid,
      projectCode: project?.project_code ?? null,
      projectCodeLabel: projectCodeLabel(project?.project_code) || null,
      title: project?.title ?? "Project",
      colour: project?.colour ?? "#00b8db",
      status: project?.resource_status ?? "confirmed",
      startDate: project?.start_date ?? null,
      finishDate: project?.finish_date ?? null,
      role: roleByProject.get(pid) || "viewer",
      hasFinancialPlan,
      artifactId: artifact?.id ?? null,
      lastUpdated: artifact?.updated_at ?? null,
      currency,
      totals: {
        approvedBudget: includedInScoring ? totalApprovedBudget : 0,
        budget:         includedInScoring ? effectiveBudget      : 0,
        forecast:       includedInScoring ? totalForecast        : 0,
        actual:         includedInScoring ? totalActual          : 0,
        variance:       includedInScoring ? variance             : 0,
        variancePct:    includedInScoring ? variancePct          : null,
        burnPct:        includedInScoring ? burnPct              : 0,
      },
      monthlyBreakdown: includedInScoring ? monthlyBreakdown : {},
    };
  });

  const withPlan = summaries.filter(
    (p: any) => p.hasFinancialPlan && scoringAllowed.has(p.projectId),
  );

  const portTotalApproved = withPlan.reduce(
    (s: number, p: any) => s + num(p.totals.approvedBudget, 0), 0,
  );
  const portTotalBudget = withPlan.reduce(
    (s: number, p: any) => s + num(p.totals.budget, 0), 0,
  );
  const portTotalForecast = withPlan.reduce(
    (s: number, p: any) => s + num(p.totals.forecast, 0), 0,
  );
  const portTotalActual = withPlan.reduce(
    (s: number, p: any) => s + num(p.totals.actual, 0), 0,
  );

  const effectivePortBudget   = portTotalBudget;
  const portfolioVariance     = portTotalForecast - effectivePortBudget;
  const portfolioVariancePct  =
    effectivePortBudget > 0
      ? Math.round(((portfolioVariance / effectivePortBudget) * 100) * 10) / 10
      : null;

  const portfolioRag =
    effectiveProjectIdsForScoring.length === 0
      ? "A"
      : ragFromVariancePct(portfolioVariancePct);

  const firstPlanProject   = withPlan[0];
  const portfolioCurrency  = firstPlanProject?.currency ?? "GBP";

  const portfolio = {
    totalBudget:    effectivePortBudget,
    totalForecast:  portTotalForecast,
    totalActual:    portTotalActual,
    totalVariance:  portfolioVariance,
    projectCount:   effectiveProjectIdsForDisplay.length,
    withPlanCount:  withPlan.length,
    variancePct:    portfolioVariancePct,
    rag:            portfolioRag,
    meta: {
      totalApprovedBudget:  portTotalApproved,
      totalEffectiveBudget: portTotalBudget,
      completeness,
      reason:     safeStr(scopeMeta?.reason || "ok") || "ok",
      scope_mode: safeStr(scopeMeta?.mode || "strict") || "strict",
      rawCount:              rawProjectIds.length,
      activeCount:           activeProjectIds.length,
      effectiveCount:        effectiveProjectIdsForDisplay.length,
      visibleProjectCount:   effectiveProjectIdsForDisplay.length,
      activeProjectCount:    effectiveProjectIdsForScoring.length,
      usedFallback:          Boolean(scopeMeta?.usedFallback),
    },
  };

  return {
    ok: true,
    total_approved_budget: effectivePortBudget > 0 ? effectivePortBudget : null,
    total_spent:           portTotalActual > 0 ? portTotalActual : null,
    variance_pct:          portfolioVariancePct,
    pending_exposure_pct:  null,
    rag:                   portfolioRag,
    currency:              portfolioCurrency,
    project_ref:           firstPlanProject?.projectId ?? null,
    artifact_id:           firstPlanProject?.artifactId ?? null,
    project_count:         effectiveProjectIdsForDisplay.length,
    portfolio,
    projects: summaries,
    meta: {
      organisationId,
      scope: {
        ...scopeMeta,
        rawProjectCount:              rawProjectIds.length,
        activeProjectCount:           activeProjectIds.length,
        visibleProjectCount:          visibleProjectIds.length,
        filteredVisibleProjectCount:  effectiveProjectIdsForDisplay.length,
        filteredActiveProjectCount:   effectiveProjectIdsForScoring.length,
        completeness,
      },
      filters: filteredVisible.meta,
    },
  };
}