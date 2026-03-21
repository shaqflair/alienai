// src/app/api/artifacts/financial-plan/resource-plan-sync/route.ts
// GET  ?artifactId=xxx&projectId=xxx  → returns grouped allocation preview
// POST ?artifactId=xxx&projectId=xxx  → writes the forecast into the financial plan artifact

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  computeResourcePlanForecast,
  findOrCreatePeopleCostLine,
  formatMonthlySummary,
} from "@/lib/financial/resource-plan-to-financial";
import type { FYConfig, MonthlyData } from "@/components/artifacts/FinancialPlanMonthlyView";
import type { FinancialPlanContent } from "@/components/artifacts/FinancialPlanEditor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function noStore(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

async function requireAuth(supabase: any) {
  const { data: auth, error } = await supabase.auth.getUser();
  if (error || !auth?.user) throw new Error("Unauthorized");
  return auth.user;
}

async function requireProjectAccess(supabase: any, projectId: string, userId: string) {
  const { data: proj } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!proj) throw new Error("Project not found");

  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", proj.organisation_id)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (!mem) {
    const { data: pmem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();
    if (!pmem) throw new Error("Forbidden");
    const role = safeStr(pmem.role).toLowerCase();
    return { organisation_id: proj.organisation_id, isAdmin: role === "owner" || role === "editor" };
  }

  const isAdmin = ["admin", "owner", "resource_manager"].includes(safeStr(mem.role).toLowerCase());
  return { organisation_id: proj.organisation_id, isAdmin };
}

/* ─────────────────────────────────────────────────────────────────────
   Person info: name + job title from profiles + organisation_members
───────────────────────────────────────────────────────────────────── */

type PersonInfo = {
  name:      string;
  jobTitle:  string;
  email:     string;
};

async function loadPersonInfo(
  supabase: any,
  orgId: string,
  personIds: string[]
): Promise<Map<string, PersonInfo>> {
  const map = new Map<string, PersonInfo>();
  if (!personIds.length) return map;

  // Profiles — for name and email
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, id, full_name, email")
    .or(`user_id.in.(${personIds.join(",")}),id.in.(${personIds.join(",")})`);

  const nameByUserId = new Map<string, { name: string; email: string }>();
  for (const p of (profiles ?? []) as any[]) {
    const uid   = safeStr(p.user_id).trim() || safeStr(p.id).trim();
    const name  = safeStr(p.full_name).trim();
    const email = safeStr(p.email).trim();
    if (uid) nameByUserId.set(uid, { name: name || email, email });
  }

  // Organisation members — for job_title
  const { data: orgMembers } = await supabase
    .from("organisation_members")
    .select("user_id, job_title, role")
    .eq("organisation_id", orgId)
    .in("user_id", personIds)
    .is("removed_at", null);

  const jobTitleByUserId = new Map<string, string>();
  for (const m of (orgMembers ?? []) as any[]) {
    const uid = safeStr(m.user_id).trim();
    const jt  = safeStr(m.job_title ?? m.role ?? "").trim();
    if (uid && jt) jobTitleByUserId.set(uid, jt);
  }

  for (const uid of personIds) {
    const profile  = nameByUserId.get(uid);
    const jobTitle = jobTitleByUserId.get(uid) ?? "";
    map.set(uid, {
      name:     profile?.name      ?? uid,
      email:    profile?.email     ?? "",
      jobTitle,
    });
  }

  return map;
}

/* ─────────────────────────────────────────────────────────────────────
   Rate card: personal rate first, then job title match, then role match
───────────────────────────────────────────────────────────────────── */

