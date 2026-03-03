// src/app/api/ai/briefing/route.ts — REBUILT v3 (ORG-wide + no-store + dedupe + URL filters)
// Fixes applied:
//   ✅ FIX-B1: Uses shared filterActiveProjectIds (exclusion list: closed/deleted/cancelled/archived etc.)
//              (planning / in_progress / on_hold remain active)
//   ✅ FIX-B2: computeFeedSignals — guard undefined projectCreatedAtMap
//              if map missing → stale_projects_7d = 0, limited: true
//   ✅ FIX-B3: wbs_quality Warning deduplicated against wbs-missing-effort Insight
//              removed from buildFlowWarnings — insight-level signal owns it
//   ✅ FIX-B4: ai-warning insight href uses daysParam (normalised) not hardcoded 30
//   ✅ FIX-B5: wbsPulseSev body text clarifies: overdue is windowed, pressure buckets are always absolute
//   ✅ FIX-B6: ORG-WIDE active project scope (all projects in user's organisation) with membership fallback
//   ✅ FIX-B7: Cache-Control: no-store on ALL responses (ok + err)
//   ✅ FIX-B8: Apply org-portfolio URL filters (q, projectId, projectCode, pm, dept) server-side

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import {
  resolveOrgActiveProjectScope,
  resolveActiveProjectScope,
  filterActiveProjectIds,
} from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

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
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? (n as 7 | 14 | 30 | 60) : 7;
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

function normalizeInsightsRpc(raw: any): { data: any; missing: boolean } {
  const j = safeJson(raw);
  if (!j) return { data: null, missing: true };
  if (Array.isArray(j) && j.length) {
    const first = j[0];
    if (first?.get_portfolio_insights) return { data: safeJson(first.get_portfolio_insights), missing: false };
    return { data: safeJson(first), missing: false };
  }
  if (j?.get_portfolio_insights) return { data: safeJson(j.get_portfolio_insights), missing: false };
  const keys = Object.keys(j);
  if (keys.length === 0) return { data: j, missing: true };
  return { data: j, missing: false };
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
  if (!s) return "—";
  return s.replaceAll("_", " ");
}

function href(path: string, params?: Record<string, string | number | boolean | null | undefined>) {
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

/* ------------------------------------------------------------------ */
/* project scope + portfolio filters helpers                            */
/* ------------------------------------------------------------------ */

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

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function uniqList(input: any): string[] {
  const arr: string[] = [];
  const push = (v: any) => {
    const s = safeStr(v).trim();
    if (!s) return;
    arr.push(s);
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
  pm?: string[];   // project_manager_id
  dept?: string[]; // department (string match)
};

function readPortfolioFiltersFromUrl(url: URL): PortfolioFilters {
  const q = safeStr(url.searchParams.get("q")).trim() || undefined;
  const projectId = uniqList(url.searchParams.getAll("projectId").flatMap((x) => x.split(",")));
  const projectCode = uniqList(url.searchParams.getAll("projectCode").flatMap((x) => x.split(",")));
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
      (f.projectId && f.projectId.length) ||
      (f.projectCode && f.projectCode.length) ||
      (f.pm && f.pm.length) ||
      (f.dept && f.dept.length),
  );
}

async function applyPortfolioFiltersToProjectIds(args: {
  supabase: any;
  baseProjectIds: string[];
  filters: PortfolioFilters;
}): Promise<{ projectIds: string[]; limited: boolean; reason?: string | null }> {
  const { supabase, baseProjectIds, filters } = args;
  const ids = uniqStrings(baseProjectIds);
  if (!ids.length) return { projectIds: [], limited: false };

  if (!hasActiveFilters(filters)) return { projectIds: ids, limited: false };

  // We filter on these fields; if any are missing in your schema, we degrade gracefully.
  let rows: any[] = [];
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, title, project_code, project_manager_id, department")
      .in("id", ids)
      .limit(10000);

    if (error) {
      // If RLS/column issues, keep base scope (better than empty dashboard)
      if (looksMissingRelation(error) || looksMissingColumn(error)) {
        return { projectIds: ids, limited: true, reason: error.message || "projects select failed" };
      }
      return { projectIds: ids, limited: true, reason: error.message || "projects select failed" };
    }

    rows = Array.isArray(data) ? data : [];
  } catch (e: any) {
    return { projectIds: ids, limited: true, reason: String(e?.message || e || "projects select failed") };
  }

  const q = safeStr(filters.q).trim().toLowerCase();
  const idSet = new Set((filters.projectId || []).map((s) => safeStr(s).trim()).filter(Boolean));
  const codeNeedles = (filters.projectCode || []).map((s) => safeStr(s).trim().toLowerCase()).filter(Boolean);
  const pmSet = new Set((filters.pm || []).map((s) => safeStr(s).trim()).filter(Boolean));
  const deptNeedles = (filters.dept || []).map((s) => safeStr(s).trim().toLowerCase()).filter(Boolean);

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
      if (deptNeedles.length && (!dept || !deptNeedles.some((d) => dept.includes(d)))) return false;

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

/* ------------------------------------------------------------------ */
/* WBS stats computed from artifacts.content_json                      */
/* ------------------------------------------------------------------ */

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
  effort?: "S" | "M" | "L" | string | null;
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
  if (s === "done" || s === "closed" || s === "complete" || s === "completed" || s === "cancelled" || s === "canceled")
    return true;
  const p = Number((row as any)?.progress);
  if (Number.isFinite(p) && p >= 100) return true;
  return false;
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
  const e = String((row as any)?.effort ?? "").trim().toUpperCase();
  return e === "S" || e === "M" || e === "L";
}

