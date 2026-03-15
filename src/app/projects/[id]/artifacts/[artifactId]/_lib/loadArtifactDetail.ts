// src/app/projects/[id]/artifacts/[artifactId]/_lib/loadArtifactDetail.ts
import "server-only";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import {
  derivedStatus,
  ensureCharterV2Stored,
  forceProjectTitleIntoCharter,
  getCharterInitialRaw,
  getTypedInitialJson,
  isChangeRequestsType,
  isFinancialPlanType,
  isLessonsLearnedType,
  isProjectCharterType,
  isProjectClosureReportType,
  isRAIDType,
  isScheduleType,
  isStakeholderRegisterType,
  isWbsType,
  isWeeklyReportType as _isWeeklyReportType,
  looksLikeUuid as _looksLikeUuid,
  statusPill,
} from "./artifact-detail-utils";

import { resolveProjectUuidFast } from "./resolveProjectUuidFast";

const ARTIFACT_SELECT = [
  "id",
  "project_id",
  "user_id",
  "type",
  "title",
  "content",
  "content_json",
  "status",
  "created_at",
  "updated_at",
  "is_locked",
  "locked_at",
  "locked_by",
  "approval_status",
  "approval_chain_id",
  "approved_by",
  "approved_at",
  "rejected_by",
  "rejected_at",
  "rejection_reason",
  "version",
  "parent_artifact_id",
  "root_artifact_id",
  "is_current",
  "is_baseline",
  "last_saved_at",
].join(", ");

const PROJECT_META_SELECT =
  "id, project_code, title, name, client_name, start_date, finish_date, organisation_id";

const WBS_TYPES = ["wbs", "work_breakdown_structure"];

const CANONICAL_PROJECT_CHARTER_TYPE = "PROJECT_CHARTER";
const LEGACY_PROJECT_CHARTER_TYPES = ["PID"];

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof (x as any)[0] === "string") return (x as any)[0];
  return "";
}

function looksLikeUuid(s: string) {
  if (typeof _looksLikeUuid === "function") return _looksLikeUuid(s);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isWeeklyReportType(type: any) {
  if (typeof _isWeeklyReportType === "function") return _isWeeklyReportType(type);
  const t = safeLower(type);
  return [
    "weekly_report",
    "weekly report",
    "weekly",
    "weekly_status",
    "weekly status",
    "weekly_update",
    "weekly update",
    "delivery_report",
    "delivery report",
    "status_report",
    "status report",
  ].includes(t);
}

function isLegacyPidType(type: any) {
  return LEGACY_PROJECT_CHARTER_TYPES.includes(safeStr(type).trim().toUpperCase());
}

function normalizeArtifactTypeForUi(type: any) {
  if (isProjectCharterType(type)) return CANONICAL_PROJECT_CHARTER_TYPE;
  return safeStr(type).trim();
}

async function resolveMyRole(supabase: any, projectUuid: string, userId: string) {
  const { data: pm } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectUuid)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (pm?.role) {
    const r = safeLower(pm.role);
    const mapped = r === "admin" ? "owner" : r === "member" ? "editor" : r;
    const role = mapped === "owner" || mapped === "editor" || mapped === "viewer" ? mapped : "viewer";
    return role as "owner" | "editor" | "viewer";
  }

  const { data: proj } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectUuid)
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
  const effective =
    orgRole === "admin"
      ? "owner"
      : orgRole === "owner"
        ? "owner"
        : orgRole === "editor"
          ? "editor"
          : orgRole === "member"
            ? "editor"
            : "viewer";

  return effective as "owner" | "editor" | "viewer";
}

