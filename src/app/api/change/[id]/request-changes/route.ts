// src/app/api/change/[id]/request-changes/route.ts
import "server-only";

import { NextResponse } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  isOwner,
  safeStr,
  logChangeEvent,
} from "@/lib/change/server-helpers";
import { computeChangeAIFields } from "@/lib/change/ai-compute";

export const runtime = "nodejs";

function hasMissingColumn(errMsg: string, col: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("column") && m.includes(col.toLowerCase());
}
function hasDeliveryStatusMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "delivery_status");
}
function hasArtifactIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "artifact_id");
}

async function insertTimelineEvent(
  supabase: any,
  row: {
    project_id: string;
    change_id: string;
    event_type: "created" | "status_changed" | "comment" | "edited";
    from_status?: string | null;
    to_status?: string | null;
    actor_user_id?: string | null;
    actor_role?: string | null;
    comment?: string | null;
    payload?: any;
  }
) {
  try {
    await supabase.from("change_events").insert({
      project_id: row.project_id,
      change_id: row.change_id,
      event_type: row.event_type,
      from_status: row.from_status ?? null,
      to_status: row.to_status ?? null,
      actor_user_id: row.actor_user_id ?? null,
      actor_role: row.actor_role ?? null,
      comment: row.comment ?? null,
      payload: row.payload && typeof row.payload === "object" ? row.payload : {},
    });
  } catch {
    // swallow
  }
}

