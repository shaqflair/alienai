// src/app/api/executive/projects/at-risk/route.ts — v2 (schema-aligned)
// ✅ FIX: remove lifecycle_state / archived_at / cancelled_at (not in your schema)
// ✅ Uses status + lifecycle_status + closed_at + deleted_at to determine "active"
// ✅ Keeps scoring logic unchanged

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

function parseBool(x: string | null): boolean {
  if (!x) return false;
  const v = x.toLowerCase().trim();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

type RiskLevel = "HIGH" | "MEDIUM" | "LOW";

interface RiskSignal {
  key: string;
  label: string;
  detail: string;
  score: number;
  triggered: boolean;
}

interface ProjectRisk {
  project_id: string;
  project_code: string | null;
  project_title: string | null;
  risk_score: number;
  risk_level: RiskLevel;
  signals: RiskSignal[];
  days_since_activity: number | null;
  overdue_steps: number;
  rejection_rate: number | null;
  total_decisions: number;
}

async function getOrgIds(supabase: any, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(50);

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

  // ✅ your schema has lifecycle_status, not lifecycle_state
  const st = ss(p?.status ?? p?.lifecycle_status ?? p?.state).toLowerCase().trim();
  if (!st) return true;
  return !CLOSED_STATES.some((s) => st.includes(s));
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const activeOnly = parseBool(url.searchParams.get("active_only"));

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

    // ✅ select only real columns
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id, title, project_code, updated_at, status, lifecycle_status, deleted_at, closed_at")
      .in("organisation_id", orgIds)
      .is("deleted_at", null)
      .order("updated_at", { ascending: true });

    if (projErr) return noStoreJson({ ok: false, error: projErr.message }, { status: 500 });

    const base = projects ?? [];
    const filteredProjects = activeOnly ? base.filter(isProjectActive) : base;

    if (!filteredProjects.length) {
      return noStoreJson({
        ok: true,
        items: [],
        summary: { total: 0, high: 0, medium: 0, low: 0, active_only: activeOnly },
      });
    }

    const projectIds = filteredProjects.map((p: any) => ss(p?.id)).filter(Boolean);

    // overdue steps by project from cache
    const { data: cacheRows, error: cacheErr } = await supabase
      .from("exec_approval_cache")
      .select("project_id, sla_status")
      .in("organisation_id", orgIds);

    if (cacheErr) return noStoreJson({ ok: false, error: cacheErr.message }, { status: 500 });

    const overdueByProject = new Map<string, number>();
    for (const row of cacheRows ?? []) {
      const pid = ss((row as any)?.project_id);
      if (!pid) continue;

      const sla = ss((row as any)?.sla_status).toLowerCase();
      if (sla === "overdue" || sla === "breached" || sla === "overdue_undecided") {
        overdueByProject.set(pid, (overdueByProject.get(pid) ?? 0) + 1);
      }
    }

    // map approval steps to project
    const { data: stepRows, error: stepErr } = await supabase
      .from("artifact_approval_steps")
      .select("id, project_id")
      .in("project_id", projectIds);

    if (stepErr) return noStoreJson({ ok: false, error: stepErr.message }, { status: 500 });

    const stepToProject = new Map<string, string>();
    for (const s of stepRows ?? []) {
      const sid = ss((s as any)?.id);
      const pid = ss((s as any)?.project_id);
      if (sid && pid) stepToProject.set(sid, pid);
    }

    const stepIds = Array.from(stepToProject.keys());
    const decisionsByProject = new Map<string, { approved: number; rejected: number }>();

    if (stepIds.length > 0) {
      const { data: decRows, error: decErr } = await supabase
        .from("artifact_approval_decisions")
        .select("step_id, decision")
        .in("step_id", stepIds);

      if (decErr) return noStoreJson({ ok: false, error: decErr.message }, { status: 500 });

      for (const d of decRows ?? []) {
        const sid = ss((d as any)?.step_id);
        const pid = stepToProject.get(sid);
        if (!pid) continue;

        const dec = ss((d as any)?.decision).toLowerCase();
        const entry = decisionsByProject.get(pid) ?? { approved: 0, rejected: 0 };
        if (dec === "approved" || dec === "approve") entry.approved++;
        if (dec === "rejected" || dec === "reject" || dec === "declined") entry.rejected++;
        decisionsByProject.set(pid, entry);
      }
    }

    const now = Date.now();
    const INACTIVITY_THRESHOLD_DAYS = 14;

    const items: ProjectRisk[] = filteredProjects.map((p: any) => {
      const pid = ss(p?.id);

      const signals: RiskSignal[] = [];
      let totalScore = 0;

      const overdue = overdueByProject.get(pid) ?? 0;
      const overdueScore = overdue === 0 ? 0 : Math.min(40, 20 + (overdue - 1) * 5);

      signals.push({
        key: "overdue_steps",
        label: "Stalled Approvals",
        detail: overdue > 0 ? `${overdue} step${overdue !== 1 ? "s" : ""} overdue` : "No overdue steps",
        score: overdueScore,
        triggered: overdue > 0,
      });
      totalScore += overdueScore;

      const updatedAt = p?.updated_at ? new Date(p.updated_at).getTime() : null;
      const daysSince = updatedAt ? Math.round((now - updatedAt) / 86400000) : null;

      const inactivityScore =
        daysSince != null && daysSince > INACTIVITY_THRESHOLD_DAYS
          ? Math.min(35, 20 + Math.floor((daysSince - INACTIVITY_THRESHOLD_DAYS) / 7) * 5)
          : 0;

      signals.push({
        key: "no_activity",
        label: "Inactivity",
        detail: daysSince != null ? `${daysSince}d since last update` : "No update history",
        score: inactivityScore,
        triggered: inactivityScore > 0,
      });
      totalScore += inactivityScore;

      const decs = decisionsByProject.get(pid) ?? { approved: 0, rejected: 0 };
      const totalDec = decs.approved + decs.rejected;
      const rejectionRate = totalDec > 0 ? Math.round((decs.rejected / totalDec) * 100) : null;

      const rejectionScore =
        rejectionRate != null && rejectionRate > 30
          ? Math.min(35, Math.round(((rejectionRate - 30) / 70) * 35) + 15)
          : 0;

      signals.push({
        key: "rejection_rate",
        label: "Rejection Rate",
        detail: rejectionRate != null ? `${rejectionRate}% rejections` : "No decision data",
        score: rejectionScore,
        triggered: rejectionScore > 0,
      });
      totalScore += rejectionScore;

      const riskScore = Math.min(100, totalScore);
      const riskLevel: RiskLevel = riskScore >= 60 ? "HIGH" : riskScore >= 30 ? "MEDIUM" : "LOW";

      return {
        project_id: pid,
        project_code: p?.project_code ?? null,
        project_title: p?.title ?? null,
        risk_score: riskScore,
        risk_level: riskLevel,
        signals,
        days_since_activity: daysSince,
        overdue_steps: overdue,
        rejection_rate: rejectionRate,
        total_decisions: totalDec,
      };
    });

    items.sort((a, b) => b.risk_score - a.risk_score);

    const summary = {
      total: items.length,
      high: items.filter((i) => i.risk_level === "HIGH").length,
      medium: items.filter((i) => i.risk_level === "MEDIUM").length,
      low: items.filter((i) => i.risk_level === "LOW").length,
      active_only: activeOnly,
    };

    return noStoreJson({ ok: true, items, summary });
  } catch (e: any) {
    return noStoreJson({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}