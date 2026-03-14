"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

// ✅ Charter submit validation
import { assertCharterReadyForSubmit } from "@/lib/charter/charter-validation";

/* =========================================================
   Helpers
========================================================= */

function throwDb(error: any, label: string): never {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  const hint = error?.hint ?? "";
  const details = error?.details ?? "";
  throw new Error(
    `[${label}] ${code} ${msg}${hint ? ` | hint: ${hint}` : ""}${details ? ` | details: ${details}` : ""}`
  );
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

async function requireUser() {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throwDb(authErr, "auth.getUser");
  if (!auth?.user) redirect("/login");
  return { supabase, user: auth.user };
}

async function requireMemberRole(supabase: any, projectId: string, userId: string) {
  const { data: mem, error } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (error) throwDb(error, "project_members.select");
  if (!mem) throw new Error("Not a project member.");
  return String((mem as any)?.role ?? "viewer").toLowerCase();
}

function canSubmitByRole(myRole: string, isAuthor: boolean) {
  return isAuthor || myRole === "owner" || myRole === "editor";
}

/**
 * Legacy fallback approver policy.
 * Runtime engine is now preferred on submit.
 * Direct approve / changes-request / reject still use this gate.
 */
const INCLUDE_EDITORS_AS_APPROVERS = false;

function canApproveByRole(myRole: string) {
  if (INCLUDE_EDITORS_AS_APPROVERS) return myRole === "owner" || myRole === "editor";
  return myRole === "owner";
}

async function getArtifact(supabase: any, artifactId: string) {
  const { data, error } = await supabase
    .from("artifacts")
    .select(
      [
        "id",
        "project_id",
        "user_id",
        "type",
        "title",
        "content",
        "content_json",
        "is_locked",
        "approval_status",
        "submitted_at",
        "submitted_by",
        "approved_at",
        "approved_by",
        "rejected_at",
        "rejected_by",
        "rejection_reason",
        "is_current",
        "is_baseline",
        "root_artifact_id",
        "parent_artifact_id",
        "version",
        "updated_at",
        "approval_chain_id",
      ].join(", ")
    )
    .eq("id", artifactId)
    .maybeSingle();

  if (error) throwDb(error, "artifacts.select");
  if (!data) throw new Error("Artifact not found.");
  return data as any;
}

async function writeAuditLog(
  supabase: any,
  args: {
    project_id: string;
    artifact_id: string;
    actor_id: string | null;
    action: string;
    before?: any;
    after?: any;
  }
) {
  const { error } = await supabase.from("artifact_audit_log").insert({
    project_id: args.project_id,
    artifact_id: args.artifact_id,
    actor_id: args.actor_id,
    action: args.action,
    before: args.before ?? null,
    after: args.after ?? null,
  });
  if (error) throwDb(error, "artifact_audit_log.insert");
}

/* =========================================================
   Artifact type helpers
========================================================= */

function isProjectCharterType(type: any) {
  const t = String(type ?? "").toLowerCase();
  return (
    t === "project_charter" ||
    t === "project charter" ||
    t === "charter" ||
    t === "projectcharter" ||
    t === "pid"
  );
}

function isClosureReportType(type: any) {
  const t = String(type ?? "").toLowerCase().trim();
  return (
    t === "project_closure_report" ||
    t === "project closure report" ||
    t === "closure_report" ||
    t === "closure report" ||
    t === "project_closeout" ||
    t === "closeout" ||
    t === "close_out" ||
    t === "status_dashboard" ||
    t === "status dashboard"
  );
}

function isApprovalEligibleArtifact(type: any) {
  return isProjectCharterType(type) || isClosureReportType(type);
}

function normalizeArtifactType(type: any) {
  if (isProjectCharterType(type)) return "project_charter";
  if (isClosureReportType(type)) return "project_closure_report";
  return safeStr(type).trim().toLowerCase();
}

/* =========================================================
   Governance runtime helpers
========================================================= */

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

async function getOrganisationIdForProject(supabase: any, projectId: string): Promise<string | null> {
  const p1 = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!p1.error) {
    const id = safeStr((p1.data as any)?.organisation_id);
    if (id) return id;
  }

  const msg1 = safeStr(p1.error?.message);
  if (!msg1 || !isMissingColumnError(msg1, "organisation_id")) {
    return null;
  }

  const p2 = await supabase
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!p2.error) {
    const id = safeStr((p2.data as any)?.organization_id);
    if (id) return id;
  }

  return null;
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
 * NEW schema expansion:
 * approval_group_members.approver_id -> organisation_approvers.id -> organisation_approvers.user_id
 */
