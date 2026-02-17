// src/app/api/ai/briefing/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/**
 * âœ… days can be 7/14/30/60 or "all"
 * - number => windowed
 * - "all"  => unbounded (ALL)
 */
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

/**
 * RPC can return:
 * 1) { ...json }
 * 2) [ { get_portfolio_insights: { ...json } } ]
 * 3) { get_portfolio_insights: { ...json } }
 * 4) stringified JSON
 */
function normalizeInsightsRpc(raw: any) {
  const j = safeJson(raw);

  if (Array.isArray(j) && j.length) {
    const first = j[0];
    if (first?.get_portfolio_insights) return safeJson(first.get_portfolio_insights);
    return safeJson(first);
  }

  if (j?.get_portfolio_insights) return safeJson(j.get_portfolio_insights);

  return j;
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
  if (!s) return "â€”";
  return s.replaceAll("_", " ");
}

/** build href with query params */
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

/**
 * âœ… WBS routing rules in your app:
 * - /wbs redirects to /artifacts
 * - For list-mode and quick-filters:
 *   - Always include view=list
 *   - missingEffort=1
 *   - stalled=1
 */
function wbsListHref(params?: Record<string, any>) {
  return href("/artifacts", { type: "wbs", view: "list", ...(params || {}) });
}

/* ------------------------------------------------------------------ */
/* âœ… project scope helpers (exclude closed/deleted)                    */
/* ------------------------------------------------------------------ */

