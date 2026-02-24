// src/app/api/change/[id]/submit/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import {
  sb,
  requireUser,
  requireProjectRole,
  canEdit,
  safeStr,
  logChangeEvent,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* =========================================================
   response helpers
========================================================= */

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

/* =========================================================
   local helpers (holiday-cover safe)
========================================================= */

function isBadIdString(x: string) {
  const v = safeStr(x).trim().toLowerCase();
  return !v || v === "null" || v === "undefined";
}

async function pickChangeId(
  req: Request,
  params: Promise<{ id?: string }> | undefined,
  body: any
): Promise<string | null> {
  if (params) {
    const resolvedParams = await params;
    const p = safeStr(resolvedParams?.id).trim();
    if (!isBadIdString(p)) return p;
  }

  try {
    const pathname = new URL(req.url).pathname || "";
    const parts = pathname.split("/").filter(Boolean);

    const last = parts[parts.length - 1] || "";
    if (last.toLowerCase() === "submit" && parts.length >= 2) {
      const candidate = safeStr(parts[parts.length - 2]).trim();
      if (!isBadIdString(candidate) && candidate.toLowerCase() !== "change") return candidate;
    }

    const idx = parts.findIndex((x) => String(x).toLowerCase() === "change");
    if (idx !== -1 && parts[idx + 1]) {
      const candidate = safeStr(parts[idx + 1]).trim();
      if (!isBadIdString(candidate)) return candidate;
    }
  } catch {}

  try {
    const u = new URL(req.url);
    const q1 = safeStr(u.searchParams.get("id")).trim();
    if (!isBadIdString(q1)) return q1;

    const q2 = safeStr(u.searchParams.get("change_id")).trim();
    if (!isBadIdString(q2)) return q2;
  } catch {}

  const b = safeStr(body?.id ?? body?.change_id).trim();
  if (!isBadIdString(b)) return b;

  return null;
}

function hasMissingColumn(errMsg: string, col: string) {
  const m = (errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return m.includes("column") && m.includes(c);
}
function hasDeliveryStatusMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "delivery_status");
}
function hasApprovalChainIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "approval_chain_id");
}
function hasImpactAnalysisMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "impact_analysis");
}
function hasOrganisationIdMissingColumn(errMsg: string) {
  return hasMissingColumn(errMsg, "organisation_id") || hasMissingColumn(errMsg, "organization_id");
}
function isMissingRelation(errMsg: string) {
  const m = (errMsg || "").toLowerCase();
  return m.includes("does not exist") && m.includes("relation");
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
    const ins = await supabase.from("change_events").insert({
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

    if (ins.error && !isMissingRelation(safeStr(ins.error.message))) {
      // swallow
    }
  } catch {
    // swallow
  }
}

function toLaneDb(v: string) {
  const x = safeStr(v).toLowerCase();
  if (x === "in-progress") return "in_progress";
  if (x === "in_progress") return "in_progress";
  if (x === "intake") return "intake";
  if (x === "analysis") return "analysis";
  if (x === "review") return "review";
  if (x === "implemented") return "implemented";
  if (x === "closed") return "closed";
  if (x === "new") return "intake";
  return x || "intake";
}

/* =========================================================
   Canonical artifact type normalisation
========================================================= */

function normalizeArtifactType(raw: any): "project_charter" | "change" | "project_closure_report" | string {
  const v = safeStr(raw).trim();
  const lower = v.toLowerCase();
  if (!lower) return "";

  if (lower === "change_request" || lower === "change_requests") return "change";
  if (lower === "project_closure" || lower === "project_closure_report") return "project_closure_report";
  if (lower === "project_charter") return "project_charter";

  return lower;
}

/* =========================================================
   ensureArtifactIdForChangeRequest
========================================================= */

async function ensureArtifactIdForChangeRequest(supabase: any, cr: any): Promise<string | null> {
  const current = safeStr(cr?.artifact_id).trim();
  if (current) return current;

  const projectId = safeStr(cr?.project_id).trim();
  if (!projectId) return null;

  const { data, error } = await supabase
    .from("artifacts")
    .select("id, type, artifact_type, is_current, created_at")
    .eq("project_id", projectId)
    .or("type.in.(change_requests,change_request,change),artifact_type.in.(change_requests,change_request,change)")
    .order("is_current", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) return null;

  const resolved = Array.isArray(data) && data[0]?.id ? String(data[0].id) : null;
  if (!resolved) return null;

  try {
    await supabase.from("change_requests").update({ artifact_id: resolved }).eq("id", cr.id);
  } catch {}

  return resolved;
}

/* =========================================================
   Approval timeline helpers (best-effort)
========================================================= */

/** Best-effort: get a nice actor name for timeline */
async function resolveActorName(supabase: any, userId: string, fallbackEmail?: string | null) {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("full_name, display_name, name, email")
      .eq("id", userId)
      .maybeSingle();

    const n =
      safeStr((data as any)?.full_name).trim() ||
      safeStr((data as any)?.display_name).trim() ||
      safeStr((data as any)?.name).trim();
    if (n) return n;

    const em = safeStr((data as any)?.email).trim() || safeStr(fallbackEmail).trim();
    return em || null;
  } catch {
    const em = safeStr(fallbackEmail).trim();
    return em || null;
  }
}

