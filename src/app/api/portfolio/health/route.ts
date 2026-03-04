// src/app/api/portfolio/health/route.ts — REBUILT v8 (Org-wide scope + filter-ready + active project filter FIXED)
// Adds / Fixes:
//   ✅ PH-F1 filters (GET + POST)
//   ✅ PH-F2 filters applied within ORG scope (resolveOrgActiveProjectScope)
//   ✅ PH-F3 best-effort degradation
//   ✅ PH-F4 better “missing column” tolerance in filter pre-read (projects select fallbacks)
//   ✅ PH-F5 active project filter contract fixed (helper returns string[]), plus FAIL-OPEN safeguard
// Keeps:
//   ✅ FIX-PH1 stale cadence excludes projects created < 7 days ago
//   ✅ no-store caching

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

/* ---------------- small utils ---------------- */

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

// ✅ Consistent with other endpoints: accepts "all" and returns union
function clampDaysParam(v: any): 7 | 14 | 30 | 60 | "all" {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return Number.isFinite(n) && allowed.has(n) ? (n as 7 | 14 | 30 | 60) : 30;
}

function normalizeWindowDays(daysParam: 7 | 14 | 30 | 60 | "all"): 7 | 14 | 30 | 60 {
  return daysParam === "all" ? 60 : daysParam;
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function clamp0to100(n: any) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function ymd(d: Date) {
  return d.toISOString().slice(0, 10);
}

function addDaysISO(iso: string, days: number) {
  const dt = new Date(`${iso}T00:00:00.000Z`);
  dt.setUTCDate(dt.getUTCDate() + days);
  return ymd(dt);
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

/* ---------------- scoring ---------------- */

type ScheduleAgg = {
  days: number;
  milestones_due_window: number;
  milestones_overdue: number;
  critical_overdue: number;
  avg_slip_days: number;
  max_slip_days: number;
  ai_high_risk_due_window: number;
};

function computeScheduleScore(k: ScheduleAgg | null) {
  if (!k) return { score: 85, note: "Schedule data unavailable." };
  const due = num(k.milestones_due_window, 0);
  const overdue = num(k.milestones_overdue, 0);
  const critOverdue = num(k.critical_overdue, 0);
  const avgSlip = num(k.avg_slip_days, 0);
  const maxSlip = num(k.max_slip_days, 0);
  const aiHigh = num(k.ai_high_risk_due_window, 0);

  if (due === 0 && overdue === 0) return { score: 100, note: "No milestones due or overdue in the selected window." };

  let score = 100;
  score -= Math.min(45, overdue * 10);
  score -= Math.min(20, critOverdue * 12);
  score -= Math.min(20, aiHigh * 4);
  if (avgSlip > 0) score -= Math.min(15, Math.round(avgSlip * 1.5));
  if (maxSlip > 0) score -= Math.min(10, Math.round(maxSlip * 0.3));
  return { score: clamp0to100(score), note: null as string | null };
}

function computeRaidScore(stats: { open_high: number; overdue: number; sla_high: number }) {
  let score = 100;
  score -= Math.min(40, stats.open_high * 6);
  score -= Math.min(25, stats.overdue * 10);
  score -= Math.min(20, stats.sla_high * 6);
  return clamp0to100(score);
}

function computeApprovalsScore(pending: number) {
  let score = 100;
  score -= Math.min(35, pending * 3);
  return clamp0to100(score);
}

function computeActivityScore(staleProjects7d: number) {
  let score = 100;
  score -= Math.min(30, staleProjects7d * 8);
  return clamp0to100(score);
}

function weightedPortfolioScore(parts: { schedule: number; raid: number; flow: number; approvals: number; activity: number }) {
  const w = { schedule: 35, raid: 30, flow: 15, approvals: 10, activity: 10 };
  const total =
    parts.schedule * w.schedule +
    parts.raid * w.raid +
    parts.flow * w.flow +
    parts.approvals * w.approvals +
    parts.activity * w.activity;
  return clamp0to100(total / 100);
}

/* ---------------- filters ---------------- */

type PortfolioFilters = {
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

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

function hasAnyFilters(f: PortfolioFilters) {
  return (
    (f.projectName && f.projectName.length) ||
    (f.projectCode && f.projectCode.length) ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department && f.department.length)
  );
}

async function applyProjectFilters(supabase: any, scopedProjectIds: string[], filters: PortfolioFilters) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) return { projectIds: [], meta: { ...meta, applied: true } };
  if (!hasAnyFilters(filters)) return { projectIds: scopedProjectIds, meta };

  const selectSets = [
    "id, title, project_code, created_at, project_manager_id, department",
    "id, title, project_code, created_at, project_manager_id",
    "id, title, project_code, created_at, department",
    "id, title, project_code, created_at",
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

/* ---------------- best-effort fetchers ---------------- */

async function fetchScheduleAgg(supabase: any, projectIds: string[], windowDays: number) {
  const today = ymd(new Date());
  const windowEnd = addDaysISO(today, windowDays);

  try {
    const { data, error } = await supabase
      .from("schedule_milestones")
      .select("project_id, end_date, baseline_end, status, critical_path_flag, ai_delay_prob")
      .in("project_id", projectIds)
      .limit(20000);

    if (error) {
      if (looksMissingRelation(error))
        return { ok: false, error: "schedule_milestones missing", data: null as ScheduleAgg | null };
      return { ok: false, error: error.message, data: null as ScheduleAgg | null };
    }

    const rows = Array.isArray(data) ? data : [];
    let dueWindow = 0,
      overdue = 0,
      critOverdue = 0,
      aiHigh = 0,
      slipSum = 0,
      slipCount = 0,
      maxSlip = 0;

    for (const r of rows) {
      const st = String((r as any)?.status || "").toLowerCase();
      const done = st === "completed" || st === "done" || st === "closed";
      const end = (r as any)?.end_date ? String((r as any).end_date).slice(0, 10) : null;
      const baseEnd = (r as any)?.baseline_end ? String((r as any).baseline_end).slice(0, 10) : null;

      if (!done && end && end <= windowEnd) dueWindow++;
      if (!done && end && end < today) {
        overdue++;
        if ((r as any)?.critical_path_flag) critOverdue++;
      }

      const prob = num((r as any)?.ai_delay_prob, 0);
      if (!done && end && end <= windowEnd && prob >= 70) aiHigh++;

      if (end && baseEnd) {
        const endD = new Date(`${end}T00:00:00.000Z`);
        const baseD = new Date(`${baseEnd}T00:00:00.000Z`);
        const diffDays = Math.round((endD.getTime() - baseD.getTime()) / (1000 * 60 * 60 * 24));
        const slip = Math.max(0, diffDays);
        slipSum += slip;
        slipCount += 1;
        maxSlip = Math.max(maxSlip, slip);
      }
    }

    const agg: ScheduleAgg = {
      days: windowDays,
      milestones_due_window: dueWindow,
      milestones_overdue: overdue,
      critical_overdue: critOverdue,
      avg_slip_days: slipCount ? Math.round((slipSum / slipCount) * 10) / 10 : 0,
      max_slip_days: maxSlip,
      ai_high_risk_due_window: aiHigh,
    };
    return { ok: true, error: null, data: agg };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e || "schedule query failed"), data: null as ScheduleAgg | null };
  }
}

