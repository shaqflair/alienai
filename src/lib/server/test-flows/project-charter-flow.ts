import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type Scenario = "happy_path" | "reject_step_2" | "sla_breach";

export type RunProjectCharterFlowInput = {
  supabase: SupabaseClient;
  organisationId: string;
  userId: string;
  scenario?: Scenario;
  programmeLeadEmail?: string | null;
  commercialLeadEmail?: string | null;
  accountLeadEmail?: string | null;
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : value == null ? fallback : String(value);
}

async function getUserIdByEmail(supabase: SupabaseClient, email: string) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .ilike("email", email)
    .maybeSingle();

  if (error) throw new Error(`Profile lookup failed for ${email}: ${error.message}`);
  if (!data?.id) throw new Error(`No profile found for ${email}`);
  return data.id as string;
}

async function getOrCreateTestProject(
  supabase: SupabaseClient,
  organisationId: string,
  ownerUserId: string
) {
  const projectCode = "AI-CHARTER-TEST";

  const existing = await supabase
    .from("projects")
    .select("id,title,project_code,organisation_id")
    .eq("organisation_id", organisationId)
    .eq("project_code", projectCode)
    .is("deleted_at", null)
    .maybeSingle();

  if (existing.error) {
    throw new Error(`Project lookup failed: ${existing.error.message}`);
  }

  if (existing.data?.id) return existing.data;

  const insert = await supabase
    .from("projects")
    .insert({
      organisation_id: organisationId,
      user_id: ownerUserId,
      created_by: ownerUserId,
      title: "AI Governance Pilot",
      project_code: projectCode,
      client_name: "Internal Test",
      status: "active",
      lifecycle_status: "active",
      colour: "#00B8DB",
    })
    .select("id,title,project_code,organisation_id")
    .single();

  if (insert.error) {
    throw new Error(`Project creation failed: ${insert.error.message}`);
  }

  return insert.data;
}

async function createProjectCharterArtifact(
  supabase: SupabaseClient,
  projectId: string,
  organisationId: string,
  userId: string
) {
  const payload = {
    project_objective: "Deploy AI governance cockpit",
    scope: "Phase 1 governance implementation",
    budget: 1200000,
    timeline: "6 months",
    key_risks: ["Resource availability", "Approval delay", "Dependency on commercial sign-off"],
  };

  const result = await supabase
    .from("artifacts")
    .insert({
      organisation_id: organisationId,
      project_id: projectId,
      artifact_type: "project_charter",
      title: "Project Charter - AI Governance Pilot",
      status: "draft",
      is_current: true,
      version_no: 1,
      created_by: userId,
      updated_by: userId,
      content_json: payload,
    })
    .select("id,project_id,artifact_type,status,title")
    .single();

  if (result.error) {
    throw new Error(`Artifact creation failed: ${result.error.message}`);
  }

  return result.data;
}

