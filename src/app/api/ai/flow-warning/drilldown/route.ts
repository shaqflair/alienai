// src/app/api/ai/flow-warning/drilldown/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/* ---------------- small utils ---------------- */

function clampDays(v: string | null): 7 | 14 | 30 | 60 {
  const n = Number(String(v ?? "").trim());
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? (n as any) : 30;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function normStr(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function isDoneStatus(s: any) {
  const v = normStr(s);
  return (
    v === "done" ||
    v === "closed" ||
    v === "completed" ||
    v === "complete" ||
    v === "cancelled" ||
    v === "canceled"
  );
}

function asDate(x: any): Date | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;
  // ✅ FIX: Normalise to UTC — append Z if the string looks like a bare ISO datetime
  // without timezone, so new Date() doesn't parse it as local time on non-UTC servers.
  const normalised = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !s.endsWith("Z") && !s.includes("+")
    ? s + "Z"
    : s;
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}

function ms(n: any) {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

/**
 * ✅ UK display dd/mm/yyyy (or dd/mm/yyyy hh:mm)
 * Always interprets timestamps as UTC to avoid server timezone drift.
 */
function fmtUkDateTime(x: any, withTime = false): string | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;

  // date-only fast path
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const [, yyyy, mm, dd] = m;
    if (!Number(yyyy) || !Number(mm) || !Number(dd)) return null;
    return `${dd}/${mm}/${yyyy}`;
  }

  // ✅ FIX: Normalise bare ISO datetimes to UTC before parsing
  const normalised = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) && !s.endsWith("Z") && !s.includes("+")
    ? s + "Z"
    : s;

  const d = new Date(normalised);
  if (Number.isNaN(d.getTime())) return null;

  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());

  if (!withTime) return `${dd}/${mm}/${yyyy}`;

  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mi = String(d.getUTCMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/* ---------------- active project filter ---------------- */
/**
 * We ONLY count "active" projects.
 * Defensive against schema differences across environments.
 */
function isActiveProjectRow(p: any): boolean {
  if (!p) return false;

  const bool = (v: any) => v === true || v === "true" || v === 1 || v === "1";

  const deletedAt = (p as any)?.deleted_at ?? (p as any)?.removed_at ?? null;
  const archivedAt = (p as any)?.archived_at ?? null;
  const closedAt = (p as any)?.closed_at ?? null;
  const completedAt = (p as any)?.completed_at ?? (p as any)?.end_date ?? (p as any)?.ended_at ?? null;

  if (deletedAt) return false;
  if (archivedAt) return false;
  if (closedAt) return false;
  if (completedAt) return false;

  if (bool((p as any)?.is_archived)) return false;

  if ((p as any)?.is_live === false) return false;
  if (normStr((p as any)?.is_live) === "false") return false;

  const statusLike =
    (p as any)?.status ?? (p as any)?.lifecycle_status ?? (p as any)?.delivery_status ?? null;
  if (statusLike != null && isDoneStatus(statusLike)) return false;

  return true;
}

async function loadProjectsMap(supabase: any, projectIds: string[]) {
  const wideSelect =
    "id, title, project_code, client_name, status, lifecycle_status, delivery_status, is_live, is_archived, archived_at, deleted_at, removed_at, closed_at, completed_at, ended_at, end_date";
  const minimalSelect = "id, title, project_code, client_name";

  let projRows: any[] = [];
  {
    const { data, error } = await supabase.from("projects").select(wideSelect).in("id", projectIds);
    if (!error) {
      projRows = Array.isArray(data) ? data : [];
    } else {
      const msg = String((error as any)?.message || "");
      if (msg.toLowerCase().includes("column")) {
        const { data: d2, error: e2 } = await supabase
          .from("projects")
          .select(minimalSelect)
          .in("id", projectIds);
        if (e2) throw new Error((e2 as any)?.message || "Failed to load projects");
        projRows = Array.isArray(d2) ? d2 : [];
      } else {
        throw new Error((error as any)?.message || "Failed to load projects");
      }
    }
  }

  const activeRows = (projRows || []).filter(isActiveProjectRow);

  const project_map: Record<
    string,
    { id: string; title: string | null; project_code: string | number | null; client_name?: string | null }
  > = {};

  for (const p of activeRows || []) {
    const id = String((p as any)?.id || "");
    if (!id) continue;
    project_map[id] = {
      id,
      title: (p as any)?.title ?? null,
      project_code: (p as any)?.project_code ?? null,
      client_name: (p as any)?.client_name ?? null,
    };
  }

  const activeIds = Object.keys(project_map);
  return { project_map, activeIds };
}

/**
 * ✅ FIX: Chunk a large array into batches to avoid URL-length limits on IN clauses.
 * PostgREST encodes IN as query params, which can overflow ~8KB at ~200+ UUIDs.
 */
async function chunkedQuery<T>(
  supabase: any,
  table: string,
  select: string,
  filterKey: string,
  ids: string[],
  extraFilters?: (q: any) => any,
  chunkSize = 150
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize);
    let q = supabase.from(table).select(select).in(filterKey, chunk);
    if (extraFilters) q = extraFilters(q);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    if (Array.isArray(data)) results.push(...(data as T[]));
  }
  return results;
}

