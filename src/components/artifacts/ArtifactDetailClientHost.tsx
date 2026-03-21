// src/components/artifacts/ArtifactDetailClientHost.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import ProjectCharterEditorFormLazy from "@/components/editors/ProjectCharterEditorFormLazy";
import type { SectionComment } from "@/components/editors/ProjectCharterEditorFormLazy";
import ArtifactCollaborationBanner from "@/components/artifacts/ArtifactCollaborationBanner";
import ArtifactEditorReadOnlyOverlay from "@/components/artifacts/ArtifactEditorReadOnlyOverlay";
import { useArtifactCollaboration } from "@/components/artifacts/useArtifactCollaboration";
import {
  emptyFinancialPlan,
  type FinancialPlanContent,
} from "@/components/artifacts/FinancialPlanEditor";

/* ---------------- dynamic client components ---------------- */
const StakeholderRegisterEditor = dynamic(() => import("@/components/editors/StakeholderRegisterEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading Stakeholder editor…</div>,
});

const WBSEditor = dynamic(() => import("@/components/editors/WBSEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading WBS editor…</div>,
});

const ScheduleGanttEditor = dynamic(() => import("@/components/editors/ScheduleGanttEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading Schedule editor…</div>,
});

const ProjectClosureReportEditor = dynamic(() => import("@/components/editors/ProjectClosureReportEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading Closure Report editor…</div>,
});

const ChangeManagementBoard = dynamic(() => import("@/components/change/ChangeManagementBoard"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading Change Board…</div>,
});

const WeeklyReportEditor = dynamic(() => import("@/components/editors/WeeklyReportEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading Weekly Report editor…</div>,
});

const FinancialPlanEditor = dynamic(() => import("@/components/artifacts/FinancialPlanEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading Financial Plan editor…</div>,
});

const AiSuggestionsPanel = dynamic(() => import("@/components/ai/AiSuggestionsPanel"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading AI suggestions…</div>,
});

const ArtifactTimeline = dynamic(() => import("@/components/artifacts/ArtifactTimeline"), {
  ssr: false,
  loading: () => <div className="text-sm text-slate-600">Loading timeline…</div>,
});

/* ---------------- types ---------------- */
export type ArtifactDetailClientMode =
  | "charter"
  | "stakeholder"
  | "wbs"
  | "schedule"
  | "change_requests"
  | "closure"
  | "weekly_report"
  | "financial_plan"
  | "fallback";

type LegacyExports = { pdf?: string; docx?: string; xlsx?: string };

type UpdateArtifactJsonArgs = {
  artifactId: string;
  projectId: string;
  contentJson: any;
};

type UpdateArtifactJsonResult = { ok: boolean; error?: string };

