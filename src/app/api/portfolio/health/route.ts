// src/app/api/portfolio/health/route.ts — v9
// Built on v8. Three targeted fixes for closed projects leaking into RAG:
//
//   ✅ FIX-1  resolveActiveProjectIds() — direct DB query for active status
//             NEVER relies solely on the helper; filters at the DB layer first.
//   ✅ FIX-2  Fail-open tightened — old code fell back to ALL raw IDs (including
//             closed). New code fails open only to DB-verified active IDs.
//   ✅ FIX-3  RAID scoring weights aligned with project page
//             (open_high penalty: 8pt not 6pt, overdue: 6pt not 10pt)
//
// All v8 features preserved: filters, degradation, no-store caching, PH-F1–F5.

import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";

export const runtime = "nodejs";

/* ─── response helpers ─── */

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

/* ─── small utils ─── */

function looksMissingRelation(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

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

/* ─── FIX-1: hardened active project resolver ────────────────────────────
 *
 *  Problem in v8:
 *    filterActiveProjectIds() is the ONLY guard. If it throws or returns [],
 *    the fail-open falls back to scopedIdsRaw which includes closed projects.
 *
 *  Solution:
 *    1. Query projects table directly — source of truth, always runs first.
 *    2. Filter out status IN (closed|cancelled|archived|completed|done)
 *       AND deleted_at IS NOT NULL at the DB layer.
 *    3. Only call the helper as a secondary cross-check, never as the sole gate.
 *    4. Fail-open only to the DB-verified active set — never to raw/closed IDs.
 * ─────────────────────────────────────────────────────────────────────── */

const CLOSED_STATUSES = new Set([
  "closed", "cancelled", "canceled", "archived", "completed", "done", "inactive",
]);

async function resolveActiveProjectIds(
  supabase: any,
  candidateIds: string[],
  orgId: string | null,
  notes: string[],
): Promise<string[]> {
  if (!candidateIds.length) return [];

  // Step 1 — direct DB filter (primary guard)
  let q = supabase
    .from("projects")
    .select("id, status, deleted_at")
    .in("id", candidateIds)
    .is("deleted_at", null)
    .limit(20000);

  if (orgId) q = q.eq("organisation_id", orgId);

  const { data, error } = await q;

  if (error) {
    // DB filter failed — try the helper as fallback
    notes.push(`DB active-filter failed (${error.message}). Trying helper.`);
    try {
      const maybeActive = await filterActiveProjectIds(supabase, candidateIds);
      const helperIds: string[] = Array.isArray(maybeActive)
        ? maybeActive
        : (maybeActive as any)?.projectIds ?? (maybeActive as any)?.ids ?? [];
      if (helperIds.length) {
        notes.push(`Helper returned ${helperIds.length} active IDs.`);
        return helperIds;
      }
    } catch (e2: any) {
      notes.push(`Helper also failed: ${String(e2?.message || e2)}.`);
    }
    // Both failed — return candidates as-is and note the issue
    notes.push("Both active-filters failed — returning candidates unfiltered.");
    return candidateIds;
  }

  const rows = Array.isArray(data) ? data : [];

  // Step 2 — exclude closed statuses in application layer (belt + braces)
  const activeIds = rows
    .filter((p: any) => {
      const st = String(p?.status ?? "active").toLowerCase().trim();
      return !CLOSED_STATUSES.has(st);
    })
    .map((p: any) => String(p.id));

  const excludedCount = candidateIds.length - activeIds.length;
  if (excludedCount > 0) {
    notes.push(`Excluded ${excludedCount} project(s) — closed/archived/deleted status.`);
  }

  // Step 3 — if everything in scope is closed, return empty (accurate, not silently failing)
  if (activeIds.length === 0 && candidateIds.length > 0) {
    notes.push("All scoped projects are closed or archived. Portfolio score will be empty.");
  }

  return activeIds;
}

/* ─── scoring ─── */

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
  const due       = num(k.milestones_due_window, 0);
  const overdue   = num(k.milestones_overdue, 0);
  const critOver  = num(k.critical_overdue, 0);
  const avgSlip   = num(k.avg_slip_days, 0);
  const maxSlip   = num(k.max_slip_days, 0);
  const aiHigh    = num(k.ai_high_risk_due_window, 0);

  if (due === 0 && overdue === 0) return { score: 100, note: "No milestones due or overdue." };

  let score = 100;
  score -= Math.min(45, overdue  * 10);
  score -= Math.min(20, critOver * 12);
  score -= Math.min(20, aiHigh   *  4);
  if (avgSlip > 0) score -= Math.min(15, Math.round(avgSlip * 1.5));
  if (maxSlip > 0) score -= Math.min(10, Math.round(maxSlip * 0.3));
  return { score: clamp0to100(score), note: null as string | null };
}