type WbsComputed = {
  totalLeaves: number;
  done: number;
  remaining: number;
  overdue: number;
  missing_effort: number;
  due_7: number;
  due_14: number;
  due_30: number;
  due_60: number;
  missing_row_ids: string[];
  scoped_leaf_count_with_due: number;
};

function calcWbsLeafStats(doc: any, days: number | null): WbsComputed {
  const rows = safeArr(doc?.rows) as WbsRow[];
  if (!rows.length)
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
      missing_row_ids: [],
      scoped_leaf_count_with_due: 0,
    };

  const today = startOfDayUTC(new Date());
  const scopeEnd = days == null ? null : addDaysUTC(today, days);
  const d7 = addDaysUTC(today, 7);
  const d14 = addDaysUTC(today, 14);
  const d30 = addDaysUTC(today, 30);
  const d60 = addDaysUTC(today, 60);

  let totalLeaves = 0,
    done = 0,
    remaining = 0,
    overdue = 0,
    due7 = 0,
    due14 = 0,
    due30 = 0,
    due60 = 0,
    missingEffort = 0,
    scopedLeafWithDue = 0;

  const missingRowIds: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    if (rowHasChildren(rows, i)) continue;
    const row = rows[i];
    const isDone = isDoneStatus(row);
    const due = getDueDate(row);

    if (!isDone && due) {
      const dueDay = startOfDayUTC(due);
      if (dueDay.getTime() < today.getTime()) {
        /* overdue counted below */
      } else if (dueDay.getTime() <= d7.getTime()) due7++;
      else if (dueDay.getTime() <= d14.getTime()) due14++;
      else if (dueDay.getTime() <= d30.getTime()) due30++;
      else if (dueDay.getTime() <= d60.getTime()) due60++;
    }

    if (!due) continue;

    const dueDay = startOfDayUTC(due);

    let inScope = true;
    if (scopeEnd) {
      inScope = dueDay.getTime() < today.getTime() || dueDay.getTime() <= scopeEnd.getTime();
    }
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