async function fetchRaidStats(supabase: any, projectIds: string[]) {
  const today = ymd(new Date());
  const { data: raidRows, error: rErr } = await supabase
    .from("raid_items")
    .select("id, project_id, status, due_date, probability, severity")
    .in("project_id", projectIds)
    .limit(20000);

  if (rErr) return { ok: false, error: rErr.message, open_high: 0, overdue: 0, sla_high: 0 };

  const rows = Array.isArray(raidRows) ? raidRows : [];
  let overdue = 0,
    openHigh = 0;

  for (const r of rows) {
    const st = String((r as any)?.status || "").toLowerCase();
    const closed = st === "closed" || st === "invalid";
    const due = (r as any)?.due_date ? String((r as any).due_date).slice(0, 10) : null;
    if (!closed && due && due < today) overdue++;

    const p = clamp0to100((r as any)?.probability);
    const s = clamp0to100((r as any)?.severity);
    const score =
      (r as any)?.probability == null || (r as any)?.severity == null ? null : Math.round((p * s) / 100);
    if (!closed && score != null && score >= 70) openHigh++;
  }

  let slaHigh = 0;
  try {
    const raidIds = rows.map((x: any) => x.id).filter(Boolean);
    if (raidIds.length) {
      const { data: preds, error: pErr } = await supabase
        .from("raid_sla_predictions")
        .select("raid_item_id, breach_probability, predicted_at")
        .in("raid_item_id", raidIds)
        .order("predicted_at", { ascending: false })
        .limit(20000);

      if (!pErr && Array.isArray(preds)) {
        const seen = new Set<string>();
        for (const p of preds) {
          const id = String((p as any)?.raid_item_id || "");
          if (!id || seen.has(id)) continue;
          seen.add(id);
          const bp = num((p as any)?.breach_probability, -1);
          if (bp >= 70) slaHigh++;
        }
      }
    }
  } catch {}

  return { ok: true, error: null, open_high: openHigh, overdue, sla_high: slaHigh };
}

