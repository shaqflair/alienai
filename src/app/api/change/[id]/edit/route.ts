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
  // Block any attempt to mutate governed fields via edit form route
  // Include both snake_case and camelCase variants you might send from UI
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
  } catch {
    // swallow
  }
}

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }>}) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const changeId = safeStr((await ctx.params).id).trim();
    if (!changeId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));

    // âœ… Governance: never allow status/decision/delivery edits here
    if (containsGovernanceFields(body)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Governance enforced: status/decision updates must use Submit/Approve/Reject routes (not the edit form).",
        },
        { status: 409 }
      );
    }

    // Load CR for authorization + project id + decision_status (for locked check)
    const { data: cr, error: crErr } = await supabase
      .from("change_requests")
      .select("id, project_id, decision_status, status")
      .eq("id", changeId)
      .maybeSingle();

    if (crErr) throw crErr;
    if (!cr) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const projectId = String((cr as any).project_id ?? "");
    const decisionStatus = String((cr as any).decision_status ?? "").toLowerCase();
    const lifecycleStatus = String((cr as any).status ?? "").toLowerCase();

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!canEdit(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // âœ… Lock on decision_status only (governance lock)
    if (decisionStatus === "submitted") {
      return NextResponse.json(
        {
          ok: false,
          error: "This change is locked awaiting decision. Approve, reject, or request changes first.",
        },
        { status: 409 }
      );
    }

    // OPTIONAL: If you want to stop edits after approval too, uncomment:
    // if (decisionStatus === "approved") {
    //   return NextResponse.json(
    //     { ok: false, error: "This change is approved and locked. Create a follow-on change if updates are needed." },
    //     { status: 409 }
    //   );
    // }

    // Patchable fields (keep limits sane)
    const title = clamp(safeStr(body?.title).trim(), 160);
    const description = clamp(safeStr(body?.description).trim(), 1200);
    const proposed_change = clamp(safeStr(body?.proposed_change ?? body?.proposedChange).trim(), 8000);

    const tags = asTags(body?.tags);
    const impact_analysis = normalizeImpactAnalysis(body?.impact_analysis ?? body?.impactAnalysis);

    const patch: any = {};

    if (title) patch.title = title;

    // Allow clearing these fields
    patch.description = description;
    patch.proposed_change = proposed_change;

    // Priority: normalize to satisfy DB CHECK (Low/Medium/High/Critical)
    if (safeStr(body?.priority).trim()) {
      patch.priority = normalizePriority(body?.priority);
    }

    // tags / impact_analysis are NOT NULL in schema â†’ safe defaults
    patch.tags = tags;
    patch.impact_analysis = impact_analysis;

    // Links: allow explicit clear (null) OR update (object)
    if (hasOwn(body, "links")) {
      patch.links = body.links;
    }

    patch.updated_at = new Date().toISOString();

    const updated = await supabase
      .from("change_requests")
      .update(patch)
      .eq("id", changeId)
      .select("*")
      .single();

    if (updated.error) throw updated.error;

    // Legacy audit trail (best effort)
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
    } catch {
      // swallow
    }

    // New timeline table (best effort)
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
        console.warn("[PATCH /api/change/:id/edit] change_events insert error:", ins.error.message);
      }
    } catch {
      // swallow
    }

    // âœ… Recompute AI and persist (best effort)
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
        payload: {
          target_artifact_type: "change_request",
          change_id: changeId,
          action: "updated",
        },
      });

      return NextResponse.json({ ok: true, item: up2.data, data: up2.data, role });
    } catch {
      await emitAiEvent(req, {
        projectId,
        artifactId: changeId,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "change_request",
          change_id: changeId,
          action: "updated",
        },
      });

      return NextResponse.json({ ok: true, item: updated.data, data: updated.data, role });
    }
  } catch (e: any) {
    console.error("[PATCH /api/change/:id/edit]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

