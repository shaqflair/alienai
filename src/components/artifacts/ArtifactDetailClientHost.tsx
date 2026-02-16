// src/components/artifacts/ArtifactDetailClientHost.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";

/**
 * ✅ Keep Charter entry as normal import.
 * Heavy internals are already lazy-loaded inside ProjectCharterEditorFormLazy.tsx.
 */
import ProjectCharterEditorFormLazy from "@/components/editors/ProjectCharterEditorFormLazy";

/* ---------------- dynamic client components ---------------- */

const StakeholderRegisterEditor = dynamic(
  () => import("@/components/editors/StakeholderRegisterEditor"),
  {
    ssr: false,
    loading: () => <div className="text-sm text-gray-500">Loading Stakeholder editor…</div>,
  }
);

const WBSEditor = dynamic(() => import("@/components/editors/WBSEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading WBS editor…</div>,
});

const ScheduleGanttEditor = dynamic(() => import("@/components/editors/ScheduleGanttEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Schedule editor…</div>,
});

const ProjectClosureReportEditor = dynamic(
  () => import("@/components/editors/ProjectClosureReportEditor"),
  {
    ssr: false,
    loading: () => <div className="text-sm text-gray-500">Loading Closure Report editor…</div>,
  }
);

const ChangeManagementBoard = dynamic(() => import("@/components/change/ChangeManagementBoard"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Change Board…</div>,
});

const WeeklyReportEditor = dynamic(() => import("@/components/editors/WeeklyReportEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Weekly Report editor…</div>,
});

const AiSuggestionsPanel = dynamic(() => import("@/components/ai/AiSuggestionsPanel"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading AI suggestions…</div>,
});

