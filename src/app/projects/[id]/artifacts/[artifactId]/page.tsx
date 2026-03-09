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

async function getProjectManagerNameBestEffort(
  supabase: any,
  projectId: string
): Promise<string | null> {
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

export default async function ArtifactDetailPage({
  params,
}: {
  params: Promise<{ id?: string; artifactId?: string }>;
}) {
  const p = await params;
  const projectParam   = normParam(p?.id);
  const artifactParam  = normParam(p?.artifactId);

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

  const projectRefForPaths =
    normParam(projectHumanId) || projectParam || normParam(projectUuid);

  const isWeeklyReport  = mode === "weekly_report"   || !!weeklyMode;
  const isFinancialPlan = mode === "financial_plan"   || !!financialPlanMode;

  const roleLower    = String(myRole   || "").toLowerCase();
  const canEditByRole = roleLower === "owner" || roleLower === "editor";

  const statusLower   = String(status || "").toLowerCase();
  const isDraftOrCR   = statusLower === "draft" || statusLower === "changes_requested";
  const isSubmitted   = statusLower === "submitted";
  const isCurrent     = (artifact as any)?.is_current !== false;

  const effectiveLockLayout =
    !!approvalEnabled &&
    (isSubmitted || statusLower === "approved" || statusLower === "rejected");

  const effectiveIsEditable =
    approvalEnabled && (charterMode || closureMode)
      ? canEditByRole && isDraftOrCR && !effectiveLockLayout && isCurrent
      : !!loaderIsEditable;

  const canSubmitFromServer =
    !!approvalEnabled && !!(charterMode || closureMode) &&
    canEditByRole && isCurrent && isDraftOrCR && !effectiveLockLayout;

  const canSubmitNonCharter =
    !!approvalEnabled && !(charterMode || closureMode) &&
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

  // ── Server actions ────────────────────────────────────────────────────────

  async function submitAction() {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    const ok = charterMode || closureMode ? canSubmitFromServer : canSubmitNonCharter;
    if (!ok) return;
    await submitArtifactForApproval(projectUuid, artifactId);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function approveAction() {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    await approveArtifact(projectUuid, artifactId);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function requestChangesAction(formData: FormData) {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    await requestChangesArtifact(projectUuid, artifactId, reason);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
  }

  async function rejectFinalAction(formData: FormData) {
    "use server";
    if (!approvalEnabled || !projectUuid) return;
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
    if (!approvalEnabled || !projectUuid) return;
    const res = await createArtifactRevision({
      projectId: projectUuid, artifactId,
      revisionReason: "Revision created", revisionType: "material",
    });
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${(res as any).newArtifactId}`);
    redirect(`/projects/${projectRefForPaths}/artifacts/${(res as any).newArtifactId}`);
  }

  async function makeCurrentAction() {
    "use server";
    if (!projectUuid || !canEditByRole) return;
    const blocked = statusLower === "submitted" || statusLower === "approved" || statusLower === "rejected";
    if (blocked) return;
    await setArtifactCurrent({ projectId: projectUuid, artifactId });
    revalidatePath(`/projects/${projectRefForPaths}/artifacts`);
    revalidatePath(`/projects/${projectRefForPaths}/artifacts/${artifactId}`);
  }

  const jsonSaveAction = isFinancialPlan ? updateArtifactJsonSilent : updateArtifactJsonArgs;

  // ── Financial plan: clean full-width layout ───────────────────────────────

  if (isFinancialPlan) {
    return (
      <main className="w-full min-h-screen bg-[#F7F7F5]">
        {/* Slim top bar — just back link + status badge */}
        <div className="sticky top-0 z-30 flex items-center justify-between gap-4 px-6 py-3 bg-white border-b border-gray-200">
          <Link
            href={`/projects/${projectRefForPaths}/artifacts`}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-700 hover:text-sky-900 underline underline-offset-4"
          >
            ← Back to Artifacts
          </Link>

          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-500">
              {safeStr((artifact as any).title || "Financial Plan")}
            </span>

            {approvalEnabled ? (
              <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${pill.cls}`}>
                {pill.label}
              </span>
            ) : (
              <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs bg-gray-50 border-gray-300 text-gray-700">
                Living document
              </span>
            )}

            <span className="text-gray-400">
              Role: <span className="font-medium text-gray-700">{myRole}</span>
            </span>

            <span className="text-gray-400 text-xs">
              Updated: <ClientDateTime value={(artifact as any).updated_at ?? (artifact as any).created_at} />
            </span>
          </div>
        </div>

        {/* Full-width editor — no box, no padding boxing it in */}
        <div className="px-6 py-6">
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
        </div>
      </main>
    );
  }

  // ── All other artifact types: original layout ─────────────────────────────

  return (
    <main className="mx-auto w-full max-w-[1600px] px-6 py-6 space-y-6 bg-white text-gray-950">
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-700">
        <Link
          className="inline-flex items-center font-medium text-sky-700 underline underline-offset-4 hover:text-sky-900"
          href={`/projects/${projectRefForPaths}/artifacts`}
        >
          ← Back to Artifacts
        </Link>

        <div className="flex flex-wrap items-center gap-3">
          {approvalEnabled && isApprover ? (
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs bg-gray-100 border-gray-300 text-gray-900">
              Approver
            </span>
          ) : null}

          <span className="text-gray-700">
            Role: <span className="font-medium text-gray-950">{myRole}</span>
          </span>

          {isCurrent ? (
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs bg-emerald-50 border-emerald-200 text-emerald-800">
              Current
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs bg-gray-50 border-gray-300 text-gray-700">
              Not current
            </span>
          )}

          {approvalEnabled ? (
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs ${pill.cls}`}>
              {pill.label}
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full border px-3 py-1 text-xs bg-gray-50 border-gray-300 text-gray-700">
              Living document
            </span>
          )}
        </div>
      </div>

      <header className="space-y-3">
        {canRenameTitle ? (
          <form action={renameTitleAction} className="flex flex-wrap gap-3 items-center">
            <input type="hidden" name="project_id" value={projectUuid!} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <input
              name="title"
              defaultValue={String((artifact as any).title ?? "")}
              className="w-full md:w-[720px] text-2xl font-semibold border border-gray-300 rounded-2xl px-4 py-3 text-gray-950 placeholder:text-gray-400 bg-white"
              placeholder="Artifact title…"
            />
            <button type="submit" className="px-5 py-3 rounded-2xl bg-black text-white text-sm font-medium hover:opacity-90">
              Save name
            </button>
          </form>
        ) : (
          <h1 className="text-3xl font-semibold text-gray-950">
            {(artifact as any).title || (artifact as any).type || "Artifact"}
          </h1>
        )}

        <div className="text-sm text-gray-700 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded-lg border border-gray-300 px-3 py-1 bg-gray-50 text-gray-900">
            Type: <span className="ml-1 font-mono">{displayType((artifact as any).type)}</span>
          </span>
          <span className="opacity-40">•</span>
          <span>
            Updated:{" "}
            <ClientDateTime value={(artifact as any).updated_at ?? (artifact as any).created_at} />
          </span>
          {mode === "schedule" && (projectStartDate || projectFinishDate) ? (
            <>
              <span className="opacity-40">•</span>
              <span>
                Project dates:{" "}
                <span className="font-mono">{projectStartDate || "—"}</span> →{" "}
                <span className="font-mono">{projectFinishDate || "—"}</span>
              </span>
            </>
          ) : null}
        </div>
      </header>

      <section className="border border-gray-300 rounded-3xl bg-white p-6 space-y-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm text-gray-700">
            {!approvalEnabled
              ? effectiveIsEditable
                ? "Editable: owners/editors can update this living document."
                : "View-only."
              : effectiveIsEditable
              ? "Editable: owners/editors can update and submit/resubmit."
              : isSubmitted
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
              href={`/projects/${projectRefForPaths}/change`}
              className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900"
            >
              Change Control
            </Link>

            {!isCurrent && canEditByRole ? (
              <form action={makeCurrentAction}>
                <button className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900" type="submit">
                  Make current
                </button>
              </form>
            ) : null}

            {approvalEnabled && canSubmitNonCharter && !(charterMode || closureMode) ? (
              <form action={submitAction}>
                <button className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900" type="submit">
                  {statusLower === "changes_requested" ? "Resubmit for approval" : "Submit for approval"}
                </button>
              </form>
            ) : null}

            {approvalEnabled && canCreateRevision ? (
              <form action={createRevisionAction}>
                <button className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900" type="submit">
                  Create revision
                </button>
              </form>
            ) : null}

            <Link
              href={`/projects/${projectRefForPaths}/governance`}
              className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900"
            >
              Delivery Governance
            </Link>

            <Link
              href="/governance"
              className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900"
            >
              Governance KB
            </Link>

            {!changeRequestsMode ? (
              <Link
                href={`/projects/${projectRefForPaths}/artifacts/${artifactId}/compare`}
                className="px-4 py-2 rounded-2xl border border-gray-300 bg-white hover:bg-gray-50 text-sm text-gray-900"
              >
                Compare versions
              </Link>
            ) : null}
          </div>
        </div>

        {approvalEnabled && canDecide ? (
          <div className="grid gap-3 md:grid-cols-3">
            <form action={approveAction} className="border border-gray-300 rounded-2xl p-4 space-y-2 bg-white">
              <div className="font-medium text-gray-950">Approve</div>
              <div className="text-xs text-gray-600">Final approval promotes baseline.</div>
              <button className="px-4 py-2 rounded-xl bg-black text-white text-sm" type="submit">Approve</button>
            </form>

            <form action={requestChangesAction} className="border border-gray-300 rounded-2xl p-4 space-y-2 bg-white">
              <div className="font-medium text-gray-950">Request Changes (CR)</div>
              <textarea name="reason" rows={3} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-950" required />
              <button className="px-4 py-2 rounded-xl border border-gray-300 text-gray-900 text-sm hover:bg-gray-50" type="submit">Request changes</button>
            </form>

            <form action={rejectFinalAction} className="border border-gray-300 rounded-2xl p-4 space-y-2 bg-white">
              <div className="font-medium text-gray-950">Reject (Final)</div>
              <textarea name="reason" rows={2} className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-950" />
              <input name="confirm" className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm text-gray-950" placeholder='Type "REJECT" to confirm' required />
              <button className="px-4 py-2 rounded-xl border border-gray-300 text-gray-900 text-sm hover:bg-gray-50" type="submit">Reject final</button>
            </form>
          </div>
        ) : null}
      </section>

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
        <section className="border border-gray-300 rounded-2xl bg-white p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="font-medium text-gray-950">Content</div>
            <div className="text-xs text-gray-500">Fallback editor</div>
          </div>
          <form action={updateArtifact} className="grid gap-4">
            <input type="hidden" name="project_id" value={projectUuid!} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <label className="grid gap-2">
              <span className="text-sm font-medium text-gray-950">Title</span>
              <input name="title" defaultValue={String((artifact as any).title ?? "")} className="border border-gray-300 rounded-xl px-3 py-2 text-gray-950" />
            </label>
            <label className="grid gap-2">
              <span className="text-sm font-medium text-gray-950">Content</span>
              <textarea name="content" rows={14} defaultValue={String((artifact as any).content ?? "")} className="border border-gray-300 rounded-xl px-3 py-2 font-mono text-sm text-gray-950" />
            </label>
            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">Save changes</button>
          </form>
        </section>
      ) : null}
    </main>
  );
}