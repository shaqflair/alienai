// src/app/api/approvals/decision/route.ts
// FULL FILE -- adds budget uplift when a CR is fully approved
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

type Body = {
  approval_task_id?: string;
  decision?: "approve" | "reject" | string;
  comment?: string | null;
};

type DecisionStatus =
  | "draft" | "analysis" | "review" | "submitted"
  | "approved" | "rejected" | "rework";

async function bestEffortEvent(
  supabase: any,
  row: any,
  userId: string,
  newStatus: string,
  comment: string
) {
  const projectId = safeStr(row?.project_id).trim();
  const changeId  = safeStr(row?.change_id).trim();

  try {
    if (projectId && changeId) {
      await supabase.from("change_events").insert({
        project_id:    projectId,
        change_id:     changeId,
        event_type:    "status_changed",
        from_status:   "pending",
        to_status:     newStatus,
        actor_user_id: userId,
        actor_role:    safeStr(row?.approval_role) || null,
        comment:       comment || null,
        payload:       { approval_id: safeStr(row?.id) },
      });
    }
  } catch {}

  try {
    if (projectId && changeId) {
      await supabase.from("change_request_events").insert({
        project_id:        projectId,
        change_request_id: changeId,
        actor_user_id:     userId,
        event_type:        "approval_decision",
        from_value:        "pending",
        to_value:          newStatus,
        note:              comment || null,
      });
    }
  } catch {}
}

async function requireOrgMemberForProject(supabase: any, projectId: string, userId: string) {
  if (!projectId) return;
  const { data: proj, error: pErr } = await supabase
    .from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
  if (pErr) throw new Error(pErr.message);
  const orgId = safeStr((proj as any)?.organisation_id).trim();
  if (!orgId) return;
  const { data: mem, error: mErr } = await supabase
    .from("organisation_members")
    .select("user_id").eq("organisation_id", orgId).eq("user_id", userId).maybeSingle();
  if (mErr) throw new Error(mErr.message);
  if (!mem) throw new Error("Forbidden");
}