async function expandApprovalGroupMembersToUserIds(supabase: any, groupId: string): Promise<string[]> {
  const gid = safeStr(groupId).trim();
  if (!gid) return [];

  const gm = await supabase
    .from("approval_group_members")
    .select("approver_id")
    .eq("group_id", gid);

  if (gm.error) return [];

  const approverIds = (Array.isArray(gm.data) ? gm.data : [])
    .map((r: any) => safeStr(r?.approver_id))
    .filter(Boolean);

  if (!approverIds.length) return [];

  const oa = await supabase
    .from("organisation_approvers")
    .select("id, user_id, is_active")
    .in("id", approverIds)
    .eq("is_active", true);

  if (oa.error) return [];

  return Array.from(
    new Set(
      (Array.isArray(oa.data) ? oa.data : [])
        .map((r: any) => safeStr(r?.user_id))
        .filter(Boolean)
    )
  );
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
  } catch {
    // ignore
  }
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

  const desiredType = normalizeArtifactType(args.artifactType);
  const typeCandidates = Array.from(
    new Set(
      isProjectCharterType(desiredType)
        ? ["project_charter", "project charter", "charter", "pid"]
        : isClosureReportType(desiredType)
        ? [
            "project_closure_report",
            "project closure report",
            "closure_report",
            "closure report",
            "project_closeout",
            "closeout",
          ]
        : [desiredType]
    )
  );

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

  await supersedeExistingArtifactChain(supabase, artifactId);

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
      status: stepNo === stepNumbers[0] ? "pending" : "pending",
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
        const members = await expandApprovalGroupMembersToUserIds(
          supabase,
          String(r.approval_group_id)
        );
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
      "Approval rules matched, but produced zero approvers. Ensure approver_user_id is set or the approval group has active members."
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
    const missingMemberIdCol = isMissingColumnError(msg, "approver_member_id");

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
      throw new Error(
        `Failed to insert artifact_step_approvers (legacy fallback). (${safeStr(try2.error.message)})`
      );
    }
  }

  return { chainId, stepIds: insertedSteps.map((s: any) => String(s.id)), chosenType };
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
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    approved_at: null,
    approved_by: null,
  };

  const u1 = await supabase.from("artifacts").update(patch1).eq("id", artifactId);
  if (!u1.error) return;

  const patch2: any = {
    approval_chain_id: chainId,
    submitted_at: nowIso,
    submitted_by: actorId,
    approval_status: "submitted",
    is_locked: true,
    locked_at: nowIso,
    locked_by: actorId,
    rejected_at: null,
    rejected_by: null,
    rejection_reason: null,
    approved_at: null,
    approved_by: null,
  };

  const u2 = await supabase.from("artifacts").update(patch2).eq("id", artifactId);
  if (u2.error) throwDb(u2.error, "artifacts.update(submit_runtime)");
}

/* =========================================================
   Suggestions (unchanged)
========================================================= */

function clampInt(x: any, min: number, max: number) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const v = Math.trunc(n);
  if (v < min || v > max) return null;
  return v;
}