async function findCanonicalProjectCharterArtifact(
  supabase: any,
  projectUuid: string,
  excludeArtifactId?: string | null
) {
  let query = supabase
    .from("artifacts")
    .select("id, type, is_current, updated_at, version")
    .eq("project_id", projectUuid)
    .eq("type", CANONICAL_PROJECT_CHARTER_TYPE)
    .order("is_current", { ascending: false })
    .order("updated_at", { ascending: false })
    .order("version", { ascending: false })
    .limit(1);

  if (excludeArtifactId) query = query.neq("id", excludeArtifactId);

  const { data, error } = await query.maybeSingle();
  if (error) return null;
  return data ?? null;
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

async function resolveOrganisationApproverAccess(
  supabase: any,
  args: { projectUuid: string; artifactId: string; userId: string }
) {
  const { data: projectOrg, error: projectOrgErr } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", args.projectUuid)
    .maybeSingle();

  if (projectOrgErr) {
    return {
      hasOrgAccess: false,
      hasApproverAccess: false,
      chainId: null as string | null,
      stepId: null as string | null,
    };
  }

  const organisationId = safeStr((projectOrg as any)?.organisation_id).trim();
  if (!organisationId) {
    return {
      hasOrgAccess: false,
      hasApproverAccess: false,
      chainId: null,
      stepId: null,
    };
  }

  const { data: orgMember, error: orgErr } = await supabase
    .from("organisation_members")
    .select("user_id, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", args.userId)
    .is("removed_at", null)
    .maybeSingle();

  const hasOrgAccess = !orgErr && !!orgMember;
  if (!hasOrgAccess) {
    return {
      hasOrgAccess: false,
      hasApproverAccess: false,
      chainId: null,
      stepId: null,
    };
  }

  const { data: activeChain, error: chainErr } = await supabase
    .from("approval_chains")
    .select("id")
    .eq("artifact_id", args.artifactId)
    .eq("is_active", true)
    .maybeSingle();

  if (chainErr || !activeChain?.id) {
    return {
      hasOrgAccess: true,
      hasApproverAccess: false,
      chainId: null,
      stepId: null,
    };
  }

  const { data: stepRows, error: stepsErr } = await supabase
    .from("artifact_approval_steps")
    .select("*")
    .eq("chain_id", activeChain.id);

  if (stepsErr || !Array.isArray(stepRows) || stepRows.length === 0) {
    return {
      hasOrgAccess: true,
      hasApproverAccess: false,
      chainId: safeStr(activeChain.id) || null,
      stepId: null,
    };
  }

  const currentStep = getCurrentStep(stepRows);
  if (!currentStep?.id) {
    return {
      hasOrgAccess: true,
      hasApproverAccess: false,
      chainId: safeStr(activeChain.id) || null,
      stepId: null,
    };
  }

  const { data: approverRows, error: approversErr } = await supabase
    .from("approval_step_approvers")
    .select("*")
    .eq("step_id", currentStep.id);

  if (approversErr || !Array.isArray(approverRows)) {
    return {
      hasOrgAccess: true,
      hasApproverAccess: false,
      chainId: safeStr(activeChain.id) || null,
      stepId: safeStr(currentStep.id) || null,
    };
  }

  const matched =
    approverRows.find((r: any) => safeStr(r?.user_id).trim() === args.userId) ??
    approverRows.find((r: any) => safeStr(r?.approver_user_id).trim() === args.userId) ??
    approverRows.find((r: any) => safeStr(r?.delegate_user_id).trim() === args.userId) ??
    null;

  return {
    hasOrgAccess: true,
    hasApproverAccess: !!matched,
    chainId: safeStr(activeChain.id) || null,
    stepId: safeStr(currentStep.id) || null,
  };
}

async function resolveApprovalDecisionState(
  supabase: any,
  args: {
    artifactId: string;
    userId: string;
    myRole: "owner" | "editor" | "viewer";
    isAuthor: boolean;
    approvalEnabled: boolean;
    status: string;
  }
) {
  const statusLower = safeLower(args.status);

  if (!args.approvalEnabled || statusLower !== "submitted") {
    return {
      isApprover: false,
      canDecide: false,
      activeChainId: null as string | null,
      currentStepId: null as string | null,
      currentStepStatus: null as string | null,
    };
  }

  const { data: activeChain, error: chainErr } = await supabase
    .from("approval_chains")
    .select("id, is_active, status")
    .eq("artifact_id", args.artifactId)
    .eq("is_active", true)
    .maybeSingle();

  if (chainErr || !activeChain?.id) {
    return {
      isApprover: false,
      canDecide: false,
      activeChainId: null,
      currentStepId: null,
      currentStepStatus: null,
    };
  }

  const { data: stepRows, error: stepsErr } = await supabase
    .from("artifact_approval_steps")
    .select("*")
    .eq("chain_id", activeChain.id);

  if (stepsErr || !Array.isArray(stepRows) || stepRows.length === 0) {
    const roleFallbackIsApprover = args.myRole === "owner" && !args.isAuthor;
    return {
      isApprover: roleFallbackIsApprover,
      canDecide: roleFallbackIsApprover,
      activeChainId: safeStr(activeChain.id),
      currentStepId: null,
      currentStepStatus: null,
    };
  }

  const currentStep = getCurrentStep(stepRows);
  if (!currentStep?.id) {
    const roleFallbackIsApprover = args.myRole === "owner" && !args.isAuthor;
    return {
      isApprover: roleFallbackIsApprover,
      canDecide: roleFallbackIsApprover,
      activeChainId: safeStr(activeChain.id),
      currentStepId: null,
      currentStepStatus: null,
    };
  }

  const { data: approverRows, error: approversErr } = await supabase
    .from("approval_step_approvers")
    .select("*")
    .eq("step_id", currentStep.id);

  if (approversErr) {
    const roleFallbackIsApprover = args.myRole === "owner" && !args.isAuthor;
    return {
      isApprover: roleFallbackIsApprover,
      canDecide: roleFallbackIsApprover,
      activeChainId: safeStr(activeChain.id),
      currentStepId: safeStr(currentStep.id),
      currentStepStatus: safeLower(currentStep.status),
    };
  }

  const rows = Array.isArray(approverRows) ? approverRows : [];

  const matchedApprover =
    rows.find((r: any) => safeStr(r?.user_id).trim() === args.userId) ??
    rows.find((r: any) => safeStr(r?.approver_user_id).trim() === args.userId) ??
    rows.find((r: any) => safeStr(r?.delegate_user_id).trim() === args.userId) ??
    null;

  const approverStatus = safeLower(
    (matchedApprover as any)?.status ??
      (matchedApprover as any)?.decision_status ??
      ""
  );

  const stepStatus = safeLower(currentStep?.status);
  const stepOpen =
    stepStatus === "pending" ||
    stepStatus === "active" ||
    stepStatus === "current" ||
    stepStatus === "in_progress" ||
    stepStatus === "pending_approval" ||
    stepStatus === "submitted" ||
    stepStatus === "not_started";

  const approverStillOpen =
    !approverStatus ||
    approverStatus === "pending" ||
    approverStatus === "active" ||
    approverStatus === "assigned" ||
    approverStatus === "not_started";

  const isAssignedApprover = !!matchedApprover;
  const roleFallbackIsApprover = rows.length === 0 && args.myRole === "owner" && !args.isAuthor;
  const isApprover = isAssignedApprover || roleFallbackIsApprover;
  const canDecide = !args.isAuthor && isApprover && stepOpen && (isAssignedApprover ? approverStillOpen : true);

  return {
    isApprover,
    canDecide,
    activeChainId: safeStr(activeChain.id) || null,
    currentStepId: safeStr(currentStep.id) || null,
    currentStepStatus: stepStatus || null,
  };
}

export async function loadArtifactDetail(params: Promise<{ id?: string; artifactId?: string }>) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id, artifactId: aid } = await params;
  const projectIdentifierRaw = safeParam(id);
  const artifactId = safeParam(aid);

  if (!projectIdentifierRaw || !artifactId || projectIdentifierRaw === "undefined") notFound();
  if (!looksLikeUuid(artifactId)) notFound();

  const projectIdentifier = String(projectIdentifierRaw).trim();

  const resolved = await resolveProjectUuidFast(supabase, projectIdentifier);
  let projectUuid: string | null = resolved.projectUuid;

  if (!projectUuid) {
    const { data: a0 } = await supabase.from("artifacts").select("project_id").eq("id", artifactId).maybeSingle();
    if (!a0?.project_id) notFound();
    projectUuid = String(a0.project_id);
  }

  const myRoleResolved = await resolveMyRole(supabase, projectUuid!, auth.user.id);
  const organisationApproverAccess = await resolveOrganisationApproverAccess(supabase, {
    projectUuid: projectUuid!,
    artifactId,
    userId: auth.user.id,
  });

  if (!myRoleResolved && !organisationApproverAccess.hasApproverAccess) notFound();

  const myRole =
    myRoleResolved ??
    ("viewer" as "owner" | "editor" | "viewer");

  const canEditByRole = myRole === "owner" || myRole === "editor";

  const wbsPromise = supabase
    .from("artifacts")
    .select("id, content_json, updated_at, type, is_current")
    .eq("project_id", projectUuid)
    .in("type", WBS_TYPES as any)
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const projectPromise = (async () => {
    if (resolved.project && String((resolved.project as any)?.id || "") === projectUuid) return resolved.project;
    const { data: p } = await supabase.from("projects").select(PROJECT_META_SELECT).eq("id", projectUuid).maybeSingle();
    return p ?? resolved.project ?? null;
  })();

  const artifactPromise = supabase
    .from("artifacts")
    .select(ARTIFACT_SELECT)
    .eq("id", artifactId)
    .eq("project_id", projectUuid)
    .maybeSingle();

  const [project, artifactRes, wbsRes] = await Promise.all([projectPromise, artifactPromise, wbsPromise]);

  const { data: artifactRaw, error: artErr } = artifactRes as any;
  if (artErr || !artifactRaw) notFound();

  if (isLegacyPidType(artifactRaw.type)) {
    const canonicalCharter = await findCanonicalProjectCharterArtifact(supabase, projectUuid!, artifactRaw.id);
    if (canonicalCharter?.id) {
      const projectCode = safeStr((project as any)?.project_code).trim();
      redirect(`/projects/${projectCode || projectUuid}/artifacts/${canonicalCharter.id}`);
    }
  }

  const artifact = {
    ...artifactRaw,
    type: normalizeArtifactTypeForUi(artifactRaw.type),
  };

  const canonicalProjectCode = safeStr((project as any)?.project_code).trim();
  if (canonicalProjectCode && projectIdentifier !== canonicalProjectCode) {
    redirect(`/projects/${canonicalProjectCode}/artifacts/${artifactId}`);
  }

  if (isRAIDType(artifact.type)) {
    redirect(`/projects/${canonicalProjectCode || projectUuid}/raid?fromArtifact=${artifactId}`);
  }
  if (isLessonsLearnedType(artifact.type)) {
    redirect(`/projects/${canonicalProjectCode || projectUuid}/lessons?fromArtifact=${artifactId}`);
  }

  const projectTitle = safeStr((project as any)?.title ?? (project as any)?.name ?? "").trim();
  const clientName = safeStr((project as any)?.client_name ?? "").trim();
  const projectStartDate = safeStr((project as any)?.start_date ?? "").trim() || null;
  const projectFinishDate = safeStr((project as any)?.finish_date ?? "").trim() || null;

  const charterMode = isProjectCharterType(artifact.type);
  const closureMode = isProjectClosureReportType(artifact.type);
  const stakeholderMode = isStakeholderRegisterType(artifact.type);
  const wbsMode = isWbsType(artifact.type);
  const scheduleMode = isScheduleType(artifact.type);
  const changeRequestsMode = isChangeRequestsType(artifact.type);
  const weeklyMode = isWeeklyReportType(artifact.type);
  const financialPlanMode = isFinancialPlanType(artifact.type);

  const approvalEnabled = charterMode || closureMode || financialPlanMode;

  const mode = charterMode
    ? "charter"
    : stakeholderMode
      ? "stakeholder"
      : wbsMode
        ? "wbs"
        : scheduleMode
          ? "schedule"
          : changeRequestsMode
            ? "change_requests"
            : closureMode
              ? "closure"
              : weeklyMode
                ? "weekly_report"
                : financialPlanMode
                  ? "financial_plan"
                  : "fallback";

  const status = derivedStatus(artifact);
  const pill = statusPill(status);

  const isAuthor = safeStr(artifact.user_id) === auth.user.id;
  const isCurrent = (artifact as any)?.is_current !== false;

  const isEditable = approvalEnabled
    ? canEditByRole && !artifact.is_locked && (status === "draft" || status === "changes_requested") && isCurrent
    : weeklyMode
      ? canEditByRole
      : canEditByRole;

  const lockLayout =
    approvalEnabled && (status === "submitted" || status === "approved" || status === "rejected");

  const canSubmitOrResubmit =
    approvalEnabled && isEditable && isCurrent && (status === "draft" || status === "changes_requested");

  const approvalDecisionState = await resolveApprovalDecisionState(supabase, {
    artifactId: String(artifact.id),
    userId: auth.user.id,
    myRole,
    isAuthor,
    approvalEnabled,
    status,
  });

  const isApprover = approvalDecisionState.isApprover;
  const canDecide = approvalDecisionState.canDecide;

  const canRenameTitle =
    canEditByRole &&
    !artifact.is_locked &&
    (!approvalEnabled || status === "draft" || status === "changes_requested");

  const canCreateRevision = approvalEnabled && canEditByRole && isCurrent && status === "approved";

  const charterInitialRaw = ensureCharterV2Stored(getCharterInitialRaw(artifact));
  const charterInitial = forceProjectTitleIntoCharter(charterInitialRaw, projectTitle, clientName);
  const typedInitialJson = getTypedInitialJson(artifact);

  const wbsRow = (wbsRes as any)?.data ?? null;
  const wbsArtifactId = wbsRow?.id ? String(wbsRow.id) : null;
  const latestWbsJson = scheduleMode ? (wbsRow?.content_json ?? null) : null;

  return {
    projectUuid,
    projectHumanId: canonicalProjectCode || projectUuid,
    projectTitle,
    projectStartDate,
    projectFinishDate,
    clientName,

    myRole,

    artifactId: String(artifact.id),
    artifact,

    approvalEnabled,
    status,
    pill,
    isAuthor,
    isApprover,
    isEditable,
    lockLayout,
    canSubmitOrResubmit,
    canDecide,
    canRenameTitle,
    canCreateRevision,

    activeApprovalChainId: approvalDecisionState.activeChainId ?? organisationApproverAccess.chainId,
    currentApprovalStepId: approvalDecisionState.currentStepId ?? organisationApproverAccess.stepId,
    currentApprovalStepStatus: approvalDecisionState.currentStepStatus,

    mode,

    aiTargetType: normalizeArtifactTypeForUi((artifact as any)?.type ?? ""),
    aiTitle:
      safeStr((artifact as any)?.title ?? "") ||
      normalizeArtifactTypeForUi((artifact as any)?.type ?? ""),

    charterInitial,
    typedInitialJson,

    latestWbsJson,
    wbsArtifactId,

    changeRequestsMode,
    charterMode,
    stakeholderMode,
    wbsMode,
    scheduleMode,
    closureMode,
    weeklyMode,
    financialPlanMode,
  };
}