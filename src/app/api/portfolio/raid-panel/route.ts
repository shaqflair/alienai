// src/app/api/portfolio/raid-panel/route.ts — REBUILT v3 (Org view + filter-ready)
// Adds:
//   ✅ RP-F1 filters (GET + POST)
//   ✅ RP-F2 filters applied within resolveActiveProjectScope
//   ✅ RP-F3 typed-count guardrail
// Fixes:
//   ✅ RP-F4 clampDays handles "all" → 60
//   ✅ RP-F5 no-store everywhere
// Keeps:
//   • normalizePanel / safeJson compatibility
//   • fallback to get_portfolio_raid_hi_crit if main RPC fails

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- utils ---------------- */

function clampDays(v: string | null, fallback = 30): 7 | 14 | 30 | 60 {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as any) : (fallback as any);
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

/** Normalise Supabase RPC output shapes into a plain object */
function normalizePanel(raw: any, fnName?: string) {
  const j = safeJson(raw);
  if (Array.isArray(j) && j.length) {
    const first = j[0];
    if (fnName && first?.[fnName]) return safeJson(first[fnName]);
    if (first?.get_portfolio_raid_panel) return safeJson(first.get_portfolio_raid_panel);
    if (first?.get_portfolio_raid_hi_crit) return safeJson(first.get_portfolio_raid_hi_crit);
    return safeJson(first);
  }
  if (fnName && j?.[fnName]) return safeJson(j[fnName]);
  if (j?.get_portfolio_raid_panel) return safeJson(j.get_portfolio_raid_panel);
  if (j?.get_portfolio_raid_hi_crit) return safeJson(j.get_portfolio_raid_hi_crit);
  return j;
}

