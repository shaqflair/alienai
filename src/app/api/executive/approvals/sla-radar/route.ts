// src/app/api/executive/approvals/sla-radar/route.ts
// Reads live from v_pending_artifact_approvals_all -- no stale cache dependency
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
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeIso(v: any): string | null {
  const s = safeStr(v).trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

export async function GET() {
  try {
    const supabase = await createClient();
    const _auth = await requireUser(supabase);
    const user = (_auth as any)?.user ?? _auth;

    const orgIds = await orgIdsForUser(supabase, user.id);
    const orgId = safeStr(orgIds[0]).trim();

    if (!orgId) {
      return jsonOk({ orgId: null, scope: "org", generated_at: new Date().toISOString(), items: [] });
    }

    const SLA_DAYS = 5;
    const nowMs = Date.now();
    const DAY = 864e5;

    // Step 1: get all non-pipeline project IDs for this org
    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("id, title, project_code")
      .in("organisation_id", [orgId])
      .is("deleted_at", null)
      .neq("resource_status", "pipeline");

    if (projErr) return jsonErr(projErr.message, 500);

    const projectIds = (projectRows ?? []).map((p: any) => safeStr(p.id)).filter(Boolean);
    const projMap = new Map<string, any>();
    for (const p of projectRows ?? []) projMap.set(safeStr(p.id), p);

    if (!projectIds.length) {
      return jsonOk({ orgId, scope: "org", generated_at: new Date().toISOString(), items: [] });
    }

    // Step 2: query live view
    const { data: pending, error: pendingErr } = await supabase
      .from("v_pending_artifact_approvals_all")
      .select([
        "artifact_id", "project_id", "artifact_type", "title",
        "artifact_step_id", "step_name", "step_status",
        "pending_user_id", "pending_email",
        "artifact_submitted_at", "step_pending_since",
      ].join(","))
      .in("project_id", projectIds)
      .limit(500);

    if (pendingErr) return jsonErr(pendingErr.message, 500);

    // Dedupe by step, compute SLA risk
    const stepsSeen = new Set<string>();
    const items: any[] = [];

    for (const r of pending ?? []) {
      const stepId = safeStr(r.artifact_step_id).trim();
      if (stepId && stepsSeen.has(stepId)) continue;
      if (stepId) stepsSeen.add(stepId);

      const pendingSince = r.step_pending_since ?? r.artifact_submitted_at;
      if (!pendingSince) continue;

      const submittedMs = new Date(pendingSince).getTime();
      if (!Number.isFinite(submittedMs)) continue;

      const dueMs = submittedMs + SLA_DAYS * DAY;
      const diffMs = dueMs - nowMs;
      const diffHrs = Math.floor(diffMs / 36e5);

      const breached = nowMs > dueMs;
      const at_risk  = !breached && diffHrs <= 48;

      if (!breached && !at_risk) continue; // only surface at-risk items

      const proj = projMap.get(safeStr(r.project_id));
      const dueIso = new Date(dueMs).toISOString();

      items.push({
        type:          safeStr(r.artifact_type) || "approval",
        id:            safeStr(r.artifact_step_id) || safeStr(r.artifact_id),
        title:         safeStr(r.title).trim() || safeStr(r.step_name).trim() || "Approval",
        status:        safeStr(r.step_status) || "pending",
        priority:      null,
        due_at:        dueIso,
        breached,
        at_risk,
        overdue_days:  breached ? Math.max(1, Math.floor(Math.abs(diffMs) / DAY)) : 0,
        hours_to_due:  diffHrs,
        updated_at:    safeIso(pendingSince),
        project_id:    safeStr(r.project_id) || null,
        project_title: proj?.title ?? null,
        project_code:  proj?.project_code ?? null,
        stage_key:     [safeStr(r.artifact_type) || "approval", "pending"].filter(Boolean).join(" - "),
        assignee_id:   safeStr(r.pending_user_id) || null,
        approver_email: safeStr(r.pending_email) || null,
      });
    }

    // Sort: breached first, then soonest due
    items.sort((a, b) => {
      const aw = a.breached ? 2 : a.at_risk ? 1 : 0;
      const bw = b.breached ? 2 : b.at_risk ? 1 : 0;
      if (bw !== aw) return bw - aw;
      return (a.hours_to_due ?? Infinity) - (b.hours_to_due ?? Infinity);
    });

    return jsonOk({ orgId, scope: "org", generated_at: new Date().toISOString(), items });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonErr(msg, status);
  }
}