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

const BUILD_MARKER = "project-charter-flow-helper-2026-03-13-v5";
const AUDIT_SOURCE = "lib/server/test-flows/project-charter-flow";

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

async function getOrganisationName(supabase: SupabaseClient, organisationId: string) {
  const { data, error } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", organisationId)
    .maybeSingle();

  if (error) return null;
  return asString(data?.name).trim() || null;
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

async function insertAuditLog(
  supabase: SupabaseClient,
  params: {
    organisationId: string;
    organisationName: string | null;
    projectId: string;
    artifactId: string;
    chainId: string;
    stepId?: string | null;
    actorUserId: string;
    actorEmail: string | null;
    action: string;
    decision?: string | null;
    comment?: string | null;
    payload?: Record<string, unknown> | null;
  }
) {
  const insert = await supabase.from("approval_audit_log").insert({
    organisation_id: params.organisationId,
    organisation_name: params.organisationName,
    project_id: params.projectId,
    artifact_id: params.artifactId,
    chain_id: params.chainId,
    step_id: params.stepId ?? null,
    actor_user_id: params.actorUserId,
    actor_email: params.actorEmail,
    action: params.action,
    decision: params.decision ?? null,
    comment: params.comment ?? null,
    source: AUDIT_SOURCE,
    payload: params.payload ?? {},
  });

  if (insert.error) {
    throw new Error(`Approval audit insert failed: ${insert.error.message}`);
  }
}

async function createApprovalChain(
  supabase: SupabaseClient,
  artifactId: string,
  projectId: string,
  organisationId: string,
  organisationName: string | null,
  createdBy: string,
  approverIds: {
    programmeLeadId: string;
    commercialLeadId: string;
    accountLeadId: string;
  },
  approverEmails: {
    programmeLeadEmail: string;
    commercialLeadEmail: string;
    accountLeadEmail: string;
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

  const now = new Date().toISOString();

  const stepsInsert = await supabase
    .from("artifact_approval_steps")
    .insert([
      {
        artifact_id: artifactId,
        chain_id: chain.data.id,
        project_id: projectId,
        artifact_type: "project_charter",
        step_order: 1,
        name: "Programme Lead Approval",
        mode: "serial",
        min_approvals: 1,
        max_rejections: 1,
        round: 1,
        status: "pending",
        pending_since: now,
      },
      {
        artifact_id: artifactId,
        chain_id: chain.data.id,
        project_id: projectId,
        artifact_type: "project_charter",
        step_order: 2,
        name: "Commercial Lead Approval",
        mode: "serial",
        min_approvals: 1,
        max_rejections: 1,
        round: 1,
        status: "waiting",
      },
      {
        artifact_id: artifactId,
        chain_id: chain.data.id,
        project_id: projectId,
        artifact_type: "project_charter",
        step_order: 3,
        name: "Account Lead Approval",
        mode: "serial",
        min_approvals: 1,
        max_rejections: 1,
        round: 1,
        status: "waiting",
      },
    ])
    .select("id,step_order,name,status,chain_id")
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

  const approversInsert = await supabase.from("approval_step_approvers").insert([
    {
      step_id: step1.id,
      user_id: approverIds.programmeLeadId,
      email: approverEmails.programmeLeadEmail,
      role: "programme_lead",
    },
    {
      step_id: step2.id,
      user_id: approverIds.commercialLeadId,
      email: approverEmails.commercialLeadEmail,
      role: "commercial_lead",
    },
    {
      step_id: step3.id,
      user_id: approverIds.accountLeadId,
      email: approverEmails.accountLeadEmail,
      role: "account_lead",
    },
  ]);

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

  await insertAuditLog(supabase, {
    organisationId,
    organisationName,
    projectId,
    artifactId,
    chainId: chain.data.id,
    stepId: step1.id,
    actorUserId: createdBy,
    actorEmail: null,
    action: "submitted",
    decision: "submitted",
    comment: "Test flow submission",
    payload: {
      build_marker: BUILD_MARKER,
      first_step_order: 1,
      scenario_hint: "flow_created",
    },
  });

  return {
    chain: chain.data,
    steps,
  };
}

async function getStepByOrder(
  supabase: SupabaseClient,
  artifactId: string,
  stepOrder: number
) {
  const step = await supabase
    .from("artifact_approval_steps")
    .select("id,artifact_id,chain_id,project_id,step_order,name,status,pending_since,completed_at")
    .eq("artifact_id", artifactId)
    .eq("step_order", stepOrder)
    .maybeSingle();

  if (step.error) throw new Error(`Step ${stepOrder} lookup failed: ${step.error.message}`);
  if (!step.data?.id) throw new Error(`Step ${stepOrder} not found`);
  return step.data;
}

async function approveStep(
  supabase: SupabaseClient,
  params: {
    organisationId: string;
    organisationName: string | null;
    artifactId: string;
    stepOrder: number;
    actorUserId: string;
    actorEmail: string;
    comment?: string;
  }
) {
  const { organisationId, organisationName, artifactId, stepOrder, actorUserId, actorEmail, comment } =
    params;

  const current = await getStepByOrder(supabase, artifactId, stepOrder);
  const now = new Date().toISOString();

  const updateStep = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "approved",
      completed_at: now,
    })
    .eq("id", current.id);

  if (updateStep.error) throw new Error(`Step ${stepOrder} approval failed: ${updateStep.error.message}`);

  await insertAuditLog(supabase, {
    organisationId,
    organisationName,
    projectId: current.project_id,
    artifactId,
    chainId: current.chain_id,
    stepId: current.id,
    actorUserId,
    actorEmail,
    action: "approved",
    decision: "approved",
    comment: comment ?? `Approved step ${stepOrder}`,
    payload: {
      build_marker: BUILD_MARKER,
      step_order: stepOrder,
      step_name: current.name,
    },
  });

  const nextStep = await supabase
    .from("artifact_approval_steps")
    .select("id,chain_id,project_id,step_order,name,status")
    .eq("artifact_id", artifactId)
    .eq("step_order", stepOrder + 1)
    .maybeSingle();

  if (nextStep.error) throw new Error(`Next step lookup failed: ${nextStep.error.message}`);

  if (nextStep.data?.id) {
    const activateStep = await supabase
      .from("artifact_approval_steps")
      .update({
        status: "pending",
        pending_since: now,
      })
      .eq("id", nextStep.data.id);

    if (activateStep.error) throw new Error(`Next step activation failed: ${activateStep.error.message}`);
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
        approved_at: now,
        approved_by: actorUserId,
      })
      .eq("id", artifactId);

    if (approveArtifact.error) {
      throw new Error(`Artifact final approval failed: ${approveArtifact.error.message}`);
    }
  }
}

