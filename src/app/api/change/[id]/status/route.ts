// src/app/api/change/[id]/status/route.ts
import "server-only";

        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      
import { sb, requireUser, requireProjectRole, canEdit, safeStr, logChangeEvent } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

// status (governance) supports lanes + approved/rejected
function isValidCrStatus(s: string) {
  const v = String(s ?? "").trim().toLowerCase();
  return (
    v === "new" ||
    v === "analysis" ||
    v === "review" ||
    v === "in_progress" ||
    v === "implemented" ||
    v === "closed" ||
    v === "approved" ||
    v === "rejected" ||
    v === "submitted" ||
    v === "changes_requested"
  );
}

function canApprove(role: string) {
  const r = String(role ?? "").toLowerCase();
  return r === "approver" || r === "admin";
}

function hasMissingColumn(errMsg: string, col: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("column") && m.includes(col.toLowerCase());
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
    // swallow: must not block status update
  }
}

/**
 * PATCH /api/change/:id/status
 * Body: { status: string }
 *
 * NOTE: This is a generic status update. For approval workflow, use:
 * - POST /submit (submit for approval)
 * - POST /reject (reject)
 * - POST /request-changes (request changes)
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id?: string }> }) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const { id: rawId } = await ctx.params;
    const id = safeParam(rawId).trim();
    if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const body = await req.json().catch(() => ({}));
    const nextRaw = safeStr(body?.status).trim();
    const next = nextRaw.toLowerCase();

    if (!next || !isValidCrStatus(next)) {
      return NextResponse.json({ ok: false, error: "Invalid status" }, { status: 400 });
    }

    // load meta for RBAC + current status + decision_status (+ artifact_id when present)
    let meta: any = null;

    const metaRes1 = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id, status, decision_status, delivery_status")
      .eq("id", id)
      .maybeSingle();

    if (!metaRes1.error) {
      meta = metaRes1.data;
    } else if (hasMissingColumn(safeStr(metaRes1.error.message), "artifact_id")) {
      // fallback if artifact_id column doesn't exist yet
      const metaRes2 = await supabase
        .from("change_requests")
        .select("id, project_id, status, decision_status, delivery_status")
        .eq("id", id)
        .maybeSingle();

      if (metaRes2.error) throw metaRes2.error;
      meta = metaRes2.data;
    } else {
      throw metaRes1.error;
    }

    if (!meta) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const projectId = safeStr(meta.project_id).trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const artifactId = safeStr(meta.artifact_id).trim(); // may be "" if column missing or null
    const currentStatus = String(meta.status ?? "").toLowerCase();
    const currentDecision = String(meta.decision_status ?? "").toLowerCase();
    const currentLane = String(meta.delivery_status ?? "").toLowerCase();

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!canEdit(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // Locked items can only be moved via approve/reject/request-changes endpoints
    if (currentDecision === "submitted" && !canApprove(role)) {
      return NextResponse.json(
        {
          ok: false,
          error: "This change is locked in Review awaiting decision. Use approve/reject endpoints.",
        },
        { status: 409 }
      );
    }

    if ((next === "approved" || next === "rejected") && !canApprove(role)) {
      return NextResponse.json({ ok: false, error: "Approver role required" }, { status: 403 });
    }

    const now = new Date().toISOString();

    const patch: any = {
      status: next,
      updated_at: now,
    };

    // Sync decision_status with status for consistency
    if (next === "approved") {
      patch.decision_status = "approved";
      patch.approval_date = now;
      patch.approver_id = user.id;
      patch.decision_by = user.id;
      patch.decision_at = now;
      patch.decision_role = safeStr(role);
      patch.delivery_status = "in_progress";
    } else if (next === "rejected") {
      patch.decision_status = "rejected";
      patch.decision_by = user.id;
      patch.decision_at = now;
      patch.decision_role = safeStr(role);
      patch.delivery_status = "analysis";
    } else if (next === "submitted") {
      return NextResponse.json(
        { ok: false, error: "Use POST /api/change/:id/submit to submit for approval" },
        { status: 400 }
      );
    } else if (next === "changes_requested") {
      return NextResponse.json(
        { ok: false, error: "Use POST /api/change/:id/request-changes to request changes" },
        { status: 400 }
      );
    } else {
      // For other status changes (new, analysis, in_progress, implemented, closed)
      if (currentDecision && currentDecision !== "null") {
        if (currentDecision !== "approved" && currentDecision !== "rejected") {
          patch.decision_status = null;
        }
      }

      // Sync delivery_status with status for lane moves (except review)
      if (next !== "review") {
        patch.delivery_status = next;
      }
    }

    const upd = await supabase.from("change_requests").update(patch).eq("id", id).select("*").single();
    if (upd.error) throw upd.error;

    // âœ… Audit log (best effort) â€” only if we have an artifactId value
    // This avoids the NOT NULL constraint error.
    try {
      if (artifactId) {
        await logChangeEvent(supabase, {
          projectId,
          artifactId,
          changeRequestId: id,
          actorUserId: user.id,
          actorRole: role,
          eventType: "status_changed",
          fromValue: currentLane || currentStatus || null,
          toValue: next,
          note: null,
          payload: { from_status: currentStatus, to_status: next, from_lane: currentLane || null },
        } as any);
      }
    } catch {
      // swallow
    }

    // âœ… Timeline event (best effort)
    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: id,
      event_type: "status_changed",
      from_status: currentLane || currentStatus || null,
      to_status: next,
      actor_user_id: user.id,
      actor_role: safeStr(role),
      comment: null,
      payload: { source: "status_route", from_status: currentStatus, to_status: next },
    });

    return NextResponse.json({ ok: true, item: upd.data });
  } catch (e: any) {
    console.error("[PATCH /api/change/:id/status]", e);
    const msg = safeStr(e?.message) || "Unexpected error";
    const status = msg === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

