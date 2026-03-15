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

  if (
    [
      "project_closure_report",
      "project closure report",
      "closure_report",
      "closure report",
      "project_closeout",
      "closeout",
      "close_out",
      "status_dashboard",
      "status dashboard",
    ].includes(t)
  ) {
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
  return (
    safeStr(label)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "approver"
  );
}

function inBand(amount: number, min: number, max: number | null) {
  const minOk = amount >= (Number.isFinite(min) ? min : 0);
  const maxOk = max == null ? true : amount <= Number(max);
  return minOk && maxOk;
}

function dedupeApprovers(rows: Array<{ userId: string; role: string }>) {
  const out = new Map<string, { userId: string; role: string }>();

  for (const row of rows) {
    const userId = safeStr(row?.userId).trim();
    if (!userId) continue;
    if (!out.has(userId)) {
      out.set(userId, {
        userId,
        role: safeStr(row?.role).trim() || "Approval",
      });
    }
  }

  return Array.from(out.values());
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

type StepApprover = {
  userId: string;
  role: string;
};

/**
 * DB OPERATIONS
 */

async function supersedeExistingArtifactChains(supabase: SupabaseClient, artifactId: string) {
  const { error } = await supabase
    .from("approval_chains")
    .update({ is_active: false, status: "superseded" })
    .eq("artifact_id", artifactId)
    .eq("is_active", true);

  if (error) {
    throw new Error(`approval_chains supersede failed: ${error.message}`);
  }
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
    .select(
      "id, step, approval_role, approver_user_id, approval_group_id, min_amount, max_amount, is_active"
    )
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

  return rows.filter(
    (r) => Number.isFinite(r.step) && r.step >= 1 && inBand(amount, r.min_amount, r.max_amount)
  );
}

async function expandApprovalGroupMembersToUserIds(
  supabase: SupabaseClient,
  groupId: string
): Promise<string[]> {
  const gid = safeStr(groupId).trim();
  if (!gid) return [];

  const gm = await supabase.from("approval_group_members").select("approver_id").eq("group_id", gid);
  if (gm.error) throw new Error(`approval_group_members lookup failed: ${gm.error.message}`);

  const approverIds = (Array.isArray(gm.data) ? gm.data : [])
    .map((r: any) => safeStr(r?.approver_id))
    .filter(Boolean);

  if (!approverIds.length) return [];

  const oa = await supabase
    .from("organisation_approvers")
    .select("user_id")
    .in("id", approverIds)
    .eq("is_active", true);

  if (oa.error) throw new Error(`organisation_approvers lookup failed: ${oa.error.message}`);

  return Array.from(
    new Set((Array.isArray(oa.data) ? oa.data : []).map((r: any) => safeStr(r?.user_id)).filter(Boolean))
  );
}

async function getUserEmailsByIds(
  supabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string>> {
  const ids = Array.from(new Set((userIds || []).map((x) => safeStr(x)).filter(Boolean)));
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const { data, error } = await supabase.from("profiles").select("id, email").in("id", ids);
  if (error) throw new Error(`profiles email lookup failed: ${error.message}`);

  (data || []).forEach((r: any) => {
    if (r.id && r.email) out.set(r.id, r.email);
  });

  return out;
}

async function insertApprovalStepApprovers(supabase: SupabaseClient, rows: any[]) {
  if (!rows.length) return;

  const { error } = await supabase.from("approval_step_approvers").insert(rows);
  if (!error) return;

  const msg = safeStr(error.message);
  const missingEmail = isMissingColumnError(msg, "email");
  const missingRole = isMissingColumnError(msg, "role");

  const fallbackRows = rows.map((r) => {
    const o: any = { step_id: r.step_id, user_id: r.user_id };
    if (!missingEmail) o.email = r.email;
    if (!missingRole) o.role = r.role;
    return o;
  });

  const { error: fErr } = await supabase.from("approval_step_approvers").insert(fallbackRows);
  if (fErr) throw new Error(`Fallback insert failed: ${fErr.message}`);
}

async function purgeExistingArtifactStepRows(supabase: SupabaseClient, artifactId: string) {
  const { data: existingSteps, error: existingStepsErr } = await supabase
    .from("artifact_approval_steps")
    .select("id")
    .eq("artifact_id", artifactId);

  if (existingStepsErr) {
    throw new Error(`artifact_approval_steps pre-clean lookup failed: ${existingStepsErr.message}`);
  }

  const stepIds = (existingSteps ?? [])
    .map((r: any) => safeStr(r?.id).trim())
    .filter(Boolean);

  if (stepIds.length) {
    const { error: approverDeleteErr } = await supabase
      .from("approval_step_approvers")
      .delete()
      .in("step_id", stepIds);

    if (approverDeleteErr) {
      throw new Error(`approval_step_approvers cleanup failed: ${approverDeleteErr.message}`);
    }
  }

  const { error: stepDeleteErr } = await supabase
    .from("artifact_approval_steps")
    .delete()
    .eq("artifact_id", artifactId);

  if (stepDeleteErr) {
    throw new Error(`artifact_approval_steps cleanup failed: ${stepDeleteErr.message}`);
  }
}

/**
 * MAIN BUILDER
 */
export async function buildRuntimeApprovalChain(
  supabase: SupabaseClient,
  args: {
    organisationId: string;
    projectId: string;
    artifactId: string;
    actorId: string;
    artifactType: string;
    amount?: number | null;
  }
) {
  const amount = Number(args.amount ?? 0) || 0;
  const desiredType = normalizeArtifactType(args.artifactType);

  // 1. Resolve rules
  const rules = await loadRulesForArtifact(supabase, args.organisationId, desiredType, amount);
  if (!rules.length) {
    throw new Error("No matching approval rules found.");
  }

  // 2. Resolve and dedupe approvers per logical rule step
  const logicalStepNumbers = Array.from(new Set(rules.map((r) => r.step)))
    .filter((n) => Number.isFinite(n) && n >= 1)
    .sort((a, b) => a - b);

  const approversByLogicalStep = new Map<number, StepApprover[]>();

  for (const logicalStepNo of logicalStepNumbers) {
    const stepRules = rules.filter((r) => r.step === logicalStepNo);
    const collected: StepApprover[] = [];

    for (const rule of stepRules) {
      if (rule.approver_user_id) {
        collected.push({
          userId: rule.approver_user_id,
          role: rule.approval_role,
        });
      }

      if (rule.approval_group_id) {
        const members = await expandApprovalGroupMembersToUserIds(supabase, rule.approval_group_id);
        for (const memberId of members) {
          collected.push({
            userId: memberId,
            role: rule.approval_role,
          });
        }
      }
    }

    const uniqueApprovers = dedupeApprovers(collected);
    if (uniqueApprovers.length) {
      approversByLogicalStep.set(logicalStepNo, uniqueApprovers);
    }
  }

  const activeLogicalSteps = logicalStepNumbers.filter(
    (stepNo) => (approversByLogicalStep.get(stepNo) || []).length > 0
  );

  if (!activeLogicalSteps.length) {
    throw new Error("No valid approvers resolved for the matching approval rules.");
  }

  // 3. Supersede old chains + purge old rows
  await supersedeExistingArtifactChains(supabase, args.artifactId);
  await purgeExistingArtifactStepRows(supabase, args.artifactId);

  // 4. Create new chain
  const { data: chain, error: cErr } = await supabase
    .from("approval_chains")
    .insert({
      organisation_id: args.organisationId,
      project_id: args.projectId,
      artifact_id: args.artifactId,
      artifact_type: desiredType,
      is_active: true,
      status: "active",
      created_by: args.actorId,
    })
    .select("id")
    .single();

  if (cErr) {
    throw new Error(`approval_chains insert failed: ${cErr.message}`);
  }

  // 5. Create steps with guaranteed sequential order 1..N
  const stepRows = activeLogicalSteps.map((logicalStepNo, index) => ({
    artifact_id: args.artifactId,
    chain_id: chain.id,
    project_id: args.projectId,
    artifact_type: desiredType,
    step_order: index + 1,
    name: `Step ${index + 1}`,
    status: index === 0 ? "pending" : "waiting",
    mode: "serial",
    __logical_step_no: logicalStepNo,
  }));

  const insertableStepRows = stepRows.map(({ __logical_step_no, ...row }) => row);

  const { data: steps, error: sErr } = await supabase
    .from("artifact_approval_steps")
    .insert(insertableStepRows)
    .select("id, step_order");

  if (sErr) {
    throw new Error(`artifact_approval_steps insert failed: ${sErr.message}`);
  }

  const insertedSteps = Array.isArray(steps) ? steps : [];
  if (!insertedSteps.length) {
    throw new Error("Approval chain created but no steps returned.");
  }

  // 6. Sort returned rows explicitly — Supabase does not guarantee insert().select() order
  const orderedSteps = [...insertedSteps].sort(
    (a: any, b: any) => Number(a?.step_order ?? 0) - Number(b?.step_order ?? 0)
  );

  const insertedStepIdByOrder = new Map<number, string>();

  for (const step of orderedSteps) {
    const stepId = safeStr((step as any)?.id).trim();
    const stepOrder = Number((step as any)?.step_order ?? 0);

    if (!stepId || !Number.isFinite(stepOrder) || stepOrder < 1) {
      throw new Error("Invalid approval step returned from insert.");
    }

    insertedStepIdByOrder.set(stepOrder, stepId);
  }

  // 7. Resolve approver emails once
  const allUserIds = Array.from(
    new Set(
      Array.from(approversByLogicalStep.values())
        .flat()
        .map((a) => safeStr(a.userId).trim())
        .filter(Boolean)
    )
  );

  const emails = await getUserEmailsByIds(supabase, allUserIds);

  // 8. Create approver rows using the same normalized sequential order used for step inserts
  const finalApproverRows: any[] = [];

  for (let normalizedOrder = 1; normalizedOrder <= activeLogicalSteps.length; normalizedOrder += 1) {
    const stepId = insertedStepIdByOrder.get(normalizedOrder);
    if (!stepId) {
      throw new Error(`Inserted approval step missing for normalized step order ${normalizedOrder}.`);
    }

    const logicalStepNo = activeLogicalSteps[normalizedOrder - 1];
    const approvers = approversByLogicalStep.get(logicalStepNo) || [];

    for (const approver of approvers) {
      const userId = safeStr(approver.userId).trim();
      if (!userId) continue;

      finalApproverRows.push({
        step_id: stepId,
        user_id: userId,
        email: emails.get(userId) || null,
        role: labelToRole(approver.role),
      });
    }
  }

  await insertApprovalStepApprovers(supabase, finalApproverRows);

  return {
    chainId: chain.id,
    stepIds: orderedSteps.map((s: any) => s.id),
    chosenType: desiredType,
  };
}