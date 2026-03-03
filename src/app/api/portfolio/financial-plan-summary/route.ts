// src/app/api/portfolio/financial-plan-summary/route.ts — REBUILT v3 (scope-safe + filter-ready)
// Used by: What-if Simulator (portfolio-level financial impact)
//
// Fixes / Adds:
//   ✅ FPS-F1: Permission-safe scoping via resolveActiveProjectScope (org/project membership aware)
//   ✅ FPS-F2: Supports dashboard filters (project name, code, PM, department)
//            - POST (recommended): { filters }
//            - GET (compat): ?name=...&code=...&pm=...&dept=...
//   ✅ FPS-F3: Graceful handling of artifact.content as JSON object or JSON string
//   ✅ FPS-F4: Cache-Control no-store everywhere

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- helpers ---------------- */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
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
    const v = safeStr(pc.project_code) || safeStr(pc.code) || safeStr(pc.value) || safeStr(pc.id);
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
  const name = uniqStrings(url.searchParams.getAll("name").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const code = uniqStrings(url.searchParams.getAll("code").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const pm = uniqStrings(url.searchParams.getAll("pm").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const dept = uniqStrings(url.searchParams.getAll("dept").flatMap((x) => x.split(",")).map((s) => s.trim()));

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
  const names = uniqStrings(f?.projectName ?? f?.projectNames ?? f?.name ?? f?.project_name);
  const codes = uniqStrings(f?.projectCode ?? f?.projectCodes ?? f?.code ?? f?.project_code);
  const pms = uniqStrings(f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id);
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

/** Filter projects within scope, best-effort even if optional columns don't exist. */
async function applyProjectFilters(supabase: any, scopedProjectIds: string[], filters: PortfolioFilters) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) return { projectIds: [], meta: { ...meta, applied: true } };
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
    const { data, error } = await supabase.from("projects").select(sel).in("id", scopedProjectIds).limit(10000);
    if (!error && Array.isArray(data)) {
      rows = data;
      lastErr = null;
      break;
    }
    lastErr = error;
    if (!looksMissingRelation(error)) break;
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
      if (!pm) return false;
      if (!pmSet.has(pm)) return false;
    }

    if (deptNeedles.length) {
      const dept = safeStr(p?.department).toLowerCase().trim();
      if (!dept) return false;
      if (!deptNeedles.some((d) => dept.includes(d))) return false;
    }

    return true;
  });

  const outIds = filtered.map((p) => String(p?.id || "").trim()).filter(Boolean);
  meta.applied = true;
  meta.counts = { before: scopedProjectIds.length, after: outIds.length };
  return { projectIds: outIds, meta, projectRows: rows };
}

/* ---------------- handler ---------------- */

