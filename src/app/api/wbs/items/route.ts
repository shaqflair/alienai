// src/app/api/wbs/items/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

/* ---------------- utils ---------------- */

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
function safeStr(x: any) {
  return typeof x === "string" ? x : String(x ?? "");
}
function clampInt(x: any, fallback: number, min: number, max: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}
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

type DaysParam = 7 | 14 | 30 | 60 | "all";

function clampDays(v: string | null): DaysParam {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? (n as 7 | 14 | 30 | 60) : 30;
}

type Bucket = "overdue" | "due_7" | "due_14" | "due_30" | "due_60" | "";

function clampBucket(v: string | null): Bucket {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "overdue") return "overdue";
  if (s === "due_7") return "due_7";
  if (s === "due_14") return "due_14";
  if (s === "due_30") return "due_30";
  if (s === "due_60") return "due_60";
  return "";
}

type StatusFilter = "open" | "done" | "";

function clampStatus(v: string | null): StatusFilter {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "open") return "open";
  if (s === "done") return "done";
  return "";
}

function startOfDayUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}
function addDaysUTC(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}
function safeDate(x: any): Date | null {
  if (!x) return null;
  if (x instanceof Date && !Number.isNaN(x.getTime())) return x;
  const s = String(x).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
function isoDateOnly(d: Date) {
  return d.toISOString().slice(0, 10);
}

/** âœ… UK date display (dd/mm/yyyy) from ISO yyyy-mm-dd or timestamp-ish strings */
function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  if (!s) return null;

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!yyyy || !mm || !dd) return null;
    return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

/* ---------------- WBS parsing ---------------- */

