import "server-only";

import { createClient } from "@/utils/supabase/server";
import { filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export type PortfolioResourceActivityFilters = {
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

export type PortfolioResourceActivityPayload = {
  ok: true;
  weeks: Array<{
    weekStart: string;
    capacity: number;
    allocated: number;
    pipeline: number;
    utilisationPct: number;
  }>;
  dateFrom: string;
  dateTo: string;
  meta: {
    organisationId: string | null;
    note?: string;
    scope: any;
    filters: any;
    projects?: {
      scoped: number;
      active: number;
      filtered: number;
    };
    allocations?: {
      projectFiltering: boolean;
      note: string | null;
    };
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

function hasAnyFilters(f: PortfolioResourceActivityFilters) {
  return (
    (f.projectName && f.projectName.length) ||
    (f.projectCode && f.projectCode.length) ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department && f.department.length)
  );
}

export function parseResourceActivityFiltersFromUrl(
  url: URL,
): PortfolioResourceActivityFilters {
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

  const out: PortfolioResourceActivityFilters = {};
  if (name.length) out.projectName = name;
  if (code.length) out.projectCode = code;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}

export function parseResourceActivityFiltersFromBody(
  body: any,
): PortfolioResourceActivityFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioResourceActivityFilters = {};
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

async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioResourceActivityFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) {
    return { projectIds: [], meta: { ...meta, applied: true } };
  }
  if (!hasAnyFilters(filters)) {
    return { projectIds: scopedProjectIds, meta };
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

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  const failOpen = (reason: string) => ({
    ids: rawIds,
    ok: false,
    error: reason,
  });

 // ✅ Resource activity intentionally includes pipeline projects —
  // pipeline capacity planning is a valid use case for this chart.
  return { ids: rawIds.filter(Boolean), ok: true, error: null as string | null };
}

export async function loadResourceActivity(input: {
  userId: string;
  days?: unknown;
  filters?: PortfolioResourceActivityFilters;
  supabase?: Awaited<ReturnType<typeof createClient>>;
}): Promise<PortfolioResourceActivityPayload> {
  const supabase = input.supabase ?? (await createClient());
  const userId = input.userId;
  const days = Math.min(
    90,
    Math.max(7, Number.isFinite(Number(input.days)) ? Number(input.days) : 30),
  );
  const filters = input.filters ?? {};

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

  const sharedScope = await resolvePortfolioScope(supabase, userId);
  const orgId = sharedScope.organisationId ?? null;
  const scopeMeta = sharedScope.meta ?? {};
  const scopedProjectIdsRaw: string[] = Array.isArray(sharedScope.rawProjectIds)
    ? sharedScope.rawProjectIds
    : Array.isArray(sharedScope.projectIds)
      ? sharedScope.projectIds
      : [];

  const active = await normalizeActiveIds(supabase, scopedProjectIdsRaw);
  const scopedProjectIds = active.ids;

  const filtered = await applyProjectFilters(supabase, scopedProjectIds, filters);
  const projectIds = filtered.projectIds;

  if (!orgId) {
    return {
      ok: true,
      weeks: weeks.map((w) => ({
        weekStart: w,
        capacity: 0,
        allocated: 0,
        pipeline: 0,
        utilisationPct: 0,
      })),
      dateFrom,
      dateTo,
      meta: {
        note: "No active organisation resolved; returning empty capacity series.",
        organisationId: null,
        scope: {
          ...scopeMeta,
          scopedIdsRaw: scopedProjectIdsRaw.length,
          scopedIdsActive: scopedProjectIds.length,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
        filters: filtered.meta,
        projects: {
          scoped: scopedProjectIdsRaw.length,
          active: scopedProjectIds.length,
          filtered: projectIds.length,
        },
      },
    };
  }

  const { data: members } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", orgId)
    .is("removed_at", null);

  const memberUserIds = (members ?? []).map((m: any) => String(m.user_id)).filter(Boolean);

  if (!memberUserIds.length) {
    return {
      ok: true,
      weeks: [],
      dateFrom,
      dateTo,
      meta: {
        organisationId: orgId,
        scope: {
          ...scopeMeta,
          scopedIdsRaw: scopedProjectIdsRaw.length,
          scopedIdsActive: scopedProjectIds.length,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
        filters: filtered.meta,
      },
    };
  }

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, default_capacity_days, is_active")
    .in("user_id", memberUserIds);

  const activePeople = (profiles ?? []).filter((p: any) => p.is_active !== false);
  const defaultCap = new Map<string, number>();
  for (const p of activePeople) {
    defaultCap.set(String(p.user_id), parseFloat(String(p.default_capacity_days ?? 5)));
  }

  const { data: exceptions } = await supabase
    .from("capacity_exceptions")
    .select("person_id, week_start_date, available_days")
    .in("person_id", memberUserIds)
    .gte("week_start_date", dateFrom)
    .lte("week_start_date", dateTo);

  const exMap = new Map<string, Map<string, number>>();
  for (const ex of exceptions ?? []) {
    const pid = String((ex as any).person_id);
    if (!exMap.has(pid)) exMap.set(pid, new Map());
    exMap.get(pid)!.set(
      String((ex as any).week_start_date),
      parseFloat(String((ex as any).available_days)),
    );
  }

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
        const filteringActive = hasAnyFilters(filters);

        rows = rows.filter((r: any) => {
          const pid = safeStr(r?.project_id).trim();
          if (!pid) return !filteringActive;
          return allow.has(pid);
        });

        allocMeta.projectFiltering = true;
      }

      allocs = rows;
    } else {
      if (
        looksMissingColumn(withProjectId.error) ||
        looksMissingRelation(withProjectId.error)
      ) {
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

  const weekAllocMap = new Map<string, { confirmed: number; soft: number }>();
  for (const w of weeks) weekAllocMap.set(w, { confirmed: 0, soft: 0 });

  for (const a of allocs ?? []) {
    const w = String((a as any).week_start_date);
    if (!weekAllocMap.has(w)) continue;
    const daysAllocated = parseFloat(String((a as any).days_allocated ?? 0));
    const type = String((a as any).allocation_type ?? "confirmed").toLowerCase();
    const entry = weekAllocMap.get(w)!;
    if (type === "soft" || type === "pipeline") entry.soft += daysAllocated;
    else entry.confirmed += daysAllocated;
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

  return {
    ok: true,
    weeks: result,
    dateFrom,
    dateTo,
    meta: {
      organisationId: orgId,
      scope: {
        ...scopeMeta,
        scopedIdsRaw: scopedProjectIdsRaw.length,
        scopedIdsActive: scopedProjectIds.length,
        active_filter_ok: active.ok,
        active_filter_error: active.error,
      },
      filters: filtered.meta,
      projects: {
        scoped: scopedProjectIdsRaw.length,
        active: scopedProjectIds.length,
        filtered: projectIds.length,
      },
      allocations: allocMeta,
    },
  };
}
