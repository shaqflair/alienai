// src/app/api/executive/approvals/who-blocking/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { orgIdsForUser, requireUser, safeStr } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, ...(meta ? { meta } : {}) }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

// date-only ("YYYY-MM-DD") as local date to prevent drift
function toDate(x: any): Date | null {
  if (!x) return null;

  if (typeof x === "string") {
    const s = x.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [yy, mm, dd] = s.split("-").map((v) => Number(v));
      const dt = new Date(yy, (mm || 1) - 1, dd || 1);
      return Number.isFinite(dt.getTime()) ? dt : null;
    }
  }

  const d = new Date(x);
  return Number.isFinite(d.getTime()) ? d : null;
}

function daysBetween(a: Date, b: Date) {
  return Math.floor((b.getTime() - a.getTime()) / 86400000);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function parseIntSafe(x: any, fallback: number) {
  const n = Number.parseInt(String(x ?? ""), 10);
  return Number.isFinite(n) ? n : fallback;
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
}

async function myProjectIdsInOrg(supabase: any, userId: string, orgId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId);

  if (error) throw new Error(error.message);

  return (data || [])
    .map((r: any) => safeStr(r?.project_id).trim())
    .filter(Boolean);
}

type BlockerRow = {
  key: string;
  name: string;
  label: string;
  count: number;
  pending_count: number;
  overdue_count: number;
  max_wait_days: number;
  avg_wait_days: number;
  projects_affected: number;
  project_ids: string[];
  user_id: string | null;
  email: string | null;
};