type WbsRow = {
  id?: string;
  level?: number;

  title?: any;
  name?: any;
  description?: any;

  status?: any;
  state?: any;
  progress?: any;

  owner_label?: any;
  owner?: any;

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

function normStr(x: any) {
  return String(x ?? "").trim().toLowerCase();
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

function rowTitle(row: WbsRow, idx: number) {
  const t = safeStr((row as any)?.title).trim();
  if (t) return t;
  const n = safeStr((row as any)?.name).trim();
  if (n) return n;
  return `Work package ${idx + 1}`;
}

function rowOwner(row: WbsRow) {
  const o = safeStr((row as any)?.owner_label).trim();
  if (o) return o;
  const o2 = safeStr((row as any)?.owner).trim();
  if (o2) return o2;
  return "";
}

/* ---------------- cursor helpers ---------------- */

function encodeCursor(payload: any) {
  try {
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  } catch {
    return null;
  }
}
function decodeCursor(s: string | null) {
  try {
    if (!s) return null;
    const json = Buffer.from(s, "base64url").toString("utf8");
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* âœ… project scope helpers (exclude closed/deleted)                    */
/* ------------------------------------------------------------------ */

async function fetchMemberProjectIds(supabase: any, userId: string) {
  // best-effort with removed_at (fallback if missing)
  try {
    const { data, error } = await supabase
      .from("project_members")
      .select("project_id, removed_at")
      .eq("user_id", userId)
      .is("removed_at", null);

    if (error) {
      if (looksMissingColumn(error)) throw error;
      return { ok: false, error: error.message, projectIds: [] as string[] };
    }

    return { ok: true, error: null as string | null, projectIds: uniqStrings((data || []).map((r: any) => r?.project_id)) };
  } catch {
    const { data, error } = await supabase.from("project_members").select("project_id").eq("user_id", userId);
    if (error) return { ok: false, error: error.message, projectIds: [] as string[] };

    return { ok: true, error: null as string | null, projectIds: uniqStrings((data || []).map((r: any) => r?.project_id)) };
  }
}

/**
 * Filter membership ids down to ACTIVE projects using your projects schema:
 * - status: 'active' | 'closed'
 * - deleted_at: timestamp|null
 * - closed_at: timestamp|null
 *
 * If projects query fails (RLS/missing cols), fallback safely.
 */
async function filterActiveProjectIds(supabase: any, projectIds: string[]) {
  const ids = uniqStrings(projectIds);
  if (!ids.length) return { ok: true, error: null as string | null, projectIds: [] as string[] };

  try {
    const { data, error } = await supabase
      .from("projects")
      .select("id, status, deleted_at, closed_at")
      .in("id", ids)
      .limit(10000);

    if (error) {
      if (looksMissingColumn(error) || looksMissingRelation(error)) throw error;
      // RLS / other: keep ids (avoid blank UI)
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

      if (deletedAt) continue;
      if (closedAt) continue;
      if (status && status !== "active") continue;

      out.push(id);
    }

    return { ok: true, error: null, projectIds: uniqStrings(out) };
  } catch {
    // fallback: existence-only
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

/* ---------------- main handler ---------------- */

type Item = {
  project_id: string;
  project_title: string;
  project_code?: string | null;

  artifact_id: string;

  /** âœ… UK dates only in primary fields */
  artifact_updated_at: string | null; // dd/mm/yyyy
  due_date: string | null; // dd/mm/yyyy

  /** âœ… keep ISO copies for sorting / deep logic */
  artifact_updated_at_iso?: string | null; // yyyy-mm-dd or full ISO
  due_date_iso?: string | null; // yyyy-mm-dd

  wbs_row_id: string;
  wbs_row_index: number;

  title: string;
  owner_label?: string | null;

  is_done: boolean;
  is_overdue: boolean;

  effort_missing: boolean;

  href: string;
};

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const userId = auth.user.id;

    const url = new URL(req.url);

    const daysParam = clampDays(url.searchParams.get("days"));
    const days: number | null = daysParam === "all" ? null : daysParam;

    const bucket = clampBucket(url.searchParams.get("bucket"));
    const status = clampStatus(url.searchParams.get("status"));

    const missingEffort = url.searchParams.get("missingEffort") === "1";

    const q = String(url.searchParams.get("q") ?? "").trim().toLowerCase();

    const limit = clampInt(url.searchParams.get("limit"), 100, 10, 500);
    const cursorRaw = url.searchParams.get("cursor");
    const cursor = decodeCursor(cursorRaw);
    const offset = clampInt(cursor?.offset, 0, 0, 1_000_000);

    // memberships -> project IDs
    const mem = await fetchMemberProjectIds(supabase, userId);
    if (!mem.ok) return jsonErr(mem.error || "Failed to resolve membership", 500);

    const filtered = await filterActiveProjectIds(supabase, mem.projectIds);
    const projectIds = filtered.projectIds;

    if (!projectIds.length) {
      const res = jsonOk({
        items: [],
        nextCursor: null,
        meta: {
          projectCount: 0,
          filter: { ok: filtered.ok, error: filtered.error || null, before: mem.projectIds.length, after: 0 },
          active_only: true,
        },
      });
      res.headers.set("Cache-Control", "no-store, max-age=0");
      return res;
    }

    // project titles for display
    const { data: projRows } = await supabase
      .from("projects")
      .select("id,title,project_code")
      .in("id", projectIds)
      .limit(10000);

    const projMap = new Map<string, { title: string; project_code: any }>();
    for (const p of projRows || []) {
      projMap.set(String((p as any)?.id), {
        title: String((p as any)?.title ?? "Untitled project"),
        project_code: (p as any)?.project_code ?? null,
      });
    }

    // all WBS artifacts in scope
    const { data: artRows, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, type, updated_at, content_json, content")
      .in("project_id", projectIds)
      .eq("type", "wbs")
      .limit(3000);

    if (artErr) return jsonErr(artErr.message, 500);

    const today = startOfDayUTC(new Date());
    const scopeEnd = days == null ? null : addDaysUTC(today, days);

    // due bucket boundaries (pressure from today)
    const d7 = addDaysUTC(today, 7);
    const d14 = addDaysUTC(today, 14);
    const d30 = addDaysUTC(today, 30);
    const d60 = addDaysUTC(today, 60);

    const itemsAll: Item[] = [];

    for (const a of artRows || []) {
      const artifactId = String((a as any)?.id || "");
      const projectId = String((a as any)?.project_id || "");
      if (!artifactId || !projectId) continue;

      const proj = projMap.get(projectId);
      const project_title = proj?.title ?? "Untitled project";
      const project_code = proj?.project_code ?? null;

      const artifactUpdatedIso = (a as any)?.updated_at ? String((a as any).updated_at) : null;
      const artifactUpdatedUk = artifactUpdatedIso ? fmtDateUK(artifactUpdatedIso) : null;

      const doc = safeJson((a as any)?.content_json) ?? safeJson((a as any)?.content) ?? null;
      const dtype = String(doc?.type || "").trim().toLowerCase();
      const ver = Number(doc?.version);
      if (!(dtype === "wbs" && ver === 1 && Array.isArray(doc?.rows))) continue;

      const rows = safeArr(doc?.rows) as WbsRow[];

      for (let i = 0; i < rows.length; i++) {
        if (rowHasChildren(rows, i)) continue; // leaf only

        const row = rows[i];
        const isDone = isDoneStatus(row);
        const due = getDueDate(row);
        const dueDay = due ? startOfDayUTC(due) : null;

        const isOverdue = !isDone && !!dueDay && dueDay.getTime() < today.getTime();
        const effortMissing = !rowHasEffort(row);

        const inScopeWindow = (() => {
          if (days == null) return true; // ALL
          if (!dueDay) return false;
          return dueDay.getTime() < today.getTime() || dueDay.getTime() <= (scopeEnd as Date).getTime();
        })();

        // -------------------------
        // APPLY FILTERS
        // -------------------------

        // Bucket filters (explicit)
        if (bucket) {
          if (!dueDay) continue;
          if (isDone) continue;

          if (bucket === "overdue") {
            if (!isOverdue) continue;
          } else if (bucket === "due_7") {
            if (!(dueDay.getTime() >= today.getTime() && dueDay.getTime() <= d7.getTime())) continue;
          } else if (bucket === "due_14") {
            if (!(dueDay.getTime() > d7.getTime() && dueDay.getTime() <= d14.getTime())) continue;
          } else if (bucket === "due_30") {
            if (!(dueDay.getTime() > d14.getTime() && dueDay.getTime() <= d30.getTime())) continue;
          } else if (bucket === "due_60") {
            if (!(dueDay.getTime() > d30.getTime() && dueDay.getTime() <= d60.getTime())) continue;
          }
        } else {
          if (!inScopeWindow) continue;
        }

        // Status filter
        if (status === "open" && isDone) continue;
        if (status === "done" && !isDone) continue;

        // Missing effort filter
        if (missingEffort && !effortMissing) continue;

        // Search filter
        const title = rowTitle(row, i);
        const owner = rowOwner(row);
        if (q) {
          const hay = `${title} ${owner} ${project_title}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }

        const rowId = row?.id ? String(row.id) : `${artifactId}:${i}`;
        const href = `/projects/${projectId}/artifacts/${artifactId}?focus=wbs&row=${encodeURIComponent(rowId)}`;

        const dueIso = dueDay ? isoDateOnly(dueDay) : null;
        const dueUk = dueIso ? fmtDateUK(dueIso) : null;

        itemsAll.push({
          project_id: projectId,
          project_title,
          project_code: project_code == null ? null : String(project_code),

          artifact_id: artifactId,

          // âœ… UK-first fields
          artifact_updated_at: artifactUpdatedUk,
          due_date: dueUk,

          // âœ… ISO copies for sorting/logic (optional but recommended)
          artifact_updated_at_iso: artifactUpdatedIso,
          due_date_iso: dueIso,

          wbs_row_id: rowId,
          wbs_row_index: i,

          title,
          owner_label: owner || null,

          is_done: isDone,
          is_overdue: isOverdue,

          effort_missing: effortMissing,

          href,
        });
      }
    }

    // Sort: overdue first, then earliest due (ISO), then title
    itemsAll.sort((a, b) => {
      const ao = a.is_overdue ? 0 : 1;
      const bo = b.is_overdue ? 0 : 1;
      if (ao !== bo) return ao - bo;

      const ad = a.due_date_iso ? a.due_date_iso : "9999-12-31";
      const bd = b.due_date_iso ? b.due_date_iso : "9999-12-31";
      if (ad < bd) return -1;
      if (ad > bd) return 1;

      return a.title.localeCompare(b.title);
    });

    const total = itemsAll.length;

    const slice = itemsAll.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < total ? encodeCursor({ offset: nextOffset }) : null;

    // âœ… meta dates in UK too
    const generatedAtIso = new Date().toISOString();
    const generatedAtUk = fmtDateUK(generatedAtIso);

    const res = jsonOk({
      items: slice,
      nextCursor,
      meta: {
        generated_at: generatedAtUk, // âœ… UK
        generated_at_iso: generatedAtIso,

        days: daysParam,
        bucket: bucket || null,
        status: status || null,
        missingEffort: missingEffort ? 1 : 0,
        q: q || null,

        projectCount: projectIds.length,
        total,
        limit,
        offset,

        active_only: true,
        filter: {
          ok: filtered.ok,
          error: filtered.error || null,
          before: mem.projectIds.length,
          after: projectIds.length,
        },
      },
    });

    res.headers.set("Cache-Control", "no-store, max-age=0");
    return res;
  } catch (e: any) {
    console.error("[GET /api/wbs/items]", e);
    return jsonErr(String(e?.message || e || "Failed"), 500);
  }
}


