// src/app/api/change/[id]/submit/route.ts
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
  logChangeEvent,
} from "@/lib/change/server-helpers";

export const runtime = "nodejs";

/* =========================================================
   local helpers (holiday-cover safe)
========================================================= */

function isBadIdString(x: string) {
  const v = safeStr(x).trim().toLowerCase();
  return !v || v === "null" || v === "undefined";
}

/**
 * Robust ID resolution for /api/change/[id]/submit
 * Supports:
 *  - /api/change/<id>/submit (path param)
 *  - /api/change/submit?id=<id> (query)
 *  - body.id / body.change_id (body)
 */
function pickChangeId(req: Request, ctx: any, body: any): string | null {
  // 1) id
  const { id } = await ctx.params;
    const p = safeStr(id).trim();
  if (!isBadIdString(p)) return p;

  // 2) URL path: .../change/<id>/submit  (id is the segment BEFORE "submit")
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
  } catch {
    // ignore
  }

  // 3) query ?id=... or ?change_id=...
  try {
    const u = new URL(req.url);
    const q1 = safeStr(u.searchParams.get("id")).trim();
    if (!isBadIdString(q1)) return q1;

    const q2 = safeStr(u.searchParams.get("change_id")).trim();
    if (!isBadIdString(q2)) return q2;
  } catch {
    // ignore
  }

  // 4) body.id / body.change_id
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
      // swallow (best-effort)
    }
  } catch {
    // swallow: timeline must not block submit
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

function normalizeArtifactType(
  raw: any
): "project_charter" | "change" | "project_closure_report" | string {
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
   - checks BOTH `type` and `artifact_type`
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

  // backfill so DB audit triggers stop failing (best-effort)
  try {
    await supabase.from("change_requests").update({ artifact_id: resolved }).eq("id", cr.id);
  } catch {
    // ignore
  }

  return resolved;
}

/* =========================================================
   Org-driven approvals: rules -> chain + steps + approvers
========================================================= */

async function getOrganisationIdForProject(supabase: any, projectId: string): Promise<string | null> {
  // try organisation_id then organization_id (support both spellings)
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
  // try to load impact_analysis (JSON) if column exists
  const first = await supabase.from("change_requests").select("impact_analysis").eq("id", changeId).maybeSingle();

  if (!first.error) {
    const ia = (first.data as any)?.impact_analysis;
    return extractCostFromImpactAnalysis(ia);
  }

  if (hasImpactAnalysisMissingColumn(safeStr(first.error?.message))) return 0;

  // other errors -> treat as 0 but don't block submit
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
  const maxOk = max == null ? true : amount <= Number(max); // inclusive
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
 * Expand approval group members into auth.user ids.
 * Supports:
 *  A) approval_group_members.approver_id -> organisation_approvers.user_id
 *  B) approver_group_members.user_id direct (fallback)
 */
async function expandGroupMembersToUserIds(supabase: any, groupId: string): Promise<string[]> {
  const gid = safeStr(groupId).trim();
  if (!gid) return [];

  // A) Try approval_group_members -> organisation_approvers.user_id
  try {
    const a = await supabase
      .from("approval_group_members")
      .select("approver_id, is_active")
      .eq("group_id", gid)
      .eq("is_active", true);

    if (!a.error) {
      const approverIds = (Array.isArray(a.data) ? a.data : [])
        .map((r: any) => (r?.approver_id ? String(r.approver_id) : ""))
        .filter(Boolean);

      if (approverIds.length) {
        const b = await supabase
          .from("organisation_approvers")
          .select("id, user_id, is_active")
          .in("id", approverIds)
          .eq("is_active", true);

        if (!b.error) {
          const userIds = (Array.isArray(b.data) ? b.data : [])
            .map((r: any) => (r?.user_id ? String(r.user_id) : ""))
            .filter(Boolean);

          if (userIds.length) return Array.from(new Set(userIds));
        }
      }

      return [];
    }
  } catch {
    // ignore
  }

  // B) Fallback: approver_group_members.user_id direct
  try {
    const { data, error } = await supabase
      .from("approver_group_members")
      .select("user_id, is_active")
      .eq("group_id", gid)
      .eq("is_active", true);

    if (error) return [];
    return (Array.isArray(data) ? data : []).map((r: any) => (r?.user_id ? String(r.user_id) : "")).filter(Boolean);
  } catch {
    return [];
  }
}

/* =========================================================
   IMPORTANT UPDATE:
   Supersede by artifact_id (NOT via artifacts.approval_chain_id)
   - idempotent
   - fixes duplicates under concurrency
========================================================= */

