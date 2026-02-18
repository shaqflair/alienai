"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* ---------------- types ---------------- */

type ChangeStatus = "new" | "analysis" | "review" | "in_progress" | "implemented" | "closed";
type ChangePriority = "Low" | "Medium" | "High" | "Critical";
type DeliveryLane = "intake" | "analysis" | "review" | "in_progress" | "implemented" | "closed";

/**
 * ? Approval UI (optional)
 * - Pass from parent (chain/current step/canApprove/delegate).
 * - Renders badge + progress bar + remaining + delegate indicator.
 */
export type ApprovalProgressInput = {
  canApprove?: boolean;

  currentStepIndex?: number; // 0-based
  totalSteps?: number;
  currentStepLabel?: string;

  remainingApprovers?: number;

  actingOnBehalfOf?: { name?: string; email?: string } | null;

  chainName?: string;
};

/* ---------------- utils ---------------- */

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampText(s: string, max: number): string {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function isValidPriority(p: string): p is ChangePriority {
  return p === "Low" || p === "Medium" || p === "High" || p === "Critical";
}

function isValidStatus(s: string): s is ChangeStatus {
  return (
    s === "new" ||
    s === "analysis" ||
    s === "review" ||
    s === "in_progress" ||
    s === "implemented" ||
    s === "closed"
  );
}

function normalizeStatus(raw: unknown): ChangeStatus {
  const v = safeStr(raw).trim().toLowerCase();
  if (isValidStatus(v)) return v;
  if (v === "in progress") return "in_progress";
  return "new";
}

function normalizePriority(raw: unknown): ChangePriority {
  const v = safeStr(raw).trim();
  if (isValidPriority(v)) return v;
  return "Medium";
}

function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

// ? map UI status -> DB delivery_status lane
function uiStatusToDeliveryLane(s: ChangeStatus): DeliveryLane {
  if (s === "new") return "intake";
  if (s === "analysis") return "analysis";
  if (s === "review") return "review";
  if (s === "in_progress") return "in_progress";
  if (s === "implemented") return "implemented";
  return "closed";
}

async function apiPost(url: string, body?: any): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) {
    throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  }
  return json;
}

async function apiPatch(url: string, body?: any): Promise<any> {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) {
    throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  }
  return json;
}

/* ---------------- AI types ---------------- */

type DraftAssistAi = {
  summary?: string;
  justification?: string;
  financial?: string;
  schedule?: string;
  risks?: string;

  dependencies?: string;
  assumptions?: string;

  implementation?: string;
  rollback?: string;

  impact?: { days: number; cost: number; risk: string };
};

type DraftAssistResp = {
  ok: true;
  model?: string;
  draftId?: string;
  ai?: DraftAssistAi;
};

type AiInterview = {
  about: string;
  why: string;
  impacted: string;
  when: string;
  constraints: string;
  costs: string;
  riskLevel: "Low" | "Medium" | "High";
  rollback: string;
};

/* ---------------- UI bits ---------------- */

function InlineAiButton({
  disabled,
  busy,
  onClick,
  title,
}: {
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || busy}
      title={title || "Apply AI suggestion"}
      className="absolute top-2 right-2 inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white text-xs font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
    >
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      {busy ? "Applying…" : "AI"}
    </button>
  );
}