export async function addSuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const anchor = String(formData.get("anchor") ?? "content").trim() || "content";
  const suggested_text = String(formData.get("suggested_text") ?? "").trim();

  const color = String(formData.get("color") ?? "#2563eb").trim() || "#2563eb";
  const bold = String(formData.get("bold") ?? "").toLowerCase() === "true";
  const italic = String(formData.get("italic") ?? "").toLowerCase() === "true";

  const range_start_raw = formData.get("range_start");
  const range_end_raw = formData.get("range_end");

  if (!projectId || !artifactId) throw new Error("project_id and artifact_id are required.");
  if (!suggested_text) throw new Error("suggested_text is required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  if (!(myRole === "owner" || myRole === "editor")) {
    throw new Error("Only project owners/editors can add suggestions.");
  }

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const style = { color, bold, italic };

  let range: any = null;
  const contentLen = String(a0.content ?? "").length;
  const rs = range_start_raw !== null ? clampInt(range_start_raw, 0, contentLen) : null;
  const re = range_end_raw !== null ? clampInt(range_end_raw, 0, contentLen) : null;

  const anchorLower = anchor.toLowerCase();
  if ((anchorLower === "content" || anchorLower === "general") && rs !== null && re !== null && re >= rs) {
    range = { start: rs, end: re };
  }

  const { error } = await supabase.from("artifact_suggestions").insert({
    project_id: projectId,
    artifact_id: artifactId,
    actor_user_id: user.id,
    anchor,
    range,
    suggested_text,
    style,
    status: "open",
  });

  if (error) throwDb(error, "artifact_suggestions.insert");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "suggest_edit",
    before: { anchor, range: range ?? null },
    after: { anchor, range: range ?? null, style },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function applySuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();

  if (!projectId || !artifactId || !suggestionId) throw new Error("project_id, artifact_id, suggestion_id are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  if (!(myRole === "owner" || myRole === "editor")) throw new Error("Only owners/editors can apply suggestions.");

  const { data: s0, error: sErr } = await supabase
    .from("artifact_suggestions")
    .select("id, status, anchor, range, suggested_text, style")
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (sErr) throwDb(sErr, "artifact_suggestions.select(apply)");
  if (!s0) throw new Error("Suggestion not found.");

  const status0 = String((s0 as any).status ?? "open").toLowerCase();
  if (status0 === "applied") {
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    return;
  }

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const approvalStatus = String(a0.approval_status ?? "draft").toLowerCase();
  const canMutateArtifact = !a0.is_locked && (approvalStatus === "draft" || approvalStatus === "changes_requested");
  if (!canMutateArtifact) throw new Error("You can only apply suggestions when the artifact is unlocked (draft/CR).");

  const anchor = String((s0 as any).anchor ?? "content").toLowerCase();
  const suggestedText = String((s0 as any).suggested_text ?? "").trim();
  if (!suggestedText) throw new Error("Suggestion is empty.");

  const beforeArtifact = { title: a0.title, content: a0.content };

  if (anchor === "title") {
    const { error: upArtErr } = await supabase.from("artifacts").update({ title: suggestedText }).eq("id", artifactId);
    if (upArtErr) throwDb(upArtErr, "artifacts.update(apply_title)");
  } else {
    const content = String(a0.content ?? "");
    const range = (s0 as any).range as any;

    let nextContent = content;

    if (range && typeof range === "object") {
      const start = clampInt((range as any).start, 0, content.length);
      const end = clampInt((range as any).end, 0, content.length);
      if (start !== null && end !== null && end >= start) {
        nextContent = content.slice(0, start) + suggestedText + content.slice(end);
      } else {
        nextContent = content + `\n\n---\nAPPLIED SUGGESTION [${anchor}]\n${suggestedText}\n`;
      }
    } else {
      nextContent = content + `\n\n---\nAPPLIED SUGGESTION [${anchor}]\n${suggestedText}\n`;
    }

    const { error: upArtErr } = await supabase.from("artifacts").update({ content: nextContent }).eq("id", artifactId);
    if (upArtErr) throwDb(upArtErr, "artifacts.update(apply_content)");
  }

  const { error: upSugErr } = await supabase
    .from("artifact_suggestions")
    .update({ status: "applied" })
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId);
  if (upSugErr) throwDb(upSugErr, "artifact_suggestions.update(applied)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "suggestion_applied_to_artifact",
    before: { suggestion_id: suggestionId, suggestion_status: status0, anchor, artifact: beforeArtifact },
    after: { suggestion_id: suggestionId, suggestion_status: "applied", applied_to: anchor === "title" ? "title" : "content" },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function dismissSuggestion(formData: FormData) {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const suggestionId = String(formData.get("suggestion_id") ?? "").trim();

  if (!projectId || !artifactId || !suggestionId) throw new Error("project_id, artifact_id, suggestion_id are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  if (!(myRole === "owner" || myRole === "editor")) throw new Error("Only owners/editors can dismiss suggestions.");

  const { data: s0, error: sErr } = await supabase
    .from("artifact_suggestions")
    .select("id, status")
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (sErr) throwDb(sErr, "artifact_suggestions.select(dismiss)");
  if (!s0) throw new Error("Suggestion not found.");

  const status0 = String((s0 as any).status ?? "open").toLowerCase();
  if (status0 === "dismissed") {
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    return;
  }

  const { error: upErr } = await supabase
    .from("artifact_suggestions")
    .update({ status: "dismissed" })
    .eq("id", suggestionId)
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId);

  if (upErr) throwDb(upErr, "artifact_suggestions.update(dismissed)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "suggestion_dismissed",
    before: { suggestion_id: suggestionId, status: status0 },
    after: { suggestion_id: suggestionId, status: "dismissed" },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================================================
   Artifact title rename (unchanged)
========================================================= */

export async function renameArtifactTitle(formData: FormData) {
  const { supabase, user } = await requireUser();

  const projectId = String(formData.get("project_id") ?? "").trim();
  const artifactId = String(formData.get("artifact_id") ?? "").trim();
  const title = String(formData.get("title") ?? "").trim();

  if (!projectId || !artifactId) throw new Error("project_id and artifact_id are required.");
  if (!title) throw new Error("Title is required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  const isAuthor = String(a0.user_id) === user.id;
  const canRename = isAuthor || myRole === "owner" || myRole === "editor";
  if (!canRename) throw new Error("Only the author or owners/editors can rename the artifact.");

  const approvalStatus = String(a0.approval_status ?? "draft").toLowerCase();
  const unlocked = !a0.is_locked && (approvalStatus === "draft" || approvalStatus === "changes_requested");
  if (!unlocked) throw new Error("You can only rename when the artifact is unlocked (draft or changes requested).");

  const { error } = await supabase.from("artifacts").update({ title }).eq("id", artifactId);
  if (error) throwDb(error, "artifacts.update(rename_title)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "rename_title",
    before: { title: a0.title },
    after: { title },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================================================
   Approvals — Governance runtime enabled
========================================================= */

export async function submitArtifactForApproval(projectId: string, artifactId: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);
  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  if (!a0.is_current) throw new Error("Only the current version can be submitted.");

  if (!isApprovalEligibleArtifact(a0.type)) {
    throw new Error("Submit for approval is only enabled for Project Charter and Project Closure Report.");
  }

  const isAuthor = String(a0.user_id) === user.id;
  if (!canSubmitByRole(myRole, isAuthor)) {
    throw new Error("Only the author or project owners/editors can submit/resubmit.");
  }

  const st = String(a0.approval_status ?? "draft").toLowerCase();
  if (!(st === "draft" || st === "changes_requested")) {
    throw new Error(`Cannot submit from status: ${st}`);
  }

  if (isProjectCharterType(a0.type)) {
    assertCharterReadyForSubmit(a0.content_json);
  }

  const organisationId = await getOrganisationIdForProject(supabase, projectId);
  if (!organisationId) {
    throw new Error("Could not resolve organisation_id for project. Governance approval engine cannot start.");
  }

  const nowIso = new Date().toISOString();

  const runtime = await createChainAndStepsFromRules(supabase, {
    organisationId,
    projectId,
    artifactId,
    actorId: user.id,
    amount: 0,
    artifactType: normalizeArtifactType(a0.type),
  });

  await updateArtifactSubmitted(supabase, artifactId, runtime.chainId, user.id, nowIso);

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: st === "changes_requested" ? "resubmit" : "submit",
    before: {
      approval_status: a0.approval_status,
      is_locked: a0.is_locked,
      approval_chain_id: a0.approval_chain_id ?? null,
    },
    after: {
      approval_status: "submitted",
      is_locked: true,
      approval_chain_id: runtime.chainId,
      runtime_steps_created: true,
      runtime_artifact_type: runtime.chosenType,
    },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function approveArtifact(projectId: string, artifactId: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");

  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (!canApproveByRole(myRole)) throw new Error("You are not an eligible approver for this project.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot approve your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const nowIso = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "approved",
      approved_at: nowIso,
      approved_by: user.id,
      is_locked: true,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(approve)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "approve",
    before: { approval_status: a0.approval_status, is_locked: a0.is_locked },
    after: { approval_status: "approved", approved_by: user.id, approved_at: nowIso },
  });

  const baselineId = await promoteApprovedToBaseline(supabase, {
    projectId,
    approvedArtifactId: artifactId,
    artifactType: a0.type,
    actorId: user.id,
  });

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "baseline_promoted",
    before: { is_baseline: false },
    after: { is_baseline: true, baseline_artifact_id: baselineId },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function requestChangesArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (!canApproveByRole(myRole)) throw new Error("You are not an eligible approver for this project.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot request changes on your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const nowIso = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "changes_requested",
      rejected_at: nowIso,
      rejected_by: user.id,
      rejection_reason: reason ?? null,
      is_locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(request_changes)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "request_changes",
    before: { approval_status: a0.approval_status, is_locked: a0.is_locked },
    after: { approval_status: "changes_requested", reason: reason ?? null, is_locked: false },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

export async function rejectFinalArtifact(projectId: string, artifactId: string, reason?: string) {
  const { supabase, user } = await requireUser();
  if (!projectId || !artifactId) throw new Error("projectId and artifactId are required.");

  const myRole = await requireMemberRole(supabase, projectId, user.id);

  const a0 = await getArtifact(supabase, artifactId);
  if (String(a0.project_id) !== projectId) throw new Error("Artifact does not belong to this project.");
  if (!isApprovalEligibleArtifact(a0.type)) throw new Error("This artifact does not use approvals.");
  if (!canApproveByRole(myRole)) throw new Error("You are not an eligible approver for this project.");
  if (String(a0.user_id) === user.id) throw new Error("You cannot reject your own artifact.");

  const st = String(a0.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Artifact is not currently submitted for approval.");

  const nowIso = new Date().toISOString();

  const { error: upErr } = await supabase
    .from("artifacts")
    .update({
      approval_status: "rejected",
      rejected_at: nowIso,
      rejected_by: user.id,
      rejection_reason: reason ?? null,
      is_locked: false,
      locked_at: null,
      locked_by: null,
    })
    .eq("id", artifactId);

  if (upErr) throwDb(upErr, "artifacts.update(reject_final)");

  await writeAuditLog(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_id: user.id,
    action: "reject_final",
    before: { approval_status: a0.approval_status, is_locked: a0.is_locked },
    after: { approval_status: "rejected", reason: reason ?? null, is_locked: false },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================================================
   Baseline promotion (internal)
========================================================= */

async function promoteApprovedToBaseline(
  supabase: any,
  args: { projectId: string; approvedArtifactId: string; artifactType: string | null; actorId: string }
): Promise<string> {
  const { projectId, approvedArtifactId, artifactType, actorId } = args;
  if (!artifactType) throw new Error("Artifact type is required to create a baseline.");

  const { error: retireErr } = await supabase
    .from("artifacts")
    .update({ is_current: false })
    .eq("project_id", projectId)
    .eq("type", artifactType)
    .eq("is_baseline", true)
    .eq("is_current", true);

  if (retireErr) throwDb(retireErr, "artifacts.update(retire_baseline)");

  const a0 = await getArtifact(supabase, approvedArtifactId);

  const { data: inserted, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      user_id: a0.user_id ?? actorId,
      type: a0.type,
      title: a0.title,
      content: String(a0.content ?? ""),
      content_json: a0.content_json ?? null,

      is_locked: true,
      locked_at: new Date().toISOString(),
      locked_by: actorId,

      version: (a0.version ?? 1) + 1,
      parent_artifact_id: a0.id,
      root_artifact_id: a0.root_artifact_id ?? a0.id,

      approval_status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: actorId,

      is_current: true,
      is_baseline: true,

      status: "approved",
    })
    .select("id")
    .single();

  if (insErr) throwDb(insErr, "artifacts.insert(baseline)");
  return String(inserted.id);
}