export type ArtifactDetailClientHostProps = {
  projectId: string;
  artifactId: string;
  organisationId?: string;
  isAdmin?: boolean;
  mode: ArtifactDetailClientMode;
  isEditable: boolean;
  lockLayout: boolean;
  charterInitial?: any;
  typedInitialJson?: any;
  rawContentJson?: any;
  rawContentText?: string;
  projectTitle?: string;
  projectManagerName?: string | null;
  projectStartDate?: string | null;
  projectFinishDate?: string | null;
  latestWbsJson?: any;
  wbsArtifactId?: string | null;
  aiTargetType?: string;
  aiTitle?: string;
  showTimeline?: boolean;
  showAI?: boolean;
  hideContentExportsRow?: boolean;
  legacyExports?: LegacyExports;
  approvalEnabled?: boolean;
  canSubmitOrResubmit?: boolean;
  approvalStatus?: string | null;
  submitForApprovalAction?: any | null;
  updateArtifactJsonAction?: (args: UpdateArtifactJsonArgs) => Promise<UpdateArtifactJsonResult>;
  // NEW: approver inline-comment review mode
  isApprover?: boolean;
  requestChangesWithCommentsAction?: ((formData: FormData) => Promise<void>) | null;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getArtifactVersion(typedInitialJson: any) {
  const v = Number((typedInitialJson as any)?.version ?? (typedInitialJson as any)?.content?.version ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

function stableStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

function isApprovalLockedStatus(status: string | null | undefined) {
  const s = String(status ?? "").trim().toLowerCase();
  return (
    s === "submitted" ||
    s === "submitted_for_approval" ||
    s === "pending_approval" ||
    s === "in_review" ||
    s === "awaiting_approval" ||
    s === "approved"
  );
}

/* -----------------------------------------------------------------------
   FinancialPlanEditorHost
------------------------------------------------------------------------ */
function FinancialPlanEditorHost({
  projectId,
  artifactId,
  organisationId,
  isAdmin = false,
  initialJson,
  readOnly,
  sessionId,
  clientDraftRev,
  onDraftRevChange,
}: {
  projectId: string;
  artifactId: string;
  organisationId?: string;
  isAdmin?: boolean;
  initialJson: any;
  readOnly: boolean;
  sessionId?: string | null;
  clientDraftRev: number;
  onDraftRevChange?: (next: number) => void;
  updateArtifactJsonAction?: (args: UpdateArtifactJsonArgs) => Promise<UpdateArtifactJsonResult>;
}) {
  const [content, setContent] = useState<FinancialPlanContent>(() => {
    if (
      initialJson &&
      typeof initialJson === "object" &&
      typeof initialJson.currency === "string"
    ) {
      return initialJson as FinancialPlanContent;
    }
    return emptyFinancialPlan();
  });

  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const lastQueuedJsonRef = useRef<string>(stableStringify(content));
  const lastSavedJsonRef = useRef<string>(stableStringify(content));
  const draftRevRef = useRef<number>(clientDraftRev);

  useEffect(() => {
    draftRevRef.current = clientDraftRev;
  }, [clientDraftRev]);

  const clearPendingSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
  }, []);

  const runSave = useCallback(
    async (updated: FinancialPlanContent) => {
      if (readOnly || savingRef.current || !sessionId) return;

      const json = stableStringify(updated);
      if (!json || json === lastSavedJsonRef.current) return;

      savingRef.current = true;
      setSaveState("saving");
      setSaveMessage(null);

      try {
        const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/draft`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId,
            clientDraftRev: draftRevRef.current,
            title: "Financial Plan",
            content: updated,
            autosave: true,
            summary: "Financial plan autosave",
          }),
        });

        const data = await res.json().catch(() => ({ ok: false }));

        if (data?.ok) {
          lastSavedJsonRef.current = json;
          if (typeof data.currentDraftRev === "number") {
            draftRevRef.current = data.currentDraftRev;
            onDraftRevChange?.(data.currentDraftRev);
          }
          setSaveState("saved");
          setSaveMessage(
            typeof data.currentDraftRev === "number"
              ? `Saved draft rev ${data.currentDraftRev}`
              : "Saved"
          );
        } else {
          setSaveState("error");
          setSaveMessage(data?.message || "Autosave failed");
          console.error("[FinancialPlanEditorHost] save failed:", data?.error ?? data?.message ?? "Unknown error");
        }
      } catch (e) {
        setSaveState("error");
        setSaveMessage("Autosave failed");
        console.error("[FinancialPlanEditorHost] save error:", e);
      } finally {
        savingRef.current = false;
      }
    },
    [artifactId, onDraftRevChange, readOnly, sessionId]
  );

  const queueSave = useCallback(
    (updated: FinancialPlanContent) => {
      if (readOnly || !sessionId) return;

      const json = stableStringify(updated);
      if (!json) return;
      if (json === lastQueuedJsonRef.current && json === lastSavedJsonRef.current) return;

      lastQueuedJsonRef.current = json;
      clearPendingSave();

      saveTimer.current = setTimeout(() => {
        saveTimer.current = null;
        void runSave(updated);
      }, 800);
    },
    [clearPendingSave, readOnly, runSave, sessionId]
  );

  const handleChange = useCallback(
    (updated: FinancialPlanContent) => {
      setContent(updated);
      queueSave(updated);
    },
    [queueSave]
  );

  // Reload content from server after resource plan sync
  const handleRequestReload = useCallback(async () => {
    try {
      const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}?nocache=${Date.now()}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      const freshContent = data?.content_json ?? data?.content ?? null;
      if (freshContent && typeof freshContent === "object" && typeof freshContent.currency === "string") {
        setContent(freshContent as FinancialPlanContent);
        lastSavedJsonRef.current = stableStringify(freshContent);
        lastQueuedJsonRef.current = stableStringify(freshContent);
      }
    } catch (e) {
      console.warn("[FinancialPlanEditorHost] reload after sync failed:", e);
    }
  }, [artifactId]);

  useEffect(() => {
    return () => {
      clearPendingSave();
    };
  }, [clearPendingSave]);

  return (
    <div className="w-full text-slate-900">
      <div className="mb-3 flex items-center justify-between text-xs text-slate-500">
        <div>{readOnly ? "Read-only" : "Autosave enabled"}</div>
        <div>
          {saveState === "saving" ? "Saving…" : saveState === "saved" ? saveMessage : saveState === "error" ? saveMessage : null}
        </div>
      </div>

      <FinancialPlanEditor
        content={content}
        onChange={handleChange}
        organisationId={organisationId ?? projectId}
        projectId={projectId}
        artifactId={artifactId}
        isAdmin={isAdmin}
        readOnly={readOnly}
        onRequestReload={handleRequestReload}
      />
    </div>
  );
}

function PanelToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
      )}
    >
      {children}
    </button>
  );
}

function PanelsCard({
  showAI,
  showTimeline,
  openAI,
  openTimeline,
  setOpenAI,
  setOpenTimeline,
  aiTargetType,
  aiTitle,
  projectId,
  artifactId,
  mode,
  devHost,
}: {
  showAI: boolean;
  showTimeline: boolean;
  openAI: boolean;
  openTimeline: boolean;
  setOpenAI: React.Dispatch<React.SetStateAction<boolean>>;
  setOpenTimeline: React.Dispatch<React.SetStateAction<boolean>>;
  aiTargetType?: string;
  aiTitle?: string;
  projectId: string;
  artifactId: string;
  mode: ArtifactDetailClientMode;
  devHost: boolean;
}) {
  if (!showAI && !showTimeline) return null;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900">Panels</div>

        <div className="flex items-center gap-2">
          {showAI ? (
            <PanelToggleButton active={openAI} onClick={() => setOpenAI((v) => !v)}>
              {openAI ? "Hide AI" : "Show AI"}
            </PanelToggleButton>
          ) : null}

          {showTimeline ? (
            <PanelToggleButton active={openTimeline} onClick={() => setOpenTimeline((v) => !v)}>
              {openTimeline ? "Hide timeline" : "Show timeline"}
            </PanelToggleButton>
          ) : null}
        </div>
      </div>

      {showAI && openAI ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-slate-900">
          <AiSuggestionsPanel
            projectId={projectId}
            artifactId={artifactId}
            targetArtifactType={aiTargetType}
            title={aiTitle || "AI Suggestions"}
            limit={20}
            hideWhenEmpty={mode !== "closure"}
            showTestButton={devHost}
          />
        </div>
      ) : null}

      {showTimeline && openTimeline ? (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/60 p-3 text-slate-900">
          <ArtifactTimeline artifactId={artifactId} titleMap={{}} limit={60} />
        </div>
      ) : null}

      {!openAI && !openTimeline ? (
        <div className="text-xs text-slate-500">
          Tip: open panels only when you need them — keeps this page snappy.
        </div>
      ) : null}
    </section>
  );
}

/* ---------------- main component ---------------- */
export default function ArtifactDetailClientHost(props: ArtifactDetailClientHostProps) {
  const {
    projectId,
    artifactId,
    organisationId,
    isAdmin = false,
    mode,
    isEditable,
    lockLayout,
    charterInitial,
    typedInitialJson,
    rawContentJson,
    rawContentText,
    projectTitle,
    projectManagerName,
    projectStartDate,
    projectFinishDate,
    latestWbsJson,
    wbsArtifactId,
    aiTargetType,
    aiTitle,
    showTimeline = true,
    showAI = true,
    hideContentExportsRow: hideContentExportsRowProp = false,
    legacyExports,
    approvalEnabled,
    canSubmitOrResubmit,
    approvalStatus,
    submitForApprovalAction,
    updateArtifactJsonAction,
    isApprover = false,
    requestChangesWithCommentsAction = null,
  } = props;

  const [openAI, setOpenAI] = useState(false);
  const [openTimeline, setOpenTimeline] = useState(false);
  const [devHost, setDevHost] = useState(false);

  useEffect(() => {
    try {
      const host = window.location.hostname || "";
      setDevHost(/localhost|127\.0\.0\.1/i.test(host));
    } catch {
      setDevHost(false);
    }
  }, []);

  const artifactVersion = useMemo(() => getArtifactVersion(typedInitialJson), [typedInitialJson]);
  const isCharterV2 = mode === "charter" && artifactVersion >= 2;
  const isFinancialPlan = mode === "financial_plan";

  const approvalStatusLower = String(approvalStatus ?? "").trim().toLowerCase();

  const allowSubmitInEditor =
    !!approvalEnabled &&
    !!canSubmitOrResubmit &&
    (approvalStatusLower === "draft" || approvalStatusLower === "changes_requested");

  const hideContentExportsRow =
    mode === "charter" || mode === "closure" || mode === "weekly_report" || isFinancialPlan
      ? true
      : !!hideContentExportsRowProp;

  const effectiveLegacyExports =
    mode === "charter" ? (isCharterV2 ? undefined : legacyExports) : legacyExports;

  const shouldHidePanels = mode === "charter" || isFinancialPlan;

  const baseDraftRev = useMemo(() => {
    const candidates = [
      typedInitialJson?.currentDraftRev,
      typedInitialJson?.current_draft_rev,
      typedInitialJson?.meta?.currentDraftRev,
      rawContentJson?.currentDraftRev,
      rawContentJson?.current_draft_rev,
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    return 0;
  }, [typedInitialJson, rawContentJson]);

  const collaboration = useArtifactCollaboration({
    artifactId,
    enabled: isEditable,
    initialDraftRev: baseDraftRev,
  });

  const approvalLocked =
    (collaboration.state ? !collaboration.state.canEditByStatus : false) ||
    isApprovalLockedStatus(approvalStatus);

  const effectiveReadOnly =
    !isEditable ||
    lockLayout ||
    collaboration.isReadOnly ||
    approvalLocked;

  const isApproverMode = isApprover && effectiveReadOnly && mode === "charter";

  const handleRequestChangesWithComments = useMemo(() => {
    if (!requestChangesWithCommentsAction || !isApproverMode) return null;
    return async (comments: SectionComment[]) => {
      const fd = new FormData();
      fd.set("comments_json", JSON.stringify(
        comments.map((c) => ({ sectionKey: c.sectionKey, sectionTitle: c.sectionTitle, text: c.text }))
      ));
      await requestChangesWithCommentsAction(fd);
    };
  }, [requestChangesWithCommentsAction, isApproverMode]);

  const contentHeader = hideContentExportsRow ? null : (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm font-semibold text-slate-900">Content</div>
      <div className="text-xs text-slate-500">
        {effectiveReadOnly ? "Read-only" : "Editable"}
      </div>
    </div>
  );

  const sectionClassName = cx(
    "rounded-2xl border border-slate-200 bg-white p-6 text-slate-900 shadow-sm",
    hideContentExportsRow ? "space-y-0" : "space-y-4"
  );

  const overlayMessage = approvalLocked
    ? approvalStatusLower === "approved"
      ? "This artifact is approved and baselined — read only."
      : approvalStatusLower === "rejected"
        ? "This artifact has been rejected — read only."
        : "This artifact is read-only while under approval."
    : lockLayout
    ? "Layout is locked for this artifact."
    : collaboration.state?.readOnlyReason || collaboration.lockError || "Locked by another editor.";

  if (isFinancialPlan) {
    return (
      <div className="space-y-4 text-slate-900">
        <ArtifactCollaborationBanner
          readOnly={effectiveReadOnly}
          approvalLocked={approvalLocked}
          lockOwnerName={
            collaboration.state?.activeLock?.isMine ? null : collaboration.state?.activeLock?.editorName || null
          }
          expiresAt={collaboration.state?.activeLock?.expiresAt || null}
          currentVersionNo={collaboration.state?.currentVersionNo ?? 0}
          currentDraftRev={collaboration.state?.currentDraftRev ?? collaboration.draftRev}
        />

        <div className="relative w-full overflow-x-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className={effectiveReadOnly ? "pointer-events-none select-none opacity-80" : ""}>
            <FinancialPlanEditorHost
              projectId={projectId}
              artifactId={artifactId}
              organisationId={organisationId}
              isAdmin={isAdmin}
              initialJson={typedInitialJson ?? rawContentJson ?? null}
              readOnly={effectiveReadOnly}
              sessionId={collaboration.sessionId}
              clientDraftRev={collaboration.state?.currentDraftRev ?? collaboration.draftRev}
              onDraftRevChange={collaboration.setDraftRev}
              updateArtifactJsonAction={updateArtifactJsonAction}
            />
          </div>

          <ArtifactEditorReadOnlyOverlay
            show={effectiveReadOnly}
            message={overlayMessage}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-900">
      {!isApproverMode && !approvalLocked && (
        <ArtifactCollaborationBanner
          readOnly={effectiveReadOnly}
          approvalLocked={approvalLocked}
          lockOwnerName={
            collaboration.state?.activeLock?.isMine ? null : collaboration.state?.activeLock?.editorName || null
          }
          expiresAt={collaboration.state?.activeLock?.expiresAt || null}
          currentVersionNo={collaboration.state?.currentVersionNo ?? 0}
          currentDraftRev={collaboration.state?.currentDraftRev ?? collaboration.draftRev}
        />
      )}

      {mode === "change_requests" ? (
        <section className="w-full text-slate-900">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">Change Requests</div>
                <div className="mt-1 text-sm text-slate-600">
                  Open the dedicated board to manage changes, approvals, and delivery impact.
                </div>
              </div>

              <Link
                href={`/projects/${encodeURIComponent(projectId)}/change`}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
                prefetch={false}
              >
                Open Change Control
              </Link>
            </div>
          </div>

          {!shouldHidePanels ? (
            <div className="mt-6">
              <PanelsCard
                showAI={showAI}
                showTimeline={showTimeline}
                openAI={openAI}
                openTimeline={openTimeline}
                setOpenAI={setOpenAI}
                setOpenTimeline={setOpenTimeline}
                aiTargetType={aiTargetType}
                aiTitle={aiTitle}
                projectId={projectId}
                artifactId={artifactId}
                mode={mode}
                devHost={devHost}
              />
            </div>
          ) : null}
        </section>
      ) : (
        <>
          <section className={sectionClassName}>
            {contentHeader}

            {isApproverMode ? (
              <ProjectCharterEditorFormLazy
                projectId={projectId}
                artifactId={artifactId}
                initialJson={charterInitial}
                readOnly={true}
                lockLayout={true}
                artifactVersion={artifactVersion}
                projectTitle={projectTitle}
                projectManagerName={projectManagerName ?? undefined}
                legacyExports={effectiveLegacyExports}
                approvalEnabled={!!approvalEnabled}
                canSubmitOrResubmit={false}
                approvalStatus={approvalStatus ?? null}
                submitForApprovalAction={null}
                isApprover={true}
                onRequestChangesWithComments={handleRequestChangesWithComments}
              />
            ) : (
              <div className="relative">
                <div className={effectiveReadOnly ? "pointer-events-none select-none opacity-80" : ""}>
                  {mode === "charter" ? (
                    <ProjectCharterEditorFormLazy
                      projectId={projectId}
                      artifactId={artifactId}
                      initialJson={charterInitial}
                      readOnly={effectiveReadOnly}
                      artifactVersion={artifactVersion}
                      projectTitle={projectTitle}
                      projectManagerName={projectManagerName ?? undefined}
                      legacyExports={effectiveLegacyExports}
                      approvalEnabled={!!approvalEnabled}
                      canSubmitOrResubmit={allowSubmitInEditor && !effectiveReadOnly}
                      approvalStatus={approvalStatus ?? null}
                      submitForApprovalAction={allowSubmitInEditor && !effectiveReadOnly ? submitForApprovalAction : null}
                    />
                  ) : mode === "stakeholder" ? (
                    <StakeholderRegisterEditor
                      projectId={projectId}
                      artifactId={artifactId}
                      initialJson={rawContentJson ?? null}
                      readOnly={effectiveReadOnly}
                    />
                  ) : mode === "wbs" ? (
                    <WBSEditor
                      projectId={projectId}
                      artifactId={artifactId}
                      initialJson={rawContentJson ?? null}
                      readOnly={effectiveReadOnly}
                    />
                  ) : mode === "schedule" ? (
                    <ScheduleGanttEditor
                      projectId={projectId}
                      artifactId={artifactId}
                      initialJson={typedInitialJson ?? null}
                      readOnly={effectiveReadOnly}
                      projectTitle={projectTitle || ""}
                      projectStartDate={projectStartDate ?? null}
                      projectFinishDate={projectFinishDate ?? null}
                      latestWbsJson={latestWbsJson ?? null}
                      wbsArtifactId={wbsArtifactId ?? null}
                    />
                  ) : mode === "closure" ? (
                    <ProjectClosureReportEditor
                      projectId={projectId}
                      artifactId={artifactId}
                      initialJson={typedInitialJson ?? null}
                      readOnly={effectiveReadOnly}
                    />
                  ) : mode === "weekly_report" ? (
                    <WeeklyReportEditor
                      projectId={projectId}
                      artifactId={artifactId}
                      initialJson={typedInitialJson ?? rawContentJson ?? null}
                      readOnly={effectiveReadOnly}
                      updateArtifactJsonAction={updateArtifactJsonAction}
                    />
                  ) : (
                    <div className="grid gap-3">
                      {String(rawContentText ?? "").trim().length === 0 ? (
                        <div className="text-sm text-slate-600">No content yet.</div>
                      ) : null}

                      <textarea
                        rows={14}
                        readOnly
                        value={String(rawContentText ?? "")}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-900 whitespace-pre-wrap outline-none"
                      />
                    </div>
                  )}
                </div>

                <ArtifactEditorReadOnlyOverlay
                  show={effectiveReadOnly}
                  message={overlayMessage}
                />
              </div>
            )}
          </section>

          {!shouldHidePanels ? (
            <PanelsCard
              showAI={showAI}
              showTimeline={showTimeline}
              openAI={openAI}
              openTimeline={openTimeline}
              setOpenAI={setOpenAI}
              setOpenTimeline={setOpenTimeline}
              aiTargetType={aiTargetType}
              aiTitle={aiTitle}
              projectId={projectId}
              artifactId={artifactId}
              mode={mode}
              devHost={devHost}
            />
          ) : null}
        </>
      )}
    </div>
  );
}