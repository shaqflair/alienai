// ChangeForm.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";

/* ---------------- types ---------------- */

export type ChangeStatus = "new" | "analysis" | "review" | "in_progress" | "implemented" | "closed";
export type ChangePriority = "Low" | "Medium" | "High" | "Critical";
export type DeliveryLane = "intake" | "analysis" | "review" | "in_progress" | "implemented" | "closed";

export type DraftAssistAi = {
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

export type ChangeFormValue = {
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

export type ChangeFormMode = "create" | "edit";

export type ChangeFormProps = {
  mode: ChangeFormMode;
  open: boolean;
  titleText: string;
  subtitleText?: string;

  /**
   * Can be UUID or project_code (human id).
   * We resolve to UUID automatically (same behaviour as your ChangeCreateModal).
   */
  projectId: string;
  artifactId?: string | null;

  initialValue?: Partial<ChangeFormValue>;

  onSubmit: (payload: {
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
    proposed_change: string;
    impact_analysis: any;
    delivery_status?: DeliveryLane;

    files: File[];
  }) => Promise<void>;

  onClose: () => void;
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
  return s === "new" || s === "analysis" || s === "review" || s === "in_progress" || s === "implemented" || s === "closed";
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

// UI status -> DB delivery_status lane
export function uiStatusToDeliveryLane(s: ChangeStatus): DeliveryLane {
  if (s === "new") return "intake";
  if (s === "analysis") return "analysis";
  if (s === "review") return "review";
  if (s === "in_progress") return "in_progress";
  if (s === "implemented") return "implemented";
  return "closed";
}

// ? crypto helper (prevents TS lib mismatch in some setups)
function newDraftId(): string {
  const c = (globalThis as any)?.crypto;
  const fn = c?.randomUUID;
  if (typeof fn === "function") return fn.call(c);
  return `d_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

async function apiPost(url: string, body?: any) {
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
          <button onClick={onClose} className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
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

/* ---------------- form ---------------- */

const DEFAULTS: ChangeFormValue = {
  title: "",
  requester: "",
  status: "new",
  priority: "Medium",
  summary: "",

  justification: "",
  financial: "",
  schedule: "",
  risks: "",
  dependencies: "",

  assumptions: "",
  implementationPlan: "",
  rollbackPlan: "",

  aiImpact: { days: 0, cost: 0, risk: "None identified" },
  files: [],
};

export default function ChangeForm(props: ChangeFormProps) {
  const { mode, open, titleText, subtitleText, projectId, artifactId, initialValue, onSubmit, onClose } = props;

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // ? project resolver state (uuid or project_code) -> UUID
  const [resolvedProjectId, setResolvedProjectId] = useState<string>("");
  const [projResolveBusy, setProjResolveBusy] = useState(false);
  const [projResolveErr, setProjResolveErr] = useState("");

  // form value
  const [v, setV] = useState<ChangeFormValue>(DEFAULTS);

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

  const disabled = saving || projResolveBusy;

  // regenerate a draftId each time modal opens
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

  // reset on open
  useEffect(() => {
    if (!open) return;

    setSaving(false);
    setError("");
    setAiErr("");
    setDrafts(null);
    setDraftModel("rules-v1");
    setForceOverwrite(false);

    const merged: ChangeFormValue = {
      ...DEFAULTS,
      ...(initialValue ?? {}),
      status: normalizeStatus((initialValue as any)?.status ?? DEFAULTS.status),
      priority: normalizePriority((initialValue as any)?.priority ?? DEFAULTS.priority),
      aiImpact: {
        days: Number((initialValue as any)?.aiImpact?.days ?? DEFAULTS.aiImpact.days) || 0,
        cost: Number((initialValue as any)?.aiImpact?.cost ?? DEFAULTS.aiImpact.cost) || 0,
        risk: safeStr((initialValue as any)?.aiImpact?.risk ?? DEFAULTS.aiImpact.risk) || "None identified",
      },
      files: [],
    };

    setV(merged);

    // seed interview from existing values (helps PMs in edit mode)
    setInterview({
      about: safeStr(merged.title),
      why: safeStr(merged.summary),
      impacted: merged.requester ? `Stakeholders/requester: ${merged.requester}. (Confirm impacted services/users)` : "",
      when: "",
      constraints: "",
      costs: [
        merged.aiImpact.cost > 0 ? `£${merged.aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "",
        merged.aiImpact.days > 0 ? `${merged.aiImpact.days} day(s)` : "",
      ]
        .filter(Boolean)
        .join(" / "),
      riskLevel: "Medium",
      rollback: safeStr(merged.rollbackPlan),
    });
  }, [open, initialValue]);

  // file handling
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const next = Array.from(e.target.files || []);
      setV((p) => ({ ...p, files: [...p.files, ...next] }));
    }
  };

  const removeFile = (index: number) => {
    setV((p) => ({ ...p, files: p.files.filter((_, i) => i !== index) }));
  };

  function improveOrSetLocal(current: string, setter: (val: string) => void, suggestion: string, max = 8000) {
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

  function hasInterviewSignal() {
    const ok = (x: string) => safeStr(x).trim().length >= 3;
    return ok(interview.about) || ok(interview.why) || ok(interview.impacted) || ok(interview.when);
  }

  function useCurrentDraftIntoInterview({ overwrite }: { overwrite: boolean }) {
    const mapIf = (current: string, next: string) => (overwrite ? next : safeStr(current).trim() ? current : next);

    setInterview((prev) => {
      const next = { ...prev };
      next.about = mapIf(next.about, safeStr(v.title).trim());
      next.why = mapIf(next.why, safeStr(v.summary).trim());
      next.impacted = mapIf(
        next.impacted,
        v.requester ? `Stakeholders/requester: ${v.requester}. (Confirm impacted services/users)` : ""
      );
      next.costs = mapIf(
        next.costs,
        [
          v.aiImpact.cost > 0 ? `£${v.aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "",
          v.aiImpact.days > 0 ? `${v.aiImpact.days} day(s)` : "",
        ]
          .filter(Boolean)
          .join(" / ")
      );
      next.rollback = mapIf(next.rollback, safeStr(v.rollbackPlan).trim());
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
        title: safeStr(v.title),
        summary: safeStr(v.summary),
        priority: safeStr(v.priority),
        status: safeStr(v.status),
        requester: safeStr(v.requester),

        justification: safeStr(v.justification),
        financial: safeStr(v.financial),
        schedule: safeStr(v.schedule),
        risks: safeStr(v.risks),
        dependencies: safeStr(v.dependencies),
        assumptions: safeStr(v.assumptions),
        implementation: safeStr(v.implementationPlan),
        rollback: safeStr(v.rollbackPlan),

        interview,
      };

      const j = (await apiPost("/api/ai/events", {
        projectId: pid,
        artifactId: artifactId ?? null,
        eventType: "change_draft_assist_requested",
        severity: "info",
        source: mode === "edit" ? "change_edit_form" : "change_create_form",
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

    setV((p) => {
      const next = { ...p };

      const setText = (key: keyof ChangeFormValue, suggestion?: string, max = 8000) => {
        const cur = safeStr((next as any)[key]);
        const s = safeStr(suggestion);
        if (!s.trim()) return;
        const merged = cur.trim().length >= 50 ? `${cur}\n\n—\nImproved draft:\n${s}` : s;
        (next as any)[key] = clampText(merged, max);
      };

      setText("summary", d.summary, 1200);
      setText("justification", d.justification);
      setText("financial", d.financial);
      setText("schedule", d.schedule);
      setText("risks", d.risks);
      setText("dependencies", d.dependencies);
      setText("assumptions", (d as any).assumptions);
      setText("implementationPlan", (d as any).implementation);
      setText("rollbackPlan", (d as any).rollback);

      const imp = (d as any)?.impact;
      if (imp) {
        next.aiImpact = {
          days: Number(imp?.days ?? 0) || 0,
          cost: Number(imp?.cost ?? 0) || 0,
          risk: safeStr(imp?.risk ?? "").trim() || "None identified",
        };
      }

      return next;
    });
  }

  async function submit() {
    setError("");

    const pid = safeStr(resolvedProjectId).trim();
    if (!pid) return setError(projResolveErr || "Missing projectId.");

    const t = clampText(safeStr(v.title).trim(), 160);
    if (!t) return setError("Title is required.");

    const s = clampText(safeStr(v.summary).trim(), 1200);
    if (!s) return setError("Summary is required.");

    setSaving(true);
    try {
      const impact_analysis = {
        days: Number(v.aiImpact.days ?? 0) || 0,
        cost: Number(v.aiImpact.cost ?? 0) || 0,
        risk: clampText(safeStr(v.aiImpact.risk ?? "None identified"), 280),
        highlights: [],
      };

      const proposed_change = clampText(
        [
          v.justification ? `Justification:\n${v.justification}` : "",
          v.financial ? `Financial:\n${v.financial}` : "",
          v.schedule ? `Schedule:\n${v.schedule}` : "",
          v.risks ? `Risks:\n${v.risks}` : "",
          v.dependencies ? `Dependencies:\n${v.dependencies}` : "",
          v.assumptions ? `Assumptions:\n${v.assumptions}` : "",
          v.implementationPlan ? `Implementation Plan:\n${v.implementationPlan}` : "",
          v.rollbackPlan ? `Rollback / Validation:\n${v.rollbackPlan}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        8000
      );

      const submitPayload: any = {
        title: t,
        requester: safeStr(v.requester).trim(),
        status: v.status,
        priority: normalizePriority(v.priority),
        summary: s,

        justification: v.justification,
        financial: v.financial,
        schedule: v.schedule,
        risks: v.risks,
        dependencies: v.dependencies,

        assumptions: v.assumptions,
        implementationPlan: v.implementationPlan,
        rollbackPlan: v.rollbackPlan,

        aiImpact: v.aiImpact,
        proposed_change,
        impact_analysis,

        files: v.files,
      };

      // Only set lane on CREATE (edit is governed by board/submit/approve routes)
      if (mode === "create") {
        submitPayload.delivery_status = uiStatusToDeliveryLane(v.status);
      }

      await onSubmit(submitPayload);
      onClose();
    } catch (e: any) {
      setError(safeStr(e?.message) || "Save failed.");
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
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between shrink-0">
            <div>
              <div className="text-lg font-semibold text-gray-900">{titleText}</div>
              <div className="text-sm text-gray-500">
                {subtitleText ||
                  (mode === "edit"
                    ? "Update the change request with AI assistance."
                    : "Create a complete change request with AI assistance.")}
              </div>

              {projResolveBusy ? (
                <div className="mt-1 text-xs text-amber-700">Resolving project…</div>
              ) : projResolveErr ? (
                <div className="mt-1 text-xs text-rose-700">{projResolveErr}</div>
              ) : null}

              {drafts ? <div className="mt-1 text-[11px] text-gray-500">AI model: {draftModel}</div> : null}
            </div>

            <div className="flex items-center gap-2">
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

              <button
                type="button"
                onClick={onClose}
                disabled={disabled}
                className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Close
              </button>

              <button
                type="button"
                onClick={submit}
                disabled={disabled}
                className="px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {saving ? (mode === "edit" ? "Saving…" : "Creating…") : mode === "edit" ? "Save Changes" : "Create Request"}
              </button>
            </div>
          </div>

          {(error || aiErr) && (
            <div className="mx-6 mt-4 p-3 bg-rose-50 border border-rose-200 rounded-lg text-sm text-rose-700 shrink-0">
              {error || aiErr}
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-6">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left */}
              <div className="lg:col-span-2 space-y-6">
                {/* Summary */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Change Summary</h2>

                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">
                        Title <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        value={v.title}
                        onChange={(e) => setV((p) => ({ ...p, title: e.target.value }))}
                        placeholder="e.g., Extend firewall scope for vendor access"
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Requester</label>
                        <input
                          type="text"
                          value={v.requester}
                          onChange={(e) => setV((p) => ({ ...p, requester: e.target.value }))}
                          placeholder="Name"
                          disabled={disabled}
                          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
                        />
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">Status</label>
                        <select
                          value={v.status}
                          onChange={(e) => setV((p) => ({ ...p, status: normalizeStatus(e.target.value) }))}
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
                      </div>

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1.5">
                          Priority <span className="text-rose-500">*</span>
                        </label>
                        <select
                          value={v.priority}
                          onChange={(e) => setV((p) => ({ ...p, priority: normalizePriority(e.target.value) }))}
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
                        value={v.summary}
                        onChange={(e) => setV((p) => ({ ...p, summary: e.target.value }))}
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
                          improveOrSetLocal(v.summary, (val) => setV((p) => ({ ...p, summary: val })), safeStr(d.summary), 1200);
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
                      value={v.justification}
                      onChange={(e) => setV((p) => ({ ...p, justification: e.target.value }))}
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
                        improveOrSetLocal(v.justification, (val) => setV((p) => ({ ...p, justification: val })), safeStr(d.justification));
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
                        value={v.financial}
                        onChange={(e) => setV((p) => ({ ...p, financial: e.target.value }))}
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
                          improveOrSetLocal(v.financial, (val) => setV((p) => ({ ...p, financial: val })), safeStr(d.financial));
                        }}
                        title="AI: draft financials"
                      />
                    </div>
                  </div>

                  <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-4">Schedule Impact</h2>
                    <div className="relative">
                      <textarea
                        value={v.schedule}
                        onChange={(e) => setV((p) => ({ ...p, schedule: e.target.value }))}
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
                          improveOrSetLocal(v.schedule, (val) => setV((p) => ({ ...p, schedule: val })), safeStr(d.schedule));
                        }}
                        title="AI: draft schedule impact"
                      />
                    </div>
                  </div>
                </div>

                {/* Risks & Dependencies */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Risks & Dependencies</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="relative">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Risks</label>
                      <textarea
                        value={v.risks}
                        onChange={(e) => setV((p) => ({ ...p, risks: e.target.value }))}
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
                          improveOrSetLocal(v.risks, (val) => setV((p) => ({ ...p, risks: val })), safeStr(d.risks));
                        }}
                        title="AI: draft risks"
                      />
                    </div>

                    <div className="relative">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Dependencies</label>
                      <textarea
                        value={v.dependencies}
                        onChange={(e) => setV((p) => ({ ...p, dependencies: e.target.value }))}
                        rows={4}
                        placeholder="Approvals, vendors, technical prerequisites..."
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(v.dependencies, (val) => setV((p) => ({ ...p, dependencies: val })), safeStr(d.dependencies));
                        }}
                        title="AI: draft dependencies"
                      />
                    </div>
                  </div>

                  <div className="mt-4 relative">
                    <label className="block text-sm font-medium text-gray-700 mb-1.5">Assumptions</label>
                    <textarea
                      value={v.assumptions}
                      onChange={(e) => setV((p) => ({ ...p, assumptions: e.target.value }))}
                      rows={3}
                      placeholder="Any assumptions the plan relies on..."
                      disabled={disabled}
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                    />
                    <InlineAiButton
                      disabled={disabled}
                      busy={aiBusy}
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSetLocal(v.assumptions, (val) => setV((p) => ({ ...p, assumptions: val })), safeStr((d as any).assumptions));
                      }}
                      title="AI: draft assumptions"
                    />
                  </div>
                </div>

                {/* Implementation & Rollback */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-4">Implementation & Rollback</h2>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="relative">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Implementation Plan</label>
                      <textarea
                        value={v.implementationPlan}
                        onChange={(e) => setV((p) => ({ ...p, implementationPlan: e.target.value }))}
                        rows={6}
                        placeholder="Steps, sequencing, dependencies, testing, cutover..."
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(
                            v.implementationPlan,
                            (val) => setV((p) => ({ ...p, implementationPlan: val })),
                            safeStr((d as any).implementation)
                          );
                        }}
                        title="AI: draft implementation plan"
                      />
                    </div>

                    <div className="relative">
                      <label className="block text-sm font-medium text-gray-700 mb-1.5">Rollback / Validation</label>
                      <textarea
                        value={v.rollbackPlan}
                        onChange={(e) => setV((p) => ({ ...p, rollbackPlan: e.target.value }))}
                        rows={6}
                        placeholder="How to revert safely + validation checks..."
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
                      />
                      <InlineAiButton
                        disabled={disabled}
                        busy={aiBusy}
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSetLocal(v.rollbackPlan, (val) => setV((p) => ({ ...p, rollbackPlan: val })), safeStr((d as any).rollback));
                        }}
                        title="AI: draft rollback/validation"
                      />
                    </div>
                  </div>
                </div>

                {/* Attachments */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-start justify-between gap-3 mb-4">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">Attachments</h2>
                      <div className="text-xs text-gray-500 mt-1">Add supporting evidence (designs, screenshots, vendor comms, impact calcs).</div>
                    </div>

                    <label className="inline-flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-md border border-gray-200 bg-white hover:bg-gray-50 cursor-pointer disabled:opacity-60">
                      <input type="file" className="hidden" multiple onChange={handleFileSelect} disabled={disabled} />
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add files
                    </label>
                  </div>

                  {v.files.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600">No files added yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {v.files.map((f, idx) => (
                        <div key={`${f.name}_${idx}`} className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">{f.name}</div>
                            <div className="text-xs text-gray-500">{(f.size / 1024).toFixed(1)} KB</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(idx)}
                            disabled={disabled}
                            className="text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-60"
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Right */}
              <div className="space-y-6">
                {/* AI Impact */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <h2 className="text-lg font-semibold text-gray-900">AI Impact</h2>
                      <div className="text-xs text-gray-500 mt-1">Delay and cost estimates (override allowed).</div>
                    </div>

                    <button
                      type="button"
                      onClick={async () => {
                        const d = await ensureDrafts();
                        const imp = (d as any)?.impact;
                        if (!imp) {
                          setAiErr("AI returned no impact suggestion.");
                          return;
                        }
                        setV((p) => ({
                          ...p,
                          aiImpact: {
                            days: Number(imp?.days ?? 0) || 0,
                            cost: Number(imp?.cost ?? 0) || 0,
                            risk: safeStr(imp?.risk ?? "").trim() || "None identified",
                          },
                        }));
                      }}
                      disabled={disabled || aiBusy}
                      className="px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 disabled:opacity-50"
                      title="Ask AI to estimate impact"
                    >
                      {aiBusy ? "Scanning…" : "AI Scan"}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Cost (£)</label>
                      <input
                        type="number"
                        value={String(v.aiImpact.cost ?? 0)}
                        onChange={(e) =>
                          setV((p) => ({
                            ...p,
                            aiImpact: { ...p.aiImpact, cost: Number(e.target.value || 0) },
                          }))
                        }
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Days</label>
                      <input
                        type="number"
                        value={String(v.aiImpact.days ?? 0)}
                        onChange={(e) =>
                          setV((p) => ({
                            ...p,
                            aiImpact: { ...p.aiImpact, days: Number(e.target.value || 0) },
                          }))
                        }
                        disabled={disabled}
                        className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                      />
                    </div>
                  </div>

                  <div className="mt-3">
                    <label className="block text-xs font-medium text-gray-600 mb-1">Risk (AI / Override)</label>
                    <input
                      type="text"
                      value={safeStr(v.aiImpact.risk)}
                      onChange={(e) =>
                        setV((p) => ({
                          ...p,
                          aiImpact: { ...p.aiImpact, risk: e.target.value },
                        }))
                      }
                      disabled={disabled}
                      placeholder='e.g., Medium — mitigated by rollback plan'
                      className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
                    />
                    <div className="mt-1 text-[11px] text-gray-500">
                      Tip: include the risk and the mitigation/condition (e.g. "Medium — mitigated by rollback plan").
                    </div>
                  </div>
                </div>

                {/* PM Tips */}
                <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
                  <h2 className="text-lg font-semibold text-gray-900 mb-3">PM Tips</h2>
                  <ul className="text-sm text-gray-700 space-y-2 list-disc pl-5">
                    <li>
                      Use <span className="font-medium">Start AI</span> if the draft is empty — AI needs a little context (title/summary) to produce good outputs.
                    </li>
                    <li>
                      Keep impacts measurable: <span className="font-medium">£</span>, <span className="font-medium">days</span>, named services, and the exact window/date for implementation.
                    </li>
                    <li>
                      Approvers love controls: include <span className="font-medium">test evidence</span>, a <span className="font-medium">rollback plan</span>, and a clear comms message.
                    </li>
                  </ul>
                </div>
              </div>
              {/* end Right */}
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3 border-t border-gray-200 bg-gray-50/50 flex items-center justify-between shrink-0">
            <div className="text-xs text-gray-500">
              {mode === "edit" ? "Editing change request" : "Creating change request"} • Delivery lane:{" "}
              <span className="font-medium text-gray-700">{uiStatusToDeliveryLane(v.status)}</span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={disabled}
                className="px-3 py-2 text-xs font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={disabled}
                className="px-3 py-2 text-xs font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors shadow-sm"
              >
                {saving ? (mode === "edit" ? "Saving…" : "Creating…") : mode === "edit" ? "Save Changes" : "Create Request"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* AI Interview Drawer */}
      <DrawerShell
        open={aiInterviewOpen}
        title="PM Assistant"
        subtitle="Answer a few prompts so AI can draft the change properly"
        onClose={() => setAiInterviewOpen(false)}
      >
        <div className="space-y-5">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-xs text-gray-600">
            Fill what you can. You can paste bullet points. Then click <span className="font-semibold">Generate Draft</span>.
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">What is changing?</label>
            <textarea
              value={interview.about}
              onChange={(e) => setInterview((p) => ({ ...p, about: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Describe the change in plain language..."
              disabled={aiBusy}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Why is it needed?</label>
            <textarea
              value={interview.why}
              onChange={(e) => setInterview((p) => ({ ...p, why: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Benefits, drivers, compliance, incidents, customer need..."
              disabled={aiBusy}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Who / what is impacted?</label>
            <textarea
              value={interview.impacted}
              onChange={(e) => setInterview((p) => ({ ...p, impacted: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Services, users, stakeholders, suppliers..."
              disabled={aiBusy}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">When will it happen?</label>
              <input
                value={interview.when}
                onChange={(e) => setInterview((p) => ({ ...p, when: e.target.value }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Window/date/time..."
                disabled={aiBusy}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">Risk level</label>
              <select
                value={interview.riskLevel}
                onChange={(e) => setInterview((p) => ({ ...p, riskLevel: e.target.value as any }))}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500 bg-white"
                disabled={aiBusy}
              >
                <option value="Low">Low</option>
                <option value="Medium">Medium</option>
                <option value="High">High</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Constraints / dependencies</label>
            <textarea
              value={interview.constraints}
              onChange={(e) => setInterview((p) => ({ ...p, constraints: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Approvals, access, vendor lead times, blackout windows..."
              disabled={aiBusy}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Costs / effort notes</label>
            <textarea
              value={interview.costs}
              onChange={(e) => setInterview((p) => ({ ...p, costs: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="£ estimate, days, internal vs external effort..."
              disabled={aiBusy}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">Rollback approach</label>
            <textarea
              value={interview.rollback}
              onChange={(e) => setInterview((p) => ({ ...p, rollback: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="How to revert safely / validation checks..."
              disabled={aiBusy}
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-2">
            <label className="inline-flex items-center gap-2 text-xs text-gray-600">
              <input type="checkbox" checked={forceOverwrite} onChange={(e) => setForceOverwrite(e.target.checked)} disabled={aiBusy} />
              Overwrite interview from current form values
            </label>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => useCurrentDraftIntoInterview({ overwrite: forceOverwrite })}
                disabled={aiBusy}
                className="text-xs px-3 py-2 rounded-md border border-gray-200 bg-white hover:bg-gray-50 disabled:opacity-50"
              >
                Pull from form
              </button>

              <button
                type="button"
                onClick={async () => {
                  const d = await runPmoDraftAssist();
                  if (d) setAiInterviewOpen(false);
                }}
                disabled={aiBusy || disabled}
                className="text-xs px-3 py-2 rounded-md bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {aiBusy ? "Generating…" : "Generate Draft"}
              </button>
            </div>
          </div>

          {drafts ? (
            <div className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
              <div className="text-xs font-semibold text-gray-900 mb-1">Draft ready</div>
              <div className="text-xs text-gray-600">
                Click <span className="font-semibold">Apply All</span> in the header to apply across the form.
              </div>
            </div>
          ) : null}
        </div>
      </DrawerShell>
    </>
  );
}
