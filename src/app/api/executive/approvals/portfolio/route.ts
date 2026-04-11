// src/app/api/executive/approvals/portfolio/route.ts
// Always org-scoped. Uses v_pending_artifact_approvals_all (the canonical view).
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireUser, safeStr, clampDays } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...(init ?? {}),
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      ...(init?.headers ?? {}),
    },
  });
}

function riskState(nowMs: number, pendingSinceIso?: string | null, slaDays = 5) {
  const s = safeStr(pendingSinceIso).trim();
  if (!s) return { state: "ok" as const, rag: "G" as const, hoursToBreach: null as number | null };
  const submittedMs = new Date(s).getTime();
  if (!Number.isFinite(submittedMs)) return { state: "ok" as const, rag: "G" as const, hoursToBreach: null as number | null };
  const dueMs = submittedMs + slaDays * 864e5;
  const diffHrs = Math.round((dueMs - nowMs) / 36e5);
  if (nowMs > dueMs) return { state: "breached" as const, rag: "R" as const, hoursToBreach: diffHrs };
  if (diffHrs <= 48) return { state: "at_risk" as const, rag: "A" as const, hoursToBreach: diffHrs };
  return { state: "ok" as const, rag: "G" as const, hoursToBreach: diffHrs };
}

function daysWaiting(isoStr?: string | null) {
  const s = safeStr(isoStr).trim();
  if (!s) return 0;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const auth = await requireUser(supabase);
    const user = (auth as any)?.user ?? auth;
    const orgId = safeStr((auth as any)?.orgId).trim();

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"), 7, 60, 30);
    const sinceIso = new Date(Date.now() - days * 864e5).toISOString();

    if (!orgId) {
      return noStoreJson({ ok: false, error: "no_active_org" }, { status: 400 });
    }

    // Step 1: get all non-pipeline project IDs for this org
    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("id, title")
      .eq("organisation_id", orgId)
      .is("deleted_at", null)
      .neq("resource_status", "pipeline");

    if (projErr) {
      return noStoreJson({ ok: false, error: projErr.message }, { status: 500 });
    }

    const projectIds = (projectRows ?? []).map((p: any) => String(p.id)).filter(Boolean);
    const projectNameMap = new Map<string, string>();
    for (const p of projectRows ?? []) {
      projectNameMap.set(String(p.id), safeStr(p.title).trim() || "Project");
    }

    if (!projectIds.length) {
      return noStoreJson({
        ok: true, orgId, scope: "org", window_days: days,
        counts: { total: 0, R: 0, A: 0, G: 0 }, items: [],
      });
    }

    // Step 2: query v_pending_artifact_approvals_all -- flat filter, no nested join
    const { data: pending, error: pendingErr } = await supabase
      .from("v_pending_artifact_approvals_all")
      .select([
        "artifact_id", "project_id", "artifact_type", "title",
        "approval_status", "artifact_step_id", "chain_id",
        "step_order", "step_name", "step_status",
        "pending_user_id", "pending_email",
        "artifact_submitted_at", "step_pending_since", "artifact_created_at",
      ].join(","))
      .in("project_id", projectIds)
      .gte("artifact_created_at", sinceIso)
      .limit(500);

    if (pendingErr) {
      return noStoreJson({ ok: false, error: pendingErr.message }, { status: 500 });
    }

    const nowMs = Date.now();

    // Dedupe by artifact_step_id
    const stepsSeen = new Set<string>();
    const items: any[] = [];

    for (const r of pending ?? []) {
      const stepId = safeStr(r.artifact_step_id).trim();
      if (stepId && stepsSeen.has(stepId)) continue;
      if (stepId) stepsSeen.add(stepId);

      const pendingSince = r.step_pending_since ?? r.artifact_submitted_at ?? r.artifact_created_at;
      const risk = riskState(nowMs, pendingSince);

      items.push({
        id:           safeStr(r.artifact_id),
        title:        safeStr(r.title).trim() || "Untitled",
        status:       safeStr(r.step_status || r.approval_status) || "pending",
        approval_type: safeStr(r.artifact_type).trim() || null,
        amount:       null,
        requested_by: safeStr(r.pending_user_id) || null,
        project_id:   safeStr(r.project_id) || null,
        project_name: projectNameMap.get(safeStr(r.project_id)) ?? null,
        created_at:   r.artifact_created_at ?? null,
        updated_at:   null,
        sla_due_at:   null,
        waiting_days: daysWaiting(pendingSince),
        risk_state:   risk.state,
        rag:          risk.rag,
        hours_to_breach: risk.hoursToBreach,
        step_id:      stepId || null,
        chain_id:     safeStr(r.chain_id) || null,
        step_name:    safeStr(r.step_name).trim() || "Approval",
      });
    }

    // Also check change_requests (pending CRs are separate from artifact approvals)
    {
      const { data: crRows } = await supabase
        .from("change_requests")
        .select("id, title, status, decision_status, impact, created_by, created_at, updated_at, review_by, project_id")
        .in("project_id", projectIds)
        .gte("created_at", sinceIso)
        .not("status", "in", '("closed","cancelled","rejected")')
        .not("decision_status", "in", '("approved","rejected")')
        .limit(200);

      for (const r of crRows ?? []) {
        const ds = safeStr(r.decision_status).toLowerCase();
        if (["approved", "rejected"].includes(ds)) continue;
        const st = safeStr(r.status).toLowerCase();
        if (["closed", "cancelled"].includes(st)) continue;

        const pendingSince = r.created_at ?? null;
        const risk = riskState(nowMs, pendingSince);

        items.push({
          id:           safeStr(r.id),
          title:        safeStr(r.title).trim() || "Change Request",
          status:       safeStr(r.status) || "open",
          approval_type: "change_request",
          amount:       null,
          requested_by: safeStr(r.created_by) || null,
          project_id:   safeStr(r.project_id) || null,
          project_name: projectNameMap.get(safeStr(r.project_id)) ?? null,
          created_at:   r.created_at ?? null,
          updated_at:   r.updated_at ?? null,
          sla_due_at:   r.review_by ?? null,
          waiting_days: daysWaiting(pendingSince),
          risk_state:   risk.state,
          rag:          risk.rag,
          hours_to_breach: risk.hoursToBreach,
          step_id:      null,
          chain_id:     null,
          step_name:    "Change Request",
        });
      }
    }

    const counts = items.reduce(
      (acc, it) => {
        if (it.rag === "R") acc.R += 1;
        else if (it.rag === "A") acc.A += 1;
        else acc.G += 1;
        acc.total += 1;
        return acc;
      },
      { total: 0, R: 0, A: 0, G: 0 }
    );

    return noStoreJson({ ok: true, orgId, scope: "org", window_days: days, counts, items });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unknown error";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return noStoreJson({ ok: false, error: "portfolio_approvals_failed", message: msg }, { status });
  }
}