/**
 * ✅ Approval timeline event into approval_events
 * Best-effort; never blocks.
 */
async function insertApprovalEvent(
  supabase: any,
  row: {
    organisation_id?: string | null;
    project_id: string;
    artifact_id?: string | null;
    change_id?: string | null;
    step_id?: string | null;
    action_type: string;
    actor_user_id?: string | null;
    actor_name?: string | null;
    actor_role?: string | null;
    comment?: string | null;
    meta?: any;
  }
) {
  try {
    const payloadObj = row.meta && typeof row.meta === "object" ? row.meta : {};
    const ins = await supabase.from("approval_events").insert({
      organisation_id: row.organisation_id ?? null,
      project_id: row.project_id,
      artifact_id: row.artifact_id ?? null,
      change_id: row.change_id ?? null,
      step_id: row.step_id ?? null,
      action_type: safeStr(row.action_type).trim() || "unknown",
      actor_user_id: row.actor_user_id ?? null,
      actor_name: row.actor_name ?? null,
      actor_role: row.actor_role ?? null,
      comment: row.comment ?? null,
      meta: payloadObj,
    });

    if (ins?.error) {
      const msg = safeStr(ins.error.message);
      if (!isMissingRelation(msg)) {
        // swallow
      }
    }
  } catch {
    // swallow
  }
}

/** Best-effort: show “waiting for step X / approvers” on submit */
async function getFirstPendingStepSummary(
  supabase: any,
  chainId: string
): Promise<{ step_id: string | null; step_order: number | null; name: string | null } | null> {
  const cid = safeStr(chainId).trim();
  if (!cid) return null;

  try {
    const { data, error } = await supabase
      .from("artifact_approval_steps")
      .select("id, step_order, name, status")
      .eq("chain_id", cid)
      .order("step_order", { ascending: true })
      .limit(1);

    if (error) return null;
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;

    return {
      step_id: row?.id ? String(row.id) : null,
      step_order: row?.step_order == null ? null : Number(row.step_order),
      name: row?.name ? String(row.name) : null,
    };
  } catch {
    return null;
  }
}

/* =========================================================
   Org-driven approvals: rules -> chain + steps + approvers
========================================================= */

async function getOrganisationIdForProject(supabase: any, projectId: string): Promise<string | null> {
  const first = await supabase.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
  if (!first.error) {
    const orgId = (first.data as any)?.organisation_id;
    return orgId ? String(orgId) : null;
  }
  if (!hasOrganisationIdMissingColumn(safeStr(first.error?.message))) return null;

  const second = await supabase.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  if (second.error) return null;
  const orgId = (second.data as any)?.organization_id;
  return orgId ? String(orgId) : null;
}

