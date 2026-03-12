// src/app/api/ai/briefing/route.ts — REBUILT v6
// Adds: Changes, Finance (raid_financials), Resource/Timesheet signals
// All existing signals preserved. New signals use confirmed column names from schema.
// Scope update:
//   ✅ Uses resolvePortfolioScope for org-wide shared project scope
//   ✅ Keeps filterActiveProjectIds
//   ✅ Preserves fail-open fallback behaviour
//   ✅ Preserves no-store caching
//   ✅ Preserves project_code / existing links

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ─── Response helpers ──────────────────────────────────────────────────────── */
function withNoStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function jsonOk(data: any, status = 200) {
  return withNoStore(NextResponse.json({ ok: true, ...data }, { status }));
}
function jsonErr(error: string, status = 400, meta?: any) {
  return withNoStore(NextResponse.json({ ok: false, error, meta }, { status }));
}

function clampDays(v: string | null): 7 | 14 | 30 | 60 | "all" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  return ([7, 14, 30, 60] as const).includes(n as any) ? (n as 7 | 14 | 30 | 60) : 7;
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
function safeArr(x: any): any[] {
  return Array.isArray(x) ? x : [];
}
function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function normStr(x: any) {
  return String(x ?? "").trim().toLowerCase();
}
function clamp01to100(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}
function pct(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10) / 10;
}
function prettyStage(x: any) {
  const s = String(x ?? "").trim();
  return s ? s.replaceAll("_", " ") : "—";
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function moneyGBP(v: number) {
  if (!Number.isFinite(v) || v <= 0) return "£0";
  if (v >= 1_000_000) return `£${(v / 1_000_000).toFixed(1)}m`;
  if (v >= 1_000) return `£${Math.round(v / 1_000)}k`;
  return `£${Math.round(v)}`;
}

function href(
  path: string,
  params?: Record<string, string | number | boolean | null | undefined>
) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) {
    if (v === null || v === undefined) continue;
    if (typeof v === "boolean") {
      if (v) sp.set(k, "1");
      continue;
    }
    sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `${path}?${qs}` : path;
}
function wbsListHref(params?: Record<string, any>) {
  return href("/artifacts", { type: "wbs", view: "list", ...(params || {}) });
}
function changesHref(params?: Record<string, any>) {
  return href("/changes", params || {});
}

/* ─── Scope helpers ─────────────────────────────────────────────────────────── */
function uniqStrings(xs: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs || []) {
    const s = String(x || "").trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
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
function uniqList(input: any): string[] {
  const arr: string[] = [];
  const push = (v: any) => {
    const s = safeStr(v).trim();
    if (s) arr.push(s);
  };
  if (Array.isArray(input)) for (const x of input) push(x);
  else if (typeof input === "string") for (const part of input.split(",")) push(part);
  else if (input != null) push(input);
  return Array.from(new Set(arr));
}

type PortfolioFilters = {
  q?: string;
  projectId?: string[];
  projectCode?: string[];
  pm?: string[];
  dept?: string[];
};

function readPortfolioFiltersFromUrl(url: URL): PortfolioFilters {
  const q = safeStr(url.searchParams.get("q")).trim() || undefined;
  const projectId = uniqList(url.searchParams.getAll("projectId").flatMap((x) => x.split(",")));
  const projectCode = uniqList(
    url.searchParams.getAll("projectCode").flatMap((x) => x.split(","))
  );
  const pm = uniqList(url.searchParams.getAll("pm").flatMap((x) => x.split(",")));
  const dept = uniqList(url.searchParams.getAll("dept").flatMap((x) => x.split(",")));
  const out: PortfolioFilters = {};
  if (q) out.q = q;
  if (projectId.length) out.projectId = projectId;
  if (projectCode.length) out.projectCode = projectCode;
  if (pm.length) out.pm = pm;
  if (dept.length) out.dept = dept;
  return out;
}
function hasActiveFilters(f: PortfolioFilters) {
  return Boolean(
    (f.q && f.q.trim()) ||
      f.projectId?.length ||
      f.projectCode?.length ||
      f.pm?.length ||
      f.dept?.length
  );
}

async function applyPortfolioFiltersToProjectIds(args: {
  supabase: any;
  baseProjectIds: string[];
  filters: PortfolioFilters;
}) {
  const { supabase, baseProjectIds, filters } = args;
  const ids = uniqStrings(baseProjectIds);
  if (!ids.length) return { projectIds: [], limited: false };
  if (!hasActiveFilters(filters)) return { projectIds: ids, limited: false };

  let rows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, project_code, project_manager_id, department")
      .in("id", ids)
      .limit(10000);

    if (error) return { projectIds: ids, limited: true, reason: error.message };
    rows = Array.isArray(data) ? data : [];
  } catch (e: any) {
    return { projectIds: ids, limited: true, reason: String(e?.message || e) };
  }

  const q = safeStr(filters.q).trim().toLowerCase();
  const idSet = new Set(
    (filters.projectId || []).map((s) => safeStr(s).trim()).filter(Boolean)
  );
  const codeNeedles = (filters.projectCode || [])
    .map((s) => safeStr(s).trim().toLowerCase())
    .filter(Boolean);
  const pmSet = new Set((filters.pm || []).map((s) => safeStr(s).trim()).filter(Boolean));
  const deptNeedles = (filters.dept || [])
    .map((s) => safeStr(s).trim().toLowerCase())
    .filter(Boolean);

  const out = rows
    .filter((p) => {
      const pid = safeStr(p?.id).trim();
      const title = safeStr(p?.title).toLowerCase();
      const code = safeStr(p?.project_code).toLowerCase();
      const pm = safeStr(p?.project_manager_id).trim();
      const dept = safeStr(p?.department).toLowerCase().trim();

      if (idSet.size && !idSet.has(pid)) return false;
      if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c))) return false;
      if (pmSet.size && (!pm || !pmSet.has(pm))) return false;
      if (deptNeedles.length && (!dept || !deptNeedles.some((d) => dept.includes(d))))
        return false;
      if (q) {
        const hay = `${title} ${code} ${dept}`.trim();
        if (!hay.includes(q)) return false;
      }
      return true;
    })
    .map((p) => safeStr(p?.id).trim())
    .filter(Boolean);

  return { projectIds: uniqStrings(out), limited: false };
}

