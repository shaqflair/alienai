// src/app/projects/[id]/artifacts/[artifactId]/page.tsx
import "server-only";
import React from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { ClientDateTime } from "@/components/date/ClientDateTime";
import ArtifactDetailClientHost from "@/components/artifacts/ArtifactDetailClientHost";
import {
  updateArtifact,
  createArtifactRevision,
  setArtifactCurrent,
  updateArtifactJsonArgs,
  updateArtifactJsonSilent,
} from "../actions";
import {
  submitArtifactForApproval,
  approveArtifact,
  requestChangesArtifact,
  rejectFinalArtifact,
  renameArtifactTitle,
} from "./approval-actions";
import { displayType } from "./_lib/artifact-detail-utils";
import { loadArtifactDetail } from "./_lib/loadArtifactDetail";
import FinancialPlanAuditTrail from "@/components/artifacts/FinancialPlanAuditTrail";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function normParam(v: any) {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s === "undefined" || s === "null") return "";
  return s;
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function getProjectManagerNameBestEffort(supabase: any, projectId: string): Promise<string | null> {
  if (!projectId) return null;
  const pmRoleCandidates = [
    "project_manager", "project manager", "pm",
    "programme_manager", "program_manager",
    "programme manager", "program manager",
    "delivery_manager", "delivery manager",
  ];
  async function readProfileName(userId: string): Promise<string | null> {
    const uid = safeStr(userId).trim();
    if (!uid) return null;
    const { data: prof } = await supabase
      .from("profiles")
      .select("full_name, display_name, name, email, user_id, id")
      .or(`user_id.eq.${uid},id.eq.${uid}`)
      .maybeSingle();
    const full = safeStr((prof as any)?.full_name).trim();
    if (full) return full;
    const disp = safeStr((prof as any)?.display_name).trim();
    if (disp) return disp;
    const nm = safeStr((prof as any)?.name).trim();
    if (nm) return nm;
    const email = safeStr((prof as any)?.email).trim();
    return email || null;
  }
  for (const role of pmRoleCandidates) {
    const { data, error } = await supabase
      .from("project_members")
      .select("user_id, role")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .ilike("role", role)
      .limit(1);
    if (error) break;
    const userId = safeStr(data?.[0]?.user_id).trim();
    const name = await readProfileName(userId);
    if (name) return name;
  }
  const { data: mems } = await supabase
    .from("project_members")
    .select("user_id, role")
    .eq("project_id", projectId)
    .eq("is_active", true)
    .in("role", ["owner", "editor"])
    .limit(1);
  const fallbackUserId = safeStr(mems?.[0]?.user_id).trim();
  if (!fallbackUserId) return null;
  return await readProfileName(fallbackUserId);
}

// -- Status pill config -------------------------------------------------------

function statusConfig(status: string): { label: string; bg: string; color: string; dot: string } {
  const s = String(status || "").toLowerCase();
  if (s === "approved")          return { label: "Approved",   bg: "#dcfce7", color: "#15803d", dot: "#22c55e" };
  if (s === "submitted")         return { label: "In review",  bg: "#dbeafe", color: "#1d4ed8", dot: "#3b82f6" };
  if (s === "changes_requested") return { label: "Changes req",bg: "#fef3c7", color: "#b45309", dot: "#f59e0b" };
  if (s === "rejected")          return { label: "Rejected",   bg: "#fee2e2", color: "#b91c1c", dot: "#ef4444" };
  return                                { label: "Draft",       bg: "#f1f5f9", color: "#475569", dot: "#94a3b8" };
}

