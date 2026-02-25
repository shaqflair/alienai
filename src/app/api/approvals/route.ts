// Serves GET /api/approvals?limit=N
// Used by HomePage to load live pending approvals for the inline Approve/Reject panel.
//
// Response shape:
//   { ok: true, items: ApprovalItem[], count: number, meta: {...} }
//
// Each item has `approval_task_id` = change_approvals.id  (required by POST /api/approvals/decision)
//
// Scope: org-wide (all projects the user's org owns), filtered to pending/open only.
// Falls back gracefully through: change_approvals → artifact_approval_steps → empty

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function noStore(res: NextResponse) {
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function ok(data: any, status = 200) {
  return noStore(NextResponse.json({ ok: true, ...data }, { status }));
}

function err(message: string, status = 400, meta?: any) {
  return noStore(NextResponse.json({ ok: false, error: message, ...(meta ? { meta } : {}) }, { status }));
}

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampInt(x: string | null, def: number, min: number, max: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

function looksMissingRelation(e: any) {
  const msg = String(e?.message || e || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("relation") || msg.includes("42p01");
}

/* ---------------- org resolution ---------------- */

async function resolveOrgId(supabase: any, userId: string): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", userId)
      .is("removed_at", null)
      .order("created_at", { ascending: true })
      .limit(5);

    if (error) return null;
    const row = (Array.isArray(data) ? data : [])[0];
    return safeStr(row?.organisation_id).trim() || null;
  } catch {
    return null;
  }
}

/* ---------------- project IDs for org ---------------- */

async function getOrgProjectIds(supabase: any, orgId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("organisation_id", orgId)
    .is("deleted_at", null)
    .limit(5000);

  if (error || !data) return [];
  return (data as any[]).map((r) => safeStr(r?.id).trim()).filter(Boolean);
}

/* ---------------- primary: change_approvals ---------------- */

async function fetchChangeApprovals(supabase: any, projectIds: string[], limit: number) {
  try {
    const { data, error } = await supabase
      .from("change_approvals")
      .select(`
        id,
        change_id,
        project_id,
        approver_user_id,
        approval_role,
        status,
        created_at,
        decided_at,
        change_requests:change_id (
          id,
          title,
          priority,
          delivery_status,
          decision_status
        )
      `)
      .in("project_id", projectIds)
      .eq("status", "pending")
      .is("decided_at", null)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      if (looksMissingRelation(error)) return { ok: false, source: "change_approvals_missing", items: [] };
      return { ok: false, source: "change_approvals_error", items: [] };
    }

    const items = (data || []).map((r: any) => {
      const cr = r?.change_requests ?? null;
      return {
        // approval_task_id is what POST /api/approvals/decision expects
        approval_task_id: safeStr(r?.id).trim(),
        change_id: safeStr(r?.change_id).trim() || null,
        project_id: safeStr(r?.project_id).trim() || null,
        approver_user_id: safeStr(r?.approver_user_id).trim() || null,
        approval_role: safeStr(r?.approval_role).trim() || null,
        status: safeStr(r?.status).trim() || "pending",
        created_at: r?.created_at ?? null,
        // enriched from joined change_request
        title: cr ? safeStr(cr?.title).trim() || "Change Request" : "Change Request",
        priority: cr ? safeStr(cr?.priority).trim() || null : null,
        delivery_status: cr ? safeStr(cr?.delivery_status).trim() || null : null,
        decision_status: cr ? safeStr(cr?.decision_status).trim() || null : null,
        // type tag for UI rendering
        source_type: "change_approval" as const,
      };
    });

    return { ok: true, source: "change_approvals", items };
  } catch (e: any) {
    return { ok: false, source: "change_approvals_threw", items: [] };
  }
}

/* ---------------- fallback: artifact_approval_steps ---------------- */

async function fetchArtifactApprovals(supabase: any, projectIds: string[], limit: number) {
  try {
    const { data, error } = await supabase
      .from("artifact_approval_steps")
      .select(`
        id,
        artifact_id,
        step_order,
        name,
        step_status,
        approver_type,
        approver_ref,
        due_at,
        created_at,
        artifacts:artifact_id (
          id,
          title,
          artifact_type,
          project_id
        )
      `)
      .eq("step_status", "pending")
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) {
      if (looksMissingRelation(error)) return { ok: false, source: "artifact_steps_missing", items: [] };
      return { ok: false, source: "artifact_steps_error", items: [] };
    }

    // Filter to org's project scope (the join doesn't support .in on nested table)
    const projectIdSet = new Set(projectIds);

    const items = (data || [])
      .filter((r: any) => {
        const pid = safeStr(r?.artifacts?.project_id).trim();
        return pid && projectIdSet.has(pid);
      })
      .map((r: any) => {
        const art = r?.artifacts ?? null;
        return {
          // approval_task_id maps to artifact_approval_steps.id
          approval_task_id: safeStr(r?.id).trim(),
          change_id: null,
          project_id: art ? safeStr(art?.project_id).trim() || null : null,
          approver_user_id: null,
          approval_role: safeStr(r?.approver_type).trim() || null,
          status: "pending",
          created_at: r?.created_at ?? null,
          title: art ? safeStr(art?.title).trim() || "Artifact" : "Artifact",
          priority: null,
          delivery_status: null,
          decision_status: null,
          source_type: "artifact_step" as const,
          // extra fields the UI may use
          step_name: safeStr(r?.name).trim() || null,
          due_at: r?.due_at ?? null,
          artifact_type: art ? safeStr(art?.artifact_type).trim() || null : null,
        };
      });

    return { ok: true, source: "artifact_approval_steps", items };
  } catch {
    return { ok: false, source: "artifact_steps_threw", items: [] };
  }
}

/* ---------------- GET handler ---------------- */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return err("Not authenticated", 401);

    const url = new URL(req.url);
    const limit = clampInt(url.searchParams.get("limit"), 20, 1, 200);

    const orgId = await resolveOrgId(supabase, auth.user.id);
    if (!orgId) return ok({ items: [], count: 0, meta: { scope: "no_org" } });

    const projectIds = await getOrgProjectIds(supabase, orgId);
    if (!projectIds.length) return ok({ items: [], count: 0, meta: { scope: "no_projects", orgId } });

    // Try primary source first
    const primary = await fetchChangeApprovals(supabase, projectIds, limit);

    if (primary.ok && primary.items.length > 0) {
      return ok({
        items: primary.items,
        count: primary.items.length,
        meta: { source: primary.source, orgId, projectCount: projectIds.length },
      });
    }

    // Fallback: artifact approval steps
    const fallback = await fetchArtifactApprovals(supabase, projectIds, limit);

    return ok({
      items: fallback.items,
      count: fallback.items.length,
      meta: {
        source: fallback.source,
        primary_source: primary.source,
        primary_ok: primary.ok,
        orgId,
        projectCount: projectIds.length,
      },
    });

  } catch (e: any) {
    console.error("[GET /api/approvals]", e);
    return err(String(e?.message || e || "Approvals fetch failed"), 500);
  }
}