/* ─── WBS helpers ───────────────────────────────────────────────────────────── */
type WbsRow = {
  id?: string;
  level?: number;
  status?: any;
  state?: any;
  progress?: any;
  due_date?: any;
  dueDate?: any;
  end?: any;
  end_date?: any;
  endDate?: any;
  date?: any;
  effort?: string | null;
  estimated_effort_hours?: any;
  estimatedEffortHours?: any;
  effort_hours?: any;
  effortHours?: any;
  estimate_hours?: any;
  estimateHours?: any;
  estimated_effort?: any;
  estimatedEffort?: any;
};

function asLevel(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function rowHasChildren(rows: WbsRow[], idx: number) {
  const cur = rows[idx];
  const next = rows[idx + 1];
  return !!(cur && next && asLevel((next as any).level) > asLevel((cur as any).level));
}
function safeDate(x: any): Date | null {
  if (!x) return null;
  if (x instanceof Date && !Number.isNaN(x.getTime())) return x;
  const s = String(x).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function startOfDayUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function addDaysUTC(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}
function isDoneStatus(row: WbsRow): boolean {
  const s = normStr((row as any)?.status || (row as any)?.state);
  if (["done", "closed", "complete", "completed", "cancelled", "canceled"].includes(s))
    return true;
  const p = Number((row as any)?.progress);
  return Number.isFinite(p) && p >= 100;
}
function getDueDate(row: WbsRow): Date | null {
  return (
    safeDate((row as any)?.due_date) ||
    safeDate((row as any)?.dueDate) ||
    safeDate((row as any)?.end_date) ||
    safeDate((row as any)?.endDate) ||
    safeDate((row as any)?.end) ||
    safeDate((row as any)?.date) ||
    null
  );
}
function rowHasEffort(row: WbsRow): boolean {
  const keys = [
    "estimated_effort_hours",
    "estimatedEffortHours",
    "effort_hours",
    "effortHours",
    "estimate_hours",
    "estimateHours",
    "estimated_effort",
    "estimatedEffort",
  ] as const;
  for (const k of keys) {
    const v: any = (row as any)?.[k];
    if (v == null || v === "") continue;
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return true;
  }
  const e = String((row as any)?.effort ?? "")
    .trim()
    .toUpperCase();
  return e === "S" || e === "M" || e === "L";
}

function calcWbsLeafStats(doc: any, days: number | null) {
  const rows = safeArr(doc?.rows) as WbsRow[];
  if (!rows.length) {
    return {
      totalLeaves: 0,
      done: 0,
      remaining: 0,
      overdue: 0,
      due_7: 0,
      due_14: 0,
      due_30: 0,
      due_60: 0,
      missing_effort: 0,
      missing_row_ids: [] as string[],
      scoped_leaf_count_with_due: 0,
    };
  }

  const today = startOfDayUTC(new Date());
  const scopeEnd = days == null ? null : addDaysUTC(today, days);
  const d7 = addDaysUTC(today, 7);
  const d14 = addDaysUTC(today, 14);
  const d30 = addDaysUTC(today, 30);
  const d60 = addDaysUTC(today, 60);

  let totalLeaves = 0;
  let done = 0;
  let remaining = 0;
  let overdue = 0;
  let due7 = 0;
  let due14 = 0;
  let due30 = 0;
  let due60 = 0;
  let missingEffort = 0;
  let scopedLeafWithDue = 0;
  const missingRowIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (rowHasChildren(rows, i)) continue;

    const row = rows[i];
    const isDone = isDoneStatus(row);
    const due = getDueDate(row);

    if (!isDone && due) {
      const dd = startOfDayUTC(due);
      if (dd.getTime() >= today.getTime()) {
        if (dd <= d7) due7++;
        else if (dd <= d14) due14++;
        else if (dd <= d30) due30++;
        else if (dd <= d60) due60++;
      }
    }

    if (!due) continue;
    const dueDay = startOfDayUTC(due);

    let inScope = true;
    if (scopeEnd) inScope = dueDay.getTime() < today.getTime() || dueDay <= scopeEnd;
    if (!inScope) continue;

    scopedLeafWithDue++;
    totalLeaves++;

    if (isDone) done++;
    else remaining++;

    if (!isDone && dueDay.getTime() < today.getTime()) overdue++;

    if (!rowHasEffort(row)) {
      missingEffort++;
      const rid = row?.id ? String(row.id) : "";
      if (rid) missingRowIds.push(rid);
    }
  }

  return {
    totalLeaves,
    done,
    remaining,
    overdue,
    due_7: due7,
    due_14: due14,
    due_30: due30,
    due_60: due60,
    missing_effort: missingEffort,
    missing_row_ids: missingRowIds,
    scoped_leaf_count_with_due: scopedLeafWithDue,
  };
}

async function computeWbsStatsFromArtifacts(
  supabase: any,
  projectIds: string[],
  days: number | null
) {
  const { data: rows, error } = await supabase
    .from("artifacts")
    .select("id, project_id, type, updated_at, created_at, content_json, content")
    .in("project_id", projectIds)
    .eq("type", "wbs");

  if (error) throw new Error(error.message);

  let totalLeaves = 0;
  let done = 0;
  let remaining = 0;
  let overdue = 0;
  let due7 = 0;
  let due14 = 0;
  let due30 = 0;
  let due60 = 0;
  let missingEffort = 0;
  let sampleProjectId = "";
  let sampleArtifactId = "";

  for (const r of rows || []) {
    const doc = safeJson((r as any)?.content_json) ?? safeJson((r as any)?.content) ?? null;
    if (
      !(
        String(doc?.type || "")
          .trim()
          .toLowerCase() === "wbs" &&
        Number(doc?.version) === 1 &&
        Array.isArray(doc?.rows)
      )
    ) {
      continue;
    }

    const s = calcWbsLeafStats(doc, days);
    totalLeaves += s.totalLeaves;
    done += s.done;
    remaining += s.remaining;
    overdue += s.overdue;
    due7 += s.due_7;
    due14 += s.due_14;
    due30 += s.due_30;
    due60 += s.due_60;
    missingEffort += s.missing_effort;

    if (!sampleArtifactId && s.missing_effort > 0) {
      sampleProjectId = String((r as any)?.project_id || "");
      sampleArtifactId = String((r as any)?.id || "");
    }
  }

  return {
    totalLeaves,
    done,
    remaining,
    overdue,
    due_7: due7,
    due_14: due14,
    due_30: due30,
    due_60: due60,
    missing_effort: missingEffort,
    sample_project_id: sampleProjectId,
    sample_artifact_id: sampleArtifactId,
  };
}

/* ─── Approvals ─────────────────────────────────────────────────────────────── */
async function computeApprovalsPending(supabase: any, projectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from("approval_steps")
      .select("id, project_id, status, decided_at")
      .in("project_id", projectIds);

    if (error) {
      if (!looksMissingRelation(error)) throw new Error(error.message);
    } else {
      return (data || []).filter((r: any) => {
        if (r?.decided_at) return false;
        const s = normStr(r?.status);
        return s === "" || s === "pending" || s === "open";
      }).length;
    }
  } catch {
    /* fallthrough */
  }

  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select("id, project_id, status")
      .in("project_id", projectIds);

    if (error) return 0;
    return (data || []).filter((r: any) => {
      const s = normStr((r as any)?.status);
      return s.includes("pending") && s.includes("approval");
    }).length;
  } catch {
    return 0;
  }
}