async function rejectStep(
  supabase: SupabaseClient,
  params: {
    organisationId: string;
    organisationName: string | null;
    artifactId: string;
    stepOrder: number;
    actorUserId: string;
    actorEmail: string;
    comment?: string;
  }
) {
  const { organisationId, organisationName, artifactId, stepOrder, actorUserId, actorEmail, comment } =
    params;

  const current = await getStepByOrder(supabase, artifactId, stepOrder);
  const now = new Date().toISOString();

  const stepUpdate = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "rejected",
      completed_at: now,
    })
    .eq("id", current.id);

  if (stepUpdate.error) throw new Error(`Reject step update failed: ${stepUpdate.error.message}`);

  const waitingUpdate = await supabase
    .from("artifact_approval_steps")
    .update({
      status: "cancelled",
      completed_at: now,
    })
    .eq("artifact_id", artifactId)
    .gt("step_order", stepOrder)
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

  await insertAuditLog(supabase, {
    organisationId,
    organisationName,
    projectId: current.project_id,
    artifactId,
    chainId: current.chain_id,
    stepId: current.id,
    actorUserId,
    actorEmail,
    action: "rejected",
    decision: "rejected",
    comment: comment ?? `Rejected at step ${stepOrder}`,
    payload: {
      build_marker: BUILD_MARKER,
      step_order: stepOrder,
      step_name: current.name,
    },
  });
}