async function createApprovalChain(
  supabase: SupabaseClient,
  artifactId: string,
  projectId: string,
  organisationId: string,
  createdBy: string,
  approverIds: {
    programmeLeadId: string;
    commercialLeadId: string;
    accountLeadId: string;
  }
) {
  const chain = await supabase
    .from("approval_chains")
    .insert({
      organisation_id: organisationId,
      project_id: projectId,
      artifact_id: artifactId,
      artifact_type: "project_charter",
      is_active: true,
      status: "active",
      created_by: createdBy,
    })
    .select("id,status,artifact_id,project_id,artifact_type,is_active")
    .single();

  if (chain.error) {
    throw new Error(`Approval chain creation failed: ${chain.error.message}`);
  }

  const stepsInsert = await supabase
    .from("artifact_approval_steps")
    .insert([
      {
        organisation_id: organisationId,
        artifact_id: artifactId,
        approval_chain_id: chain.data.id,
        step_order: 1,
        step_name: "Programme Lead Approval",
        required_role: "programme_lead",
        status: "pending",
        is_current: true,
        created_by: createdBy,
      },
      {
        organisation_id: organisationId,
        artifact_id: artifactId,
        approval_chain_id: chain.data.id,
        step_order: 2,
        step_name: "Commercial Lead Approval",
        required_role: "commercial_lead",
        status: "waiting",
        is_current: false,
        created_by: createdBy,
      },
      {
        organisation_id: organisationId,
        artifact_id: artifactId,
        approval_chain_id: chain.data.id,
        step_order: 3,
        step_name: "Account Lead Approval",
        required_role: "account_lead",
        status: "waiting",
        is_current: false,
        created_by: createdBy,
      },
    ])
    .select("id,step_order,step_name,status,is_current")
    .order("step_order", { ascending: true });

  if (stepsInsert.error) {
    throw new Error(`Approval step creation failed: ${stepsInsert.error.message}`);
  }

  const steps = stepsInsert.data ?? [];
  const step1 = steps.find((s: any) => s.step_order === 1);
  const step2 = steps.find((s: any) => s.step_order === 2);
  const step3 = steps.find((s: any) => s.step_order === 3);

  if (!step1 || !step2 || !step3) {
    throw new Error("Approval steps were not created correctly");
  }

  const approversInsert = await supabase
    .from("approval_step_approvers")
    .insert([
      {
        organisation_id: organisationId,
        approval_step_id: step1.id,
        artifact_id: artifactId,
        approver_user_id: approverIds.programmeLeadId,
        status: "pending",
        created_by: createdBy,
      },
      {
        organisation_id: organisationId,
        approval_step_id: step2.id,
        artifact_id: artifactId,
        approver_user_id: approverIds.commercialLeadId,
        status: "waiting",
        created_by: createdBy,
      },
      {
        organisation_id: organisationId,
        approval_step_id: step3.id,
        artifact_id: artifactId,
        approver_user_id: approverIds.accountLeadId,
        status: "waiting",
        created_by: createdBy,
      },
    ])
    .select("id,approval_step_id,approver_user_id,status");

  if (approversInsert.error) {
    throw new Error(`Approver assignment failed: ${approversInsert.error.message}`);
  }

  const artifactUpdate = await supabase
    .from("artifacts")
    .update({
      status: "in_review",
      updated_by: createdBy,
    })
    .eq("id", artifactId);

  if (artifactUpdate.error) {
    throw new Error(`Artifact submit update failed: ${artifactUpdate.error.message}`);
  }

  await supabase.from("approval_audit_log").insert({
    organisation_id: organisationId,
    artifact_id: artifactId,
    action: "submitted",
    actor_user_id: createdBy,
    comment: "Test flow submission",
  });

  return {
    chain: chain.data,
    steps,
  };
}