/* ─── NEW: Change Request Signals ──────────────────────────────────────────── */
type ChangeSignals = {
  open: number;
  pending_approval: number;
  overdue_review: number;
  high_ai_impact: number;
  stale: number;
  avg_ai_score: number;
  top_title: string | null;
  ok: boolean;
  error?: string;
};

async function computeChangeSignals(
  supabase: any,
  projectIds: string[]
): Promise<ChangeSignals> {
  const empty: ChangeSignals = {
    open: 0,
    pending_approval: 0,
    overdue_review: 0,
    high_ai_impact: 0,
    stale: 0,
    avg_ai_score: 0,
    top_title: null,
    ok: false,
  };
  if (!projectIds.length) return empty;

  try {
    const { data: crs, error: crErr } = await supabase
      .from("change_requests")
      .select(
        "id, status, priority, ai_score, ai_schedule, ai_cost, review_by, updated_at, title, decision_status"
      )
      .in("project_id", projectIds)
      .not("status", "ilike", "%closed%")
      .not("status", "ilike", "%rejected%")
      .not("status", "ilike", "%cancelled%")
      .limit(500);

    if (crErr) return { ...empty, error: crErr.message };

    const rows = crs || [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const staleThreshold = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    let overdue_review = 0;
    let high_ai_impact = 0;
    let stale = 0;
    let scoreSum = 0;
    let scoreCount = 0;

    for (const cr of rows) {
      if (cr.review_by && String(cr.review_by) < todayStr) overdue_review++;
      const aiScore = num(cr.ai_score);
      const aiSched = num(cr.ai_schedule);
      const aiCost = num(cr.ai_cost);
      if (aiScore >= 70 || aiSched >= 70 || aiCost >= 70) high_ai_impact++;
      if (cr.updated_at && String(cr.updated_at) < staleThreshold) stale++;
      if (aiScore > 0) {
        scoreSum += aiScore;
        scoreCount++;
      }
    }

    let pending_approval = 0;
    const crIds = rows.map((r: any) => r.id).filter(Boolean);
    if (crIds.length) {
      const { data: approvals } = await supabase
        .from("change_approvals")
        .select("id, change_id")
        .in("change_id", crIds)
        .is("decided_at", null)
        .limit(500);
      pending_approval = (approvals || []).length;
    }

    const topCr = [...rows].sort((a: any, b: any) => num(b.ai_score) - num(a.ai_score))[0];

    return {
      ok: true,
      open: rows.length,
      pending_approval,
      overdue_review,
      high_ai_impact,
      stale,
      avg_ai_score: scoreCount > 0 ? Math.round(scoreSum / scoreCount) : 0,
      top_title: topCr?.title ? String(topCr.title).slice(0, 100) : null,
    };
  } catch (e: any) {
    return { ...empty, error: String(e?.message || e) };
  }
}

/* ─── NEW: Finance Signals (raid_financials) ────────────────────────────────── */
type FinanceSignals = {
  total_exposure: number;
  cost_exposure: number;
  revenue_at_risk: number;
  penalties: number;
  high_exposure_count: number;
  item_count: number;
  ok: boolean;
  error?: string;
};

async function computeFinanceSignals(
  supabase: any,
  projectIds: string[]
): Promise<FinanceSignals> {
  const empty: FinanceSignals = {
    total_exposure: 0,
    cost_exposure: 0,
    revenue_at_risk: 0,
    penalties: 0,
    high_exposure_count: 0,
    item_count: 0,
    ok: false,
  };
  if (!projectIds.length) return empty;

  try {
    const { data: fins, error } = await supabase
      .from("raid_financials")
      .select("est_cost_impact, est_revenue_at_risk, est_penalties")
      .in("project_id", projectIds)
      .limit(5000);

    if (error) {
      if (looksMissingRelation(error)) return empty;
      return { ...empty, error: error.message };
    }

    let cost = 0;
    let rev = 0;
    let pen = 0;
    let highCount = 0;

    for (const f of fins || []) {
      const c = num(f.est_cost_impact);
      const r = num(f.est_revenue_at_risk);
      const p = num(f.est_penalties);
      cost += c;
      rev += r;
      pen += p;
      if (c + r + p > 50_000) highCount++;
    }

    return {
      ok: true,
      total_exposure: cost + rev + pen,
      cost_exposure: cost,
      revenue_at_risk: rev,
      penalties: pen,
      high_exposure_count: highCount,
      item_count: (fins || []).length,
    };
  } catch (e: any) {
    return { ...empty, error: String(e?.message || e) };
  }
}

/* ─── NEW: Resource / Timesheet Signals ─────────────────────────────────────── */
type ResourceSignals = {
  timesheets_pending: number;
  timesheets_rejected: number;
  resource_rate_count: number;
  ok: boolean;
  error?: string;
};

async function computeResourceSignals(
  supabase: any,
  orgId: string | null
): Promise<ResourceSignals> {
  const empty: ResourceSignals = {
    timesheets_pending: 0,
    timesheets_rejected: 0,
    resource_rate_count: 0,
    ok: false,
  };
  if (!orgId) return empty;

  try {
    const [pendingRes, rejectedRes, ratesRes] = await Promise.all([
      supabase
        .from("timesheets")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .eq("status", "submitted"),
      supabase
        .from("timesheets")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId)
        .eq("status", "rejected"),
      supabase
        .from("v_resource_rates_latest")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", orgId),
    ]);

    return {
      ok: true,
      timesheets_pending: num(pendingRes.count),
      timesheets_rejected: num(rejectedRes.count),
      resource_rate_count: num(ratesRes.count),
    };
  } catch (e: any) {
    return { ...empty, error: String(e?.message || e) };
  }
}

