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
const sn = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
};

const DAY = 24 * 60 * 60 * 1000;
const SLA_DAYS = 5;

async function getOrgIds(supabase: any, userId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(50);

  if (error) return [];
  return Array.from(new Set((data ?? []).map((m: any) => ss(m?.organisation_id)).filter(Boolean)));
}

const CLOSED_STATES = [
  "closed",
  "cancelled",
  "canceled",
  "archived",
  "completed",
  "inactive",
  "on_hold",
  "paused",
  "suspended",
];

function isProjectActive(p: any): boolean {
  if (p?.deleted_at) return false;
  if (p?.closed_at) return false;

  const st = ss(p?.status ?? p?.lifecycle_status ?? p?.state).toLowerCase().trim();
  if (!st) return true;
  return !CLOSED_STATES.some((s) => st.includes(s));
}

function formatPendingAgeLabel(pendingDays: number | null) {
  if (pendingDays == null) return "Unknown";
  if (pendingDays <= 0) return "Today";
  if (pendingDays === 1) return "1 day";
  return `${pendingDays} days`;
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(sn(url.searchParams.get("days") ?? "7"), 1), 90);

    const supabase = await createClient();
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser();

    if (userErr || !user) {
      return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });
    }

    const orgIds = await getOrgIds(supabase, user.id);
    if (!orgIds.length) {
      return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });
    }

    const since = new Date(Date.now() - days * DAY).toISOString();
    const now = Date.now();
    const nowIso = new Date(now).toISOString();

    // 1) Projects
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select(
        "id, title, project_code, created_at, updated_at, status, lifecycle_status, resource_status, project_manager_id, deleted_at, closed_at, organisation_id"
      )
      .in("organisation_id", orgIds)
      .is("deleted_at", null)
      .neq("resource_status", "pipeline");

    if (projErr) {
      return noStoreJson({ ok: false, error: projErr.message }, { status: 500 });
    }

    const allProjects = projects ?? [];
    const activeProjects = allProjects.filter(isProjectActive);
    const newProjects = activeProjects.filter((p: any) => p?.created_at && p.created_at >= since);
    const projectIds = activeProjects.map((p: any) => ss(p.id)).filter(Boolean);
    const activeProjectIdSet = new Set(projectIds);

    // 2) LIVE pending approvals — aligned with /api/executive/approvals
    let pendingItems: any[] = [];

    if (projectIds.length > 0) {
      const { data: pendingRows, error: pendingErr } = await supabase
        .from("v_pending_artifact_approvals_all")
        .select(
          [
            "artifact_id",
            "project_id",
            "artifact_type",
            "title",
            "approval_status",
            "artifact_step_id",
            "chain_id",
            "step_order",
            "step_name",
            "step_status",
            "pending_user_id",
            "pending_email",
            "artifact_submitted_at",
            "step_pending_since",
          ].join(",")
        )
        .in("project_id", projectIds)
        .limit(500);

      if (pendingErr) {
        return noStoreJson({ ok: false, error: pendingErr.message }, { status: 500 });
      }

      const stepsSeen = new Set<string>();

      pendingItems = (pendingRows ?? [])
        .filter((r: any) => {
          const pid = ss(r?.project_id).trim();
          return !!pid && activeProjectIdSet.has(pid);
        })
        .filter((r: any) => {
          const stepId = ss(r?.artifact_step_id).trim();
          if (!stepId) return true;
          if (stepsSeen.has(stepId)) return false;
          stepsSeen.add(stepId);
          return true;
        })
        .map((r: any) => {
          const pendingSince = r.step_pending_since ?? r.artifact_submitted_at ?? null;
          const pendingMs =
            pendingSince != null ? Math.max(0, now - new Date(pendingSince).getTime()) : null;
          const pendingDays = pendingMs != null ? Math.floor(pendingMs / DAY) : null;
          const dueMs =
            pendingSince != null ? new Date(pendingSince).getTime() + SLA_DAYS * DAY : null;

          const isBreached = dueMs != null && dueMs < now;
          const isAtRisk = dueMs != null && !isBreached && dueMs <= now + 2 * DAY;
          const risk = isBreached ? "breached" : isAtRisk ? "at_risk" : "waiting";

          return {
            step_id: ss(r?.artifact_step_id) || ss(r?.artifact_id),
            artifact_id: ss(r?.artifact_id),
            chain_id: ss(r?.chain_id) || null,
            project_id: ss(r?.project_id),
            project_title:
              activeProjects.find((p: any) => ss(p.id) === ss(r?.project_id))?.title ?? null,
            project_code:
              activeProjects.find((p: any) => ss(p.id) === ss(r?.project_id))?.project_code ?? null,
            artifact_title: ss(r?.title).trim() || "Untitled",
            artifact_type: ss(r?.artifact_type).trim(),
            approval_status: ss(r?.approval_status).trim(),
            step_order: Number(r?.step_order ?? 1),
            step_name: ss(r?.step_name).trim() || "Approval",
            pending_since: pendingSince,
            pending_days: pendingDays,
            pending_age_label: formatPendingAgeLabel(pendingDays),
            due_at: dueMs ? new Date(dueMs).toISOString() : null,
            approver_user_id: ss(r?.pending_user_id) || null,
            approver_email: ss(r?.pending_email) || null,
            approver_label: ss(r?.pending_email) || ss(r?.pending_user_id) || "Unassigned",
            risk,
          };
        });
    }

    const pending = pendingItems;
    const breached = pending.filter((r) => r.risk === "breached");
    const atRiskPending = pending.filter((r) => r.risk === "at_risk");

    // 3) Decisions within window
    let decisions: any[] = [];
    if (projectIds.length > 0) {
      const { data: stepRows, error: stepErr } = await supabase
        .from("artifact_approval_steps")
        .select("id, project_id")
        .in("project_id", projectIds);

      if (stepErr) {
        return noStoreJson({ ok: false, error: stepErr.message }, { status: 500 });
      }

      const stepIds = (stepRows ?? []).map((s: any) => ss(s?.id)).filter(Boolean);
      const stepToProject = new Map((stepRows ?? []).map((s: any) => [ss(s.id), ss(s.project_id)]));

      if (stepIds.length > 0) {
        const { data: decRows, error: decErr } = await supabase
          .from("artifact_approval_decisions")
          .select("step_id, decision, actor_user_id, created_at")
          .in("step_id", stepIds)
          .gte("created_at", since)
          .order("created_at", { ascending: false });

        if (decErr) {
          return noStoreJson({ ok: false, error: decErr.message }, { status: 500 });
        }

        decisions = (decRows ?? []).map((d: any) => ({
          ...d,
          project_id: stepToProject.get(ss(d?.step_id)) ?? null,
        }));
      }
    }

    const approved = decisions.filter((d) => ss(d?.decision).toLowerCase().includes("approv"));
    const rejected = decisions.filter((d) => {
      const dec = ss(d?.decision).toLowerCase();
      return dec.includes("reject") || dec.includes("declin");
    });

    // 4) PM stats
    const { data: members, error: memErr } = await supabase
      .from("organisation_members")
      .select("user_id, role, department")
      .in("organisation_id", orgIds)
      .is("removed_at", null);

    if (memErr) {
      return noStoreJson({ ok: false, error: memErr.message }, { status: 500 });
    }

    const memberMap = new Map<string, { role: string; department: string | null }>();
    for (const m of members ?? []) {
      const uid = ss((m as any)?.user_id);
      if (!uid || memberMap.has(uid)) continue;
      memberMap.set(uid, {
        role: ss((m as any)?.role) || "member",
        department: ss((m as any)?.department) ? ss((m as any)?.department) : null,
      });
    }

    const memberIds = Array.from(memberMap.keys());

    const { data: profiles, error: profErr } = memberIds.length
      ? await supabase.from("profiles").select("id, full_name, email, department").in("id", memberIds)
      : ({ data: [], error: null as any } as any);

    if (profErr) {
      return noStoreJson({ ok: false, error: profErr.message }, { status: 500 });
    }

    const profMap = new Map<string, { full_name: string; email: string; department: string | null }>();
    for (const p of profiles ?? []) {
      const id = ss((p as any)?.id);
      if (!id) continue;
      profMap.set(id, {
        full_name: ss((p as any)?.full_name) || ss((p as any)?.email) || "Unknown",
        email: ss((p as any)?.email),
        department: ss((p as any)?.department) ? ss((p as any)?.department) : null,
      });
    }

    const pmStats = memberIds
      .map((uid) => {
        const mem = memberMap.get(uid)!;
        const prof = profMap.get(uid) ?? { full_name: "Unknown", email: "", department: null };

        const pmProjects = activeProjects.filter((p: any) => ss(p?.project_manager_id) === uid);
        const pmApproved = approved.filter((d) => ss(d?.actor_user_id) === uid).length;
        const pmRejected = rejected.filter((d) => ss(d?.actor_user_id) === uid).length;

        const emailLower = prof.email.toLowerCase();
        const pmOverdue = breached.filter((r) => {
          const label = ss(r?.approver_label).toLowerCase();
          return (emailLower && label === emailLower) || label === uid;
        }).length;

        return {
          user_id: uid,
          full_name: prof.full_name,
          email: prof.email,
          role: mem.role,
          department: prof.department ?? mem.department ?? null,
          projects_managed: pmProjects.length,
          approved: pmApproved,
          rejected: pmRejected,
          overdue: pmOverdue,
          approval_rate:
            pmApproved + pmRejected > 0
              ? Math.round((pmApproved / (pmApproved + pmRejected)) * 100)
              : null,
        };
      })
      .filter(
        (pm) =>
          pm.projects_managed > 0 ||
          pm.approved > 0 ||
          pm.rejected > 0 ||
          pm.overdue > 0
      )
      .sort((a, b) => b.projects_managed - a.projects_managed);

    // 5) At-risk projects — aligned to live approvals
    const atRiskProjects = activeProjects
      .map((p: any) => {
        const pid = ss(p.id);
        const projectPending = pending.filter((r) => ss(r.project_id) === pid);
        const overdueCount = projectPending.filter((r) => r.risk === "breached").length;
        const warnCount = projectPending.filter((r) => r.risk === "at_risk").length;

        const daysSince = p?.updated_at
          ? Math.round((now - new Date(p.updated_at).getTime()) / DAY)
          : null;

        const score = Math.min(
          100,
          overdueCount * 40 +
            warnCount * 20 +
            (daysSince != null && daysSince > 14
              ? Math.min(20, 5 + Math.floor((daysSince - 14) / 7) * 5)
              : 0)
        );

        const riskLevel = score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW";

        return {
          project_id: pid,
          project_code: p?.project_code ?? null,
          project_title: p?.title ?? null,
          risk_score: score,
          overdue_steps: overdueCount,
          at_risk_steps: warnCount,
          pending_total: projectPending.length,
          days_since_activity: daysSince,
          risk_level: riskLevel,
        };
      })
      .filter((p) => p.pending_total > 0 && p.risk_level !== "LOW")
      .sort((a, b) => b.risk_score - a.risk_score);

    // 6) Upcoming milestones
    let upcomingMilestones: any[] = [];
    if (projectIds.length > 0) {
      const nextTwoWeeks = new Date(now + 14 * DAY).toISOString();

      const ms1 = await supabase
        .from("milestones")
        .select("id, title, due_date, status, project_id")
        .in("project_id", projectIds)
        .gte("due_date", nowIso)
        .lte("due_date", nextTwoWeeks)
        .neq("status", "completed")
        .order("due_date", { ascending: true })
        .limit(10);

      if (!ms1.error) {
        upcomingMilestones = (ms1.data ?? []).map((m: any) => ({
          ...m,
          project_code:
            activeProjects.find((p: any) => ss(p.id) === ss(m?.project_id))?.project_code ?? null,
          project_title:
            activeProjects.find((p: any) => ss(p.id) === ss(m?.project_id))?.title ?? null,
        }));
      } else {
        const ms2 = await supabase
          .from("schedule_milestones")
          .select("id, title, due_date, status, project_id")
          .in("project_id", projectIds)
          .gte("due_date", nowIso)
          .lte("due_date", nextTwoWeeks)
          .neq("status", "completed")
          .order("due_date", { ascending: true })
          .limit(10);

        if (!ms2.error) {
          upcomingMilestones = (ms2.data ?? []).map((m: any) => ({
            ...m,
            project_code:
              activeProjects.find((p: any) => ss(p.id) === ss(m?.project_id))?.project_code ?? null,
            project_title:
              activeProjects.find((p: any) => ss(p.id) === ss(m?.project_id))?.title ?? null,
          }));
        }
      }
    }

    const pendingPayload = {
      total: pending.length,
      breached: breached.length,
      at_risk: atRiskPending.length,
      items: pending.slice(0, 20).map((r: any) => ({
        project_title: r?.project_title ?? null,
        project_code: r?.project_code ?? null,
        approver_label: r?.approver_label ?? null,
        sla_status: r?.risk ?? null,
        artifact_title: r?.artifact_title ?? null,
        step_name: r?.step_name ?? null,
        pending_days: r?.pending_days ?? null,
        due_at: r?.due_at ?? null,
      })),
    };

    const digest = {
      generated_at: new Date().toISOString(),
      window_days: days,
      summary: {
        active_projects: activeProjects.length,
        total_projects: allProjects.length,
        pending_total: pending.length,
        breached_total: breached.length,
        at_risk_total: atRiskPending.length,
        decisions_total: decisions.length,
        approved_total: approved.length,
        rejected_total: rejected.length,
        new_projects: newProjects.length,
        at_risk_projects: atRiskProjects.length,
      },
      sections: {
        pending_approvals: pendingPayload,
        sla_breaches: {
          total: breached.length,
          items: breached.slice(0, 20).map((r: any) => ({
            project_title: r?.project_title ?? null,
            project_code: r?.project_code ?? null,
            approver_label: r?.approver_label ?? null,
            sla_status: r?.risk ?? null,
            artifact_title: r?.artifact_title ?? null,
            step_name: r?.step_name ?? null,
            pending_days: r?.pending_days ?? null,
            due_at: r?.due_at ?? null,
          })),
        },
        decisions: {
          total: decisions.length,
          approved: approved.length,
          rejected: rejected.length,
          approval_rate:
            decisions.length > 0 ? Math.round((approved.length / decisions.length) * 100) : null,
          recent: decisions.slice(0, 10).map((d: any) => ({
            decision: d?.decision,
            created_at: d?.created_at,
            project_id: d?.project_id,
            project_title:
              activeProjects.find((p: any) => ss(p.id) === ss(d?.project_id))?.title ?? null,
          })),
        },
        pm_performance: pmStats,
        at_risk_projects: atRiskProjects.slice(0, 10),
        new_projects: newProjects.slice(0, 10).map((p: any) => ({
          project_code: p?.project_code ?? null,
          title: p?.title ?? null,
          created_at: p?.created_at ?? null,
          status: p?.status ?? p?.lifecycle_status ?? null,
        })),
        upcoming_milestones: upcomingMilestones,
      },
    };

    return noStoreJson({ ok: true, digest });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}