async function computeWbsStatsFromArtifacts(supabase: any, projectIds: string[], days: number | null) {
  const { data: rows, error } = await supabase
    .from("artifacts")
    .select("id, project_id, type, updated_at, created_at, content_json, content")
    .in("project_id", projectIds)
    .eq("type", "wbs");

  if (error) throw new Error(error.message);

  let totalLeaves = 0,
    done = 0,
    remaining = 0,
    overdue = 0,
    due7 = 0,
    due14 = 0,
    due30 = 0,
    due60 = 0,
    missingEffort = 0;

  let sample_project_id = "";
  let sample_artifact_id = "";

  for (const r of rows || []) {
    const doc = safeJson((r as any)?.content_json) ?? safeJson((r as any)?.content) ?? null;
    const dtype = String(doc?.type || "").trim().toLowerCase();
    const ver = Number(doc?.version);
    if (!(dtype === "wbs" && ver === 1 && Array.isArray(doc?.rows))) continue;

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

    if (!sample_artifact_id && s.missing_effort > 0) {
      sample_project_id = String((r as any)?.project_id || "");
      sample_artifact_id = String((r as any)?.id || "");
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
    sample_project_id,
    sample_artifact_id,
  };
}

/* ------------------------------------------------------------------ */
/* Approvals signals (best-effort)                                     */
/* ------------------------------------------------------------------ */

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
    const { data, error } = await supabase.from("artifacts").select("id, project_id, status").in("project_id", projectIds);
    if (error) return 0;
    return (data || []).filter((r: any) => {
      const s = normStr((r as any)?.status);
      return s.includes("pending") && s.includes("approval");
    }).length;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* Feeds/Activity signals (best-effort)                               */
/* ------------------------------------------------------------------ */

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
    const { error } = await supabase.from(t).select("id", { head: true, count: "exact" }).limit(1);
    if (!error) return t;
    if (!looksMissingRelation(error)) return t;
  }
  return null;
}