async function approveStep(
  supabase: SupabaseClient,
  params: {
    organisationId: string;
    artifactId: string;
    stepOrder: number;
    actorUserId: string;
    comment?: string;
  }
) {
  const { organisationId, artifactId, stepOrder, actorUserId, comment } = params;

  const current = await supabase
    .from("artifact_approval_steps")
    .select("id,step_order,status,is_current,approval_chain_id")
    .eq("artifact_id", artifactId)
    .eq("step_order", stepOrder)
    .maybeSingle();

  if (current.error) throw new Error(`Step ${stepOrder} lookup failed: ${current.error.message}`);
  if (!current.data?.id) throw new Error(`Step ${stepOrder} not found`);

  const stepId = current.data.id;

  const updateStep = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "approved",
      is_current: false,
      decided_at: new Date().toISOString(),
      decided_by: actorUserId,
    })
    .eq("id", stepId);

  if (updateStep.error) throw new Error(`Step ${stepOrder} approval failed: ${updateStep.error.message}`);

  const updateApprover = await supabase
    .from("approval_step_approvers")
    .update({
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by: actorUserId,
    })
    .eq("approval_step_id", stepId);

  if (updateApprover.error) {
    throw new Error(`Approver status update failed: ${updateApprover.error.message}`);
  }

  await supabase.from("approval_audit_log").insert({
    organisation_id: organisationId,
    artifact_id: artifactId,
    action: "approved",
    actor_user_id: actorUserId,
    comment: comment ?? `Approved step ${stepOrder}`,
    meta_json: { step_order: stepOrder },
  });

  const nextStep = await supabase
    .from("artifact_approval_steps")
    .select("id,step_order")
    .eq("artifact_id", artifactId)
    .eq("step_order", stepOrder + 1)
    .maybeSingle();

  if (nextStep.error) throw new Error(`Next step lookup failed: ${nextStep.error.message}`);

  if (nextStep.data?.id) {
    const activateStep = await supabase
      .from("artifact_approval_steps")
      .update({
        status: "pending",
        is_current: true,
      })
      .eq("id", nextStep.data.id);

    if (activateStep.error) throw new Error(`Next step activation failed: ${activateStep.error.message}`);

    const activateApprover = await supabase
      .from("approval_step_approvers")
      .update({
        status: "pending",
      })
      .eq("approval_step_id", nextStep.data.id);

    if (activateApprover.error) {
      throw new Error(`Next approver activation failed: ${activateApprover.error.message}`);
    }
  } else {
    const closeChain = await supabase
      .from("approval_chains")
      .update({
        status: "approved",
        is_active: false,
      })
      .eq("artifact_id", artifactId);

    if (closeChain.error) throw new Error(`Chain completion failed: ${closeChain.error.message}`);

    const approveArtifact = await supabase
      .from("artifacts")
      .update({
        status: "approved",
        approved_at: new Date().toISOString(),
        approved_by: actorUserId,
      })
      .eq("id", artifactId);

    if (approveArtifact.error) throw new Error(`Artifact final approval failed: ${approveArtifact.error.message}`);
  }
}

async function rejectStep(
  supabase: SupabaseClient,
  params: {
    organisationId: string;
    artifactId: string;
    stepOrder: number;
    actorUserId: string;
    comment?: string;
  }
) {
  const { organisationId, artifactId, stepOrder, actorUserId, comment } = params;

  const current = await supabase
    .from("artifact_approval_steps")
    .select("id")
    .eq("artifact_id", artifactId)
    .eq("step_order", stepOrder)
    .maybeSingle();

  if (current.error) throw new Error(`Reject step lookup failed: ${current.error.message}`);
  if (!current.data?.id) throw new Error(`Reject step ${stepOrder} not found`);

  const stepId = current.data.id;

  const stepUpdate = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "rejected",
      is_current: false,
      decided_at: new Date().toISOString(),
      decided_by: actorUserId,
    })
    .eq("id", stepId);

  if (stepUpdate.error) throw new Error(`Reject step update failed: ${stepUpdate.error.message}`);

  const approverUpdate = await supabase
    .from("approval_step_approvers")
    .update({
      status: "rejected",
      decided_at: new Date().toISOString(),
      decided_by: actorUserId,
    })
    .eq("approval_step_id", stepId);

  if (approverUpdate.error) throw new Error(`Reject approver update failed: ${approverUpdate.error.message}`);

  const waitingUpdate = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "cancelled",
      is_current: false,
    })
    .eq("artifact_id", artifactId)
    .in("status", ["waiting", "pending"]);

  if (waitingUpdate.error) throw new Error(`Waiting step cancel failed: ${waitingUpdate.error.message}`);

  const chainUpdate = await supabase
    .from("approval_chains")
    .update({
      status: "rejected",
      is_active: false,
    })
    .eq("artifact_id", artifactId);

  if (chainUpdate.error) throw new Error(`Chain reject failed: ${chainUpdate.error.message}`);

  const artifactUpdate = await supabase
    .from("artifacts")
    .update({
      status: "rejected",
      updated_by: actorUserId,
    })
    .eq("id", artifactId);

  if (artifactUpdate.error) throw new Error(`Artifact reject failed: ${artifactUpdate.error.message}`);

  await supabase.from("approval_audit_log").insert({
    organisation_id: organisationId,
    artifact_id: artifactId,
    action: "rejected",
    actor_user_id: actorUserId,
    comment: comment ?? `Rejected at step ${stepOrder}`,
    meta_json: { step_order: stepOrder },
  });
}