function extractCostFromImpactAnalysis(impact: any): number {
  try {
    const cost = impact?.cost ?? impact?.estimated_cost ?? impact?.budget_delta ?? null;
    const n = Number(cost);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

async function loadImpactCostForChange(supabase: any, changeId: string): Promise<number> {
  const first = await supabase.from("change_requests").select("impact_analysis").eq("id", changeId).maybeSingle();
  if (!first.error) {
    const ia = (first.data as any)?.impact_analysis;
    return extractCostFromImpactAnalysis(ia);
  }
  if (hasImpactAnalysisMissingColumn(safeStr(first.error?.message))) return 0;
  return 0;
}

type RuleRow = {
  id: string;
  step: number;
  approval_role: string;
  approver_user_id: string | null;
  approval_group_id: string | null;
  min_amount: number;
  max_amount: number | null;
};

function inBand(amount: number, min: number, max: number | null) {
  const minOk = amount >= (Number.isFinite(min) ? min : 0);
  const maxOk = max == null ? true : amount <= Number(max);
  return minOk && maxOk;
}

async function loadRulesForArtifact(
  supabase: any,
  organisationId: string,
  artifactTypeRaw: string,
  amount: number
): Promise<RuleRow[]> {
  const artifactType = normalizeArtifactType(artifactTypeRaw);

  const { data, error } = await supabase
    .from("artifact_approver_rules")
    .select("id, step, approval_role, approver_user_id, approval_group_id, min_amount, max_amount, is_active")
    .eq("organisation_id", organisationId)
    .eq("artifact_type", artifactType)
    .eq("is_active", true);

  if (error) return [];

  const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
    id: String(r.id),
    step: Number(r.step ?? 1),
    approval_role: safeStr(r.approval_role) || "Approval",
    approver_user_id: r.approver_user_id ? String(r.approver_user_id) : null,
    approval_group_id: r.approval_group_id ? String(r.approval_group_id) : null,
    min_amount: Number(r.min_amount ?? 0) || 0,
    max_amount: r.max_amount == null ? null : Number(r.max_amount),
  })) as RuleRow[];

  return rows.filter((r) => Number.isFinite(r.step) && r.step >= 1 && inBand(amount, r.min_amount, r.max_amount));
}

/**
 * ✅ Canonical group expansion for YOUR schema:
 * - approver_groups / approver_group_members
 * - groupId is approver_groups.id
 */
async function expandGroupMembersToUserIds(supabase: any, groupId: string): Promise<string[]> {
  const gid = safeStr(groupId).trim();
  if (!gid) return [];

  try {
    const { data, error } = await supabase
      .from("approver_group_members")
      .select("user_id, is_active")
      .eq("group_id", gid)
      .eq("is_active", true);

    if (error) return [];
    const ids = (Array.isArray(data) ? data : [])
      .map((r: any) => (r?.user_id ? String(r.user_id) : ""))
      .filter(Boolean);

    return Array.from(new Set(ids));
  } catch {
    return [];
  }
}

async function supersedeExistingArtifactChain(supabase: any, artifactId: string) {
  const aid = safeStr(artifactId).trim();
  if (!aid) return;
  try {
    await supabase
      .from("approval_chains")
      .update({ is_active: false, status: "superseded" })
      .eq("artifact_id", aid)
      .eq("is_active", true);
  } catch {}
}

async function updateArtifactSubmitted(
  supabase: any,
  artifactId: string,
  chainId: string,
  actorId: string,
  nowIso: string
) {
  const patch1: any = {
    approval_chain_id: chainId,
    submitted_at: nowIso,
    submitted_by: actorId,
    status: "submitted",
    approval_status: "submitted",
    approval_step_index: 0,
    is_locked: true,
    locked_at: nowIso,
    locked_by: actorId,
  };

  const u1 = await supabase.from("artifacts").update(patch1).eq("id", artifactId);
  if (!u1.error) return;

  const patch2: any = {
    approval_chain_id: chainId,
    submitted_at: nowIso,
    submitted_by: actorId,
  };
  await supabase.from("artifacts").update(patch2).eq("id", artifactId);
}

async function tryAttachApprovalChainIdToChange(supabase: any, changeId: string, chainId: string) {
  const first = await supabase.from("change_requests").update({ approval_chain_id: chainId }).eq("id", changeId);
  if (!first.error) return;
  if (hasApprovalChainIdMissingColumn(safeStr(first.error.message))) return;
}

async function getActiveChainIdForArtifact(supabase: any, artifactId: string): Promise<string | null> {
  const aid = safeStr(artifactId).trim();
  if (!aid) return null;

  const { data, error } = await supabase
    .from("approval_chains")
    .select("id, created_at")
    .eq("artifact_id", aid)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return null;
  return (data as any)?.id ? String((data as any).id) : null;
}

/**
 * ✅ Map user_ids -> organisation_members.id (canonical approver_member_id)
 * Falls back gracefully if mapping is missing.
 */
async function mapUserIdsToOrgMemberIds(
  supabase: any,
  organisationId: string,
  userIds: string[]
): Promise<Map<string, string>> {
  const orgId = safeStr(organisationId).trim();
  const ids = Array.from(new Set((userIds || []).map((x) => safeStr(x)).filter(Boolean)));
  const out = new Map<string, string>();
  if (!orgId || !ids.length) return out;

  try {
    const { data, error } = await supabase
      .from("organisation_members")
      .select("id, user_id")
      .eq("organisation_id", orgId)
      .in("user_id", ids)
      .is("removed_at", null);

    if (error) return out;

    (Array.isArray(data) ? data : []).forEach((r: any) => {
      const uid = safeStr(r?.user_id);
      const mid = safeStr(r?.id);
      if (uid && mid) out.set(uid, mid);
    });

    return out;
  } catch {
    return out;
  }
}

