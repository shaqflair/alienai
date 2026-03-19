// src/app/api/wbs/items/route.ts
// ✅ Portfolio-scoped: all org members see portfolio-wide WBS items.
//    Project-level access control lives on the frontend (drawer "Open" buttons).
//    ✅ hrefs always use project UUID (not project_code) — consistent with projects list fix.
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
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
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

type DaysParam = 7 | 14 | 30 | 60 | "all";
function clampDays(v: string | null): DaysParam {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "all") return "all";
  const n = Number(s);
  return ([7, 14, 30, 60] as const).includes(n as any) ? (n as 7 | 14 | 30 | 60) : 30;
}

type Bucket = "overdue" | "due_7" | "due_14" | "due_30" | "due_60" | "";
function clampBucket(v: string | null): Bucket {
  const s = String(v ?? "").trim().toLowerCase();
  if (["overdue", "due_7", "due_14", "due_30", "due_60"].includes(s)) return s as Bucket;
  return "";
}

type StatusFilter = "open" | "done" | "";
function clampStatus(v: string | null): StatusFilter {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "open" || s === "done") return s;
  return "";
}

function startOfDayUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDaysUTC(d: Date, days: number) {
  return new Date(d.getTime() + days * 86400000);
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

function fmtDateUK(x: any): string | null {
  if (!x) return null;
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(
    2,
    "0",
  )}/${d.getUTCFullYear()}`;
}

type WbsRow = {
  id?: string;
  level?: number;
  title?: any;
  name?: any;
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
  return !!(
    rows[idx] &&
    rows[idx + 1] &&
    asLevel((rows[idx + 1] as any).level) > asLevel((rows[idx] as any).level)
  );
}
function isDoneStatus(row: WbsRow): boolean {
  const s = String((row as any)?.status || (row as any)?.state || "")
    .trim()
    .toLowerCase();
  if (["done", "closed", "complete", "completed", "cancelled", "canceled"].includes(s)) return true;
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
function rowTitle(row: WbsRow, idx: number) {
  return (
    safeStr((row as any)?.title).trim() ||
    safeStr((row as any)?.name).trim() ||
    `Work package ${idx + 1}`
  );
}
function rowOwner(row: WbsRow) {
  return safeStr((row as any)?.owner_label).trim() || safeStr((row as any)?.owner).trim() || "";
}

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
    return JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

type Item = {
  project_id: string;
  project_title: string;
  project_code?: string | null;
  artifact_id: string;
  artifact_updated_at: string | null;
  artifact_updated_at_iso?: string | null;
  due_date: string | null;
  due_date_iso?: string | null;
  wbs_row_id: string;
  wbs_row_index: number;
  title: string;
  owner_label?: string | null;
  is_done: boolean;
  is_overdue: boolean;
  effort_missing: boolean;
  href: string;
};

export async function GET(req: Request) {
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
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const offset = clampInt(cursor?.offset, 0, 0, 1_000_000);

    // Shared portfolio scope first, membership fallback if empty / failed
    let scoped: any = null;
    let scopedIds: string[] = [];

    try {
      scoped = await resolvePortfolioScope(supabase, userId);
      scopedIds = Array.isArray(scoped?.projectIds) ? uniqStrings(scoped.projectIds) : [];
    } catch (e: any) {
      scoped = { ok: false, error: String(e?.message || e), projectIds: [], meta: null };
      scopedIds = [];
    }

    if (!scopedIds.length) {
      const fallback = await resolveActiveProjectScope(supabase);
      scoped = fallback;
      scopedIds = Array.isArray(fallback?.projectIds) ? uniqStrings(fallback.projectIds) : [];
    }

    // Keep filterActiveProjectIds + fail-open behaviour
    let projectIds = uniqStrings(scopedIds);
    let filterMeta: any = {
      ok: true,
      error: null,
      before: scopedIds.length,
      after: scopedIds.length,
      fail_open: false,
    };

    try {
      const filtered = await filterActiveProjectIds(supabase, scopedIds);
      const filteredIds = uniqStrings(
        Array.isArray(filtered) ? filtered : (filtered as any)?.projectIds ?? [],
      );

      if (filteredIds.length > 0) {
        projectIds = filteredIds;
        filterMeta = {
          ok: (filtered as any)?.ok ?? true,
          error: (filtered as any)?.error ?? null,
          before: scopedIds.length,
          after: filteredIds.length,
          fail_open: false,
        };
      } else {
        projectIds = uniqStrings(scopedIds);
        filterMeta = {
          ok: (filtered as any)?.ok ?? false,
          error: (filtered as any)?.error ?? "filterActiveProjectIds returned 0 rows",
          before: scopedIds.length,
          after: scopedIds.length,
          fail_open: true,
        };
      }
    } catch (e: any) {
      projectIds = uniqStrings(scopedIds);
      filterMeta = {
        ok: false,
        error: String(e?.message || e),
        before: scopedIds.length,
        after: scopedIds.length,
        fail_open: true,
      };
    }

    if (!projectIds.length) {
      return jsonOk({
        items: [],
        nextCursor: null,
        meta: {
          projectCount: 0,
          scope: "portfolio",
          scopeMeta: scoped?.meta ?? null,
          filter: filterMeta,
          active_only: true,
        },
      });
    }

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

    const { data: artRows, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, type, updated_at, content_json, content")
      .in("project_id", projectIds)
      .eq("type", "WBS")
      .limit(3000);

    if (artErr) return jsonErr(artErr.message, 500);

    const today = startOfDayUTC();
    const scopeEnd = days == null ? null : addDaysUTC(today, days);
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
      const project_code = proj?.project_code == null ? null : String(proj.project_code).trim() || null;

      const artifactUpdatedIso = (a as any)?.updated_at ? String((a as any).updated_at) : null;

      const doc = safeJson((a as any)?.content_json) ?? safeJson((a as any)?.content) ?? null;
      if (
        !(
          String(doc?.type || "").trim().toLowerCase() === "wbs" &&
          Number(doc?.version) === 1 &&
          Array.isArray(doc?.rows)
        )
      ) {
        continue;
      }

      const rows = safeArr(doc?.rows) as WbsRow[];

      for (let i = 0; i < rows.length; i++) {
        if (rowHasChildren(rows, i)) continue;
        const row = rows[i];
        const isDone = isDoneStatus(row);
        const due = getDueDate(row);
        const dueDay = due ? startOfDayUTC(due) : null;
        const isOverdue = !isDone && !!dueDay && dueDay.getTime() < today.getTime();

        const inScopeWindow = (() => {
          if (days == null) return true;
          if (!dueDay) return false;
          return dueDay.getTime() < today.getTime() || dueDay.getTime() <= (scopeEnd as Date).getTime();
        })();

        if (bucket) {
          if (!dueDay || isDone) continue;
          if (bucket === "overdue" && !isOverdue) continue;
          else if (bucket === "due_7" && !(dueDay >= today && dueDay <= d7)) continue;
          else if (bucket === "due_14" && !(dueDay > d7 && dueDay <= d14)) continue;
          else if (bucket === "due_30" && !(dueDay > d14 && dueDay <= d30)) continue;
          else if (bucket === "due_60" && !(dueDay > d30 && dueDay <= d60)) continue;
        } else {
          if (!inScopeWindow) continue;
        }

        if (status === "open" && isDone) continue;
        if (status === "done" && !isDone) continue;
        const effortMissing = !rowHasEffort(row);
        if (missingEffort && !effortMissing) continue;

        const title = rowTitle(row, i);
        const owner = rowOwner(row);
        if (q && !`${title} ${owner} ${project_title}`.toLowerCase().includes(q)) continue;

        const rowId = row?.id ? String(row.id) : `${artifactId}:${i}`;
        const dueIso = dueDay ? isoDateOnly(dueDay) : null;

        // Always use project UUID in href
        const href = `/projects/${projectId}/artifacts/${artifactId}?focus=wbs&row=${encodeURIComponent(rowId)}`;

        itemsAll.push({
          project_id: projectId,
          project_title,
          project_code,
          artifact_id: artifactId,
          artifact_updated_at: artifactUpdatedIso ? fmtDateUK(artifactUpdatedIso) : null,
          artifact_updated_at_iso: artifactUpdatedIso,
          due_date: dueIso ? fmtDateUK(dueIso) : null,
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

    // Sort: overdue first, then earliest due, then title
    itemsAll.sort((a, b) => {
      const ao = a.is_overdue ? 0 : 1;
      const bo = b.is_overdue ? 0 : 1;
      if (ao !== bo) return ao - bo;
      const ad = a.due_date_iso ?? "9999-12-31";
      const bd = b.due_date_iso ?? "9999-12-31";
      if (ad < bd) return -1;
      if (ad > bd) return 1;
      return a.title.localeCompare(b.title);
    });

    const total = itemsAll.length;
    const slice = itemsAll.slice(offset, offset + limit);
    const nextOffset = offset + slice.length;
    const nextCursor = nextOffset < total ? encodeCursor({ offset: nextOffset }) : null;
    const generatedAtIso = new Date().toISOString();

    return jsonOk({
      items: slice,
      nextCursor,
      meta: {
        generated_at: fmtDateUK(generatedAtIso),
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
        scope: "portfolio",
        active_only: true,
        scopeMeta: scoped?.meta ?? null,
        filter: filterMeta,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/wbs/items]", e);
    return jsonErr(String(e?.message || e || "Failed"), 500);
  }
}