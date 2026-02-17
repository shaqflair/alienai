import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

type Body = {
  approval_task_id?: string; // change_approvals.id
  decision?: "approve" | "reject" | string;
  comment?: string | null;
};

type DecisionStatus = "draft" | "analysis" | "review" | "submitted" | "approved" | "rejected" | "rework";

async function bestEffortEvent(supabase: any, row: any, userId: string, newStatus: string, comment: string) {
  const projectId = safeStr(row?.project_id);
  const changeId = safeStr(row?.change_id);

  // change_events
  try {
    if (projectId && changeId) {
      await supabase.from("change_events").insert({
        project_id: projectId,
        change_id: changeId,
        event_type: "status_changed",
        from_status: "pending",
        to_status: newStatus,
        actor_user_id: userId,
        actor_role: safeStr(row?.approval_role) || null,
        comment: comment || null,
        payload: { approval_id: safeStr(row?.id) },
      });
    }
  } catch {
    // swallow
  }

  // change_request_events
  try {
    if (projectId && changeId) {
      await supabase.from("change_request_events").insert({
        project_id: projectId,
        change_request_id: changeId,
        actor_user_id: userId,
        event_type: "approval_decision",
        from_value: "pending",
        to_value: newStatus,
        note: comment || null,
      });
    }
  } catch {
    // swallow
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message || "Auth error", 401);

    const user = auth?.user;
    if (!user) return jsonErr("Not authenticated", 401);

    const body = (await req.json().catch(() => null)) as Body | null;

    const approval_task_id = safeStr(body?.approval_task_id).trim();
    const decisionRaw = safeStr(body?.decision).trim().toLowerCase();
    const comment = safeStr(body?.comment).trim();

    if (!isUuid(approval_task_id)) return jsonErr("Invalid approval_task_id", 400);
    if (decisionRaw !== "approve" && decisionRaw !== "reject") return jsonErr("Invalid decision", 400);

    const decidedAt = new Date().toISOString();
    const newStatus = decisionRaw === "approve" ? "approved" : "rejected";

    // 1) Update the approval row (only if this user owns it + still pending)
    const { data: updated, error: upErr } = await supabase
      .from("change_approvals")
      .update({
        status: newStatus,
        decided_at: decidedAt,
        decided_by: user.id,
        decision_comment: comment || null,
      })
      .eq("id", approval_task_id)
      .eq("approver_user_id", user.id)
      .eq("status", "pending")
      .select("id, change_id, project_id, approver_user_id, approval_role, status, decided_at")
      .maybeSingle();

    if (upErr) return jsonErr(upErr.message || "Decision failed", 400);
    if (!updated) return jsonErr("Approval not found or already decided", 404);

    // audit (best effort)
    await bestEffortEvent(supabase, updated, user.id, newStatus, comment);

    const changeId = safeStr((updated as any).change_id).trim();
    const projectId = safeStr((updated as any).project_id).trim();

    // 2) Recompute overall approval state for the change
    //    - any rejected => rejected
    //    - none pending and at least 1 approved => approved
    //    - else => still in review/submitted
    const { data: approvals, error: aErr } = await supabase
      .from("change_approvals")
      .select("status")
      .eq("change_id", changeId);

    if (aErr) {
      // Even if this fails, the decision itself succeeded.
      return jsonOk({ updated, decision: newStatus, aggregateUpdated: false });
    }

    const statuses = (approvals ?? []).map((r: any) => safeStr(r?.status).toLowerCase());
    const anyRejected = statuses.includes("rejected");
    const anyPending = statuses.includes("pending");
    const anyApproved = statuses.includes("approved");

    let desiredDecision: DecisionStatus | null = null;
    let desiredLane: string | null = null;

    if (anyRejected) {
      desiredDecision = "rejected";
      desiredLane = "analysis"; // bounce back for rework
    } else if (!anyPending && anyApproved) {
      desiredDecision = "approved";
      desiredLane = "in_progress"; // auto-move as per your PATCH approve action
    } else {
      // still waiting on others
      desiredDecision = "review";
      desiredLane = null; // keep whatever lane is currently on the change (usually review)
    }

    // 3) Apply aggregate result to change_requests (best effort, but usually should succeed)
    let aggregateUpdated = false;

    if (desiredDecision) {
      const patch: any = {
        decision_status: desiredDecision,
        decision_by: user.id,
        decision_at: decidedAt,
        decision_role: safeStr((updated as any)?.approval_role) || null,
        updated_at: decidedAt,
      };

      // Only force lane when final
      if (desiredDecision === "approved") {
        patch.delivery_status = "in_progress";
        patch.status = "in_progress";
        patch.approval_date = decidedAt;
        patch.approver_id = user.id;
      }
      if (desiredDecision === "rejected") {
        patch.delivery_status = "analysis";
        patch.status = "analysis";
        if (comment) patch.decision_rationale = comment;
      }

      const { error: crErr } = await supabase.from("change_requests").update(patch).eq("id", changeId);

      if (!crErr) aggregateUpdated = true;

      // timeline event for the change outcome (best effort)
      try {
        if (aggregateUpdated && projectId && changeId && (desiredDecision === "approved" || desiredDecision === "rejected")) {
          await supabase.from("change_events").insert({
            project_id: projectId,
            change_id: changeId,
            event_type: "status_changed",
            from_status: desiredDecision === "approved" ? "review" : "review",
            to_status: desiredDecision === "approved" ? "in_progress" : "analysis",
            actor_user_id: user.id,
            actor_role: safeStr((updated as any)?.approval_role) || null,
            comment: desiredDecision === "rejected" ? (comment || "Rejected") : null,
            payload: { aggregate: true, decision_status: desiredDecision },
          });
        }
      } catch {
        // swallow
      }
    }

    // 4) Return
    return jsonOk({
      decision: newStatus,
      updated,
      aggregate: {
        change_id: changeId,
        anyPending,
        anyRejected,
        anyApproved,
        decision_status: desiredDecision,
        aggregateUpdated,
      },
    });
  } catch (e: any) {
    return jsonErr(e?.message || "Decision failed", 500);
  }
}


