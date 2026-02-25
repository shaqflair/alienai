// src/app/api/cron/exec-intel/generate/route.ts
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

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function asInt(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function safeNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n) ? n : 0;
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

function pickStepTitle(step: any) {
  return (
    safeStr(step?.title) ||
    safeStr(step?.name) ||
    safeStr(step?.step_name) ||
    safeStr(step?.stage_key) ||
    "Approval"
  );
}

function pickStageKey(step: any) {
  const v =
    safeStr(step?.stage_key) ||
    safeStr(step?.stage) ||
    safeStr(step?.step_key) ||
    safeStr(step?.name) ||
    "";
  return v.trim() || null;
}

async function handler(req: Request) {
  try {
    requireCronSecret(req);
    const supabase = await createAdminClient();

    const now = new Date();
    const nowIso = now.toISOString();
    const windowRiskDays = 7;
    const riskCutoff = new Date(now.getTime() + windowRiskDays * 86400_000);

    /**
     * 1) Pull pending steps
     */
    const { data: artifactSteps, error: artErr } = await supabase
      .from("artifact_approval_steps")
      .select("*")
      .eq("status", "pending")
      .limit(5000);

    if (artErr) throw artErr;

    /**
     * 2) Decisions (exclude already-decided steps)
     */
    const { data: artDecisions, error: decErr } = await supabase
      .from("artifact_approval_decisions")
      .select("id, step_id, decided_at")
      .limit(5000);

    if (decErr) throw decErr;

    const decidedAtByStep = new Map<string, string>();
    for (const d of artDecisions ?? []) {
      if (d?.step_id && d?.decided_at)
        decidedAtByStep.set(String(d.step_id), String(d.decided_at));
    }

    const pendingSteps = (artifactSteps ?? []).filter((s: any) => {
      const sid = safeStr(s?.id);
      if (!sid) return false;
      return !decidedAtByStep.get(sid);
    });

    /**
     * 3) Load artifacts
     */
    const artifactIds = Array.from(
      new Set(
        pendingSteps.map((s: any) => safeStr(s?.artifact_id)).filter(Boolean)
      )
    );

    const artifactsById = new Map<string, any>();
    if (artifactIds.length) {
      const chunkSize = 200;
      for (let i = 0; i < artifactIds.length; i += chunkSize) {
        const chunk = artifactIds.slice(i, i + chunkSize);
        const { data: arts, error: aErr } = await supabase
          .from("artifacts")
          .select("id, title, artifact_type, project_id")
          .in("id", chunk)
          .limit(5000);
        if (aErr) throw aErr;
        for (const a of arts ?? [])
          artifactsById.set(String((a as any).id), a);
      }
    }

    /**
     * 4) Project metadata — including organisation_id
     */
    const { data: projects, error: projErr } = await supabase
      .from("projects")
      .select("id, project_code, title, organisation_id")
      .limit(5000);

    if (projErr) throw projErr;

    const projectMeta = new Map<
      string,
      { code: string; title: string; org_id: string | null }
    >();
    for (const p of projects ?? []) {
      projectMeta.set(String((p as any).id), {
        code: safeStr((p as any).project_code),
        title: safeStr((p as any).title),
        org_id: safeStr((p as any).organisation_id) || null,
      });
    }

    /**
     * 5) Approval groups
     */
    const { data: groups, error: grpErr } = await supabase
      .from("approval_groups")
      .select("id, name")
      .limit(5000);

    if (grpErr) throw grpErr;

    const groupName = new Map<string, string>();
    for (const g of groups ?? [])
      groupName.set(String((g as any).id), safeStr((g as any).name));

    /**
     * 6) SLA config
     */
    const { data: slaCfg, error: slaErr } = await supabase
      .from("approval_sla_config")
      .select(
        "project_id, artifact_type, stage_key, sla_hours, warn_hours, breach_grace_hours, is_active"
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

      let best: any = null;
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
     * 7) Build exec_approval_cache rows
     */
    const cacheRows: any[] = [];

    for (const s of pendingSteps) {
      const sid = safeStr(s?.id);
      const aid = safeStr(s?.artifact_id);

      const art = aid ? artifactsById.get(aid) : null;

      const pid =
        safeStr(art?.project_id) || safeStr(s?.project_id) || null;
      if (!pid) continue;

      const pm = projectMeta.get(pid) ?? null;

      const artifactType =
        safeStr(art?.artifact_type) ||
        safeStr(s?.artifact_type) ||
        null;
      const stageKey = pickStageKey(s);

      // FIX: use pending_since first (correct column on artifact_approval_steps)
      const submittedAtIso =
        safeStr(s?.pending_since) ||
        safeStr(s?.created_at) ||
        null;

      const dueAtIso =
        safeStr(s?.due_at) ||
        safeStr(s?.due_date) ||
        safeStr(s?.target_at) ||
        null;

      const submittedAt = submittedAtIso ? new Date(submittedAtIso) : null;
      const dueAt = dueAtIso ? new Date(dueAtIso) : null;

      const sla = resolveSlaHours({
        project_id: pid,
        artifact_type: artifactType,
        stage_key: stageKey,
      });

      const derivedDueAt =
        dueAt ||
        (submittedAt
          ? new Date(submittedAt.getTime() + sla.sla_hours * 3600_000)
          : null);

      const hoursToDue = derivedDueAt
        ? hoursBetween(now, derivedDueAt)
        : null;
      const hoursOverdue =
        derivedDueAt && now > derivedDueAt
          ? hoursBetween(derivedDueAt, now)
          : null;

      let slaStatus:
        | "ok"
        | "at_risk"
        | "breached"
        | "overdue_undecided"
        | "unknown" = "unknown";

      if (derivedDueAt) {
        const warnAt = new Date(
          derivedDueAt.getTime() - sla.warn_hours * 3600_000
        );
        const breachAt = new Date(
          derivedDueAt.getTime() + sla.grace_hours * 3600_000
        );

        if (now > breachAt) slaStatus = "overdue_undecided";
        else if (now >= derivedDueAt) slaStatus = "breached";
        else if (now >= warnAt || derivedDueAt <= riskCutoff)
          slaStatus = "at_risk";
        else slaStatus = "ok";
      }

      const approverUserId = safeStr(s?.approver_user_id) || null;
      const approverGroupId = safeStr(s?.approver_group_id) || null;

      const approverLabel = approverUserId
        ? `User:${approverUserId}`
        : approverGroupId
        ? groupName.get(approverGroupId) || `Group:${approverGroupId}`
        : "Unassigned";

      cacheRows.push({
        // FIX: organisation_id now included
        organisation_id: pm?.org_id ?? null,

        project_id: pid,
        project_code: pm?.code ?? null,
        project_title: pm?.title ?? null,

        artifact_id: aid || null,
        artifact_type: artifactType,
        artifact_title: safeStr(art?.title) || null,

        step_id: sid,
        stage_key: stageKey,
        step_title: pickStepTitle(s),

        approver_user_id: approverUserId,
        approver_group_id: approverGroupId,
        approver_label: approverLabel,

        submitted_at: submittedAtIso,
        due_at: derivedDueAt ? derivedDueAt.toISOString() : null,

        sla_status: slaStatus,
        hours_to_due: hoursToDue,
        hours_overdue: hoursOverdue,

        meta: {
          source: "artifact_approval_steps",
          sla_hours: sla.sla_hours,
        },
        computed_at: nowIso,
      });
    }

    /**
     * 8) Replace cache table
     */
    await supabase
      .from("exec_approval_cache")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    const chunkSize = 500;
    for (let i = 0; i < cacheRows.length; i += chunkSize) {
      const { error } = await supabase
        .from("exec_approval_cache")
        .insert(cacheRows.slice(i, i + chunkSize));
      if (error) throw error;
    }

    /**
     * 9) Bottlenecks
     */
    await supabase
      .from("exec_approval_bottlenecks")
      .delete()
      .neq("id", "00000000-0000-0000-0000-000000000000");

    const byApprover = new Map<
      string,
      {
        label: string;
        userId: string | null;
        groupId: string | null;
        open: number;
        breached: number;
        atRisk: number;
        maxOverdue: number;
      }
    >();

    for (const r of cacheRows) {
      const key = r.approver_user_id
        ? `U:${r.approver_user_id}`
        : r.approver_group_id
        ? `G:${r.approver_group_id}`
        : `X:unassigned`;

      const cur = byApprover.get(key) || {
        label: r.approver_label,
        userId: r.approver_user_id,
        groupId: r.approver_group_id,
        open: 0,
        breached: 0,
        atRisk: 0,
        maxOverdue: 0,
      };

      cur.open++;
      if (
        r.sla_status === "breached" ||
        r.sla_status === "overdue_undecided"
      )
        cur.breached++;
      if (r.sla_status === "at_risk") cur.atRisk++;
      cur.maxOverdue = Math.max(cur.maxOverdue, safeNum(r.hours_overdue));
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
      const { error } = await supabase
        .from("exec_approval_bottlenecks")
        .insert(bottleneckRows);
      if (error) throw error;
    }

    // Optional: refresh intel view — don't fail cron if RPC missing
    try {
      await supabase.rpc("exec_refresh_intel");
    } catch {
      // ignore
    }

    return jsonOk({
      cache: cacheRows.length,
      bottlenecks: bottleneckRows.length,
    });
  } catch (e: any) {
    return jsonErr("Exec intel generation failed", 500, {
      message: e?.message ?? String(e),
    });
  }
}

// POST for manual/API calls, GET for Vercel Cron
export async function POST(req: Request) {
  return handler(req);
}
export async function GET(req: Request) {
  return handler(req);
}