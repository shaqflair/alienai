// src/app/api/cron/exec-intel/generate/route.ts — REBUILT v3
// Completely rewritten to use v_pending_artifact_approvals_all view.
// ✅ FIX-CR1: Query v_pending_artifact_approvals_all — all joins already done in the view
// ✅ FIX-CR2: approver_label = pending_email (the view's actual approver field)
// ✅ FIX-CR3: organisation_id resolved via project_id → projects table
// ✅ FIX-CR4: window_days = 30 set on every cache row
// ✅ FIX-CR5: No more artifact_approval_decisions join

import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function asInt(x: any): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function safeNum(x: any): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
}
function hoursBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 36e5);
}
function requireCronSecret(req: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return;
  const got =
    req.headers.get("x-cron-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (got !== expected) throw new Error("Unauthorized");
}

async function handler(req: Request) {
  try {
    requireCronSecret(req);
    const supabase = await createAdminClient();

    const now = new Date();
    const nowIso = now.toISOString();
    const windowRiskDays = 7;
    const riskCutoff = new Date(now.getTime() + windowRiskDays * 86400_000);

    const { data: viewRows, error: viewErr } = await supabase
      .from("v_pending_artifact_approvals_all")
      .select("*")
      .eq("step_status", "pending")
      .limit(5000);

    if (viewErr) throw viewErr;
    const rows = Array.isArray(viewRows) ? viewRows : [];

    const projectIds = Array.from(new Set(rows.map((r: any) => safeStr(r.project_id)).filter(Boolean)));
    const orgByProject = new Map<string, string>();
    const codeByProject = new Map<string, string>();
    const titleByProject = new Map<string, string>();

    if (projectIds.length) {
      const { data: projects, error: projErr } = await supabase
        .from("projects")
        .select("id, project_code, title, organisation_id")
        .in("id", projectIds)
        .limit(5000);
      if (projErr) throw projErr;
      for (const p of projects ?? []) {
        const pid = safeStr((p as any).id);
        const orgId = safeStr((p as any).organisation_id).trim();
        if (pid && orgId) orgByProject.set(pid, orgId);
        codeByProject.set(pid, safeStr((p as any).project_code));
        titleByProject.set(pid, safeStr((p as any).title));
      }
    }

    const { data: slaCfg, error: slaErr } = await supabase
      .from("approval_sla_config")
      .select("project_id, artifact_type, stage_key, sla_hours, warn_hours, breach_grace_hours, is_active")
      .eq("is_active", true)
      .limit(5000);
    if (slaErr) throw slaErr;

    function resolveSla(pid: string | null, artifactType: string | null, stageKey: string | null) {
      let best: any = null, bestScore = -1;
      for (const c of slaCfg ?? []) {
        if (c.project_id && c.project_id !== pid) continue;
        if (c.artifact_type && c.artifact_type !== artifactType) continue;
        if (c.stage_key && c.stage_key !== stageKey) continue;
        const score = (c.project_id ? 4 : 0) + (c.artifact_type ? 2 : 0) + (c.stage_key ? 1 : 0);
        if (score > bestScore) { bestScore = score; best = c; }
      }
      return {
        sla_hours: asInt(best?.sla_hours) ?? 72,
        warn_hours: asInt(best?.warn_hours) ?? 24,
        grace_hours: asInt(best?.breach_grace_hours) ?? 0,
      };
    }

    const cacheRows: any[] = [];
    let skippedNullOrg = 0;

    for (const row of rows) {
      const pid = safeStr(row.project_id);
      if (!pid) continue;
      const orgId = orgByProject.get(pid) ?? null;
      if (!orgId) { skippedNullOrg++; continue; }

      const artifactType = safeStr(row.artifact_type) || null;
      const stageKey = safeStr(row.step_name) || null;
      const approverEmail = safeStr(row.pending_email).trim();
      const approverRole = safeStr(row.approver_role).trim();
      const approverLabel = approverEmail || approverRole || "Unassigned";

      const submittedAtIso = safeStr(row.step_pending_since || row.artifact_submitted_at).trim() || null;
      const submittedAt = submittedAtIso ? new Date(submittedAtIso) : null;
      const sla = resolveSla(pid, artifactType, stageKey);
      const derivedDueAt = submittedAt ? new Date(submittedAt.getTime() + sla.sla_hours * 3600_000) : null;
      const hoursToDue = derivedDueAt ? hoursBetween(now, derivedDueAt) : null;
      const hoursOverdue = derivedDueAt && now > derivedDueAt ? hoursBetween(derivedDueAt, now) : null;

      let slaStatus: "ok" | "at_risk" | "breached" | "overdue_undecided" | "unknown" = "unknown";
      if (derivedDueAt) {
        const warnAt = new Date(derivedDueAt.getTime() - sla.warn_hours * 3600_000);
        const breachAt = new Date(derivedDueAt.getTime() + sla.grace_hours * 3600_000);
        if (now > breachAt) slaStatus = "overdue_undecided";
        else if (now >= derivedDueAt) slaStatus = "breached";
        else if (now >= warnAt || derivedDueAt <= riskCutoff) slaStatus = "at_risk";
        else slaStatus = "ok";
      }

      cacheRows.push({
        organisation_id: orgId,
        project_id: pid,
        project_code: codeByProject.get(pid) || null,
        project_title: titleByProject.get(pid) || null,
        artifact_id: safeStr(row.artifact_id) || null,
        artifact_type: artifactType,
        artifact_title: safeStr(row.title) || null,
        step_id: safeStr(row.artifact_step_id) || null,
        stage_key: stageKey,
        step_title: safeStr(row.step_name) || "Approval",
        approver_user_id: safeStr(row.pending_user_id) || null,
        approver_group_id: null,
        approver_label: approverLabel,
        submitted_at: submittedAtIso,
        due_at: derivedDueAt ? derivedDueAt.toISOString() : null,
        sla_status: slaStatus,
        hours_to_due: hoursToDue,
        hours_overdue: hoursOverdue,
        window_days: 30,
        meta: {
          source: "v_pending_artifact_approvals_all",
          sla_hours: sla.sla_hours,
          approver_role: approverRole,
          approver_type: safeStr(row.approver_type) || null,
          approver_ref: safeStr(row.approver_ref) || null,
        },
        computed_at: nowIso,
      });
    }

    await supabase.from("exec_approval_cache").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    for (let i = 0; i < cacheRows.length; i += 500) {
      const { error } = await supabase.from("exec_approval_cache").insert(cacheRows.slice(i, i + 500));
      if (error) throw error;
    }

    await supabase.from("exec_approval_bottlenecks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
    const byApprover = new Map<string, { label: string; userId: string | null; open: number; breached: number; atRisk: number; maxOverdue: number }>();
    for (const r of cacheRows) {
      const key = r.approver_label || "Unassigned";
      const cur = byApprover.get(key) ?? { label: r.approver_label, userId: r.approver_user_id, open: 0, breached: 0, atRisk: 0, maxOverdue: 0 };
      cur.open++;
      if (r.sla_status === "breached" || r.sla_status === "overdue_undecided") cur.breached++;
      if (r.sla_status === "at_risk") cur.atRisk++;
      cur.maxOverdue = Math.max(cur.maxOverdue, safeNum(r.hours_overdue));
      byApprover.set(key, cur);
    }

    const bottleneckRows = Array.from(byApprover.values()).map(v => ({
      approver_user_id: v.userId, approver_group_id: null, approver_label: v.label,
      open_steps: v.open, breached_steps: v.breached, at_risk_steps: v.atRisk,
      blocker_score: v.breached * 5 + v.atRisk * 2 + v.open, computed_at: nowIso,
    }));

    if (bottleneckRows.length) {
      const { error } = await supabase.from("exec_approval_bottlenecks").insert(bottleneckRows);
      if (error) throw error;
    }

    try { await supabase.rpc("exec_refresh_intel"); } catch { }

    const orgDist: Record<string, number> = {};
    for (const r of cacheRows) { const o = safeStr(r.organisation_id); orgDist[o] = (orgDist[o] ?? 0) + 1; }
    console.log("[exec-intel v3] view rows:", rows.length);
    console.log("[exec-intel v3] cache inserted:", cacheRows.length);
    console.log("[exec-intel v3] skipped null org:", skippedNullOrg);
    console.log("[exec-intel v3] orgs:", JSON.stringify(orgDist));

    return jsonOk({ source: "v_pending_artifact_approvals_all", view_rows: rows.length, cache: cacheRows.length, bottlenecks: bottleneckRows.length, skipped_null_org: skippedNullOrg, orgs: orgDist });

  } catch (e: any) {
    return jsonErr("Exec intel generation failed", 500, { message: e?.message ?? String(e) });
  }
}

export async function POST(req: Request) { return handler(req); }
export async function GET(req: Request) { return handler(req); }