/* -- Budget uplift ---------------------------------------------------------
   When a CR is fully approved:
   1. Read budget_impact from change_requests.impact_analysis.budget_impact
   2. Find the project's current financial plan artifact
   3. Add budget_impact to total_approved_budget
   4. Flip matching change_exposure entry to "approved"
   5. Save artifact content_json + sync projects.budget_amount
   This is best-effort -- never fails the approval response.
---------------------------------------------------------------------------- */
async function tryBudgetUplift(
  supabase: any,
  changeId: string,
  projectId: string,
  userId: string
) {
  try {
    // 1. Get the CR to read budget_impact and public_id
    const { data: cr } = await supabase
      .from("change_requests")
      .select("id, public_id, title, impact_analysis, budget_impact")
      .eq("id", changeId)
      .maybeSingle();

    if (!cr) return;

    // budget_impact: check dedicated column first, then impact_analysis.budget_impact
    const rawImpact =
      cr?.budget_impact ??
      cr?.impact_analysis?.budget_impact ??
      cr?.impact_analysis?.cost_impact ??
      cr?.impact_analysis?.financial_impact ??
      null;

    const budgetImpact = Number(rawImpact);
    // Only uplift if there is a non-zero financial impact
    const hasImpact = Number.isFinite(budgetImpact) && budgetImpact !== 0;

    // 2. Find the current financial plan artifact for this project
    const { data: artifact } = await supabase
      .from("artifacts")
      .select("id, content_json, approval_status")
      .eq("project_id", projectId)
      .eq("type", "financial_plan")
      .eq("is_current", true)
      .maybeSingle();

    if (!artifact) return;

    const content = artifact.content_json as Record<string, any>;
    if (!content || typeof content !== "object") return;

    // 3. Build the updated content
    let updated = false;
    const updatedContent = { ...content };

    if (hasImpact) {
      const currentBudget = Number(updatedContent.total_approved_budget) || 0;
      updatedContent.total_approved_budget = currentBudget + budgetImpact;
      updated = true;
    }

    // 4. Flip matching change_exposure entry to approved (match by change_ref or title)
    const crRef   = safeStr(cr?.public_id || cr?.id).trim();
    const crTitle = safeStr(cr?.title).trim();
    const exposures: any[] = Array.isArray(updatedContent.change_exposure)
      ? updatedContent.change_exposure : [];

    const updatedExposures = exposures.map((e: any) => {
      const refMatch   = crRef   && safeStr(e?.change_ref).trim() === crRef;
      const titleMatch = crTitle && safeStr(e?.title).trim().toLowerCase() === crTitle.toLowerCase();
      if ((refMatch || titleMatch) && e?.status === "pending") {
        updated = true;
        return { ...e, status: "approved" };
      }
      return e;
    });

    // If no matching exposure found but there is a budget impact, add one automatically
    if (hasImpact && !updatedExposures.some((e: any) =>
      safeStr(e?.change_ref).trim() === crRef || safeStr(e?.title).trim().toLowerCase() === crTitle.toLowerCase()
    )) {
      updatedExposures.push({
        id:          Math.random().toString(36).slice(2, 10),
        change_ref:  crRef,
        title:       crTitle || "Change Request",
        cost_impact: budgetImpact,
        status:      "approved",
        notes:       "Auto-added on CR approval",
      });
      updated = true;
    }

    if (!updated) return;

    updatedContent.change_exposure  = updatedExposures;
    updatedContent.last_updated_at  = new Date().toISOString();

    // 5. Save artifact
    const { error: saveErr } = await supabase
      .from("artifacts")
      .update({ content_json: updatedContent, updated_at: new Date().toISOString() })
      .eq("id", artifact.id);

    if (saveErr) { console.warn("[budget-uplift] artifact save error:", saveErr.message); return; }

    // 6. Sync projects.budget_amount to the new approved budget
    if (hasImpact) {
      const newBudget = Number(updatedContent.total_approved_budget);
      if (Number.isFinite(newBudget) && newBudget > 0) {
        await supabase.from("projects")
          .update({ budget_amount: newBudget })
          .eq("id", projectId)
          .catch(() => {});
      }
    }

    console.log("[budget-uplift] applied to project", projectId,
      "impact:", budgetImpact, "new budget:", updatedContent.total_approved_budget);

  } catch (e: any) {
    // Never throw -- this is best-effort
    console.warn("[budget-uplift] failed:", e?.message);
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message || "Auth error", 401);
    const user = auth?.user;
    if (!user) return jsonErr("Not authenticated", 401);

    const body = (await req.json().catch(() => null)) as Body | null;

    const approval_task_id = safeStr(body?.approval_task_id).trim();
    const decisionRaw      = safeStr(body?.decision).trim().toLowerCase();
    const comment          = safeStr(body?.comment).trim();

    if (!isUuid(approval_task_id)) return jsonErr("Invalid approval_task_id", 400);
    if (decisionRaw !== "approve" && decisionRaw !== "reject")
      return jsonErr("Invalid decision", 400);

    const decidedAt = new Date().toISOString();
    const newStatus = decisionRaw === "approve" ? "approved" : "rejected";

    // 1) Update the approval row
    const { data: updated, error: upErr } = await supabase
      .from("change_approvals")
      .update({
        status:           newStatus,
        decided_at:       decidedAt,
        decided_by:       user.id,
        decision_comment: comment || null,
      })
      .eq("id", approval_task_id)
      .eq("approver_user_id", user.id)
      .eq("status", "pending")
      .select("id, change_id, project_id, approver_user_id, approval_role, status, decided_at")
      .maybeSingle();

    if (upErr) return jsonErr(upErr.message || "Decision failed", 400);
    if (!updated) return jsonErr("Approval not found or already decided", 404);

    const changeId  = safeStr((updated as any).change_id).trim();
    const projectId = safeStr((updated as any).project_id).trim();

    try {
      await requireOrgMemberForProject(supabase, projectId, user.id);
    } catch (e: any) {
      const msg = String(e?.message || e || "Forbidden");
      if (msg.toLowerCase().includes("forbidden")) return jsonErr("Forbidden", 403);
      return jsonErr(msg, 400);
    }

    await bestEffortEvent(supabase, updated, user.id, newStatus, comment);

    if (!changeId) return jsonOk({ updated, decision: newStatus, aggregateUpdated: false });

    // 2) Recompute overall approval state
    const { data: approvals, error: aErr } = await supabase
      .from("change_approvals")
      .select("status")
      .eq("change_id", changeId);

    if (aErr) return jsonOk({ updated, decision: newStatus, aggregateUpdated: false });

    const statuses    = (approvals ?? []).map((r: any) => safeStr(r?.status).toLowerCase());
    const anyRejected = statuses.includes("rejected");
    const anyPending  = statuses.includes("pending");
    const anyApproved = statuses.includes("approved");

    let desiredDecision: DecisionStatus | null = null;
    if (anyRejected)                      desiredDecision = "rejected";
    else if (!anyPending && anyApproved)  desiredDecision = "approved";
    else                                  desiredDecision = "review";

    // 3) Apply aggregate to change_requests
    let aggregateUpdated = false;

    if (desiredDecision) {
      const patch: any = {
        decision_status: desiredDecision,
        decision_by:     user.id,
        decision_at:     decidedAt,
        decision_role:   safeStr((updated as any)?.approval_role) || null,
        updated_at:      decidedAt,
      };

      if (desiredDecision === "approved") {
        patch.delivery_status = "in_progress";
        patch.status          = "in_progress";
        patch.approval_date   = decidedAt;
        patch.approver_id     = user.id;
      }
      if (desiredDecision === "rejected") {
        patch.delivery_status = "analysis";
        patch.status          = "analysis";
        if (comment) patch.decision_rationale = comment;
      }

      const { error: crErr } = await supabase
        .from("change_requests").update(patch).eq("id", changeId);
      if (!crErr) aggregateUpdated = true;

      // Timeline event for final outcome
      try {
        if (aggregateUpdated && projectId && changeId &&
          (desiredDecision === "approved" || desiredDecision === "rejected")) {
          await supabase.from("change_events").insert({
            project_id:    projectId,
            change_id:     changeId,
            event_type:    "status_changed",
            from_status:   "review",
            to_status:     desiredDecision === "approved" ? "in_progress" : "analysis",
            actor_user_id: user.id,
            actor_role:    safeStr((updated as any)?.approval_role) || null,
            comment:       desiredDecision === "rejected" ? (comment || "Rejected") : null,
            payload:       { aggregate: true, decision_status: desiredDecision },
          });
        }
      } catch {}

      // 4) Budget uplift -- runs when CR is fully approved
      if (desiredDecision === "approved" && changeId && projectId) {
        await tryBudgetUplift(supabase, changeId, projectId, user.id);
      }
    }

    return jsonOk({ updated, decision: newStatus, aggregateUpdated, aggregate: desiredDecision });

  } catch (e: any) {
    const status = typeof e?.status === "number" ? e.status : 500;
    return jsonErr(e?.message || "Server error", status);
  }
}