// src/app/api/portfolio/budget-phasing/route.ts
// GET ?fyStart=4&fyYear=2026&fyMonths=12&scope=active|all&projectIds=id1,id2
//
// PM resolution mirrors getProjectManagerNameBestEffort from the artifact page:
// 1. Look up project_members for PM role candidates
// 2. Fall back to projects.project_manager_id
// 3. Resolve profile name from profiles table

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function err(msg: string, status = 400) { return NextResponse.json({ ok: false, error: msg }, { status }); }
function safeNum(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function safeStr(v: any): string { return typeof v === "string" ? v : v == null ? "" : String(v); }

function buildMonthKeys(fyStart: number, fyYear: number, numMonths: number): string[] {
  const keys: string[] = [];
  let month = fyStart, year = fyYear;
  for (let i = 0; i < numMonths; i++) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    if (++month > 12) { month = 1; year++; }
  }
  return keys;
}

function currentMonthKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

// Same display name logic as the artifact page — prefer name over email, strip domain if only email
function displayName(profile: any): string {
  const full    = safeStr(profile?.full_name).trim();
  const display = safeStr(profile?.display_name).trim();
  const name    = safeStr(profile?.name).trim();
  const email   = safeStr(profile?.email).trim();
  if (full    && !full.includes("@"))    return full;
  if (display && !display.includes("@")) return display;
  if (name    && !name.includes("@"))    return name;
  if (email.includes("@")) return email.split("@")[0]; // "alex.adupoku" not full email
  return email || "Unknown";
}

