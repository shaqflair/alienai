import "server-only";

type ProjectRole = "owner" | "editor" | "viewer";

type ResolveArtifactAccessArgs = {
  supabase: any;
  artifactId: string;
  userId: string;
};

type ResolveArtifactAccessResult = {
  artifactId: string | null;
  projectId: string | null;
  organisationId: string | null;

  hasProjectAccess: boolean;
  hasProjectEditAccess: boolean;
  hasOrgAccess: boolean;

  hasApprovalAccess: boolean;
  hasCurrentStepApprovalAccess: boolean;

  canViewArtifact: boolean;
  canEditArtifact: boolean;
  canApproveArtifact: boolean;

  projectRole: ProjectRole | null;
  accessMode: "project" | "approval" | "none";

  activeChainId: string | null;
  currentStepId: string | null;
  currentStepStatus: string | null;

  isAssignedApprover: boolean;
  isCurrentStepApprover: boolean;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function stepSortValue(step: any) {
  const n = Number(step?.step_order ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function sortApprovalSteps(rows: any[]) {
  return [...rows].sort((a, b) => {
    const ao = stepSortValue(a);
    const bo = stepSortValue(b);
    if (ao !== bo) return ao - bo;

    const ad = safeStr(a?.created_at);
    const bd = safeStr(b?.created_at);
    if (ad && bd && ad !== bd) return ad < bd ? -1 : 1;

    return safeStr(a?.id).localeCompare(safeStr(b?.id));
  });
}

function getCurrentStep(rows: any[]) {
  const sorted = sortApprovalSteps(rows);

  return (
    sorted.find((s) => s?.is_active === true) ??
    sorted.find((s) => {
      const st = safeLower(s?.status);
      return st === "active" || st === "current" || st === "in_progress" || st === "pending_approval";
    }) ??
    sorted.find((s) => {
      const st = safeLower(s?.status);
      return st === "pending" || st === "submitted" || st === "not_started";
    }) ??
    null
  );
}

async function resolveProjectRole(supabase: any, projectId: string, userId: string): Promise<ProjectRole | null> {
  const { data: pm } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (pm?.role) {
    const r = safeLower(pm.role);
    const mapped = r === "admin" ? "owner" : r === "member" ? "editor" : r;
    if (mapped === "owner" || mapped === "editor" || mapped === "viewer") {
      return mapped as ProjectRole;
    }
    return "viewer";
  }

  const { data: proj } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  const orgId = safeStr(proj?.organisation_id).trim();
  if (!orgId) return null;

  const { data: om } = await supabase
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (!om) return null;

  const orgRole = safeLower(om.role || "member");
  if (orgRole === "admin" || orgRole === "owner") return "owner";
  if (orgRole === "editor" || orgRole === "member") return "editor";
  return "viewer";
}

export async function resolveArtifactAccess({
  supabase,
  artifactId,
  userId,
}: ResolveArtifactAccessArgs): Promise<ResolveArtifactAccessResult> {
  const { data: artifact, error: artifactErr } = await supabase
    .from("artifacts")
    .select("id, project_id, organisation_id, user_id, status, approval_status")
    .eq("id", artifactId)
    .maybeSingle();

  if (artifactErr || !artifact?.id) {
    return {
      artifactId: null,
      projectId: null,
      organisationId: null,
      hasProjectAccess: false,
      hasProjectEditAccess: false,
      hasOrgAccess: false,
      hasApprovalAccess: false,
      hasCurrentStepApprovalAccess: false,
      canViewArtifact: false,
      canEditArtifact: false,
      canApproveArtifact: false,
      projectRole: null,
      accessMode: "none",
      activeChainId: null,
      currentStepId: null,
      currentStepStatus: null,
      isAssignedApprover: false,
      isCurrentStepApprover: false,
    };
  }

  const projectId = safeStr(artifact.project_id).trim() || null;
  const organisationId = safeStr(artifact.organisation_id).trim() || null;

  let projectRole: ProjectRole | null = null;
  let hasProjectAccess = false;
  let hasProjectEditAccess = false;
  let hasOrgAccess = false;

  if (projectId) {
    projectRole = await resolveProjectRole(supabase, projectId, userId);
    hasProjectAccess = !!projectRole;
    hasProjectEditAccess = projectRole === "owner" || projectRole === "editor";
  }

  if (organisationId) {
    const { data: om } = await supabase
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", organisationId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();

    hasOrgAccess = !!om;
  }

  const { data: activeChain } = await supabase
    .from("approval_chains")
    .select("id")
    .eq("artifact_id", artifactId)
    .eq("is_active", true)
    .maybeSingle();

  const activeChainId = safeStr(activeChain?.id).trim() || null;

  if (!activeChainId) {
    return {
      artifactId,
      projectId,
      organisationId,
      hasProjectAccess,
      hasProjectEditAccess,
      hasOrgAccess,
      hasApprovalAccess: false,
      hasCurrentStepApprovalAccess: false,
      canViewArtifact: hasProjectAccess,
      canEditArtifact: hasProjectEditAccess,
      canApproveArtifact: false,
      projectRole,
      accessMode: hasProjectAccess ? "project" : "none",
      activeChainId: null,
      currentStepId: null,
      currentStepStatus: null,
      isAssignedApprover: false,
      isCurrentStepApprover: false,
    };
  }

  const { data: stepRows } = await supabase
    .from("artifact_approval_steps")
    .select("*")
    .eq("chain_id", activeChainId);

  const steps = Array.isArray(stepRows) ? stepRows : [];
  const currentStep = getCurrentStep(steps);
  const currentStepId = safeStr(currentStep?.id).trim() || null;
  const currentStepStatus = safeLower(currentStep?.status) || null;

  const { data: allApproverRows } = currentStepId
    ? await supabase
        .from("approval_step_approvers")
        .select("*")
        .in(
          "step_id",
          steps.map((s: any) => s.id).filter(Boolean)
        )
    : { data: [] };

  const approverRows = Array.isArray(allApproverRows) ? allApproverRows : [];

  const matchesUser = (r: any) =>
    safeStr(r?.user_id).trim() === userId ||
    safeStr(r?.approver_user_id).trim() === userId ||
    safeStr(r?.delegate_user_id).trim() === userId;

  const assignedApproverRow = approverRows.find(matchesUser) ?? null;
  const isAssignedApprover = !!assignedApproverRow;

  const currentStepApproverRow =
    approverRows.find((r: any) => safeStr(r?.step_id).trim() === currentStepId && matchesUser(r)) ?? null;

  const approverStatus = safeLower(
    currentStepApproverRow?.status ?? currentStepApproverRow?.decision_status ?? ""
  );

  const stepOpen =
    currentStepStatus === "pending" ||
    currentStepStatus === "active" ||
    currentStepStatus === "current" ||
    currentStepStatus === "in_progress" ||
    currentStepStatus === "pending_approval" ||
    currentStepStatus === "submitted" ||
    currentStepStatus === "not_started";

  const approverStillOpen =
    !approverStatus ||
    approverStatus === "pending" ||
    approverStatus === "active" ||
    approverStatus === "assigned" ||
    approverStatus === "not_started";

  const hasApprovalAccess = hasOrgAccess && isAssignedApprover;
  const hasCurrentStepApprovalAccess = hasOrgAccess && !!currentStepApproverRow;
  const canApproveArtifact = hasCurrentStepApprovalAccess && stepOpen && approverStillOpen;

  return {
    artifactId,
    projectId,
    organisationId,
    hasProjectAccess,
    hasProjectEditAccess,
    hasOrgAccess,
    hasApprovalAccess,
    hasCurrentStepApprovalAccess,
    canViewArtifact: hasProjectAccess || hasApprovalAccess,
    canEditArtifact: hasProjectEditAccess,
    canApproveArtifact,
    projectRole,
    accessMode: hasProjectAccess ? "project" : hasApprovalAccess ? "approval" : "none",
    activeChainId,
    currentStepId,
    currentStepStatus,
    isAssignedApprover,
    isCurrentStepApprover: !!currentStepApproverRow,
  };
}
