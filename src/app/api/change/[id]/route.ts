// src/app/api/change/[id]/route.ts
import "server-only";


        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  normalizeImpactAnalysis,
  logChangeEvent,
  getApprovalProgressForArtifact,
} from "@/lib/change/server-helpers";
import { computeChangeAIFields } from "@/lib/change/ai-compute";

export const runtime = "nodejs";

const TABLE = "change_requests";

/* =========================
   Response helpers
========================= */

function ok(data: any, init?: ResponseInit) {
  const item = (data && (data.item ?? data.data)) || null;
  const id = item?.id ?? data?.id ?? null;
  return NextResponse.json({ ok: true, ...data, ...(id ? { id } : {}) }, init);
}

function err(message: string, init?: (ResponseInit & { extra?: any; code?: string })) {
  const { extra, code, ...rest } = init || {};
  return NextResponse.json(
    { ok: false, error: message, ...(code ? { code } : {}), ...(extra ? { extra } : {}) },
    rest
  );
}

/* =========================
   Small utils
========================= */

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function isObj(v: any) {
  return v && typeof v === "object" && !Array.isArray(v);
}

function hasOwn(obj: any, key: string) {
  return Object.prototype.hasOwnProperty.call(obj ?? {}, key);
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

function normalizePriorityToDb(p: unknown): "Low" | "Medium" | "High" | "Critical" {
  const v = safeStr(p).trim().toLowerCase();
  if (v === "low") return "Low";
  if (v === "high") return "High";
  if (v === "critical") return "Critical";
  return "Medium";
}

const ALLOWED_DELIVERY = new Set([
  "intake",
  "analysis",
  "review",
  "in_progress",
  "implemented",
  "closed",
]);

function normalizeDeliveryStatus(x: unknown): string | null {
  const v = safeStr(x).trim().toLowerCase();
  if (!v) return null;
  const norm = v === "in-progress" || v === "in progress" ? "in_progress" : v;
  return ALLOWED_DELIVERY.has(norm) ? norm : null;
}

function pickId(req: Request, ctx: any, body: any): string | null {
  try {
    const pathname = new URL(req.url).pathname || "";
    const parts = pathname.split("/").filter(Boolean);
    const last = parts[parts.length - 1];
    const u = safeStr(last).trim();
    if (u && u !== "null" && u !== "undefined") return u;
  } catch {}

  const { id } = await ctx.params;
    const p = safeStr(id).trim();
  if (p && p !== "null" && p !== "undefined") return p;

  const b = safeStr(body?.id ?? body?.change_id).trim();
  if (b && b !== "null" && b !== "undefined") return b;

  return null;
}

function containsDecisionOrGovernanceFields(body: any) {
  const blockedKeys = [
    "status",
    "decision_status",
    "decisionStatus",
    "decision_rationale",
    "decisionRationale",
    "decision_by",
    "decisionBy",
    "decision_at",
    "decisionAt",
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

function canMoveDelivery(args: { decision: string; from: string; to: string }) {
  const decision = (args.decision || "").toLowerCase();
  const from = (args.from || "intake").toLowerCase();
  const to = (args.to || "").toLowerCase();

  if (!to || from === to) return true;
  if (decision === "submitted") return false;

  if (!decision || decision === "draft" || decision === "rework") {
    const allowed = new Set(["intake", "analysis"]);
    return allowed.has(from) && allowed.has(to);
  }

  if (decision === "approved") {
    if (from === "analysis" && to === "review") return true;

    const order = ["review", "in_progress", "implemented", "closed"];
    const iFrom = order.indexOf(from);
    const iTo = order.indexOf(to);
    if (iFrom === -1 || iTo === -1) return false;

    return iTo === iFrom + 1 || iTo === iFrom - 1;
  }

  if (decision === "rejected") return false;
  return false;
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

function readPlanFields(body: any) {
  const implementation =
    safeStr(body?.implementationPlan) ||
    safeStr(body?.implementation_plan) ||
    safeStr(body?.implementation) ||
    "";

  const rollback =
    safeStr(body?.rollbackPlan) ||
    safeStr(body?.rollback_plan) ||
    safeStr(body?.rollback) ||
    "";

  return {
    implementation_plan: implementation ? clamp(implementation, 8000) : null,
    rollback_plan: rollback ? clamp(rollback, 8000) : null,
  };
}

function hasAnyPlanKey(body: any) {
  return (
    hasOwn(body, "implementationPlan") ||
    hasOwn(body, "implementation_plan") ||
    hasOwn(body, "implementation") ||
    hasOwn(body, "rollbackPlan") ||
    hasOwn(body, "rollback_plan") ||
    hasOwn(body, "rollback")
  );
}

function readNarrativeFields(body: any) {
  const out: Record<string, any> = {};

  if (hasOwn(body, "justification")) {
    out.justification = body.justification == null ? null : clamp(safeStr(body.justification), 8000);
  }
  if (hasOwn(body, "financial")) {
    out.financial = body.financial == null ? null : clamp(safeStr(body.financial), 8000);
  }
  if (hasOwn(body, "schedule")) {
    out.schedule = body.schedule == null ? null : clamp(safeStr(body.schedule), 8000);
  }
  if (hasOwn(body, "risks")) {
    out.risks = body.risks == null ? null : clamp(safeStr(body.risks), 8000);
  }

  const depKeyPresent =
    hasOwn(body, "dependencies") ||
    hasOwn(body, "Dependencies") ||
    hasOwn(body, "dependency") ||
    hasOwn(body, "dependencyText") ||
    hasOwn(body, "dependenciesText");
  if (depKeyPresent) {
    const v =
      body.dependencies ??
      body.Dependencies ??
      body.dependency ??
      body.dependencyText ??
      body.dependenciesText;
    out.dependencies = v == null ? null : clamp(safeStr(v), 8000);
  }

  const asmKeyPresent =
    hasOwn(body, "assumptions") ||
    hasOwn(body, "Assumptions") ||
    hasOwn(body, "assumption") ||
    hasOwn(body, "assumptionText") ||
    hasOwn(body, "assumptionsText");
  if (asmKeyPresent) {
    const v =
      body.assumptions ??
      body.Assumptions ??
      body.assumption ??
      body.assumptionText ??
      body.assumptionsText;
    out.assumptions = v == null ? null : clamp(safeStr(v), 8000);
  }

  return out;
}

/* =========================
   Option B â€” review_by helpers
========================= */

function toDateOnlyString(input: any): string | null {
  if (input == null) return null;

  if (input instanceof Date && !Number.isNaN(input.getTime())) {
    const y = input.getUTCFullYear();
    const m = String(input.getUTCMonth() + 1).padStart(2, "0");
    const d = String(input.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  const s = safeStr(input).trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const iso = new Date(s);
  if (!Number.isNaN(iso.getTime())) {
    const y = iso.getUTCFullYear();
    const m = String(iso.getUTCMonth() + 1).padStart(2, "0");
    const d = String(iso.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  return null;
}

function readReviewBy(body: any): { present: boolean; value: string | null } {
  const present = hasOwn(body, "reviewBy") || hasOwn(body, "review_by");
  if (!present) return { present: false, value: null };

  const raw = hasOwn(body, "reviewBy") ? body.reviewBy : body.review_by;
  const value = raw == null ? null : toDateOnlyString(raw);

  if (raw == null) return { present: true, value: null };
  if (raw != null && value == null) return { present: true, value: null };

  return { present: true, value };
}

function missingColumnName(msg: string): string | null {
  const m = String(msg || "").match(
    /column\s+"([^"]+)"\s+of\s+relation\s+"[^"]+"\s+does\s+not\s+exist/i
  );
  return m?.[1] || null;
}

async function updateWithStripRetry(supabase: any, id: string, update: Record<string, any>) {
  const first = await supabase.from(TABLE).update(update).eq("id", id).select("*").maybeSingle();
  if (!first.error) return first;

  const col = missingColumnName(safeStr(first.error.message));
  if (!col) return first;

  const cleaned = { ...update };
  delete cleaned[col];

  if (Object.keys(cleaned).length === 0) return first;

  const second = await supabase.from(TABLE).update(cleaned).eq("id", id).select("*").maybeSingle();
  return second.error ? first : second;
}

/* =========================
   DELETE
========================= */

export async function DELETE(req: NextRequest, ctx: any) {
  try {
    const id = pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    const supabase = await sb();
    const user = await requireUser(supabase);

    const { data: cr, error: crErr } = await supabase
      .from(TABLE)
      .select("id, project_id, decision_status, title, delivery_status")
      .eq("id", id)
      .maybeSingle();

    if (crErr)
      return err("Failed to fetch change request", { status: 500, extra: crErr, code: "fetch_failed" });
    if (!cr) return err("Not found", { status: 404, code: "not_found" });

    const projectId = String((cr as any).project_id ?? "");
    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });
    if (!canEdit(role)) return err("Forbidden", { status: 403, code: "forbidden" });

    const ds = String((cr as any).decision_status ?? "draft").toLowerCase();
    if (ds !== "draft") return err("Only draft change requests can be deleted.", { status: 409, code: "locked" });

    const lane = String((cr as any).delivery_status ?? "intake").toLowerCase();
    if (lane !== "intake" && lane !== "analysis") {
      return err("Delete is only allowed in Intake or Analysis.", { status: 409, code: "locked" });
    }

    try {
      const ev = await supabase.from("change_events").delete().eq("change_id", id);
      if (ev.error && !isMissingRelation(safeStr(ev.error.message))) {
        console.warn("[DELETE /api/change/:id] change_events delete error:", ev.error.message);
      }
    } catch {}

    try {
      const at = await supabase.from("change_attachments").delete().eq("change_id", id);
      if (at.error && !isMissingRelation(safeStr(at.error.message))) {
        console.warn("[DELETE /api/change/:id] change_attachments delete error:", at.error.message);
      }
    } catch {}

    try {
      const cm = await supabase.from("change_comments").delete().eq("change_id", id);
      if (cm.error && !isMissingRelation(safeStr(cm.error.message))) {
        console.warn("[DELETE /api/change/:id] change_comments delete error:", cm.error.message);
      }
    } catch {}

    const { error: delErr } = await supabase.from(TABLE).delete().eq("id", id);
    if (delErr)
      return err(delErr.message || "Delete failed", { status: 500, extra: delErr, code: "delete_failed" });

    await logChangeEvent(supabase, {
      projectId,
      changeRequestId: id,
      actorUserId: user.id,
      actorRole: role,
      eventType: "edited",
      note: "Change deleted",
    });

    return ok({ deleted: true, id });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

/* =========================
   GET single
========================= */

export async function GET(req: NextRequest, ctx: any) {
  try {
    const id = pickId(req, ctx, null);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    const supabase = await sb();
    const user = await requireUser(supabase);

    const { data: cr, error: crErr } = await supabase.from(TABLE).select("*").eq("id", id).maybeSingle();
    if (crErr)
      return err("Failed to fetch change request", { status: 500, extra: crErr, code: "fetch_failed" });
    if (!cr) return err("Not found", { status: 404, code: "not_found" });

    const projectId = String((cr as any).project_id ?? "");
    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });

    let approval: any = null;
    try {
      const artifactId = safeStr((cr as any)?.artifact_id);
      if (artifactId) {
        approval = await getApprovalProgressForArtifact({
          supabase,
          artifactId,
          actorUserId: user.id,
        });
      }
    } catch {
      approval = null;
    }

    return ok({ item: cr, data: cr, role, approval, id: (cr as any)?.id ?? id });
  } catch (e: any) {
    return err(safeStr(e?.message) || "Unexpected error", { status: 500, code: "server_error" });
  }
}

/* =========================
   UPDATE (PATCH/POST)
========================= */

export async function POST(req: NextRequest, ctx: any) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }
    if (!isObj(body)) body = {};

    const id = pickId(req, ctx, body);
    if (!id) return err("Missing id", { status: 400, code: "missing_id" });

    const supabase = await sb();
    const user = await requireUser(supabase);

    const { data: cr, error: crErr } = await supabase
      .from(TABLE)
      .select("id, project_id, decision_status, delivery_status, status, impact_analysis, links")
      .eq("id", id)
      .maybeSingle();

    if (crErr)
      return err("Failed to fetch change request", { status: 500, extra: crErr, code: "fetch_failed" });
    if (!cr) return err("Not found", { status: 404, code: "not_found" });

    const projectId = String((cr as any).project_id ?? "");
    const decisionStatus = String((cr as any).decision_status ?? "draft").toLowerCase();
    const currentDelivery = normalizeDeliveryStatus((cr as any).delivery_status) || "intake";

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return err("Forbidden", { status: 403, code: "forbidden" });
    if (!canEdit(role)) return err("Forbidden", { status: 403, code: "forbidden" });

    if (containsDecisionOrGovernanceFields(body)) {
      return err("Governance enforced: use Submit/Approve/Reject routes for decision/status changes.", {
        status: 409,
        code: "governance_forbidden",
      });
    }

    if (decisionStatus === "submitted") {
      return err("This change is locked for approval and cannot be edited.", {
        status: 409,
        code: "locked",
      });
    }

    const update: Record<string, any> = {};

    if (typeof body.title === "string") update.title = clamp(body.title, 160);

    if (typeof body.summary === "string") update.description = clamp(body.summary, 1200);
    if (typeof body.description === "string") update.description = clamp(body.description, 1200);

    if (typeof body.proposed_change === "string") update.proposed_change = clamp(body.proposed_change, 8000);
    if (typeof body.proposedChange === "string") update.proposed_change = clamp(body.proposedChange, 8000);

    Object.assign(update, readNarrativeFields(body));

    if (hasAnyPlanKey(body)) {
      const plans = readPlanFields(body);
      if (
        hasOwn(body, "implementationPlan") ||
        hasOwn(body, "implementation_plan") ||
        hasOwn(body, "implementation")
      ) {
        update.implementation_plan = plans.implementation_plan;
      }
      if (hasOwn(body, "rollbackPlan") || hasOwn(body, "rollback_plan") || hasOwn(body, "rollback")) {
        update.rollback_plan = plans.rollback_plan;
      }
    }

    if (typeof body.requester_name === "string") update.requester_name = clamp(body.requester_name, 140);
    if (typeof body.assignee_id === "string") update.assignee_id = body.assignee_id;

    if (typeof body.assignee === "string" && body.assignee.trim()) {
      const baseLinks = isObj((cr as any).links) ? (cr as any).links : {};
      update.links = { ...baseLinks, assignee_name: clamp(body.assignee.trim(), 140) };
    }

    // âœ… Option B: review_by (date)
    {
      const rb = readReviewBy(body);
      if (rb.present) {
        const raw = hasOwn(body, "reviewBy") ? body.reviewBy : body.review_by;
        if (raw != null && rb.value == null) {
          return err("Invalid reviewBy/review_by (expected YYYY-MM-DD)", {
            status: 400,
            code: "invalid_review_by",
          });
        }
        update.review_by = rb.value; // string "YYYY-MM-DD" or null
      }
    }

    if (hasOwn(body, "delivery_status")) {
      const ds = normalizeDeliveryStatus(body.delivery_status);
      if (!ds) return err("Invalid delivery_status", { status: 400, code: "invalid_delivery_status" });

      const allowed = canMoveDelivery({ decision: decisionStatus, from: currentDelivery, to: ds });
      if (!allowed) {
        return err("Governance enforced: this lane move is not allowed.", {
          status: 409,
          code: "move_not_allowed",
        });
      }
      update.delivery_status = ds;
    }

    if (typeof body.priority === "string") update.priority = normalizePriorityToDb(body.priority);
    if (Array.isArray(body.tags)) update.tags = asTags(body.tags);

    const wantsImpact =
      body.impact_analysis !== undefined || body.impactAnalysis !== undefined || body.aiImpact !== undefined;

    const baseImpact = wantsImpact
      ? normalizeImpactAnalysis(body.impact_analysis ?? body.impactAnalysis ?? body.aiImpact)
      : isObj((cr as any).impact_analysis)
      ? (cr as any).impact_analysis
      : {};

    if (typeof body.risk === "string") {
      update.impact_analysis = { ...(isObj(baseImpact) ? baseImpact : {}), risk: body.risk };
    } else if (wantsImpact) {
      update.impact_analysis = baseImpact;
    }

    if (body.ai_schedule != null) update.ai_schedule = Number(body.ai_schedule) || 0;
    if (body.ai_cost != null) update.ai_cost = Number(body.ai_cost) || 0;
    if (body.ai_scope != null) update.ai_scope = Number(body.ai_scope) || 0;

    // IMPORTANT: the board often sends lane_sort alongside delivery_status.
    // Treat lane_sort as "move-only" so drag feels instant.
    if (body.lane_sort != null) {
      const n = Number(body.lane_sort);
      if (Number.isFinite(n)) update.lane_sort = n;
    }

    if (isObj(body.links)) {
      const baseLinks = isObj((cr as any).links) ? (cr as any).links : {};
      update.links = { ...baseLinks, ...body.links, ...(isObj(update.links) ? update.links : {}) };
    }

    if (Object.keys(update).length === 0) {
      return err("No valid fields supplied", { status: 400, code: "no_fields" });
    }

    update.updated_at = new Date().toISOString();

    // âœ… FAST PATH:
    // delivery_status + lane_sort (and updated_at) should NOT trigger AI recompute
    const keys = Object.keys(update);
    const FAST_MOVE_KEYS = new Set(["delivery_status", "lane_sort", "updated_at"]);
    const isMoveOnlyUpdate = keys.every((k) => FAST_MOVE_KEYS.has(k));

    const upd = await updateWithStripRetry(supabase, id, update);
    if (upd.error) return err("Update failed", { status: 500, extra: upd.error, code: "update_failed" });
    if (!upd.data) return err("Not found", { status: 404, code: "not_found" });

    const updatedRow = upd.data;

    await logChangeEvent(supabase, {
      projectId,
      changeRequestId: id,
      actorUserId: user.id,
      actorRole: role,
      eventType: "edited",
      note: isMoveOnlyUpdate ? "Lane moved" : "Change updated",
    });

    if (isMoveOnlyUpdate) {
      return ok({ item: updatedRow, data: updatedRow, role, id: (updatedRow as any)?.id ?? id });
    }

    // âœ… For substantive edits, recompute AI best-effort
    try {
      const computed = await computeChangeAIFields({ supabase, projectId, changeRow: updatedRow });

      const { data: up2, error: up2Err } = await supabase
        .from(TABLE)
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

      if (up2Err) throw up2Err;

      await emitAiEvent(req, {
        projectId,
        artifactId: id,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: { target_artifact_type: "change_request", change_id: id, action: "updated" },
      });

      return ok({ item: up2, data: up2, role, id: up2?.id ?? id });
    } catch {
      await emitAiEvent(req, {
        projectId,
        artifactId: id,
        eventType: "change_saved",
        severity: "info",
        source: "app",
        payload: { target_artifact_type: "change_request", change_id: id, action: "updated" },
      });

      return ok({ item: updatedRow, data: updatedRow, role, id: (updatedRow as any)?.id ?? id });
    }
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return err(msg, { status, code: status === 401 ? "unauthorized" : "server_error" });
  }
}

export async function PATCH(req: NextRequest, ctx: any) {
  return POST(req, ctx);
}