async function fetchApprovalsPending(supabase: any, projectIds: string[]) {
  try {
    const { data, error } = await supabase
      .from("approval_steps")
      .select("id, project_id, status, decided_at")
      .in("project_id", projectIds);

    if (error) {
      if (looksMissingRelation(error)) return { ok: false, pending: 0, error: "approval_steps missing" };
      return { ok: false, pending: 0, error: error.message };
    }

    const pending = (data || []).filter((r: any) => {
      if (r?.decided_at) return false;
      const s = String(r?.status || "").toLowerCase();
      return s === "" || s === "pending" || s === "open";
    }).length;

    return { ok: true, pending, error: null };
  } catch (e: any) {
    return { ok: false, pending: 0, error: String(e?.message || e || "approvals query failed") };
  }
}

async function fetchActivityStaleProjects7d(supabase: any, projectIds: string[]) {
  const candidates = ["activity_events", "activity_log", "project_activity", "activity"];
  let table: string | null = null;

  for (const t of candidates) {
    const { error } = await supabase.from(t).select("id", { head: true, count: "exact" }).limit(1);
    if (!error) {
      table = t;
      break;
    }
    if (!looksMissingRelation(error)) {
      table = t;
      break;
    }
  }

  if (!table) return { ok: false, table: null, stale_projects_7d: 0, error: "no activity table found" };

  const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const since7Iso = since7.toISOString();

  const { data, error } = await supabase
    .from(table)
    .select("project_id, created_at")
    .in("project_id", projectIds)
    .gte("created_at", since7Iso)
    .order("created_at", { ascending: false })
    .limit(20000);

  if (error) return { ok: false, table, stale_projects_7d: 0, error: error.message };

  const active = new Set<string>();
  for (const r of Array.isArray(data) ? data : []) {
    const pid = String((r as any)?.project_id || "").trim();
    if (pid) active.add(pid);
  }

  // exclude newly created projects from stale denominator
  let eligibleIds = projectIds;
  try {
    const { data: projRows } = await supabase.from("projects").select("id, created_at").in("id", projectIds).limit(20000);
    if (Array.isArray(projRows)) {
      eligibleIds = projRows
        .filter((p: any) => {
          const createdAt = p?.created_at ? new Date(String(p.created_at)) : null;
          return !createdAt || createdAt.getTime() <= since7.getTime();
        })
        .map((p: any) => String(p?.id || "").trim())
        .filter(Boolean);
    }
  } catch {}

  const stale = Math.max(0, eligibleIds.filter((id) => !active.has(id)).length);

  return {
    ok: true,
    table,
    stale_projects_7d: stale,
    error: null,
    meta: { eligible: eligibleIds.length, active: active.size, total: projectIds.length },
  };
}

