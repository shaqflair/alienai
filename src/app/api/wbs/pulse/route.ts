// src/app/api/wbs/pulse/route.ts
// ✅ Org-scoped: all org members see portfolio-wide WBS stats.
//    Project-level access control lives on the frontend (drawer "Open" buttons).
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveOrgActiveProjectScope, filterActiveProjectIds } from "@/lib/server/project-scope";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
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
  try { return JSON.parse(String(x)); } catch { return null; }
}

function safeArr(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

type WbsRow = {
  id?: string; level?: number;
  status?: any; state?: any; progress?: any;
  due_date?: any; dueDate?: any; end?: any; end_date?: any; endDate?: any; date?: any;
  effort?: string | null;
  estimated_effort_hours?: any; estimatedEffortHours?: any;
  effort_hours?: any; effortHours?: any;
  estimate_hours?: any; estimateHours?: any;
  estimated_effort?: any; estimatedEffort?: any;
};

function asLevel(x: any) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function rowHasChildren(rows: WbsRow[], idx: number) {
  const cur = rows[idx]; const next = rows[idx + 1];
  return !!(cur && next && asLevel((next as any).level) > asLevel((cur as any).level));
}
function normStr(x: any) { return String(x ?? "").trim().toLowerCase(); }

function safeDate(x: any): Date | null {
  if (!x) return null;
  if (x instanceof Date && !Number.isNaN(x.getTime())) return x;
  const s = String(x).trim(); if (!s) return null;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? null : d;
}
function startOfDayUTC(d = new Date()) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}
function addDaysUTC(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60 * 60 * 1000);
}
function isDoneStatus(row: WbsRow): boolean {
  const s = normStr((row as any)?.status || (row as any)?.state);
  if (["done", "closed", "complete", "completed", "cancelled", "canceled"].includes(s)) return true;
  const p = Number((row as any)?.progress);
  return Number.isFinite(p) && p >= 100;
}
function getDueDate(row: WbsRow): Date | null {
  return safeDate((row as any)?.due_date) || safeDate((row as any)?.dueDate) ||
    safeDate((row as any)?.end_date) || safeDate((row as any)?.endDate) ||
    safeDate((row as any)?.end) || safeDate((row as any)?.date) || null;
}
function rowHasEffort(row: WbsRow): boolean {
  const keys = ["estimated_effort_hours","estimatedEffortHours","effort_hours","effortHours",
    "estimate_hours","estimateHours","estimated_effort","estimatedEffort"] as const;
  for (const k of keys) {
    const v: any = (row as any)?.[k];
    if (v == null || v === "") continue;
    const n = Number(v); if (Number.isFinite(n) && n > 0) return true;
  }
  const e = String((row as any)?.effort ?? "").trim().toUpperCase();
  return e === "S" || e === "M" || e === "L";
}

