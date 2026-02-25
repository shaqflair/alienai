// src/app/api/executive/approvals/who-blocking/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { orgIdsForUser, requireUser, safeStr } from "../approvals/_lib";

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
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  // Single-org exec gate: owner on any active project in org
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
  return (data || []).map((r: any) => safeStr(r?.project_id).trim()).filter(Boolean);
}

function pickProjectId(row: any): string {
  return safeStr(row?.project_id || row?.projectId || row?.project_uuid || row?.projectUuid || "").trim();
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    // Single-org mode: orgIdsForUser returns [profiles.active_organisation_id]
    const orgIds = await orgIdsForUser(user.id);
    const orgId = safeStr(orgIds[0]).trim();
    if (!orgId) return jsonOk({ orgId: null, scope: "member", items: [] });

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    /**
     * Who-blocking:
     * - Prefer cached view/table if you have one (optional):
     *   exec_who_blocking(org_id) or exec_who_blocking table/view
     * - Fallback to tasks where status in ('blocked','overdue')
     *
     * Response stays stable: { items: [...] }
     */
    let items: any[] = [];

    // Optional: cached table/view (won't crash if missing)
    const { data: cached, error: cachedErr } = await supabase
      .from("exec_who_blocking")
      .select("*")
      .eq("org_id", orgId)
      .limit(200);

    if (!cachedErr && Array.isArray(cached) && cached.length) {
      items = cached.map((r: any) => ({
        type: safeStr(r?.type || "item"),
        id: r?.id ?? r?.item_id ?? null,
        title: safeStr(r?.title || r?.label || "Untitled"),
        status: safeStr(r?.status || "blocked"),
        due_at: r?.due_at ?? null,
        updated_at: r?.updated_at ?? null,
        project_id: safeStr(r?.project_id) || null,
        project_name: safeStr(r?.project_name || r?.projects_name) || null,
        assignee_id: r?.assignee_id ?? null,
        blocked_by: r?.blocked_by ?? null,
      }));
    } else {
      // Fallback: tasks
      const { data: tasks, error: tasksErr } = await supabase
        .from("tasks")
        .select(
          "id, title, status, due_at, updated_at, project_id, assignee_id, blocked_by, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .in("status", ["blocked", "overdue"])
        .limit(300);

      if (!tasksErr && Array.isArray(tasks)) {
        items = tasks.map((t: any) => ({
          type: "task",
          id: t.id,
          title: safeStr(t.title || "Untitled"),
          status: safeStr(t.status || "blocked"),
          due_at: t.due_at ?? null,
          updated_at: t.updated_at ?? null,
          project_id: safeStr(t.project_id) || null,
          project_name: safeStr(t.projects?.name) || null,
          assignee_id: t.assignee_id ?? null,
          blocked_by: t.blocked_by ?? null,
        }));
      } else {
        // If tasks table doesn't exist, return empty rather than 500 (prevents blank cockpit)
        items = [];
      }
    }

    if (isExec) {
      return jsonOk({ orgId, scope: "org", items });
    }

    const myProjectIds = await myProjectIdsInOrg(supabase, user.id, orgId);
    const allowed = new Set(myProjectIds);
    const scoped = items.filter((it) => {
      const pid = pickProjectId(it);
      return pid ? allowed.has(pid) : false;
    });

    return jsonOk({ orgId, scope: "member", items: scoped });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonErr(msg, status);
  }
}