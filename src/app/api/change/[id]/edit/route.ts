// src/app/api/change/[id]/edit/route.ts
import "server-only";

import { NextResponse } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  normalizeImpactAnalysis,
  logChangeEvent,
} from "@/lib/change/server-helpers";

import { computeChangeAIFields } from "@/lib/change/ai-compute";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Ctx = { params: Promise<{ id?: string }> };

function jsonOk(payload: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...payload }, { status });
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

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function asTags(x: any): string[] {
  if (!Array.isArray(x)) return [];
  return x
    .map((v) => safeStr(v).trim())
    .filter(Boolean)
    .slice(0, 25);
}

function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
}

function normalizePriority(p: unknown): "Low" | "Medium" | "High" | "Critical" {
  const v = safeStr(p).trim().toLowerCase();
  if (v === "low") return "Low";
  if (v === "high") return "High";
  if (v === "critical") return "Critical";
  return "Medium";
}

function hasOwn(obj: any, key: string) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
}

function containsGovernanceFields(body: any) {
  const blockedKeys = [
    "status",
    "decision_status",
    "decisionStatus",
    "delivery_status",
    "deliveryStatus",
    "approved_at",
    "approvedAt",
    "approved_by",
    "approvedBy",
    "rejected_at",
    "rejectedAt",
    "rejected_by",
    "rejectedBy",
  ];
  return blockedKeys.some((k) => hasOwn(body, k));
}

async function emitAiEvent(req: Request, body: any) {
  try {
    await fetch(new URL("/api/ai/events", req.url), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
  } catch {}
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const changeId = safeStr((await ctx.params)?.id).trim();
    if (!changeId) return jsonErr("Missing id", 400);

    const body = await req.json().catch(() => ({}));

    if (containsGovernanceFields(body)) {
      return jsonErr(
        "Governance enforced: status/decision updates must use Submit/Approve/Reject/Request-Changes routes.",
        409
      );
    }

    const { data: cr, error: crErr } = await supabase
      .from("change_requests")
      .select("id, project_id, decision_status, status")
      .eq("id", changeId)
      .maybeSingle();

    if (crErr) throw crErr;
    if (!cr) return jsonErr("Not found", 404);

    const projectId = String((cr as any).project_id ?? "");
    const decisionStatus = String((cr as any).decision_status ?? "").toLowerCase();
    const lifecycleStatus = String((cr as any).status ?? "").toLowerCase();

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);
    if (!canEdit(role)) return jsonErr("Forbidden", 403);

    if (decisionStatus === "submitted") {
      return jsonErr("This change is locked awaiting decision. Approve, reject, or request changes first.", 409);
    }

    const title = clamp(safeStr(body?.title).trim(), 160);
    const description = clamp(safeStr(body?.description).trim(), 1200);
    const proposed_change = clamp(safeStr(body?.proposed_change ?? body?.proposedChange).trim(), 8000);

    const tags = asTags(body?.tags);
    const impact_analysis = normalizeImpactAnalysis(body?.impact_analysis ?? body?.impactAnalysis);

    const patch: any = {};
    if (title) patch.title = title;

    patch.description = description;
    patch.proposed_change = proposed_change;

    if (safeStr(body?.priority).trim()) patch.priority = normalizePriority(body?.priority);

    patch.tags = tags;
    patch.impact_analysis = impact_analysis;

    if (hasOwn(body, "links")) patch.links = body.links;

    patch.updated_at = new Date().toISOString();

    const updated = await supabase.from("change_requests").update(patch).eq("id", changeId).select("*").single();
    if (updated.error) throw updated.error;

    try {
      await logChangeEvent(supabase, {
        projectId,
        changeRequestId: changeId,
        actorUserId: user.id,
        actorRole: role,
        eventType: "edited",
        note: "Change updated",
        payload: { lifecycle: lifecycleStatus, decision_status: decisionStatus },
      } as any);
    } catch {}

    try {
      const ins = await supabase.from("change_events").insert({
        project_id: projectId,
        change_id: changeId,
        event_type: "edited",
        from_status: null,
        to_status: null,
        actor_user_id: user.id,
        actor_role: String(role ?? ""),
        comment: "Change updated",
        payload: { source: "edit_form" },
      });
      if (ins.error && !isMissingRelation(safeStr(ins.error.message))) {
        // swallow
      }
    } catch {}

    try {
      const computed = await computeChangeAIFields({ supabase, projectId, changeRow: updated.data });

      const up2 = await supabase
        .from("change_requests")
        .update({
          ai_score: computed.ai_score,
          ai_schedule: computed.ai_schedule,
          ai_cost: computed.ai_cost,
          ai_scope: computed.ai_scope,
          links: computed.links,
          updated_at: new Date().toISOString(),
        })
        .eq("id", changeId)
        .select("*")
        .single();

      if (up2.error) throw up2.error;

      await emitAiEvent(req, {
        projectId,
        artifactId: changeId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: { target_artifact_type: "change_request", change_id: changeId, action: "updated" },
      });

      return jsonOk({ item: up2.data, data: up2.data, role });
    } catch {
      await emitAiEvent(req, {
        projectId,
        artifactId: changeId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: { target_artifact_type: "change_request", change_id: changeId, action: "updated" },
      });
      return jsonOk({ item: updated.data, data: updated.data, role });
    }
  } catch (e: any) {
    console.error("[PATCH /api/change/:id/edit]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}