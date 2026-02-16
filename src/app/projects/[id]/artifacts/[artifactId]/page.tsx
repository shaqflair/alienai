// src/app/projects/[id]/artifacts/[artifactId]/page.tsx
import "server-only";

import React from "react";
import Link from "next/link";
import { revalidatePath } from "next/cache";
import { notFound, redirect } from "next/navigation";

import { ClientDateTime } from "@/components/date/ClientDateTime";
import ArtifactDetailClientHost from "@/components/artifacts/ArtifactDetailClientHost";

import {
  updateArtifact,
  createArtifactRevision, // ✅ wrapper provided in ../actions
  setArtifactCurrent, // ✅ provided in ../actions
  updateArtifactJsonArgs, // ✅ canonical JSON save wrapper (Weekly Report + others)
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

// ✅ Ensure Node runtime + no caching (auth/cookies + server-only loaders)
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

export default async function ArtifactDetailPage({
  params,
}: {
  params: Promise<{ id?: string; artifactId?: string }>;
}) {
  const p = await params;
  const projectParam = normParam(p?.id);
  const artifactParam = normParam(p?.artifactId);

  if (!projectParam || !artifactParam) {
    notFound();
  }

  const vm = await loadArtifactDetail(
    Promise.resolve({ id: projectParam, artifactId: artifactParam })
  );

  const {
    projectUuid,
    projectHumanId,
    projectTitle,
    projectStartDate,
    projectFinishDate,
    myRole,

    artifactId,
    artifact,

    approvalEnabled,
    status,
    pill,
    isAuthor,
    isApprover,

    // loader values
    isEditable: loaderIsEditable,
    canDecide,
    canRenameTitle,
    canCreateRevision,

    mode,
    aiTargetType,
    aiTitle,

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

    legacyExports,

    // ✅ NEW from loader (Weekly Report)
    weeklyMode,
  } = vm as any;

  const projectRefForPaths = normParam(projectHumanId) || projectParam || normParam(projectUuid);

  const isWeeklyReport = mode === "weekly_report" || !!weeklyMode;

  // ---------------------------------------------------------------------------
  // ✅ FIX: Charter/Closure editability + submit eligibility should NOT depend on
  // artifact.is_locked, because some flows leave it true even when status looks draft.
  // ---------------------------------------------------------------------------

  const roleLower = String(myRole || "").toLowerCase();
  const canEditByRole = roleLower === "owner" || roleLower === "editor";

  const statusLower = String(status || "").toLowerCase();
  const isDraftOrCR = statusLower === "draft" || statusLower === "changes_requested";
  const isSubmitted = statusLower === "submitted";

  // ✅ Treat NULL as current (only explicit false blocks)
  const isCurrent = (artifact as any)?.is_current !== false;

  // Effective lock layout comes from status, not is_locked.
  const effectiveLockLayout =
    !!approvalEnabled && (isSubmitted || statusLower === "approved" || statusLower === "rejected");

  // Effective editability for charter/closure:
  const effectiveIsEditable =
    approvalEnabled && (charterMode || closureMode)
      ? canEditByRole && isDraftOrCR && !effectiveLockLayout && isCurrent
      : !!loaderIsEditable;

  // Submit eligibility for charter/closure:
  const canSubmitFromServer =
    !!approvalEnabled &&
    !!(charterMode || closureMode) &&
    canEditByRole &&
    isCurrent &&
    isDraftOrCR &&
    !effectiveLockLayout;

  // For other artifact types we keep the old behaviour:
  const canSubmitNonCharter =
    !!approvalEnabled &&
    !(charterMode || closureMode) &&
    !!loaderIsEditable &&
    !!isCurrent &&
    !effectiveLockLayout;

  // ---------------------------------------------------------------------------
  // ✅ Server actions
  // ---------------------------------------------------------------------------

  async function submitAction() {
    "use server";

    if (!approvalEnabled) return;
    if (!projectUuid) return;

    const ok = (charterMode || closureMode) ? canSubmitFromServer : canSubmitNonCharter;
    if (!ok) return;

    await submitArtifactForApproval(projectUuid, artifactId);

    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function approveAction() {
    "use server";
    if (!approvalEnabled) return;
    if (!projectUuid) return;

    await approveArtifact(projectUuid, artifactId);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function requestChangesAction(formData: FormData) {
    "use server";
    if (!approvalEnabled) return;
    if (!projectUuid) return;

    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    await requestChangesArtifact(projectUuid, artifactId, reason);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function rejectFinalAction(formData: FormData) {
    "use server";
    if (!approvalEnabled) return;
    if (!projectUuid) return;

    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    await rejectFinalArtifact(projectUuid, artifactId, reason);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function renameTitleAction(formData: FormData) {
    "use server";
    await renameArtifactTitle(formData);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function createRevisionAction() {
    "use server";
    if (!approvalEnabled) return;
    if (!projectUuid) return;

    const res = await createArtifactRevision({
      projectId: projectUuid,
      artifactId,
      revisionReason: "Revision created",
      revisionType: "material",
    });

    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${(res as any).newArtifactId}`);

    redirect(`/projects/${projectRefForPaths}/artifacts/${(res as any).newArtifactId}`);
  }

  // ✅ Make this artifact "current" (owner/editor)
  async function makeCurrentAction() {
    "use server";
    if (!projectUuid) return;
    if (!canEditByRole) return;

    const blocked = statusLower === "submitted" || statusLower === "approved" || statusLower === "rejected";
    if (blocked) return;

    await setArtifactCurrent({
      projectId: projectUuid,
      artifactId,
    });

    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
  }

  return (
    <main className="mx-auto w-full max-w-none px-6 py-6 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectRefForPaths}/artifacts`}>
          ← Back to Artifacts
        </Link>

        <div className="flex items-center gap-3">
          {approvalEnabled && isApprover ? (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-100 border-gray-200 text-gray-900">
              Approver
            </span>
          ) : null}

          <span>
            Role: <span className="font-mono">{myRole}</span>
          </span>

          {isCurrent ? (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-emerald-50 border-emerald-200 text-emerald-900">
              Current
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50 border-gray-200 text-gray-700">
              Not current
            </span>
          )}

          {approvalEnabled ? (
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${pill.cls}`}>
              {pill.label}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50 border-gray-200 text-gray-700">
              Living document
            </span>
          )}
        </div>
      </div>

      <header className="space-y-2">
        {canRenameTitle ? (
          <form action={renameTitleAction} className="flex flex-wrap gap-2 items-center">
            <input type="hidden" name="project_id" value={projectUuid!} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <input
              name="title"
              defaultValue={String((artifact as any).title ?? "")}
              className="w-full md:w-[520px] text-2xl font-semibold border rounded-xl px-3 py-2"
              placeholder="Artifact title…"
            />
            <button type="submit" className="px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save name
            </button>
          </form>
        ) : (
          <h1 className="text-2xl font-semibold">{(artifact as any).title || (artifact as any).type || "Artifact"}</h1>
        )}

        <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded border px-2 py-0.5 bg-gray-50">
            Type: <span className="ml-1 font-mono">{displayType((artifact as any).type)}</span>
          </span>
          <span className="opacity-40">•</span>
          <span className="text-xs">
            Updated: <ClientDateTime value={(artifact as any).updated_at ?? (artifact as any).created_at} />
          </span>

          {mode === "schedule" && (projectStartDate || projectFinishDate) ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">
                Project dates: <span className="font-mono">{projectStartDate || "—"}</span> →{" "}
                <span className="font-mono">{projectFinishDate || "—"}</span>
              </span>
            </>
          ) : null}
        </div>
      </header>

      <section className="border rounded-2xl bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {!approvalEnabled
              ? effectiveIsEditable
                ? "Editable: owners/editors can update this living document."
                : "View-only."
              : effectiveIsEditable
              ? "Editable: owners/editors can update and submit/resubmit."
              : statusLower === "submitted"
              ? isAuthor
                ? "Submitted: waiting for another approver (you cannot approve your own artifact)."
                : isApprover
                ? "Submitted: you can approve, request changes (CR) or reject final."
                : "Submitted: waiting for approval."
              : statusLower === "changes_requested"
              ? "Changes requested (CR): owners/editors update, then resubmit."
              : statusLower === "approved"
              ? "Approved + baselined."
              : statusLower === "rejected"
              ? "Rejected (final)."
              : "View-only."}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/projects/${projectRefForPaths}/changes`}
              className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
              title="Open Change Control (Log + Request Form)"
            >
              Change Control
            </Link>

            {!isCurrent && canEditByRole ? (
              <form action={makeCurrentAction}>
                <button
                  className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
                  type="submit"
                  title="Switch 'current' version for this artifact type"
                >
                  Make current
                </button>
              </form>
            ) : null}

            {approvalEnabled && canSubmitNonCharter && !(charterMode || closureMode) ? (
              <form action={submitAction}>
                <button className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm" type="submit">
                  {statusLower === "changes_requested" ? "Resubmit for approval" : "Submit for approval"}
                </button>
              </form>
            ) : null}

            {approvalEnabled && canCreateRevision ? (
              <form action={createRevisionAction}>
                <button className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm" type="submit">
                  Create revision
                </button>
              </form>
            ) : null}

            {!changeRequestsMode ? (
              <Link
                href={`/projects/${projectRefForPaths}/artifacts/${artifactId}/compare`}
                className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
              >
                Compare versions
              </Link>
            ) : null}
          </div>
        </div>

        {approvalEnabled && canDecide ? (
          <div className="grid gap-3 md:grid-cols-3">
            <form action={approveAction} className="border rounded-2xl p-4 space-y-2">
              <div className="font-medium">Approve</div>
              <div className="text-xs text-gray-500">Final approval promotes baseline.</div>
              <button className="px-4 py-2 rounded-xl bg-black text-white text-sm" type="submit">
                Approve
              </button>
            </form>

            <form action={requestChangesAction} className="border rounded-2xl p-4 space-y-2">
              <div className="font-medium">Request Changes (CR)</div>
              <textarea name="reason" rows={3} className="w-full border rounded-xl px-3 py-2 text-sm" required />
              <button
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm hover:bg-gray-50"
                type="submit"
              >
                Request changes
              </button>
            </form>

            <form action={rejectFinalAction} className="border rounded-2xl p-4 space-y-2">
              <div className="font-medium">Reject (Final)</div>
              <textarea name="reason" rows={2} className="w-full border rounded-xl px-3 py-2 text-sm" />
              <input
                name="confirm"
                className="w-full border rounded-xl px-3 py-2 text-sm"
                placeholder='Type "REJECT" to confirm'
                required
              />
              <button
                className="px-4 py-2 rounded-xl border border-gray-200 text-gray-900 text-sm hover:bg-gray-50"
                type="submit"
              >
                Reject final
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {/* ✅ heavy client stuff isolated */}
      <ArtifactDetailClientHost
        projectId={projectUuid!}
        artifactId={artifactId}
        mode={mode}
        isEditable={effectiveIsEditable}
        lockLayout={effectiveLockLayout}
        charterInitial={charterInitial}
        typedInitialJson={typedInitialJson}
        rawContentJson={(artifact as any).content_json ?? null}
        rawContentText={String((artifact as any).content ?? "")}
        projectTitle={projectTitle}
        projectStartDate={projectStartDate}
        projectFinishDate={projectFinishDate}
        latestWbsJson={mode === "schedule" ? latestWbsJson : null}
        wbsArtifactId={wbsArtifactId ?? null}
        aiTargetType={aiTargetType}
        aiTitle={aiTitle}
        showAI={true}
        showTimeline={!changeRequestsMode}
        hideContentExportsRow={mode === "charter" || mode === "closure" || mode === "weekly_report"}
        legacyExports={legacyExports}
        approvalEnabled={!!approvalEnabled}
        canSubmitOrResubmit={canSubmitFromServer}
        approvalStatus={status ?? null}
        submitForApprovalAction={submitAction}
        updateArtifactJsonAction={updateArtifactJsonArgs}
      />

      {/* fallback editor (NOT for weekly report) */}
      {!isWeeklyReport &&
      !changeRequestsMode &&
      !charterMode &&
      !stakeholderMode &&
      !wbsMode &&
      !scheduleMode &&
      !closureMode &&
      effectiveIsEditable ? (
        <section className="border rounded-2xl bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-medium">Content</div>
            <div className="text-xs text-gray-500">Fallback editor</div>
          </div>

          <form action={updateArtifact} className="grid gap-4">
            <input type="hidden" name="project_id" value={projectUuid!} />
            <input type="hidden" name="artifact_id" value={artifactId} />

            <label className="grid gap-2">
              <span className="text-sm font-medium">Title</span>
              <input
                name="title"
                defaultValue={String((artifact as any).title ?? "")}
                className="border rounded-xl px-3 py-2"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-medium">Content</span>
              <textarea
                name="content"
                rows={14}
                defaultValue={String((artifact as any).content ?? "")}
                className="border rounded-xl px-3 py-2 font-mono text-sm"
              />
            </label>

            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save changes
            </button>
          </form>
        </section>
      ) : null}
    </main>
  );
}
