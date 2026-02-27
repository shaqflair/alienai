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
  isFinancialPlanType,           // ✅ NEW
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
  "created_at",
  "updated_at",
  "is_locked",
  "locked_at",
  "locked_by",
  "approval_status",
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

// If your DB uses one canonical string, reduce this list to that single type.
const WBS_TYPES = ["wbs", "work_breakdown_structure"];

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

/**
 * ✅ local safeParam (avoids runtime mismatch if utils import resolves differently)
 */
function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof (x as any)[0] === "string") return (x as any)[0];
  return "";
}

/**
 * ✅ runtime-safe UUID detector (guards against "looksLikeUuid is not a function")
 */
function looksLikeUuid(s: string) {
  if (typeof _looksLikeUuid === "function") return _looksLikeUuid(s);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

/**
 * ✅ runtime-safe weekly detector (guards against "isWeeklyReportType is not a function")
 */
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

/**
 * ✅ Backward compatible role resolution:
 * 1) Try project_members (legacy)
 * 2) Fallback to org membership (new model): projects.organisation_id + organisation_members
 */
async function resolveMyRole(supabase: any, projectUuid: string, userId: string) {
  // 1) legacy: project_members
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

  // 2) new: org membership
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

  // map org role -> project effective role
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

export async function loadArtifactDetail(params: Promise<{ id?: string; artifactId?: string }>) {
  const supabase = await createClient();

  // 1) Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id, artifactId: aid } = await params;
  const projectIdentifierRaw = safeParam(id);
  const artifactId = safeParam(aid);

  if (!projectIdentifierRaw || !artifactId || projectIdentifierRaw === "undefined") notFound();
  if (!looksLikeUuid(artifactId)) notFound();

  const projectIdentifier = String(projectIdentifierRaw).trim();

  // 2) Resolve project UUID (slug/human id support)
  const resolved = await resolveProjectUuidFast(supabase, projectIdentifier);
  let projectUuid: string | null = resolved.projectUuid;

  // Fallback: resolve via artifact.project_id (if project id/slug is wrong but artifact is real)
  if (!projectUuid) {
    const { data: a0 } = await supabase.from("artifacts").select("project_id").eq("id", artifactId).maybeSingle();
    if (!a0?.project_id) notFound();
    projectUuid = String(a0.project_id);
  }

  // 3) ✅ Membership gate (legacy + org fallback)
  const myRoleResolved = await resolveMyRole(supabase, projectUuid!, auth.user.id);
  if (!myRoleResolved) notFound();

  const myRole = myRoleResolved; // owner|editor|viewer
  const canEditByRole = myRole === "owner" || myRole === "editor";

  // ✅ Start WBS lookup early (cheap + parallel)
  const wbsPromise = supabase
    .from("artifacts")
    .select("id, content_json, updated_at, type, is_current")
    .eq("project_id", projectUuid)
    .in("type", WBS_TYPES as any)
    .eq("is_current", true)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 4) Fetch project + artifact in parallel
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

  const { data: artifact, error: artErr } = artifactRes as any;
  if (artErr || !artifact) notFound();

  // 5) Canonical redirect (stable project code in URL)
  const canonicalProjectCode = safeStr((project as any)?.project_code).trim();
  if (canonicalProjectCode && projectIdentifier !== canonicalProjectCode) {
    redirect(`/projects/${canonicalProjectCode}/artifacts/${artifactId}`);
  }

  // 6) Specialized module redirects
  if (isRAIDType(artifact.type)) {
    redirect(`/projects/${canonicalProjectCode || projectUuid}/raid?fromArtifact=${artifactId}`);
  }

  if (isLessonsLearnedType(artifact.type)) {
    redirect(`/projects/${canonicalProjectCode || projectUuid}/lessons?fromArtifact=${artifactId}`);
  }

  // 7) Modes + approval scope
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
  const financialPlanMode = isFinancialPlanType(artifact.type); // ✅ NEW

  // ✅ Only Charter/Closure are approval-governed (Weekly Report + Financial Plan are living)
  const approvalEnabled = charterMode || closureMode;

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
    : financialPlanMode       // ✅ NEW
    ? "financial_plan"        // ✅ NEW
    : "fallback";

  // 8) Status + permissions
  const status = derivedStatus(artifact);
  const pill = statusPill(status);

  const isAuthor = safeStr(artifact.user_id) === auth.user.id;
  const isApprover = approvalEnabled ? myRole === "owner" : false;

  // ✅ Treat NULL as "current"
  const isCurrent = (artifact as any)?.is_current !== false;

  const isEditable = approvalEnabled
    ? canEditByRole && !artifact.is_locked && (status === "draft" || status === "changes_requested") && isCurrent
    : weeklyMode
    ? canEditByRole
    : canEditByRole;

  const lockLayout = approvalEnabled && (status === "submitted" || status === "approved" || status === "rejected");

  const canSubmitOrResubmit =
    approvalEnabled && isEditable && isCurrent && (status === "draft" || status === "changes_requested");

  const canDecide = approvalEnabled && status === "submitted" && isApprover && !isAuthor;

  const canRenameTitle =
    canEditByRole && !artifact.is_locked && (!approvalEnabled || status === "draft" || status === "changes_requested");

  const canCreateRevision = approvalEnabled && isApprover && isCurrent && status === "approved";

  // 9) Content prep
  const charterInitialRaw = ensureCharterV2Stored(getCharterInitialRaw(artifact));
  const charterInitial = forceProjectTitleIntoCharter(charterInitialRaw, projectTitle, clientName);
  const typedInitialJson = getTypedInitialJson(artifact);

  // 10) WBS helpers for schedule
  const wbsRow = (wbsRes as any)?.data ?? null;
  const wbsArtifactId = wbsRow?.id ? String(wbsRow.id) : null;

  // ✅ for schedule editor we want the latest WBS json
  const latestWbsJson = scheduleMode ? (wbsRow?.content_json ?? null) : null;

  return {
    projectUuid,
    projectHumanId: canonicalProjectCode || projectUuid,
    projectTitle,
    projectStartDate,
    projectFinishDate,
    clientName,

    myRole,

    artifactId,
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

    mode,

    aiTargetType: safeStr((artifact as any)?.type ?? ""),
    aiTitle: safeStr((artifact as any)?.title ?? "") || safeStr((artifact as any)?.type ?? ""),

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
    financialPlanMode,   // ✅ NEW
  };
}