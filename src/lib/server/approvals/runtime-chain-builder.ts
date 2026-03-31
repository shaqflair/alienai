import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * UTILS
 */
function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeNum(x: unknown, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeArtifactType(type: unknown) {
  const t = safeStr(type).trim().toLowerCase();
  if (["project_charter", "project charter", "charter", "projectcharter", "pid"].includes(t)) return "project_charter";
  if (["project_closure_report", "project closure report", "closure_report", "closure report", "project_closeout", "closeout", "close_out", "status_dashboard", "status dashboard"].includes(t)) return "project_closure_report";
  if (["financial_plan", "financial plan"].includes(t)) return "financial_plan";
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
  return safeStr(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "approver";
}

function inBand(amount: number, min: number, max: number | null) {
  const minOk = amount >= (Number.isFinite(min) ? min : 0);
  const maxOk = max == null ? true : amount <= Number(max);
  return minOk && maxOk;
}

type StepApprover = {
  userId: string | null;
  email: string | null;
  role: string;
};

function dedupeApprovers(rows: StepApprover[]) {
  const out = new Map<string, StepApprover>();

  for (const row of rows) {
    const userId = safeStr(row?.userId).trim();
    const email = safeStr(row?.email).trim().toLowerCase();
    const role = safeStr(row?.role).trim() || "Approval";

    const key =
      userId
        ? `u:${userId}`
        : email
        ? `e:${email}`
        : "";

    if (!key) continue;
    if (!out.has(key)) {
      out.set(key, {
        userId: userId || null,
        email: email || null,
        role,
      });
    }
  }

  return Array.from(out.values());
}

/**
 * FIX: Correctly compute min_approvals based on mode.
 *
 * - "all"  → every assigned approver must approve
 * - "any"  → just 1 is enough
 * - other  → respect explicit templateMinApprovals, clamped to actual approver count
 */
function resolveMinApprovals(mode: string, approverCount: number, templateMinApprovals: number): number {
  const m = safeStr(mode).trim().toLowerCase();
  if (m === "all") return Math.max(1, approverCount);
  if (m === "any") return 1;
  return Math.max(1, Math.min(templateMinApprovals || 1, approverCount || 1));
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

type ChainStepInsert = {
  chain_id: string;
  step_order: number;
  step_name: string;
  mode: string;
  min_approvals: number;
  max_rejections: number;
  round: number;
  is_active: boolean;
};

type PersistedChainStep = {
  id: string;
  chain_id: string;
  step_order: number;
  step_name?: string | null;
  mode?: string | null;
  min_approvals?: number | null;
  max_rejections?: number | null;
  round?: number | null;
  is_active?: boolean | null;
};

type ArtifactStepInsert = {
  artifact_id: string;
  chain_id: string;
  project_id: string;
  artifact_type: string;
  step_order: number;
  name: string;
  mode: string;
  min_approvals: number;
  max_rejections: number;
  round: number;
  status: string;
  approval_step_id: string;
  pending_since: string | null;
};

type PersistedArtifactStep = {
  id: string;
  artifact_id: string;
  chain_id: string;
  step_order: number;
  approval_step_id?: string | null;
  name?: string | null;
  mode?: string | null;
  min_approvals?: number | null;
  max_rejections?: number | null;
  round?: number | null;
  status?: string | null;
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

  if (error) throw new Error(`approval_chains supersede failed: ${error.message}`);
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

/**
 * Load governance template steps to get the intended mode + min_approvals.
 * Non-fatal: if unavailable, we fall back to "all".
 */
async function loadGovernanceStepSettings(
  supabase: SupabaseClient,
  organisationId: string,
  artifactType: string
): Promise<Map<number, { mode: string; min_approvals: number }>> {
  const out = new Map<number, { mode: string; min_approvals: number }>();

  try {
    const { data, error } = await supabase
      .from("approval_steps")
      .select("step_order, mode, min_approvals")
      .eq("is_active", true)
      .order("step_order", { ascending: true });

    if (error) return out;

    for (const row of Array.isArray(data) ? data : []) {
      const order = safeNum((row as any).step_order, 0);
      if (!order) continue;

      out.set(order, {
        mode: safeStr((row as any).mode).trim() || "all",
        min_approvals: safeNum((row as any).min_approvals, 1),
      });
    }
  } catch {
    // non-fatal
  }

  return out;
}

/**
 * FIX:
 * Resolve BOTH valid group member shapes:
 * - approval_group_members.user_id
 * - approval_group_members.approver_id -> organisation_approvers
 *
 * Also carry email so runtime approver rows can still be created
 * even when only email is available.
 */
async function expandApprovalGroupMembers(
  supabase: SupabaseClient,
  groupId: string
): Promise<StepApprover[]> {
  const gid = safeStr(groupId).trim();
  if (!gid) return [];

  const { data, error } = await supabase
    .from("approval_group_members")
    .select(`
      user_id,
      approver_id,
      is_active,
      organisation_approvers:approver_id (
        id,
        user_id,
        email,
        approver_email,
        approver_role,
        is_active
      )
    `)
    .eq("group_id", gid)
    .eq("is_active", true);

  if (error) {
    throw new Error(`approval_group_members lookup failed: ${error.message}`);
  }

  const collected: StepApprover[] = [];

  for (const row of Array.isArray(data) ? data : []) {
    const directUserId = safeStr((row as any)?.user_id).trim() || null;
    const approverRef = (row as any)?.organisation_approvers;

    if (directUserId) {
      collected.push({
        userId: directUserId,
        email: null,
        role: "Approval",
      });
      continue;
    }

    const oa = Array.isArray(approverRef) ? approverRef[0] : approverRef;
    if (!oa) continue;
    if ((oa as any).is_active === false) continue;

    const resolvedUserId = safeStr((oa as any)?.user_id).trim() || null;
    const resolvedEmail =
      safeStr((oa as any)?.email).trim() ||
      safeStr((oa as any)?.approver_email).trim() ||
      null;
    const resolvedRole =
      safeStr((oa as any)?.approver_role).trim() || "Approval";

    if (!resolvedUserId && !resolvedEmail) continue;

    collected.push({
      userId: resolvedUserId,
      email: resolvedEmail,
      role: resolvedRole,
    });
  }

  return dedupeApprovers(collected);
}

/**
 * FIX:
 * Do not assume profiles.id = auth.users.id.
 * Use organisation_approvers as the canonical enrichment source for approvers.
 */
async function getApproverEmailsByUserIds(
  supabase: SupabaseClient,
  organisationId: string,
  userIds: string[]
): Promise<Map<string, string>> {
  const ids = Array.from(new Set((userIds || []).map((x) => safeStr(x).trim()).filter(Boolean)));
  const out = new Map<string, string>();
  if (!ids.length) return out;

  const { data, error } = await supabase
    .from("organisation_approvers")
    .select("user_id, email, approver_email")
    .eq("organisation_id", organisationId)
    .eq("is_active", true)
    .in("user_id", ids);

  if (error) throw new Error(`organisation_approvers email lookup failed: ${error.message}`);

  for (const row of Array.isArray(data) ? data : []) {
    const userId = safeStr((row as any)?.user_id).trim();
    const email =
      safeStr((row as any)?.email).trim() ||
      safeStr((row as any)?.approver_email).trim();

    if (userId && email) out.set(userId, email);
  }

  return out;
}

async function insertApprovalStepApprovers(
  supabase: SupabaseClient,
  rows: Array<{
    step_id: string;
    user_id: string | null;
    email: string | null;
    role: string;
    status: string;
  }>
) {
  if (!rows.length) return;

  const sanitized = rows
    .map((r) => ({
      step_id: safeStr(r.step_id).trim(),
      user_id: safeStr(r.user_id).trim() || null,
      email: safeStr(r.email).trim() || null,
      role: safeStr(r.role).trim() || "approver",
      status: safeStr(r.status).trim() || "pending",
    }))
    .filter((r) => r.step_id && (r.user_id || r.email));

  if (!sanitized.length) {
    throw new Error("approval_step_approvers insert aborted: no rows had a valid user_id or email.");
  }

  const { error } = await supabase.from("approval_step_approvers").insert(sanitized);
  if (!error) return;

  const msg = safeStr(error.message);
  const missingEmail = isMissingColumnError(msg, "email");
  const missingRole = isMissingColumnError(msg, "role");
  const missingStatus = isMissingColumnError(msg, "status");

  const fallbackRows = sanitized.map((r) => {
    const o: any = { step_id: r.step_id };
    if (r.user_id) o.user_id = r.user_id;
    if (!missingEmail && r.email) o.email = r.email;
    if (!missingRole) o.role = r.role;
    if (!missingStatus) o.status = r.status;
    return o;
  });

  const { error: fErr } = await supabase.from("approval_step_approvers").insert(fallbackRows);
  if (fErr) throw new Error(`approval_step_approvers insert failed: ${fErr.message}`);
}

async function purgeExistingArtifactStepRows(supabase: SupabaseClient, artifactId: string) {
  const { data: existingSteps, error: existingStepsErr } = await supabase
    .from("artifact_approval_steps")
    .select("id")
    .eq("artifact_id", artifactId);

  if (existingStepsErr) throw new Error(`artifact_approval_steps pre-clean lookup failed: ${existingStepsErr.message}`);

  const stepIds = (existingSteps ?? []).map((r: any) => safeStr(r?.id).trim()).filter(Boolean);

  if (stepIds.length) {
    const { error: approverDeleteErr } = await supabase
      .from("approval_step_approvers")
      .delete()
      .in("step_id", stepIds);

    if (approverDeleteErr) throw new Error(`approval_step_approvers cleanup failed: ${approverDeleteErr.message}`);
  }

  const { error: stepDeleteErr } = await supabase
    .from("artifact_approval_steps")
    .delete()
    .eq("artifact_id", artifactId);

  if (stepDeleteErr) throw new Error(`artifact_approval_steps cleanup failed: ${stepDeleteErr.message}`);
}

async function purgeExistingChainDefinitionRows(supabase: SupabaseClient, chainId: string) {
  const { error } = await supabase.from("approval_chain_steps").delete().eq("chain_id", chainId);
  if (error) throw new Error(`approval_chain_steps cleanup failed: ${error.message}`);
}

async function insertApprovalChainSteps(supabase: SupabaseClient, rows: ChainStepInsert[]): Promise<PersistedChainStep[]> {
  if (!rows.length) return [];

  const { data, error } = await supabase
    .from("approval_chain_steps")
    .insert(rows)
    .select("id, chain_id, step_order, step_name, mode, min_approvals, max_rejections, round, is_active")
    .order("step_order", { ascending: true });

  if (error) throw new Error(`approval_chain_steps insert failed: ${error.message}`);

  const inserted = Array.isArray(data) ? (data as PersistedChainStep[]) : [];
  if (!inserted.length) throw new Error("approval_chain_steps insert returned no rows.");

  return inserted;
}

async function refetchApprovalChainSteps(supabase: SupabaseClient, chainId: string): Promise<PersistedChainStep[]> {
  const { data, error } = await supabase
    .from("approval_chain_steps")
    .select("id, chain_id, step_order, step_name, mode, min_approvals, max_rejections, round, is_active")
    .eq("chain_id", chainId)
    .order("step_order", { ascending: true });

  if (error) throw new Error(`approval_chain_steps refetch failed: ${error.message}`);

  const rows = Array.isArray(data) ? (data as PersistedChainStep[]) : [];
  if (!rows.length) throw new Error("approval_chain_steps missing after insert.");

  return rows;
}

async function insertArtifactApprovalSteps(supabase: SupabaseClient, rows: ArtifactStepInsert[]): Promise<PersistedArtifactStep[]> {
  if (!rows.length) return [];

  const { data, error } = await supabase
    .from("artifact_approval_steps")
    .insert(rows)
    .select("id, artifact_id, chain_id, step_order, approval_step_id, name, mode, min_approvals, max_rejections, round, status")
    .order("step_order", { ascending: true });

  if (error) throw new Error(`artifact_approval_steps insert failed: ${error.message}`);

  const inserted = Array.isArray(data) ? (data as PersistedArtifactStep[]) : [];
  if (!inserted.length) throw new Error("artifact_approval_steps insert returned no rows.");

  return inserted;
}

async function refetchArtifactApprovalSteps(
  supabase: SupabaseClient,
  artifactId: string,
  chainId: string
): Promise<PersistedArtifactStep[]> {
  const { data, error } = await supabase
    .from("artifact_approval_steps")
    .select("id, artifact_id, chain_id, step_order, approval_step_id, name, mode, min_approvals, max_rejections, round, status")
    .eq("artifact_id", artifactId)
    .eq("chain_id", chainId)
    .order("step_order", { ascending: true });

  if (error) throw new Error(`artifact_approval_steps refetch failed: ${error.message}`);

  const rows = Array.isArray(data) ? (data as PersistedArtifactStep[]) : [];
  if (!rows.length) throw new Error("artifact_approval_steps missing after insert.");

  return rows;
}

async function verifyRuntimeChain(supabase: SupabaseClient, args: { chainId: string; artifactId: string }) {
  const chainSteps = await refetchApprovalChainSteps(supabase, args.chainId);
  const artifactSteps = await refetchArtifactApprovalSteps(supabase, args.artifactId, args.chainId);

  const chainStepIdByOrder = new Map<number, string>();

  for (const row of chainSteps) {
    const order = safeNum(row.step_order, 0);
    const id = safeStr(row.id).trim();
    if (!order || !id) throw new Error("Invalid approval_chain_steps row returned from DB.");
    chainStepIdByOrder.set(order, id);
  }

  for (const row of artifactSteps) {
    const stepId = safeStr(row.id).trim();
    const order = safeNum(row.step_order, 0);
    const definitionId = safeStr(row.approval_step_id).trim();

    if (!stepId || !order) throw new Error("Invalid artifact_approval_steps row returned from DB.");

    const expectedDefinitionId = chainStepIdByOrder.get(order);
    if (!expectedDefinitionId) {
      throw new Error(`artifact_approval_steps row ${stepId} has no matching approval_chain_steps row for order ${order}.`);
    }
    if (!definitionId) {
      throw new Error(`artifact_approval_steps row ${stepId} has null approval_step_id.`);
    }
    if (definitionId !== expectedDefinitionId) {
      throw new Error(`artifact_approval_steps row ${stepId} has approval_step_id=${definitionId} but expected ${expectedDefinitionId}.`);
    }
  }

  return { chainSteps, artifactSteps };
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
  const nowIso = new Date().toISOString();
  const amount = Number(args.amount ?? 0) || 0;
  const desiredType = normalizeArtifactType(args.artifactType);

  // 1. Resolve rules
  const rules = await loadRulesForArtifact(supabase, args.organisationId, desiredType, amount);
  if (!rules.length) throw new Error("No matching approval rules found.");

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
          userId: safeStr(rule.approver_user_id).trim() || null,
          email: null,
          role: rule.approval_role,
        });
      }

      if (rule.approval_group_id) {
        const members = await expandApprovalGroupMembers(supabase, rule.approval_group_id);
        for (const member of members) {
          collected.push({
            userId: member.userId,
            email: member.email,
            role: rule.approval_role || member.role,
          });
        }
      }
    }

    const uniqueApprovers = dedupeApprovers(collected);
    if (uniqueApprovers.length) approversByLogicalStep.set(logicalStepNo, uniqueApprovers);
  }

  const activeLogicalSteps = logicalStepNumbers.filter(
    (stepNo) => (approversByLogicalStep.get(stepNo) || []).length > 0
  );

  if (!activeLogicalSteps.length) {
    throw new Error("Approval rules matched, but produced zero approvers.");
  }

  // 3. Supersede old chains + purge old runtime rows
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

  if (cErr) throw new Error(`approval_chains insert failed: ${cErr.message}`);

  const chainId = safeStr(chain?.id).trim();
  if (!chainId) throw new Error("approval_chains insert returned no id.");

  // 5. Load governance template settings
  const governanceSteps = await loadGovernanceStepSettings(supabase, args.organisationId, desiredType);

  // 6. Insert chain definition steps
  await purgeExistingChainDefinitionRows(supabase, chainId);

  const chainStepRows: ChainStepInsert[] = activeLogicalSteps.map((logicalStepNo, index) => {
    const normalizedOrder = index + 1;
    const approvers = approversByLogicalStep.get(logicalStepNo) || [];
    const approverCount = approvers.length;
    const govStep = governanceSteps.get(normalizedOrder);
    const mode = govStep?.mode || "all";
    const templateMin = govStep?.min_approvals ?? approverCount;
    const minApprovals = resolveMinApprovals(mode, approverCount, templateMin);

    return {
      chain_id: chainId,
      step_order: normalizedOrder,
      step_name: `Step ${normalizedOrder}`,
      mode,
      min_approvals: minApprovals,
      max_rejections: 0,
      round: 1,
      is_active: true,
    };
  });

  await insertApprovalChainSteps(supabase, chainStepRows);

  const persistedChainSteps = await refetchApprovalChainSteps(supabase, chainId);
  const chainStepByOrder = new Map<number, PersistedChainStep>();

  for (const step of persistedChainSteps) {
    const order = safeNum(step.step_order, 0);
    if (!order) throw new Error("Persisted approval_chain_steps row missing valid step_order.");
    chainStepByOrder.set(order, step);
  }

  for (let i = 1; i <= activeLogicalSteps.length; i++) {
    if (!chainStepByOrder.get(i)?.id) {
      throw new Error(`approval_chain_steps missing for normalized step order ${i}.`);
    }
  }

  // 7. Create runtime artifact steps
  const artifactStepRows: ArtifactStepInsert[] = activeLogicalSteps.map((logicalStepNo, index) => {
    const normalizedOrder = index + 1;
    const chainStep = chainStepByOrder.get(normalizedOrder);

    if (!chainStep?.id) {
      throw new Error(`approval_chain_steps missing for normalized step order ${normalizedOrder}.`);
    }

    const approvers = approversByLogicalStep.get(logicalStepNo) || [];
    const approverCount = approvers.length;
    const persistedMode = safeStr(chainStep.mode).trim() || "all";
    const persistedTemplateMin = safeNum(chainStep.min_approvals, approverCount);
    const minApprovals = resolveMinApprovals(persistedMode, approverCount, persistedTemplateMin);

    return {
      artifact_id: args.artifactId,
      chain_id: chainId,
      project_id: args.projectId,
      artifact_type: desiredType,
      step_order: normalizedOrder,
      name: safeStr(chainStep.step_name).trim() || `Step ${normalizedOrder}`,
      mode: persistedMode,
      min_approvals: minApprovals,
      max_rejections: safeNum(chainStep.max_rejections, 0),
      round: safeNum(chainStep.round, 1),
      status: normalizedOrder === 1 ? "pending" : "waiting",
      approval_step_id: safeStr(chainStep.id).trim(),
      pending_since: normalizedOrder === 1 ? nowIso : null,
    };
  });

  await insertArtifactApprovalSteps(supabase, artifactStepRows);

  const persistedArtifactSteps = await refetchArtifactApprovalSteps(supabase, args.artifactId, chainId);
  const artifactStepIdByOrder = new Map<number, string>();

  for (const step of persistedArtifactSteps) {
    const stepId = safeStr(step?.id).trim();
    const stepOrder = safeNum(step?.step_order, 0);
    if (!stepId || !stepOrder) throw new Error("Invalid artifact_approval_steps row returned from DB.");
    artifactStepIdByOrder.set(stepOrder, stepId);
  }

  for (let i = 1; i <= activeLogicalSteps.length; i++) {
    if (!artifactStepIdByOrder.get(i)) {
      throw new Error(`artifact_approval_steps missing for normalized step order ${i}.`);
    }
  }

  // 8. Enrich emails from organisation approvers for auth user ids
  const allUserIds = Array.from(
    new Set(
      Array.from(approversByLogicalStep.values())
        .flat()
        .map((a) => safeStr(a.userId).trim())
        .filter(Boolean)
    )
  );

  const emailsByUserId = await getApproverEmailsByUserIds(
    supabase,
    args.organisationId,
    allUserIds
  );

  // 9. Create runtime approver rows
  const finalApproverRows: Array<{
    step_id: string;
    user_id: string | null;
    email: string | null;
    role: string;
    status: string;
  }> = [];

  for (let normalizedOrder = 1; normalizedOrder <= activeLogicalSteps.length; normalizedOrder++) {
    const runtimeStepId = artifactStepIdByOrder.get(normalizedOrder);
    if (!runtimeStepId) {
      throw new Error(`Inserted runtime approval step missing for normalized step order ${normalizedOrder}.`);
    }

    const logicalStepNo = activeLogicalSteps[normalizedOrder - 1];
    const approvers = approversByLogicalStep.get(logicalStepNo) || [];

    for (const approver of approvers) {
      const userId = safeStr(approver.userId).trim() || null;
      const email =
        safeStr(approver.email).trim() ||
        (userId ? emailsByUserId.get(userId) || null : null);

      if (!userId && !email) continue;

      finalApproverRows.push({
        step_id: runtimeStepId,
        user_id: userId,
        email,
        role: labelToRole(approver.role),
        status: "pending",
      });
    }
  }

  if (!finalApproverRows.length) {
    throw new Error("Approval chain built, but no runtime approval_step_approvers rows could be produced.");
  }

  await insertApprovalStepApprovers(supabase, finalApproverRows);

  // 10. Verify end-to-end integrity
  const verified = await verifyRuntimeChain(supabase, {
    chainId,
    artifactId: args.artifactId,
  });

  const verifiedRuntimeStepIds = verified.artifactSteps
    .map((s) => safeStr(s.id).trim())
    .filter(Boolean);

  return {
    chainId,
    stepIds: verifiedRuntimeStepIds,
    chosenType: desiredType,
  };
}