async function loadRates(
  supabase: any,
  orgId: string,
  personIds: string[],
  jobTitles: string[]
): Promise<{ personalRates: Map<string, number>; roleRates: Map<string, number> }> {
  const personalRates = new Map<string, number>();
  const roleRates     = new Map<string, number>();

  // Try view first, then table
  for (const tableName of ["v_resource_rates_latest", "resource_rates"]) {
    const { data, error } = await supabase
      .from(tableName)
      .select("user_id, role_label, rate, rate_type")
      .eq("organisation_id", orgId)
      .eq("rate_type", "day_rate");

    if (error) continue;

    for (const r of (data ?? []) as any[]) {
      const rate = Number(r.rate ?? r.day_rate ?? 0);
      if (!rate) continue;

      // Personal rate (matched by user_id)
      const uid = safeStr(r.user_id ?? "").trim();
      if (uid && personIds.includes(uid) && !personalRates.has(uid)) {
        personalRates.set(uid, rate);
      }

      // Role/job title rate (matched by role_label)
      const label = safeStr(r.role_label ?? r.role_title ?? "").trim().toLowerCase();
      if (label && !roleRates.has(label)) {
        roleRates.set(label, rate);
      }
    }

    // If we got data, don't try the other table
    if ((data ?? []).length > 0) break;
  }

  return { personalRates, roleRates };
}

/* ─────────────────────────────────────────────────────────────────────
   Group allocations weekly rows → one entry per person
   allocations schema:
     person_id, project_id, week_start_date, days_allocated, role_on_project
───────────────────────────────────────────────────────────────────── */

type PersonAllocation = {
  id:        string;   // person_id (stable key)
  person_id: string;
  name:      string;
  jobTitle:  string;
  // Weekly entries: each is a span of Mon–Sun with N days allocated
  weeks: Array<{ week_start: string; week_end: string; days: number }>;
  // Resolved rate
  day_rate:    number | null;
  rate_source: "personal" | "role" | null;
  role_title:  string;
};

function groupAllocationsByPerson(
  rows: any[],
  personInfoMap: Map<string, PersonInfo>
): PersonAllocation[] {
  const byPerson = new Map<string, PersonAllocation>();

  for (const row of rows) {
    const personId  = safeStr(row.person_id ?? row.user_id ?? "").trim();
    if (!personId) continue;

    const days = Number(row.days_allocated ?? 0);
    if (days <= 0) continue;

    const weekStart = safeStr(row.week_start_date ?? row.start_date ?? "").trim();
    if (!weekStart) continue;

    let weekEnd = "";
    try {
      const d = new Date(weekStart + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() + 6);
      weekEnd = d.toISOString().slice(0, 10);
    } catch { continue; }

    if (!byPerson.has(personId)) {
      const info = personInfoMap.get(personId);
      byPerson.set(personId, {
        id:        personId,
        person_id: personId,
        name:      info?.name      ?? personId,
        jobTitle:  info?.jobTitle  ?? "",
        weeks:     [],
        day_rate:     null,
        rate_source:  null,
        role_title:   safeStr(row.role_on_project ?? info?.jobTitle ?? "Team Member"),
      });
    }

    byPerson.get(personId)!.weeks.push({ week_start: weekStart, week_end: weekEnd, days });
  }

  return Array.from(byPerson.values());
}

/* ─────────────────────────────────────────────────────────────────────
   Convert grouped PersonAllocation[] → the shape computeResourcePlanForecast expects.
   Each week becomes its own allocation entry spanning Mon–Sun.
───────────────────────────────────────────────────────────────────── */

