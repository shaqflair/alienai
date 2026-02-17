import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import {
  sb,
  requireUser,
  requireProjectRole,
  requireApproverForProject,
  safeStr,
  logChangeEvent,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

function isDecision(x: string) {
  const v = String(x || "").trim().toLowerCase();
  return v === "approved" || v === "rejected" || v === "rework";
}

function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const changeId = safeStr(id).trim();
    if (!changeId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const decision = safeStr(body?.decision).trim().toLowerCase(); // approved | rejected | rework
    const rationale = safeStr(body?.rationale).trim();

    if (!isDecision(decision)) {
      return NextResponse.json(
        { ok: false, error: "decision must be 'approved', 'rejected', or 'rework'" },
        { status: 400 }
      );
    }
    if (!rationale) {
      return NextResponse.json({ ok: false, error: "rationale is required" }, { status: 400 });
    }

    const supabase = await sb();
    const user = await requireUser(supabase);

    // Load CR (+ artifact_id if your audit needs it)
    const { data: row, error: readErr } = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id, delivery_status, decision_status, status")
      .eq("id", changeId)
      .maybeSingle();

    if (readErr) throw new Error(readErr.message);
    if (!row) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const projectId = safeStr((row as any).project_id).trim();
    const artifactId = safeStr((row as any).artifact_id).trim(); // may be blank
    const lane = safeStr((row as any).delivery_status).trim().toLowerCase();
    const currentDecision = safeStr((row as any).decision_status).trim().toLowerCase();

    if (!projectId) return NextResponse.json({ ok: false, error: "Missing project_id" }, { status: 500 });

    // Must be a project member at all
    const memberRole = await requireProjectRole(supabase, projectId, user.id);
    if (!memberRole) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // âœ… Approver group only
    const approverRole = await requireApproverForProject(supabase, projectId, user.id);
    if (!approverRole) {
      return NextResponse.json({ ok: false, error: "Forbidden: approval group only" }, { status: 403 });
    }

    // âœ… Gate: decide only in Review
    if (lane !== "review") {
      return NextResponse.json(
        { ok: false, error: "Only items in 'review' can be approved/rejected/reworked" },
        { status: 409 }
      );
    }

    // âœ… Must be submitted
    if (currentDecision !== "submitted") {
      if (currentDecision === "approved" || currentDecision === "rejected" || currentDecision === "rework") {
        return NextResponse.json({ ok: false, error: "Decision already recorded" }, { status: 409 });
      }
      return NextResponse.json({ ok: false, error: "This item has not been submitted for approval" }, { status: 409 });
    }

    const now = new Date().toISOString();

    const patch: any = {
      decision_status: decision,
      decision_rationale: rationale.slice(0, 5000),
      decision_by: user.id,
      decision_at: now,
      decision_role: approverRole,
      updated_at: now,
    };

    // âœ… Governance lane + lifecycle
    if (decision === "approved") {
      patch.delivery_status = "in_progress";
      patch.status = "in_progress";
    } else if (decision === "rejected") {
      patch.delivery_status = "analysis";
      patch.status = "rejected";
    } else {
      patch.delivery_status = "analysis";
      patch.status = "analysis";
    }

    const { data: updated, error: updErr } = await supabase
      .from("change_requests")
      .update(patch)
      .eq("id", changeId)
      .select(
        `
        id,
        project_id,
        artifact_id,
        delivery_status,
        status,
        decision_status,
        decision_rationale,
        decision_by,
        decision_at,
        decision_role
      `
      )
      .maybeSingle();

    if (updErr) throw new Error(updErr.message);

    // Audit (best effort â€” donâ€™t let audit kill the decision)
    try {
      await logChangeEvent(
        supabase,
        {
          projectId,
          ...(artifactId ? { artifactId } : {}),
          changeRequestId: changeId,
          actorUserId: user.id,
          actorRole: approverRole,
          eventType: decision,
          fromValue: "submitted",
          toValue: decision,
          note: rationale.slice(0, 1200),
          payload: {
            delivery_status_before: lane,
            delivery_status_after: (updated as any)?.delivery_status ?? null,
            decision_status: decision,
          },
        } as any
      );
    } catch {
      // swallow
    }

    // Timeline (best effort)
    try {
      const ins = await supabase.from("change_events").insert({
        project_id: projectId,
        change_id: changeId,
        event_type: "status_changed",
        from_status: "review",
        to_status: safeStr((updated as any)?.delivery_status).trim().toLowerCase() || null,
        actor_user_id: user.id,
        actor_role: safeStr(approverRole),
        comment: rationale.slice(0, 2000) || null,
        payload: { source: "decision_route", decision },
      });

      if ((ins as any)?.error && !isMissingRelation(safeStr((ins as any).error.message))) {
        // swallow
      }
    } catch {
      // swallow
    }

    return NextResponse.json({ ok: true, item: updated });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Server error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