/* ─── Feed signals ──────────────────────────────────────────────────────────── */
type FeedSignals = {
  table: string | null;
  days: number;
  total_7d: number;
  total_24h: number;
  active_projects_7d: number;
  stale_projects_7d: number;
  limited: boolean;
};

async function detectFirstExistingActivityTable(supabase: any, candidates: string[]) {
  for (const t of candidates) {
    const { error } = await supabase
      .from(t)
      .select("id", { head: true, count: "exact" })
      .limit(1);
    if (!error) return t;
    if (!looksMissingRelation(error)) return t;
  }
  return null;
}

async function computeFeedSignals(
  supabase: any,
  projectIds: string[],
  projectCreatedAtMap?: Map<string, Date>
): Promise<FeedSignals> {
  const empty: FeedSignals = {
    table: null,
    days: 7,
    total_7d: 0,
    total_24h: 0,
    active_projects_7d: 0,
    stale_projects_7d: 0,
    limited: false,
  };
  if (!projectIds.length) return empty;

  const candidates = ["activity_events", "activity_log", "project_activity", "activity"];
  const table = await detectFirstExistingActivityTable(supabase, candidates);
  if (!table) return empty;

  const today = startOfDayUTC(new Date());
  const since7 = addDaysUTC(today, -7);
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const LIMIT = 2000;

  const { data, error } = await supabase
    .from(table)
    .select("project_id, created_at")
    .in("project_id", projectIds)
    .gte("created_at", since7.toISOString())
    .order("created_at", { ascending: false })
    .limit(LIMIT);

  if (error) return { ...empty, table };

  const rows = Array.isArray(data) ? data : [];
  const activeProjects = new Set<string>();
  let total7 = 0;
  let total24 = 0;

  for (const r of rows) {
    const pid = String((r as any)?.project_id || "").trim();
    if (pid) activeProjects.add(pid);
    total7++;
    const ts = safeDate((r as any)?.created_at);
    if (ts && ts.getTime() >= since24h.getTime()) total24++;
  }

  let staleCount = 0;
  if (projectCreatedAtMap !== undefined) {
    const sevenDaysAgo = since7;
    let eligible = 0;
    for (const pid of projectIds) {
      const ca = projectCreatedAtMap.get(pid);
      if (!ca || ca.getTime() <= sevenDaysAgo.getTime()) eligible++;
    }
    staleCount = Math.max(0, eligible - activeProjects.size);
  }

  return {
    table,
    days: 7,
    total_7d: total7,
    total_24h: total24,
    active_projects_7d: activeProjects.size,
    stale_projects_7d: staleCount,
    limited: rows.length >= LIMIT || projectCreatedAtMap === undefined,
  };
}

/* ─── Flow signals ──────────────────────────────────────────────────────────── */
type FlowSignals = { ok: boolean; days: number; projects: any[]; error?: string | null };

async function fetchFlowWarningSignals(
  supabase: any,
  projectIds: string[],
  days = 30
): Promise<FlowSignals> {
  try {
    const { data, error } = await supabase.rpc("get_flow_warning_signals", {
      p_project_ids: projectIds,
      p_days: days,
    });

    if (error) {
      if (looksMissingRelation(error)) {
        return { ok: false, days, projects: [], error: "flow RPC missing" };
      }
      return { ok: false, days, projects: [], error: error.message || "flow RPC error" };
    }

    const j = safeJson(data) ?? data;
    return { ok: true, days: num(j?.days, days), projects: Array.isArray(j?.projects) ? j.projects : [] };
  } catch (e: any) {
    return { ok: false, days, projects: [], error: String(e?.message || e || "flow RPC failed") };
  }
}

type FlowAgg = {
  outlierCount: number;
  cycleVariancePct: number;
  blockedCount: number;
  blockedOpenCount: number;
  blockedRatioPct: number;
  blockedLongCount: number;
  topStage: string | null;
  topStageSharePct: number;
  topStageWip: number;
  topProjectTotalWip: number;
  portfolioTotalWip: number;
  due30Open: number;
  expectedDone30: number;
  slipProbMax: number;
};

