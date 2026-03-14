import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * UTILS
 */
function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function normalizeArtifactType(type: unknown) {
  const t = safeStr(type).trim().toLowerCase();
  if (["project_charter", "project charter", "charter", "projectcharter", "pid"].includes(t)) {
    return "project_charter";
  }
  if (["project_closure_report", "project closure report", "closure_report", "closure report", "project_closeout", "closeout", "close_out", "status_dashboard", "status dashboard"].includes(t)) {
    return "project_closure_report";
  }
  return t;
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

function labelToRole(label: string) {
  return safeStr(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "approver";
}

function inBand(amount: number, min: number, max: number | null) {
  const minOk = amount >= (Number.isFinite(min) ? min : 0);
  const maxOk = max == null ? true : amount <= Number(max);
  return minOk && maxOk;
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

/**
 * DB OPERATIONS
 */

async function supersedeExistingArtifactChains(supabase: SupabaseClient, artifactId: string) {
  await supabase
    .from("approval_chains")
    .update({ is_active: false, status: "superseded" })
    .eq("artifact_id", artifactId)
    .eq("is_active", true);
}

async function loadRulesForArtifact(
  supabase: SupabaseClient,
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
    .eq("is_active", true)
    .order("step", { ascending: true });

  if (error) throw new Error(`artifact_approver_rules lookup failed: ${error.message}`);

  const rows = (Array.isArray(data) ? data : []).map((r: any) => ({
    id: String(r.id),
    step: Number(r.step ?? 1),
    approval_role: safeStr(r.approval_role) || "Approval",
    approver_user_id: r.approver_user_id ? String(r.approver_user_id) : null,
    approval_group_id: r.approval_group_id ? String(r.approval_group_id) : null,
    min_amount: Number(r.min_amount ?? 0) || 0,
    max_amount: r.max_amount == null ? null : Number(r.max_amount),
  }));

  return rows.filter((r) => Number.isFinite(r.step) && r.step >= 1 && inBand(amount, r.min_amount, r.max_amount));
}

async function expandApprovalGroupMembersToUserIds(supabase: SupabaseClient, groupId: string): Promise<string[]> {
  const gid = safeStr(groupId).trim();
  if (!gid) return [];
  const gm = await supabase.from("approval_group_members").select("approver_id").eq("group_id", gid);
  if (gm.error) throw new Error(`approval_group_members lookup failed: ${gm.error.message}`);

  const approverIds = (Array.isArray(gm.data) ? gm.data : []).map((r: any) => safeStr(r?.approver_id)).filter(Boolean);
  if (!approverIds.length) return [];

  const oa = await supabase.from("organisation_approvers").select("user_id").in("id", approverIds).eq("is_active", true);
  if (oa.error) throw new Error(`organisation_approvers lookup failed: ${oa.error.message}`);

  return Array.from(new Set((Array.isArray(oa.data) ? oa.data : []).map((r: any) => safeStr(r?.user_id)).filter(Boolean)));
}

async function getUserEmailsByIds(supabase: SupabaseClient, userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set((userIds || []).map((x) => safeStr(x)).filter(Boolean)));
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const { data, error } = await supabase.from("profiles").select("id, email").in("id", ids);
  if (error) throw new Error(`profiles email lookup failed: ${error.message}`);
  (data || []).forEach((r: any) => { if (r.id && r.email) out.set(r.id, r.email); });
  return out;
}

async function insertApprovalStepApprovers(supabase: SupabaseClient, rows: any[]) {
  if (!rows.length) return;
  const { error } = await supabase.from("approval_step_approvers").insert(rows);
  if (error) {
    const msg = safeStr(error.message);
    const missingEmail = isMissingColumnError(msg, "email");
    const missingRole = isMissingColumnError(msg, "role");
    
    const fallbackRows = rows.map(r => {
      const o: any = { step_id: r.step_id, user_id: r.user_id };
      if (!missingEmail) o.email = r.email;
      if (!missingRole) o.role = r.role;
      return o;
    });
    const { error: fErr } = await supabase.from("approval_step_approvers").insert(fallbackRows);
    if (fErr) throw new Error(`Fallback insert failed: ${fErr.message}`);
  }
}

/**
 * MAIN BUILDER
 */
export async function buildRuntimeApprovalChain(
  supabase: SupabaseClient,
  args: { organisationId: string; projectId: string; artifactId: string; actorId: string; artifactType: string; amount?: number | null; }
) {
  const amount = Number(args.amount ?? 0) || 0;
  const desiredType = normalizeArtifactType(args.artifactType);

  // 1. Resolve Rules
  let rules = await loadRulesForArtifact(supabase, args.organisationId, desiredType, amount);
  if (!rules.length) throw new Error("No matching approval rules found.");

  // 2. Map Approvers by Step
  const stepNumbers = Array.from(new Set(rules.map(r => r.step))).sort((a,b) => a - b);
  const approversByStep = new Map<number, any[]>();

  for (const stepNo of stepNumbers) {
    const stepRules = rules.filter(r => r.step === stepNo);
    const collected: any[] = [];
    for (const rule of stepRules) {
      if (rule.approver_user_id) collected.push({ userId: rule.approver_user_id, role: rule.approval_role });
      if (rule.approval_group_id) {
        const members = await expandApprovalGroupMembersToUserIds(supabase, rule.approval_group_id);
        members.forEach(m => collected.push({ userId: m, role: rule.approval_role }));
      }
    }
    approversByStep.set(stepNo, collected);
  }

  // 3. Create Chain Record
  await supersedeExistingArtifactChains(supabase, args.artifactId);
  const { data: chain, error: cErr } = await supabase.from("approval_chains").insert({
    organisation_id: args.organisationId, project_id: args.projectId, artifact_id: args.artifactId,
    artifact_type: desiredType, is_active: true, status: "active", created_by: args.actorId
  }).select("id").single();
  if (cErr) throw cErr;

  // 4. Create Steps
  const stepRows = stepNumbers.map((stepNo, i) => ({
    artifact_id: args.artifactId, chain_id: chain.id, project_id: args.projectId,
    artifact_type: desiredType, step_order: stepNo, name: `Step ${stepNo}`,
    status: i === 0 ? "pending" : "waiting", mode: "serial"
  }));
  const { data: steps, error: sErr } = await supabase.from("artifact_approval_steps").insert(stepRows).select();
  if (sErr) throw sErr;

  // 5. Finalize Approvers
  const allUserIds = Array.from(new Set(Array.from(approversByStep.values()).flat().map(a => a.userId)));
  const emails = await getUserEmailsByIds(supabase, allUserIds);

  const finalApproverRows: any[] = [];
  steps.forEach((s: any) => {
    const apps = approversByStep.get(s.step_order) || [];
    apps.forEach(a => finalApproverRows.push({
      step_id: s.id, user_id: a.userId, email: emails.get(a.userId) || null, role: labelToRole(a.role)
    }));
  });

  await insertApprovalStepApprovers(supabase, finalApproverRows);

  return { chainId: chain.id, stepIds: steps.map((s: any) => s.id), chosenType: desiredType };
}