/**
 * ✅ FIX: Handles duplicate/out-of-order events safely.
 * - Consecutive "blocked" events (duplicates) don't double-count.
 * - Events are expected ascending; ties are benign since we skip if already in that state.
 */
function computeBlockedSecondsFromEvents(args: {
  eventsAsc: any[];
  since: Date;
  now: Date;
  startBlocked: boolean;
  startReason?: string | null;
  startBlockAt?: string | null;
}) {
  const { eventsAsc, since, now, startBlocked, startReason, startBlockAt } = args;

  let totalMs = 0;
  const evs = Array.isArray(eventsAsc) ? eventsAsc : [];

  if (!evs.length) {
    const blockedMs = startBlocked ? Math.max(0, now.getTime() - since.getTime()) : 0;
    return {
      blocked_seconds: Math.round(blockedMs / 1000),
      currently_blocked: Boolean(startBlocked),
      last_block_event_at: startBlocked ? (startBlockAt ?? null) : null,
      last_block_reason: startBlocked ? (startReason ?? null) : null,
    };
  }

  let currentlyBlocked = Boolean(startBlocked);
  let lastBlockStart = since;

  let lastBlockEventAt: string | null = startBlocked ? (startBlockAt ?? null) : null;
  let lastBlockReason: string | null = startBlocked ? (startReason ?? null) : null;

  for (const e of evs) {
    const t = asDate(e?.created_at);
    if (!t) continue;

    const typ = normStr(e?.event_type);

    if (typ === "blocked") {
      // ✅ FIX: Skip duplicate "blocked" events — don't reset lastBlockStart
      if (!currentlyBlocked) {
        currentlyBlocked = true;
        lastBlockStart = t;
      }
      lastBlockEventAt = String(e.created_at);
      const reason = (e?.meta as any)?.reason;
      if (typeof reason === "string" && reason.trim()) lastBlockReason = reason.trim();
      continue;
    }

    if (typ === "unblocked") {
      if (currentlyBlocked) {
        totalMs += Math.max(0, t.getTime() - lastBlockStart.getTime());
        currentlyBlocked = false;
      }
      // ✅ FIX: Don't update lastBlockStart on unblocked — it's only meaningful on next block
      continue;
    }
  }

  if (currentlyBlocked) {
    totalMs += Math.max(0, now.getTime() - lastBlockStart.getTime());
  }

  return {
    blocked_seconds: Math.round(totalMs / 1000),
    currently_blocked: currentlyBlocked,
    last_block_event_at: lastBlockEventAt,
    last_block_reason: lastBlockReason,
  };
}

