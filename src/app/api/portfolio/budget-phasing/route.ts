// src/app/api/portfolio/budget-phasing/route.ts
// GET ?fyStart=4&fyYear=2026&fyMonths=12&scope=active|all&projectIds=id1,id2

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

function displayName(profile: any): string {
  const full    = safeStr(profile?.full_name).trim();
  const display = safeStr(profile?.display_name).trim();
  const name    = safeStr(profile?.name).trim();
  const email   = safeStr(profile?.email).trim();
  if (full && !full.includes("@")) return full;
  if (display && !display.includes("@")) return display;
  if (name && !name.includes("@")) return name;
  // Fall back to email but shorten to just the local part if it's clearly an email
  if (email.includes("@")) return email.split("@")[0];
  return email || "Unknown";
}

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

    // 2. All projects — include department
    let projQ = supabase
      .from("projects")
      .select("id, title, project_code, project_manager_id, department")
      .eq("organisation_id", orgId)
      .neq("resource_status", "pipeline");
    if (scope === "active") projQ = projQ.is("deleted_at", null);

    const { data: projectRows } = await projQ.order("title");
    const allProjects = (projectRows ?? []) as any[];

    const empty = { ok: true, fyStart, fyYear, numMonths, monthKeys, aggregatedLines: [], monthlyData: {}, projectCount: 0, projectsWithPlan: 0, allProjects: [], filteredProjectCount: 0 };
    if (!allProjects.length) return NextResponse.json(empty);

    // 3. PM names — match on both id and user_id columns
    const pmIds = [...new Set(allProjects.map((p: any) => safeStr(p.project_manager_id)).filter(Boolean))];
    const pmNameById = new Map<string, string>();

    if (pmIds.length) {
      const orFilter = pmIds.flatMap(id => [`id.eq.${id}`, `user_id.eq.${id}`]).join(",");
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, display_name, name, email")
        .or(orFilter);

      for (const p of (profiles ?? []) as any[]) {
        const nm = displayName(p);
        if (p.id)      pmNameById.set(safeStr(p.id),      nm);
        if (p.user_id) pmNameById.set(safeStr(p.user_id), nm);
      }
    }

    // Enriched project list for filter panel — include department
    const enrichedProjects = allProjects.map((p: any) => ({
      id:          safeStr(p.id),
      title:       safeStr(p.title) || "Untitled",
      projectCode: safeStr(p.project_code),
      department:  safeStr(p.department).trim() || "",
      pmName:      pmNameById.get(safeStr(p.project_manager_id)) ?? "",
    }));

    // 4. Which projects to aggregate
    const allIds     = allProjects.map((p: any) => safeStr(p.id));
    const projectIds = filterIds.length ? allIds.filter((id: string) => filterIds.includes(id)) : allIds;

    if (!projectIds.length) {
      return NextResponse.json({ ...empty, projectCount: allProjects.length, allProjects: enrichedProjects });
    }

    // 5. Financial plans — no is_current filter, prefer approved
    const { data: artifactRows } = await supabase
      .from("artifacts")
      .select("id, project_id, content_json, approval_status, type")
      .in("project_id", projectIds)
      .ilike("type", "%financial%plan%");

    const artifactByProject = new Map<string, any>();
    for (const a of (artifactRows ?? []) as any[]) {
      const pid = safeStr(a.project_id);
      const existing = artifactByProject.get(pid);
      // Prefer: approved > submitted > draft; and newer updated_at
      if (!existing) { artifactByProject.set(pid, a); continue; }
      const rank = (s: string) => s === "approved" ? 3 : s === "submitted" ? 2 : 1;
      if (rank(a.approval_status) > rank(existing.approval_status)) artifactByProject.set(pid, a);
    }

    // 6. Aggregate by category
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
        for (const [mk, raw2] of Object.entries(monthly[lineId] ?? {})) {
          if (!monthSet.has(mk)) continue;
          const entry = raw2 as any;
          if (!catTotals.has(catKey)) catTotals.set(catKey, new Map());
          const m  = catTotals.get(catKey)!;
          const ex = m.get(mk) ?? { budget: 0, actual: 0, forecast: 0 };
          m.set(mk, {
            budget:   ex.budget   + safeNum(entry?.budget   ?? entry?.budgetAmount   ?? 0),
            actual:   ex.actual   + safeNum(entry?.actual   ?? entry?.actualAmount   ?? 0),
            forecast: ex.forecast + safeNum(entry?.forecast ?? entry?.forecastAmount ?? 0),
          });
        }
      }
    }

    // 7. Build output
    const aggregatedLines: { id: string; category: string; description: string }[] = [];
    const monthlyData: Record<string, Record<string, { budget: number | ""; actual: number | ""; forecast: number | ""; locked: boolean }>> = {};

    for (const display of catOrder) {
      const catKey = display.toLowerCase();
      const catMap = catTotals.get(catKey);
      if (!catMap) continue;
      const id = `portfolio-${catKey.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
      aggregatedLines.push({ id, category: display, description: display });
      const lineMonthly: Record<string, { budget: number | ""; actual: number | ""; forecast: number | ""; locked: boolean }> = {};
      for (const mk of monthKeys) {
        const e = catMap.get(mk);
        lineMonthly[mk] = { budget: e?.budget || "", actual: e?.actual || "", forecast: e?.forecast || "", locked: mk < nowKey };
      }
      monthlyData[id] = lineMonthly;
    }

    return NextResponse.json({
      ok: true, fyStart, fyYear, numMonths, monthKeys,
      aggregatedLines, monthlyData,
      projectCount: allProjects.length, projectsWithPlan,
      filteredProjectCount: projectIds.length, scope,
      allProjects: enrichedProjects,
    });
  } catch (e: any) {
    console.error("[portfolio/budget-phasing]", e);
    return err(String(e?.message ?? "Unknown error"), 500);
  }
}