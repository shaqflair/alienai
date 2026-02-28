// src/app/api/executive/approvals/bottlenecks/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { clampDays, orgIdsForUser, requireUser, safeStr, num } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  // Exec gate: owner on any active project in org
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

function waitDaysFromRow(r: any) {
  const raw =
    safeStr(r?.step_pending_since) ||
    safeStr(r?.pending_since) ||
    safeStr(r?.created_at) ||
    safeStr(r?.task_created_at) ||
    "";
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

function approverLabelFromRow(r: any) {
  return (
    safeStr(r?.approver_label) ||
    safeStr(r?.approval_group_name) ||
    safeStr(r?.group_name) ||
    safeStr(r?.approver_name) ||
    safeStr(r?.pending_email) ||
    safeStr(r?.pending_user_id) ||
    "Unassigned"
  );
}

function approverKindFromRow(r: any) {
  const k = safeStr(r?.approver_kind).toLowerCase().trim();
  if (k === "user" || k === "group" || k === "role") return k;
  if (r?.approval_group_id || r?.group_id) return "group";
  if (r?.pending_user_id || r?.approver_user_id) return "user";
  return "group";
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    const user = (auth as any)?.user ?? auth;

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));

    const orgIds = await orgIdsForUser(supabase, user.id);
    const orgId = safeStr(orgIds[0]).trim();
    if (!orgId) return jsonOk({ days, orgId: null, scope: "member", source: "none", items: [] });

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    // 1) Prefer cache (org-wide). If not exec, we still return cache but mark scope=member
    // (cache cannot always be project-filtered without changing the cache schema).
    const { data: cached, error: cachedErr } = await supabase
      .from("exec_approval_bottlenecks")
      .select("*")
      .eq("org_id", orgId)
      .limit(200);

    if (!cachedErr && Array.isArray(cached) && cached.length) {
      const items = cached
        .map((r: any) => ({
          kind: safeStr(r?.kind || r?.approver_kind || "group"),
          label: safeStr(
            r?.label ||
              r?.approver_label ||
              r?.group_name ||
              r?.user_name ||
              "Unknown"
          ),
          pending_count: num(r?.pending_count ?? r?.count),
          projects_affected: num(r?.projects_affected ?? r?.project_count),
          avg_wait_days: num(r?.avg_wait_days ?? r?.avg_days ?? r?.avg_wait),
          max_wait_days: num(r?.max_wait_days ?? r?.max_days ?? r?.max_wait),
        }))
        .sort((a, b) => b.pending_count - a.pending_count)
        .slice(0, 25);

      return jsonOk({ days, orgId, scope: isExec ? "org" : "member", source: "cache", items });
    }

    // 2) Live compute
    let list: any[] = [];

    // Try org-scoped view first
    {
      const { data, error } = await supabase
        .from("v_pending_artifact_approvals")
        .select("*")
        .eq("org_id", orgId)
        .limit(5000);

      if (!error && Array.isArray(data)) list = data;
    }

    // Fallback: project-scoped "all" view
    if (!list.length) {
      const { data: projects, error: pErr } = await supabase
        .from("projects")
        .select("id")
        .eq("organisation_id", orgId)
        .is("deleted_at", null)
        .limit(5000);

      const projectIds =
        !pErr && Array.isArray(projects)
          ? projects.map((p: any) => safeStr(p?.id)).filter(Boolean)
          : [];

      if (projectIds.length) {
        const { data: rowsAll, error: aErr } = await supabase
          .from("v_pending_artifact_approvals_all")
          .select("*")
          .in("project_id", projectIds)
          .limit(5000);

        if (!aErr && Array.isArray(rowsAll)) list = rowsAll;
      }
    }

    if (!list.length) {
      return jsonOk({ days, orgId, scope: isExec ? "org" : "member", source: "live", items: [] });
    }

    // Member scope filtering (live only)
    if (!isExec) {
      const myProjectIds = await myProjectIdsInOrg(supabase, user.id, orgId);
      const allowed = new Set(myProjectIds);
      list = list.filter((r: any) => {
        const pid = safeStr(r?.project_id || r?.projectId || r?.project_uuid || r?.projectUuid || "").trim();
        return pid ? allowed.has(pid) : false;
      });
    }

    // Aggregate by approver label
    const by = new Map<
      string,
      {
        kind: string;
        label: string;
        pending_count: number;
        projects: Set<string>;
        waitSum: number;
        waitMax: number;
      }
    >();

    for (const r of list) {
      const label = approverLabelFromRow(r);
      const key = label.toLowerCase().trim();
      if (!key) continue;

      const waitDays = waitDaysFromRow(r);
      const projectId = safeStr(r?.project_id);

      const cur =
        by.get(key) ??
        ({
          kind: approverKindFromRow(r),
          label,
          pending_count: 0,
          projects: new Set<string>(),
          waitSum: 0,
          waitMax: 0,
        } as any);

      cur.pending_count += 1;
      if (projectId) cur.projects.add(projectId);
      cur.waitSum += waitDays;
      cur.waitMax = Math.max(cur.waitMax, waitDays);

      by.set(key, cur);
    }

    const items = Array.from(by.values())
      .map((x: any) => ({
        kind: x.kind,
        label: x.label,
        pending_count: x.pending_count,
        projects_affected: x.projects.size,
        avg_wait_days: x.pending_count
          ? Math.round((x.waitSum / x.pending_count) * 10) / 10
          : 0,
        max_wait_days: x.waitMax,
      }))
      .sort(
        (a, b) =>
          b.pending_count - a.pending_count || b.max_wait_days - a.max_wait_days
      )
      .slice(0, 25);

    return jsonOk({ days, orgId, scope: isExec ? "org" : "member", source: "live", items });
  } catch (e: any) {
    return jsonErr(safeStr(e?.message || "Failed"), 500);
  }
}