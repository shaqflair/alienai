// src/components/artifacts/ArtifactDetailClientHost.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";

import ProjectCharterEditorFormLazy from "@/components/editors/ProjectCharterEditorFormLazy";
import {
  emptyFinancialPlan,
  type FinancialPlanContent,
} from "@/components/artifacts/FinancialPlanEditor";

/* ---------------- dynamic client components ---------------- */

const StakeholderRegisterEditor = dynamic(() => import("@/components/editors/StakeholderRegisterEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Stakeholder editor…</div>,
});

const WBSEditor = dynamic(() => import("@/components/editors/WBSEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading WBS editor…</div>,
});

const ScheduleGanttEditor = dynamic(() => import("@/components/editors/ScheduleGanttEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Schedule editor…</div>,
});

const ProjectClosureReportEditor = dynamic(() => import("@/components/editors/ProjectClosureReportEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Closure Report editor…</div>,
});

const ChangeManagementBoard = dynamic(() => import("@/components/change/ChangeManagementBoard"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Change Board…</div>,
});

const WeeklyReportEditor = dynamic(() => import("@/components/editors/WeeklyReportEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Weekly Report editor…</div>,
});

const FinancialPlanEditor = dynamic(() => import("@/components/artifacts/FinancialPlanEditor"), {
  ssr: false,
  loading: () => <div className="text-sm text-gray-500">Loading Financial Plan editor…</div>,
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
};

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function getArtifactVersion(typedInitialJson: any) {
  const v = Number((typedInitialJson as any)?.version ?? (typedInitialJson as any)?.content?.version ?? 1);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/* -----------------------------------------------------------------------
   ✅ FinancialPlanEditorHost
   Thin stateful wrapper so FinancialPlanEditor always receives a valid
   `content` object (never null/undefined) and auto-saves via the action.
   ----------------------------------------------------------------------- */
function FinancialPlanEditorHost({
  projectId,
  artifactId,
  initialJson,
  readOnly,
  updateArtifactJsonAction,
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly: boolean;
  updateArtifactJsonAction?: (args: UpdateArtifactJsonArgs) => Promise<UpdateArtifactJsonResult>;
}) {
  // ✅ Safe initialisation — fall back to emptyFinancialPlan() if null/invalid
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

  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleChange = useCallback(
    (updated: FinancialPlanContent) => {
      setContent(updated);

      if (!updateArtifactJsonAction || readOnly) return;

      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        updateArtifactJsonAction({
          artifactId,
          projectId,
          contentJson: updated,
        }).catch((e) => {
          console.error("[FinancialPlanEditorHost] save error:", e);
        });
      }, 800);
    },
    [artifactId, projectId, readOnly, updateArtifactJsonAction]
  );

  // Cleanup timer on unmount
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  return (
    <FinancialPlanEditor
      content={content}
      onChange={handleChange}
      readOnly={readOnly}
    />
  );
}

/* ---------------- main component ---------------- */

export default function ArtifactDetailClientHost(props: ArtifactDetailClientHostProps) {
  const {
    projectId, artifactId, mode, isEditable, lockLayout,
    charterInitial, typedInitialJson, rawContentJson, rawContentText,
    projectTitle, projectManagerName, projectStartDate, projectFinishDate,
    latestWbsJson, wbsArtifactId,
    aiTargetType, aiTitle,
    showTimeline = true, showAI = true,
    hideContentExportsRow: hideContentExportsRowProp = false,
    legacyExports,
    approvalEnabled, canSubmitOrResubmit, approvalStatus,
    submitForApprovalAction,
    updateArtifactJsonAction,
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

  const hideContentExportsRow =
    mode === "charter" || mode === "closure" || mode === "weekly_report" || mode === "financial_plan"
      ? true
      : !!hideContentExportsRowProp;

  const effectiveLegacyExports =
    mode === "charter" ? (isCharterV2 ? undefined : legacyExports) : legacyExports;

  const contentHeader = hideContentExportsRow ? null : (
    <div className="flex items-center justify-between">
      <div className="font-medium">Content</div>
      {!isEditable ? <div className="text-xs text-gray-500">Read-only</div> : null}
    </div>
  );

  const shouldHidePanels = mode === "charter" || mode === "financial_plan";

  return (
    <div className="space-y-6">
      {mode === "change_requests" ? (
        <section className="w-full">
          <div className="crEmbed">
            <div className="crPage">
              <Link
                href={`/projects/${encodeURIComponent(projectId)}/change`}
                className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50"
                prefetch={false}
              >
                Open Change Control
              </Link>
            </div>
          </div>
          {!shouldHidePanels && (showAI || showTimeline) ? (
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
                artifactVersion={artifactVersion}
                projectTitle={projectTitle}
                projectManagerName={projectManagerName ?? undefined}
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
              <WBSEditor
                projectId={projectId}
                artifactId={artifactId}
                initialJson={rawContentJson ?? null}
                readOnly={!isEditable}
              />
            ) : mode === "schedule" ? (
              <ScheduleGanttEditor
                projectId={projectId}
                artifactId={artifactId}
                initialJson={typedInitialJson ?? null}
                readOnly={!isEditable}
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
                readOnly={!isEditable}
              />
            ) : mode === "weekly_report" ? (
              <WeeklyReportEditor
                projectId={projectId}
                artifactId={artifactId}
                initialJson={typedInitialJson ?? rawContentJson ?? null}
                readOnly={!isEditable}
                updateArtifactJsonAction={updateArtifactJsonAction}
              />
            ) : mode === "financial_plan" ? (
              // ✅ Uses FinancialPlanEditorHost to safely handle null initialJson
              <FinancialPlanEditorHost
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

          {!shouldHidePanels && (showAI || showTimeline) ? (
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
                  hideWhenEmpty={mode !== "closure"}
                  showTestButton={devHost}
                />
              ) : null}
              {showTimeline && openTimeline ? (
                <ArtifactTimeline artifactId={artifactId} titleMap={{}} limit={60} />
              ) : null}
              {!openAI && !openTimeline ? (
                <div className="text-xs text-gray-500">
                  Tip: open panels only when you need them — keeps this page snappy.
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