function toForecastAllocations(grouped: PersonAllocation[]): any[] {
  const out: any[] = [];
  for (const person of grouped) {
    for (const week of person.weeks) {
      out.push({
        id:                     `${person.person_id}::${week.week_start}`,
        person_id:              person.person_id,
        person_name:            person.name,
        role_title:             person.role_title,
        seniority_level:        null,
        required_days_per_week: week.days,   // already actual days for this week
        start_date:             week.week_start,
        end_date:               week.week_end,
        day_rate:               person.day_rate,
        rate_source:            person.rate_source,
      });
    }
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────
   Load + resolve everything
───────────────────────────────────────────────────────────────────── */

async function buildGroupedAllocations(
  supabase: any,
  projectId: string,
  orgId: string
) {
  // 1. Raw allocation rows
  const { data: rawRows, error } = await supabase
    .from("allocations")
    .select("person_id, project_id, week_start_date, days_allocated, role_on_project")
    .eq("project_id", projectId);

  if (error) throw new Error(error.message);
  const rows = (rawRows ?? []) as any[];

  if (!rows.length) {
    return { grouped: [] as PersonAllocation[], source: "allocations" as const };
  }

  // 2. Unique person IDs
  const personIds = Array.from(new Set(
    rows.map((r: any) => safeStr(r.person_id ?? "").trim()).filter(Boolean)
  ));

  // 3. Person info (name + job title)
  const personInfoMap = await loadPersonInfo(supabase, orgId, personIds);

  // 4. Group rows by person
  const grouped = groupAllocationsByPerson(rows, personInfoMap);

  // 5. Job titles for rate lookup
  const jobTitles = grouped.map(p => p.jobTitle.toLowerCase()).filter(Boolean);

  // 6. Rates
  const { personalRates, roleRates } = await loadRates(supabase, orgId, personIds, jobTitles);

  // 7. Apply rates to each person
  for (const person of grouped) {
    if (personalRates.has(person.person_id)) {
      person.day_rate    = personalRates.get(person.person_id)!;
      person.rate_source = "personal";
    } else {
      // Try job title match
      const jt = person.jobTitle.toLowerCase();
      if (jt && roleRates.has(jt)) {
        person.day_rate    = roleRates.get(jt)!;
        person.rate_source = "role";
      } else {
        // Partial match: find any role_label that contains the job title words
        for (const [label, rate] of roleRates.entries()) {
          if (jt && (label.includes(jt) || jt.includes(label))) {
            person.day_rate    = rate;
            person.rate_source = "role";
            break;
          }
        }
      }
    }
  }

  return { grouped, source: "allocations" as const };
}

async function loadFinancialPlanArtifact(supabase: any, artifactId: string): Promise<FinancialPlanContent | null> {
  const { data } = await supabase
    .from("artifacts")
    .select("content_json")
    .eq("id", artifactId)
    .maybeSingle();

  if (!data?.content_json) return null;
  const cj = typeof data.content_json === "string"
    ? JSON.parse(data.content_json)
    : data.content_json;
  return cj as FinancialPlanContent;
}

/* ── GET: preview ── */
export async function GET(req: Request) {
  try {
    const supabase   = await createClient();
    const user       = await requireAuth(supabase);
    const url        = new URL(req.url);
    const projectId  = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId) return noStore({ ok: false, error: "Missing projectId" }, 400);

    const { organisation_id, isAdmin } = await requireProjectAccess(supabase, projectId, user.id);
    const { grouped } = await buildGroupedAllocations(supabase, projectId, organisation_id);

    let fyConfig: FYConfig = { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };
    let existingMonthlyData: MonthlyData = {};
    let peopleCostLineId = "people-line-preview";
    let overriddenMonths: string[] = [];

    if (artifactId) {
      const fp = await loadFinancialPlanArtifact(supabase, artifactId);
      if (fp) {
        fyConfig = fp.fy_config ?? fyConfig;
        existingMonthlyData = fp.monthly_data ?? {};
        const { line } = findOrCreatePeopleCostLine(fp.cost_lines ?? []);
        peopleCostLineId = line.id;
        try {
          overriddenMonths = fp.resource_plan_overridden_months
            ? JSON.parse(fp.resource_plan_overridden_months) : [];
        } catch { overriddenMonths = []; }
      }
    }

    const forecastAllocations = toForecastAllocations(grouped);

    const forecast = computeResourcePlanForecast(
      forecastAllocations,
      peopleCostLineId,
      fyConfig,
      existingMonthlyData,
      new Set(overriddenMonths)
    );

    const missingRates = grouped
      .filter(p => p.day_rate == null)
      .map(p => ({ id: p.person_id, role_title: p.jobTitle || p.role_title, person_name: p.name }));

    const totalCost = Object.values(forecast.monthly_totals).reduce((s, t) => s + t.cost, 0);
    const currency  = artifactId
      ? ((await loadFinancialPlanArtifact(supabase, artifactId))?.currency ?? "GBP")
      : "GBP";

    return noStore({
      ok: true,
      isAdmin,
      source: "allocations",
      // Summary for the sync bar — shows people not weekly rows
      role_count:    grouped.length,
      rate_coverage: `${grouped.filter(p => p.day_rate != null).length}/${grouped.length}`,
      people: grouped.map(p => ({
        person_id:   p.person_id,
        name:        p.name,
        job_title:   p.jobTitle,
        role_title:  p.role_title,
        day_rate:    p.day_rate,
        rate_source: p.rate_source,
        week_count:  p.weeks.length,
        total_days:  p.weeks.reduce((s, w) => s + w.days, 0),
      })),
      forecast: {
        monthly_totals:  forecast.monthly_totals,
        missing_rates:   missingRates,
        summary:         formatMonthlySummary(forecast.monthly_totals, currency),
        months_affected: Object.keys(forecast.monthly_totals).filter(mk => forecast.monthly_totals[mk].cost > 0).length,
        total_cost:      totalCost,
      },
      overridden_months: overriddenMonths,
    });
  } catch (e: any) {
    return noStore({ ok: false, error: e.message ?? "Server error" }, e.message === "Unauthorized" ? 401 : 500);
  }
}

/* ── POST: apply sync ── */
export async function POST(req: Request) {
  try {
    const supabase   = await createClient();
    const user       = await requireAuth(supabase);
    const url        = new URL(req.url);
    const projectId  = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId || !artifactId) return noStore({ ok: false, error: "Missing projectId or artifactId" }, 400);

    const { organisation_id, isAdmin } = await requireProjectAccess(supabase, projectId, user.id);

    const body             = await req.json().catch(() => ({}));
    const overriddenMonths: string[] = Array.isArray(body?.overridden_months) ? body.overridden_months : [];

    const { grouped } = await buildGroupedAllocations(supabase, projectId, organisation_id);

    const fp = await loadFinancialPlanArtifact(supabase, artifactId);
    if (!fp) return noStore({ ok: false, error: "Financial plan artifact not found" }, 404);

    const fyConfig = fp.fy_config ?? { fy_start_month: 4, fy_start_year: new Date().getFullYear(), num_months: 12 };

    const { line: peopleLine, isNew } = findOrCreatePeopleCostLine(fp.cost_lines ?? []);
    const newCostLines = isNew ? [...(fp.cost_lines ?? []), peopleLine] : fp.cost_lines;

    const forecastAllocations = toForecastAllocations(grouped);

    const forecast = computeResourcePlanForecast(
      forecastAllocations,
      peopleLine.id,
      fyConfig,
      fp.monthly_data ?? {},
      new Set(overriddenMonths)
    );

    const totalForecast = Object.values(forecast.monthly_totals).reduce((s, t) => s + t.cost, 0);

    const updatedCostLines = newCostLines.map((l: any) =>
      l.id === peopleLine.id
        ? {
            ...l,
            forecast: totalForecast,
            budgeted: l.override ? l.budgeted : (l.budgeted === "" ? totalForecast : l.budgeted),
          }
        : l
    );

    const updatedContent: FinancialPlanContent = {
      ...fp,
      cost_lines:   updatedCostLines,
      monthly_data: forecast.monthly_data_patch,
      last_updated_at:                  new Date().toISOString(),
      resource_plan_synced_at:          new Date().toISOString(),
      resource_plan_overridden_months:  JSON.stringify(overriddenMonths),
    };

    const { error: writeErr } = await supabase
      .from("artifacts")
      .update({ content_json: updatedContent, updated_at: new Date().toISOString() })
      .eq("id", artifactId);

    if (writeErr) throw new Error(writeErr.message);

    const missingRates = grouped.filter(p => p.day_rate == null);

    return noStore({
      ok: true,
      isAdmin,
      people_count:      grouped.length,
      months_updated:    Object.keys(forecast.monthly_totals).filter(mk => forecast.monthly_totals[mk].cost > 0).length,
      total_forecast:    totalForecast,
      missing_rates:     missingRates.length,
      overridden_months: overriddenMonths,
      summary:           formatMonthlySummary(forecast.monthly_totals, fp.currency ?? "GBP"),
    });
  } catch (e: any) {
    return noStore({ ok: false, error: e.message ?? "Server error" }, e.message === "Unauthorized" ? 401 : 500);
  }
}