async function fetchFlowScore(supabase: any, projectIds: string[], days = 30) {
  try {
    const { data, error } = await supabase.rpc("get_flow_warning_signals", { p_project_ids: projectIds, p_days: days });
    if (error) {
      if (looksMissingRelation(error)) return { ok: false, score: 85, error: "flow RPC missing" };
      return { ok: false, score: 85, error: error.message };
    }

    const j = typeof data === "string" ? null : data;
    const projects = Array.isArray((j as any)?.projects) ? (j as any).projects : [];
    let worstSlip = 0,
      worstBlockedRatio = 0,
      worstStageShare = 0,
      worstCycleVar = 0;

    for (const p of projects) {
      worstSlip = Math.max(worstSlip, clamp0to100(p?.forecast?.slip_probability));
      worstBlockedRatio = Math.max(worstBlockedRatio, num(p?.blocked?.blocked_ratio_pct ?? p?.blocked?.blocked_ratio, 0));
      worstStageShare = Math.max(worstStageShare, num(p?.bottleneck?.top_stage_share, 0));
      worstCycleVar = Math.max(worstCycleVar, num(p?.cycle_time_variance_pct, 0));
    }

    let score = 100;
    if (worstSlip >= 70) score -= 25;
    else if (worstSlip >= 45) score -= 12;
    if (worstBlockedRatio >= 15) score -= 20;
    else if (worstBlockedRatio >= 10) score -= 10;
    if (worstStageShare >= 55) score -= 15;
    else if (worstStageShare >= 40) score -= 8;
    if (worstCycleVar >= 25) score -= 10;

    return {
      ok: true,
      score: clamp0to100(score),
      error: null,
      worst: { worstSlip, worstBlockedRatio, worstStageShare, worstCycleVar },
    };
  } catch (e: any) {
    return { ok: false, score: 85, error: String(e?.message || e || "flow RPC failed") };
  }
}

/* ---------------- shared handler ---------------- */