function computeFlowAgg(flow: FlowSignals): FlowAgg {
  let outlierCount = 0;
  let cycleVariancePct = 0;
  let blockedCount = 0;
  let blockedOpenCount = 0;
  let blockedLongCount = 0;
  let topStage: string | null = null;
  let topStageShare = 0;
  let topStageWip = 0;
  let topProjectTotalWip = 0;
  let portfolioTotalWip = 0;
  let due30Open = 0;
  let expectedDone30 = 0;
  let slipProbMax = 0;

  if (flow.ok && Array.isArray(flow.projects)) {
    for (const p of flow.projects) {
      const ao = p?.age_cycle_outliers || {};
      outlierCount += num(ao?.count, 0);

      const bl = p?.blocked || {};
      blockedCount += num(bl?.blocked_count, 0);
      blockedOpenCount += num(bl?.open_count, 0);
      blockedLongCount += num(bl?.blocked_long_count, 0);

      const bn = p?.bottleneck || {};
      const share = num(bn?.top_stage_share, 0);
      const pwip = num(bn?.total_wip, 0);
      portfolioTotalWip += pwip;

      if (share > topStageShare) {
        topStageShare = share;
        topStage = bn?.top_stage ? String(bn.top_stage) : null;
        topStageWip = num(bn?.top_stage_wip, 0);
        topProjectTotalWip = pwip;
      }

      const fc = p?.forecast || {};
      due30Open += num(fc?.due_30_open, 0);
      expectedDone30 += Number(fc?.expected_done_30d ?? 0) || 0;
      slipProbMax = Math.max(slipProbMax, clamp01to100(fc?.slip_probability));

      const cv = p?.cycle_time_variance_pct;
      if (cv != null) cycleVariancePct = Math.max(cycleVariancePct, num(cv, 0));
    }
  }

  return {
    outlierCount,
    cycleVariancePct,
    blockedCount,
    blockedOpenCount,
    blockedRatioPct: blockedOpenCount > 0 ? (blockedCount / blockedOpenCount) * 100 : 0,
    blockedLongCount,
    topStage,
    topStageSharePct: topStageShare,
    topStageWip,
    topProjectTotalWip,
    portfolioTotalWip,
    due30Open,
    expectedDone30,
    slipProbMax,
  };
}

type Warning = {
  kind: string;
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  evidence?: any;
  href?: string | null;
  score?: number;
};

function buildFlowWarnings(args: {
  daysParam: 7 | 14 | 30 | 60 | "all";
  flow: FlowSignals;
  approvalsPending: number;
  feeds: FeedSignals;
}): Warning[] {
  const { daysParam, flow, approvalsPending, feeds } = args;
  const warnings: Warning[] = [];
  const hrefDays = daysParam === "all" ? 60 : daysParam;
  const windowLabel = String(hrefDays);
  const agg = computeFlowAgg(flow);

  if (agg.outlierCount > 0) {
    const varFlag = agg.cycleVariancePct >= 25;
    const sev: Warning["severity"] = varFlag
      ? "high"
      : agg.outlierCount >= 5
        ? "high"
        : "medium";
    warnings.push({
      kind: "cycle_time_outliers",
      severity: sev,
      score: 100,
      title: "Cycle-time outliers (early slip risk)",
      detail: `${agg.outlierCount} work item(s) aged >2× average cycle time due within ${windowLabel}d.${varFlag ? ` Variance up ${pct(agg.cycleVariancePct)}%.` : ""}`,
      evidence: { outlierCount: agg.outlierCount, cycleVariancePct: agg.cycleVariancePct },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });
  }

  if (agg.blockedCount > 0 || agg.blockedLongCount > 0) {
    const sev: Warning["severity"] =
      agg.blockedLongCount > 0 || agg.blockedRatioPct >= 15
        ? "high"
        : agg.blockedRatioPct >= 10
          ? "medium"
          : "info";
    warnings.push({
      kind: "blockers",
      severity: sev,
      score: 90,
      title: "Blockers accumulating (stall risk)",
      detail:
        agg.blockedOpenCount > 0
          ? `${pct(agg.blockedRatioPct)}% of open items blocked (${agg.blockedCount}/${agg.blockedOpenCount}). Long-blocked: ${agg.blockedLongCount}.`
          : `${agg.blockedCount} blocked in last 30d. Long-blocked: ${agg.blockedLongCount}.`,
      evidence: {
        blockedCount: agg.blockedCount,
        openCount: agg.blockedOpenCount,
        blockedRatio: pct(agg.blockedRatioPct),
        blockedLongCount: agg.blockedLongCount,
      },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });
  }

  if (agg.topStage && agg.topProjectTotalWip > 0) {
    const sev: Warning["severity"] =
      agg.topStageSharePct >= 55 ? "high" : agg.topStageSharePct >= 40 ? "medium" : "info";
    warnings.push({
      kind: "bottleneck",
      severity: sev,
      score: 80,
      title: "Bottleneck risk (WIP concentration)",
      detail: `Stage "${prettyStage(agg.topStage)}" holds ${pct(agg.topStageSharePct)}% of WIP (${agg.topStageWip}/${agg.topProjectTotalWip}).`,
      evidence: { topStage: agg.topStage, topStageShare: pct(agg.topStageSharePct) },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });
  }

  if (agg.due30Open > 0) {
    const p = clamp01to100(agg.slipProbMax);
    const sev: Warning["severity"] = p >= 70 ? "high" : p >= 45 ? "medium" : "info";
    warnings.push({
      kind: "throughput_forecast",
      severity: sev,
      score: 70,
      title: "Throughput-based slip forecast",
      detail: `${p}% chance due-soon commitments slip. Due 30d: ${agg.due30Open} • Expected throughput: ${Math.round(agg.expectedDone30 * 10) / 10}.`,
      evidence: { slip_probability: p, due_30_open: agg.due30Open },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });
  }

  if (approvalsPending > 0) {
    warnings.push({
      kind: "approvals",
      severity: approvalsPending >= 10 ? "high" : "medium",
      score: 40,
      title: "Approvals at risk of becoming blockers",
      detail: `${approvalsPending} approval(s) pending. Long waits inflate cycle time.`,
      evidence: { approvalsPending },
      href: href("/approvals", { days: hrefDays }),
    });
  }

  if (feeds.table && feeds.stale_projects_7d > 0) {
    warnings.push({
      kind: "feed_cadence",
      severity: "medium",
      score: 30,
      title: "Delivery cadence risk (low activity)",
      detail: `${feeds.stale_projects_7d} project(s) with no updates in 7 days.`,
      evidence: feeds,
      href: href("/activity", { scope: "stale", days: 7 }),
    });
  }

  const sevRank = (s: Warning["severity"]) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
  warnings.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || sevRank(b.severity) - sevRank(a.severity));
  return warnings;
}