async function createChainAndStepsFromRules(
  supabase: any,
  args: {
    organisationId: string;
    projectId: string;
    artifactId: string;
    actorId: string;
    amount: number;
    artifactType: string;
  }
): Promise<{ chainId: string; stepIds: string[]; chosenType: string }> {
  const { organisationId, projectId, artifactId, actorId, amount } = args;

  const desiredType = normalizeArtifactType(args.artifactType) || "change";
  const typeCandidates = Array.from(new Set([desiredType, "change_request", "change_requests", "change"]));

  let rules: RuleRow[] = [];
  let chosenType = desiredType;

  for (const t of typeCandidates) {
    const r = await loadRulesForArtifact(supabase, organisationId, t, amount);
    if (r.length) {
      rules = r;
      chosenType = normalizeArtifactType(t) || desiredType;
      break;
    }
  }

  if (!rules.length) {
    throw new Error(
      `No active artifact_approver_rules configured for org/type. (org=${organisationId}, type=${desiredType}, amount=${amount})`
    );
  }

  const byStep = new Map<number, RuleRow[]>();
  for (const r of rules) {
    const k = Number(r.step ?? 1);
    if (!byStep.has(k)) byStep.set(k, []);
    byStep.get(k)!.push(r);
  }

  const stepNumbers = Array.from(byStep.keys()).sort((a, b) => a - b);

  const chainInsert: any = {
    project_id: projectId,
    artifact_type: chosenType,
    is_active: true,
    organisation_id: organisationId,
    artifact_id: artifactId,
    status: "active",
    created_by: actorId,
    source_rule_id: null,
    amount,
  };

  const chainIns = await supabase.from("approval_chains").insert(chainInsert).select("id").single();

  let chainId: string | null = null;

  if (!chainIns.error) {
    chainId = String(chainIns.data.id);
  } else {
    const existing = await getActiveChainIdForArtifact(supabase, artifactId);
    if (existing) chainId = existing;
    else throw new Error(safeStr(chainIns.error.message));
  }

  const existingSteps = await supabase
    .from("artifact_approval_steps")
    .select("id, step_order")
    .eq("chain_id", chainId)
    .order("step_order", { ascending: true });

  if (!existingSteps.error && Array.isArray(existingSteps.data) && existingSteps.data.length > 0) {
    return { chainId, stepIds: existingSteps.data.map((s: any) => String(s.id)), chosenType };
  }

  const stepRows = stepNumbers.map((stepNo) => {
    const stepRules = byStep.get(stepNo) || [];
    const label = safeStr(stepRules[0]?.approval_role) || `Step ${stepNo}`;
    return {
      artifact_id: artifactId,
      chain_id: chainId,
      project_id: projectId,
      artifact_type: chosenType,
      step_order: stepNo,
      name: label,
      mode: "VETO_QUORUM",
      min_approvals: 1,
      max_rejections: 0,
      round: 1,
      status: "pending",
      approval_step_id: null,
    };
  });

  const stepIns = await supabase.from("artifact_approval_steps").insert(stepRows).select("id, step_order");
  if (stepIns.error) throw new Error(safeStr(stepIns.error.message));

  const insertedSteps = Array.isArray(stepIns.data) ? stepIns.data : [];
  const stepIdByOrder = new Map<number, string>();
  for (const s of insertedSteps as any[]) stepIdByOrder.set(Number(s.step_order), String(s.id));

  const pendingApproversByStep: { stepId: string; userId: string }[] = [];

  for (const stepNo of stepNumbers) {
    const stepId = stepIdByOrder.get(stepNo);
    if (!stepId) continue;

    const stepRules = byStep.get(stepNo) || [];
    for (const r of stepRules) {
      if (r.approver_user_id) {
        pendingApproversByStep.push({ stepId, userId: String(r.approver_user_id) });
      } else if (r.approval_group_id) {
        const members = await expandGroupMembersToUserIds(supabase, String(r.approval_group_id));
        for (const userId of members) {
          pendingApproversByStep.push({ stepId, userId: String(userId) });
        }
      }
    }
  }

  const pairSeen = new Set<string>();
  const pairs = pendingApproversByStep.filter((p) => {
    const k = `${p.stepId}::${p.userId}`;
    if (pairSeen.has(k)) return false;
    pairSeen.add(k);
    return true;
  });

  if (!pairs.length) {
    throw new Error(
      "Approval rules matched, but produced zero approvers. Ensure approver_user_id is set or the approver group has active members."
    );
  }

  const memberIdByUserId = await mapUserIdsToOrgMemberIds(
    supabase,
    organisationId,
    pairs.map((p) => p.userId)
  );

  const approverRowsPreferred: any[] = pairs.map((p) => ({
    step_id: p.stepId,
    approver_type: "user",
    approver_member_id: memberIdByUserId.get(p.userId) ?? null,
    approver_ref: p.userId,
    required: true,
    active: true,
  }));

  const try1 = await supabase.from("artifact_step_approvers").insert(approverRowsPreferred);

  if (try1.error) {
    const msg = safeStr(try1.error.message);
    const missingMemberIdCol = hasMissingColumn(msg, "approver_member_id");

    if (!missingMemberIdCol) {
      throw new Error(`Failed to insert artifact_step_approvers. (${msg})`);
    }

    const legacyRows = pairs.map((p) => ({
      step_id: p.stepId,
      approver_type: "user",
      approver_ref: p.userId,
      required: true,
      active: true,
    }));

    const try2 = await supabase.from("artifact_step_approvers").insert(legacyRows);
    if (try2.error) {
      throw new Error(`Failed to insert artifact_step_approvers (legacy fallback). (${safeStr(try2.error.message)})`);
    }
  }

  return { chainId, stepIds: insertedSteps.map((s: any) => String(s.id)), chosenType };
}