export default async function ArtifactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string; artifactId?: string }>;
  searchParams?: Promise<{ action_error?: string }>;
}) {
  const p = await params;
  const sp = searchParams ? await searchParams : {};
  const actionError = normParam(sp?.action_error ?? "");
  const projectParam  = normParam(p?.id);
  const artifactParam = normParam(p?.artifactId);
  if (!projectParam || !artifactParam) notFound();

  const activeOrgId = await getActiveOrgId().catch(() => null);
  const vm = await loadArtifactDetail(
    Promise.resolve({ id: projectParam, artifactId: artifactParam })
  );

  const {
    projectUuid, projectHumanId, projectTitle,
    projectStartDate, projectFinishDate, myRole,
    artifactId, artifact,
    approvalEnabled, status, pill, isAuthor, isApprover,
    isEditable: loaderIsEditable,
    canDecide, canRenameTitle, canCreateRevision,
    mode, aiTargetType, aiTitle,
    charterInitial, typedInitialJson, latestWbsJson, wbsArtifactId,
    changeRequestsMode, charterMode, stakeholderMode,
    wbsMode, scheduleMode, closureMode, financialPlanMode,
    legacyExports, weeklyMode,
  } = vm as any;

  const projectRefForPaths = normParam(projectHumanId) || projectParam || normParam(projectUuid);

  const isWeeklyReport  = mode === "weekly_report"  || !!weeklyMode;
  const isFinancialPlan = mode === "financial_plan"  || !!financialPlanMode;

  const roleLower     = String(myRole  || "").toLowerCase();
  const canEditByRole = roleLower === "owner" || roleLower === "editor";
  const statusLower   = String(status || "").toLowerCase();
  const isDraftOrCR   = statusLower === "draft" || statusLower === "changes_requested";
  const isSubmitted   = statusLower === "submitted";
  const isCurrent     = (artifact as any)?.is_current !== false;

  const effectiveLockLayout =
    !!approvalEnabled &&
    (isSubmitted || statusLower === "approved" || statusLower === "rejected");

  const effectiveIsEditable =
    approvalEnabled && (charterMode || closureMode || financialPlanMode)
      ? canEditByRole && isDraftOrCR && !effectiveLockLayout && isCurrent
      : !!loaderIsEditable;

  const canSubmitFromServer =
    !!approvalEnabled && !!(charterMode || closureMode || financialPlanMode) &&
    canEditByRole && isCurrent && isDraftOrCR && !effectiveLockLayout;

  const canSubmitNonCharter =
    !!approvalEnabled && !(charterMode || closureMode || financialPlanMode) &&
    !!loaderIsEditable && !!isCurrent && !effectiveLockLayout;

  let projectManagerName: string | null = null;
  let projectTitleForSeed = safeStr(projectTitle).trim();

  try {
    const supabase = await createClient();
    if (!projectTitleForSeed && projectUuid) {
      const { data: proj } = await supabase
        .from("projects").select("title").eq("id", projectUuid).maybeSingle();
      const t = safeStr((proj as any)?.title).trim();
      if (t) projectTitleForSeed = t;
    }
    if (projectUuid) {
      projectManagerName = await getProjectManagerNameBestEffort(supabase, String(projectUuid));
    }
  } catch {
    projectManagerName = projectManagerName ?? null;
    projectTitleForSeed = projectTitleForSeed || safeStr(projectTitle).trim();
  }

  // -- Server actions --------------------------------------------------------

  const artifactPath  = `/projects/${projectRefForPaths}/artifacts/${artifactId}`;
  const artifactsPath = `/projects/${projectRefForPaths}/artifacts`;

  async function submitAction() {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    const ok = charterMode || closureMode || financialPlanMode ? canSubmitFromServer : canSubmitNonCharter;
    if (!ok) return;
    let errMsg: string | null = null;
    try {
      await submitArtifactForApproval(projectUuid, artifactId);
    } catch (e: any) {
      errMsg = String(e?.message ?? "Submit failed");
    }
    if (errMsg) {
      redirect(`${artifactPath}?action_error=${encodeURIComponent(errMsg)}`);
    }
    revalidatePath(artifactPath);
    revalidatePath(artifactsPath);
    redirect(artifactPath);
  }

  async function approveAction() {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    let errMsg: string | null = null;
    try {
      await approveArtifact(projectUuid, artifactId);
    } catch (e: any) {
      errMsg = String(e?.message ?? "Approve failed");
    }
    if (errMsg) {
      redirect(`${artifactPath}?action_error=${encodeURIComponent(errMsg)}`);
    }
    revalidatePath(artifactPath);
    revalidatePath(artifactsPath);
    redirect(artifactPath);
  }

  async function requestChangesAction(formData: FormData) {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    let errMsg: string | null = null;
    try {
      await requestChangesArtifact(projectUuid, artifactId, reason);
    } catch (e: any) {
      errMsg = String(e?.message ?? "Request changes failed");
    }
    if (errMsg) {
      redirect(`${artifactPath}?action_error=${encodeURIComponent(errMsg)}`);
    }
    revalidatePath(artifactPath);
    revalidatePath(artifactsPath);
    redirect(artifactPath);
  }

  async function rejectFinalAction(formData: FormData) {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    let errMsg: string | null = null;
    try {
      await rejectFinalArtifact(projectUuid, artifactId, reason);
    } catch (e: any) {
      errMsg = String(e?.message ?? "Reject failed");
    }
    if (errMsg) {
      redirect(`${artifactPath}?action_error=${encodeURIComponent(errMsg)}`);
    }
    revalidatePath(artifactPath);
    revalidatePath(artifactsPath);
    redirect(artifactPath);
  }

  async function renameTitleAction(formData: FormData) {
    "use server";
    let errMsg: string | null = null;
    try {
      await renameArtifactTitle(formData);
    } catch (e: any) {
      errMsg = String(e?.message ?? "Rename failed");
    }
    if (errMsg) {
      redirect(`${artifactPath}?action_error=${encodeURIComponent(errMsg)}`);
    }
    revalidatePath(artifactPath);
    revalidatePath(artifactsPath);
    redirect(artifactPath);
  }

  async function createRevisionAction() {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    let newArtifactId = "";
    let errMsg: string | null = null;
    try {
      const res = await createArtifactRevision({
        projectId: projectUuid, artifactId,
        revisionReason: "Revision created", revisionType: "material",
      });
      newArtifactId = safeStr((res as any).newArtifactId).trim();
    } catch (e: any) {
      errMsg = String(e?.message ?? "Create revision failed");
    }
    if (errMsg) {
      redirect(`${artifactPath}?action_error=${encodeURIComponent(errMsg)}`);
    }
    revalidatePath(artifactsPath);
    revalidatePath(artifactPath);
    if (newArtifactId) {
      revalidatePath(`/projects/${projectRefForPaths}/artifacts/${newArtifactId}`);
      redirect(`/projects/${projectRefForPaths}/artifacts/${newArtifactId}`);
    }
    redirect(artifactPath);
  }

  async function makeCurrentAction() {
    "use server";
    if (!projectUuid || !canEditByRole) return;
    const blocked = statusLower === "submitted" || statusLower === "approved" || statusLower === "rejected";
    if (blocked) return;
    let errMsg: string | null = null;
    try {
      await setArtifactCurrent({ projectId: projectUuid, artifactId });
    } catch (e: any) {
      errMsg = String(e?.message ?? "Make current failed");
    }
    if (errMsg) {
      redirect(`${artifactPath}?action_error=${encodeURIComponent(errMsg)}`);
    }
    revalidatePath(artifactsPath);
    revalidatePath(artifactPath);
    redirect(artifactPath);
  }

  const jsonSaveAction = isFinancialPlan ? updateArtifactJsonSilent : updateArtifactJsonArgs;

  // -- Shared header component -----------------------------------------------
  const sc         = statusConfig(status);
  const artifactTitle = safeStr((artifact as any).title || displayType((artifact as any).type) || "Artifact");
  const artifactType  = displayType((artifact as any).type);

  const ArtifactPageHeader = () => (
    <>
      <style>{`
        .af-header {
          background: #ffffff;
          border: 1px solid #e8ecf0;
          border-radius: 12px;
          margin-bottom: 20px;
          overflow: hidden;
        }
        .af-header-top {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 16px;
          padding: 20px 24px 16px;
          border-bottom: 1px solid #e8ecf0;
          flex-wrap: wrap;
        }
        .af-title-area { flex: 1; min-width: 0; }
        .af-breadcrumb {
          display: flex; align-items: center; gap: 6px;
          font-size: 12px; color: #57606a; margin-bottom: 8px;
        }
        .af-breadcrumb a { color: #57606a; text-decoration: none; font-weight: 500; }
        .af-breadcrumb a:hover { color: #0d1117; text-decoration: underline; }
        .af-breadcrumb-sep { opacity: 0.5; color: #57606a; }
        .af-title-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
        .af-title {
          font-size: 22px; font-weight: 700; color: #0d1117;
          letter-spacing: -0.4px; line-height: 1.2; margin: 0;
        }
        .af-type-badge {
          display: inline-flex; align-items: center;
          padding: 3px 8px; border-radius: 6px;
          font-size: 10px; font-weight: 600; letter-spacing: 0.05em;
          text-transform: uppercase; font-family: ui-monospace, monospace;
          background: #f6f8fa; color: #57606a; border: 1px solid #e8ecf0;
          white-space: nowrap;
        }
        .af-status-badge {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 3px 10px; border-radius: 20px;
          font-size: 11px; font-weight: 600;
          white-space: nowrap;
        }
        .af-status-dot { width: 6px; height: 6px; border-radius: 50%; }
        .af-meta-row {
          display: flex; align-items: center; gap: 14px;
          margin-top: 10px; font-size: 12px; color: #57606a; flex-wrap: wrap;
        }
        .af-meta-item { display: flex; align-items: center; gap: 4px; color: #57606a; }
        .af-meta-sep { opacity: 0.4; color: #57606a; }
        .af-tag {
          display: inline-flex; align-items: center; gap: 4px;
          padding: 2px 8px; border-radius: 20px;
          font-size: 10px; font-weight: 600;
        }
        .af-actions {
          display: flex; align-items: center; gap: 8px;
          padding: 12px 24px; flex-wrap: wrap;
          background: #fafbfc;
        }
        .af-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 12px; border-radius: 8px;
          font-size: 12px; font-weight: 600;
          border: 1px solid #e8ecf0; background: #ffffff;
          color: #57606a; cursor: pointer; text-decoration: none;
          font-family: inherit; transition: all 0.15s; white-space: nowrap;
        }
        .af-btn:hover { border-color: #d0d7de; background: #f6f8fa; color: #0d1117; }
        .af-btn-primary {
          background: #0d1117; border-color: #0d1117; color: #ffffff;
        }
        .af-btn-primary:hover { opacity: 0.88; }
        .af-btn-success {
          background: #16a34a; border-color: #16a34a; color: #ffffff;
        }
        .af-btn-success:hover { opacity: 0.88; }
        .af-btn-amber {
          background: #fff8e1; border-color: #f59e0b; color: #b45309;
        }
        .af-btn-amber:hover { background: #fef3c7; }
        .af-btn-danger {
          background: #fff5f5; border-color: #fecaca; color: #b91c1c;
        }
        .af-btn-danger:hover { background: #fee2e2; }
        .af-title-input {
          font-size: 22px; font-weight: 700; color: #0d1117;
          letter-spacing: -0.4px; border: none; outline: none;
          background: transparent; width: 100%; min-width: 200px;
          font-family: inherit; padding: 0;
        }
        .af-title-input:focus {
          background: #f6f8fa; border-radius: 6px; padding: 2px 8px;
          outline: 2px solid #3b82f6; outline-offset: 2px;
        }
        .af-decide-grid {
          display: grid; grid-template-columns: repeat(3,1fr); gap: 12px;
          padding: 16px 24px; border-top: 1px solid #e8ecf0;
        }
        .af-decide-card {
          border: 1px solid #e8ecf0; border-radius: 10px; padding: 14px;
          background: #ffffff; display: flex; flex-direction: column; gap: 8px;
        }
        .af-decide-label { font-size: 13px; font-weight: 600; color: #0d1117; }
        .af-decide-hint  { font-size: 11px; color: #8b949e; }
        textarea.af-reason {
          width: 100%; border: 1px solid #e8ecf0; border-radius: 8px;
          padding: 8px 10px; font-size: 12px; color: #0d1117;
          resize: none; font-family: inherit; background: #fafbfc;
        }
        textarea.af-reason:focus { outline: 2px solid #3b82f6; outline-offset: 1px; }
        @media (max-width: 700px) {
          .af-decide-grid { grid-template-columns: 1fr; }
          .af-header-top { flex-direction: column; }
        }
      `}</style>

      <div className="af-header">
        <div className="af-header-top">
          <div className="af-title-area">
            <div className="af-breadcrumb">
              <Link href={`/projects/${projectRefForPaths}/artifacts`}>Artifacts</Link>
              <span className="af-breadcrumb-sep">/</span>
              <span style={{ color: "#0d1117", fontWeight: 500 }}>{artifactType}</span>
            </div>

            <div className="af-title-row">
              {canRenameTitle ? (
                <form action={renameTitleAction} style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                  <input type="hidden" name="project_id" value={projectUuid!} />
                  <input type="hidden" name="artifact_id" value={artifactId} />
                  <input
                    name="title"
                    defaultValue={artifactTitle}
                    className="af-title-input"
                    placeholder="Artifact title..."
                  />
                  <button type="submit" className="af-btn af-btn-primary" style={{ flexShrink: 0 }}>
                    Save
                  </button>
                </form>
              ) : (
                <h1 className="af-title">{artifactTitle}</h1>
              )}
              <span className="af-type-badge">{artifactType}</span>
            </div>

            <div className="af-meta-row">
              <span className="af-status-badge" style={{ background: sc.bg, color: sc.color }}>
                <span className="af-status-dot" style={{ background: sc.dot }} />
                {sc.label}
              </span>

              <span className="af-meta-sep">*</span>

              {isCurrent ? (
                <span className="af-tag" style={{ background: "#dcfce7", color: "#15803d" }}>Current</span>
              ) : (
                <span className="af-tag" style={{ background: "#f1f5f9", color: "#64748b" }}>Not current</span>
              )}

              {approvalEnabled && isApprover && (
                <>
                  <span className="af-meta-sep">*</span>
                  <span className="af-tag" style={{ background: "#ede9fe", color: "#7c3aed" }}>Approver</span>
                </>
              )}

              <span className="af-meta-sep">*</span>
              <span className="af-meta-item">
                Role: <strong style={{ color: "#0d1117", marginLeft: 3 }}>{myRole}</strong>
              </span>

              <span className="af-meta-sep">*</span>
              <span className="af-meta-item">
                Updated: <ClientDateTime value={(artifact as any).updated_at ?? (artifact as any).created_at} />
              </span>

              {mode === "schedule" && (projectStartDate || projectFinishDate) && (
                <>
                  <span className="af-meta-sep">*</span>
                  <span className="af-meta-item">
                    {projectStartDate || "---"} to {projectFinishDate || "---"}
                  </span>
                </>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end", flexShrink: 0 }}>
            {canSubmitFromServer && (
              <form action={submitAction}>
                <button type="submit" className="af-btn af-btn-primary">
                  {statusLower === "changes_requested" ? "Resubmit for approval" : "Submit for approval"}
                </button>
              </form>
            )}
            {approvalEnabled && canSubmitNonCharter && !(charterMode || closureMode || financialPlanMode) && (
              <form action={submitAction}>
                <button type="submit" className="af-btn af-btn-primary">
                  {statusLower === "changes_requested" ? "Resubmit for approval" : "Submit for approval"}
                </button>
              </form>
            )}
            {canCreateRevision && (
              <form action={createRevisionAction}>
                <button type="submit" className="af-btn">Create revision</button>
              </form>
            )}
            {!isCurrent && canEditByRole && (
              <form action={makeCurrentAction}>
                <button type="submit" className="af-btn">Make current</button>
              </form>
            )}
          </div>
        </div>

        <div className="af-actions">
          <Link href={`/projects/${projectRefForPaths}/change`} className="af-btn">Change Control</Link>
          <Link href={`/projects/${projectRefForPaths}/governance`} className="af-btn">Governance</Link>
          {!changeRequestsMode && (
            <Link href={`/projects/${projectRefForPaths}/artifacts/${artifactId}/compare`} className="af-btn">
              Compare versions
            </Link>
          )}

          {approvalEnabled && (
            <span style={{ marginLeft: "auto", fontSize: 12, color: "#8b949e" }}>
              {statusLower === "draft"             && "Draft - ready to submit."}
              {statusLower === "changes_requested" && "Changes requested - update and resubmit."}
              {statusLower === "submitted" && isAuthor    && "Submitted - awaiting another approver."}
              {statusLower === "submitted" && !isAuthor && isApprover  && "Submitted - you can decide below."}
              {statusLower === "submitted" && !isAuthor && !isApprover && "Submitted - awaiting approval."}
              {statusLower === "approved"  && <span style={{ color: "#15803d", fontWeight: 600 }}>Approved and baselined.</span>}
              {statusLower === "rejected"  && <span style={{ color: "#b91c1c", fontWeight: 600 }}>Rejected.</span>}
            </span>
          )}
        </div>

        {approvalEnabled && canDecide && statusLower === "submitted" && (
          <div className="af-decide-grid">
            <div className="af-decide-card">
              <div className="af-decide-label">Approve</div>
              <div className="af-decide-hint">Promotes to approved baseline.</div>
              <form action={approveAction}>
                <button type="submit" className="af-btn af-btn-success" style={{ width: "100%" }}>
                  Approve
                </button>
              </form>
            </div>
            <div className="af-decide-card">
              <div className="af-decide-label">Request Changes</div>
              <form action={requestChangesAction} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea name="reason" rows={2} className="af-reason" placeholder="Reason (optional)" />
                <button type="submit" className="af-btn af-btn-amber">Request changes</button>
              </form>
            </div>
            <div className="af-decide-card">
              <div className="af-decide-label">Reject (Final)</div>
              <form action={rejectFinalAction} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <textarea name="reason" rows={2} className="af-reason" placeholder="Rejection reason (optional)" />
                <input
                  name="confirm"
                  className="af-reason"
                  style={{ resize: "none" }}
                  placeholder='Type "REJECT" to confirm'
                  required
                />
                <button type="submit" className="af-btn af-btn-danger">Reject final</button>
              </form>
            </div>
          </div>
        )}
      </div>
    </>
  );

  // -- Financial plan layout -------------------------------------------------

  if (isFinancialPlan) {
    return (
      <div className="w-full min-h-screen" style={{ background: "#f6f8fa" }}>
        {actionError && (
          <div style={{ margin: "0 0 16px", padding: "12px 16px", borderRadius: 10, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 13, color: "#b91c1c", display: "flex", alignItems: "flex-start", gap: 10 }}>
            <span style={{ fontWeight: 700, flexShrink: 0 }}>Action failed:</span>
            <span>{decodeURIComponent(actionError)}</span>
          </div>
        )}
        <ArtifactPageHeader />
        <ArtifactDetailClientHost
          projectId={projectUuid!}
          artifactId={artifactId}
          organisationId={activeOrgId ?? undefined}
          mode={mode}
          isEditable={effectiveIsEditable}
          lockLayout={effectiveLockLayout}
          charterInitial={charterInitial}
          typedInitialJson={typedInitialJson}
          rawContentJson={(artifact as any).content_json ?? null}
          rawContentText={String((artifact as any).content ?? "")}
          projectTitle={projectTitleForSeed || safeStr(projectTitle).trim()}
          projectManagerName={projectManagerName}
          projectStartDate={projectStartDate}
          projectFinishDate={projectFinishDate}
          latestWbsJson={null}
          wbsArtifactId={null}
          aiTargetType={aiTargetType}
          aiTitle={aiTitle}
          showAI={false}
          showTimeline={false}
          hideContentExportsRow={true}
          legacyExports={legacyExports}
          approvalEnabled={!!approvalEnabled}
          canSubmitOrResubmit={canSubmitFromServer}
          approvalStatus={status ?? null}
          submitForApprovalAction={submitAction}
          updateArtifactJsonAction={jsonSaveAction}
        />
        <div style={{ marginTop: 24, padding: 24, background: "white", borderRadius: 12, border: "1px solid #e2e8f0" }}>
          <FinancialPlanAuditTrail
            projectId={projectUuid!}
            artifactId={artifactId}
          />
        </div>
      </div>
    );
  }

  // -- All other artifact types ----------------------------------------------

  return (
    <div className="w-full" style={{ background: "#f6f8fa" }}>
      {actionError && (
        <div style={{ margin: "0 0 16px", padding: "12px 16px", borderRadius: 10, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 13, color: "#b91c1c", display: "flex", alignItems: "flex-start", gap: 10 }}>
          <span style={{ fontWeight: 700, flexShrink: 0 }}>Action failed:</span>
          <span>{decodeURIComponent(actionError)}</span>
        </div>
      )}
      {!isWeeklyReport && <ArtifactPageHeader />}

      <ArtifactDetailClientHost
        projectId={projectUuid!}
        artifactId={artifactId}
        organisationId={activeOrgId ?? undefined}
        mode={mode}
        isEditable={effectiveIsEditable}
        lockLayout={effectiveLockLayout}
        charterInitial={charterInitial}
        typedInitialJson={typedInitialJson}
        rawContentJson={(artifact as any).content_json ?? null}
        rawContentText={String((artifact as any).content ?? "")}
        projectTitle={projectTitleForSeed || safeStr(projectTitle).trim()}
        projectManagerName={projectManagerName}
        projectStartDate={projectStartDate}
        projectFinishDate={projectFinishDate}
        latestWbsJson={mode === "schedule" ? latestWbsJson : null}
        wbsArtifactId={wbsArtifactId ?? null}
        aiTargetType={aiTargetType}
        aiTitle={aiTitle}
        showAI={true}
        showTimeline={!changeRequestsMode}
        hideContentExportsRow={
          mode === "charter" || mode === "closure" ||
          mode === "weekly_report" || mode === "financial_plan"
        }
        legacyExports={legacyExports}
        approvalEnabled={!!approvalEnabled}
        canSubmitOrResubmit={canSubmitFromServer}
        approvalStatus={status ?? null}
        submitForApprovalAction={submitAction}
        updateArtifactJsonAction={jsonSaveAction}
      />

      {!isWeeklyReport && !isFinancialPlan && !changeRequestsMode &&
       !charterMode && !stakeholderMode && !wbsMode && !scheduleMode &&
       !closureMode && effectiveIsEditable ? (
        <div style={{
          marginTop: 16, background: "#ffffff", border: "1px solid #e8ecf0",
          borderRadius: 12, padding: 24,
        }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#0d1117" }}>Content</span>
            <span style={{ fontSize: 11, color: "#8b949e" }}>Fallback editor</span>
          </div>
          <form action={updateArtifact} style={{ display: "grid", gap: 14 }}>
            <input type="hidden" name="project_id" value={projectUuid!} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#0d1117" }}>Title</span>
              <input
                name="title"
                defaultValue={String((artifact as any).title ?? "")}
                style={{ border: "1px solid #e8ecf0", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#0d1117", fontFamily: "inherit" }}
              />
            </label>
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 500, color: "#0d1117" }}>Content</span>
              <textarea
                name="content"
                rows={14}
                defaultValue={String((artifact as any).content ?? "")}
                style={{ border: "1px solid #e8ecf0", borderRadius: 8, padding: "8px 12px", fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#0d1117", resize: "vertical" }}
              />
            </label>
            <button
              type="submit"
              style={{ width: "fit-content", padding: "8px 16px", borderRadius: 8, background: "#0d1117", color: "#ffffff", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
            >
              Save changes
            </button>
          </form>
        </div>
      ) : null}
    </div>
  );
}