async function markStepAsBreached(
  supabase: SupabaseClient,
  params: { artifactId: string; stepOrder: number }
) {
  const step = await supabase
    .from("artifact_approval_steps")
    .select("id")
    .eq("artifact_id", params.artifactId)
    .eq("step_order", params.stepOrder)
    .maybeSingle();

  if (step.error) throw new Error(`Breach step lookup failed: ${step.error.message}`);
  if (!step.data?.id) throw new Error(`Breach step ${params.stepOrder} not found`);

  const breachedAt = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();

  const update = await supabase
    .from("artifact_approval_steps")
    .update({
      sla_due_at: breachedAt,
      sla_status: "breached",
    })
    .eq("id", step.data.id);

  if (update.error) throw new Error(`SLA breach update failed: ${update.error.message}`);
}

async function readFinalState(supabase: SupabaseClient, artifactId: string) {
  const artifact = await supabase
    .from("artifacts")
    .select("id,title,status,artifact_type,project_id,approved_at,approved_by")
    .eq("id", artifactId)
    .single();

  if (artifact.error) throw new Error(`Final artifact read failed: ${artifact.error.message}`);

  const chain = await supabase
    .from("approval_chains")
    .select("id,status,is_active,project_id,artifact_type,created_at")
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (chain.error) throw new Error(`Final chain read failed: ${chain.error.message}`);

  const steps = await supabase
    .from("artifact_approval_steps")
    .select("id,step_order,step_name,status,is_current,sla_status,decided_at,decided_by")
    .eq("artifact_id", artifactId)
    .order("step_order", { ascending: true });

  if (steps.error) throw new Error(`Final steps read failed: ${steps.error.message}`);

  const audit = await supabase
    .from("approval_audit_log")
    .select("action,actor_user_id,comment,created_at,meta_json")
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: true });

  if (audit.error) throw new Error(`Final audit read failed: ${audit.error.message}`);

  return {
    artifact: artifact.data,
    chain: chain.data,
    steps: steps.data ?? [],
    audit: audit.data ?? [],
  };
}

function buildAssertions(state: any, scenario: Scenario) {
  const checks: Array<{ name: string; pass: boolean; actual?: unknown }> = [];

  checks.push({
    name: "Artifact exists",
    pass: !!state?.artifact?.id,
    actual: state?.artifact?.id,
  });

  checks.push({
    name: "Approval chain exists",
    pass: !!state?.chain?.id,
    actual: state?.chain?.id,
  });

  if (scenario === "happy_path") {
    checks.push({
      name: "Artifact approved",
      pass: state?.artifact?.status === "approved",
      actual: state?.artifact?.status,
    });
    checks.push({
      name: "Chain approved",
      pass: state?.chain?.status === "approved",
      actual: state?.chain?.status,
    });
    checks.push({
      name: "Chain inactive after approval",
      pass: state?.chain?.is_active === false,
      actual: state?.chain?.is_active,
    });
    checks.push({
      name: "Three steps approved",
      pass: (state?.steps ?? []).filter((s: any) => s.status === "approved").length === 3,
      actual: (state?.steps ?? []).map((s: any) => ({ step: s.step_order, status: s.status })),
    });
  }

  if (scenario === "reject_step_2") {
    checks.push({
      name: "Artifact rejected",
      pass: state?.artifact?.status === "rejected",
      actual: state?.artifact?.status,
    });
    checks.push({
      name: "Chain rejected",
      pass: state?.chain?.status === "rejected",
      actual: state?.chain?.status,
    });
    checks.push({
      name: "Chain inactive after rejection",
      pass: state?.chain?.is_active === false,
      actual: state?.chain?.is_active,
    });
  }

  if (scenario === "sla_breach") {
    const breached = (state?.steps ?? []).some((s: any) => s.sla_status === "breached");
    checks.push({
      name: "At least one step breached",
      pass: breached,
      actual: (state?.steps ?? []).map((s: any) => ({
        step: s.step_order,
        sla_status: s.sla_status,
      })),
    });
    checks.push({
      name: "Chain remains active during breach scenario",
      pass: state?.chain?.status === "active" && state?.chain?.is_active === true,
      actual: {
        status: state?.chain?.status,
        is_active: state?.chain?.is_active,
      },
    });
  }

  const passed = checks.every((c) => c.pass);

  return { passed, checks };
}