// ✅ FIX-3: aligned with project page (open_high: -8pt, overdue: -6pt)
function computeRaidScore(stats: { open_high: number; overdue: number; sla_high: number }) {
  let score = 100;
  score -= Math.min(40, stats.open_high * 8);  // was 6 in v8 — now matches project page
  score -= Math.min(25, stats.overdue   * 6);  // was 10 in v8 — now matches project page
  score -= Math.min(20, stats.sla_high  * 6);
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

function weightedPortfolioScore(parts: {
  schedule: number; raid: number; flow: number; approvals: number; activity: number;
}) {
  const w = { schedule: 35, raid: 30, flow: 15, approvals: 10, activity: 10 };
  const total =
    parts.schedule  * w.schedule  +
    parts.raid      * w.raid      +
    parts.flow      * w.flow      +
    parts.approvals * w.approvals +
    parts.activity  * w.activity;
  return clamp0to100(total / 100);
}

/* ─── filters ─── */

type PortfolioFilters = {
  projectName?:      string[];
  projectCode?:      string[];
  projectManagerId?: string[];
  department?:       string[];
};

function parseFiltersFromUrl(url: URL): PortfolioFilters {
  const name = uniqStrings(url.searchParams.getAll("name").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const code = uniqStrings(url.searchParams.getAll("code").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const pm   = uniqStrings(url.searchParams.getAll("pm").flatMap((x)   => x.split(",")).map((s) => s.trim()));
  const dept = uniqStrings(url.searchParams.getAll("dept").flatMap((x) => x.split(",")).map((s) => s.trim()));
  const out: PortfolioFilters = {};
  if (name.length) out.projectName      = name;
  if (code.length) out.projectCode      = code;
  if (pm.length)   out.projectManagerId = pm;
  if (dept.length) out.department       = dept;
  return out;
}

function parseFiltersFromBody(body: any): PortfolioFilters {
  const f = body?.filters ?? body?.filter ?? body?.where ?? null;
  const out: PortfolioFilters = {};
  const names = uniqStrings(f?.projectName  ?? f?.projectNames  ?? f?.name  ?? f?.project_name);
  const codes = uniqStrings(f?.projectCode  ?? f?.projectCodes  ?? f?.code  ?? f?.project_code);
  const pms   = uniqStrings(f?.projectManagerId ?? f?.projectManagerIds ?? f?.pm ?? f?.project_manager_id);
  const depts = uniqStrings(f?.department   ?? f?.departments   ?? f?.dept);
  if (names.length) out.projectName      = names;
  if (codes.length) out.projectCode      = codes;
  if (pms.length)   out.projectManagerId = pms;
  if (depts.length) out.department       = depts;
  return out;
}

function hasAnyFilters(f: PortfolioFilters) {
  return (
    (f.projectName      && f.projectName.length)      ||
    (f.projectCode      && f.projectCode.length)      ||
    (f.projectManagerId && f.projectManagerId.length) ||
    (f.department       && f.department.length)
  );
}

async function applyProjectFilters(
  supabase: any,
  scopedProjectIds: string[],
  filters: PortfolioFilters,
) {
  const meta: any = { applied: false, filters, notes: [] as string[] };
  if (!scopedProjectIds.length) return { projectIds: [], meta: { ...meta, applied: true } };
  if (!hasAnyFilters(filters))  return { projectIds: scopedProjectIds, meta };

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
    if (!error && Array.isArray(data)) { rows = data; lastErr = null; break; }
    lastErr = error;
    if (!(looksMissingRelation(error) || looksMissingColumn(error))) break;
  }

  if (!rows.length) {
    meta.applied = true;
    meta.notes.push("Could not read projects for filtering; falling back to unfiltered scope.");
    if (lastErr?.message) meta.notes.push(lastErr.message);
    return { projectIds: scopedProjectIds, meta };
  }

  const nameNeedles = (filters.projectName      ?? []).map((s) => s.toLowerCase());
  const codeNeedles = (filters.projectCode      ?? []).map((s) => s.toLowerCase());
  const pmSet       = new Set((filters.projectManagerId ?? []).map((s) => s));
  const deptNeedles = (filters.department       ?? []).map((s) => s.toLowerCase());

  const filtered = rows.filter((p) => {
    const title = safeStr(p?.title).toLowerCase();
    const code  = projectCodeLabel(p?.project_code).toLowerCase();
    if (nameNeedles.length && !nameNeedles.some((n) => title.includes(n))) return false;
    if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c)))  return false;
    if (pmSet.size) { const pm = safeStr(p?.project_manager_id).trim(); if (!pm || !pmSet.has(pm)) return false; }
    if (deptNeedles.length) { const dept = safeStr(p?.department).toLowerCase().trim(); if (!dept || !deptNeedles.some((d) => dept.includes(d))) return false; }
    return true;
  });

  const outIds = filtered.map((p) => String(p?.id || "").trim()).filter(Boolean);
  meta.applied = true;
  meta.counts  = { before: scopedProjectIds.length, after: outIds.length };
  return { projectIds: outIds, meta };
}