function calcWbsStatsFromDoc(doc: any, days: number | null) {
  const rows = safeArr(doc?.rows) as WbsRow[];
  if (!rows.length) return { totalLeaves: 0, done: 0, remaining: 0, overdue: 0, due_7: 0, due_14: 0, due_30: 0, due_60: 0, missing_effort: 0 };

  const today = startOfDayUTC();
  const scopeEnd = days == null ? null : addDaysUTC(today, days);
  const d7 = addDaysUTC(today, 7); const d14 = addDaysUTC(today, 14);
  const d30 = addDaysUTC(today, 30); const d60 = addDaysUTC(today, 60);
  const bucketAllowed = (bucketEnd: Date) => !scopeEnd || bucketEnd.getTime() <= scopeEnd.getTime();

  let totalLeaves = 0, done = 0, remaining = 0, overdue = 0;
  let due7 = 0, due14 = 0, due30 = 0, due60 = 0, missingEffort = 0;

  for (let i = 0; i < rows.length; i++) {
    if (rowHasChildren(rows, i)) continue;
    const row = rows[i];
    const isDone = isDoneStatus(row);
    const due = getDueDate(row);

    if (days == null) {
      totalLeaves++; if (isDone) done++; else remaining++;
      if (!rowHasEffort(row)) missingEffort++;
      if (!isDone && due) {
        const dueDay = startOfDayUTC(due);
        if (dueDay.getTime() < today.getTime()) overdue++;
        else if (dueDay.getTime() <= d7.getTime()) due7++;
        else if (dueDay.getTime() <= d14.getTime()) due14++;
        else if (dueDay.getTime() <= d30.getTime()) due30++;
        else if (dueDay.getTime() <= d60.getTime()) due60++;
      }
      continue;
    }

    if (!due) continue;
    const dueDay = startOfDayUTC(due);
    const isOverdue = !isDone && dueDay.getTime() < today.getTime();
    const inScope = isOverdue || dueDay.getTime() <= (scopeEnd as Date).getTime();
    if (!inScope) continue;

    totalLeaves++; if (isDone) done++; else remaining++;
    if (!rowHasEffort(row)) missingEffort++;

    if (isOverdue) { overdue++; continue; }
    if (!isDone) {
      if (bucketAllowed(d7) && dueDay.getTime() <= d7.getTime()) due7++;
      else if (bucketAllowed(d14) && dueDay.getTime() <= d14.getTime()) due14++;
      else if (bucketAllowed(d30) && dueDay.getTime() <= d30.getTime()) due30++;
      else if (bucketAllowed(d60) && dueDay.getTime() <= d60.getTime()) due60++;
    }
  }

  return { totalLeaves, done, remaining, overdue, due_7: due7, due_14: due14, due_30: due30, due_60: due60, missing_effort: missingEffort };
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const userId = auth.user.id;
    const url = new URL(req.url);
    const daysParam = clampDays(url.searchParams.get("days"));
    const days = daysParam === "all" ? null : daysParam;

    // ✅ Org-wide scope (same as insights page)
    const scoped = await resolveOrgActiveProjectScope(supabase, userId);
    const scopedIds = Array.isArray(scoped?.projectIds) ? scoped.projectIds : [];

    const filtered = await filterActiveProjectIds(supabase, scopedIds);
    const projectIds = Array.isArray(filtered?.projectIds) ? filtered.projectIds : [];

    if (!projectIds.length) {
      return jsonOk({
        stats: null,
        meta: {
          projectCount: 0, days: daysParam, scope: "org",
          scopeMeta: scoped?.meta ?? null,
          filter: { ok: filtered?.ok ?? true, error: filtered?.error ?? null, before: scopedIds.length, after: 0 },
          active_only: true,
        },
      });
    }

    const { data: rows, error } = await supabase
      .from("artifacts")
      .select("id, project_id, type, content_json, content")
      .in("project_id", projectIds)
      .eq("type", "wbs")
      .limit(3000);

    if (error) return jsonErr(error.message, 500);

    let total = 0, doneTotal = 0, remaining = 0, overdue = 0;
    let due7 = 0, due14 = 0, due30 = 0, due60 = 0, missingEffort = 0, usableDocs = 0;

    for (const r of rows || []) {
      const doc = safeJson((r as any)?.content_json) ?? safeJson((r as any)?.content) ?? null;
      if (!(String(doc?.type || "").trim().toLowerCase() === "wbs" && Number(doc?.version) === 1 && Array.isArray(doc?.rows))) continue;

      usableDocs++;
      const s = calcWbsStatsFromDoc(doc, days);
      total += s.totalLeaves; doneTotal += s.done; remaining += s.remaining;
      overdue += s.overdue; due7 += s.due_7; due14 += s.due_14;
      due30 += s.due_30; due60 += s.due_60; missingEffort += s.missing_effort;
    }

    if (!usableDocs) {
      return jsonOk({
        stats: null,
        meta: {
          projectCount: projectIds.length, days: daysParam, scope: "org",
          scopeMeta: scoped?.meta ?? null,
          filter: { ok: filtered?.ok ?? true, error: filtered?.error ?? null, before: scopedIds.length, after: projectIds.length },
          active_only: true, note: "No WBS v1 docs found.",
        },
      });
    }

    return jsonOk({
      stats: { total, done: doneTotal, remaining, overdue, due_7: due7, due_14: due14, due_30: due30, due_60: due60, missing_effort: missingEffort },
      meta: {
        projectCount: projectIds.length, days: daysParam, scope: "org", active_only: true,
        scopeMeta: scoped?.meta ?? null,
        filter: { ok: filtered?.ok ?? true, error: filtered?.error ?? null, before: scopedIds.length, after: projectIds.length },
        rowsFetched: (rows || []).length, usableDocs,
      },
    });
  } catch (e: any) {
    console.error("[GET /api/wbs/pulse]", e);
    return jsonErr(String(e?.message || e || "Failed"), 500);
  }
}