function uniqStrings(xs: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of xs || []) {
    const s = String(x || "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
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

/**
 * âœ… Filter membership ids down to ACTIVE projects (defensive hardening).
 *
 * Primary schema expectation:
 * - status: 'active' | 'closed' (or similar)
 * - deleted_at: timestamp|null
 * - closed_at: timestamp|null
 *
 * If the projects query fails (RLS / missing cols), we fall back safely.
 *
 * IMPORTANT: This is used even if resolveActiveProjectScope already tries to filter,
 * so we never â€œcountâ€ closed/deleted projects by accident.
 */
async function filterActiveProjectIds(supabase: any, projectIds: string[]) {
  const ids = uniqStrings(projectIds);
  if (!ids.length) return { ok: true, error: null as string | null, projectIds: [] as string[] };

  // Try with expected schema columns
  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, status, deleted_at, closed_at")
      .in("id", ids)
      .limit(10000);

    if (error) {
      if (looksMissingColumn(error) || looksMissingRelation(error)) throw error;
      // can't read projects (RLS etc) â†’ keep ids (don't zero the UI)
      return { ok: false, error: error.message, projectIds: ids };
    }

    const rows = Array.isArray(data) ? data : [];
    const out: string[] = [];

    for (const r of rows) {
      const id = String((r as any)?.id || "").trim();
      if (!id) continue;

      const status = String((r as any)?.status || "").trim().toLowerCase();
      const deletedAt = (r as any)?.deleted_at;
      const closedAt = (r as any)?.closed_at;

      // âœ… exclude anything not active
      if (deletedAt) continue;
      if (status && status !== "active") continue;

      // optional hardening (some rows might have status active but closed_at set)
      if (closedAt) continue;

      out.push(id);
    }

    return { ok: true, error: null, projectIds: uniqStrings(out) };
  } catch {
    // Fallback: just confirm projects exist (still helps drop "ghost" memberships)
    try {
      const { data, error } = await supabase.from("projects").select("id").in("id", ids).limit(10000);
      if (error) return { ok: false, error: error.message, projectIds: ids };

      const rows = Array.isArray(data) ? data : [];
      const out = rows.map((r: any) => String(r?.id || "").trim()).filter(Boolean);
      return { ok: true, error: null, projectIds: uniqStrings(out) };
    } catch (e: any) {
      return { ok: false, error: String(e?.message || e || "projects filter failed"), projectIds: ids };
    }
  }
}

/* ------------------------------------------------------------------ */
/* âœ… WBS stats computed from artifacts.content_json (single source)    */
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
  if (s === "done" || s === "closed" || s === "complete" || s === "completed") return true;
  if (s === "cancelled" || s === "canceled") return true;

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
      missing_row_ids: [],
      scoped_leaf_count_with_due: 0,
    };
  }

  const today = startOfDayUTC(new Date());
  const scopeEnd = days == null ? null : addDaysUTC(today, days);

  // always-pressure buckets
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
  const missingRowIds: string[] = [];

  let scopedLeafWithDue = 0;

  for (let i = 0; i < rows.length; i++) {
    if (rowHasChildren(rows, i)) continue;

    const row = rows[i];
    const isDone = isDoneStatus(row);
    const due = getDueDate(row);

    // Always-pressure due buckets (NOT done)
    if (!isDone && due) {
      const dueDay = startOfDayUTC(due);
      if (dueDay.getTime() < today.getTime()) {
        // overdue contributes to "overdue" only (not in due buckets)
      } else if (dueDay.getTime() <= d7.getTime()) due7++;
      else if (dueDay.getTime() <= d14.getTime()) due14++;
      else if (dueDay.getTime() <= d30.getTime()) due30++;
      else if (dueDay.getTime() <= d60.getTime()) due60++;
    }

    // Core stats are due-date driven
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

  let totalLeaves = 0;
  let done = 0;
  let remaining = 0;
  let overdue = 0;

  // pressure buckets
  let due7 = 0;
  let due14 = 0;
  let due30 = 0;
  let due60 = 0;

  let missingEffort = 0;

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

    // choose sample if we have in-scope effort gaps
    if (!sample_artifact_id && s.missing_effort > 0) {
      sample_project_id = String((r as any)?.project_id || "") || "";
      sample_artifact_id = String((r as any)?.id || "") || "";
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
/* âœ… Approvals signals (best-effort)                                   */
/* ------------------------------------------------------------------ */

async function computeApprovalsPending(supabase: any, projectIds: string[]) {
  // Prefer approval_steps if present
  try {
    const { data, error } = await supabase
      .from("approval_steps")
      .select("id, project_id, status, decided_at")
      .in("project_id", projectIds);

    if (error) {
      if (!looksMissingRelation(error)) throw new Error(error.message);
    } else {
      const pending = (data || []).filter((r: any) => {
        if (r?.decided_at) return false;
        const s = normStr(r?.status);
        return s === "" || s === "pending" || s === "open";
      }).length;
      return pending;
    }
  } catch {
    // ignore and fallback
  }

  // Fallback: artifacts with status containing "pending approval"
  try {
    const { data, error } = await supabase.from("artifacts").select("id, project_id, status").in("project_id", projectIds);

    if (error) return 0;

    const pending = (data || []).filter((r: any) => {
      const s = normStr((r as any)?.status);
      return s.includes("pending") && s.includes("approval");
    }).length;

    return pending;
  } catch {
    return 0;
  }
}

/* ------------------------------------------------------------------ */
/* âœ… Feeds/Activity signals (best-effort, non-breaking)                */
/* ------------------------------------------------------------------ */

type FeedSignals = {
  table: string | null;
  days: number; // lookback used
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
    if (!looksMissingRelation(error)) return t; // exists but query failed for other reasons
  }
  return null;
}

async function computeFeedSignals(supabase: any, projectIds: string[]): Promise<FeedSignals> {
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

  const activeCount = activeProjects.size;
  const staleCount = Math.max(0, projectIds.length - activeCount);

  return {
    table,
    days: 7,
    total_7d: total7,
    total_24h: total24,
    active_projects_7d: activeCount,
    stale_projects_7d: staleCount,
    limited: rows.length >= LIMIT,
  };
}

/* ------------------------------------------------------------------ */
/* âœ… Flow warning signals (HIGH predictive value)                      */
/* ------------------------------------------------------------------ */

type FlowSignals = {
  ok: boolean;
  days: number;
  projects: any[];
  error?: string | null;
};

/**
 * Try RPC: get_flow_warning_signals(p_project_ids, p_days)
 * Returns best-effort structure. If RPC missing, degrade gracefully.
 */
async function fetchFlowWarningSignals(supabase: any, projectIds: string[], days = 30): Promise<FlowSignals> {
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
    | "approvals"
    | "wbs_quality";
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  evidence?: any;
  href?: string | null;
  score?: number; // ordering
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
  totalWip: number;

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
  let totalWip = 0;

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
      if (share > topStageShare) {
        topStageShare = share;
        topStage = bn?.top_stage ? String(bn.top_stage) : null;
        topStageWip = num(bn?.top_stage_wip, 0);
        totalWip = num(bn?.total_wip, 0);
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
    totalWip,
    due30Open,
    expectedDone30,
    slipProbMax,
  };
}

function buildExecutiveAiWarningBody(args: { windowLabel: string; agg: FlowAgg }) {
  const { windowLabel, agg } = args;

  const top = [
    {
      kind: "blockers",
      detail:
        agg.blockedOpenCount > 0
          ? `${pct(agg.blockedRatioPct)}% of open items blocked (${agg.blockedCount}/${agg.blockedOpenCount})`
          : "",
    },
    {
      kind: "bottleneck",
      detail: agg.topStage ? `Stage "${prettyStage(agg.topStage)}" holds ${pct(agg.topStageSharePct)}% of WIP` : "",
    },
    {
      kind: "throughput_forecast",
      detail: agg.slipProbMax >= 45 ? `${clamp01to100(agg.slipProbMax)}% slip probability on upcoming commitments` : "",
    },
  ].filter((w) => w.detail.trim() !== "");

  let body = "";

  if (top.length > 0) {
    body =
      `â€¢ Blockers signal\n attaching: ${top.find((w) => w.kind === "blockers")?.detail || "â€”"}\n\n` +
      `â€¢ Bottleneck signal\n ${top.find((w) => w.kind === "bottleneck")?.detail || "â€”"}\n\n` +
      `â€¢ Slippage risk\n ${top.find((w) => w.kind === "throughput_forecast")?.detail || "â€”"}\n\n` +
      `ðŸ‘‰ Action: Reduce WIP limits and unblock upstream dependencies to restore flow.`;
  } else {
    body =
      `â€¢ No major flow risks detected\n` +
      `Delivery is currently stable.\n\n` +
      `ðŸ‘‰ Action: Maintain cadence and monitor early signals.`;
  }

  return `AI Predictions & Warnings (Next ${windowLabel} Days)\n\n${body}`.trim();
}

function buildFlowWarnings(args: {
  daysParam: 7 | 14 | 30 | 60 | "all";
  projectCount: number;
  flow: FlowSignals;
  approvalsPending: number;
  feeds: FeedSignals;
  wbsMissingEffort: number;
  wbsStalled: number;
}): Warning[] {
  const { daysParam, flow, approvalsPending, feeds, wbsMissingEffort, wbsStalled } = args;

  const warnings: Warning[] = [];
  const windowLabel = daysParam === "all" ? "60" : String(daysParam);

  const agg = computeFlowAgg(flow);

  // 1) Age + cycle outliers
  if (agg.outlierCount > 0) {
    const varFlag = agg.cycleVariancePct >= 25;
    const sev: Warning["severity"] = varFlag ? "high" : agg.outlierCount >= 5 ? "high" : "medium";
    const varText = varFlag ? ` Cycle-time variance is up ${pct(agg.cycleVariancePct)}%.` : "";

    warnings.push({
      kind: "cycle_time_outliers",
      severity: sev,
      score: 100,
      title: "Cycle-time outliers (early slip risk)",
      detail: `${agg.outlierCount} work item(s) are aged >2Ã— average cycle time and due within ${windowLabel}d.${varText}`,
      evidence: { outlierCount: agg.outlierCount, cycleVariancePct: agg.cycleVariancePct },
      href: href("/insights/ai-warning", { days: 30 }),
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
      href: href("/insights/ai-warning", { days: 30 }),
    });
  }

  // 3) Bottleneck (CFD/WIP concentration)
  if (agg.topStage && agg.totalWip > 0) {
    const sev: Warning["severity"] = agg.topStageSharePct >= 55 ? "high" : agg.topStageSharePct >= 40 ? "medium" : "info";

    warnings.push({
      kind: "bottleneck",
      severity: sev,
      score: 80,
      title: "Bottleneck risk (CFD/WIP concentration)",
      detail: `Stage "${prettyStage(agg.topStage)}" holds ${pct(agg.topStageSharePct)}% of WIP (${agg.topStageWip}/${agg.totalWip}). Review WIP limits and unblock upstream flow.`,
      evidence: {
        topStage: agg.topStage,
        topStageShare: pct(agg.topStageSharePct),
        topStageWip: agg.topStageWip,
        totalWip: agg.totalWip,
      },
      href: href("/insights/ai-warning", { days: 30 }),
    });

    if (agg.topStageSharePct >= 60 && agg.totalWip >= 10) {
      warnings.push({
        kind: "wip_queue_expansion",
        severity: "high",
        score: 75,
        title: "Queue expansion in critical stage",
        detail: `WIP is heavily queued in "${prettyStage(agg.topStage)}" (${pct(agg.topStageSharePct)}% share). This typically precedes downstream milestone slip unless capacity is rebalanced.`,
        evidence: { topStage: agg.topStage, topStageShare: pct(agg.topStageSharePct), totalWip: agg.totalWip },
        href: href("/insights/ai-warning", { days: 30 }),
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
      detail: `${p}% chance due-soon commitments slip (based on aging + throughput). Due in 30d: ${agg.due30Open} â€¢ Expected throughput (30d): ${exp}.`,
      evidence: { slip_probability: p, due_30_open: agg.due30Open, expected_done_30d: exp },
      href: href("/insights/ai-warning", { days: 30 }),
    });
  }

  // Secondary predictors
  if (approvalsPending > 0) {
    warnings.push({
      kind: "approvals",
      severity: approvalsPending >= 10 ? "high" : "medium",
      score: 40,
      title: "Approvals at risk of becoming blockers",
      detail: `${approvalsPending} approval(s) pending. Long waits inflate cycle time and increase slip probability.`,
      evidence: { approvalsPending },
      href: href("/approvals", { days: daysParam }),
    });
  }

  if (wbsMissingEffort > 0 || wbsStalled > 0) {
    const sev: Warning["severity"] = wbsStalled > 0 ? "medium" : "info";
    const parts: string[] = [];
    if (wbsMissingEffort > 0) parts.push(`${wbsMissingEffort} missing effort estimate(s)`);
    if (wbsStalled > 0) parts.push(`${wbsStalled} stalled item(s)`);

    warnings.push({
      kind: "wbs_quality",
      severity: sev,
      score: 35,
      title: "Work planning hygiene impacting predictability",
      detail: `${parts.join(" â€¢ ")}. Forecast confidence is reduced until planning hygiene improves.`,
      evidence: { wbsMissingEffort, wbsStalled },
      href: wbsMissingEffort > 0 ? wbsListHref({ missingEffort: 1 }) : wbsListHref({ stalled: 1 }),
    });
  }

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

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return jsonErr("Not authenticated", 401);

    const userId = auth.user.id;

    const url = new URL(req.url);
    const daysParam = clampDays(url.searchParams.get("days"));
    const days: number | null = daysParam === "all" ? null : daysParam;

    // scope to projects user can access (intended: active)
    const scoped = await resolveActiveProjectScope(supabase, userId);
    const scopedIdsRaw = uniqStrings(scoped?.projectIds || []);

    // âœ… Hard guarantee: only ACTIVE projects are counted/queried
    const activeFilter = await filterActiveProjectIds(supabase, scopedIdsRaw);
    const projectIds = activeFilter.projectIds;

    if (!projectIds.length) {
      const res = jsonOk({
        insights: [
          {
            id: "no-projects",
            severity: "info",
            title: "No projects in scope",
            body: "You don't have any active project memberships yet. Join an active project to see insights.",
            href: "/projects",
          },
        ],
        meta: {
          days: daysParam,
          projectCount: 0,
          scope: {
            ...(scoped?.meta || {}),
            scopedIds: scopedIdsRaw.length,
            activeIds: 0,
            active_filter_ok: activeFilter.ok,
            active_filter_error: activeFilter.error || null,
          },
        },
      });
      res.headers.set("Cache-Control", "no-store, max-age=0");
      return res;
    }

    // âœ… Keep RPC for change signals and any existing aggregates you already compute there.
    // IMPORTANT: No RAID duplication in briefing.
    const rpcDays = daysParam === "all" ? 60 : daysParam; // RPC expects number
    const { data, error } = await supabase.rpc("get_portfolio_insights", {
      p_project_ids: projectIds, // âœ… active-only
      p_days: rpcDays,
    });
    if (error) throw new Error(error.message);

    const panel = normalizeInsightsRpc(data) || {};
    const cr = panel?.change_requests || {};
    const rpcWbs = panel?.wbs || {};

    // âœ… WBS computed from artifacts.content_json (active-only)
    const wbsFromArtifacts = await computeWbsStatsFromArtifacts(supabase, projectIds, days);

    // âœ… Approvals + Feeds + Flow telemetry signals (active-only)
    const [approvalsPending, feeds, flow] = await Promise.all([
      computeApprovalsPending(supabase, projectIds),
      computeFeedSignals(supabase, projectIds),
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

    /* ------------------------------------------------------------
     * âœ… AI PREDICTION & WARNINGS (Executive-friendly)
     * ------------------------------------------------------------ */
    {
      const windowLabel = daysParam === "all" ? "60" : String(daysParam);

      const warnings = buildFlowWarnings({
        daysParam,
        projectCount: projectIds.length,
        flow,
        approvalsPending,
        feeds,
        wbsMissingEffort,
        wbsStalled,
      });

      const sevRank = (s: Insight["severity"]) => (s === "high" ? 3 : s === "medium" ? 2 : 1);
      const severity: Insight["severity"] =
        warnings.length > 0
          ? warnings.slice().sort((a, b) => sevRank(b.severity) - sevRank(a.severity))[0].severity
          : "info";

      const agg = computeFlowAgg(flow);
      const executiveBody = buildExecutiveAiWarningBody({ windowLabel, agg });

      insights.push({
        id: "ai-warning",
        severity,
        title: `AI prediction & warnings (next ${windowLabel} days)`,
        body: executiveBody,
        href: href("/insights/ai-warning", { days: 30 }),
        meta: {
          window: daysParam,
          flow_rpc: { ok: flow.ok, days: flow.days, error: flow.error || null },
          flow_agg: {
            blockedCount: agg.blockedCount,
            blockedOpenCount: agg.blockedOpenCount,
            blockedRatioPct: pct(agg.blockedRatioPct),
            blockedLongCount: agg.blockedLongCount,
            topStage: agg.topStage,
            topStageSharePct: pct(agg.topStageSharePct),
            topStageWip: agg.topStageWip,
            totalWip: agg.totalWip,
            due30Open: agg.due30Open,
            expectedDone30: Math.round(agg.expectedDone30 * 10) / 10,
            slipProbMax: clamp01to100(agg.slipProbMax),
          },
          warnings,
        },
      });
    }

    // ------------------------------
    // Change Request Insights
    // ------------------------------
    if (crHi > 0) {
      insights.push({
        id: "cr-hi",
        severity: "medium",
        title: "High/Critical change requests require attention",
        body: `${crHi} high/critical change request(s) are open (out of ${crOpen} open). Prioritise decisioning and impact mitigation.`,
        href: href("/changes", { priority: "High,Critical" }),
        meta: { crHi, crOpen },
      });
    } else if (crOpen > 0) {
      insights.push({
        id: "cr-open",
        severity: "info",
        title: "Change workload in progress",
        body: `${crOpen} open change request(s). Keep flow moving with clear owners and decision dates.`,
        href: href("/changes"),
        meta: { crOpen },
      });
    }

    if (crStale > 0) {
      insights.push({
        id: "cr-stale",
        severity: "medium",
        title: "Stale change requests detected",
        body: `${crStale} change request(s) haven't been updated recently. Recommend nudges, decision deadlines, or close-out.`,
        href: href("/changes", { stale: 1 }),
        meta: { crStale },
      });
    }

    // ------------------------------
    // Approvals
    // ------------------------------
    if (approvalsPending > 0) {
      insights.push({
        id: "approvals-pending",
        severity: approvalsPending >= 10 ? "high" : "medium",
        title: "Pending approvals",
        body: `${approvalsPending} approval(s) are pending. Clear blockers to protect schedule and cost decisions.`,
        href: href("/approvals", { days: daysParam }),
        meta: { approvalsPending },
      });
    }

    // ------------------------------
    // WBS Insights
    // ------------------------------
    const deepLinkIfWeHaveOne =
      wbsFromArtifacts.sample_project_id && wbsFromArtifacts.sample_artifact_id
        ? href(`/projects/${wbsFromArtifacts.sample_project_id}/artifacts/${wbsFromArtifacts.sample_artifact_id}`, {
            focus: "wbs",
          })
        : null;

    if (wbsTotal > 0) {
      if (wbsMissingEffort > 0) {
        insights.push({
          id: "wbs-missing-effort",
          severity: "medium",
          title: "WBS effort gaps",
          body: `${wbsMissingEffort} WBS item(s) are missing estimated effort ${
            daysParam === "all" ? "(all)" : "(in the selected window)"
          }. Fill this to improve schedule and capacity accuracy.`,
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
          meta: { wbsStalled },
        });
      }

      if (wbsMissingEffort === 0 && wbsStalled === 0) {
        insights.push({
          id: "wbs-pulse",
          severity: wbsOverdue > 0 ? "high" : wbsDue7 + wbsDue14 > 0 ? "medium" : "info",
          title: "WBS pulse",
          body:
            `Completed: ${wbsDone} â€¢ Remaining: ${wbsRemaining} â€¢ Overdue: ${wbsOverdue}. ` +
            `Due in 7d: ${wbsDue7} â€¢ 14d: ${wbsDue14} â€¢ 30d: ${wbsDue30} â€¢ 60d: ${wbsDue60}.`,
          href: href("/wbs/pulse", { days: daysParam }),
          meta: {
            wbsTotalLeaves: wbsTotal,
            wbsDone,
            wbsRemaining,
            wbsOverdue,
            wbsDue7,
            wbsDue14,
            wbsDue30,
            wbsDue60,
          },
        });
      }
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

    const res = jsonOk({
      insights,
      meta: {
        days: daysParam,
        projectCount: projectIds.length, // âœ… active-only count
        scope: {
          ...(scoped?.meta || {}),
          scopedIds: scopedIdsRaw.length,
          activeIds: projectIds.length,
          active_filter_ok: activeFilter.ok,
          active_filter_error: activeFilter.error || null,
        },
        raw: panel,
        wbs_computed: wbsFromArtifacts,
        approvals_pending: approvalsPending,
        feeds,
        flow_warning_signals: { ok: flow.ok, days: flow.days, error: flow.error || null },
      },
    });

    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  } catch (e: any) {
    console.error("[GET /api/ai/briefing]", e);
    const res = jsonErr(String(e?.message || e || "Briefing failed"), 500);
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}


