// src/app/api/portfolio/milestones/panel/route.ts — REBUILT v2 (ORG-WIDE + filter-ready + active-only FAIL-OPEN)
// Adds / Fixes:
//   ✅ MP-F1: Supports dashboard filters (GET + POST): name/code/pm/dept
//   ✅ MP-F2: ORG-wide scope via resolveOrgActiveProjectScope (dashboard aligned)
//   ✅ MP-F3: Active-only project filtering via filterActiveProjectIds (FAIL-OPEN)
//   ✅ MP-F4: clampDays handles "all" → 60
//   ✅ MP-F5: Cache-Control no-store everywhere
// Keeps:
//   • Uses get_schedule_milestones_kpis_portfolio RPC
//
// Notes:
// - filterActiveProjectIds contract is normalized (supports either string[] OR { projectIds } return)

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";

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
    const v = safeStr(pc.project_code) || safeStr(pc.code) || safeStr(pc.value) || safeStr(pc.id);
    return v.trim();
  }
  return "";
}

function clampDays(x: any, fallback = 30): 7 | 14 | 30 | 60 {
  const s = String(x ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as any) : (fallback as any);
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

/** Filter projects within scope, best-effort even if optional columns don't exist. */
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
    const { data, error } = await supabase.from("projects").select(sel).in("id", scopedProjectIds).limit(20000);
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

/* ---------------- core ---------------- */

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  // Supports either:
  //  - string[]
  //  - { projectIds: string[] }
  const failOpen = (reason: string) => ({
    ids: rawIds,
    ok: false,
    error: reason,
  });

  try {
    const r: any = await filterActiveProjectIds(supabase, rawIds);

    // string[]
    if (Array.isArray(r)) {
      const ids = r.filter(Boolean);
      if (!ids.length && rawIds.length) return failOpen("active filter returned 0 ids; failing open");
      return { ids, ok: true, error: null as string | null };
    }

    // { projectIds }
    const ids = Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) return failOpen("active filter returned 0 ids; failing open");
    return { ids, ok: !r?.error, error: r?.error ? safeStr(r.error?.message || r.error) : null };
  } catch (e: any) {
    return failOpen(safeStr(e?.message || e || "active filter failed"));
  }
}

async function handle(req: Request, opts: { days: 7 | 14 | 30 | 60; filters: PortfolioFilters }) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  const userId = auth?.user?.id || null;
  if (authErr || !userId) return err("Not authenticated", 401);

  // ✅ ORG-wide scope for dashboards
  const scoped = await resolveOrgActiveProjectScope(supabase, userId);
  const scopedIdsRaw: string[] = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

  // ✅ Active-only (terminal exclusion) — FAIL-OPEN
  const active = await normalizeActiveIds(supabase, scopedIdsRaw);
  const scopedIdsActive = active.ids;

  // ✅ Apply dashboard filters within active scope
  const filtered = await applyProjectFilters(supabase, scopedIdsActive, opts.filters);
  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    return ok({
      days: opts.days,
      panel: emptyPanel(opts.days),
      count: 0,
      meta: {
        organisationId: (scoped as any)?.organisationId ?? (scoped as any)?.orgId ?? null,
        scope: {
          ...(scoped?.meta ?? {}),
          scopedIdsRaw: scopedIdsRaw.length,
          scopedIdsActive: scopedIdsActive.length,
          active_filter_ok: active.ok,
          active_filter_error: active.error,
        },
        filters: filtered.meta,
        projectCount: 0,
      },
    });
  }

  const { data, error } = await supabase.rpc("get_schedule_milestones_kpis_portfolio", {
    p_project_ids: projectIds,
    p_window_days: opts.days,
  });

  if (error) return err(error.message || "RPC failed", 500);

  const row = Array.isArray(data) ? data[0] : data;

  const planned = num(row?.planned);
  const at_risk = num(row?.at_risk);
  const overdue = num(row?.overdue);
  const ai_high_risk = num(row?.ai_high_risk);
  const avg_slip = num(row?.slip_avg_days);
  const max_slip = num(row?.slip_max_days);

  // Prefer RPC due_count; fallback to summed buckets
  const due_count = num(row?.due_count, planned + at_risk + overdue);

  const panel = {
    days: opts.days,
    due_count,
    overdue_count: overdue,
    ai_high_risk_count: ai_high_risk,
    status_breakdown: { planned, at_risk, overdue },
    slippage: { avg_slip_days: avg_slip, max_slip_days: max_slip },
  };

  return ok({
    days: opts.days,
    panel,
    count: due_count,
    meta: {
      organisationId: (scoped as any)?.organisationId ?? (scoped as any)?.orgId ?? null,
      scope: {
        ...(scoped?.meta ?? {}),
        scopedIdsRaw: scopedIdsRaw.length,
        scopedIdsActive: scopedIdsActive.length,
        active_filter_ok: active.ok,
        active_filter_error: active.error,
      },
      filters: filtered.meta,
      projectCount: projectIds.length,
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