import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

const ss = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));

async function resolveOrgIds(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(50);

  return Array.from(new Set((data ?? []).map((m: any) => ss(m?.organisation_id)).filter(Boolean)));
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();
    if (userErr || !user) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });

    const orgIds = await resolveOrgIds(supabase, user.id);
    if (!orgIds.length) return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });

    // 1) org members (no nested profiles)
    const { data: members, error: memErr } = await supabase
      .from("organisation_members")
      .select("user_id, role, department, organisation_id")
      .in("organisation_id", orgIds)
      .is("removed_at", null);

    if (memErr) return noStoreJson({ ok: false, error: memErr.message }, { status: 500 });

    const base = new Map<string, { user_id: string; role: string; department: string | null }>();
    for (const m of members ?? []) {
      const uid = ss((m as any)?.user_id);
      if (!uid || base.has(uid)) continue;
      base.set(uid, {
        user_id: uid,
        role: ss((m as any)?.role) || "member",
        department: ss((m as any)?.department) ? ss((m as any)?.department) : null,
      });
    }

    const usersBase = Array.from(base.values());
    if (!usersBase.length) return noStoreJson({ ok: true, items: [] });

    const userIds = usersBase.map((u) => u.user_id);

    // 2) profiles (separate query)
    const { data: profiles, error: profErr } = await supabase
      .from("profiles")
      .select("id, full_name, email, avatar_url, department")
      .in("id", userIds);

    if (profErr) return noStoreJson({ ok: false, error: profErr.message }, { status: 500 });

    const profMap = new Map<
      string,
      { full_name: string; email: string; avatar_url: string | null; department: string | null }
    >();

    for (const p of profiles ?? []) {
      const id = ss((p as any)?.id);
      if (!id) continue;
      profMap.set(id, {
        full_name: ss((p as any)?.full_name) || ss((p as any)?.email) || "Unknown",
        email: ss((p as any)?.email),
        avatar_url: (p as any)?.avatar_url ?? null,
        department: ss((p as any)?.department) ? ss((p as any)?.department) : null,
      });
    }

    const users = usersBase.map((u) => {
      const p = profMap.get(u.user_id);
      return {
        user_id: u.user_id,
        role: u.role,
        department: p?.department ?? u.department ?? null, // ✅ include dept
        full_name: p?.full_name ?? "Unknown",
        email: p?.email ?? "",
        avatar_url: p?.avatar_url ?? null,
      };
    });

    // 3) projects managed
    const { data: projectRows } = await supabase
      .from("projects")
      .select("id, project_manager_id, project_code, title, status, organisation_id, deleted_at")
      .in("organisation_id", orgIds)
      .is("deleted_at", null)
      .in("project_manager_id", userIds);

    const projectsByPm = new Map<string, number>();
    const projectListByPm = new Map<
      string,
      { id: string; title: string | null; project_code: string | null }[]
    >();

    for (const p of projectRows ?? []) {
      const pmId = ss((p as any)?.project_manager_id);
      if (!pmId) continue;
      projectsByPm.set(pmId, (projectsByPm.get(pmId) ?? 0) + 1);

      const list = projectListByPm.get(pmId) ?? [];
      list.push({ id: ss((p as any)?.id), title: (p as any)?.title ?? null, project_code: (p as any)?.project_code ?? null });
      projectListByPm.set(pmId, list);
    }

    // 4) decisions
    const { data: decisionRows } = await supabase
      .from("artifact_approval_decisions")
      .select("actor_user_id, decision, created_at")
      .in("actor_user_id", userIds)
      .order("created_at", { ascending: false });

    const approvedByUser = new Map<string, number>();
    const rejectedByUser = new Map<string, number>();

    for (const d of decisionRows ?? []) {
      const uid = ss((d as any)?.actor_user_id);
      if (!uid) continue;
      const dec = ss((d as any)?.decision).toLowerCase();
      if (dec === "approved" || dec === "approve") approvedByUser.set(uid, (approvedByUser.get(uid) ?? 0) + 1);
      if (dec === "rejected" || dec === "reject" || dec === "declined") rejectedByUser.set(uid, (rejectedByUser.get(uid) ?? 0) + 1);
    }

    // 5) pending approvals by user
    const { data: pendingRows } = await supabase
      .from("v_pending_artifact_approvals_all")
      .select("pending_user_id, step_status")
      .eq("step_status", "pending")
      .in("pending_user_id", userIds);

    const pendingByUser = new Map<string, number>();
    for (const r of pendingRows ?? []) {
      const uid = ss((r as any)?.pending_user_id);
      if (!uid) continue;
      pendingByUser.set(uid, (pendingByUser.get(uid) ?? 0) + 1);
    }

    // 6) overdue via exec_approval_cache (match by email label)
    const { data: cacheRows } = await supabase
      .from("exec_approval_cache")
      .select("approver_label, sla_status")
      .in("organisation_id", orgIds);

    const overdueByUser = new Map<string, number>();
    const emailToUid = new Map<string, string>();
    for (const u of users) if (u.email) emailToUid.set(u.email.toLowerCase(), u.user_id);

    for (const row of cacheRows ?? []) {
      const label = ss((row as any)?.approver_label).toLowerCase().trim();
      const sla = ss((row as any)?.sla_status).toLowerCase();
      const isOverdue = sla === "overdue" || sla === "breached" || sla === "overdue_undecided";
      if (!isOverdue || !label) continue;

      const uid = emailToUid.get(label);
      if (!uid) continue;
      overdueByUser.set(uid, (overdueByUser.get(uid) ?? 0) + 1);
    }

    // 7) assemble
    const PM_COLORS = ["#6366f1","#10b981","#f59e0b","#06b6d4","#f43f5e","#8b5cf6","#ec4899","#14b8a6"];

    const items = users
      .map((u, i) => {
        const approved = approvedByUser.get(u.user_id) ?? 0;
        const rejected = rejectedByUser.get(u.user_id) ?? 0;
        const pending = pendingByUser.get(u.user_id) ?? 0;
        const overdue = overdueByUser.get(u.user_id) ?? 0;
        const projects = projectsByPm.get(u.user_id) ?? 0;
        const projectList = projectListByPm.get(u.user_id) ?? [];
        const total = approved + rejected;
        const approvalRate = total > 0 ? Math.round((approved / total) * 100) : null;

        return {
          user_id: u.user_id,
          full_name: u.full_name,
          email: u.email,
          avatar_url: u.avatar_url,
          role: u.role,
          department: u.department, // ✅ surfaced
          color: PM_COLORS[i % PM_COLORS.length],
          projects_managed: projects,
          project_list: projectList,
          decisions: { approved, rejected, total, approval_rate: approvalRate },
          pending_as_approver: pending,
          overdue_items: overdue,
          rag: overdue >= 3 ? "R" : overdue >= 1 ? "A" : "G",
        };
      })
      .sort((a, b) => b.projects_managed - a.projects_managed || b.overdue_items - a.overdue_items);

    return noStoreJson({ ok: true, items, org_ids: orgIds });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}