async function computeFeedSignals(
  supabase: any,
  projectIds: string[],
  projectCreatedAtMap?: Map<string, Date>,
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

  // ✅ FIX-B2: if projectCreatedAtMap is undefined, stale is unknown → 0 + limited=true
  let staleCount = 0;
  if (projectCreatedAtMap !== undefined) {
    const sevenDaysAgo = since7;
    let eligibleForStaleCount = 0;
    for (const pid of projectIds) {
      const createdAt = projectCreatedAtMap.get(pid);
      if (!createdAt || createdAt.getTime() <= sevenDaysAgo.getTime()) eligibleForStaleCount++;
    }
    staleCount = Math.max(0, eligibleForStaleCount - activeProjects.size);
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

/* ------------------------------------------------------------------ */
/* Flow warning signals                                                */
/* ------------------------------------------------------------------ */

type FlowSignals = { ok: boolean; days: number; projects: any[]; error?: string | null };

async function fetchFlowWarningSignals(supabase: any, projectIds: string[], days = 30): Promise<FlowSignals> {
  try {
    const { data, error } = await supabase.rpc("get_flow_warning_signals", { p_project_ids: projectIds, p_days: days });
    if (error) {
      if (looksMissingRelation(error)) return { ok: false, days, projects: [], error: "flow RPC missing" };
      return { ok: false, days, projects: [], error: error.message || "flow RPC error" };
    }
    const j = safeJson(data) ?? data;
    const daysOut = num(j?.days, days);
    const projects = Array.isArray(j?.projects) ? j.projects : [];
    return { ok: true, days: daysOut, projects };
  } catch (e: any) {
    return { ok: false, days, projects: [], error: String(e?.message || e || "flow RPC failed") };
  }
}

type Warning = {
  kind:
    | "cycle_time_outliers"
    | "blockers"
    | "bottleneck"
    | "throughput_forecast"
    | "wip_queue_expansion"
    | "linked_risk_to_due_milestone"
    | "feed_cadence"
    | "approvals";
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  evidence?: any;
  href?: string | null;
  score?: number;
};

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
  let outlierCount = 0,
    cycleVariancePct = 0,
    blockedCount = 0,
    blockedOpenCount = 0,
    blockedLongCount = 0;
  let topStage: string | null = null,
    topStageShare = 0,
    topStageWip = 0,
    topProjectTotalWip = 0,
    portfolioTotalWip = 0;
  let due30Open = 0,
    expectedDone30 = 0,
    slipProbMax = 0;

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
      const projectTotalWip = num(bn?.total_wip, 0);
      portfolioTotalWip += projectTotalWip;

      if (share > topStageShare) {
        topStageShare = share;
        topStage = bn?.top_stage ? String(bn.top_stage) : null;
        topStageWip = num(bn?.top_stage_wip, 0);
        topProjectTotalWip = projectTotalWip;
      }

      const fc = p?.forecast || {};
      due30Open += num(fc?.due_30_open, 0);
      expectedDone30 += Number(fc?.expected_done_30d ?? 0) || 0;
      slipProbMax = Math.max(slipProbMax, clamp01to100(fc?.slip_probability));

      const cv = p?.cycle_time_variance_pct;
      if (cv != null) cycleVariancePct = Math.max(cycleVariancePct, num(cv, 0));
    }
  }

  const blockedRatioPct = blockedOpenCount > 0 ? (blockedCount / blockedOpenCount) * 100 : 0;

  return {
    outlierCount,
    cycleVariancePct,
    blockedCount,
    blockedOpenCount,
    blockedRatioPct,
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

function buildExecutiveAiWarningBody(args: { windowLabel: string; warnings: Warning[]; agg: FlowAgg }) {
  const { windowLabel, warnings, agg } = args;

  if (warnings.length === 0) {
    return `AI Predictions & Warnings (Next ${windowLabel} Days)\n\n• No major risks detected\nDelivery is currently stable.\n\n👉 Action: Maintain cadence and monitor early signals.`;
  }

  const highWarnings = warnings.filter((w) => w.severity === "high");
  const mediumWarnings = warnings.filter((w) => w.severity === "medium");

  const lines: string[] = [];
  for (const w of highWarnings) lines.push(`🔴 ${w.title}\n   ${w.detail}`);
  for (const w of mediumWarnings) lines.push(`🟡 ${w.title}\n   ${w.detail}`);

  const topWarning = warnings[0];
  let action = "Review flagged items and assign owners.";

  if (topWarning.kind === "blockers" || topWarning.kind === "cycle_time_outliers")
    action = "Escalate blockers and assign owners to at-risk items immediately.";
  else if (topWarning.kind === "bottleneck" || topWarning.kind === "wip_queue_expansion")
    action = "Reduce WIP limits and rebalance capacity to unblock downstream flow.";
  else if (topWarning.kind === "throughput_forecast")
    action = `Review delivery commitments — ${clamp01to100(agg.slipProbMax)}% slip probability on upcoming milestones.`;
  else if (topWarning.kind === "approvals") action = "Clear pending approvals to prevent cycle-time inflation.";

  return `AI Predictions & Warnings (Next ${windowLabel} Days)\n\n${(lines.join("\n\n") + `\n\n👉 Action: ${action}`).trim()}`;
}

// ✅ FIX-B3: wbs_quality warning intentionally excluded here
function buildFlowWarnings(args: {
  daysParam: 7 | 14 | 30 | 60 | "all";
  flow: FlowSignals;
  approvalsPending: number;
  feeds: FeedSignals;
}): Warning[] {
  const { daysParam, flow, approvalsPending, feeds } = args;
  const warnings: Warning[] = [];

  // ✅ FIX-B4: normalise daysParam for hrefs — "all" → 60
  const hrefDays = daysParam === "all" ? 60 : daysParam;
  const windowLabel = String(hrefDays);

  const agg = computeFlowAgg(flow);

  // 1) Age + cycle outliers
  if (agg.outlierCount > 0) {
    const varFlag = agg.cycleVariancePct >= 25;
    const sev: Warning["severity"] = varFlag ? "high" : agg.outlierCount >= 5 ? "high" : "medium";
    warnings.push({
      kind: "cycle_time_outliers",
      severity: sev,
      score: 100,
      title: "Cycle-time outliers (early slip risk)",
      detail: `${agg.outlierCount} work item(s) are aged >2× average cycle time and due within ${windowLabel}d.${varFlag ? ` Cycle-time variance is up ${pct(agg.cycleVariancePct)}%.` : ""}`,
      evidence: { outlierCount: agg.outlierCount, cycleVariancePct: agg.cycleVariancePct },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });
  }

  // 2) Blockers
  if (agg.blockedCount > 0 || agg.blockedLongCount > 0) {
    const sev: Warning["severity"] =
      agg.blockedLongCount > 0 || agg.blockedRatioPct >= 15 ? "high" : agg.blockedRatioPct >= 10 ? "medium" : "info";
    warnings.push({
      kind: "blockers",
      severity: sev,
      score: 90,
      title: "Blockers accumulating (stall risk)",
      detail:
        agg.blockedOpenCount > 0
          ? `${pct(agg.blockedRatioPct)}% of open items have been blocked in the last 30 days (${agg.blockedCount}/${agg.blockedOpenCount}). Long-blocked: ${agg.blockedLongCount}.`
          : `${agg.blockedCount} blocked item(s) detected in the last 30 days. Long-blocked: ${agg.blockedLongCount}.`,
      evidence: {
        blockedCount: agg.blockedCount,
        openCount: agg.blockedOpenCount,
        blockedRatio: pct(agg.blockedRatioPct),
        blockedLongCount: agg.blockedLongCount,
      },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });
  }

  // 3) Bottleneck
  if (agg.topStage && agg.topProjectTotalWip > 0) {
    const sev: Warning["severity"] = agg.topStageSharePct >= 55 ? "high" : agg.topStageSharePct >= 40 ? "medium" : "info";
    warnings.push({
      kind: "bottleneck",
      severity: sev,
      score: 80,
      title: "Bottleneck risk (CFD/WIP concentration)",
      detail: `Stage "${prettyStage(agg.topStage)}" holds ${pct(agg.topStageSharePct)}% of WIP (${agg.topStageWip}/${agg.topProjectTotalWip}). Review WIP limits and unblock upstream flow.`,
      evidence: {
        topStage: agg.topStage,
        topStageShare: pct(agg.topStageSharePct),
        topStageWip: agg.topStageWip,
        topProjectTotalWip: agg.topProjectTotalWip,
        portfolioTotalWip: agg.portfolioTotalWip,
      },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });

    if (agg.topStageSharePct >= 60 && agg.topProjectTotalWip >= 10) {
      warnings.push({
        kind: "wip_queue_expansion",
        severity: "high",
        score: 75,
        title: "Queue expansion in critical stage",
        detail: `WIP is heavily queued in "${prettyStage(agg.topStage)}" (${pct(agg.topStageSharePct)}% share). This typically precedes downstream milestone slip unless capacity is rebalanced.`,
        evidence: { topStage: agg.topStage, topStageShare: pct(agg.topStageSharePct), portfolioTotalWip: agg.portfolioTotalWip },
        href: href("/insights/ai-warning", { days: hrefDays }),
      });
    }
  }

  // 4) Throughput forecast
  if (agg.due30Open > 0) {
    const p = clamp01to100(agg.slipProbMax);
    const sev: Warning["severity"] = p >= 70 ? "high" : p >= 45 ? "medium" : "info";
    const exp = Math.round(agg.expectedDone30 * 10) / 10;
    warnings.push({
      kind: "throughput_forecast",
      severity: sev,
      score: 70,
      title: "Throughput-based slip forecast",
      detail: `${p}% chance due-soon commitments slip (based on aging + throughput). Due in 30d: ${agg.due30Open} • Expected throughput (30d): ${exp}.`,
      evidence: { slip_probability: p, due_30_open: agg.due30Open, expected_done_30d: exp },
      href: href("/insights/ai-warning", { days: hrefDays }),
    });
  }

  // 5) Approvals
  if (approvalsPending > 0) {
    warnings.push({
      kind: "approvals",
      severity: approvalsPending >= 10 ? "high" : "medium",
      score: 40,
      title: "Approvals at risk of becoming blockers",
      detail: `${approvalsPending} approval(s) pending. Long waits inflate cycle time and increase slip probability.`,
      evidence: { approvalsPending },
      href: href("/approvals", { days: hrefDays }),
    });
  }

  // 6) Feed cadence
  if (feeds.table && feeds.stale_projects_7d > 0) {
    warnings.push({
      kind: "feed_cadence",
      severity: "medium",
      score: 30,
      title: "Delivery cadence risk (low activity)",
      detail: `${feeds.stale_projects_7d} project(s) have had no updates in 7 days. Low signal often hides blockers and cycle-time creep.`,
      evidence: feeds,
      href: href("/activity", { scope: "stale", days: 7 }),
    });
  }

  const sevRank = (s: Warning["severity"]) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
  warnings.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || sevRank(b.severity) - sevRank(a.severity));
  return warnings;
}