export async function runProjectCharterFlow(input: RunProjectCharterFlowInput) {
  const supabase = input.supabase;
  const organisationId = asString(input.organisationId).trim();
  const userId = asString(input.userId).trim();
  const scenario = (asString(input.scenario, "happy_path") as Scenario) || "happy_path";

  if (!organisationId) throw new Error("Missing organisationId");
  if (!userId) throw new Error("Missing userId");

  const programmeLeadEmail =
    asString(input.programmeLeadEmail).trim() || "alienaprogrammelead@gmail.com";
  const commercialLeadEmail =
    asString(input.commercialLeadEmail).trim() || "paapa501@gmail.com";
  const accountLeadEmail =
    asString(input.accountLeadEmail).trim() || "alex.adupoku@yahoo.com";

  const programmeLeadId = await getUserIdByEmail(supabase, programmeLeadEmail);
  const commercialLeadId = await getUserIdByEmail(supabase, commercialLeadEmail);
  const accountLeadId = await getUserIdByEmail(supabase, accountLeadEmail);

  const project = await getOrCreateTestProject(supabase, organisationId, userId);
  const artifact = await createProjectCharterArtifact(supabase, project.id, organisationId, userId);

  await createApprovalChain(supabase, artifact.id, project.id, organisationId, userId, {
    programmeLeadId,
    commercialLeadId,
    accountLeadId,
  });

  if (scenario === "happy_path") {
    await approveStep(supabase, {
      organisationId,
      artifactId: artifact.id,
      stepOrder: 1,
      actorUserId: programmeLeadId,
      comment: "Programme Lead approved",
    });

    await approveStep(supabase, {
      organisationId,
      artifactId: artifact.id,
      stepOrder: 2,
      actorUserId: commercialLeadId,
      comment: "Commercial Lead approved",
    });

    await approveStep(supabase, {
      organisationId,
      artifactId: artifact.id,
      stepOrder: 3,
      actorUserId: accountLeadId,
      comment: "Account Lead approved",
    });
  }

  if (scenario === "reject_step_2") {
    await approveStep(supabase, {
      organisationId,
      artifactId: artifact.id,
      stepOrder: 1,
      actorUserId: programmeLeadId,
      comment: "Programme Lead approved",
    });

    await rejectStep(supabase, {
      organisationId,
      artifactId: artifact.id,
      stepOrder: 2,
      actorUserId: commercialLeadId,
      comment: "Commercial Lead rejected",
    });
  }

  if (scenario === "sla_breach") {
    await markStepAsBreached(supabase, {
      artifactId: artifact.id,
      stepOrder: 1,
    });
  }

  const state = await readFinalState(supabase, artifact.id);
  const assertions = buildAssertions(state, scenario);

  return {
    ok: true,
    scenario,
    approver_emails: {
      programmeLeadEmail,
      commercialLeadEmail,
      accountLeadEmail,
    },
    approver_ids: {
      programmeLeadId,
      commercialLeadId,
      accountLeadId,
    },
    project,
    artifact_id: artifact.id,
    assertions,
    state,
  };
}