const PM_ROLE_CANDIDATES = [
  "project_manager", "project manager", "pm",
  "programme_manager", "program_manager",
  "programme manager", "program manager",
  "delivery_manager", "delivery manager",
];

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    const url       = new URL(req.url);
    const fyStart   = Math.max(1, Math.min(12, parseInt(url.searchParams.get("fyStart") ?? "4", 10)));
    const rawMonths = parseInt(url.searchParams.get("fyMonths") ?? "12", 10);
    const numMonths = [12, 18, 24, 36].includes(rawMonths) ? rawMonths : 12;
    const nowYear   = new Date().getFullYear();
    const nowMonth  = new Date().getMonth() + 1;
    const defaultFy = nowMonth >= fyStart ? nowYear : nowYear - 1;
    const fyYear    = parseInt(url.searchParams.get("fyYear") ?? String(defaultFy), 10);
    const scope     = url.searchParams.get("scope") ?? "active";
    const filterIds = (url.searchParams.get("projectIds") ?? "").split(",").map(s => s.trim()).filter(Boolean);

    const monthKeys = buildMonthKeys(fyStart, fyYear, numMonths);
    const monthSet  = new Set(monthKeys);
    const nowKey    = currentMonthKey();

    // 1. Organisation
    const { data: orgMem } = await supabase
      .from("organisation_members").select("organisation_id")
      .eq("user_id", auth.user.id).is("removed_at", null).limit(1).maybeSingle();
    const orgId = safeStr((orgMem as any)?.organisation_id);
    if (!orgId) return err("No organisation found", 404);

    // 2. All projects (include department + project_manager_id for fallback)
    let projQ = supabase
      .from("projects")
      .select("id, title, project_code, project_manager_id, department, budget_amount")
      .eq("organisation_id", orgId)
      .neq("resource_status", "pipeline");
    if (scope === "active") projQ = projQ.is("deleted_at", null);
    const { data: projectRows } = await projQ.order("title");
    const allProjects = (projectRows ?? []) as any[];

    const empty = { ok: true, fyStart, fyYear, numMonths, monthKeys, aggregatedLines: [], monthlyData: {}, projectCount: 0, projectsWithPlan: 0, allProjects: [], filteredProjectCount: 0 };
    if (!allProjects.length) return NextResponse.json(empty);

    const allProjectIds = allProjects.map((p: any) => safeStr(p.id));

    // 3. PM resolution — same as artifact page getProjectManagerNameBestEffort
    //    Step A: query project_members for PM role
    const { data: pmMembers } = await supabase
      .from("project_members")
      .select("project_id, user_id, role")
      .in("project_id", allProjectIds)
      .eq("is_active", true)
      .in("role", PM_ROLE_CANDIDATES);

    // Step B: collect all user IDs to fetch profiles (PM members + project_manager_id fallbacks)
    const pmMemberUserIds = [...new Set((pmMembers ?? []).map((m: any) => safeStr(m.user_id)).filter(Boolean))];
    const fallbackPmIds   = [...new Set(allProjects.map((p: any) => safeStr(p.project_manager_id)).filter(Boolean))];
    const allUserIds      = [...new Set([...pmMemberUserIds, ...fallbackPmIds])];

    // Step C: fetch profiles
    const profileByUserId = new Map<string, any>();
    if (allUserIds.length) {
      const orFilter = allUserIds.flatMap(id => [`id.eq.${id}`, `user_id.eq.${id}`]).join(",");
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, display_name, name, email")
        .or(orFilter);
      for (const p of (profiles ?? []) as any[]) {
        if (p.id)      profileByUserId.set(safeStr(p.id),      p);
        if (p.user_id) profileByUserId.set(safeStr(p.user_id), p);
      }
    }

    // Step D: map project_id → PM name (project_members wins, project_manager_id is fallback)
    const pmNameByProjectId = new Map<string, string>();
    for (const m of (pmMembers ?? []) as any[]) {
      const pid = safeStr(m.project_id);
      if (pmNameByProjectId.has(pid)) continue; // first match wins
      const prof = profileByUserId.get(safeStr(m.user_id));
      if (prof) pmNameByProjectId.set(pid, displayName(prof));
    }
    // Fallback via project_manager_id
    for (const p of allProjects) {
      const pid   = safeStr(p.id);
      const pmId  = safeStr(p.project_manager_id);
      if (pmNameByProjectId.has(pid) || !pmId) continue;
      const prof = profileByUserId.get(pmId);
      if (prof) pmNameByProjectId.set(pid, displayName(prof));
    }

    // 4. Enriched project list for filter panel
    const enrichedProjects = allProjects.map((p: any) => ({
      id:          safeStr(p.id),
      title:       safeStr(p.title) || "Untitled",
      projectCode: safeStr(p.project_code),
      department:  safeStr(p.department).trim() || "",
      pmName:      pmNameByProjectId.get(safeStr(p.id)) ?? "",
      // budget_amount from projects table as a fallback
      projectBudget: safeNum(p.budget_amount),
    }));

    // 5. Which projects to aggregate
    const projectIds = filterIds.length
      ? allProjectIds.filter(id => filterIds.includes(id))
      : allProjectIds;

    if (!projectIds.length) {
      return NextResponse.json({ ...empty, projectCount: allProjects.length, allProjects: enrichedProjects });
    }

    // 6. Financial plans — no is_current filter (plans can have is_current:false), prefer approved
    const { data: artifactRows } = await supabase
      .from("artifacts")
      .select("id, project_id, content_json, approval_status, type")
      .in("project_id", projectIds)
      .ilike("type", "%financial%plan%");

    const artifactByProject = new Map<string, any>();
    const rank = (s: string) => s === "approved" ? 3 : s === "submitted" ? 2 : 1;
    for (const a of (artifactRows ?? []) as any[]) {
      const pid = safeStr(a.project_id);
      const existing = artifactByProject.get(pid);
      if (!existing || rank(a.approval_status) > rank(existing.approval_status)) {
        artifactByProject.set(pid, a);
      }
    }

    // 6b. FY-scoped actual spend — sum from TWO sources and take the higher:
    //   1. monthly_data.actual in the financial plan (populated from timesheet sync)
    //   2. project_spend table (direct spend entries)
    //   This ensures we capture actuals regardless of which mechanism was used.

    // Source 1: project_spend table filtered by FY date range
    const fyStartDate = `${fyYear}-${String(fyStart).padStart(2, "0")}-01`;
    const fyEndMonth  = monthKeys[monthKeys.length - 1];
    const [fyEndYear, fyEndMo] = fyEndMonth.split("-").map(Number);
    // Use today as the end date for actuals so current month spend is included
    const today       = new Date();
    const fyEndDate   = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

    const { data: spendRows } = await supabase
      .from("project_spend")
      .select("project_id, amount, spend_date")
      .in("project_id", projectIds)
      .gte("spend_date", fyStartDate)
      .lte("spend_date", fyEndDate);

    const spendByProject = new Map<string, number>();
    for (const row of (spendRows ?? []) as any[]) {
      const pid = safeStr(row.project_id);
      spendByProject.set(pid, (spendByProject.get(pid) ?? 0) + safeNum(row.amount));
    }

    // Source 2: monthly_data.actual from financial plans (from timesheet sync)
    const monthlyActualByProject = new Map<string, number>();
    for (const id of projectIds) {
      const artifact = artifactByProject.get(id);
      if (!artifact?.content_json) continue;
      const cj      = artifact.content_json;
      const lines   = (Array.isArray(cj.cost_lines) ? cj.cost_lines : Array.isArray(cj.lines) ? cj.lines : []) as any[];
      const monthly = (cj.monthly_data ?? cj.monthlyData ?? {}) as Record<string, Record<string, any>>;
      let lineActual = 0;
      for (const line of lines) {
        const lineData = monthly[safeStr(line.id)] ?? {};
        for (const mk of monthKeys) {
          // Include current month actuals (use <= not <)
          if (mk <= nowKey) lineActual += safeNum(lineData[mk]?.actual ?? 0);
        }
      }
      if (lineActual > 0) monthlyActualByProject.set(id, lineActual);
    }

    // Combine: use monthly_data actual if present (more granular), else project_spend
    const fyActualByProject = new Map<string, number>();
    let totalFyActual = 0;
    for (const id of projectIds) {
      const fromMonthly = monthlyActualByProject.get(id) ?? 0;
      const fromSpend   = spendByProject.get(id) ?? 0;
      // Take the higher of the two — they should be the same source but just in case
      const actual = Math.max(fromMonthly, fromSpend);
      if (actual > 0) {
        fyActualByProject.set(id, actual);
        totalFyActual += actual;
      }
    }

    // 7. Aggregate monthly data by cost category
    const catTotals = new Map<string, Map<string, { budget: number; actual: number; forecast: number }>>();
    const catOrder  : string[] = [];
    const catSeen   = new Set<string>();
    let projectsWithPlan = 0;

    for (const id of projectIds) {
      const artifact = artifactByProject.get(id);
      if (!artifact?.content_json) continue;
      const cj      = artifact.content_json;
      const lines   = (Array.isArray(cj.cost_lines) ? cj.cost_lines : Array.isArray(cj.lines) ? cj.lines : []) as any[];
      const monthly = (cj.monthly_data ?? cj.monthlyData ?? {}) as Record<string, Record<string, any>>;
      if (!lines.length && !Object.keys(monthly).length) continue;
      projectsWithPlan++;

      for (const line of lines) {
        const lineId  = safeStr(line.id);
        const raw     = safeStr(line.description || "").trim();
        const display = raw || safeStr(line.category || "Uncategorised").trim() || "Uncategorised";
        const catKey  = display.toLowerCase();
        if (!catSeen.has(catKey)) { catSeen.add(catKey); catOrder.push(display); }
        for (const [mk, entry] of Object.entries(monthly[lineId] ?? {})) {
          if (!monthSet.has(mk)) continue;
          const e = entry as any;
          if (!catTotals.has(catKey)) catTotals.set(catKey, new Map());
          const m  = catTotals.get(catKey)!;
          const ex = m.get(mk) ?? { budget: 0, actual: 0, forecast: 0 };
          m.set(mk, {
            budget:   ex.budget   + safeNum(e?.budget   ?? e?.budgetAmount   ?? 0),
            actual:   ex.actual   + safeNum(e?.actual   ?? e?.actualAmount   ?? 0),
            forecast: ex.forecast + safeNum(e?.forecast ?? e?.forecastAmount ?? 0),
          });
        }
      }
    }

    // 8. Build output in FinancialPlanMonthlyView-compatible shape
    const aggregatedLines: { id: string; category: string; description: string }[] = [];
    const monthlyData: Record<string, Record<string, { budget: number|""; actual: number|""; forecast: number|""; locked: boolean }>> = {};

    for (const display of catOrder) {
      const catKey = display.toLowerCase();
      const catMap = catTotals.get(catKey);
      if (!catMap) continue;
      const id = `portfolio-${catKey.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      aggregatedLines.push({ id, category: display, description: display });
      const lineMonthly: Record<string, { budget: number|""; actual: number|""; forecast: number|""; locked: boolean }> = {};
      for (const mk of monthKeys) {
        const e = catMap.get(mk);
        lineMonthly[mk] = { budget: e?.budget||"", actual: e?.actual||"", forecast: e?.forecast||"", locked: mk < nowKey };
      }
      monthlyData[id] = lineMonthly;
    }

    // Calculate total approved budget — only for projects that have phasing data in this FY
    // A project "exists" in this FY if it has at least one non-zero monthly entry in monthKeys
    const projectsInFy = new Set<string>();
    for (const id of projectIds) {
      const artifact = artifactByProject.get(id);
      if (!artifact?.content_json) continue;
      const cj      = artifact.content_json;
      const lines   = (Array.isArray(cj.cost_lines) ? cj.cost_lines : Array.isArray(cj.lines) ? cj.lines : []) as any[];
      const monthly = (cj.monthly_data ?? cj.monthlyData ?? {}) as Record<string, Record<string, any>>;
      let hasDataInFy = false;
      for (const line of lines) {
        const lineData = monthly[safeStr(line.id)] ?? {};
        for (const mk of monthKeys) {
          const e = lineData[mk];
          if (!e) continue;
          const hasSomething = safeNum(e?.budget) > 0 || safeNum(e?.forecast) > 0 || safeNum(e?.actual) > 0;
          if (hasSomething) { hasDataInFy = true; break; }
        }
        if (hasDataInFy) break;
      }
      if (hasDataInFy) projectsInFy.add(id);
    }

    let totalApprovedBudget = 0;
    const approvedBudgetByProject: Record<string, number> = {};
    for (const id of projectsInFy) {
      // Only count budget for projects active in this FY
      const artifact = artifactByProject.get(id);
      const cj = artifact?.content_json;
      const approved = safeNum(cj?.total_approved_budget ?? 0);
      if (approved > 0) {
        approvedBudgetByProject[id] = approved;
        totalApprovedBudget += approved;
      } else {
        const proj = allProjects.find((p: any) => safeStr(p.id) === id);
        const fallback = safeNum(proj?.budget_amount ?? 0);
        if (fallback > 0) {
          approvedBudgetByProject[id] = fallback;
          totalApprovedBudget += fallback;
        }
      }
    }

    // Enrich allProjects with FY-scoped actual for the project rows
    const enrichedProjectsWithActual = enrichedProjects.map((p: any) => ({
      ...p,
      fyActual: fyActualByProject.get(p.id) ?? 0,
    }));

    return NextResponse.json({
      ok: true, fyStart, fyYear, numMonths, monthKeys,
      aggregatedLines, monthlyData,
      projectCount: allProjects.length,
      projectsWithPlan,
      projectsInFyCount: projectsInFy.size,
      filteredProjectCount: projectIds.length,
      scope,
      allProjects: enrichedProjectsWithActual,
      totalApprovedBudget,
      approvedBudgetByProject,
      totalFyActual,
      fyActualByProject: Object.fromEntries(fyActualByProject),
    });
  } catch (e: any) {
    console.error("[portfolio/budget-phasing]", e);
    return err(String(e?.message ?? "Unknown error"), 500);
  }
}