async function markStepAsBreached(
  supabase: SupabaseClient,
  params: {
    organisationId: string;
    organisationName: string | null;
    artifactId: string;
    stepOrder: number;
    actorUserId: string;
  }
) {
  const step = await getStepByOrder(supabase, params.artifactId, params.stepOrder);
  const breachedSince = new Date(Date.now() - 1000 * 60 * 60 * 48).toISOString();

  const update = await supabase
    .from("artifact_approval_steps")
    .update({
      pending_since: breachedSince,
      status: "pending",
    })
    .eq("id", step.id);

  if (update.error) throw new Error(`Breach step update failed: ${update.error.message}`);

  await insertAuditLog(supabase, {
    organisationId: params.organisationId,
    organisationName: params.organisationName,
    projectId: step.project_id,
    artifactId: params.artifactId,
    chainId: step.chain_id,
    stepId: step.id,
    actorUserId: params.actorUserId,
    actorEmail: null,
    action: "sla_breached",
    decision: "breached",
    comment: `Marked step ${params.stepOrder} as breached for test scenario`,
    payload: {
      build_marker: BUILD_MARKER,
      step_order: params.stepOrder,
      breached_pending_since: breachedSince,
    },
  });
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
    .select("id,step_order,name,status,completed_at,pending_since,chain_id,project_id")
    .eq("artifact_id", artifactId)
    .order("step_order", { ascending: true });

  if (steps.error) throw new Error(`Final steps read failed: ${steps.error.message}`);

  const stepIds = (steps.data ?? []).map((s: any) => s.id);
  const approvers =
    stepIds.length > 0
      ? await supabase
          .from("approval_step_approvers")
          .select("id,step_id,user_id,email,role,created_at")
          .in("step_id", stepIds)
      : { data: [], error: null };

  if (approvers.error) throw new Error(`Final approvers read failed: ${approvers.error.message}`);

  const audit = await supabase
    .from("approval_audit_log")
    .select(
      "id,action,decision,actor_user_id,actor_email,comment,created_at,step_id,chain_id,project_id,payload"
    )
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: true });

  if (audit.error) throw new Error(`Final audit read failed: ${audit.error.message}`);

  return {
    artifact: artifact.data,
    chain: chain.data,
    steps: steps.data ?? [],
    approvers: approvers.data ?? [],
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
      actual: (state?.steps ?? []).map((s: any) => ({
        step: s.step_order,
        name: s.name,
        status: s.status,
      })),
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
    checks.push({
      name: "Step 2 rejected",
      pass: (state?.steps ?? []).some((s: any) => s.step_order === 2 && s.status === "rejected"),
      actual: (state?.steps ?? []).map((s: any) => ({
        step: s.step_order,
        status: s.status,
      })),
    });
  }

  if (scenario === "sla_breach") {
    checks.push({
      name: "Step 1 still pending",
      pass: (state?.steps ?? []).some((s: any) => s.step_order === 1 && s.status === "pending"),
      actual: (state?.steps ?? []).map((s: any) => ({
        step: s.step_order,
        status: s.status,
        pending_since: s.pending_since,
      })),
    });
    checks.push({
      name: "Breach audit written",
      pass: (state?.audit ?? []).some((a: any) => a.action === "sla_breached"),
      actual: (state?.audit ?? []).map((a: any) => ({
        action: a.action,
        decision: a.decision,
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

  return {
    passed: checks.every((c) => c.pass),
    checks,
  };
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

  const organisationName = await getOrganisationName(supabase, organisationId);

  const programmeLeadId = await getUserIdByEmail(supabase, programmeLeadEmail);
  const commercialLeadId = await getUserIdByEmail(supabase, commercialLeadEmail);
  const accountLeadId = await getUserIdByEmail(supabase, accountLeadEmail);

  const project = await getOrCreateTestProject(supabase, organisationId, userId);
  const artifact = await createProjectCharterArtifact(supabase, project.id, organisationId, userId);

  await createApprovalChain(
    supabase,
    artifact.id,
    project.id,
    organisationId,
    organisationName,
    userId,
    {
      programmeLeadId,
      commercialLeadId,
      accountLeadId,
    },
    {
      programmeLeadEmail,
      commercialLeadEmail,
      accountLeadEmail,
    }
  );

  if (scenario === "happy_path") {
    await approveStep(supabase, {
      organisationId,
      organisationName,
      artifactId: artifact.id,
      stepOrder: 1,
      actorUserId: programmeLeadId,
      actorEmail: programmeLeadEmail,
      comment: "Programme Lead approved",
    });

    await approveStep(supabase, {
      organisationId,
      organisationName,
      artifactId: artifact.id,
      stepOrder: 2,
      actorUserId: commercialLeadId,
      actorEmail: commercialLeadEmail,
      comment: "Commercial Lead approved",
    });

    await approveStep(supabase, {
      organisationId,
      organisationName,
      artifactId: artifact.id,
      stepOrder: 3,
      actorUserId: accountLeadId,
      actorEmail: accountLeadEmail,
      comment: "Account Lead approved",
    });
  }

  if (scenario === "reject_step_2") {
    await approveStep(supabase, {
      organisationId,
      organisationName,
      artifactId: artifact.id,
      stepOrder: 1,
      actorUserId: programmeLeadId,
      actorEmail: programmeLeadEmail,
      comment: "Programme Lead approved",
    });

    await rejectStep(supabase, {
      organisationId,
      organisationName,
      artifactId: artifact.id,
      stepOrder: 2,
      actorUserId: commercialLeadId,
      actorEmail: commercialLeadEmail,
      comment: "Commercial Lead rejected",
    });
  }

  if (scenario === "sla_breach") {
    await markStepAsBreached(supabase, {
      organisationId,
      organisationName,
      artifactId: artifact.id,
      stepOrder: 1,
      actorUserId: userId,
    });
  }

  const state = await readFinalState(supabase, artifact.id);
  const assertions = buildAssertions(state, scenario);

  return {
    ok: true,
    build_marker: BUILD_MARKER,
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