const ArtifactTimeline = dynamic(() => import("@/components/artifacts/ArtifactTimeline"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading timeline…</div>,
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

  mode: ArtifactDetailClientMode;

  isEditable: boolean;
  lockLayout: boolean;

  // initial JSON/content from server
  charterInitial?: any;
  typedInitialJson?: any;
  rawContentJson?: any;
  rawContentText?: string;

  // schedule extras
  projectTitle?: string;
  projectStartDate?: string | null;
  projectFinishDate?: string | null;

  latestWbsJson?: any;
  wbsArtifactId?: string | null;

  // AI panel
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

  /**
   * ✅ Optional server action (same idea as Charter save)
   * Provide this from the Server Component host.
   */
  updateArtifactJsonAction?: (args: UpdateArtifactJsonArgs) => Promise<UpdateArtifactJsonResult>;
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getArtifactVersion(typedInitialJson: any) {
  const v = Number((typedInitialJson as any)?.version ?? (typedInitialJson as any)?.content?.version ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

export default function ArtifactDetailClientHost(props: ArtifactDetailClientHostProps) {
  const {
    projectId,
    artifactId,
    mode,
    isEditable,
    lockLayout,

    charterInitial,
    typedInitialJson,
    rawContentJson,
    rawContentText,

    projectTitle,
    projectStartDate,
    projectFinishDate,

    // ✅ FIX: actually receive this and pass it to ScheduleGanttEditor
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
  } = props;

  const [openAI, setOpenAI] = useState(false);
  const [openTimeline, setOpenTimeline] = useState(false);

  // hydration-safe dev detection for showTestButton
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

  const hideContentExportsRow =
    mode === "charter" || mode === "closure" || mode === "weekly_report" ? true : !!hideContentExportsRowProp;

  const effectiveLegacyExports =
    mode === "charter" ? (isCharterV2 ? undefined : legacyExports) : legacyExports;

  const contentHeader = hideContentExportsRow ? null : (
    <div className="flex items-center justify-between">
      <div className="font-medium">Content</div>
      {!isEditable ? <div className="text-xs text-gray-500">Read-only</div> : null}
    </div>
  );

  return (
    <div className="space-y-6">
      {mode === "change_requests" ? (
        <section className="w-full">
          <div className="crEmbed">
            <div className="crPage">
              <ChangeManagementBoard projectId={projectId} artifactId={artifactId} />
            </div>
          </div>

          {showAI || showTimeline ? (
            <section className="mt-6 border rounded-2xl bg-white p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Panels</div>
                <div className="flex items-center gap-2">
                  {showAI ? (
                    <button
                      type="button"
                      onClick={() => setOpenAI((v) => !v)}
                      className={cx(
                        "rounded-xl border px-3 py-2 text-sm transition",
                        openAI ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {openAI ? "Hide AI" : "Show AI"}
                    </button>
                  ) : null}

                  {showTimeline ? (
                    <button
                      type="button"
                      onClick={() => setOpenTimeline((v) => !v)}
                      className={cx(
                        "rounded-xl border px-3 py-2 text-sm transition",
                        openTimeline ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {openTimeline ? "Hide timeline" : "Show timeline"}
                    </button>
                  ) : null}
                </div>
              </div>

              {showAI && openAI ? (
                <AiSuggestionsPanel
                  projectId={projectId}
                  artifactId={artifactId}
                  targetArtifactType={aiTargetType}
                  title={aiTitle || "AI Suggestions"}
                  limit={20}
                  hideWhenEmpty={false}
                  showTestButton={devHost}
                />
              ) : null}

              {showTimeline && openTimeline ? (
                <ArtifactTimeline artifactId={artifactId} titleMap={{}} limit={60} />
              ) : null}
            </section>
          ) : null}
        </section>
      ) : (
        <>
          <section className={cx("border rounded-2xl bg-white p-6", hideContentExportsRow ? "space-y-0" : "space-y-4")}>
            {contentHeader}

            {mode === "charter" ? (
              <ProjectCharterEditorFormLazy
                projectId={projectId}
                artifactId={artifactId}
                initialJson={charterInitial}
                readOnly={!isEditable}
                lockLayout={lockLayout}
                artifactVersion={artifactVersion}
                legacyExports={effectiveLegacyExports}
                approvalEnabled={!!approvalEnabled}
                canSubmitOrResubmit={!!canSubmitOrResubmit}
                approvalStatus={approvalStatus ?? null}
                submitForApprovalAction={submitForApprovalAction}
              />
            ) : mode === "stakeholder" ? (
              <StakeholderRegisterEditor
                projectId={projectId}
                artifactId={artifactId}
                initialJson={rawContentJson ?? null}
                readOnly={!isEditable}
              />
            ) : mode === "wbs" ? (
              <WBSEditor projectId={projectId} artifactId={artifactId} initialJson={rawContentJson ?? null} readOnly={!isEditable} />
            ) : mode === "schedule" ? (
              <ScheduleGanttEditor
                projectId={projectId}
                artifactId={artifactId}
                initialJson={typedInitialJson ?? null}
                readOnly={!isEditable}
                projectTitle={projectTitle || ""}
                projectStartDate={projectStartDate ?? null}
                projectFinishDate={projectFinishDate ?? null}
                // ✅ FIX: pass through server-provided WBS JSON so schedule doesn't need to refetch
                latestWbsJson={latestWbsJson ?? null}
                wbsArtifactId={wbsArtifactId ?? null}
              />
            ) : mode === "closure" ? (
              <ProjectClosureReportEditor
                projectId={projectId}
                artifactId={artifactId}
                initialJson={typedInitialJson ?? null}
                readOnly={!isEditable}
                lockLayout={lockLayout}
              />
            ) : mode === "weekly_report" ? (
              <WeeklyReportEditor
                projectId={projectId}
                artifactId={artifactId}
                initialJson={typedInitialJson ?? rawContentJson ?? null}
                readOnly={!isEditable}
                updateArtifactJsonAction={updateArtifactJsonAction}
              />
            ) : (
              <div className="grid gap-2">
                {String(rawContentText ?? "").trim().length === 0 ? (
                  <div className="text-sm text-gray-600">No content yet.</div>
                ) : null}
                <textarea
                  rows={14}
                  readOnly
                  value={String(rawContentText ?? "")}
                  className="border rounded-xl px-3 py-2 font-mono text-sm bg-gray-50 whitespace-pre-wrap"
                />
              </div>
            )}
          </section>

          {showAI || showTimeline ? (
            <section className="border rounded-2xl bg-white p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium">Panels</div>

                <div className="flex items-center gap-2">
                  {showAI ? (
                    <button
                      type="button"
                      onClick={() => setOpenAI((v) => !v)}
                      className={cx(
                        "rounded-xl border px-3 py-2 text-sm transition",
                        openAI ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {openAI ? "Hide AI" : "Show AI"}
                    </button>
                  ) : null}

                  {showTimeline ? (
                    <button
                      type="button"
                      onClick={() => setOpenTimeline((v) => !v)}
                      className={cx(
                        "rounded-xl border px-3 py-2 text-sm transition",
                        openTimeline ? "bg-black text-white border-black" : "border-gray-200 hover:bg-gray-50"
                      )}
                    >
                      {openTimeline ? "Hide timeline" : "Show timeline"}
                    </button>
                  ) : null}
                </div>
              </div>

              {showAI && openAI ? (
                <AiSuggestionsPanel
                  projectId={projectId}
                  artifactId={artifactId}
                  targetArtifactType={aiTargetType}
                  title={aiTitle || "AI Suggestions"}
                  limit={20}
                  hideWhenEmpty={mode !== "charter" && mode !== "closure"}
                  showTestButton={devHost}
                />
              ) : null}

              {showTimeline && openTimeline ? (
                <ArtifactTimeline artifactId={artifactId} titleMap={{}} limit={60} />
              ) : null}

              {!openAI && !openTimeline ? (
                <div className="text-xs text-gray-500">Tip: open panels only when you need them — keeps this page snappy.</div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