/* ------------------------------------------------------------------ */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return jsonErr("Not authenticated", 401);

    const userId = auth.user.id;

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));

    const projectIdParam = safeStr(url.searchParams.get("projectId"));
    const projectIdFilter = isUuid(projectIdParam) ? projectIdParam : null;

    // Projects in scope (membership)
    const { data: pmRows, error: pmErr } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", userId)
      .is("removed_at", null);

    if (pmErr) throw new Error(pmErr.message);

    let memberProjectIds = (pmRows ?? [])
      .map((r: any) => String(r?.project_id || ""))
      .filter(Boolean);

    if (projectIdFilter) memberProjectIds = memberProjectIds.filter((id) => id === projectIdFilter);

    if (!memberProjectIds.length) {
      const res = jsonOk({
        days,
        projects: [],
        projects_active: [],
        project_map: {},
        data: { blocked: [], wip: [], dueSoon: [], recentDone: [] },
        meta: { truncated: false, blocked_item_cap: 0, open_item_count: 0 },
      });
      res.headers.set("Cache-Control", "no-store, max-age=0");
      return res;
    }

    // ✅ Only ACTIVE projects
    const { project_map, activeIds } = await loadProjectsMap(supabase, memberProjectIds);

    let projectIds = activeIds;
    if (projectIdFilter) projectIds = projectIds.filter((id) => id === projectIdFilter);

    if (!projectIds.length) {
      const res = jsonOk({
        days,
        projects: memberProjectIds,
        projects_active: [],
        project_map: {},
        data: { blocked: [], wip: [], dueSoon: [], recentDone: [] },
        meta: { truncated: false, blocked_item_cap: 0, open_item_count: 0 },
      });
      res.headers.set("Cache-Control", "no-store, max-age=0");
      return res;
    }

    const now = new Date();
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const sinceIso = since.toISOString();

    // Work items (only active projects)
    const { data: allItems, error: wiErr } = await supabase
      .from("work_items")
      .select("id, project_id, title, stage, status, due_date, created_at, started_at, completed_at, updated_at")
      .in("project_id", projectIds);

    if (wiErr) throw new Error(wiErr.message);

    const items = Array.isArray(allItems) ? allItems : [];
    const openItems = items.filter((it: any) => !isDoneStatus(it?.status) && !it?.completed_at);

    // ✅ FIX: recentDone window respects the `days` param (not hardcoded 42d)
    // Use a lookback of max(days * 2, 14) to give enough throughput signal even on short windows
    const recentDoneLookbackMs = Math.max(days * 2, 14) * 24 * 60 * 60 * 1000;
    const recentDone = items
      .filter((it: any) => it?.completed_at)
      .filter((it: any) => {
        const d = asDate(it.completed_at);
        return d ? d.getTime() >= Date.now() - recentDoneLookbackMs : false;
      })
      .sort((a: any, b: any) => String(b.completed_at).localeCompare(String(a.completed_at)))
      .slice(0, 200);

    const openItemIds = openItems.map((it: any) => String(it?.id || "")).filter(Boolean);

    // ✅ FIX: Chunked events query — avoids URL overflow on large IN clauses
    // Also apply a per-chunk LIMIT to avoid fetching unbounded event rows
    const EVENTS_CHUNK = 150;
    const EVENTS_LIMIT_PER_CHUNK = 5000;
    const events: any[] = await chunkedQuery(
      supabase,
      "work_item_events",
      "id, project_id, work_item_id, event_type, from_stage, to_stage, created_at, meta",
      "project_id",
      projectIds,
      (q) => q.gte("created_at", sinceIso).order("created_at", { ascending: true }).limit(EVENTS_LIMIT_PER_CHUNK),
      EVENTS_CHUNK
    );

    const evByItem = new Map<string, any[]>();
    for (const e of events) {
      const wid = String((e as any)?.work_item_id || "").trim();
      if (!wid) continue;
      const arr = evByItem.get(wid) || [];
      arr.push(e);
      evByItem.set(wid, arr);
    }

    // ✅ FIX: Chunked pre-window blocked/unblocked state query
    const preStateByItem = new Map<
      string,
      { startBlocked: boolean; last_block_event_at: string | null; last_block_reason: string | null }
    >();

    if (openItemIds.length) {
      const preRows: any[] = await chunkedQuery(
        supabase,
        "work_item_events",
        "work_item_id, event_type, created_at, meta",
        "work_item_id",
        openItemIds,
        (q) =>
          q
            .lt("created_at", sinceIso)
            .in("event_type", ["blocked", "unblocked"])
            .order("created_at", { ascending: false })
            .limit(500), // per chunk — we only need the most recent state
        150
      );

      for (const e of preRows) {
        const wid = String((e as any)?.work_item_id || "").trim();
        if (!wid) continue;
        if (preStateByItem.has(wid)) continue; // descending order — first hit is most recent

        const typ = normStr((e as any)?.event_type);
        const startBlocked = typ === "blocked";
        const reason = (e as any)?.meta?.reason;

        preStateByItem.set(wid, {
          startBlocked,
          last_block_event_at: startBlocked ? (String((e as any)?.created_at || "") || null) : null,
          last_block_reason: startBlocked && typeof reason === "string" && reason.trim() ? reason.trim() : null,
        });
      }
    }

    // ✅ FIX: Process ALL open items for blocked — removed the 1000-item cap.
    // Surface a meta.truncated signal if we had to cap for performance.
    const BLOCKED_ITEM_HARD_CAP = 5000;
    const openItemsForBlocked = openItems.slice(0, BLOCKED_ITEM_HARD_CAP);
    const truncated = openItems.length > BLOCKED_ITEM_HARD_CAP;

    const blocked: any[] = [];
    for (const it of openItemsForBlocked) {
      const wid = String((it as any)?.id || "").trim();
      if (!wid) continue;

      const evs = (evByItem.get(wid) || []).filter((e) => {
        const t = normStr(e?.event_type);
        return t === "blocked" || t === "unblocked";
      });

      const pre = preStateByItem.get(wid);
      const startBlocked = Boolean(pre?.startBlocked);

      const blk = computeBlockedSecondsFromEvents({
        eventsAsc: evs,
        since,
        now,
        startBlocked,
        startReason: pre?.last_block_reason ?? null,
        startBlockAt: pre?.last_block_event_at ?? null,
      });

      if (blk.blocked_seconds > 0 || blk.currently_blocked) {
        const pid = String(it?.project_id || "");
        const due = it?.due_date ?? null;

        blocked.push({
          work_item_id: wid,
          project_id: pid,
          project: project_map[pid] || { id: pid, title: null, project_code: null },
          title: it?.title,
          stage: it?.stage,
          due_date: due,
          due_date_uk: fmtUkDateTime(due, false),
          status: it?.status,

          created_at: it?.created_at ?? null,
          created_at_uk: fmtUkDateTime(it?.created_at, true),
          started_at: it?.started_at ?? null,
          started_at_uk: fmtUkDateTime(it?.started_at, true),
          updated_at: it?.updated_at ?? null,
          updated_at_uk: fmtUkDateTime(it?.updated_at, true),

          blocked_seconds_window: blk.blocked_seconds,
          currently_blocked: blk.currently_blocked,
          last_block_event_at: blk.last_block_event_at,
          last_block_event_at_uk: fmtUkDateTime(blk.last_block_event_at, true),
          last_block_reason: blk.last_block_reason,
        });
      }
    }

    blocked.sort((a, b) => ms(b.blocked_seconds_window) - ms(a.blocked_seconds_window));

    // ✅ FIX: WIP falls back to `status` when `stage` is null — avoids "unknown" flooding
    const wipMap = new Map<string, number>();
    for (const it of openItems) {
      const st = safeStr((it as any)?.stage).trim() || safeStr((it as any)?.status).trim() || "unknown";
      wipMap.set(st, (wipMap.get(st) || 0) + 1);
    }
    const wip = Array.from(wipMap.entries())
      .map(([stage, count]) => ({ stage, count }))
      .sort((a, b) => b.count - a.count);

    // ✅ FIX: dueSoon includes overdue items (past due date) — they're most urgent
    // Previously these were excluded by the `<= dueSoonEnd` filter.
    const dueSoonEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const dueSoon = openItems
      .filter((it: any) => it?.due_date)
      .filter((it: any) => {
        const d = asDate(it.due_date);
        // Include everything with a due date up to +30d (overdue items have d < now, which passes)
        return d ? d.getTime() <= dueSoonEnd.getTime() : false;
      })
      .sort((a: any, b: any) => String(a.due_date).localeCompare(String(b.due_date)))
      .slice(0, 200)
      .map((it: any) => {
        const pid = String(it?.project_id || "");
        const dueDate = asDate(it?.due_date);
        const isOverdue = dueDate ? dueDate.getTime() < Date.now() : false;
        return {
          ...it,
          project: project_map[pid] || { id: pid, title: null, project_code: null },
          is_overdue: isOverdue,

          due_date_uk: fmtUkDateTime(it?.due_date, false),
          created_at_uk: fmtUkDateTime(it?.created_at, true),
          started_at_uk: fmtUkDateTime(it?.started_at, true),
          updated_at_uk: fmtUkDateTime(it?.updated_at, true),
          completed_at_uk: fmtUkDateTime(it?.completed_at, true),
        };
      });

    // Recent done + UK dates
    const recentDoneOut = (recentDone || []).map((it: any) => {
      const pid = String(it?.project_id || "");
      return {
        ...it,
        project: project_map[pid] || { id: pid, title: null, project_code: null },

        due_date_uk: fmtUkDateTime(it?.due_date, false),
        created_at_uk: fmtUkDateTime(it?.created_at, true),
        started_at_uk: fmtUkDateTime(it?.started_at, true),
        updated_at_uk: fmtUkDateTime(it?.updated_at, true),
        completed_at_uk: fmtUkDateTime(it?.completed_at, true),
      };
    });

    const res = jsonOk({
      days,
      days_uk: String(days),
      since: since.toISOString(),
      since_uk: fmtUkDateTime(since.toISOString(), true),
      now: now.toISOString(),
      now_uk: fmtUkDateTime(now.toISOString(), true),

      projects: memberProjectIds,
      projects_active: projectIds,
      project_map,

      // ✅ Surface truncation signal for consumers
      meta: {
        open_item_count: openItems.length,
        blocked_item_cap: BLOCKED_ITEM_HARD_CAP,
        truncated,
        recent_done_lookback_days: Math.max(days * 2, 14),
        events_chunk_limit: EVENTS_LIMIT_PER_CHUNK,
      },

      data: { blocked, wip, dueSoon, recentDone: recentDoneOut },
    });

    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  } catch (e: any) {
    console.error("[GET /api/ai/flow-warning/drilldown]", e);
    const res = jsonErr(String(e?.message || e || "Drilldown failed"), 500);
    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  }
}