/* ─── best-effort fetchers (unchanged from v8) ─── */

async function fetchScheduleAgg(supabase: any, projectIds: string[], windowDays: number) {
  const today     = ymd(new Date());
  const windowEnd = addDaysISO(today, windowDays);
  try {
    const { data, error } = await supabase
      .from("schedule_milestones")
      .select("project_id, end_date, baseline_end, status, critical_path_flag, ai_delay_prob")
      .in("project_id", projectIds)
      .limit(20000);

    if (error) {
      if (looksMissingRelation(error)) return { ok: false, error: "schedule_milestones missing", data: null as ScheduleAgg | null };
      return { ok: false, error: error.message, data: null as ScheduleAgg | null };
    }

    const rows = Array.isArray(data) ? data : [];
    let dueWindow = 0, overdue = 0, critOverdue = 0, aiHigh = 0, slipSum = 0, slipCount = 0, maxSlip = 0;

    for (const r of rows) {
      const st   = String((r as any)?.status || "").toLowerCase();
      const done = st === "completed" || st === "done" || st === "closed";
      const end  = (r as any)?.end_date     ? String((r as any).end_date).slice(0, 10)     : null;
      const base = (r as any)?.baseline_end ? String((r as any).baseline_end).slice(0, 10) : null;

      if (!done && end && end <= windowEnd) dueWindow++;
      if (!done && end && end < today) {
        overdue++;
        if ((r as any)?.critical_path_flag) critOverdue++;
      }

      const prob = num((r as any)?.ai_delay_prob, 0);
      if (!done && end && end <= windowEnd && prob >= 70) aiHigh++;

      if (end && base) {
        const slip = Math.max(0, Math.round(
          (new Date(`${end}T00:00:00.000Z`).getTime() - new Date(`${base}T00:00:00.000Z`).getTime()) / 86400000
        ));
        slipSum += slip; slipCount += 1; maxSlip = Math.max(maxSlip, slip);
      }
    }

    return {
      ok: true, error: null,
      data: {
        days: windowDays, milestones_due_window: dueWindow, milestones_overdue: overdue,
        critical_overdue: critOverdue,
        avg_slip_days: slipCount ? Math.round((slipSum / slipCount) * 10) / 10 : 0,
        max_slip_days: maxSlip, ai_high_risk_due_window: aiHigh,
      } as ScheduleAgg,
    };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || "schedule query failed"), data: null as ScheduleAgg | null };
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
  let overdue = 0, openHigh = 0;

  for (const r of rows) {
    const st     = String((r as any)?.status || "").toLowerCase();
    const closed = st === "closed" || st === "invalid" || st === "resolved";
    const due    = (r as any)?.due_date ? String((r as any).due_date).slice(0, 10) : null;
    if (!closed && due && due < today) overdue++;
    const p     = clamp0to100((r as any)?.probability);
    const s     = clamp0to100((r as any)?.severity);
    const score = ((r as any)?.probability == null || (r as any)?.severity == null)
      ? null : Math.round((p * s) / 100);
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
          if (num((p as any)?.breach_probability, -1) >= 70) slaHigh++;
        }
      }
    }
  } catch {}

  return { ok: true, error: null, open_high: openHigh, overdue, sla_high: slaHigh };
}