async function supersedeExistingArtifactChain(supabase: any, artifactId: string) {
  const aid = safeStr(artifactId).trim();
  if (!aid) return;

  try {
    await supabase
      .from("approval_chains")
      .update({ is_active: false, status: "superseded" })
      .eq("artifact_id", aid)
      .eq("is_active", true);
  } catch {
    // ignore
  }
}

async function updateArtifactSubmitted(supabase: any, artifactId: string, chainId: string, actorId: string, nowIso: string) {
  // artifacts table uses BOTH status + approval_status; keep resilient for older schemas
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

  // fallback: minimal patch
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
  // other errors should not block submit
}

/* =========================================================
   IMPORTANT UPDATE:
   If unique index (one active chain per artifact) triggers,
   reuse the existing active chain instead of failing.
========================================================= */

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

async function createChainAndStepsFromRules(
  supabase: any,
  args: {
    organisationId: string;
    projectId: string;
    artifactId: string;
    actorId: string;
    amount: number;
    artifactType: string; // desired canonical type (e.g. "change")
  }
): Promise<{ chainId: string; stepIds: string[]; chosenType: string }> {
  const { organisationId, projectId, artifactId, actorId, amount } = args;

  // Always normalize to canonical for storage + UI alignment
  const desiredType = normalizeArtifactType(args.artifactType) || "change";

  // Try canonical first, then legacy aliases as a safety net
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

  // 1) create chain (or reuse existing active chain if unique index fires)
  const chainInsert: any = {
    project_id: projectId,
    artifact_type: chosenType, // must be 'change' for alignment with org panel + constraints
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
    // unique index race: another request already created the active chain
    const existing = await getActiveChainIdForArtifact(supabase, artifactId);
    if (existing) {
      chainId = existing;
    } else {
      throw new Error(safeStr(chainIns.error.message));
    }
  }

  // If we reused an existing chain, check if steps already exist; if so, just return.
  const existingSteps = await supabase
    .from("artifact_approval_steps")
    .select("id, step_order")
    .eq("chain_id", chainId)
    .order("step_order", { ascending: true });

  if (!existingSteps.error && Array.isArray(existingSteps.data) && existingSteps.data.length > 0) {
    return {
      chainId,
      stepIds: existingSteps.data.map((s: any) => String(s.id)),
      chosenType,
    };
  }

  // 2) create steps
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
  for (const s of insertedSteps as any[]) {
    stepIdByOrder.set(Number(s.step_order), String(s.id));
  }

  // 3) create approvers for each step
  const approverRows: any[] = [];

  for (const stepNo of stepNumbers) {
    const stepId = stepIdByOrder.get(stepNo);
    if (!stepId) continue;

    const stepRules = byStep.get(stepNo) || [];
    for (const r of stepRules) {
      if (r.approver_user_id) {
        approverRows.push({
          step_id: stepId,
          approver_type: "user",
          approver_ref: String(r.approver_user_id),
          required: true,
          active: true,
        });
      } else if (r.approval_group_id) {
        const members = await expandGroupMembersToUserIds(supabase, String(r.approval_group_id));
        for (const userId of members) {
          approverRows.push({
            step_id: stepId,
            approver_type: "user",
            approver_ref: String(userId),
            required: true,
            active: true,
          });
        }
      }
    }
  }

  const seen = new Set<string>();
  const deduped = approverRows.filter((x) => {
    const k = `${x.step_id}::${x.approver_type}::${x.approver_ref}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  if (!deduped.length) {
    throw new Error(
      "Approval rules matched, but produced zero approvers. If using Groups, ensure group members are linked to user accounts (organisation_approvers.user_id)."
    );
  }

  const apprIns = await supabase.from("artifact_step_approvers").insert(deduped);
  if (apprIns.error) {
    throw new Error(
      `Failed to insert artifact_step_approvers. Ensure table exists and matches schema. (${safeStr(apprIns.error.message)})`
    );
  }

  return { chainId, stepIds: insertedSteps.map((s: any) => String(s.id)), chosenType };
}

/* =========================================================
   Route
========================================================= */

export async function POST(req: NextRequest, ctx: { params: { id?: string } }) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const changeId = pickChangeId(req, ctx, body);
    if (!changeId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    const supabase = await sb();
    const user = await requireUser(supabase);

    // Load row safely (delivery_status may not exist in legacy)
    let cr: any = null;

    const firstLoad = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id, status, delivery_status, decision_status")
      .eq("id", changeId)
      .maybeSingle();

    if (!firstLoad.error) {
      cr = firstLoad.data;
    } else if (hasDeliveryStatusMissingColumn(safeStr(firstLoad.error.message))) {
      const secondLoad = await supabase
        .from("change_requests")
        .select("id, project_id, artifact_id, status, decision_status")
        .eq("id", changeId)
        .maybeSingle();

      if (secondLoad.error) throw new Error(secondLoad.error.message);
      cr = secondLoad.data;
    } else {
      throw new Error(firstLoad.error.message);
    }

    if (!cr) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

    const projectId = safeStr(cr?.project_id).trim();
    if (!projectId) return NextResponse.json({ ok: false, error: "Missing project_id" }, { status: 500 });

    const role = await requireProjectRole(supabase, projectId, user.id);
    if (!role) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    if (!canEdit(role)) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    const fromLane = safeStr(cr?.delivery_status).trim().toLowerCase() || null;
    const decision = safeStr(cr?.decision_status).trim().toLowerCase();

    // If already decided, don't resubmit
    if (decision === "approved" || decision === "rejected") {
      return NextResponse.json({ ok: false, error: "This change is already decided" }, { status: 400 });
    }

    // Idempotent: already submitted
    if (decision === "submitted") {
      return NextResponse.json({ ok: true, item: cr });
    }

    // Strict discipline: only submit from Analysis
    if (fromLane !== "analysis") {
      return NextResponse.json(
        { ok: false, error: "Only changes in Analysis can be submitted for approval." },
        { status: 409 }
      );
    }

    // Ensure artifact_id exists to avoid audit trigger issues
    const artifactId = await ensureArtifactIdForChangeRequest(supabase, cr);
    if (!artifactId) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing artifact_id (Change Requests artifact). Create/backfill the project artifact first.",
        },
        { status: 409 }
      );
    }

    const now = new Date().toISOString();
    const toLane = "review";

    // Build approval chain from org rules (artifact_approver_rules)
    const organisationId = await getOrganisationIdForProject(supabase, projectId);
    if (!organisationId) {
      return NextResponse.json(
        { ok: false, error: "Project has no organisation_id. Configure organisation_id on the project first." },
        { status: 409 }
      );
    }

    const amount = await loadImpactCostForChange(supabase, changeId);

    // best-effort: supersede any prior active chains linked to the artifact
    await supersedeExistingArtifactChain(supabase, artifactId);

    // canonical artifactType is 'change' (aligns with org panel + constraints)
    const { chainId, chosenType } = await createChainAndStepsFromRules(supabase, {
      organisationId,
      projectId,
      artifactId,
      actorId: user.id,
      amount,
      artifactType: "change",
    });

    await updateArtifactSubmitted(supabase, artifactId, chainId, user.id, now);
    await tryAttachApprovalChainIdToChange(supabase, changeId, chainId);

    // Submit => move lane to review + decision_status=submitted
    const patch: any = {
      delivery_status: toLaneDb(toLane),
      decision_status: "submitted",

      // clear any previous decision metadata
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

    let updated = firstUpdate.data;
    const deliveryMissing = Boolean(firstUpdate.error && hasDeliveryStatusMissingColumn(safeStr(firstUpdate.error.message)));

    if (deliveryMissing) {
      delete patch.delivery_status;

      const secondUpdate = await supabase
        .from("change_requests")
        .update(patch)
        .eq("id", changeId)
        .select("id, project_id, artifact_id, status, decision_status")
        .maybeSingle();

      if (secondUpdate.error) throw new Error(secondUpdate.error.message);
      updated = secondUpdate.data;
    } else if (firstUpdate.error) {
      throw new Error(firstUpdate.error.message);
    }

    // Audit event (best effort)
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
          fromValue: fromLane || null,
          toValue: deliveryMissing ? null : toLane,
          note: null,
          payload: {
            decision_status: { from: decision || null, to: "submitted" },
            lane: { from: fromLane || null, to: deliveryMissing ? null : toLane },
            approval_chain_id: chainId,
            approval_chain_artifact_type: chosenType, // should be 'change'
            amount,
            submitted_at: now,
          },
        } as any
      );
    } catch {
      // swallow
    }

    await insertTimelineEvent(supabase, {
      project_id: projectId,
      change_id: changeId,
      event_type: "status_changed",
      from_status: fromLane,
      to_status: deliveryMissing ? null : toLane,
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
      },
    });

    return NextResponse.json({
      ok: true,
      item: updated,
      approval_chain_id: chainId,
      amount,
      artifact_type: chosenType,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Server error";
    return NextResponse.json({ ok: false, error: msg }, { status: msg === "Unauthorized" ? 401 : 500 });
  }
}