async function handle(req: Request, opts: { daysParam: 7 | 14 | 30 | 60 | "all"; filters: PortfolioFilters }) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return jsonErr("Not authenticated", 401);

  const windowDays = normalizeWindowDays(opts.daysParam);

  // ✅ ORG-WIDE scope for dashboards
  const scoped = await resolveOrgActiveProjectScope(supabase);
  const scopedProjectIdsRaw = Array.isArray(scoped?.projectIds) ? scoped.projectIds.filter(Boolean) : [];

  // ✅ PH-F5: active project filter (helper returns string[]) + FAIL-OPEN safeguard
  let scopedProjectIds: string[] = [];
  let active_filter_ok = true;
  let active_filter_error: string | null = null;

  try {
    const activeIds = await filterActiveProjectIds(supabase, scopedProjectIdsRaw);
    scopedProjectIds = Array.isArray(activeIds) ? activeIds.filter(Boolean) : [];

    // FAIL-OPEN: never allow false-zeroing the org dashboard
    if (!scopedProjectIds.length && scopedProjectIdsRaw.length) {
      scopedProjectIds = scopedProjectIdsRaw;
      active_filter_ok = false;
      active_filter_error = "active filter returned 0 ids; failing open to raw scope";
    }
  } catch (e: any) {
    scopedProjectIds = scopedProjectIdsRaw; // ✅ fail-open
    active_filter_ok = false;
    active_filter_error = String(e?.message || e || "active filter failed");
  }

  const filtered = await applyProjectFilters(supabase, scopedProjectIds, opts.filters);
  const projectIds = filtered.projectIds;

  if (!projectIds.length) {
    return jsonOk({
      portfolio_health: 0,
      days: opts.daysParam,
      windowDays,
      projectCount: 0,
      drivers: [],
      parts: { schedule: 0, raid: 0, flow: 0, approvals: 0, activity: 0 },
      schedule: null,
      meta: {
        note: hasAnyFilters(opts.filters) ? "No projects matched the selected filters." : "No active projects in scope.",
        organisationId: (scoped as any)?.organisationId ?? (scoped as any)?.orgId ?? null,
        scope: {
          ...(((scoped as any)?.meta || {}) as any),
          scopedIdsRaw: scopedProjectIdsRaw.length,
          scopedIdsActive: scopedProjectIds.length,
          active_filter_ok,
          active_filter_error,
        },
        filters: filtered.meta,
      },
    });
  }

  const [scheduleAgg, raid, approvals, activity, flow] = await Promise.all([
    fetchScheduleAgg(supabase, projectIds, windowDays),
    fetchRaidStats(supabase, projectIds),
    fetchApprovalsPending(supabase, projectIds),
    fetchActivityStaleProjects7d(supabase, projectIds),
    fetchFlowScore(supabase, projectIds, 30),
  ]);

  const scheduleKpis = scheduleAgg.ok ? scheduleAgg.data : null;
  const schedulePart = scheduleKpis
    ? computeScheduleScore(scheduleKpis)
    : { score: 85, note: scheduleAgg.error || "Schedule data unavailable." };

  const raidPart = raid.ok ? computeRaidScore({ open_high: raid.open_high, overdue: raid.overdue, sla_high: raid.sla_high }) : 85;
  const approvalsPart = approvals.ok ? computeApprovalsScore(approvals.pending) : 90;
  const activityPart = activity.ok ? computeActivityScore(activity.stale_projects_7d) : 90;
  const flowPart = num((flow as any)?.score, 85);

  const portfolioHealth = weightedPortfolioScore({
    schedule: schedulePart.score,
    raid: raidPart,
    flow: flowPart,
    approvals: approvalsPart,
    activity: activityPart,
  });

  const drivers = [
    {
      key: "schedule",
      label: "Schedule",
      score: schedulePart.score,
      detail: scheduleKpis
        ? `Due: ${num(scheduleKpis.milestones_due_window)} • Overdue: ${num(scheduleKpis.milestones_overdue)} • CP overdue: ${num(
            scheduleKpis.critical_overdue,
          )} • Avg slip: ${num(scheduleKpis.avg_slip_days)}d • AI high-risk due: ${num(scheduleKpis.ai_high_risk_due_window)}`
        : schedulePart.note || "No schedule signal.",
    },
    {
      key: "raid",
      label: "RAID",
      score: raidPart,
      detail: raid.ok
        ? `High exposure open: ${raid.open_high} • Overdue: ${raid.overdue} • SLA ≥70%: ${raid.sla_high}`
        : raid.error || "RAID signal unavailable.",
    },
    {
      key: "flow",
      label: "Flow",
      score: flowPart,
      detail: (flow as any)?.ok ? "Derived from flow warning signals (30d predictors)." : (flow as any)?.error || "Flow signal unavailable.",
    },
    {
      key: "approvals",
      label: "Approvals",
      score: approvalsPart,
      detail: approvals.ok ? `Pending: ${approvals.pending}` : approvals.error || "Approvals signal unavailable.",
    },
    {
      key: "activity",
      label: "Cadence",
      score: activityPart,
      detail: activity.ok
        ? `Stale projects (7d): ${activity.stale_projects_7d}${(activity as any).meta ? ` (eligible: ${(activity as any).meta.eligible})` : ""}`
        : activity.error || "Cadence signal unavailable.",
    },
  ].sort((a, b) => a.score - b.score);

  return jsonOk({
    portfolio_health: portfolioHealth,
    days: opts.daysParam,
    windowDays,
    projectCount: projectIds.length,
    parts: { schedule: schedulePart.score, raid: raidPart, flow: flowPart, approvals: approvalsPart, activity: activityPart },
    schedule: scheduleKpis,
    drivers,
    meta: {
      notes: { schedule: schedulePart.note },
      inputs: { windowDays, projectIdsCount: projectIds.length },
      organisationId: (scoped as any)?.organisationId ?? (scoped as any)?.orgId ?? null,
      scope: {
        ...(((scoped as any)?.meta || {}) as any),
        scopedIdsRaw: scopedProjectIdsRaw.length,
        scopedIdsActive: scopedProjectIds.length,
        active_filter_ok,
        active_filter_error,
      },
      filters: filtered.meta,
      queries: {
        schedule: { ok: scheduleAgg.ok, error: scheduleAgg.error || null },
        raid: { ok: raid.ok, error: raid.error || null },
        approvals: { ok: approvals.ok, error: approvals.error || null },
        activity: {
          ok: activity.ok,
          error: activity.error || null,
          table: (activity as any).table ?? null,
          meta: (activity as any).meta ?? null,
        },
        flow: { ok: (flow as any).ok ?? false, error: (flow as any).error || null, worst: (flow as any).worst || null },
      },
    },
  });
}

/* ---------------- routes ---------------- */

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const daysParam = clampDaysParam(url.searchParams.get("days"));
    const filters = parseFiltersFromUrl(url);
    return await handle(req, { daysParam, filters });
  } catch (e: any) {
    console.error("[GET /api/portfolio/health]", e);
    return jsonErr(String(e?.message || e || "Portfolio health failed"), 500);
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const daysParam = clampDaysParam(body?.days ?? body?.windowDays ?? body?.rangeDays ?? null);
    const filters = parseFiltersFromBody(body);
    return await handle(req, { daysParam, filters });
  } catch (e: any) {
    console.error("[POST /api/portfolio/health]", e);
    return jsonErr(String(e?.message || e || "Portfolio health failed"), 500);
  }
}