function rollupBlockers(rows: any[], approvalSlaDays = 5): BlockerRow[] {
  const now = new Date();

  const map = new Map<
    string,
    {
      key: string;
      name: string;
      label: string;
      user_id: string | null;
      email: string | null;
      count: number;
      overdue: number;
      maxAge: number;
      ages: number[];
      projects: Set<string>;
    }
  >();

  for (const r of rows) {
    const uid = safeStr(r?.pending_user_id).trim();
    const em = safeStr(r?.pending_email).trim();
    const explicitLabel = safeStr(r?.approver_label).trim();
    const key = uid || em || "unknown";

    const label = explicitLabel || em || (uid ? `user:${uid}` : "Unassigned");
    const name = explicitLabel || em || (uid ? `user:${uid}` : "Unassigned");

    const pendingSince = toDate(r?.step_pending_since);
    const age = pendingSince ? Math.max(0, daysBetween(pendingSince, now)) : 0;
    const overdue = age > approvalSlaDays;

    const pid = safeStr(r?.project_id).trim();

    const cur =
      map.get(key) ||
      ({
        key,
        name,
        label,
        user_id: uid || null,
        email: em || null,
        count: 0,
        overdue: 0,
        maxAge: 0,
        ages: [],
        projects: new Set<string>(),
      } as const);

    cur.count += 1;
    if (overdue) cur.overdue += 1;
    cur.maxAge = Math.max(cur.maxAge, age);
    cur.ages.push(age);
    if (pid) cur.projects.add(pid);

    if (!cur.user_id && uid) cur.user_id = uid;
    if (!cur.email && em) cur.email = em;
    if ((!cur.label || cur.label === "Unassigned") && label) cur.label = label;
    if ((!cur.name || cur.name === "Unassigned") && name) cur.name = name;

    map.set(key, cur);
  }

  return Array.from(map.values())
    .map((b) => {
      const avg =
        b.ages.length > 0
          ? Math.round((b.ages.reduce((a, n) => a + n, 0) / b.ages.length) * 10) / 10
          : 0;

      const projectIds = Array.from(b.projects);

      return {
        key: b.key,
        name: b.name,
        label: b.label,
        count: b.count,
        pending_count: b.count,
        overdue_count: b.overdue,
        max_wait_days: b.maxAge,
        avg_wait_days: avg,
        projects_affected: projectIds.length,
        project_ids: projectIds,
        user_id: b.user_id,
        email: b.email,
      };
    })
    .sort(
      (a, b) =>
        b.overdue_count - a.overdue_count ||
        b.pending_count - a.pending_count ||
        b.max_wait_days - a.max_wait_days ||
        a.label.localeCompare(b.label)
    );
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const _auth = await requireUser(supabase);
    const user = (_auth as any)?.user ?? _auth;

    const url = new URL(req.url);
    const approvalSlaDays = clamp(parseIntSafe(url.searchParams.get("approvalSlaDays"), 5), 1, 60);

    const orgIds = await orgIdsForUser(supabase, user.id);
    const orgId = safeStr(orgIds[0]).trim();

    if (!orgId) {
      return jsonOk({
        orgId: null,
        scope: "member",
        generated_at: new Date().toISOString(),
        items: [],
      });
    }

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    let items: BlockerRow[] = [];

    // 1) Optional cache/table/view
    const { data: cached, error: cachedErr } = await supabase
      .from("exec_who_blocking")
      .select("*")
      .eq("org_id", orgId)
      .limit(300);

    if (!cachedErr && Array.isArray(cached) && cached.length) {
      items = cached
        .map((r: any) => {
          const rawName = safeStr(r?.name || r?.label || r?.email || r?.user || "Unassigned").trim();
          const pendingCount = Number(r?.pending_count ?? r?.count ?? 0);
          const overdueCount = Number(r?.overdue_count ?? 0);
          const maxWaitDays = Number(r?.max_wait_days ?? r?.oldest_days ?? 0);
          const avgWaitDays = Number(r?.avg_wait_days ?? 0);
          const projectsAffected = Number(r?.projects_affected ?? 0);
          const projectIds = Array.isArray(r?.project_ids)
            ? r.project_ids.map((x: any) => safeStr(x).trim()).filter(Boolean)
            : [];

          return {
            key: safeStr(r?.key || r?.user_id || r?.email || rawName),
            name: rawName,
            label: rawName,
            count: Number.isFinite(pendingCount) ? pendingCount : 0,
            pending_count: Number.isFinite(pendingCount) ? pendingCount : 0,
            overdue_count: Number.isFinite(overdueCount) ? overdueCount : 0,
            max_wait_days: Number.isFinite(maxWaitDays) ? maxWaitDays : 0,
            avg_wait_days: Number.isFinite(avgWaitDays) ? avgWaitDays : 0,
            projects_affected: Number.isFinite(projectsAffected)
              ? projectsAffected
              : projectIds.length,
            project_ids: projectIds,
            user_id: safeStr(r?.user_id).trim() || null,
            email: safeStr(r?.email).trim() || null,
          } satisfies BlockerRow;
        })
        .filter((x) => x.pending_count > 0);
    } else {
      // 2) Approvals view (preferred)
      const { data: projRaw, error: projErr } = await supabase
        .from("projects")
        .select("id, organisation_id, status, lifecycle_status, resource_status, deleted_at")
        .eq("organisation_id", orgId)
        .is("deleted_at", null)
        .eq("status", "active")
        .neq("resource_status", "pipeline");

      const projectIds = (projRaw ?? [])
        .map((p: any) => safeStr(p?.id).trim())
        .filter(Boolean);

      if (!projErr && projectIds.length) {
        const { data: approvalsRaw, error: apprErr } = await supabase
          .from("v_pending_artifact_approvals_all")
          .select(
            [
              "project_id",
              "artifact_step_id",
              "step_status",
              "pending_user_id",
              "pending_email",
              "approver_label",
              "step_pending_since",
            ].join(",")
          )
          .in("project_id", projectIds);

        if (!apprErr && Array.isArray(approvalsRaw) && approvalsRaw.length) {
          const pendingOnly = approvalsRaw.filter(
            (r: any) => safeStr(r?.step_status).trim().toLowerCase() === "pending"
          );
          items = rollupBlockers(pendingOnly, approvalSlaDays);
        }
      }

      // 3) Fallback: blocked tasks
      if (!items.length) {
        const { data: tasks, error: tasksErr } = await supabase
          .from("tasks")
          .select(
            "id, status, due_at, updated_at, project_id, assignee_id, blocked_by, projects!inner(id, organisation_id, name)"
          )
          .eq("projects.organisation_id", orgId)
          .in("status", ["blocked", "overdue"])
          .limit(500);

        if (!tasksErr && Array.isArray(tasks) && tasks.length) {
          const fakeRows = tasks.map((t: any) => ({
            project_id: safeStr(t?.project_id).trim(),
            pending_user_id: safeStr(t?.blocked_by || t?.assignee_id || "").trim(),
            pending_email: "",
            approver_label: safeStr(t?.blocked_by || t?.assignee_id || "blocked").trim(),
            step_pending_since: t?.updated_at ?? null,
            step_status: "pending",
          }));

          items = rollupBlockers(fakeRows, approvalSlaDays);
        }
      }
    }

    if (isExec) {
      return jsonOk({
        orgId,
        scope: "org",
        generated_at: new Date().toISOString(),
        items,
      });
    }

    const myProjectIds = await myProjectIdsInOrg(supabase, user.id, orgId);
    const allowed = new Set(myProjectIds);

    const scoped = items.filter((b) => {
      const pids = Array.isArray(b.project_ids) ? b.project_ids : [];
      return pids.some((pid) => allowed.has(pid));
    });

    return jsonOk({
      orgId,
      scope: "member",
      generated_at: new Date().toISOString(),
      items: scoped,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonErr(msg, status);
  }
}