/* ------------------------------------------------------------------ */
/* handler                                                             */
/* ------------------------------------------------------------------ */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return jsonErr("Not authenticated", 401);

    const userId = auth.user.id;
    const url = new URL(req.url);

    const daysParam = clampDays(url.searchParams.get("days"));
    const days: number | null = daysParam === "all" ? null : daysParam;

    // ✅ FIX-B8: URL-driven portfolio filters (same as HomePage)
    const filters = readPortfolioFiltersFromUrl(url);
    const filtersActive = hasActiveFilters(filters);

    // ✅ FIX-B6: ORG-WIDE scope first (all projects in org), fallback to membership scope
    let scoped: any = null;
    let scopedIdsRaw: string[] = [];

    try {
      scoped = await resolveOrgActiveProjectScope(supabase, userId);
      scopedIdsRaw = uniqStrings(scoped?.projectIds || []);
    } catch (e: any) {
      scoped = { ok: false, error: String(e?.message || e || "org scope failed"), meta: null, projectIds: [] };
      scopedIdsRaw = [];
    }

    if (!scopedIdsRaw.length) {
      const fallback = await resolveActiveProjectScope(supabase, userId);
      scoped = fallback;
      scopedIdsRaw = uniqStrings(fallback?.projectIds || []);
    }

    // ✅ FIX-B1: shared active filter (exclusion list)
    const activeFilter = await filterActiveProjectIds(supabase, scopedIdsRaw);
    const activeProjectIds = uniqStrings(activeFilter?.projectIds || []);

    // ✅ FIX-B8: apply filters after "active" exclusion, so everything stays consistent
    const filteredRes = await applyPortfolioFiltersToProjectIds({
      supabase,
      baseProjectIds: activeProjectIds,
      filters,
    });
    const projectIds = uniqStrings(filteredRes?.projectIds || []);

    if (!projectIds.length) {
      return jsonOk({
        insights: [
          {
            id: filtersActive ? "no-projects-after-filters" : "no-projects",
            severity: "info",
            title: filtersActive ? "No projects match your filters" : "No projects in scope",
            body: filtersActive
              ? "Your current portfolio filters returned zero active projects. Clear filters to see the full organisation portfolio."
              : "You don't have any active projects yet in your organisation. Create or join an active project to see insights.",
            href: filtersActive ? "/home" : "/projects",
          },
        ],
        meta: {
          days: daysParam,
          projectCount: 0,
          filters: filtersActive ? filters : {},
          scope: {
            ...(scoped?.meta || {}),
            scopedIds: scopedIdsRaw.length,
            activeIds: activeProjectIds.length,
            filteredIds: 0,
            filtered_limited: Boolean(filteredRes?.limited),
            filtered_reason: filteredRes?.reason || null,
            active_filter_ok: Boolean(activeFilter?.ok),
            active_filter_error: activeFilter?.error || null,
          },
        },
      });
    }

    // ✅ FIX-B4: normalised href days — used in ai-warning insight + approvals link
    const hrefDays = daysParam === "all" ? 60 : daysParam;
    const rpcDays = daysParam === "all" ? 60 : daysParam;

    const { data, error } = await supabase.rpc("get_portfolio_insights", { p_project_ids: projectIds, p_days: rpcDays });
    if (error) throw new Error(error.message);

    const { data: panel, missing: rpcMissing } = normalizeInsightsRpc(data);
    const safePanel = panel || {};
    const cr = safePanel?.change_requests || {};
    const rpcWbs = safePanel?.wbs || {};

    const wbsFromArtifacts = await computeWbsStatsFromArtifacts(supabase, projectIds, days);

    // Build project created_at map for accurate stale detection
    let projectCreatedAtMap: Map<string, Date> | undefined;
    try {
      const { data: projRows } = await supabase.from("projects").select("id, created_at").in("id", projectIds).limit(10000);
      if (Array.isArray(projRows)) {
        projectCreatedAtMap = new Map<string, Date>();
        for (const r of projRows) {
          const id = String((r as any)?.id || "").trim();
          const ts = safeDate((r as any)?.created_at);
          if (id && ts) projectCreatedAtMap.set(id, ts);
        }
      }
    } catch {
      // computeFeedSignals handles undefined map (✅ FIX-B2)
    }

    const [approvalsPending, feeds, flow] = await Promise.all([
      computeApprovalsPending(supabase, projectIds),
      computeFeedSignals(supabase, projectIds, projectCreatedAtMap),
      fetchFlowWarningSignals(supabase, projectIds, 30),
    ]);

    const crOpen = num(cr?.open_total);
    const crHi = num(cr?.hi_total);
    const crStale = num(cr?.stale_total);

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

    type Insight = {
      id: string;
      severity: "high" | "medium" | "info";
      title: string;
      body: string;
      href?: string | null;
      meta?: any;
    };

    const insights: Insight[] = [];

    /* ─────────────────────────────────────────────────────────────
     * AI PREDICTION & WARNINGS (Executive-friendly)
     * ✅ FIX-B3: wbs_quality removed from flow warnings (deduped)
     * ✅ FIX-B4: href uses hrefDays not hardcoded 30
     * ───────────────────────────────────────────────────────────── */
    {
      const windowLabel = String(hrefDays);
      const warnings = buildFlowWarnings({ daysParam, flow, approvalsPending, feeds });

      const sevRank = (s: Insight["severity"]) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
      const severity: Insight["severity"] =
        warnings.length > 0 ? warnings.slice().sort((a, b) => sevRank(b.severity) - sevRank(a.severity))[0].severity : "info";

      const agg = computeFlowAgg(flow);
      const executiveBody = buildExecutiveAiWarningBody({ windowLabel, warnings, agg });

      insights.push({
        id: "ai-warning",
        severity,
        title: `AI prediction & warnings (next ${windowLabel} days)`,
        body: executiveBody,
        href: href("/insights/ai-warning", { days: hrefDays }),
        meta: {
          window: daysParam,
          rpc_data_missing: rpcMissing,
          stale_count_limited: feeds.limited,
          flow_rpc: { ok: flow.ok, days: flow.days, error: flow.error || null },
          flow_agg: {
            blockedCount: agg.blockedCount,
            blockedOpenCount: agg.blockedOpenCount,
            blockedRatioPct: pct(agg.blockedRatioPct),
            blockedLongCount: agg.blockedLongCount,
            topStage: agg.topStage,
            topStageSharePct: pct(agg.topStageSharePct),
            topStageWip: agg.topStageWip,
            topProjectTotalWip: agg.topProjectTotalWip,
            portfolioTotalWip: agg.portfolioTotalWip,
            due30Open: agg.due30Open,
            expectedDone30: Math.round(agg.expectedDone30 * 10) / 10,
            slipProbMax: clamp01to100(agg.slipProbMax),
          },
          warnings,
        },
      });
    }

    // Change Request Insights
    if (crHi > 0) {
      insights.push({
        id: "cr-hi",
        severity: "medium",
        title: "High/Critical change requests require attention",
        body: `${crHi} high/critical change request(s) are open (out of ${crOpen} open). Prioritise decisioning and impact mitigation.`,
        href: changesHref({ priority: "High,Critical" }),
        meta: { crHi, crOpen },
      });
    } else if (crOpen > 0) {
      insights.push({
        id: "cr-open",
        severity: "info",
        title: "Change workload in progress",
        body: `${crOpen} open change request(s). Keep flow moving with clear owners and decision dates.`,
        href: changesHref(),
        meta: { crOpen },
      });
    }
    if (crStale > 0) {
      insights.push({
        id: "cr-stale",
        severity: "medium",
        title: "Stale change requests detected",
        body: `${crStale} change request(s) haven't been updated recently. Recommend nudges, decision deadlines, or close-out.`,
        href: changesHref({ stale: 1 }),
        meta: { crStale },
      });
    }

    // Approvals
    if (approvalsPending > 0) {
      insights.push({
        id: "approvals-pending",
        severity: approvalsPending >= 10 ? "high" : "medium",
        title: "Pending approvals",
        body: `${approvalsPending} approval(s) are pending. Clear blockers to protect schedule and cost decisions.`,
        href: href("/approvals", { days: hrefDays }),
        meta: { approvalsPending },
      });
    }

    // WBS Insights
    const deepLinkIfWeHaveOne =
      wbsFromArtifacts.sample_project_id && wbsFromArtifacts.sample_artifact_id
        ? href(`/projects/${wbsFromArtifacts.sample_project_id}/artifacts/${wbsFromArtifacts.sample_artifact_id}`, { focus: "wbs" })
        : null;

    if (wbsTotal > 0) {
      if (wbsMissingEffort > 0) {
        insights.push({
          id: "wbs-missing-effort",
          severity: "medium",
          title: "WBS effort gaps",
          body: `${wbsMissingEffort} WBS item(s) are missing estimated effort${daysParam === "all" ? "" : " (in the selected window)"}. Fill this to improve schedule and capacity accuracy.`,
          href: deepLinkIfWeHaveOne || wbsListHref({ missingEffort: 1 }),
          meta: {
            wbsMissingEffort,
            wbsTotalLeaves: wbsTotal,
            sample_project_id: wbsFromArtifacts.sample_project_id,
            sample_artifact_id: wbsFromArtifacts.sample_artifact_id,
          },
        });
      }

      if (wbsStalled > 0) {
        insights.push({
          id: "wbs-stalled",
          severity: "medium",
          title: "Stalled work packages",
          body: `${wbsStalled} WBS item(s) have been in progress without updates for 14+ days. Validate blockers and reset ownership.`,
          href: wbsListHref({ stalled: 1 }),
          meta: { wbsStalled, rpc_data_present: !rpcMissing },
        });
      }

      // ✅ FIX-B5: Clarify bucket scopes in body text
      const wbsPulseSev: Insight["severity"] = wbsOverdue > 0 ? "high" : wbsDue7 + wbsDue14 > 0 ? "medium" : "info";
      const overdueNote =
        daysParam === "all"
          ? wbsOverdue > 0
            ? ` • ⚠️ Overdue: ${wbsOverdue}`
            : ""
          : wbsOverdue > 0
            ? ` • ⚠️ Overdue within ${daysParam}d window: ${wbsOverdue}`
            : "";

      const upcomingClause =
        wbsDue7 + wbsDue14 + wbsDue30 + wbsDue60 > 0
          ? `Upcoming (absolute): ${wbsDue7} in 7d • ${wbsDue14} in 8–14d • ${wbsDue30} in 15–30d • ${wbsDue60} in 31–60d.`
          : "No items due in the next 60 days.";

      insights.push({
        id: "wbs-pulse",
        severity: wbsPulseSev,
        title: "WBS schedule pulse",
        body: `${wbsDone} of ${wbsTotal} work package(s) done — ${wbsRemaining} remaining${overdueNote}.\n${upcomingClause}`,
        href: wbsListHref({ days: daysParam }),
        meta: { wbsTotalLeaves: wbsTotal, wbsDone, wbsRemaining, wbsOverdue, wbsDue7, wbsDue14, wbsDue30, wbsDue60 },
      });
    } else {
      insights.push({
        id: "wbs-empty",
        severity: "info",
        title: "WBS not started",
        body: "No WBS work packages found yet in this selection. Creating a WBS improves delivery control and progress visibility.",
        href: wbsListHref(),
        meta: { wbsTotalLeaves: 0 },
      });
    }

    if (!insights.length) {
      insights.push({
        id: "all-clear",
        severity: "info",
        title: "All clear",
        body: "No major governance signals detected right now. Keep momentum and check back later.",
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
        wbs_stalled_from_rpc: !rpcMissing,
        scope: {
          ...(scoped?.meta || {}),
          scopedIds: scopedIdsRaw.length,
          activeIds: activeProjectIds.length,
          filteredIds: projectIds.length,
          filtered_limited: Boolean(filteredRes?.limited),
          filtered_reason: filteredRes?.reason || null,
          active_filter_ok: Boolean(activeFilter?.ok),
          active_filter_error: activeFilter?.error || null,
        },
        raw: safePanel,
        wbs_computed: wbsFromArtifacts,
        approvals_pending: approvalsPending,
        feeds,
        flow_warning_signals: { ok: flow.ok, days: flow.days, error: flow.error || null },
      },
    });
  } catch (e: any) {
    console.error("[GET /api/ai/briefing]", e);
    return jsonErr(String(e?.message || e || "Briefing failed"), 500);
  }
}