async function emitAiEvent(req: Request, body: any) {
  try {
    await fetch(new URL("/api/ai/events", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  } catch {
    // swallow
  }
}

function normalizeLane(v: unknown) {
  const x = safeStr(v).trim().toLowerCase();
  if (!x) return "";
  if (x === "in-progress" || x === "in progress") return "in_progress";
  if (x === "new") return "intake";
  return x;
}

async function ensureArtifactIdForChangeRequest(supabase: any, cr: any): Promise<string | null> {
  const current = safeStr(cr?.artifact_id).trim();
  if (current) return current;

  const projectId = safeStr(cr?.project_id).trim();
  if (!projectId) return null;

  const { data, error } = await supabase
    .from("artifacts")
    .select("id, type, is_current, created_at")
    .eq("project_id", projectId)
    .in("type", ["change_requests", "change_request", "change"])
    .order("is_current", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;
  const resolved = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
  if (!resolved) return null;

  try {
    await supabase.from("change_requests").update({ artifact_id: resolved }).eq("id", cr.id);
  } catch {
    // ignore
  }

  return resolved;
}

/**
 * POST /api/change/:id/request-changes
 * Optionally accepts { note }
 */
export async function POST(req: Request, ctx: { params: { id?: string } }) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const id = safeStr(ctx?.params?.id).trim();
    if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const note = safeStr(body?.note).trim();

    // Load CR (delivery_status / artifact_id may not exist)
    let cr: any = null;

    const firstLoad = await supabase
      .from("change_requests")
      .select("id, project_id, status, decision_status, delivery_status, artifact_id")
      .eq("id", id)
      .maybeSingle();

    if (!firstLoad.error) {
      cr = firstLoad.data;
    } else {
      const msg = safeStr(firstLoad.error.message);
      const needsRetry = hasDeliveryStatusMissingColumn(msg) || hasArtifactIdMissingColumn(msg);

      if (needsRetry) {
        const secondLoad = await supabase
          .from("change_requests")
          .select("id, project_id, status, decision_status")
          .eq("id", id)
          .maybeSingle();

        if (secondLoad.error) throw secondLoad.error;
        cr = secondLoad.data;
      } else {
        throw firstLoad.error;
      }
    }

    if (!cr) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const projectId = safeStr(cr?.project_id).trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "Missing project_id" }, { status: 500 });

    const lifecycle = safeStr(cr?.status).trim().toLowerCase();
    const decisionStatus = safeStr(cr?.decision_status).trim().toLowerCase();
    const fromLane = normalizeLane(cr?.delivery_status) || null;

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!isOwner(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // ✅ Idempotent: already rework
    if (decisionStatus === "rework") {
      return NextResponse.json({ ok: true, item: cr, data: cr });
    }

    // ✅ only request changes when decision_status=submitted
    if (decisionStatus !== "submitted") {
      return NextResponse.json(
        { ok: false, error: `Cannot request changes when decision_status=${decisionStatus || "(null)"}` },
        { status: 409 }
      );
    }

    // ✅ strict: only from Review lane (submit put it there)
    if (fromLane && fromLane !== "review") {
      return NextResponse.json(
        { ok: false, error: `Only changes in Review can be sent back for rework (current lane=${fromLane}).` },
        { status: 409 }
      );
    }

    // ✅ Ensure artifact_id exists
    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return NextResponse.json(
        { ok: false, error: "Missing artifact_id (Change Requests artifact). Create/backfill the project artifact first." },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const toLane = "analysis";

    const patchBase: any = {
      status: "analysis",
      decision_status: "rework",
      decision_rationale: note || null,
      decision_by: user.id,
      decision_at: now,
      decision_role: safeStr(role),
      delivery_status: toLane,
      updated_at: now,
    };

    // legacy columns (only if present)
    let patch: any = { ...patchBase, approver_id: user.id, approval_date: now };

    const first = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();

    // Retry stripping missing columns (legacy-safe)
    if (first.error) {
      const msg = safeStr(first.error.message);

      if (hasDeliveryStatusMissingColumn(msg)) delete patch.delivery_status;
      if (hasMissingColumn(msg, "approver_id")) delete patch.approver_id;
      if (hasMissingColumn(msg, "approval_date")) delete patch.approval_date;
      if (hasMissingColumn(msg, "decision_role")) delete patch.decision_role;
      if (hasMissingColumn(msg, "decision_rationale")) delete patch.decision_rationale;
      if (hasMissingColumn(msg, "decision_by")) delete patch.decision_by;
      if (hasMissingColumn(msg, "decision_at")) delete patch.decision_at;

      const second = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();
      if (second.error) throw second.error;

      // Audit log (best effort)
      try {
        const artifactIdFromUpdated = safeStr((second.data as any)?.artifact_id).trim();
        const finalArtifactId = artifactIdFromUpdated || artifactId;

        if (finalArtifactId) {
          await logChangeEvent(
            supabase,
            {
              projectId,
              artifactId: finalArtifactId,
              changeRequestId: id,
              actorUserId: user.id,
              actorRole: role,
              eventType: "changes_requested",
              fromValue: lifecycle,
              toValue: "analysis",
              note: note || null,
              payload: { decision_status: "rework", to_lane: toLane, delivery_status_missing: !("delivery_status" in patch) },
            } as any
          );
        }
      } catch {}

      await insertTimelineEvent(supabase, {
        project_id: projectId,
        change_id: id,
        event_type: "status_changed",
        from_status: fromLane,
        to_status: ("delivery_status" in patch) ? toLane : null,
        actor_user_id: user.id,
        actor_role: safeStr(role),
        comment: note || null,
        payload: {
          source: "request_changes_route",
          lifecycle: { from: lifecycle, to: "analysis" },
          decision_status: { from: "submitted", to: "rework" },
          to_lane: toLane,
          at: now,
        },
      });

      // AI compute + persist (best effort)
      try {
        const computed = await computeChangeAIFields({ supabase, projectId, changeRow: second.data });
        await supabase
          .from("change_requests")
          .update({
            ai_score: computed.ai_score,
            ai_schedule: computed.ai_schedule,
            ai_cost: computed.ai_cost,
            ai_scope: computed.ai_scope,
            links: computed.links,
          })
          .eq("id", id);
      } catch {}

      await emitAiEvent(req, {
        projectId,
        artifactId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "change_request",
          change_id: id,
          action: "request_changes",
          decision_status: "rework",
        },
      });

      return NextResponse.json({ ok: true, item: second.data, data: second.data });
    }

    // Audit log (best effort)
    try {
      const artifactIdFromUpdated = safeStr((first.data as any)?.artifact_id).trim();
      const finalArtifactId = artifactIdFromUpdated || artifactId;

      if (finalArtifactId) {
        await logChangeEvent(
          supabase,
          {
            projectId,
            artifactId: finalArtifactId,
            changeRequestId: id,
            actorUserId: user.id,
            actorRole: role,
            eventType: "changes_requested",
            fromValue: lifecycle,
            toValue: "analysis",
            note: note || null,
            payload: { decision_status: "rework", to_lane: toLane },
          } as any
        );
      }
    } catch {}

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: id,
      event_type: "status_changed",
      from_status: fromLane,
      to_status: toLane,
      actor_user_id: user.id,
      actor_role: safeStr(role),
      comment: note || null,
      payload: {
        source: "request_changes_route",
        lifecycle: { from: lifecycle, to: "analysis" },
        decision_status: { from: "submitted", to: "rework" },
        to_lane: toLane,
        at: now,
      },
    });

    // AI compute + persist (best effort)
    try {
      const computed = await computeChangeAIFields({ supabase, projectId, changeRow: first.data });

      const up = await supabase
        .from("change_requests")
        .update({
          ai_score: computed.ai_score,
          ai_schedule: computed.ai_schedule,
          ai_cost: computed.ai_cost,
          ai_scope: computed.ai_scope,
          links: computed.links,
        })
        .eq("id", id)
        .select("*")
        .single();

      if (up.error) throw up.error;

      await emitAiEvent(req, {
        projectId,
        artifactId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "change_request",
          change_id: id,
          action: "request_changes",
          decision_status: "rework",
        },
      });

      return NextResponse.json({ ok: true, item: up.data, data: up.data });
    } catch {
      await emitAiEvent(req, {
        projectId,
        artifactId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "change_request",
          change_id: id,
          action: "request_changes",
          decision_status: "rework",
        },
      });

      return NextResponse.json({ ok: true, item: first.data, data: first.data });
    }
  } catch (e: any) {
    console.error("[POST /api/change/:id/request-changes]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