function buildExecutiveAiWarningBody(args: {
  windowLabel: string;
  warnings: Warning[];
  agg: FlowAgg;
}) {
  const { windowLabel, warnings, agg } = args;

  if (!warnings.length) {
    return `AI Predictions & Warnings (Next ${windowLabel} Days)\n\n• No major risks detected\nDelivery is currently stable.\n\n👉 Action: Maintain cadence and monitor early signals.`;
  }

  const lines: string[] = [];
  for (const w of warnings.filter((x) => x.severity === "high")) {
    lines.push(`🔴 ${w.title}\n   ${w.detail}`);
  }
  for (const w of warnings.filter((x) => x.severity === "medium")) {
    lines.push(`🟡 ${w.title}\n   ${w.detail}`);
  }

  const top = warnings[0];
  let action = "Review flagged items and assign owners.";
  if (top.kind === "blockers" || top.kind === "cycle_time_outliers") {
    action = "Escalate blockers and assign owners to at-risk items immediately.";
  } else if (top.kind === "bottleneck" || top.kind === "wip_queue_expansion") {
    action = "Reduce WIP limits and rebalance capacity to unblock downstream flow.";
  } else if (top.kind === "throughput_forecast") {
    action = `Review delivery commitments — ${clamp01to100(agg.slipProbMax)}% slip probability on upcoming milestones.`;
  } else if (top.kind === "approvals") {
    action = "Clear pending approvals to prevent cycle-time inflation.";
  }

  return `AI Predictions & Warnings (Next ${windowLabel} Days)\n\n${(lines.join("\n\n") + `\n\n👉 Action: ${action}`).trim()}`;
}

function normalizeInsightsRpc(raw: any) {
  const j = safeJson(raw);
  if (!j) return { data: null, missing: true };
  if (Array.isArray(j) && j.length) {
    const first = j[0];
    if (first?.get_portfolio_insights) {
      return { data: safeJson(first.get_portfolio_insights), missing: false };
    }
    return { data: safeJson(first), missing: false };
  }
  if (j?.get_portfolio_insights) return { data: safeJson(j.get_portfolio_insights), missing: false };
  return { data: j, missing: Object.keys(j).length === 0 };
}