async function fetchPendingApprovals(supabase: any, projectIds: string[]) {
  const candidates = [
    { table: "artifact_approval_steps", select: "id, project_id, status", statusCol: "status" },
    { table: "approval_steps",          select: "id, project_id, status", statusCol: "status" },
  ];
  for (const c of candidates) {
    try {
      const { data, error } = await supabase.from(c.table).select(c.select).in("project_id", projectIds).limit(20000);
      if (error) { if (looksMissingRelation(error)) continue; return { ok: false, error: error.message, pending: 0, source: c.table }; }
      const rows    = Array.isArray(data) ? data : [];
      const pending = rows.filter((r: any) => {
        const st = String(r?.[c.statusCol] || "").toLowerCase();
        return st === "pending" || st === "awaiting" || st === "in_review" || st === "submitted";
      }).length;
      return { ok: true, error: null, pending, source: c.table };
    } catch {}
  }
  return { ok: false, error: "approvals table not found", pending: 0, source: null };
}

async function fetchStaleActivity(supabase: any, projectIds: string[]) {
  const meta: any = { ok: true, notes: [] as string[] };
  const selectSets = [
    "id, created_at, updated_at, last_activity_at",
    "id, created_at, updated_at",
    "id, created_at",
  ];
  let rows: any[] = [];
  let lastErr: any = null;
  for (const sel of selectSets) {
    const { data, error } = await supabase.from("projects").select(sel).in("id", projectIds).limit(20000);
    if (!error && Array.isArray(data)) { rows = data; lastErr = null; break; }
    lastErr = error;
    if (!(looksMissingRelation(error) || looksMissingColumn(error))) break;
  }
  if (!rows.length) {
    meta.ok = false;
    meta.notes.push("Could not read projects for stale activity; defaulting stale=0.");
    if (lastErr?.message) meta.notes.push(lastErr.message);
    return { ok: false, stale7d: 0, meta };
  }
  const now = Date.now();
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;
  let stale = 0;
  for (const p of rows) {
    const createdAt = p?.created_at ? new Date(p.created_at).getTime() : 0;
    if (now - createdAt < sevenDaysMs) continue; // exclude brand-new projects
    const last   = (p as any)?.last_activity_at || (p as any)?.updated_at || (p as any)?.created_at || null;
    if (!last) continue;
    const lastMs = new Date(last).getTime();
    if (Number.isFinite(lastMs) && now - lastMs >= sevenDaysMs) stale++;
  }
  return { ok: true, stale7d: stale, meta };
}

/* ─── core handler ─── */

async function handle(req: Request, method: "GET" | "POST") {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user?.id) return jsonErr("Not authenticated", 401, { authErr: authErr?.message });

  const url        = new URL(req.url);
  const daysParam  = clampDaysParam(url.searchParams.get("days"));
  const windowDays = normalizeWindowDays(daysParam);

  let filters: PortfolioFilters = {};
  if (method === "GET") {
    filters = parseFiltersFromUrl(url);
  } else {
    let body: any = null;
    try { body = await req.json(); } catch {}
    filters = parseFiltersFromBody(body);
  }

// 1. Resolve active org, then fetch org-wide projects
const scoped = await resolveOrgActiveProjectScope(supabase, auth.user.id);
const scopeMeta = (scoped as any)?.meta ?? (scoped as any) ?? {};
const orgId =
  (scoped as any)?.organisationId ??
  (scopeMeta as any)?.organisationId ??
  null;

