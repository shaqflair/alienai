import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function asInt(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function hoursBetween(a: Date, b: Date) {
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

export async function POST(req: Request) {
  try {
    requireCronSecret(req);

    const supabase = await createClient();

    const now = new Date();
    const nowIso = now.toISOString();
    const windowRiskDays = 7;
    const riskCutoff = new Date(now.getTime() + windowRiskDays * 86400_000);

    /**
     * 1) Pull pending artifact approval steps (FIX: no deleted_at)
     */
    const { data: artifactSteps, error: artErr } = await supabase
      .from("artifact_approval_steps")
      .select(
        `
        id,
        artifact_id,
        project_id,
        title,
        stage_key,
        due_at,
        submitted_at,
        approver_user_id,
        approver_group_id,
        status,
        artifacts:artifact_id ( id, title, artifact_type, project_id )
      `
      )
      .eq("status", "pending")
      .limit(5000);

    if (artErr) throw artErr;

    /**
     * 2) Pull decisions (best-effort; used only to avoid counting decided steps)
     *    NOTE: with status='pending' this is less critical, but keep as guard.
     */
    const { data: artDecisions, error: decErr } = await supabase
      .from("artifact_approval_decisions")
      .select("id, step_id, decided_at")
      .limit(5000);

    if (decErr) throw decErr;

    const decidedAtByStep = new Map<string, string>();
    for (const d of artDecisions ?? []) {
      if (d?.step_id && d?.decided_at) decidedAtByStep.set(d.step_id, d.decided_at);
    }

    /**
     * 3) Project metadata
     */
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id, project_code, title")
      .limit(5000);

    if (projErr) throw projErr;

    const projectMeta = new Map<string, { code: string; title: string }>();
    for (const p of projects ?? []) {
      projectMeta.set(p.id, { code: safeStr((p as any).project_code), title: safeStr((p as any).title) });
    }

    /**
     * 4) Approval groups
     */
    const { data: groups, error: grpErr } = await supabase
      .from("approval_groups")
      .select("id, name")
      .limit(5000);

    if (grpErr) throw grpErr;

    const groupName = new Map<string, string>();
    for (const g of groups ?? []) groupName.set((g as any).id, safeStr((g as any).name));

    /**
     * 5) SLA config (active)
     */
    const { data: slaCfg, error: slaErr } = await supabase
      .from("approval_sla_config")
      .select(
        "organisation_id, project_id, artifact_type, stage_key, sla_hours, warn_hours, breach_grace_hours, is_active"
      )
      .eq("is_active", true)
      .limit(5000);

    if (slaErr) throw slaErr;

    function resolveSlaHours(args: {
      project_id?: string | null;
      artifact_type?: string | null;
      stage_key?: string | null;
    }) {
      const pid = args.project_id ?? null;
      const at = args.artifact_type ?? null;
      const sk = args.stage_key ?? null;

      const candidates = (slaCfg ?? []).filter((c: any) => {
        const okP = c.project_id ? c.project_id === pid : true;
        const okT = c.artifact_type ? c.artifact_type === at : true;
        const okS = c.stage_key ? c.stage_key === sk : true;
        return okP && okT && okS;
      });

      let best = null as any;
      let bestScore = -1;
      for (const c of candidates) {
        let score = 0;
        if (c.project_id) score += 4;
        if (c.artifact_type) score += 2;
        if (c.stage_key) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = c;
        }
      }

      return {
        sla_hours: asInt(best?.sla_hours) ?? 72,
        warn_hours: asInt(best?.warn_hours) ?? 24,
        grace_hours: asInt(best?.breach_grace_hours) ?? 0,
      };
    }

    /**
     * 6) Build cache rows from artifact steps
     */
    const cacheRows: any[] = [];

    const pendingArtifactSteps = (artifactSteps ?? []).filter((s: any) => {
      // guard: if a decided_at exists, don’t include
      const decided_at = decidedAtByStep.get(s.id) ?? null;
      return !decided_at;
    });

    for (const s of pendingArtifactSteps) {
      const pid = s.project_id || s?.artifacts?.project_id;
      const pm = pid ? projectMeta.get(pid) : null;

      const artifactType = safeStr(s?.artifacts?.artifact_type);
      const stageKey = safeStr(s.stage_key) || null;

      const submittedAtIso = s.submitted_at || null;
      const dueAtIso = s.due_at || null;

      const submittedAt = submittedAtIso ? new Date(submittedAtIso) : null;
      const dueAt = dueAtIso ? new Date(dueAtIso) : null;

      const sla = resolveSlaHours({
        project_id: pid,
        artifact_type: artifactType || null,
        stage_key: stageKey,
      });

      const derivedDueAt =
        dueAt || (submittedAt ? new Date(submittedAt.getTime() + sla.sla_hours * 3600_000) : null);

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

      const approverLabel = s.approver_user_id
        ? `User:${s.approver_user_id}`
        : s.approver_group_id
        ? groupName.get(s.approver_group_id) || `Group:${s.approver_group_id}`
        : "Unassigned";

      cacheRows.push({
        project_id: pid,
        project_code: pm?.code ?? null,
        project_title: pm?.title ?? null,

        artifact_id: s.artifact_id,
        artifact_type: artifactType || null,
        artifact_title: safeStr(s?.artifacts?.title) || null,

        step_id: s.id,
        stage_key: stageKey,
        step_title: safeStr(s.title) || null,

        approver_user_id: s.approver_user_id ?? null,
        approver_group_id: s.approver_group_id ?? null,
        approver_label: approverLabel,

        submitted_at: submittedAtIso,
        due_at: derivedDueAt ? derivedDueAt.toISOString() : null,

        sla_status: slaStatus,
        hours_to_due: hoursToDue,
        hours_overdue: hoursOverdue,

        meta: { source: "artifact_approval_steps", sla_hours: sla.sla_hours },
        computed_at: nowIso,
      });
    }

    /**
     * 7) Include pending change approvals (NEW)
     */
    const { data: changeApprovals, error: caErr } = await supabase
      .from("change_approvals")
      .select("id, change_id, project_id, approval_role, status, created_at, due_at, approver_user_id")
      .eq("status", "pending")
      .limit(5000);

    if (caErr) throw caErr;

    for (const a of changeApprovals ?? []) {
      const pid = (a as any).project_id;
      const pm = pid ? projectMeta.get(pid) : null;

      const submittedAtIso = (a as any).created_at || null;
      const dueAtIso = (a as any).due_at || null;

      const approverLabel = (a as any).approver_user_id
        ? `User:${(a as any).approver_user_id}`
        : "Unassigned";

      cacheRows.push({
        project_id: pid,
        project_code: pm?.code ?? null,
        project_title: pm?.title ?? null,

        artifact_id: null,
        artifact_type: "change_request",
        artifact_title: null,

        step_id: (a as any).id,
        stage_key: "change_approval",
        step_title: safeStr((a as any).approval_role) || "Change approval",

        approver_user_id: (a as any).approver_user_id ?? null,
        approver_group_id: null,
        approver_label: approverLabel,

        submitted_at: submittedAtIso,
        due_at: dueAtIso,

        sla_status: "unknown",
        hours_to_due: null,
        hours_overdue: null,

        meta: { source: "change_approvals", change_id: (a as any).change_id },
        computed_at: nowIso,
      });
    }

    /**
     * 8) Replace cache tables
     */
    await supabase
      .from("exec_approval_cache")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    const chunkSize = 500;
    for (let i = 0; i < cacheRows.length; i += chunkSize) {
      await supabase.from("exec_approval_cache").insert(cacheRows.slice(i, i + chunkSize));
    }

    /**
     * 9) Bottlenecks
     */
    await supabase
      .from("exec_approval_bottlenecks")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    const byApprover = new Map<string, any>();
    for (const r of cacheRows) {
      const key = r.approver_user_id
        ? `U:${r.approver_user_id}`
        : r.approver_group_id
        ? `G:${r.approver_group_id}`
        : `X:unassigned`;

      const cur =
        byApprover.get(key) || {
          label: r.approver_label,
          userId: r.approver_user_id,
          groupId: r.approver_group_id,
          open: 0,
          breached: 0,
          atRisk: 0,
        };

      cur.open++;
      if (r.sla_status === "breached" || r.sla_status === "overdue_undecided") cur.breached++;
      if (r.sla_status === "at_risk") cur.atRisk++;
      byApprover.set(key, cur);
    }

    const bottleneckRows = Array.from(byApprover.values()).map((v) => ({
      approver_user_id: v.userId,
      approver_group_id: v.groupId,
      approver_label: v.label,
      open_steps: v.open,
      breached_steps: v.breached,
      at_risk_steps: v.atRisk,
      blocker_score: v.breached * 5 + v.atRisk * 2 + v.open,
      computed_at: nowIso,
    }));

    if (bottleneckRows.length) {
      await supabase.from("exec_approval_bottlenecks").insert(bottleneckRows);
    }

    /**
     * 10) Refresh RPC (if present)
     */
    await supabase.rpc("exec_refresh_intel");

    return jsonOk({ cache: cacheRows.length, bottlenecks: bottleneckRows.length });
  } catch (e: any) {
    return jsonErr("Exec intel generation failed", 500, { message: e?.message ?? String(e) });
  }
}