// Weekly Exec Digest — aggregates all sections into one payload
// Sections: pending approvals, SLA breaches, decisions, at-risk projects,
//           PM performance snapshot, new projects, upcoming milestones

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

const ss = (x: any) => typeof x === "string" ? x : x == null ? "" : String(x);
const sn = (x: any) => { const n = Number(x); return isFinite(n) ? n : 0; };

async function getOrgIds(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("organisation_members").select("organisation_id")
    .eq("user_id", userId).is("removed_at", null).limit(20);
  return Array.from(new Set((data ?? []).map((m: any) => ss(m?.organisation_id)).filter(Boolean)));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const days = Math.min(Math.max(sn(url.searchParams.get("days") ?? "7"), 1), 90);

    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });

    const orgIds = await getOrgIds(supabase, user.id);
    if (!orgIds.length) return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });

    const since = new Date(Date.now() - days * 86400000).toISOString();
    const now = new Date().toISOString();

    // ── 1. Projects ────────────────────────────────────────────────────────────
    const { data: projects } = await supabase
      .from("projects")
      .select("id, title, project_code, created_at, updated_at, status, project_manager_id")
      .in("organisation_id", orgIds)
      .is("deleted_at", null);

    const allProjects = projects ?? [];
    const newProjects = allProjects.filter((p: any) => p?.created_at && p.created_at >= since);

    // ── 2. Approval cache (pending + breaches) ─────────────────────────────────
    const { data: cacheRows } = await supabase
      .from("exec_approval_cache")
      .select("project_id, project_title, project_code, sla_status, approver_label, window_days, computed_at")
      .in("organisation_id", orgIds);

    const pending = (cacheRows ?? []);
    const breached = pending.filter((r: any) => {
      const s = ss(r?.sla_status).toLowerCase();
      return s === "overdue" || s === "breached" || s === "overdue_undecided";
    });
    const at_risk_pending = pending.filter((r: any) => {
      const s = ss(r?.sla_status).toLowerCase();
      return s === "warn" || s === "at_risk";
    });

    // ── 3. Approval decisions this period ──────────────────────────────────────
    const projectIds = allProjects.map((p: any) => ss(p.id));
    let decisions: any[] = [];

    if (projectIds.length > 0) {
      const { data: stepRows } = await supabase
        .from("artifact_approval_steps")
        .select("id, project_id")
        .in("project_id", projectIds);

      const stepIds = (stepRows ?? []).map((s: any) => ss(s?.id)).filter(Boolean);
      const stepToProject = new Map((stepRows ?? []).map((s: any) => [ss(s.id), ss(s.project_id)]));

      if (stepIds.length > 0) {
        const { data: decRows } = await supabase
          .from("artifact_approval_decisions")
          .select("step_id, decision, actor_user_id, created_at")
          .in("step_id", stepIds)
          .gte("created_at", since)
          .order("created_at", { ascending: false });

        decisions = (decRows ?? []).map((d: any) => ({
          ...d,
          project_id: stepToProject.get(ss(d?.step_id)) ?? null,
        }));
      }
    }

    const approved = decisions.filter(d => ss(d?.decision).toLowerCase().includes("approv"));
    const rejected = decisions.filter(d => {
      const dec = ss(d?.decision).toLowerCase();
      return dec.includes("reject") || dec.includes("declin");
    });

    // ── 4. PM profiles ─────────────────────────────────────────────────────────
    const { data: members } = await supabase
      .from("organisation_members")
      .select("user_id, role, profiles(id, full_name, email)")
      .in("organisation_id", orgIds)
      .is("removed_at", null);

    const profileMap = new Map<string, { full_name: string; email: string }>();
    for (const m of (members ?? [])) {
      const uid = ss(m?.user_id); const p = (m as any)?.profiles ?? {};
      if (uid) profileMap.set(uid, { full_name: ss(p?.full_name) || ss(p?.email) || "Unknown", email: ss(p?.email) });
    }

    const pmStats = Array.from(profileMap.entries()).map(([uid, prof]) => {
      const pmProjects = allProjects.filter((p: any) => ss(p?.project_manager_id) === uid);
      const pmApproved = approved.filter(d => ss(d?.actor_user_id) === uid).length;
      const pmRejected = rejected.filter(d => ss(d?.actor_user_id) === uid).length;
      const pmOverdue = breached.filter((r: any) => {
        const label = ss(r?.approver_label).toLowerCase();
        return label === prof.email.toLowerCase() || label === uid;
      }).length;
      return {
        user_id: uid,
        full_name: prof.full_name,
        email: prof.email,
        projects_managed: pmProjects.length,
        approved: pmApproved,
        rejected: pmRejected,
        overdue: pmOverdue,
        approval_rate: pmApproved + pmRejected > 0 ? Math.round(pmApproved / (pmApproved + pmRejected) * 100) : null,
      };
    }).filter(pm => pm.projects_managed > 0 || pm.approved > 0 || pm.rejected > 0 || pm.overdue > 0)
      .sort((a, b) => b.projects_managed - a.projects_managed);

    // ── 5. At-risk projects (simple scoring) ───────────────────────────────────
    const atRiskProjects = allProjects.map((p: any) => {
      const pid = ss(p.id);
      const overdueCount = breached.filter((r: any) => ss(r?.project_id) === pid).length;
      const daysSince = p?.updated_at ? Math.round((Date.now() - new Date(p.updated_at).getTime()) / 86400000) : null;
      const score = Math.min(100, (overdueCount > 0 ? 40 : 0) + (daysSince != null && daysSince > 14 ? Math.min(35, 20 + Math.floor((daysSince - 14) / 7) * 5) : 0));
      return { project_id: pid, project_code: p?.project_code ?? null, project_title: p?.title ?? null, risk_score: score, overdue_steps: overdueCount, days_since_activity: daysSince, risk_level: score >= 60 ? "HIGH" : score >= 30 ? "MEDIUM" : "LOW" };
    }).filter(p => p.risk_level !== "LOW").sort((a, b) => b.risk_score - a.risk_score);

    // ── 6. Upcoming milestones ──────────────────────────────────────────────────
    let upcomingMilestones: any[] = [];
    try {
      const nextWeek = new Date(Date.now() + 14 * 86400000).toISOString();
      const { data: milestones } = await supabase
        .from("milestones")
        .select("id, title, due_date, status, project_id")
        .in("project_id", projectIds)
        .gte("due_date", now)
        .lte("due_date", nextWeek)
        .neq("status", "completed")
        .order("due_date", { ascending: true })
        .limit(10);
      upcomingMilestones = (milestones ?? []).map((m: any) => ({
        ...m,
        project_code: allProjects.find((p: any) => ss(p.id) === ss(m?.project_id))?.project_code ?? null,
        project_title: allProjects.find((p: any) => ss(p.id) === ss(m?.project_id))?.title ?? null,
      }));
    } catch { }

    const digest = {
      generated_at: new Date().toISOString(),
      window_days: days,
      summary: {
        pending_total: pending.length,
        breached_total: breached.length,
        at_risk_total: at_risk_pending.length,
        decisions_total: decisions.length,
        approved_total: approved.length,
        rejected_total: rejected.length,
        new_projects: newProjects.length,
        at_risk_projects: atRiskProjects.filter(p => p.risk_level === "HIGH").length,
      },
      sections: {
        pending_approvals: {
          total: pending.length,
          breached: breached.length,
          at_risk: at_risk_pending.length,
          items: pending.slice(0, 20).map((r: any) => ({
            project_title: r?.project_title ?? null,
            project_code: r?.project_code ?? null,
            approver_label: r?.approver_label ?? null,
            sla_status: r?.sla_status ?? null,
          })),
        },
        decisions: {
          total: decisions.length,
          approved: approved.length,
          rejected: rejected.length,
          approval_rate: decisions.length > 0 ? Math.round(approved.length / decisions.length * 100) : null,
          recent: decisions.slice(0, 10).map((d: any) => ({
            decision: d?.decision,
            created_at: d?.created_at,
            project_id: d?.project_id,
            project_title: allProjects.find((p: any) => ss(p.id) === ss(d?.project_id))?.title ?? null,
          })),
        },
        pm_performance: pmStats,
        at_risk_projects: atRiskProjects.slice(0, 10),
        new_projects: newProjects.slice(0, 10).map((p: any) => ({
          project_code: p?.project_code ?? null,
          title: p?.title ?? null,
          created_at: p?.created_at ?? null,
          status: p?.status ?? null,
        })),
        upcoming_milestones: upcomingMilestones,
      },
    };

    return noStoreJson({ ok: true, digest });

  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