function emptyPanel(days: number) {
  return {
    days,
    due_total: 0,
    overdue_total: 0,
    risk_due: 0,
    issue_due: 0,
    dependency_due: 0,
    assumption_due: 0,
    risk_overdue: 0,
    issue_overdue: 0,
    dependency_overdue: 0,
    assumption_overdue: 0,
    risk_hi: 0,
    issue_hi: 0,
    dependency_hi: 0,
    assumption_hi: 0,
    overdue_hi: 0,
  };
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function pickFirstFinite(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error: message, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
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

/* ---------------- typed counts ---------------- */

type TypedCounts = {
  risk_due: number;
  issue_due: number;
  dependency_due: number;
  assumption_due: number;
  risk_overdue: number;
  issue_overdue: number;
  dependency_overdue: number;
  assumption_overdue: number;
};

async function computeTypedCounts(opts: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  projectIds: string[];
  days: number;
  openStatuses: string[];
}): Promise<TypedCounts> {
  const { supabase, projectIds, days, openStatuses } = opts;
  const types = ["Risk", "Issue", "Dependency", "Assumption"] as const;

  const todayISO = new Date().toISOString().slice(0, 10);
  const end = new Date();
  end.setDate(end.getDate() + days);
  const endISO = end.toISOString().slice(0, 10);

  const countFor = async (type: (typeof types)[number], mode: "due" | "overdue") => {
    let q = supabase
      .from("raid_items")
      .select("id", { count: "exact", head: true })
      .in("project_id", projectIds)
      .in("status", openStatuses)
      .not("due_date", "is", null)
      .eq("type", type);

    q = mode === "due" ? q.gte("due_date", todayISO).lte("due_date", endISO) : q.lt("due_date", todayISO);

    const r = await q;
    return Number(r.count ?? 0);
  };

  const results = await Promise.all([
    countFor("Risk", "due"),
    countFor("Issue", "due"),
    countFor("Dependency", "due"),
    countFor("Assumption", "due"),
    countFor("Risk", "overdue"),
    countFor("Issue", "overdue"),
    countFor("Dependency", "overdue"),
    countFor("Assumption", "overdue"),
  ]);

  return {
    risk_due: results[0],
    issue_due: results[1],
    dependency_due: results[2],
    assumption_due: results[3],
    risk_overdue: results[4],
    issue_overdue: results[5],
    dependency_overdue: results[6],
    assumption_overdue: results[7],
  };
}

/* ---------------- handler ---------------- */

async function handle(req: Request, opts: { days: number; filters: PortfolioFilters }) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return err("Not authenticated", 401);

  const scoped = await resolveActiveProjectScope(supabase, auth.user.id);
  const scopedIds: string[] = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

  const filtered = await applyProjectFilters(supabase, scopedIds, opts.filters);
  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    return ok({
      panel: emptyPanel(opts.days),
      meta: { project_count: 0, active_only: true, scope: scoped.meta, filters: filtered.meta },
    });
  }

  const openStatuses = ["Open", "In Progress"];

  const { data: panelData, error: panelErr } = await supabase.rpc("get_portfolio_raid_panel", {
    p_project_ids: projectIds,
    p_days: opts.days,
  });

  let typed: TypedCounts;
  try {
    typed = await computeTypedCounts({ supabase, projectIds, days: opts.days, openStatuses });
  } catch {
    typed = {
      risk_due: 0,
      issue_due: 0,
      dependency_due: 0,
      assumption_due: 0,
      risk_overdue: 0,
      issue_overdue: 0,
      dependency_overdue: 0,
      assumption_overdue: 0,
    };
  }

  if (!panelErr) {
    const panel = normalizePanel(panelData, "get_portfolio_raid_panel") ?? {};
    const due_total =
      num(typed.risk_due) + num(typed.issue_due) + num(typed.dependency_due) + num(typed.assumption_due) ||
      num(pickFirstFinite(panel, ["due_total", "due_count"]), 0);

    const overdue_total =
      num(typed.risk_overdue) + num(typed.issue_overdue) + num(typed.dependency_overdue) + num(typed.assumption_overdue) ||
      num(pickFirstFinite(panel, ["overdue_total", "overdue_count"]), 0);

    return ok({
      panel: { ...emptyPanel(opts.days), ...panel, ...typed, due_total, overdue_total },
      meta: { project_count: projectIds.length, active_only: true, scope: scoped.meta, filters: filtered.meta },
    });
  }

  // fallback RPC
  const { data: hiData, error: hiErr } = await supabase.rpc("get_portfolio_raid_hi_crit", {
    p_project_ids: projectIds,
    p_days: opts.days,
  });

  if (hiErr) return err(`${panelErr.message} | ${hiErr.message}`, 500);

  const hiPanel = normalizePanel(hiData, "get_portfolio_raid_hi_crit") ?? {};

  return ok({
    panel: {
      ...emptyPanel(opts.days),
      ...typed,
      due_total: num(typed.risk_due) + num(typed.issue_due) + num(typed.dependency_due) + num(typed.assumption_due),
      overdue_total: num(typed.risk_overdue) + num(typed.issue_overdue) + num(typed.dependency_overdue) + num(typed.assumption_overdue),
      risk_hi: num(hiPanel?.risk_hi),
      issue_hi: num(hiPanel?.issue_hi),
      dependency_hi: num(hiPanel?.dependency_hi),
      assumption_hi: num(hiPanel?.assumption_hi),
      overdue_hi: num(hiPanel?.overdue_hi),
    },
    meta: {
      project_count: projectIds.length,
      active_only: true,
      used_fallback: true,
      rpc_error: panelErr.message,
      scope: scoped.meta,
      filters: filtered.meta,
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
    console.error("[raid-panel][GET]", e);
    return err(safeStr(e?.message || e), 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const days = clampDays(String(body?.days ?? body?.windowDays ?? "30"), 30);
    const filters = parseFiltersFromBody(body);
    return await handle(req, { days, filters });
  } catch (e: any) {
    console.error("[raid-panel][POST]", e);
    return err(safeStr(e?.message || e), 500);
  }
}