/* =========================================================
   Route
========================================================= */

export async function POST(req: Request, ctx: { params: Promise<{ id?: string }> }) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const changeId = await pickChangeId(req, ctx.params, body);
    if (!changeId) return jsonErr("Missing id", 400);

    const supabase = await sb();
    const user = await requireUser(supabase);

    const requestId = getRequestId(req);

    type ChangeRow = {
      id: string;
      project_id: string;
      artifact_id?: string;
      status?: string;
      delivery_status?: string;
      decision_status?: string;
      [key: string]: any;
    };

    let cr: ChangeRow | null = null;
    let deliveryStatusMissing = false;

    const firstLoad = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id, status, delivery_status, decision_status")
      .eq("id", changeId)
      .maybeSingle();

    if (!firstLoad.error) {
      cr = firstLoad.data as ChangeRow;
    } else {
      deliveryStatusMissing = hasDeliveryStatusMissingColumn(safeStr(firstLoad.error.message));
      if (deliveryStatusMissing) {
        const secondLoad = await supabase
          .from("change_requests")
          .select("id, project_id, artifact_id, status, decision_status")
          .eq("id", changeId)
          .maybeSingle();

        if (secondLoad.error) throw new Error(secondLoad.error.message);
        cr = secondLoad.data as ChangeRow;
      } else {
        throw new Error(firstLoad.error.message);
      }
    }

    if (!cr) return jsonErr("Not found", 404);

    const projectId = safeStr(cr?.project_id).trim();
    if (!projectId) return jsonErr("Missing project_id", 500);

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return jsonErr("Forbidden", 403);
    if (!canEdit(role)) return jsonErr("Forbidden", 403);

    const fromLane = safeStr(cr?.delivery_status).trim().toLowerCase() || null;
    const decision = safeStr(cr?.decision_status).trim().toLowerCase();

    if (decision === "approved" || decision === "rejected") {
      return jsonErr("This change is already decided", 400);
    }

    // ✅ Idempotent: already submitted
    if (decision === "submitted") {
      return jsonOk({ item: { ...cr, delivery_status: cr?.delivery_status ?? null }, data: cr, already: "submitted" });
    }

    // ✅ Only lane-gate when column exists (legacy-safe)
    if (!deliveryStatusMissing && fromLane !== "analysis") {
      return jsonErr("Only changes in Analysis can be submitted for approval.", 409);
    }

    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return jsonErr(
        "Missing artifact_id (Change Requests artifact). Create/backfill the project artifact first.",
        409
      );
    }

    const now = new Date().toISOString();
    const toLane = "review";

    const organisationId = await getOrganisationIdForProject(supabase, projectId);
    if (!organisationId) {
      return jsonErr("Project has no organisation_id. Configure organisation_id on the project first.", 409);
    }

    const actorEmail = safeStr((user as any)?.email ?? "").trim() || null;
    const actorName = await resolveActorName(supabase, user.id, actorEmail);

    const amount = await loadImpactCostForChange(supabase, changeId);

    await supersedeExistingArtifactChain(supabase, artifactId);

    const { chainId, chosenType } = await createChainAndStepsFromRules(supabase, {
      organisationId,
      projectId,
      artifactId,
      actorId: user.id,
      amount,
      artifactType: "change",
    });

    // best-effort: first step summary (for timeline)
    const firstStep = await getFirstPendingStepSummary(supabase, chainId);

    await updateArtifactSubmitted(supabase, artifactId, chainId, user.id, now);
    await tryAttachApprovalChainIdToChange(supabase, changeId, chainId);

    const patch: any = {
      delivery_status: toLaneDb(toLane),
      decision_status: "submitted",

      decision_at: null,
      decision_by: null,
      decision_role: null,
      decision_rationale: null,

      updated_at: now,
    };

    const firstUpdate = await supabase
      .from("change_requests")
      .update(patch)
      .eq("id", changeId)
      .select("id, project_id, artifact_id, status, delivery_status, decision_status")
      .maybeSingle();

    let updated = firstUpdate.data as ChangeRow | null;
    const deliveryMissingOnUpdate = Boolean(
      firstUpdate.error && hasDeliveryStatusMissingColumn(safeStr(firstUpdate.error.message))
    );

    if (deliveryMissingOnUpdate) {
      delete patch.delivery_status;

      const secondUpdate = await supabase
        .from("change_requests")
        .update(patch)
        .eq("id", changeId)
        .select("id, project_id, artifact_id, status, decision_status")
        .maybeSingle();

      if (secondUpdate.error) throw new Error(secondUpdate.error.message);
      updated = secondUpdate.data as ChangeRow | null;
    } else if (firstUpdate.error) {
      throw new Error(firstUpdate.error.message);
    }

    try {
      await logChangeEvent(
        supabase,
        {
          projectId,
          artifactId,
          changeRequestId: changeId,
          actorUserId: user.id,
          actorRole: role,
          eventType: "submitted_for_approval",
          fromValue: deliveryStatusMissing ? null : (fromLane || null),
          toValue: deliveryMissingOnUpdate ? null : toLane,
          note: null,
          payload: {
            decision_status: { from: decision || null, to: "submitted" },
            lane: { from: deliveryStatusMissing ? null : (fromLane || null), to: deliveryMissingOnUpdate ? null : toLane },
            approval_chain_id: chainId,
            approval_chain_artifact_type: chosenType,
            amount,
            submitted_at: now,
            request_id: requestId,
          },
        } as any
      );
    } catch {}

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: changeId,
      event_type: "status_changed",
      from_status: deliveryStatusMissing ? null : fromLane,
      to_status: deliveryMissingOnUpdate ? null : toLane,
      actor_user_id: user.id,
      actor_role: safeStr(role),
      comment: null,
      payload: {
        source: "submit_route",
        decision_status: "submitted",
        approval_chain_id: chainId,
        approval_chain_artifact_type: chosenType,
        amount,
        at: now,
        sla_start: true,
        sla_started_at: now,
        request_id: requestId,
      },
    });

    // ✅ Approval timeline (submitted)
    await insertApprovalEvent(supabase, {
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      change_id: changeId,
      step_id: firstStep?.step_id ?? null,
      action_type: "submitted",
      actor_user_id: user.id,
      actor_name: actorName,
      actor_role: safeStr(role),
      comment: null,
      meta: {
        at: now,
        request_id: requestId,
        approval_chain_id: chainId,
        artifact_type: chosenType,
        amount,
        from_lane: deliveryStatusMissing ? null : (fromLane || null),
        to_lane: deliveryMissingOnUpdate ? null : toLane,
        delivery_status_missing: deliveryMissingOnUpdate || deliveryStatusMissing,
        first_step: firstStep,
        source: "submit_route",
        sla_started_at: now,
      },
    });

    const resultItem = updated || cr;
    const finalItem = { ...resultItem, delivery_status: resultItem?.delivery_status ?? null };

    return jsonOk({
      item: finalItem,
      data: finalItem,
      approval_chain_id: chainId,
      amount,
      artifact_type: chosenType,
    });
  } catch (e: any) {
    console.error("[POST /api/change/:id/submit]", e);
    const msg = safeStr(e?.message) || "Server error";
    const status = msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500;
    return jsonErr(msg, status);
  }
}