async function handle(req: Request, filters: PortfolioFilters) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) return noStoreJson({ ok: false, error: "Unauthorized" }, 401);

  // 1) permission-safe scope
  const scoped = await resolveActiveProjectScope(supabase, user.id);
  const scopedProjectIds = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

  // 2) apply filters (within scope)
  const filtered = await applyProjectFilters(supabase, scopedProjectIds, filters);
  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    return noStoreJson({
      ok: true,
      portfolio: { totalBudget: 0, totalForecast: 0, totalActual: 0, projectCount: 0, withPlanCount: 0 },
      projects: [],
      meta: { scope: scoped?.meta ?? null, filters: filtered.meta },
    });
  }

  // 3) fetch project details (reuse already-read rows if available)
  let projects: any[] = [];
  if (Array.isArray((filtered as any).projectRows) && (filtered as any).projectRows.length) {
    const allow = new Set(projectIds);
    projects = (filtered as any).projectRows.filter((p: any) => allow.has(String(p?.id || "").trim()));
    projects.sort((a: any, b: any) => safeStr(a?.title).localeCompare(safeStr(b?.title)));
  } else {
    const { data: projRows, error: projErr } = await supabase
      .from("projects")
      .select("id, title, project_code, colour, start_date, finish_date, resource_status")
      .in("id", projectIds)
      .order("title", { ascending: true });

    if (projErr) return noStoreJson({ ok: false, error: projErr.message }, 500);
    projects = projRows ?? [];
  }

  // 4) fetch latest financial_plan artifact per project
  const { data: artifacts, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, content, updated_at")
    .in("project_id", projectIds)
    .eq("type", "financial_plan")
    .order("updated_at", { ascending: false })
    .limit(20000);

  if (artErr) return noStoreJson({ ok: false, error: artErr.message }, 500);

  const planByProject = new Map<string, any>();
  for (const artifact of artifacts ?? []) {
    const pid = String((artifact as any)?.project_id || "").trim();
    if (!pid) continue;
    if (!planByProject.has(pid)) planByProject.set(pid, artifact);
  }

  // 5) best-effort role lookup (won’t block if schema differs)
  let roleByProject = new Map<string, string>();
  try {
    const { data: memberships } = await supabase
      .from("project_members")
      .select("project_id, role, is_active, removed_at")
      .eq("user_id", user.id)
      .is("removed_at", null)
      .in("project_id", projectIds)
      .limit(20000);

    for (const m of memberships ?? []) {
      const pid = String((m as any)?.project_id || "").trim();
      if (!pid || roleByProject.has(pid)) continue;
      roleByProject.set(pid, safeStr((m as any)?.role).trim() || "viewer");
    }
  } catch {
    roleByProject = new Map();
  }

  // 6) Aggregate summaries per project
  const summaries = (projects ?? []).map((project: any) => {
    const pid = String(project?.id || "").trim();
    const artifact = planByProject.get(pid);
    const content = safeJson(artifact?.content);

    let totalBudget = 0;
    let totalForecast = 0;
    let totalActual = 0;
    let hasFinancialPlan = false;

    if (content?.costLines && Array.isArray(content.costLines)) {
      hasFinancialPlan = true;
      for (const line of content.costLines) {
        totalBudget += num((line as any)?.budget, 0);
        totalForecast += num((line as any)?.forecast, 0);
        totalActual += num((line as any)?.actual, 0);
      }
    }

    const monthlyData = content?.monthlyData ?? {};
    const monthlyBreakdown: Record<string, { budget: number; forecast: number; actual: number }> = {};

    try {
      for (const [, months] of Object.entries(monthlyData) as any) {
        for (const [monthKey, vals] of Object.entries(months as any)) {
          const v = vals as any;
          if (!monthlyBreakdown[monthKey]) monthlyBreakdown[monthKey] = { budget: 0, forecast: 0, actual: 0 };
          monthlyBreakdown[monthKey].budget += num(v?.budget, 0);
          monthlyBreakdown[monthKey].forecast += num(v?.forecast, 0);
          monthlyBreakdown[monthKey].actual += num(v?.actual, 0);
        }
      }
    } catch {
      // ignore malformed monthlyData
    }

    const role = roleByProject.get(pid) || "viewer";

    return {
      projectId: pid,
      projectCode: project?.project_code ?? null,
      projectCodeLabel: projectCodeLabel(project?.project_code) || null,
      title: project?.title ?? "Project",
      colour: project?.colour ?? "#00b8db",
      status: project?.resource_status ?? "confirmed",
      startDate: project?.start_date ?? null,
      finishDate: project?.finish_date ?? null,
      role,
      hasFinancialPlan,
      artifactId: artifact?.id ?? null,
      lastUpdated: artifact?.updated_at ?? null,
      totals: {
        budget: totalBudget,
        forecast: totalForecast,
        actual: totalActual,
        variance: totalForecast - totalBudget,
        burnPct: totalBudget > 0 ? Math.round((totalActual / totalBudget) * 100) : 0,
      },
      monthlyBreakdown,
    };
  });

  const portfolio = {
    totalBudget: summaries.reduce((s: number, p: any) => s + num(p?.totals?.budget, 0), 0),
    totalForecast: summaries.reduce((s: number, p: any) => s + num(p?.totals?.forecast, 0), 0),
    totalActual: summaries.reduce((s: number, p: any) => s + num(p?.totals?.actual, 0), 0),
    projectCount: summaries.length,
    withPlanCount: summaries.filter((p: any) => p.hasFinancialPlan).length,
  };

  return noStoreJson({
    ok: true,
    portfolio,
    projects: summaries,
    meta: { scope: scoped?.meta ?? null, filters: filtered.meta },
  });
}

/* ---------------- routes ---------------- */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const filters = parseFiltersFromUrl(url);
    return await handle(req, filters);
  } catch (e: any) {
    console.error("[financial-plan-summary][GET]", e);
    return noStoreJson({ ok: false, error: safeStr(e?.message || e) }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const filters = parseFiltersFromBody(body);
    return await handle(req, filters);
  } catch (e: any) {
    console.error("[financial-plan-summary][POST]", e);
    return noStoreJson({ ok: false, error: safeStr(e?.message || e) }, 500);
  }
}