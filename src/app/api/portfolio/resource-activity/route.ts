// src/app/api/portfolio/resource-activity/route.ts — REBUILT v3 (Org view + filter-ready)
// Adds:
//   ✅ RA-F1: Scope aligned with resolveActiveProjectScope (permission-safe)
//   ✅ RA-F2: Supports filters (GET + POST)
//   ✅ RA-F3: Allocation filtering by project_id if available; graceful fallback if not
// Keeps:
//   • forward-looking week ranges
//   ✅ no-store caching

import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

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

function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v = safeStr(pc.project_code) || safeStr(pc.code) || safeStr(pc.value) || safeStr(pc.id);
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

function getMondayOf(date: Date): Date {
  const d = new Date(date);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1));
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
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

// Filter projects *within* user scope, best-effort even if optional columns don't exist.
async function applyProjectFilters(supabase: any, scopedProjectIds: string[], filters: PortfolioFilters) {
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
  return { projectIds: outIds, meta };
}

/* ---------------- handler ---------------- */

async function handle(req: NextRequest, opts: { days: number; filters: PortfolioFilters }) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();

  const user = auth?.user ?? null;
  if (authErr || !user) {
    const res = NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  const days = Math.min(90, Math.max(7, Number.isFinite(opts.days) ? opts.days : 30));

  // Week range: start from this week, forward by `days`
  const today = new Date();
  const startMonday = getMondayOf(today);
  const endMonday = getMondayOf(addDays(today, days - 1));

  const weeks: string[] = [];
  let cur = new Date(startMonday);
  while (isoDate(cur) <= isoDate(endMonday) && weeks.length < 20) {
    weeks.push(isoDate(cur));
    cur = addDays(cur, 7);
  }

  const dateFrom = weeks[0] || isoDate(startMonday);
  const dateTo = weeks[weeks.length - 1] || isoDate(endMonday);

  // ── permission-safe project scope
  const scoped = await resolveActiveProjectScope(supabase, user.id);
  const scopedProjectIds: string[] = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

  // Apply dashboard filters (within scope)
  const filtered = await applyProjectFilters(supabase, scopedProjectIds, opts.filters);
  const projectIds = filtered.projectIds;

  // ── Org members (capacity is org-wide)
  const { data: memRow } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();

  const orgId = memRow?.organisation_id;
  if (!orgId) {
    const res = NextResponse.json({ ok: false, error: "No org" }, { status: 400 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  const { data: members } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", orgId)
    .is("removed_at", null);

  const memberUserIds = (members ?? []).map((m: any) => String(m.user_id)).filter(Boolean);
  if (!memberUserIds.length) {
    const res = NextResponse.json({
      ok: true,
      weeks: [],
      dateFrom,
      dateTo,
      meta: { scope: scoped?.meta ?? null, filters: filtered.meta },
    });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }

  // ── Profiles (default capacity)
  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, default_capacity_days, is_active")
    .in("user_id", memberUserIds);

  const activePeople = (profiles ?? []).filter((p: any) => p.is_active !== false);
  const defaultCap = new Map<string, number>();
  for (const p of activePeople) {
    defaultCap.set(String(p.user_id), parseFloat(String(p.default_capacity_days ?? 5)));
  }

  // ── Capacity exceptions
  const { data: exceptions } = await supabase
    .from("capacity_exceptions")
    .select("person_id, week_start_date, available_days")
    .in("person_id", memberUserIds)
    .gte("week_start_date", dateFrom)
    .lte("week_start_date", dateTo);

  const exMap = new Map<string, Map<string, number>>();
  for (const ex of exceptions ?? []) {
    const pid = String(ex.person_id);
    if (!exMap.has(pid)) exMap.set(pid, new Map());
    exMap.get(pid)!.set(String(ex.week_start_date), parseFloat(String(ex.available_days)));
  }

  // ── Allocations (filter by project_id if available)
  let allocs: any[] = [];
  const allocMeta: any = { projectFiltering: false, note: null as string | null };

  if (weeks.length) {
    const withProjectId = await supabase
      .from("allocations")
      .select("person_id, project_id, week_start_date, days_allocated, allocation_type")
      .in("person_id", memberUserIds)
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo);

    if (!withProjectId.error && Array.isArray(withProjectId.data)) {
      let rows = withProjectId.data;

      if (projectIds.length) {
        const allow = new Set(projectIds);
        const filteringActive = hasAnyFilters(opts.filters);

        rows = rows.filter((r: any) => {
          const pid = safeStr(r?.project_id).trim();
          if (!pid) return !filteringActive; // keep unlinked only when not actively filtering
          return allow.has(pid);
        });

        allocMeta.projectFiltering = true;
      }

      allocs = rows;
    } else {
      if (looksMissingColumn(withProjectId.error) || looksMissingRelation(withProjectId.error)) {
        const fallback = await supabase
          .from("allocations")
          .select("person_id, week_start_date, days_allocated, allocation_type")
          .in("person_id", memberUserIds)
          .gte("week_start_date", dateFrom)
          .lte("week_start_date", dateTo);

        allocs = Array.isArray(fallback.data) ? fallback.data : [];
        allocMeta.note =
          "allocations.project_id not available; returned org-wide allocations (filters cannot constrain allocations).";
      } else {
        allocs = [];
        allocMeta.note = safeStr(withProjectId.error?.message || "Allocation query failed");
      }
    }
  }

  // Map: weekStart → { confirmed, soft }
  const weekAllocMap = new Map<string, { confirmed: number; soft: number }>();
  for (const w of weeks) weekAllocMap.set(w, { confirmed: 0, soft: 0 });

  for (const a of allocs ?? []) {
    const w = String(a.week_start_date);
    if (!weekAllocMap.has(w)) continue;
    const days2 = parseFloat(String(a.days_allocated ?? 0));
    const type = String(a.allocation_type ?? "confirmed").toLowerCase();
    const entry = weekAllocMap.get(w)!;
    if (type === "soft" || type === "pipeline") entry.soft += days2;
    else entry.confirmed += days2;
  }

  const result = weeks.map((w) => {
    let totalCap = 0;
    for (const [pid, cap] of defaultCap) {
      const override = exMap.get(pid)?.get(w);
      totalCap += override !== undefined ? override : cap;
    }

    const { confirmed, soft } = weekAllocMap.get(w) ?? { confirmed: 0, soft: 0 };
    const utilisationPct = totalCap > 0 ? Math.round((confirmed / totalCap) * 100) : 0;

    return {
      weekStart: w,
      capacity: Math.round(totalCap * 10) / 10,
      allocated: Math.round(confirmed * 10) / 10,
      pipeline: Math.round(soft * 10) / 10,
      utilisationPct,
    };
  });

  const res = NextResponse.json({
    ok: true,
    weeks: result,
    dateFrom,
    dateTo,
    meta: {
      scope: scoped?.meta ?? null,
      filters: filtered.meta,
      projects: { scoped: scopedProjectIds.length, filtered: projectIds.length },
      allocations: allocMeta,
    },
  });

  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

/* ---------------- routes ---------------- */

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const days = parseInt(url.searchParams.get("days") ?? "30", 10);
    const filters = parseFiltersFromUrl(url);
    return await handle(req, { days, filters });
  } catch (e: any) {
    console.error("[resource-activity][GET]", e);
    const res = NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = parseInt(String(body?.days ?? body?.windowDays ?? 30), 10);
    const filters = parseFiltersFromBody(body);
    return await handle(req, { days, filters });
  } catch (e: any) {
    console.error("[resource-activity][POST]", e);
    const res = NextResponse.json({ ok: false, error: safeStr(e?.message || e) }, { status: 500 });
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}