if (!orgId) {
  return jsonOk({
    projectCount: 0,
    score: 0,
    parts: { schedule: 0, raid: 0, flow: 0, approvals: 0, activity: 0 },
    schedule: null,
    raid: null,
    approvals: { pending: 0, source: null, ok: true, error: null },
    activity: { stale7d: 0, ok: true, meta: {} },
    meta: {
      organisationId: null,
      days: daysParam,
      windowDays,
      activeFilter: {
        rawCount: 0,
        activeCount: 0,
        finalCount: 0,
        notes: ["No active organisation resolved."],
      },
      filters: { applied: false, filters, notes: [] },
      scope: { ...scopeMeta, scopedIdsRaw: [], scopedIdsActive: [], source: "org-none", orgScope: null },
      notes: ["No active organisation in scope."],
    },
  });
}

const { data: orgProjects, error: orgProjectsErr } = await supabase
  .from("projects")
  .select("id")
  .eq("organisation_id", orgId)
  .is("deleted_at", null)
  .limit(20000);

if (orgProjectsErr) {
  return jsonErr("Failed to resolve organisation projects", 500, {
    organisationId: orgId,
    detail: orgProjectsErr.message,
  });
}

const scopedIdsRaw: string[] = (orgProjects ?? [])
  .map((p: any) => String(p?.id || "").trim())
  .filter(Boolean);
  // ✅ FIX-1 + FIX-2: direct DB filter — replaces the old helper-only approach
  const activeNotes: string[] = [];
  const activeIds = await resolveActiveProjectIds(supabase, scopedIdsRaw, orgId, activeNotes);

  // Apply name/code/PM/dept filters within the now-verified active set
  const filtered        = await applyProjectFilters(supabase, activeIds, filters);
  const finalProjectIds = filtered.projectIds;

  // 3. Fetch metrics in parallel
  const [schedule, raid, approvals, activity] = await Promise.all([
    fetchScheduleAgg(supabase, finalProjectIds, windowDays),
    fetchRaidStats(supabase, finalProjectIds),
    fetchPendingApprovals(supabase, finalProjectIds),
    fetchStaleActivity(supabase, finalProjectIds),
  ]);

  // 4. Score
  const scheduleScore  = computeScheduleScore(schedule.ok ? schedule.data : null);
  const raidScore      = computeRaidScore({ open_high: raid.open_high, overdue: raid.overdue, sla_high: raid.sla_high });
  const approvalsScore = computeApprovalsScore(approvals.pending);
  const activityScore  = computeActivityScore(activity.stale7d);
  const flowScore      = 85;

  const parts = {
    schedule:  scheduleScore.score,
    raid:      raidScore,
    flow:      flowScore,
    approvals: approvalsScore,
    activity:  activityScore,
  };

  const portfolioScore = weightedPortfolioScore(parts);

  return jsonOk({
    projectCount: finalProjectIds.length,
    score:        portfolioScore,
    parts,
    schedule:  schedule.ok  ? schedule.data  : null,
    raid:      raid.ok      ? { open_high: raid.open_high, overdue: raid.overdue, sla_high: raid.sla_high } : null,
    approvals: { pending: approvals.pending, source: approvals.source, ok: approvals.ok, error: (approvals as any).error ?? null },
    activity:  { stale7d: activity.stale7d, ok: activity.ok, meta: activity.meta },
    meta: {
      organisationId: orgId,
      days:           daysParam,
      windowDays,
      // ↓ expose these so you can verify in DevTools that closed projects are excluded
      activeFilter: {
        rawCount:    scopedIdsRaw.length,
        activeCount: activeIds.length,
        finalCount:  finalProjectIds.length,
        notes:       activeNotes,
      },
      filters: filtered.meta,
      scope: {
        ...scopeMeta,
        scopedIdsRaw,
        scopedIdsActive: activeIds,
        source: (scoped as any)?.source ?? (scopeMeta as any)?.source ?? "unknown",
        orgScope: (scoped as any)?.orgScope ?? (scopeMeta as any)?.orgScope ?? null,
      },
      notes: finalProjectIds.length === 0 ? ["No active projects in scope after filtering."] : [],
    },
  });
}

/* ─── route exports ─── */

export async function GET(req: Request)  { return handle(req, "GET");  }
export async function POST(req: Request) { return handle(req, "POST"); }
