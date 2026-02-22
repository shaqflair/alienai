// src/lib/change/server-helpers.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

/* =========================================================
   Types
========================================================= */

export type ProjectRole = "owner" | "editor" | "viewer";

export type ArtifactApprovalDecision = "approved" | "rejected";

type DesignatedApproverCheck = {
  ok: boolean;
  via?: "org_approver" | "doa_rule";
  ruleId?: string | null;
  reason?: string;
};

export type PendingStepInfo = {
  chainId: string;
  artifactId: string;
  projectId: string;
  artifactType: string;

  stepId: string; // artifact_approval_steps.id
  stepOrder: number;
  stepName: string;
  mode: string;
  minApprovals: number;
  maxRejections: number;
};

/* =========================================================
   Utilities
========================================================= */

export function safeStr(x: unknown) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

export function jsonError(message: string, status = 400) {
  return Response.json({ ok: false, error: message }, { status });
}

function hasMissingColumn(errMsg: string, col: string) {
  const m = safeStr(errMsg).toLowerCase();
  const c = safeStr(col).toLowerCase();
  return m.includes("column") && m.includes(c);
}

function isMissingRelation(errMsg: string) {
  const m = safeStr(errMsg).toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
}

function looksLikeUuid(x: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function clampText(x: unknown, max: number) {
  const s = safeStr(x);
  return s.length > max ? s.slice(0, max) : s;
}

/* =========================================================
   Auth / Membership
========================================================= */

export async function requireUser(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

export async function requireProjectRole(
  supabase: any,
  projectId: string,
  userId: string
): Promise<ProjectRole | null> {
  const pid = safeStr(projectId);
  const uid = safeStr(userId);
  if (!pid || !uid) return null;

  const { data: mem, error } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", pid)
    .eq("user_id", uid)
    .eq("is_active", true)
    .maybeSingle();

  // If this table is missing in some env, fail closed (no access)
  if (error) {
    if (isMissingRelation(safeStr(error.message))) return null;
    throw new Error(error.message);
  }
  if (!mem) return null;

  const role = safeStr((mem as any).role).toLowerCase();
  if (role !== "owner" && role !== "editor" && role !== "viewer") return null;

  return role as ProjectRole;
}

export function canEdit(role: ProjectRole) {
  return role === "owner" || role === "editor";
}

export function isOwner(role: ProjectRole) {
  return role === "owner";
}

/* =========================================================
   Designated Approvers (LEGACY / DIRECTORY)
   - Keep only if you still use organisation_approvers/doa_rules
========================================================= */

async function getOrganisationIdForProject(
  supabase: any,
  projectId: string
): Promise<string | null> {
  const pid = safeStr(projectId);
  if (!pid) return null;

  // Try organisation_id then organization_id (support both spellings)
  const first = await supabase.from("projects").select("organisation_id").eq("id", pid).maybeSingle();
  if (!first.error) {
    const orgId = (first.data as any)?.organisation_id;
    return orgId ? String(orgId) : null;
  }

  if (!hasMissingColumn(safeStr(first.error?.message), "organisation_id")) return null;

  const second = await supabase.from("projects").select("organization_id").eq("id", pid).maybeSingle();
  if (second.error) return null;
  const orgId = (second.data as any)?.organization_id;
  return orgId ? String(orgId) : null;
}

function amountMatchesRule(amount: number | null, rule: any): boolean {
  if (amount == null) return true;

  const min = Number(rule?.min_amount ?? 0);
  const maxRaw = rule?.max_amount;
  const max = maxRaw == null ? null : Number(maxRaw);

  if (!Number.isFinite(min)) return false;
  if (amount < min) return false;
  if (max != null && Number.isFinite(max) && amount > max) return false;
  return true;
}

/**
 * LEGACY helper — safe to keep if you still have doa_rules in some envs.
 * New approval engine does not depend on this.
 */
export async function isDesignatedApproverForChange(args: {
  supabase: any;
  user: { id: string; email?: string | null };
  projectId: string;
  amount?: number | null;
}): Promise<DesignatedApproverCheck> {
  const supabase = args.supabase;
  const userId = safeStr(args.user?.id);
  const email = safeStr(args.user?.email || "").toLowerCase() || null;
  const projectId = safeStr(args.projectId);
  const amount =
    args.amount == null ? null : Number.isFinite(Number(args.amount)) ? Number(args.amount) : null;

  if (!userId || !projectId) return { ok: false, reason: "missing_user_or_project" };

  // 1) DOA rules (project-specific) — optional
  try {
    const { data: doa, error: doaErr } = await supabase
      .from("doa_rules")
      .select("id, min_amount, max_amount, approver_user_id, removed_at")
      .eq("project_id", projectId)
      .eq("approver_user_id", userId)
      .is("removed_at", null);

    if (doaErr && !isMissingRelation(safeStr(doaErr.message))) throw doaErr;

    const rules = Array.isArray(doa) ? doa : [];
    const hit = rules.find((r) => amountMatchesRule(amount, r));
    if (hit) return { ok: true, via: "doa_rule", ruleId: safeStr(hit.id) || null };
  } catch {
    // swallow -> continue to org directory
  }

  // 2) Organisation approvers (org-level directory)
  const orgId = await getOrganisationIdForProject(supabase, projectId);
  if (!orgId) return { ok: false, reason: "missing_org" };

  try {
    const orParts = [`user_id.eq.${userId}`];
    if (email) {
      orParts.push(`approver_email.ilike.${email}`);
      orParts.push(`email.ilike.${email}`);
    }

    const { data: orgRow, error: orgErr } = await supabase
      .from("organisation_approvers")
      .select("id, user_id, approver_email, email, is_active")
      .eq("organisation_id", orgId)
      .eq("is_active", true)
      .or(orParts.join(","))
      .maybeSingle();

    if (orgErr && !isMissingRelation(safeStr(orgErr.message))) throw orgErr;

    if (orgRow) return { ok: true, via: "org_approver", ruleId: safeStr((orgRow as any).id) || null };
  } catch {
    // swallow
  }

  return { ok: false, reason: "not_designated" };
}

/**
 * Back-compat wrapper (older code calls this).
 * New approval routes should NOT use this — use requireApproverForPendingArtifactStep().
 */
export async function requireApproverForProject(
  supabase: any,
  projectId: string,
  userId: string
): Promise<string | null> {
  const check = await isDesignatedApproverForChange({
    supabase,
    user: { id: userId },
    projectId,
    amount: null,
  });
  if (!check.ok) return null;
  return check.via === "doa_rule" ? "doa_approver" : "org_approver";
}

/* =========================================================
   NEW Approval Engine (Canonical)
========================================================= */

export async function getPendingArtifactStepForArtifact(args: {
  supabase: any;
  artifactId: string;
}): Promise<PendingStepInfo | null> {
  const supabase = args.supabase;
  const artifactId = safeStr(args.artifactId);
  if (!artifactId) return null;

  const { data: art, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, type, approval_chain_id, status")
    .eq("id", artifactId)
    .maybeSingle();

  if (artErr) throw new Error(artErr.message);
  if (!art) return null;

  const chainId = safeStr((art as any).approval_chain_id);
  const projectId = safeStr((art as any).project_id);
  const artifactType = safeStr((art as any).type) || safeStr((art as any).artifact_type) || "";

  if (!chainId || !projectId) return null;

  const { data: step, error: stErr } = await supabase
    .from("artifact_approval_steps")
    .select(
      "id, chain_id, artifact_id, project_id, artifact_type, step_order, name, mode, min_approvals, max_rejections, status"
    )
    .eq("chain_id", chainId)
    .eq("artifact_id", artifactId)
    .eq("status", "pending")
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (stErr) {
    if (isMissingRelation(safeStr(stErr.message))) {
      // make this explicit so routes can map to 409 if you want
      throw new Error("Approval engine not available");
    }
    throw new Error(stErr.message);
  }
  if (!step) return null;

  return {
    chainId,
    artifactId,
    projectId,
    artifactType: safeStr((step as any).artifact_type) || artifactType,

    stepId: String((step as any).id),
    stepOrder: Number((step as any).step_order ?? 1) || 1,
    stepName: safeStr((step as any).name) || "Approval",
    mode: safeStr((step as any).mode) || "VETO_QUORUM",
    minApprovals: Number((step as any).min_approvals ?? 1) || 1,
    maxRejections: Number((step as any).max_rejections ?? 0) || 0,
  };
}

/**
 * Resolve user approvers:
 * - Canonical: approver_member_id -> organisation_members.user_id
 * - Legacy fallback: approver_ref = user_id (uuid)
 */
async function listDirectApproverUserIdsForStep(supabase: any, stepId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("artifact_step_approvers")
    .select("approver_type, approver_ref, approver_member_id, active")
    .eq("step_id", safeStr(stepId))
    .eq("active", true);

  if (error) {
    if (isMissingRelation(safeStr(error.message))) return [];
    throw new Error(error.message);
  }

  const rows = Array.isArray(data) ? data : [];

  const memberIds = rows
    .filter((r: any) => safeStr(r?.approver_type).toLowerCase() === "user")
    .map((r: any) => safeStr(r?.approver_member_id))
    .filter((x) => looksLikeUuid(x));

  const legacyUserIds = rows
    .filter((r: any) => safeStr(r?.approver_type).toLowerCase() === "user")
    .map((r: any) => safeStr(r?.approver_ref))
    .filter((x) => looksLikeUuid(x));

  const out = new Set<string>();

  // Canonical path
  if (memberIds.length) {
    try {
      const { data: mems, error: mErr } = await supabase
        .from("organisation_members")
        .select("id, user_id")
        .in("id", memberIds);

      if (!mErr) {
        (Array.isArray(mems) ? mems : []).forEach((m: any) => {
          const uid = safeStr(m?.user_id);
          if (looksLikeUuid(uid)) out.add(uid);
        });
      }
    } catch {
      // swallow, fallback to legacy below
    }
  }

  legacyUserIds.forEach((u) => out.add(u));

  return Array.from(out);
}

async function findDelegatorForActorOnStep(
  supabase: any,
  actorUserId: string,
  directApproverIds: string[]
): Promise<string | null> {
  const actor = safeStr(actorUserId);
  if (!actor || directApproverIds.length === 0) return null;

  const tables = ["approver_delegations", "approval_delegations"];
  for (const t of tables) {
    try {
      // schema v1
      const q1 = await supabase
        .from(t)
        .select("primary_user_id, delegate_user_id, start_at, end_at, is_active")
        .in("primary_user_id", directApproverIds)
        .eq("delegate_user_id", actor);

      if (!q1.error) {
        const rows = Array.isArray(q1.data) ? q1.data : [];
        const now = Date.now();
        const hit = rows.find((r: any) => {
          if (r?.is_active === false) return false;
          const s = r?.start_at ? new Date(r.start_at).getTime() : -Infinity;
          const e = r?.end_at ? new Date(r.end_at).getTime() : Infinity;
          return s <= now && now <= e;
        });
        if (hit?.primary_user_id) return String(hit.primary_user_id);
        continue;
      }

      // schema v2 fallback
      if (
        hasMissingColumn(safeStr(q1.error?.message), "primary_user_id") ||
        hasMissingColumn(safeStr(q1.error?.message), "start_at") ||
        hasMissingColumn(safeStr(q1.error?.message), "end_at")
      ) {
        const q2 = await supabase
          .from(t)
          .select("delegator_user_id, delegate_user_id, starts_at, ends_at, is_active")
          .in("delegator_user_id", directApproverIds)
          .eq("delegate_user_id", actor);

        if (q2.error) continue;

        const rows = Array.isArray(q2.data) ? q2.data : [];
        const now = Date.now();
        const hit = rows.find((r: any) => {
          if (r?.is_active === false) return false;
          const s = r?.starts_at ? new Date(r.starts_at).getTime() : -Infinity;
          const e = r?.ends_at ? new Date(r.ends_at).getTime() : Infinity;
          return s <= now && now <= e;
        });
        if (hit?.delegator_user_id) return String(hit.delegator_user_id);
      }
    } catch {
      // ignore and try next table
    }
  }

  return null;
}

/**
 * Canonical auth check for Approve/Reject.
 */
export async function canActOnPendingArtifactStep(args: {
  supabase: any;
  stepId: string;
  actorUserId: string;
}): Promise<{ ok: boolean; onBehalfOf?: string | null }> {
  const supabase = args.supabase;
  const stepId = safeStr(args.stepId);
  const actor = safeStr(args.actorUserId);
  if (!stepId || !actor) return { ok: false };

  const direct = await listDirectApproverUserIdsForStep(supabase, stepId);
  if (direct.includes(actor)) return { ok: true, onBehalfOf: null };

  const delegator = await findDelegatorForActorOnStep(supabase, actor, direct);
  if (delegator) return { ok: true, onBehalfOf: delegator };

  return { ok: false };
}

/**
 * Required by approve/reject routes.
 * Throws "Forbidden" if actor can’t approve current pending step for artifact.
 */
export async function requireApproverForPendingArtifactStep(args: {
  supabase: any;
  artifactId: string;
  actorUserId: string;
}): Promise<{ pending: PendingStepInfo; onBehalfOf: string | null }> {
  const supabase = args.supabase;
  const artifactId = safeStr(args.artifactId);
  const actor = safeStr(args.actorUserId);

  const pending = await getPendingArtifactStepForArtifact({ supabase, artifactId });
  if (!pending) throw new Error("No pending approval step found.");

  const check = await canActOnPendingArtifactStep({ supabase, stepId: pending.stepId, actorUserId: actor });
  if (!check.ok) throw new Error("Forbidden");

  return { pending, onBehalfOf: check.onBehalfOf ?? null };
}

export async function recordArtifactApprovalDecision(args: {
  supabase: any;
  chainId: string;
  stepId: string;
  approverUserId: string;
  actorUserId: string;
  decision: ArtifactApprovalDecision;
  reason?: string | null;
}): Promise<void> {
  const supabase = args.supabase;

  const row = {
    chain_id: safeStr(args.chainId),
    step_id: safeStr(args.stepId),
    approver_user_id: safeStr(args.approverUserId),
    actor_user_id: safeStr(args.actorUserId),
    decision: safeStr(args.decision).toLowerCase(),
    reason: args.reason == null ? null : clampText(args.reason, 5000) || null,
  };

  if (!row.chain_id || !row.step_id || !row.approver_user_id || !row.actor_user_id) {
    throw new Error("Missing decision fields.");
  }
  if (row.decision !== "approved" && row.decision !== "rejected") {
    throw new Error("Invalid decision.");
  }

  const ins = await supabase
    .from("artifact_approval_decisions")
    .upsert(row, { onConflict: "chain_id,step_id,approver_user_id" });

  if (ins.error) throw new Error(ins.error.message);
}

/**
 * Recompute:
 * - If rejected threshold exceeded: step rejected, chain rejected, artifact rejected
 * - If approvals reached: step approved, move next step to pending OR finish chain approved
 */
export async function recomputeApprovalState(args: {
  supabase: any;
  artifactId: string;
  chainId: string;
  stepId: string;
  nowIso?: string;
}): Promise<{ stepStatus: string; chainStatus: string; artifactStatus: string }> {
  const supabase = args.supabase;
  const artifactId = safeStr(args.artifactId);
  const chainId = safeStr(args.chainId);
  const stepId = safeStr(args.stepId);
  const nowIso = safeStr(args.nowIso) || new Date().toISOString();

  const { data: step, error: stErr } = await supabase
    .from("artifact_approval_steps")
    .select("id, chain_id, artifact_id, step_order, min_approvals, max_rejections, status")
    .eq("id", stepId)
    .maybeSingle();

  if (stErr) {
    if (isMissingRelation(safeStr(stErr.message))) throw new Error("Approval engine not available");
    throw new Error(stErr.message);
  }
  if (!step) throw new Error("Step not found.");

  const stepOrder = Number((step as any).step_order ?? 1) || 1;
  const minApprovals = Number((step as any).min_approvals ?? 1) || 1;
  const maxRejections = Number((step as any).max_rejections ?? 0) || 0;

  const { data: decs, error: dErr } = await supabase
    .from("artifact_approval_decisions")
    .select("decision")
    .eq("chain_id", chainId)
    .eq("step_id", stepId);

  if (dErr) throw new Error(dErr.message);

  const rows = Array.isArray(decs) ? decs : [];
  const approvals = rows.filter((r: any) => safeStr(r?.decision).toLowerCase() === "approved").length;
  const rejections = rows.filter((r: any) => safeStr(r?.decision).toLowerCase() === "rejected").length;

  const isRejected = rejections > maxRejections; // maxRejections=0 => first rejection rejects
  const isApproved = !isRejected && approvals >= minApprovals;

  if (isRejected) {
    await supabase
      .from("artifact_approval_steps")
      .update({ status: "rejected", completed_at: nowIso })
      .eq("id", stepId);

    await supabase.from("approval_chains").update({ status: "rejected", is_active: false }).eq("id", chainId);

    try {
      await supabase.from("artifacts").update({ status: "rejected" }).eq("id", artifactId);
    } catch {}

    return { stepStatus: "rejected", chainStatus: "rejected", artifactStatus: "rejected" };
  }

  if (isApproved) {
    await supabase
      .from("artifact_approval_steps")
      .update({ status: "approved", completed_at: nowIso })
      .eq("id", stepId);

    const { data: next, error: nErr } = await supabase
      .from("artifact_approval_steps")
      .select("id, status")
      .eq("chain_id", chainId)
      .eq("artifact_id", artifactId)
      .gt("step_order", stepOrder)
      .order("step_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (nErr) throw new Error(nErr.message);

    if (next?.id) {
      if (safeStr((next as any).status) !== "pending") {
        await supabase.from("artifact_approval_steps").update({ status: "pending" }).eq("id", (next as any).id);
      }
      await supabase.from("approval_chains").update({ status: "active", is_active: true }).eq("id", chainId);

      // Artifact remains submitted/in_review until chain completes
      return { stepStatus: "approved", chainStatus: "active", artifactStatus: "submitted" };
    }

    await supabase.from("approval_chains").update({ status: "approved", is_active: false }).eq("id", chainId);

    try {
      await supabase.from("artifacts").update({ status: "approved" }).eq("id", artifactId);
    } catch {}

    return { stepStatus: "approved", chainStatus: "approved", artifactStatus: "approved" };
  }

  return { stepStatus: "pending", chainStatus: "active", artifactStatus: "submitted" };
}

/**
 * Progress helper for UI
 */
export async function getApprovalProgressForArtifact(args: {
  supabase: any;
  artifactId: string;
  actorUserId?: string | null;
}): Promise<
  | null
  | {
      artifactId: string;
      chainId: string;
      chainStatus: string;
      totalSteps: number;
      approvedSteps: number;
      rejectedSteps: number;
      pendingSteps: number;
      currentStep: PendingStepInfo | null;
      remainingApprovers: number | null;
      myAction: { canApprove: boolean; onBehalfOf: string | null };
    }
> {
  const supabase = args.supabase;
  const artifactId = safeStr(args.artifactId);
  const actorUserId = safeStr(args.actorUserId || "");

  if (!artifactId) return null;

  const { data: art, error: aErr } = await supabase
    .from("artifacts")
    .select("id, approval_chain_id")
    .eq("id", artifactId)
    .maybeSingle();

  if (aErr) throw new Error(aErr.message);
  if (!art) return null;

  const chainId = safeStr((art as any).approval_chain_id);
  if (!chainId) return null;

  const { data: ch, error: cErr } = await supabase
    .from("approval_chains")
    .select("id, status")
    .eq("id", chainId)
    .maybeSingle();

  if (cErr) throw new Error(cErr.message);

  const chainStatus = safeStr((ch as any)?.status) || "active";

  const { data: steps, error: sErr } = await supabase
    .from("artifact_approval_steps")
    .select("id, status")
    .eq("chain_id", chainId)
    .eq("artifact_id", artifactId);

  if (sErr) {
    if (isMissingRelation(safeStr(sErr.message))) throw new Error("Approval engine not available");
    throw new Error(sErr.message);
  }

  const stepRows = Array.isArray(steps) ? steps : [];
  const totalSteps = stepRows.length;
  const approvedSteps = stepRows.filter((r: any) => safeStr(r?.status) === "approved").length;
  const rejectedSteps = stepRows.filter((r: any) => safeStr(r?.status) === "rejected").length;
  const pendingSteps = stepRows.filter((r: any) => safeStr(r?.status) === "pending").length;

  const currentStep = await getPendingArtifactStepForArtifact({ supabase, artifactId });

  let remainingApprovers: number | null = null;
  let myAction = { canApprove: false, onBehalfOf: null as string | null };

  if (currentStep?.stepId) {
    if (actorUserId) {
      const check = await canActOnPendingArtifactStep({ supabase, stepId: currentStep.stepId, actorUserId });
      myAction = { canApprove: !!check.ok, onBehalfOf: check.onBehalfOf ?? null };
    }

    try {
      const { data: appr, error: apErr } = await supabase
        .from("artifact_step_approvers")
        .select("approver_type, approver_member_id, approver_ref, active")
        .eq("step_id", currentStep.stepId)
        .eq("active", true);

      if (apErr) throw apErr;

      const approverUserIds = new Set<string>();
      const rows = Array.isArray(appr) ? appr : [];

      const memberIds = rows
        .filter((r: any) => safeStr(r?.approver_type).toLowerCase() === "user")
        .map((r: any) => safeStr(r?.approver_member_id))
        .filter((x) => looksLikeUuid(x));

      if (memberIds.length) {
        const { data: mems, error: mErr } = await supabase
          .from("organisation_members")
          .select("id, user_id")
          .in("id", memberIds);

        if (!mErr) {
          (Array.isArray(mems) ? mems : []).forEach((m: any) => {
            const uid = safeStr(m?.user_id);
            if (looksLikeUuid(uid)) approverUserIds.add(uid);
          });
        }
      }

      // legacy fallback
      rows
        .filter((r: any) => safeStr(r?.approver_type).toLowerCase() === "user")
        .map((r: any) => safeStr(r?.approver_ref))
        .filter((x) => looksLikeUuid(x))
        .forEach((uid) => approverUserIds.add(uid));

      const { data: decs, error: dErr } = await supabase
        .from("artifact_approval_decisions")
        .select("approver_user_id")
        .eq("chain_id", currentStep.chainId)
        .eq("step_id", currentStep.stepId);

      if (dErr) throw dErr;

      const decided = new Set(
        (Array.isArray(decs) ? decs : [])
          .map((d: any) => safeStr(d?.approver_user_id))
          .filter((x) => looksLikeUuid(x))
      );

      let remaining = 0;
      approverUserIds.forEach((uid) => {
        if (!decided.has(uid)) remaining++;
      });

      remainingApprovers = remaining;
    } catch {
      remainingApprovers = null;
    }
  }

  return {
    artifactId,
    chainId,
    chainStatus,
    totalSteps,
    approvedSteps,
    rejectedSteps,
    pendingSteps,
    currentStep,
    remainingApprovers,
    myAction,
  };
}

/* =========================================================
   Impact helpers
========================================================= */

export function normalizeImpactAnalysis(x: any) {
  const obj = x && typeof x === "object" && !Array.isArray(x) ? x : {};
  return {
    days: Number((obj as any).days ?? 0) || 0,
    cost: Number((obj as any).cost ?? 0) || 0,
    risk: safeStr((obj as any).risk || "None identified") || "None identified",
    highlights: Array.isArray((obj as any).highlights)
      ? (obj as any).highlights.map((v: any) => safeStr(v)).filter(Boolean)
      : [],
  };
}

/* =========================================================
   Audit / Timeline
========================================================= */

export async function logChangeEvent(
  supabase: any,
  args: {
    projectId: string;
    changeRequestId: string;
    actorUserId?: string | null;
    actorRole?: string | null;
    eventType: string;
    fromValue?: string | null;
    toValue?: string | null;
    note?: string | null;
    payload?: any;
  }
) {
  const {
    projectId,
    changeRequestId,
    actorUserId = null,
    actorRole = null,
    eventType,
    fromValue = null,
    toValue = null,
    note = null,
    payload = {},
  } = args;

  // Legacy table: change_request_events (best effort, payload column optional)
  try {
    const baseRow: any = {
      project_id: projectId,
      change_request_id: changeRequestId,
      actor_user_id: actorUserId,
      event_type: eventType,
      from_value: fromValue,
      to_value: toValue,
      note: note ? clampText(note, 8000) : null,
    };

    // Try with payload first; if missing, retry without it.
    baseRow.payload = payload && typeof payload === "object" ? payload : {};

    const ins1 = await supabase.from("change_request_events").insert(baseRow);
    if (ins1?.error && hasMissingColumn(safeStr(ins1.error.message), "payload")) {
      delete baseRow.payload;
      await supabase.from("change_request_events").insert(baseRow);
    }
  } catch {
    // swallow
  }

  // Newer table: change_events (best effort)
  let mappedType: "created" | "status_changed" | "comment" | "edited" = "edited";
  const et = safeStr(eventType).toLowerCase();

  if (et === "created") mappedType = "created";
  else if (et.includes("status") || et.includes("lane") || et.includes("approve") || et.includes("reject")) mappedType = "status_changed";
  else if (et.includes("comment")) mappedType = "comment";

  try {
    await supabase.from("change_events").insert({
      project_id: projectId,
      change_id: changeRequestId,
      event_type: mappedType,
      from_status: fromValue,
      to_status: toValue,
      actor_user_id: actorUserId,
      actor_role: actorRole,
      comment: note ? clampText(note, 8000) : null,
      payload: { legacy_event_type: eventType, ...(payload && typeof payload === "object" ? payload : {}) },
    });
  } catch {
    // swallow
  }
}

/* =========================================================
   Supabase factory (LAST)
========================================================= */

export async function sb() {
  return await createClient();
}