function DrawerShell({
  open,
  title,
  subtitle,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-lg bg-white shadow-2xl border-l border-gray-200 flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50/50">
          <div>
            <div className="text-xs font-medium text-indigo-600 mb-1">{subtitle || "AI Assistant"}</div>
            <div className="text-lg font-semibold text-gray-900">{title}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function ApprovalHeaderBlock({ approval }: { approval?: ApprovalProgressInput | null }) {
  const a = approval || null;
  if (!a) return null;

  const totalSteps = Math.max(0, Number(a.totalSteps ?? 0) || 0);
  const currentIndex = Math.max(0, Number(a.currentStepIndex ?? 0) || 0);
  const stepNo = totalSteps > 0 ? Math.min(currentIndex + 1, totalSteps) : 0;
  const label = safeStr(a.currentStepLabel).trim();

  const pct = totalSteps > 0 ? Math.round((Math.min(stepNo, totalSteps) / totalSteps) * 100) : 0;

  const remaining = Math.max(0, Number(a.remainingApprovers ?? 0) || 0);
  const canApprove = a.canApprove !== false;

  const acting = a.actingOnBehalfOf || null;
  const actingName = safeStr(acting?.name).trim();
  const actingEmail = safeStr(acting?.email).trim();

  return (
    <div className="mt-3 rounded-xl border border-gray-200 bg-white">
      <div className="px-4 py-2 rounded-t-xl bg-gradient-to-r from-indigo-600 to-slate-900 text-white flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex items-center px-2 py-1 rounded-md bg-white/10 text-xs font-semibold">
            {totalSteps > 0 ? `Step ${stepNo} of ${totalSteps}` : "Approval"}
          </span>
          <span className="text-xs font-medium truncate">{label ? `— ${label}` : ""}</span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {remaining > 0 ? (
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-white/10 text-xs font-medium">
              {remaining} remaining
            </span>
          ) : (
            <span className="inline-flex items-center px-2 py-1 rounded-md bg-white/10 text-xs font-medium">
              Final step
            </span>
          )}

          {canApprove ? (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-500/20 text-xs font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" />
              You can approve
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-amber-500/20 text-xs font-semibold">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-300" />
              View only
            </span>
          )}
        </div>
      </div>

      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden border border-gray-200">
            <div className="h-full bg-indigo-600" style={{ width: `${pct}%` }} aria-label="Approval progress" />
          </div>
          <div className="text-xs font-medium text-gray-600 w-12 text-right">{pct}%</div>
        </div>

        {actingName || actingEmail ? (
          <div className="mt-2 text-xs text-gray-600">
            Acting on behalf of{" "}
            <span className="font-semibold text-gray-800">{actingName || actingEmail}</span>
            {actingName && actingEmail ? <span className="text-gray-500"> ({actingEmail})</span> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Main Modal ---------------- */

type ChangeFormValue = {
  title: string;
  requester: string;
  status: ChangeStatus;
  priority: ChangePriority;
  summary: string;

  justification: string;
  financial: string;
  schedule: string;
  risks: string;

  dependencies: string;
  assumptions: string;

  implementationPlan: string;
  rollbackPlan: string;

  aiImpact: { days: number; cost: number; risk: string };

  files: File[];
};

function statusLabel(s: ChangeStatus): string {
  if (s === "new") return "New";
  if (s === "analysis") return "Analysis";
  if (s === "review") return "Review";
  if (s === "in_progress") return "Implementation";
  if (s === "implemented") return "Implemented";
  return "Closed";
}

// ? crypto helper (prevents TS lib mismatch in some setups)
function newDraftId(): string {
  const c = (globalThis as any)?.crypto;
  const fn = c?.randomUUID;
  if (typeof fn === "function") return fn.call(c);
  return `d_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

export default function ChangeCreateModal({
  open,
  onClose,
  projectId,
  artifactId,
  initialStatus,
  initialPriority,

  mode = "create",
  changeId = null,
  initialValue,
  titleOverride,

  approval,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  artifactId?: string | null;
  initialStatus?: ChangeStatus;
  initialPriority?: ChangePriority;

  mode?: "create" | "edit";
  changeId?: string | null;
  initialValue?: Partial<ChangeFormValue> & Record<string, any>;
  titleOverride?: string;

  approval?: ApprovalProgressInput | null;
}) {
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ? project resolver state (uuid or project_code)
  const [resolvedProjectId, setResolvedProjectId] = useState<string>("");
  const [projResolveBusy, setProjResolveBusy] = useState(false);
  const [projResolveErr, setProjResolveErr] = useState("");

  // Core fields
  const [title, setTitle] = useState("");
  const [requester, setRequester] = useState("");
  const [status, setStatus] = useState<ChangeStatus>(initialStatus ?? "new");
  const [priority, setPriority] = useState<ChangePriority>(initialPriority ?? "Medium");
  const [summary, setSummary] = useState("");

  const [justification, setJustification] = useState("");
  const [financial, setFinancial] = useState("");
  const [schedule, setSchedule] = useState("");
  const [risks, setRisks] = useState("");

  const [dependencies, setDependencies] = useState("");
  const [assumptions, setAssumptions] = useState("");
  const [implementationPlan, setImplementationPlan] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");

  const [aiImpact, setAiImpact] = useState({ days: 0, cost: 0, risk: "None identified" });

  // Attachments state
  const [files, setFiles] = useState<File[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // AI state
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [drafts, setDrafts] = useState<DraftAssistAi | null>(null);
  const [draftModel, setDraftModel] = useState("rules-v1");

  const [aiInterviewOpen, setAiInterviewOpen] = useState(false);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [interview, setInterview] = useState<AiInterview>({
    about: "",
    why: "",
    impacted: "",
    when: "",
    constraints: "",
    costs: "",
    riskLevel: "Medium",
    rollback: "",
  });

  const isEdit = mode === "edit";
  const canApprove = approval?.canApprove !== false;

  // ? draftId must regenerate per open (safe across TS/libdom variants)
  const draftId = useMemo(() => newDraftId(), [open]);

  // ? resolve projectId (uuid or project_code) -> UUID
  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function resolveProject() {
      const raw = safeStr(projectId).trim();

      setProjResolveErr("");
      setResolvedProjectId("");

      if (!raw) {
        setProjResolveErr("Missing projectId.");
        return;
      }

      if (looksLikeUuid(raw)) {
        setResolvedProjectId(raw);
        return;
      }

      try {
        setProjResolveBusy(true);
        const res = await fetch(`/api/projects/${encodeURIComponent(raw)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) {
          throw new Error(safeStr(json?.error) || `HTTP ${res.status}`);
        }

        const uuid = safeStr(json?.project?.id || json?.data?.id || json?.item?.id).trim();
        if (!uuid || !looksLikeUuid(uuid)) {
          throw new Error("Project could not be resolved to a UUID. Check /api/projects/[id] supports project_code.");
        }

        if (!cancelled) setResolvedProjectId(uuid);
      } catch (e: any) {
        if (!cancelled) setProjResolveErr(safeStr(e?.message) || "Failed to resolve projectId.");
      } finally {
        if (!cancelled) setProjResolveBusy(false);
      }
    }

    resolveProject();
    return () => {
      cancelled = true;
    };
  }, [open, projectId]);

  const disabled = saving || projResolveBusy;

  // reset when opening (supports edit prefill)
  useEffect(() => {
    if (!open) return;

    setError("");
    setAiErr("");
    setDrafts(null);
    setDraftModel("rules-v1");

    setUploadBusy(false);
    setUploadErr("");
    setFiles([]);

    const iv: any = initialValue ?? {};

    // ? Accept both UI camelCase and DB snake_case when prefilling
    const merged: ChangeFormValue = {
      title: safeStr(iv.title ?? ""),
      requester: safeStr(iv.requester ?? iv.requester_name ?? ""),
      status: normalizeStatus(iv.status ?? iv.delivery_status ?? initialStatus ?? "new"),
      priority: normalizePriority(iv.priority ?? initialPriority ?? "Medium"),
      summary: safeStr(iv.summary ?? iv.description ?? ""),

      justification: safeStr(iv.justification ?? ""),
      financial: safeStr(iv.financial ?? ""),
      schedule: safeStr(iv.schedule ?? ""),
      risks: safeStr(iv.risks ?? ""),

      dependencies: safeStr(iv.dependencies ?? ""),
      assumptions: safeStr(iv.assumptions ?? ""),

      implementationPlan: safeStr(iv.implementationPlan ?? iv.implementation_plan ?? iv.implementation ?? ""),
      rollbackPlan: safeStr(iv.rollbackPlan ?? iv.rollback_plan ?? iv.rollback ?? ""),

      aiImpact: {
        days: Number(iv?.aiImpact?.days ?? iv?.impact_analysis?.days ?? 0) || 0,
        cost: Number(iv?.aiImpact?.cost ?? iv?.impact_analysis?.cost ?? 0) || 0,
        risk: safeStr(iv?.aiImpact?.risk ?? iv?.impact_analysis?.risk ?? "None identified") || "None identified",
      },

      files: [],
    };

    setTitle(merged.title);
    setRequester(merged.requester);
    setStatus(merged.status);
    setPriority(merged.priority);
    setSummary(merged.summary);

    setJustification(merged.justification);
    setFinancial(merged.financial);
    setSchedule(merged.schedule);
    setRisks(merged.risks);

    setDependencies(merged.dependencies);
    setAssumptions(merged.assumptions);
    setImplementationPlan(merged.implementationPlan);
    setRollbackPlan(merged.rollbackPlan);

    setAiImpact({
      days: Number(merged.aiImpact.days ?? 0) || 0,
      cost: Number(merged.aiImpact.cost ?? 0) || 0,
      risk: safeStr(merged.aiImpact.risk ?? "None identified") || "None identified",
    });

    setInterview({
      about: safeStr(merged.title),
      why: safeStr(merged.summary),
      impacted: merged.requester ? `Stakeholders/requester: ${merged.requester}. (Confirm impacted services/users)` : "",
      when: "",
      constraints: "",
      costs: "",
      riskLevel: "Medium",
      rollback: safeStr(merged.rollbackPlan),
    });

    setForceOverwrite(false);

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, initialStatus, initialPriority, initialValue]);

  /* ---------------- Attachments ---------------- */

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  async function uploadFilesToChange(changeUuid: string, picked?: File[]) {
    const pid = safeStr(resolvedProjectId).trim();
    const aId = safeStr(artifactId).trim();
    const list: File[] = (picked && picked.length ? picked : files) ?? [];
    if (!list.length) return;

    setUploadErr("");
    setUploadBusy(true);

    try {
      const url = `/api/change/${encodeURIComponent(changeUuid)}/attachments`;

      for (const file of list) {
        const formData = new FormData();
        formData.append("file", file);

        formData.append("filename", file.name);
        formData.append("content_type", file.type || "application/octet-stream");
        if (pid) formData.append("projectId", pid);
        if (aId) formData.append("artifactId", aId);

        const res = await fetch(url, { method: "POST", body: formData });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || (json as any)?.ok === false) {
          throw new Error(safeStr((json as any)?.error) || `Attachment upload failed (HTTP ${res.status})`);
        }
      }
    } catch (e: any) {
      setUploadErr(safeStr(e?.message) || "Failed to upload attachment(s)");
      throw e;
    } finally {
      setUploadBusy(false);
    }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const inputEl = e.currentTarget;
    const picked = Array.from(inputEl.files ?? []);
    if (!picked.length) return;

    setFiles((prev) => [...prev, ...picked]);

    const cid = safeStr(changeId).trim();
    if (cid) {
      try {
        await uploadFilesToChange(cid, picked);
      } catch {
        // uploadFilesToChange sets uploadErr
      }
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  async function removeUploadedAttachmentByFilename(filename: string) {
    const cid = safeStr(changeId).trim();
    if (!cid) return;

    const listUrl = `/api/change/${encodeURIComponent(cid)}/attachments`;
    const listedRes = await fetch(listUrl, { method: "GET" });
    const listedJson = await listedRes.json().catch(() => ({}));
    if (!listedRes.ok || (listedJson as any)?.ok === false) {
      throw new Error(safeStr((listedJson as any)?.error) || "Failed to load attachments");
    }

    const items: any[] = Array.isArray((listedJson as any)?.items) ? (listedJson as any).items : [];
    const match = items.find((x) => safeStr(x?.filename) === filename) || null;
    const path = safeStr(match?.path).trim();
    if (!path) throw new Error("Attachment path not found");

    const delUrl = `/api/change/${encodeURIComponent(cid)}/attachments?path=${encodeURIComponent(path)}`;

    const delRes = await fetch(delUrl, { method: "DELETE" });
    const delJson = await delRes.json().catch(() => ({}));
    if (!delRes.ok || (delJson as any)?.ok === false) {
      throw new Error(safeStr((delJson as any)?.error) || "Failed to delete attachment");
    }
  }

  /* ---------------- AI helpers ---------------- */

  function improveOrSetLocal(current: string, setter: (v: string) => void, suggestion: string, max = 8000) {
    const s = safeStr(suggestion).trim();
    if (!s) return;
    const cur = safeStr(current).trim();
    if (cur.length >= 50) {
      const merged = `${cur}\n\n—\nImproved draft:\n${s}`;
      setter(clampText(merged, max));
      return;
    }
    setter(clampText(s, max));
  }

  function hasInterviewSignal(): boolean {
    const ok = (x: string) => safeStr(x).trim().length >= 3;
    return ok(interview.about) || ok(interview.why) || ok(interview.impacted) || ok(interview.when);
  }

  function useCurrentDraftIntoInterview({ overwrite }: { overwrite: boolean }) {
    const mapIf = (current: string, next: string) => {
      if (overwrite) return next;
      return safeStr(current).trim() ? current : next;
    };

    setInterview((prev) => {
      const next = { ...prev };
      next.about = mapIf(next.about, safeStr(title).trim());
      next.why = mapIf(next.why, safeStr(summary).trim());
      next.impacted = mapIf(
        next.impacted,
        requester ? `Stakeholders/requester: ${requester}. (Confirm impacted services/users)` : ""
      );
      next.costs = mapIf(
        next.costs,
        [
          aiImpact.cost > 0 ? `£${aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "",
          aiImpact.days > 0 ? `${aiImpact.days} day(s)` : "",
        ]
          .filter(Boolean)
          .join(" / ")
      );
      next.rollback = mapIf(next.rollback, safeStr(rollbackPlan).trim());
      return next;
    });
  }

  async function runPmoDraftAssist(): Promise<DraftAssistAi | null> {
    const pid = safeStr(resolvedProjectId).trim();
    if (!pid) {
      setAiErr(projResolveErr || "Missing projectId.");
      return null;
    }

    setAiErr("");
    setAiBusy(true);
    try {
      const payload = {
        draftId,
        mode,
        title: safeStr(title),
        summary: safeStr(summary),
        priority: safeStr(priority),
        status: safeStr(status),
        requester: safeStr(requester),
        justification: safeStr(justification),
        financial: safeStr(financial),
        schedule: safeStr(schedule),
        risks: safeStr(risks),

        dependencies: safeStr(dependencies),
        assumptions: safeStr(assumptions),
        implementation: safeStr(implementationPlan),
        rollback: safeStr(rollbackPlan),

        interview,
      };

      const j = (await apiPost("/api/ai/events", {
        projectId: pid,
        artifactId: safeStr(artifactId).trim() || null,
        eventType: "change_draft_assist_requested",
        severity: "info",
        source: isEdit ? "change_edit_modal" : "change_create_modal",
        payload,
      })) as DraftAssistResp;

      const ai = (j && typeof j === "object" ? (j as any).ai : null) || null;
      setDrafts(ai);
      setDraftModel(safeStr((j as any)?.model) || "rules-v1");
      return ai;
    } catch (e: any) {
      setAiErr(safeStr(e?.message) || "AI draft failed");
      setDrafts(null);
      return null;
    } finally {
      setAiBusy(false);
    }
  }

  async function ensureDrafts() {
    if (drafts) return drafts;
    if (!hasInterviewSignal()) {
      setAiInterviewOpen(true);
      setAiErr("Tell AI what the change is about (Start AI) to generate accurate drafts.");
      return null;
    }
    return runPmoDraftAssist();
  }

  async function applyAllAi() {
    const d = await ensureDrafts();
    if (!d) return;

    improveOrSetLocal(summary, setSummary, safeStr(d.summary), 1200);
    improveOrSetLocal(justification, setJustification, safeStr(d.justification));
    improveOrSetLocal(financial, setFinancial, safeStr(d.financial));
    improveOrSetLocal(schedule, setSchedule, safeStr(d.schedule));
    improveOrSetLocal(risks, setRisks, safeStr(d.risks));

    improveOrSetLocal(dependencies, setDependencies, safeStr(d.dependencies));
    improveOrSetLocal(assumptions, setAssumptions, safeStr(d.assumptions));
    improveOrSetLocal(implementationPlan, setImplementationPlan, safeStr(d.implementation));
    improveOrSetLocal(rollbackPlan, setRollbackPlan, safeStr(d.rollback));

    const imp = (d as any)?.impact;
    if (imp) {
      setAiImpact({
        days: Number(imp?.days ?? 0) || 0,
        cost: Number(imp?.cost ?? 0) || 0,
        risk: safeStr(imp?.risk ?? "").trim() || "None identified",
      });
    }
  }

  async function runAiImpactScan() {
    const d = await ensureDrafts();
    if (!d) return;
    const imp = (d as any)?.impact;
    if (!imp) {
      setAiErr("AI returned no impact suggestion.");
      return;
    }
    setAiImpact({
      days: Number(imp?.days ?? 0) || 0,
      cost: Number(imp?.cost ?? 0) || 0,
      risk: safeStr(imp?.risk ?? "").trim() || "None identified",
    });
  }

  /* ---------------- Fire “saved/created” AI events (after success) ---------------- */

  async function fireAiAfterSuccess(args: {
    projectId: string;
    changeId: string;
    eventType: "change_created" | "change_saved";
    action: "created" | "updated";
  }) {
    try {
      await fetch("/api/ai/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: args.projectId,
          artifactId: args.changeId,
          eventType: args.eventType,
          severity: "info",
          source: isEdit ? "change_edit_modal" : "change_create_modal",
          payload: {
            target_artifact_type: "change_request",
            change_id: args.changeId,
            action: args.action,
          },
        }),
      }).catch(() => null);
    } catch {
      // swallow (never block UX on AI)
    }
  }

  /* ---------------- Save/Create ---------------- */

  async function submitChange() {
    setError("");
    setUploadErr("");

    const pid = safeStr(resolvedProjectId).trim();
    if (!pid) return setError(projResolveErr || "Missing projectId.");

    const t = clampText(safeStr(title).trim(), 160);
    if (!t) return setError("Title is required.");

    const s = clampText(safeStr(summary).trim(), 1200);
    if (!s) return setError("Summary is required.");

    if (mode === "edit" && !safeStr(changeId).trim()) {
      return setError("Missing changeId for edit.");
    }

    setSaving(true);
    try {
      const impact_analysis = {
        days: Number(aiImpact.days ?? 0) || 0,
        cost: Number(aiImpact.cost ?? 0) || 0,
        risk: clampText(safeStr(aiImpact.risk ?? "None identified"), 280),
        highlights: [],
      };

      // ? Clean PMO-friendly template (helps export parsing too)
      const proposed_change = clampText(
        [
          justification ? `Justification:\n${justification}` : "",
          financial ? `Financial:\n${financial}` : "",
          schedule ? `Schedule:\n${schedule}` : "",
          risks ? `Risks:\n${risks}` : "",
          dependencies ? `Dependencies:\n${dependencies}` : "",
          assumptions ? `Assumptions:\n${assumptions}` : "",
          implementationPlan ? `Implementation Plan:\n${implementationPlan}` : "",
          rollbackPlan ? `Rollback Plan:\n${rollbackPlan}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        8000
      );

      const delivery_status = uiStatusToDeliveryLane(status);

      const payload: any = {
        project_id: pid,
        artifact_id: safeStr(artifactId).trim() || null,

        title: t,
        description: s,

        requester_name: safeStr(requester).trim() || "Unknown requester",
        priority: normalizePriority(priority),
        tags: [],

        proposed_change,
        impact_analysis,

        justification,
        financial,
        schedule,
        risks,
        dependencies,
        assumptions,

        // ? send both variants (route accepts both)
        implementationPlan: safeStr(implementationPlan),
        rollbackPlan: safeStr(rollbackPlan),

        implementation_plan: safeStr(implementationPlan),
        rollback_plan: safeStr(rollbackPlan),
      };

      // Only include delivery_status on create
      if (!isEdit) payload.delivery_status = delivery_status;

      if (isEdit) {
        const cid = String(changeId);

        await apiPatch(`/api/change/${encodeURIComponent(cid)}`, payload);

        if (files.length) {
          await uploadFilesToChange(cid);
        }

        await fireAiAfterSuccess({ projectId: pid, changeId: cid, eventType: "change_saved", action: "updated" });

        onClose();
        router.refresh();
        return;
      }

      const j = await apiPost("/api/change", payload);

      const newId = safeStr((j as any)?.item?.id || (j as any)?.id || (j as any)?.data?.id).trim();
      if (!newId) throw new Error("Create succeeded but no id returned");

      if (files.length) {
        await uploadFilesToChange(newId);
      }

      await fireAiAfterSuccess({ projectId: pid, changeId: newId, eventType: "change_created", action: "created" });

      onClose();
      router.replace(`/projects/${projectId}/change/${newId}`);
      router.refresh();
    } catch (e: any) {
      setError(safeStr(e?.message) || (isEdit ? "Save failed" : "Create failed"));
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl max-h-[90vh] bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden flex flex-col">
          {/* Header */}
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/50 shrink-0">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="text-lg font-semibold text-gray-900">
                  {titleOverride || (isEdit ? "Edit Change Request" : "New Change Request")}
                </div>
                <div className="text-sm text-gray-500">
                  {isEdit ? "Update the change request with AI assistance." : "Create a complete change request with AI assistance."}
                </div>

                {projResolveBusy ? (
                  <div className="mt-1 text-xs text-amber-700">Resolving project…</div>
                ) : projResolveErr ? (
                  <div className="mt-1 text-xs text-rose-700">{projResolveErr}</div>
                ) : null}
              </div>

              {/* Header actions = AI only */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    useCurrentDraftIntoInterview({ overwrite: false });
                    setAiInterviewOpen(true);
                  }}
                  disabled={disabled || aiBusy}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Start AI
                </button>

                <button
                  type="button"
                  onClick={applyAllAi}
                  disabled={disabled || aiBusy}
                  className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                >
                  {aiBusy ? "Applying…" : "Apply All"}
                </button>
              </div>
            </div>

            <ApprovalHeaderBlock approval={approval} />
          </div>

          {(error || aiErr || uploadErr) && (
            <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700 shrink-0">
              {error || aiErr || uploadErr}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column */}
              <div className="lg:col-span-2 space-y-6">
                {/* Summary Section */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Change Summary</h2>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Title <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        placeholder="e.g., Extend firewall scope for vendor access"
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Requester</label>
                        <input
                          type="text"
                          value={requester}
                          onChange={(e) => setRequester(e.target.value)}
                          placeholder="Name"
                          disabled={disabled}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                        />
                      </div>

                      <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>

                        {isEdit ? (
                          <div className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-700 flex items-center justify-between">
                            <span className="font-medium">{statusLabel(status)}</span>
                            <span className="text-xs text-gray-500">Governed</span>
                          </div>
                        ) : (
                          <select
                            value={status}
                            onChange={(e) => setStatus(normalizeStatus(e.target.value))}
                            disabled={disabled}
                            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                          >
                            <option value="new">New</option>
                            <option value="analysis">Analysis</option>
                            <option value="review">Review</option>
                            <option value="in_progress">Implementation</option>
                            <option value="implemented">Implemented</option>
                            <option value="closed">Closed</option>
                          </select>
                        )}

                        {isEdit ? (
                          <p className="mt-1 text-xs text-gray-500">
                            Status/lane changes happen on the board (or Submit/Approve/Reject routes).
                          </p>
                        ) : null}
                      </div>

                      <div className="sm:col-span-1">
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Priority <span className="text-rose-500">*</span>
                        </label>
                        <select
                          value={priority}
                          onChange={(e) => setPriority(normalizePriority(e.target.value))}
                          disabled={disabled}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                        >
                          <option value="Low">Low</option>
                          <option value="Medium">Medium</option>
                          <option value="High">High</option>
                          <option value="Critical">Critical</option>
                        </select>
                      </div>
                    </div>

                    <div className="relative">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Summary <span className="text-rose-500">*</span>
                      </label>
                      <textarea
                        value={summary}
                        onChange={(e) => setSummary(e.target.value)}
                        rows={4}
                        placeholder="2–3 line summary for quick scanning..."
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(summary, setSummary, safeStr(d.summary), 1200);
                        }}
                        title="AI: write/improve summary"
                      />
                    </div>
                  </div>
                </div>

                {/* Business Justification */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Business Justification</h2>
                  <div className="relative">
                    <textarea
                      value={justification}
                      onChange={(e) => setJustification(e.target.value)}
                      rows={4}
                      placeholder="Why is this change needed? What value does it unlock?"
                      disabled={disabled}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                    />
                    <InlineAiButton
                      disabled={disabled}
                      busy={aiBusy}
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSetLocal(justification, setJustification, safeStr(d.justification));
                      }}
                      title="AI: draft justification"
                    />
                  </div>
                </div>

                {/* Financial & Schedule */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Financial Impact</h2>
                    <div className="relative">
                      <textarea
                        value={financial}
                        onChange={(e) => setFinancial(e.target.value)}
                        rows={4}
                        placeholder="Cost drivers, budget impact, commercial notes..."
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(financial, setFinancial, safeStr(d.financial));
                        }}
                        title="AI: draft financials"
                      />
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule Impact</h2>
                    <div className="relative">
                      <textarea
                        value={schedule}
                        onChange={(e) => setSchedule(e.target.value)}
                        rows={4}
                        placeholder="Milestone impacts, critical path changes, sequencing..."
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(schedule, setSchedule, safeStr(d.schedule));
                        }}
                        title="AI: draft schedule impact"
                      />
                    </div>
                  </div>
                </div>

                {/* Risks */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Risks</h2>
                  <div className="relative">
                    <textarea
                      value={risks}
                      onChange={(e) => setRisks(e.target.value)}
                      rows={4}
                      placeholder="Top risks and mitigations..."
                      disabled={disabled}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                    />
                    <InlineAiButton
                      disabled={disabled}
                      busy={aiBusy}
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSetLocal(risks, setRisks, safeStr(d.risks));
                      }}
                      title="AI: draft risks"
                    />
                  </div>
                </div>

                {/* Dependencies */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Dependencies</h2>
                  <div className="relative">
                    <textarea
                      value={dependencies}
                      onChange={(e) => setDependencies(e.target.value)}
                      rows={4}
                      placeholder="Other teams, approvals, suppliers, environments, releases, third parties…"
                      disabled={disabled}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                    />
                    <InlineAiButton
                      disabled={disabled}
                      busy={aiBusy}
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSetLocal(dependencies, setDependencies, safeStr(d.dependencies));
                      }}
                      title="AI: draft dependencies"
                    />
                  </div>
                </div>

                {/* Assumptions */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Assumptions</h2>
                  <div className="relative">
                    <textarea
                      value={assumptions}
                      onChange={(e) => setAssumptions(e.target.value)}
                      rows={4}
                      placeholder="Key assumptions underpinning the change (e.g., access approvals, vendor availability, environment readiness)…"
                      disabled={disabled}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                    />
                    <InlineAiButton
                      disabled={disabled}
                      busy={aiBusy}
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSetLocal(assumptions, setAssumptions, safeStr(d.assumptions));
                      }}
                      title="AI: draft assumptions"
                    />
                  </div>
                </div>

                {/* Implementation & Rollback */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Implementation Plan</h2>
                    <div className="relative">
                      <textarea
                        value={implementationPlan}
                        onChange={(e) => setImplementationPlan(e.target.value)}
                        rows={6}
                        placeholder="Outline steps, approach, owners, sequence, and validation checkpoints…"
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(implementationPlan, setImplementationPlan, safeStr(d.implementation));
                        }}
                        title="AI: draft implementation plan"
                      />
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Rollback Plan</h2>
                    <div className="relative">
                      <textarea
                        value={rollbackPlan}
                        onChange={(e) => setRollbackPlan(e.target.value)}
                        rows={6}
                        placeholder="Backout steps, restore points, success criteria, and how you’ll confirm rollback is complete…"
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(rollbackPlan, setRollbackPlan, safeStr(d.rollback));
                        }}
                        title="AI: draft rollback plan"
                      />
                    </div>
                  </div>
                </div>

                {/* Attachments */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold text-gray-900">Attachments</h2>
                    <span className="text-sm text-gray-500">{files.length} file(s)</span>
                  </div>

                  {!safeStr(changeId).trim() ? (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600 mb-4">
                      Save this change request to enable attachments upload.
                    </div>
                  ) : null}

                  <div className="space-y-4">
                    <div
                      className={`border-2 border-dashed border-gray-300 rounded-lg p-6 text-center bg-gray-50 hover:bg-gray-100 transition-colors ${
                        disabled ? "opacity-50 pointer-events-none" : ""
                      }`}
                    >
                      <div className="text-3xl mb-2">??</div>
                      <p className="text-sm text-gray-600 mb-2">Drop files here or click to browse</p>

                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        onChange={handleFileSelect}
                        className="hidden"
                        id="create-file-upload"
                        disabled={disabled}
                      />

                      <label
                        htmlFor="create-file-upload"
                        className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-lg cursor-pointer hover:bg-indigo-700 text-sm font-medium"
                      >
                        {uploadBusy ? "Uploading…" : "Choose Files"}
                      </label>

                      {uploadBusy ? <div className="mt-3 text-xs text-gray-500">Uploading…</div> : null}
                    </div>

                    {files.length > 0 && (
                      <div className="space-y-2">
                        <div className="max-h-48 overflow-y-auto space-y-2 border border-gray-200 rounded-lg p-3 bg-gray-50">
                          {files.map((file, idx) => (
                            <div
                              key={`${file.name}-${file.size}-${idx}`}
                              className="flex items-center justify-between p-3 bg-white rounded-lg border border-gray-200 shadow-sm"
                            >
                              <div className="flex items-center gap-3 overflow-hidden flex-1">
                                <span className="text-xl shrink-0">??</span>
                                <div className="truncate">
                                  <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
                                  <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 shrink-0">
                                <button
                                  type="button"
                                  onClick={() => removeFile(idx)}
                                  disabled={disabled}
                                  className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
                                  title="Remove from list"
                                >
                                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                    />
                                  </svg>
                                </button>

                                {safeStr(changeId).trim() ? (
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      try {
                                        setUploadErr("");
                                        setUploadBusy(true);
                                        await removeUploadedAttachmentByFilename(file.name);
                                        removeFile(idx);
                                      } catch (e: any) {
                                        setUploadErr(safeStr(e?.message) || "Failed to remove attachment");
                                      } finally {
                                        setUploadBusy(false);
                                      }
                                    }}
                                    disabled={disabled || uploadBusy}
                                    className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
                                    title="Remove from server"
                                  >
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>

                        <button
                          type="button"
                          onClick={() => setFiles([])}
                          disabled={disabled}
                          className="text-sm text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                        >
                          Remove all files
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column */}
              <div className="lg:col-span-1">
                <div className="sticky top-0 space-y-6">
                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="text-lg font-semibold text-gray-900">Estimated Impact</h3>
                      <button
                        type="button"
                        onClick={runAiImpactScan}
                        disabled={aiBusy || disabled}
                        className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-lg hover:bg-indigo-100 disabled:opacity-50 transition-colors"
                      >
                        {aiBusy ? "Scanning…" : "?? AI Scan"}
                      </button>
                    </div>

                    <div className="space-y-4">
                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Estimated Delay</label>
                        <div className="flex items-baseline gap-2">
                          <input
                            type="number"
                            min={0}
                            value={aiImpact.days}
                            onChange={(e) => setAiImpact({ ...aiImpact, days: parseInt(e.target.value, 10) || 0 })}
                            disabled={disabled}
                            className="w-20 px-2 py-1 bg-white border border-gray-300 rounded text-lg font-bold text-gray-900 text-center focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                          <span className="text-sm text-gray-600">days</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Schedule impact</p>
                      </div>

                      <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                        <label className="block text-xs font-medium text-gray-600 mb-1">Estimated Cost</label>
                        <div className="flex items-baseline gap-2">
                          <span className="text-lg font-bold text-gray-900">£</span>
                          <input
                            type="number"
                            min={0}
                            step="1000"
                            value={aiImpact.cost}
                            onChange={(e) => setAiImpact({ ...aiImpact, cost: parseInt(e.target.value, 10) || 0 })}
                            disabled={disabled}
                            className="flex-1 px-2 py-1 bg-white border border-gray-300 rounded text-lg font-bold text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                          />
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Budget impact</p>
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Risk Summary</label>
                        <textarea
                          value={aiImpact.risk}
                          onChange={(e) => setAiImpact({ ...aiImpact, risk: e.target.value })}
                          rows={3}
                          placeholder="None identified"
                          disabled={disabled}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                        />
                      </div>
                    </div>
                  </div>

                  {drafts ? (
                    <div className="text-xs text-gray-500 border border-gray-200 rounded-xl p-4 bg-gray-50">
                      AI model: <span className="font-medium text-gray-700">{draftModel}</span>
                    </div>
                  ) : null}

                  {approval ? (
                    <div className="text-xs text-gray-600 border border-gray-200 rounded-xl p-4 bg-white">
                      <div className="font-semibold text-gray-900 mb-1">Approval controls</div>
                      <div>
                        Approve/Reject should be{" "}
                        <span className="font-semibold">{canApprove ? "enabled" : "disabled"}</span> based on{" "}
                        <span className="font-mono">canApprove</span>.
                      </div>
                      {!canApprove ? (
                        <div className="mt-1 text-gray-500">You can still view and edit draft fields (if permitted).</div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          {/* Sticky footer actions */}
          <div className="sticky bottom-0 z-20 border-t border-gray-200 bg-white/90 backdrop-blur px-6 py-4 shrink-0">
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={disabled}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg border border-gray-300 bg-white text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={submitChange}
                disabled={disabled || saving}
                className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-indigo-600 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {isEdit ? (saving ? "Saving…" : "Save Changes") : saving ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Start AI Drawer */}
      <DrawerShell open={aiInterviewOpen} title="Start AI" subtitle="PMO Draft Assistant" onClose={() => setAiInterviewOpen(false)}>
        <div className="space-y-6">
          <p className="text-sm text-gray-600">Answer a few questions. AI will draft each field in a clean PMO style.</p>

          <div className="flex flex-wrap items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
            <button
              type="button"
              onClick={() => useCurrentDraftIntoInterview({ overwrite: forceOverwrite })}
              disabled={aiBusy}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
            >
              Use my current draft
            </button>

            <label className="ml-auto flex items-center gap-2 text-xs text-gray-600 select-none">
              <input type="checkbox" checked={forceOverwrite} onChange={(e) => setForceOverwrite(e.target.checked)} disabled={aiBusy} />
              Overwrite existing answers
            </label>
          </div>

          {aiErr ? <div className="p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">{aiErr}</div> : null}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">What is the change about?</label>
              <textarea
                value={interview.about}
                onChange={(e) => setInterview((p) => ({ ...p, about: e.target.value }))}
                rows={3}
                disabled={aiBusy}
                placeholder="e.g., Extend firewall scope for vendor access on SZC workstream…"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Why is it needed / what value does it unlock?</label>
              <textarea
                value={interview.why}
                onChange={(e) => setInterview((p) => ({ ...p, why: e.target.value }))}
                rows={3}
                disabled={aiBusy}
                placeholder="Drivers, benefits, risk reduction, compliance, customer impact…"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-y"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Who / what is impacted?</label>
              <textarea
                value={interview.impacted}
                onChange={(e) => setInterview((p) => ({ ...p, impacted: e.target.value }))}
                rows={3}
                disabled={aiBusy}
                placeholder="Systems, services, users, suppliers, environments…"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-y"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">When does it need to happen?</label>
                <textarea
                  value={interview.when}
                  onChange={(e) => setInterview((p) => ({ ...p, when: e.target.value }))}
                  rows={3}
                  disabled={aiBusy}
                  placeholder="Target window, milestones, blackout dates…"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-y"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Constraints / assumptions</label>
                <textarea
                  value={interview.constraints}
                  onChange={(e) => setInterview((p) => ({ ...p, constraints: e.target.value }))}
                  rows={3}
                  disabled={aiBusy}
                  placeholder="Access, approvals, resourcing, dependencies, outage limits…"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-y"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Costs (if known)</label>
                <input
                  value={interview.costs}
                  onChange={(e) => setInterview((p) => ({ ...p, costs: e.target.value }))}
                  disabled={aiBusy}
                  placeholder="e.g., £12,000 / 3 days / vendor day-rate…"
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Risk level (your view)</label>
                <select
                  value={interview.riskLevel}
                  onChange={(e) => setInterview((p) => ({ ...p, riskLevel: e.target.value as any }))}
                  disabled={aiBusy}
                  className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                >
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Rollback / backout approach</label>
              <textarea
                value={interview.rollback}
                onChange={(e) => setInterview((p) => ({ ...p, rollback: e.target.value }))}
                rows={3}
                disabled={aiBusy}
                placeholder="How would you revert safely / validate success?"
                className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50 resize-y"
              />
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={() => setAiInterviewOpen(false)}
              disabled={aiBusy}
              className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              Close
            </button>

            <button
              type="button"
              onClick={async () => {
                const d = await runPmoDraftAssist();
                if (d) setAiInterviewOpen(false);
              }}
              disabled={aiBusy || disabled}
              className="px-3 py-2 text-sm font-medium text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50 shadow-sm"
            >
              {aiBusy ? "Generating…" : "Generate drafts"}
            </button>
          </div>
        </div>
      </DrawerShell>
    </>
  );
}
