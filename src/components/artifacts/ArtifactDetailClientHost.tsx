// src/components/artifacts/ArtifactDetailClientHost.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import {
  CheckCircle2,
  Clock3,
  Eye,
  FileLock2,
  GitBranch,
  History,
  Lock,
  ShieldCheck,
  Sparkles,
} from "lucide-react";

import ProjectCharterEditorFormLazy from "@/components/editors/ProjectCharterEditorFormLazy";
import type { SectionComment } from "@/components/editors/ProjectCharterEditorFormLazy";
import ArtifactCollaborationBanner from "@/components/artifacts/ArtifactCollaborationBanner";
import { useArtifactCollaboration } from "@/components/artifacts/useArtifactCollaboration";
import {
  emptyFinancialPlan,
  type FinancialPlanContent,
} from "@/components/artifacts/FinancialPlanEditor";
import { getApprovedTimesheetEntries } from "@/app/actions/financial-plan-timesheets";
import type { TimesheetEntry } from "@/components/artifacts/computeActuals";

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

function statusLabel(status: string | null | undefined) {
  const s = String(status ?? "").trim().toLowerCase();
  if (!s) return "Draft";
  if (s === "submitted_for_approval") return "Submitted for approval";
  if (s === "pending_approval") return "Pending approval";
  if (s === "in_review") return "In review";
  if (s === "awaiting_approval") return "Awaiting approval";
  if (s === "changes_requested") return "Changes requested";
  return s.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function getDocumentStateMeta(args: {
  effectiveReadOnly: boolean;
  approvalLocked: boolean;
  approvalStatus?: string | null;
  isFinancialPlan?: boolean;
  isApproverReviewMode?: boolean;
}) {
  const { effectiveReadOnly, approvalLocked, approvalStatus, isFinancialPlan, isApproverReviewMode } = args;
  const status = String(approvalStatus ?? "").trim().toLowerCase();

  if (status === "approved") {
    return {
      icon: ShieldCheck,
      tone: "emerald" as const,
      label: isFinancialPlan ? "Approved — controlled edit mode" : "Approved — baselined read-only",
      description: isFinancialPlan
        ? "This financial plan is approved and baselined. The approved budget remains locked. Supporting delivery fields can still be maintained."
        : "This artifact is approved and baselined. It stays fully readable for audit and governance, but editing is disabled.",
    };
  }

  if (status === "rejected") {
    return {
      icon: FileLock2,
      tone: "rose" as const,
      label: "Rejected — read-only",
      description: "This artifact has been rejected. It remains fully visible for review and audit, but editing is disabled until revised.",
    };
  }

  if (isApproverReviewMode) {
    return {
      icon: Eye,
      tone: "blue" as const,
      label: "Review access enabled",
      description: "You are viewing this artifact in approval review mode. Content is fully readable so you can review it properly.",
    };
  }

  if (approvalLocked) {
    return {
      icon: Clock3,
      tone: "amber" as const,
      label: isFinancialPlan ? "In approval — controlled edit mode" : "In approval — read-only",
      description: isFinancialPlan
        ? "This financial plan is under approval. The approved budget field is locked while governance review is in progress."
        : "This artifact is under approval. It remains fully readable, but editing is locked until the review cycle completes.",
    };
  }

  if (effectiveReadOnly) {
    return {
      icon: Lock,
      tone: "slate" as const,
      label: "Read-only",
      description: "You can read the artifact clearly, but editing is currently disabled.",
    };
  }

  return {
    icon: Sparkles,
    tone: "emerald" as const,
    label: "Editing enabled",
    description: "You are in edit mode. Changes are saved against the current draft revision.",
  };
}

function toneClasses(tone: "emerald" | "amber" | "rose" | "blue" | "slate") {
  switch (tone) {
    case "emerald":
      return {
        card: "border-emerald-200 bg-emerald-50/80",
        iconWrap: "bg-emerald-100 text-emerald-700",
        pill: "border-emerald-200 bg-white text-emerald-800",
        sub: "text-emerald-800/90",
      };
    case "amber":
      return {
        card: "border-amber-200 bg-amber-50/80",
        iconWrap: "bg-amber-100 text-amber-700",
        pill: "border-amber-200 bg-white text-amber-800",
        sub: "text-amber-900/90",
      };
    case "rose":
      return {
        card: "border-rose-200 bg-rose-50/80",
        iconWrap: "bg-rose-100 text-rose-700",
        pill: "border-rose-200 bg-white text-rose-800",
        sub: "text-rose-900/90",
      };
    case "blue":
      return {
        card: "border-blue-200 bg-blue-50/80",
        iconWrap: "bg-blue-100 text-blue-700",
        pill: "border-blue-200 bg-white text-blue-800",
        sub: "text-blue-900/90",
      };
    default:
      return {
        card: "border-slate-200 bg-slate-50/80",
        iconWrap: "bg-slate-100 text-slate-700",
        pill: "border-slate-200 bg-white text-slate-800",
        sub: "text-slate-700",
      };
  }
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
  budgetLocked = false,
  sessionId,
  clientDraftRev,
  onDraftRevChange,
  updateArtifactJsonAction,
}: {
  projectId: string;
  artifactId: string;
  organisationId?: string;
  isAdmin?: boolean;
  initialJson: any;
  readOnly: boolean;
  budgetLocked?: boolean;
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

  const [timesheetEntries, setTimesheetEntries] = useState<TimesheetEntry[]>([]);

  useEffect(() => {
    if (!projectId) return;
    // Pass empty resourceIds — weekly_timesheet_entries is the source of truth now.
    // Passing resourceIds caused double-counting with legacy timesheet_entries.
    getApprovedTimesheetEntries(projectId, []).then(result => {
      if (result.ok) setTimesheetEntries(result.entries);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

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
      if (readOnly || savingRef.current) return;

      const json = stableStringify(updated);
      if (!json || json === lastSavedJsonRef.current) return;

      savingRef.current = true;
      setSaveState("saving");
      setSaveMessage(null);

      try {
        let ok = false;
        let errorMsg = "";

        if (updateArtifactJsonAction && projectId && artifactId) {
          const result = await updateArtifactJsonAction({
            projectId,
            artifactId,
            contentJson: updated,
          });
          ok = result?.ok ?? false;
          errorMsg = result?.error ?? "Save failed";
        } else if (sessionId && artifactId) {
          const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/draft`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              sessionId,
              clientDraftRev: draftRevRef.current,
              title: "Financial Plan",
              content: updated,
              autosave: false,
              summary: "Financial plan saved",
            }),
          });
          const data = await res.json().catch(() => ({ ok: false }));
          ok = data?.ok || res.ok;
          if (ok && typeof data.currentDraftRev === "number") {
            draftRevRef.current = data.currentDraftRev;
            onDraftRevChange?.(data.currentDraftRev);
          }
          errorMsg = data?.error ?? data?.message ?? "Save failed";
        } else {
          errorMsg = !artifactId ? "Missing artifactId — cannot save" : "No save method available";
        }

        if (ok) {
          lastSavedJsonRef.current = json;
          setSaveState("saved");
          setSaveMessage("Saved");
        } else {
          setSaveState("error");
          setSaveMessage(errorMsg);
          console.error("[FinancialPlanEditorHost] save failed:", errorMsg);
        }
      } catch (e: any) {
        setSaveState("error");
        setSaveMessage(e?.message || "Save error");
        console.error("[FinancialPlanEditorHost] save error:", e);
      } finally {
        savingRef.current = false;
      }
    },
    [artifactId, projectId, updateArtifactJsonAction, onDraftRevChange, readOnly, sessionId]
  );

  const queueSave = useCallback(
    (updated: FinancialPlanContent) => {
      if (readOnly) return;

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
    [clearPendingSave, readOnly, runSave]
  );

  const handleChange = useCallback(
    (updated: FinancialPlanContent) => {
      setContent(updated);
      queueSave(updated);
    },
    [queueSave]
  );

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
      <div className="mb-4 flex items-center justify-between rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-xs shadow-sm">
        <div className="flex items-center gap-2 text-slate-700">
          <History className="h-4 w-4" />
          <span className="font-medium">{readOnly ? "Read-only mode" : "Autosave enabled"}</span>
        </div>

        <span className="font-medium text-slate-600">
          {saveState === "saved" ? `✓ ${saveMessage}` : saveState === "error" ? `⚠ ${saveMessage}` : null}
        </span>
      </div>

      <FinancialPlanEditor
        content={content}
        onChange={handleChange}
        organisationId={organisationId ?? projectId}
        projectId={projectId}
        artifactId={artifactId}
        isAdmin={isAdmin}
        readOnly={readOnly}
        budgetLocked={budgetLocked}
        onRequestReload={handleRequestReload}
        timesheetEntries={timesheetEntries}
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
    <section className="rounded-3xl border border-slate-200 bg-white p-5 text-slate-900 shadow-sm space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">Insights & activity</div>
          <div className="mt-1 text-xs text-slate-500">Open only what you need to keep the workspace focused.</div>
        </div>

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
          AI suggestions and timeline are available on demand.
        </div>
      ) : null}
    </section>
  );
}

function EditorStatusBar({
  effectiveReadOnly,
  approvalLocked,
  approvalStatus,
  currentVersionNo,
  currentDraftRev,
  isFinancialPlan,
  isApproverReviewMode = false,
}: {
  effectiveReadOnly: boolean;
  approvalLocked: boolean;
  approvalStatus?: string | null;
  currentVersionNo: number;
  currentDraftRev: number;
  isFinancialPlan?: boolean;
  isApproverReviewMode?: boolean;
}) {
  const meta = getDocumentStateMeta({
    effectiveReadOnly,
    approvalLocked,
    approvalStatus,
    isFinancialPlan,
    isApproverReviewMode,
  });
  const Icon = meta.icon;
  const tone = toneClasses(meta.tone);

  return (
    <div className={cx("rounded-3xl border px-4 py-4 shadow-sm", tone.card)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex items-start gap-3">
          <div className={cx("mt-0.5 flex h-10 w-10 items-center justify-center rounded-2xl", tone.iconWrap)}>
            <Icon className="h-5 w-5" />
          </div>

          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className={cx("inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold", tone.pill)}>
                {meta.label}
              </span>

              <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-medium text-slate-700">
                {statusLabel(approvalStatus)}
              </span>
            </div>

            <p className={cx("mt-2 text-sm", tone.sub)}>
              {meta.description}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <div className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 text-xs text-slate-700">
            <GitBranch className="h-4 w-4 text-slate-500" />
            <span>
              Draft rev <span className="font-semibold text-slate-900">{currentDraftRev}</span>
            </span>
          </div>

          <div className="inline-flex items-center gap-2 rounded-2xl border border-white/70 bg-white/80 px-3 py-2 text-xs text-slate-700">
            <History className="h-4 w-4 text-slate-500" />
            <span>
              Version <span className="font-semibold text-slate-900">{currentVersionNo}</span>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function DocumentShell({
  children,
  header,
  subheader,
}: {
  children: React.ReactNode;
  header?: React.ReactNode;
  subheader?: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
      {(header || subheader) && (
        <div className="border-b border-slate-200 bg-gradient-to-b from-slate-50 to-white px-6 py-5">
          {header ? <div className="flex items-center justify-between gap-3">{header}</div> : null}
          {subheader ? <div className="mt-2">{subheader}</div> : null}
        </div>
      )}

      <div className="px-6 py-6">
        {children}
      </div>
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

  const approvalStatusIsTerminal =
    approvalStatusLower === "approved" || approvalStatusLower === "rejected";

  const isInApprovalReviewState =
    approvalStatusLower === "submitted" ||
    approvalStatusLower === "submitted_for_approval" ||
    approvalStatusLower === "pending_approval" ||
    approvalStatusLower === "in_review" ||
    approvalStatusLower === "awaiting_approval";

  const isApproverReviewMode =
    !!isApprover && !!approvalEnabled && isInApprovalReviewState && !approvalStatusIsTerminal;

  const fpApprovalLocked = isFinancialPlan && isApprovalLockedStatus(approvalStatus);

  const hasActiveOtherEditorLock =
    !!collaboration.state?.activeLock && !collaboration.state?.activeLock?.isMine;

  const showCollaborationBanner =
    !isApproverReviewMode && !approvalLocked && hasActiveOtherEditorLock;

  const effectiveReadOnly = isFinancialPlan
    ? (isInApprovalReviewState && !isApproverReviewMode) ||
      approvalStatusLower === "rejected" ||
      (!isEditable && !isApproverReviewMode && approvalStatusLower !== "approved")
    : !isEditable || lockLayout || collaboration.isReadOnly || approvalLocked;

  const isApproverMode = isApprover && effectiveReadOnly && mode === "charter";

  const handleRequestChangesWithComments = useMemo(() => {
    if (!requestChangesWithCommentsAction || !isApproverMode) return null;
    return async (comments: SectionComment[]) => {
      const fd = new FormData();
      fd.set(
        "comments_json",
        JSON.stringify(
          comments.map((c) => ({
            sectionKey: c.sectionKey,
            sectionTitle: c.sectionTitle,
            text: c.text,
          }))
        )
      );
      await requestChangesWithCommentsAction(fd);
    };
  }, [requestChangesWithCommentsAction, isApproverMode]);

  const currentVersionNo = collaboration.state?.currentVersionNo ?? 0;
  const currentDraftRev = collaboration.state?.currentDraftRev ?? collaboration.draftRev;

  const contentHeader = hideContentExportsRow ? null : (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="text-sm font-semibold text-slate-900">Artifact content</div>
        <div className="mt-1 text-xs text-slate-500">
          {effectiveReadOnly ? "Readable document mode" : "Live editing mode"}
        </div>
      </div>

      <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700">
        {effectiveReadOnly ? <Eye className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
        {effectiveReadOnly ? "Read-only" : "Editable"}
      </div>
    </div>
  );

  if (isFinancialPlan) {
    return (
      <div className="space-y-4 text-slate-900">
        {showCollaborationBanner ? (
          <ArtifactCollaborationBanner
            readOnly={effectiveReadOnly}
            approvalLocked={false}
            lockOwnerName={
              collaboration.state?.activeLock?.isMine ? null : collaboration.state?.activeLock?.editorName || null
            }
            expiresAt={collaboration.state?.activeLock?.expiresAt || null}
            currentVersionNo={currentVersionNo}
            currentDraftRev={currentDraftRev}
          />
        ) : null}

        <EditorStatusBar
          effectiveReadOnly={effectiveReadOnly}
          approvalLocked={approvalLocked}
          approvalStatus={approvalStatus}
          currentVersionNo={currentVersionNo}
          currentDraftRev={currentDraftRev}
          isFinancialPlan={true}
          isApproverReviewMode={isApproverReviewMode}
        />

        {approvalStatusLower === "approved" ? (
          <div className="rounded-3xl border border-emerald-200 bg-emerald-50/80 px-4 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-700">
                <CheckCircle2 className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-emerald-900">Financial Plan baselined</div>
                <div className="mt-1 text-sm text-emerald-800">
                  Cost lines, phasing, and supporting delivery data remain visible and manageable. The
                  <span className="font-semibold"> Approved Budget</span> field is locked and should be changed only through change control.
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {fpApprovalLocked && isInApprovalReviewState ? (
          <div className="rounded-3xl border border-blue-200 bg-blue-50/80 px-4 py-4 shadow-sm">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-blue-100 text-blue-700">
                <Eye className="h-5 w-5" />
              </div>
              <div>
                <div className="text-sm font-semibold text-blue-900">
                  {isApproverReviewMode ? "Approval review mode" : "Approval in progress"}
                </div>
                <div className="mt-1 text-sm text-blue-800">
                  {isApproverReviewMode
                    ? "You can review the content clearly. Editing remains controlled during the approval cycle."
                    : "This plan is under approval. The approved budget field is locked while review is in progress."}
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <DocumentShell
          header={
            <div>
              <div className="text-sm font-semibold text-slate-900">Financial plan</div>
              <div className="mt-1 text-xs text-slate-500">Readable, structured, and governance-safe.</div>
            </div>
          }
        >
          <div className="w-full overflow-x-auto">
            <FinancialPlanEditorHost
              projectId={projectId}
              artifactId={artifactId}
              organisationId={organisationId}
              isAdmin={isAdmin}
              initialJson={typedInitialJson ?? rawContentJson ?? null}
              readOnly={effectiveReadOnly && !isApproverReviewMode}
              budgetLocked={
                (isInApprovalReviewState && !isApproverReviewMode) ||
                approvalStatusLower === "approved"
              }
              sessionId={collaboration.sessionId}
              clientDraftRev={currentDraftRev}
              onDraftRevChange={collaboration.setDraftRev}
              updateArtifactJsonAction={updateArtifactJsonAction}
            />
          </div>
        </DocumentShell>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-slate-900">
      {!isApproverMode && !approvalLocked && mode !== "weekly_report" ? (
        <ArtifactCollaborationBanner
          readOnly={effectiveReadOnly}
          approvalLocked={approvalLocked}
          lockOwnerName={
            collaboration.state?.activeLock?.isMine ? null : collaboration.state?.activeLock?.editorName || null
          }
          expiresAt={collaboration.state?.activeLock?.expiresAt || null}
          currentVersionNo={currentVersionNo}
          currentDraftRev={currentDraftRev}
        />
      ) : null}

      {(mode === "weekly_report" || effectiveReadOnly || approvalLocked || isApproverReviewMode) ? (
        <EditorStatusBar
          effectiveReadOnly={effectiveReadOnly}
          approvalLocked={approvalLocked}
          approvalStatus={approvalStatus}
          currentVersionNo={currentVersionNo}
          currentDraftRev={currentDraftRev}
          isApproverReviewMode={isApproverReviewMode}
        />
      ) : null}

      {mode === "change_requests" ? (
        <section className="w-full text-slate-900">
          <DocumentShell
            header={
              <div>
                <div className="text-sm font-semibold text-slate-900">Change Requests</div>
                <div className="mt-1 text-xs text-slate-500">
                  Open the dedicated board to manage change control, approvals, and delivery impact.
                </div>
              </div>
            }
            subheader={
              <div className="flex justify-end">
                <Link
                  href={`/projects/${encodeURIComponent(projectId)}/change`}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition-colors hover:bg-slate-50"
                  prefetch={false}
                >
                  Open Change Control
                </Link>
              </div>
            }
          >
            <div className="text-sm text-slate-600">
              Use the dedicated board for operational change handling rather than the artifact surface.
            </div>
          </DocumentShell>

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
          <DocumentShell
            header={contentHeader}
            subheader={
              effectiveReadOnly ? (
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <Eye className="h-3.5 w-3.5" />
                  Readability is preserved in locked and approved states.
                </div>
              ) : null
            }
          >
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
             <div
  className="relative [&_*]:opacity-100 [&_*]:blur-0"
  style={{
    filter: "none",
    backdropFilter: "none",
  }}
>                {mode === "charter" ? (
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
                ) : mode === "change_requests" ? (
                  <ChangeManagementBoard
                    projectId={projectId}
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
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3 font-mono text-sm text-slate-900 whitespace-pre-wrap outline-none"
                    />
                  </div>
                )}
              </div>
            )}
          </DocumentShell>

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