/* ─── GET handler ───────────────────────────────────────────────────────────── */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return jsonErr("Not authenticated", 401);

    const userId = auth.user.id;
    const url = new URL(req.url);
    const daysParam = clampDays(url.searchParams.get("days"));
    const days: number | null = daysParam === "all" ? null : daysParam;
    const filters = readPortfolioFiltersFromUrl(url);
    const filtersActive = hasActiveFilters(filters);

    // Shared org-wide portfolio scope
    let scoped: any = null;
    let scopedIdsRaw: string[] = [];

    try {
      scoped = await resolvePortfolioScope(supabase, userId);
      scopedIdsRaw = uniqStrings(scoped?.projectIds || []);
    } catch (e: any) {
      scoped = { ok: false, error: String(e?.message || e), projectIds: [] };
    }

    // Fail-open fallback to legacy active project scope
    if (!scopedIdsRaw.length) {
      const fb = await resolveActiveProjectScope(supabase);
      scoped = fb;
      scopedIdsRaw = uniqStrings(fb?.projectIds || []);
    }

    // Active filter — handle both array and object return shapes
    let activeIds = uniqStrings(scopedIdsRaw);
    let activeMeta: any = {
      before: scopedIdsRaw.length,
      after: scopedIdsRaw.length,
      fail_open: false,
    };

    try {
      const _activeRes = await filterActiveProjectIds(supabase, scopedIdsRaw);
      const filteredActiveIds = uniqStrings(
        Array.isArray(_activeRes) ? _activeRes : (_activeRes as any)?.projectIds ?? []
      );

      if (filteredActiveIds.length > 0) {
        activeIds = filteredActiveIds;
        activeMeta = {
          before: scopedIdsRaw.length,
          after: filteredActiveIds.length,
          fail_open: false,
        };
      } else {
        activeMeta = {
          before: scopedIdsRaw.length,
          after: scopedIdsRaw.length,
          fail_open: true,
          reason: "filterActiveProjectIds returned 0 rows",
        };
      }
    } catch (e: any) {
      activeMeta = {
        before: scopedIdsRaw.length,
        after: scopedIdsRaw.length,
        fail_open: true,
        reason: String(e?.message || e),
      };
    }

    const filteredRes = await applyPortfolioFiltersToProjectIds({
      supabase,
      baseProjectIds: activeIds,
      filters,
    });
    const projectIds = uniqStrings(filteredRes?.projectIds || []);
    const orgId: string | null =
      safeStr(scoped?.organisationId || scoped?.meta?.organisationId || null) || null;

    if (!projectIds.length) {
      return jsonOk({
        insights: [
          {
            id: filtersActive ? "no-projects-after-filters" : "no-projects",
            severity: "info",
            title: filtersActive ? "No projects match your filters" : "No projects in scope",
            body: filtersActive
              ? "Your current portfolio filters returned zero active projects."
              : "You don't have any active projects yet.",
            href: filtersActive ? "/home" : "/projects",
          },
        ],
        meta: {
          days: daysParam,
          projectCount: 0,
          filters: filtersActive ? filters : {},
        },
      });
    }

    const hrefDays = daysParam === "all" ? 60 : daysParam;
    const rpcDays = daysParam === "all" ? 60 : daysParam;

    const { data, error } = await supabase.rpc("get_portfolio_insights", {
      p_project_ids: projectIds,
      p_days: rpcDays,
    });
    if (error) throw new Error(error.message);

    const { data: panel, missing: rpcMissing } = normalizeInsightsRpc(data);
    const safePanel = panel || {};
    const rpcWbs = safePanel?.wbs || {};

    const wbsFromArtifacts = await computeWbsStatsFromArtifacts(supabase, projectIds, days);

    let projectCreatedAtMap: Map<string, Date> | undefined;
    try {
      const { data: projRows } = await supabase
        .from("projects")
        .select("id, created_at")
        .in("id", projectIds)
        .limit(10000);

      if (Array.isArray(projRows)) {
        projectCreatedAtMap = new Map();
        for (const r of projRows) {
          const id = String((r as any)?.id || "").trim();
          const ts = safeDate((r as any)?.created_at);
          if (id && ts) projectCreatedAtMap.set(id, ts);
        }
      }
    } catch {
      /* handled in computeFeedSignals */
    }

    const [approvalsPending, feeds, flow, changeSignals, financeSignals, resourceSignals] =
      await Promise.all([
        computeApprovalsPending(supabase, projectIds),
        computeFeedSignals(supabase, projectIds, projectCreatedAtMap),
        fetchFlowWarningSignals(supabase, projectIds, 30),
        computeChangeSignals(supabase, projectIds),
        computeFinanceSignals(supabase, projectIds),
        computeResourceSignals(supabase, orgId),
      ]);

    type Insight = {
      id: string;
      severity: "high" | "medium" | "info";
      title: string;
      body: string;
      href?: string | null;
      meta?: any;
    };

    const insights: Insight[] = [];

    /* ── AI Flow Warning ── */
    {
      const windowLabel = String(hrefDays);
      const warnings = buildFlowWarnings({ daysParam, flow, approvalsPending, feeds });
      const sevRank = (s: Insight["severity"]) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
      const severity: Insight["severity"] =
        warnings.length > 0
          ? warnings.slice().sort((a, b) => sevRank(b.severity) - sevRank(a.severity))[0]
              .severity
          : "info";
      const agg = computeFlowAgg(flow);

      insights.push({
        id: "ai-warning",
        severity,
        title: `AI prediction & warnings (next ${windowLabel} days)`,
        body: buildExecutiveAiWarningBody({ windowLabel, warnings, agg }),
        href: href("/insights/ai-warning", { days: hrefDays }),
        meta: { window: daysParam, rpc_data_missing: rpcMissing, warnings },
      });
    }

    /* ── Change Requests ── */
    if (changeSignals.ok) {
      if (changeSignals.overdue_review > 0) {
        insights.push({
          id: "cr-overdue-review",
          severity: "high",
          title: `${changeSignals.overdue_review} change request${changeSignals.overdue_review !== 1 ? "s" : ""} past review deadline`,
          body: `${changeSignals.overdue_review} CR${changeSignals.overdue_review !== 1 ? "s" : ""} have passed their review_by date without a decision. Overdue changes increase schedule and cost risk — assign owners and close out.`,
          href: changesHref({ overdue: 1 }),
          meta: { overdue_review: changeSignals.overdue_review },
        });
      }

      if (changeSignals.pending_approval > 0) {
        insights.push({
          id: "cr-pending-approvals",
          severity: changeSignals.pending_approval >= 5 ? "high" : "medium",
          title: `${changeSignals.pending_approval} change approval${changeSignals.pending_approval !== 1 ? "s" : ""} awaiting decision`,
          body: `${changeSignals.pending_approval} change request approval${changeSignals.pending_approval !== 1 ? "s" : ""} have no decision recorded. Pending approvals block delivery and inflate cycle time.`,
          href: changesHref({ pendingApprovals: 1 }),
          meta: { pending_approval: changeSignals.pending_approval },
        });
      }

      if (changeSignals.high_ai_impact > 0) {
        insights.push({
          id: "cr-high-ai-impact",
          severity: "medium",
          title: `${changeSignals.high_ai_impact} high-impact change${changeSignals.high_ai_impact !== 1 ? "s" : ""} flagged by AI`,
          body: `${changeSignals.high_ai_impact} open change request${changeSignals.high_ai_impact !== 1 ? "s" : ""} scored ≥70 on AI impact (schedule, cost, or overall).${changeSignals.top_title ? " Top: " + changeSignals.top_title + "." : ""} Review mitigation plans before approving.`,
          href: changesHref({ aiScore: "high" }),
          meta: {
            high_ai_impact: changeSignals.high_ai_impact,
            avg_ai_score: changeSignals.avg_ai_score,
          },
        });
      }

      if (changeSignals.stale > 0) {
        insights.push({
          id: "cr-stale",
          severity: "medium",
          title: `${changeSignals.stale} stale change request${changeSignals.stale !== 1 ? "s" : ""} (14+ days inactive)`,
          body: `${changeSignals.stale} open CR${changeSignals.stale !== 1 ? "s" : ""} haven't been updated in over 14 days. Set decision deadlines or close out to keep the register clean.`,
          href: changesHref({ stale: 1 }),
          meta: { stale: changeSignals.stale },
        });
      }

      if (
        changeSignals.open > 0 &&
        !changeSignals.overdue_review &&
        !changeSignals.pending_approval &&
        !changeSignals.high_ai_impact
      ) {
        insights.push({
          id: "cr-open",
          severity: "info",
          title: `${changeSignals.open} open change request${changeSignals.open !== 1 ? "s" : ""} in progress`,
          body: `${changeSignals.open} change request${changeSignals.open !== 1 ? "s are" : " is"} currently open. Keep owners assigned and review dates set.`,
          href: changesHref(),
          meta: { open: changeSignals.open },
        });
      }
    }

    /* ── Finance Exposure (RAID Financials) ── */
    if (financeSignals.ok && financeSignals.total_exposure > 0) {
      const severity: Insight["severity"] =
        financeSignals.total_exposure >= 500_000
          ? "high"
          : financeSignals.total_exposure >= 100_000
            ? "medium"
            : "info";

      const parts: string[] = [];
      if (financeSignals.cost_exposure > 0) {
        parts.push(`cost impact ${moneyGBP(financeSignals.cost_exposure)}`);
      }
      if (financeSignals.revenue_at_risk > 0) {
        parts.push(`revenue at risk ${moneyGBP(financeSignals.revenue_at_risk)}`);
      }
      if (financeSignals.penalties > 0) {
        parts.push(`penalties ${moneyGBP(financeSignals.penalties)}`);
      }

      insights.push({
        id: "finance-exposure",
        severity,
        title: `${moneyGBP(financeSignals.total_exposure)} total financial exposure across RAID register`,
        body: `Portfolio RAID items carry ${moneyGBP(financeSignals.total_exposure)} in quantified financial exposure (${parts.join(" · ")}). ${financeSignals.high_exposure_count > 0 ? `${financeSignals.high_exposure_count} item${financeSignals.high_exposure_count !== 1 ? "s" : ""} exceed £50k individually — prioritise mitigation.` : "Review and update estimates to maintain financial accuracy."}`,
        href: href("/insights", { tab: "raid" }),
        meta: {
          total_exposure: financeSignals.total_exposure,
          cost_exposure: financeSignals.cost_exposure,
          revenue_at_risk: financeSignals.revenue_at_risk,
          penalties: financeSignals.penalties,
          high_exposure_count: financeSignals.high_exposure_count,
        },
      });
    }

    /* ── Resources / Timesheets ── */
    if (resourceSignals.ok) {
      if (resourceSignals.timesheets_pending > 0) {
        insights.push({
          id: "timesheets-pending",
          severity: resourceSignals.timesheets_pending >= 10 ? "high" : "medium",
          title: `${resourceSignals.timesheets_pending} timesheet${resourceSignals.timesheets_pending !== 1 ? "s" : ""} awaiting approval`,
          body: `${resourceSignals.timesheets_pending} submitted timesheet${resourceSignals.timesheets_pending !== 1 ? "s" : ""} are pending line manager review. Delays in approval hold up resource cost reporting and payroll accuracy.`,
          href: href("/timesheets", { status: "submitted" }),
          meta: { timesheets_pending: resourceSignals.timesheets_pending },
        });
      }

      if (resourceSignals.timesheets_rejected > 0) {
        insights.push({
          id: "timesheets-rejected",
          severity: "medium",
          title: `${resourceSignals.timesheets_rejected} timesheet${resourceSignals.timesheets_rejected !== 1 ? "s" : ""} rejected — resubmission needed`,
          body: `${resourceSignals.timesheets_rejected} timesheet${resourceSignals.timesheets_rejected !== 1 ? "s" : ""} have been rejected and need correction and resubmission by the resource owner.`,
          href: href("/timesheets", { status: "rejected" }),
          meta: { timesheets_rejected: resourceSignals.timesheets_rejected },
        });
      }
    }

    /* ── WBS signals ── */
    const wbsTotal = num(wbsFromArtifacts.totalLeaves);
    const wbsDone = num(wbsFromArtifacts.done);
    const wbsRemaining = num(wbsFromArtifacts.remaining);
    const wbsOverdue = num(wbsFromArtifacts.overdue);
    const wbsDue7 = num(wbsFromArtifacts.due_7);
    const wbsDue14 = num(wbsFromArtifacts.due_14);
    const wbsDue30 = num(wbsFromArtifacts.due_30);
    const wbsDue60 = num(wbsFromArtifacts.due_60);
    const wbsMissingEffort = num(wbsFromArtifacts.missing_effort);
    const wbsStalled = num(rpcWbs?.stalled_inprogress);

    const deepLink =
      wbsFromArtifacts.sample_project_id && wbsFromArtifacts.sample_artifact_id
        ? href(
            `/projects/${wbsFromArtifacts.sample_project_id}/artifacts/${wbsFromArtifacts.sample_artifact_id}`,
            { focus: "wbs" }
          )
        : null;

    if (wbsTotal > 0) {
      if (wbsMissingEffort > 0) {
        insights.push({
          id: "wbs-missing-effort",
          severity: "medium",
          title: "WBS effort gaps",
          body: `${wbsMissingEffort} WBS item(s) missing estimated effort. Fill to improve schedule and capacity accuracy.`,
          href: deepLink || wbsListHref({ missingEffort: 1 }),
          meta: { wbsMissingEffort, wbsTotalLeaves: wbsTotal },
        });
      }

      if (wbsStalled > 0) {
        insights.push({
          id: "wbs-stalled",
          severity: "medium",
          title: "Stalled work packages",
          body: `${wbsStalled} WBS item(s) in progress without updates for 14+ days.`,
          href: wbsListHref({ stalled: 1 }),
          meta: { wbsStalled },
        });
      }

      const wbsPulseSev: Insight["severity"] =
        wbsOverdue > 0 ? "high" : wbsDue7 + wbsDue14 > 0 ? "medium" : "info";
      const overdueNote = wbsOverdue > 0 ? ` • ⚠️ Overdue: ${wbsOverdue}` : "";
      const upcomingClause =
        wbsDue7 + wbsDue14 + wbsDue30 + wbsDue60 > 0
          ? `Upcoming: ${wbsDue7} in 7d • ${wbsDue14} in 8–14d • ${wbsDue30} in 15–30d • ${wbsDue60} in 31–60d.`
          : "No items due in the next 60 days.";

      insights.push({
        id: "wbs-pulse",
        severity: wbsPulseSev,
        title: "WBS schedule pulse",
        body: `${wbsDone} of ${wbsTotal} work package(s) done — ${wbsRemaining} remaining${overdueNote}.\n${upcomingClause}`,
        href: wbsListHref({ days: daysParam }),
        meta: { wbsTotalLeaves: wbsTotal, wbsDone, wbsRemaining, wbsOverdue },
      });
    } else {
      insights.push({
        id: "wbs-empty",
        severity: "info",
        title: "WBS not started",
        body: "No WBS work packages found. Creating a WBS improves delivery control and progress visibility.",
        href: wbsListHref(),
        meta: { wbsTotalLeaves: 0 },
      });
    }

    if (!insights.length) {
      insights.push({
        id: "all-clear",
        severity: "info",
        title: "All clear",
        body: "No major governance signals detected right now. Keep momentum.",
        href: null,
      });
    }

    return jsonOk({
      insights,
      meta: {
        days: daysParam,
        projectCount: projectIds.length,
        filters: filtersActive ? filters : {},
        rpc_data_missing: rpcMissing,
        scope: {
          ...(scoped?.meta || {}),
          scopedIds: scopedIdsRaw.length,
          activeIds: activeIds.length,
          filteredIds: projectIds.length,
          active_filter: activeMeta,
        },
        wbs_computed: wbsFromArtifacts,
        approvals_pending: approvalsPending,
        feeds,
        finance: financeSignals,
        changes: changeSignals,
        resources: resourceSignals,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/ai/briefing]", e);
    return jsonErr(String(e?.message || e || "Briefing failed"), 500);
  }
}