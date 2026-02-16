"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AiImpactPanel from "@/components/change/AiImpactPanel";
import { CHANGE_COLUMNS } from "@/lib/change/columns";
import type { ChangePriority, ChangeStatus } from "@/lib/change/types";

/* ---------------- utils ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function clampText(s: string, max: number) {
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

/* ---------------- Main Modal ---------------- */

export default function ChangeCreateModal({
  open,
  onClose,
  projectId,
  artifactId,
  initialStatus,
  initialPriority,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  artifactId?: string | null;
  initialStatus?: ChangeStatus;
  initialPriority?: ChangePriority;
}) {
  const router = useRouter();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  const disabled = saving;

  const draftId = useMemo(() => {
    try {
      return crypto.randomUUID();
    } catch {
      return `d_${Math.random().toString(16).slice(2)}_${Date.now()}`;
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError("");
    setAiErr("");
    setDrafts(null);
    setDraftModel("rules-v1");
    setAiImpact({ days: 0, cost: 0, risk: "None identified" });

    setTitle("");
    setRequester("");
    setStatus(initialStatus ?? "new");
    setPriority(initialPriority ?? "Medium");
    setSummary("");
    setJustification("");
    setFinancial("");
    setSchedule("");
    setRisks("");
    setDependencies("");
    setAssumptions("");
    setImplementationPlan("");
    setRollbackPlan("");

    setInterview({
      about: "",
      why: "",
      impacted: "",
      when: "",
      constraints: "",
      costs: "",
      riskLevel: "Medium",
      rollback: "",
    });
    setForceOverwrite(false);
  }, [open, initialStatus, initialPriority]);

  function improveOrSetLocal(
    current: string,
    setter: (v: string) => void,
    suggestion: string,
    max = 8000
  ) {
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
    const pid = safeStr(projectId).trim();
    if (!pid) {
      setAiErr("Missing projectId.");
      return null;
    }

    setAiErr("");
    setAiBusy(true);
    try {
      const payload = {
        draftId,
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
        artifactId: null,
        eventType: "change_draft_assist_requested",
        severity: "info",
        source: "change_create_modal",
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
    improveOrSetLocal(assumptions, setAssumptions, safeStr((d as any).assumptions));
    improveOrSetLocal(implementationPlan, setImplementationPlan, safeStr((d as any).implementation));
    improveOrSetLocal(rollbackPlan, setRollbackPlan, safeStr((d as any).rollback));

    const imp = (d as any)?.impact;
    if (imp) {
      setAiImpact({
        days: Number(imp?.days ?? 0) || 0,
        cost: Number(imp?.cost ?? 0) || 0,
        risk: safeStr(imp?.risk ?? "").trim() || "None identified",
      });
    }
  }

  async function createChange() {
    setError("");
    const pid = safeStr(projectId).trim();
    if (!pid) return setError("Missing projectId.");
    const t = clampText(safeStr(title).trim(), 160);
    if (!t) return setError("Title is required.");
    const s = clampText(safeStr(summary).trim(), 1200);
    if (!s) return setError("Summary is required.");

    setSaving(true);
    try {
      const impactAnalysis = {
        days: Number(aiImpact.days ?? 0) || 0,
        cost: Number(aiImpact.cost ?? 0) || 0,
        risk: clampText(safeStr(aiImpact.risk ?? "None identified"), 280),
        highlights: [],
      };

      const proposedChange = clampText(
        [
          justification ? `Justification: ${justification}` : "",
          financial ? `Financial: ${financial}` : "",
          schedule ? `Schedule: ${schedule}` : "",
          risks ? `Risks: ${risks}` : "",
          dependencies ? `Dependencies: ${dependencies}` : "",
          assumptions ? `Assumptions: ${assumptions}` : "",
          implementationPlan ? `Implementation Plan: ${implementationPlan}` : "",
          rollbackPlan ? `Rollback / Validation: ${rollbackPlan}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
        8000
      );

      const j = await apiPost("/api/change", {
        projectId: pid,
        artifactId: safeStr(artifactId).trim() || null,
        title: t,
        description: s,
        requester: safeStr(requester).trim() || null,
        requester_name: safeStr(requester).trim() || null,
        priority: normalizePriority(priority),
        deliveryStatus: normalizeStatus(status),
        tags: [],
        proposedChange,
        impactAnalysis,
      });

      const newId = safeStr((j as any)?.item?.id || (j as any)?.id || (j as any)?.data?.id).trim();
      if (!newId) throw new Error("Create succeeded but no id returned");

      onClose();
      router.push(`/projects/${encodeURIComponent(pid)}/change/${encodeURIComponent(newId)}`);
    } catch (e: any) {
      setError(safeStr(e?.message) || "Create failed");
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-5xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50/50 flex items-center justify-between">
            <div>
              <div className="text-lg font-semibold text-gray-900">New Change Request</div>
              <div className="text-sm text-gray-500">Create a complete change request with AI assistance.</div>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => { useCurrentDraftIntoInterview({ overwrite: false }); setAiInterviewOpen(true); }} className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg">Start AI</button>
              <button type="button" onClick={applyAllAi} className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-50 text-indigo-700 text-sm font-medium rounded-lg">Apply All</button>
              <button type="button" onClick={onClose} className="px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg">Close</button>
              <button type="button" onClick={createChange} className="px-3 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg shadow-sm">Create Request</button>
            </div>
          </div>
          <div className="p-6 overflow-y-auto max-h-[80vh]">
            <p>Form Content Here...</p>
          </div>
        </div>
      </div>
    </>
  );
}
