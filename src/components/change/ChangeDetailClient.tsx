// src/components/change/ChangeDetailClient.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import type { ChangeItem, ChangePriority, ChangeStatus } from "@/lib/change/types";
import { CHANGE_COLUMNS } from "@/lib/change/columns";
import AiImpactPanel from "./AiImpactPanel";
import ChangeTimeline from "./ChangeTimeline";
import ChangeAiDrawer from "./ChangeAiDrawer";

type Panel = "" | "attach" | "comment" | "timeline" | "ai";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function clampText(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}

function uuidish() {
  try {
    // @ts-ignore
    return crypto?.randomUUID?.() ?? `d_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  } catch {
    return `d_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
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

function looksLikePublicId(x: string) {
  return /^cr-\d+$/i.test(x.trim()) || /^cr\d+$/i.test(x.trim());
}

function applyTheme(theme: "dark" | "light") {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-cr-theme", theme);
  try {
    localStorage.setItem("crTheme", theme);
    localStorage.setItem("cr_theme", theme);
  } catch {}
}

async function apiGet(url: string) {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

async function apiPatch(url: string, body?: any) {
  const res = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

async function apiPost(url: string, body?: any) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : "{}",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

function parseProposedChange(txt: string) {
  const raw = safeStr(txt || "");
  const out: Record<"justification" | "financial" | "schedule" | "risks" | "dependencies", string> = {
    justification: "",
    financial: "",
    schedule: "",
    risks: "",
    dependencies: "",
  };

  const lines = raw.split(/\r?\n/);
  let cur: keyof typeof out | null = null;

  function takeKey(line: string): keyof typeof out | null {
    const s = line.trim();
    const map: Record<string, keyof typeof out> = {
      justification: "justification",
      financial: "financial",
      schedule: "schedule",
      risks: "risks",
      dependencies: "dependencies",
    };

    for (const k of Object.keys(map)) {
      const prefix = `${k[0].toUpperCase()}${k.slice(1)}:`;
      if (s.toLowerCase().startsWith(prefix.toLowerCase())) return map[k];
    }
    return null;
  }

  for (const rawLine of lines) {
    const line = rawLine ?? "";
    const key = takeKey(line);
    if (key) {
      cur = key;
      out[cur] = line.replace(/^([A-Za-z_ ]+):\s*/i, "");
      continue;
    }
    if (!cur) continue;
    out[cur] = out[cur] ? out[cur] + "\n" + line : line;
  }

  (Object.keys(out) as (keyof typeof out)[]).forEach((k) => (out[k] = out[k].trim()));
  return out;
}

function buildProposedChangeFrom(m: ChangeItem) {
  return clampText(
    [
      m.justification ? `Justification: ${m.justification}` : "",
      m.financial ? `Financial: ${m.financial}` : "",
      m.schedule ? `Schedule: ${m.schedule}` : "",
      m.risks ? `Risks: ${m.risks}` : "",
      m.dependencies ? `Dependencies: ${m.dependencies}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
    8000
  );
}

/* ---------------- Attachments ---------------- */

type AttachmentRow = {
  id?: string;
  file_name?: string;
  filename?: string;
  name?: string;
  size?: number;
  size_bytes?: number;
  created_at?: string;
  url?: string;
  signedUrl?: string;
  path?: string;
};

function attachmentName(a: AttachmentRow) {
  return safeStr(a.file_name || a.filename || a.name || "").trim() || "Attachment";
}

function formatBytes(n?: number) {
  const v = Number(n ?? 0);
  if (!Number.isFinite(v) || v <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let x = v;
  while (x >= 1024 && i < units.length - 1) {
    x /= 1024;
    i++;
  }
  return `${x.toFixed(x >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function ModalShell({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="crModalOverlay"
      role="dialog"
      aria-modal="true"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 9999,
        display: "grid",
        placeItems: "center",
        padding: 16,
      }}
    >
      <div
        className="crModal"
        style={{
          width: "min(980px, 96vw)",
          maxHeight: "85vh",
          overflow: "auto",
          borderRadius: 18,
          border: "1px solid var(--cr-border)",
          background: "var(--cr-panel)",
          boxShadow: "0 20px 80px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="crModalHead"
          style={{
            position: "sticky",
            top: 0,
            background: "linear-gradient(180deg, rgba(0,0,0,0.35), rgba(0,0,0,0))",
            backdropFilter: "blur(8px)",
            padding: "14px 16px",
            borderBottom: "1px solid var(--cr-border)",
            display: "grid",
            gridTemplateColumns: "1fr auto",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ fontWeight: 700 }}>{title}</div>
          <button className="crBtn crBtnGhost" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div style={{ padding: 16 }}>{children}</div>
      </div>
    </div>
  );
}

/* ---------------- Governance helpers ---------------- */

type DecisionStatus = "" | "draft" | "analysis" | "review" | "submitted" | "approved" | "rejected" | "rework";

function normDecision(x: any): DecisionStatus {
  const v = safeStr(x).trim().toLowerCase();
  if (!v) return "";
  if (v === "draft") return "draft";
  if (v === "analysis") return "analysis";
  if (v === "review") return "review";
  if (v === "submitted") return "submitted";
  if (v === "approved") return "approved";
  if (v === "rejected") return "rejected";
  if (v === "rework" || v === "changes_requested" || v === "request_changes") return "rework";
  return v as any;
}

function canEditFromGovernance(lane: ChangeStatus, decision: DecisionStatus) {
  if (lane === "review") {
    if (decision === "rejected" || decision === "rework") return true;
    return false;
  }
  if (lane === "in_progress" || lane === "implemented" || lane === "closed") return false;
  return true;
}

/* ---------------- Draft Co-pilot types ---------------- */

type DraftCopilotAi = {
  headline?: string;
  schedule?: string;
  cost?: string;
  scope?: string;
  risk?: string;
  dependencies?: string;
  assumptions?: string;
  priority_note?: string;
  next_actions?: string[] | string;
};

export default function ChangeDetailClient({
  projectId,
  projectCode, // ✅ NEW (optional)
  artifactId,
  changeId,
  change,
  returnTo,
  initialPanel,
}: {
  projectId: string;
  projectCode?: string | number; // ✅ NEW (lets Timeline show PRJ-100011 immediately)
  artifactId?: string;
  changeId: string;
  change?: ChangeItem;
  returnTo?: string;
  initialPanel?: Panel;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  /* ---------------- Theme ---------------- */
  const [theme, setTheme] = useState<"dark" | "light">("light");
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      const saved =
        safeStr(localStorage.getItem("crTheme")).trim().toLowerCase() ||
        safeStr(localStorage.getItem("cr_theme")).trim().toLowerCase();

      if (saved === "dark" || saved === "light") {
        setTheme(saved as any);
        applyTheme(saved as any);
        return;
      }
    } catch {}
    applyTheme("light");
  }, []);

  useEffect(() => {
    if (!mounted) return;
    applyTheme(theme);
  }, [theme, mounted]);

  /* ---------------- State ---------------- */
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>("");

  const routeId = useMemo(() => safeStr(changeId).trim(), [changeId]);
  const routeIsDbId = useMemo(() => isUuid(routeId), [routeId]);

  const draftId = useMemo(() => uuidish(), []);

  const initialModel = useMemo<ChangeItem>(() => {
    if (change) return change;
    return {
      id: routeId || "CR",
      dbId: routeId || undefined,
      title: "",
      requester: "",
      summary: "",
      status: "new",
      priority: "Medium",
      tags: [],
      aiImpact: { days: 0, cost: 0, risk: "None identified" },
      justification: "",
      financial: "",
      schedule: "",
      risks: "",
      dependencies: "",
      // @ts-ignore
      decision_status: "",
      // @ts-ignore
      decision_role: "",
    };
  }, [change, routeId]);

  const [model, setModel] = useState<ChangeItem>(initialModel);
  const [tagDraft, setTagDraft] = useState("");

  const [panel, setPanel] = useState<Panel>(initialPanel ?? "");
  const [timelineOpen, setTimelineOpen] = useState<boolean>((initialPanel ?? "") === "timeline");
  const [attachOpen, setAttachOpen] = useState<boolean>((initialPanel ?? "") === "attach");

  // Draft AI co-pilot modal
  const [draftAiOpen, setDraftAiOpen] = useState(false);
  const [draftAiBusy, setDraftAiBusy] = useState(false);
  const [draftAiErr, setDraftAiErr] = useState("");
  const [draftAi, setDraftAi] = useState<DraftCopilotAi | null>(null);
  const [draftAutoScan, setDraftAutoScan] = useState(true);
  const lastDraftSigRef = useRef<string>("");

  useEffect(() => {
    const qp = safeStr(sp?.get("panel")).trim().toLowerCase();
    const p2: Panel = qp === "timeline" ? "timeline" : qp === "attach" ? "attach" : qp === "comment" ? "comment" : qp === "ai" ? "ai" : "";
    setPanel(p2);

    if (p2 === "timeline") setTimelineOpen(true);
    if (p2 === "attach") setAttachOpen(true);
  }, [sp]);

  function set<K extends keyof ChangeItem>(key: K, value: ChangeItem[K]) {
    setModel((m) => ({ ...m, [key]: value }));
  }

  /* ---------------- Load (ONLY if we have a real DB id) ---------------- */
  useEffect(() => {
    if (change) setModel(change);
  }, [change]);

  useEffect(() => {
    let dead = false;

    async function load() {
      if (change) return;
      if (!routeId) return;
      if (!routeIsDbId) return;

      setLoading(true);
      setError("");
      try {
        const json = await apiGet(`/api/change/${encodeURIComponent(routeId)}`);
        const row = (json as any)?.item ?? (json as any)?.data ?? json;

        const impact = row?.impact_analysis ?? {};
        const proposed = safeStr(row?.proposed_change);
        const parts = parseProposedChange(proposed);

        const next: ChangeItem = {
          id: safeStr(row?.id) || "",
          dbId: safeStr(row?.id) || "",
          ...(safeStr(row?.public_id) ? ({ publicId: safeStr(row?.public_id) } as any) : {}),
          title: safeStr(row?.title) || "",
          requester:
            safeStr(row?.requester_name).trim() ||
            safeStr(row?.requester).trim() ||
            safeStr(row?.profiles?.full_name).trim() ||
            safeStr(row?.profiles?.name).trim() ||
            "",
          summary: safeStr(row?.description) || "",
          status: normalizeStatus(row?.delivery_status ?? row?.deliveryStatus ?? row?.status),
          priority: normalizePriority(row?.priority),
          tags: Array.isArray(row?.tags) ? row.tags : [],
          aiImpact: {
            days: Number(impact?.days ?? 0) || 0,
            cost: Number(impact?.cost ?? 0) || 0,
            risk: safeStr(impact?.risk) || "None identified",
          },
          justification: parts.justification || "",
          financial: parts.financial || "",
          schedule: parts.schedule || "",
          risks: parts.risks || "",
          dependencies: parts.dependencies || "",
          // @ts-ignore
          decision_status: safeStr(row?.decision_status ?? row?.decisionStatus ?? ""),
          // @ts-ignore
          decision_role: safeStr(row?.decision_role ?? row?.decisionRole ?? ""),
        };

        if (!dead) setModel(next);
      } catch (e: any) {
        if (!dead) setError(safeStr(e?.message) || "Load failed");
      } finally {
        if (!dead) setLoading(false);
      }
    }

    load();
    return () => {
      dead = true;
    };
  }, [change, routeId, routeIsDbId]);

  /* ---------------- Tags ---------------- */
  function addTag() {
    const t = tagDraft.trim();
    if (!t) return;
    setModel((m) => ({
      ...m,
      tags: Array.from(new Set([...(m.tags ?? []), t])).slice(0, 20),
    }));
    setTagDraft("");
  }

  function removeTag(t: string) {
    setModel((m) => ({
      ...m,
      tags: (m.tags ?? []).filter((x) => x !== t),
    }));
  }

  function boardReturnHref() {
    if (returnTo) return returnTo;
    return projectId ? `/projects/${projectId}/change` : "/projects";
  }

  function setPanelParam(next: Panel) {
    const qp = new URLSearchParams(sp?.toString() || "");
    if (!next) qp.delete("panel");
    else qp.set("panel", next);
    const url = qp.toString() ? `${pathname}?${qp.toString()}` : pathname;
    router.replace(url);
  }

  function validate(): { ok: true; payload: any } | { ok: false; msg: string } {
    const pid = safeStr(projectId).trim();
    if (!pid) return { ok: false, msg: "Missing projectId." };

    const title = clampText(safeStr(model.title).trim(), 160);
    if (!title) return { ok: false, msg: "Title is required." };

    const summary = clampText(safeStr(model.summary).trim(), 1200);
    if (!summary) return { ok: false, msg: "Summary is required." };

    const requester = clampText(safeStr(model.requester).trim(), 160);
    const status = normalizeStatus(model.status);
    const priority = normalizePriority(model.priority);

    const tags = Array.isArray(model.tags) ? model.tags.map((t) => safeStr(t).trim()).filter(Boolean).slice(0, 20) : [];

    const impact = model.aiImpact ?? { days: 0, cost: 0, risk: "None identified" };
    const impactAnalysis = {
      days: Number((impact as any)?.days ?? 0) || 0,
      cost: Number((impact as any)?.cost ?? 0) || 0,
      risk: clampText(safeStr((impact as any)?.risk ?? "None identified"), 280),
      highlights: [],
    };

    return {
      ok: true,
     payload: {
  // keep projectId for create route /ai/events
  projectId: pid,
  artifactId: safeStr(artifactId).trim() || null,

  title,
  summary, // client name
  description: summary, // server accepts this too

  proposedChange: buildProposedChangeFrom(model),

  priority,
  tags,

  requester_name: requester || null,

  // server accepts impactAnalysis OR impact_analysis OR aiImpact
  impactAnalysis,
}
,
    };
  }

  // governance state
  const lane = normalizeStatus(model.status);
  const decision = normDecision((model as any)?.decision_status);

  const lockedByGovernance = routeIsDbId ? !canEditFromGovernance(lane, decision) : false;
  const disabled = saving || loading || lockedByGovernance;

  const uiId = useMemo(() => {
    const pid = safeStr((model as any)?.publicId || (model as any)?.public_id).trim();
    if (pid) return pid;
    const id = safeStr(model.id).trim();
    if (looksLikePublicId(id)) return id;
    return "";
  }, [model]);

  /* ---------------- AI ---------------- */
  const [aiBusy, setAiBusy] = useState(false);

  async function fireAiEvent(eventType: string, payload: any) {
    return apiPost("/api/ai/events", {
      projectId,
      artifactId: null,
      eventType,
      severity: "info",
      source: "change_detail",
      payload,
    });
  }

  function draftPayloadSnapshot() {
    return {
      title: safeStr(model.title),
      summary: safeStr(model.summary),
      priority: safeStr(model.priority),
      status: normalizeStatus(model.status),

      justification: safeStr((model as any).justification),
      financial: safeStr((model as any).financial),
      schedule: safeStr((model as any).schedule),
      risks: safeStr((model as any).risks),
      dependencies: safeStr((model as any).dependencies),

      tags: Array.isArray(model.tags) ? model.tags : [],
      uiId: uiId || "",
    };
  }

  function sigOfDraft() {
    const p = draftPayloadSnapshot();
    return [
      safeStr(projectId).trim(),
      safeStr(p.title).trim(),
      safeStr(p.summary).trim(),
      safeStr(p.priority).trim(),
      safeStr(p.status).trim(),
      safeStr(p.justification).trim(),
      safeStr(p.financial).trim(),
      safeStr(p.schedule).trim(),
      safeStr(p.risks).trim(),
      safeStr(p.dependencies).trim(),
      (Array.isArray(p.tags) ? p.tags.join(",") : "").trim(),
    ]
      .join("||")
      .slice(0, 1500);
  }

  async function runDraftCopilotScanNow() {
    setDraftAiErr("");
    setDraftAiBusy(true);
    try {
      const json = await fireAiEvent("change_draft_scan_requested", {
        draftId,
        draft: draftPayloadSnapshot(),
      });

      const result = (json as any)?.result ?? (json as any)?.payload ?? json;
      const ai = (result as any)?.ai ?? (result as any)?.payload?.ai ?? null;
      setDraftAi(ai || null);
    } catch (e: any) {
      setDraftAiErr(safeStr(e?.message) || "Draft AI scan failed");
    } finally {
      setDraftAiBusy(false);
    }
  }

  useEffect(() => {
    if (!draftAiOpen) return;
    if (!draftAutoScan) return;
    if (routeIsDbId) return;
    const pid = safeStr(projectId).trim();
    if (!pid) return;

    const sig = sigOfDraft();
    if (sig === lastDraftSigRef.current) return;

    const t = setTimeout(() => {
      if (sig === lastDraftSigRef.current) return;
      lastDraftSigRef.current = sig;
      runDraftCopilotScanNow().catch(() => {});
    }, 900);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    draftAiOpen,
    draftAutoScan,
    routeIsDbId,
    projectId,
    model.title,
    model.summary,
    model.priority,
    model.status,
    (model as any).justification,
    (model as any).financial,
    (model as any).schedule,
    (model as any).risks,
    (model as any).dependencies,
    Array.isArray(model.tags) ? model.tags.join(",") : "",
  ]);

  async function runAiScanNow() {
    if (aiBusy || draftAiBusy) return;

    if (!routeIsDbId) {
      setDraftAiOpen(true);
      if (!draftAi) await runDraftCopilotScanNow();
      return;
    }

    setAiBusy(true);
    setError("");
    try {
      await fireAiEvent("change_ai_scan_requested", {
        changeId: routeId,
        title: safeStr(model.title),
        summary: safeStr(model.summary),
        status: lane,
        uiId,
      });
    } catch (e: any) {
      setError(`AI failed: ${safeStr(e?.message) || "Unknown error"}`);
    } finally {
      setAiBusy(false);
    }
  }
async function save() {
  setError("");
  const v = validate();
  if (!v.ok) return setError(v.msg);

  setSaving(true);
  try {
    // ✅ If we DON'T have a DB UUID yet, we must CREATE first
    if (!routeIsDbId) {
      const created = await apiPost("/api/change", {
        projectId: v.payload.projectId,
        artifactId: v.payload.artifactId,
        title: v.payload.title,
        description: v.payload.description,
        proposedChange: v.payload.proposedChange,
        priority: v.payload.priority,
        tags: v.payload.tags,
        requester_name: v.payload.requester_name,
        impactAnalysis: v.payload.impactAnalysis,
      });

      const newId = safeStr((created as any)?.item?.id || (created as any)?.id).trim();
      if (!newId) throw new Error("Created change request but no id returned.");

      // After create, go back to board (or navigate to the new detail page if you have one)
      router.push(boardReturnHref());
      return;
    }

    // ✅ Normal edit/save path (UUID)
    const id = safeStr(routeId).trim();
    if (!id) throw new Error("Missing change id.");

    const json = await apiPatch(`/api/change/${encodeURIComponent(id)}`, {
      title: v.payload.title,
      summary: v.payload.description,
      description: v.payload.description,
      proposedChange: v.payload.proposedChange,
      priority: v.payload.priority,
      tags: v.payload.tags,
      requester_name: v.payload.requester_name,
      impactAnalysis: v.payload.impactAnalysis,
    });

    if (!json || (json as any).ok !== true) throw new Error((json as any)?.error || "Save failed");
    router.push(boardReturnHref());
  } catch (e: any) {
    setError(safeStr(e?.message) || "Save failed");
  } finally {
    setSaving(false);
  }
}

  /* ---------------- Analysis readiness ---------------- */

  const analysisReadiness = useMemo(() => {
    const isAnalysis = lane === "analysis";
    if (!isAnalysis) {
      return { isAnalysis: false, ready: true, items: [] as { ok: boolean; label: string }[], blockingMsg: "" };
    }

    const titleOk = safeStr(model.title).trim().length >= 5;
    const summaryOk = safeStr(model.summary).trim().length >= 20;

    const justOk = safeStr((model as any).justification).trim().length >= 15;
    const finOk = safeStr((model as any).financial).trim().length >= 10;
    const schOk = safeStr((model as any).schedule).trim().length >= 10;
    const risksOk = safeStr((model as any).risks).trim().length >= 10 || safeStr(model.aiImpact?.risk).trim().length >= 10;
    const depsOk = safeStr((model as any).dependencies).trim().length >= 10;

    const days = Number(model.aiImpact?.days ?? 0) || 0;
    const cost = Number(model.aiImpact?.cost ?? 0) || 0;
    const riskTxt = safeStr(model.aiImpact?.risk).trim();
    const impactOk = (days !== 0 || cost !== 0 || riskTxt.length >= 10) && riskTxt.length > 0;

    const items = [
      { ok: titleOk, label: "Title set" },
      { ok: summaryOk, label: "Summary (what/why) set" },
      { ok: justOk, label: "Justification captured" },
      { ok: schOk, label: "Schedule impact captured" },
      { ok: finOk, label: "Financial impact captured" },
      { ok: risksOk, label: "Risks captured" },
      { ok: depsOk, label: "Dependencies captured" },
      { ok: impactOk, label: "AI Impact (days/cost/risk) captured" },
    ];

    const ready = items.every((x) => x.ok);

    const blockingMsg = ready ? "" : "Not ready for submission — complete the missing items (or run AI scan to populate the impact quickly).";

    return { isAnalysis: true, ready, items, blockingMsg };
  }, [lane, model]);

  /* ---------------- Governance actions ---------------- */

  async function doSubmit() {
    if (!routeIsDbId) return;

    if (analysisReadiness.isAnalysis && !analysisReadiness.ready) {
      setError(analysisReadiness.blockingMsg || "Not ready for submission.");
      return;
    }

    setError("");
    setSaving(true);
    try {
      await apiPost(`/api/change/${encodeURIComponent(routeId)}/submit`, {});
      setModel((m: any) => ({ ...m, status: "review", decision_status: "submitted" }));

      fireAiEvent("change_submitted_for_approval", { changeId: routeId, uiId }).catch(() => {});
      router.push(boardReturnHref());
    } catch (e: any) {
      setError(safeStr(e?.message) || "Submit failed");
    } finally {
      setSaving(false);
    }
  }

  async function doApprove() {
    if (!routeIsDbId) return;
    setError("");
    setSaving(true);
    try {
      await apiPost(`/api/change/${encodeURIComponent(routeId)}/approve`, {});
      setModel((m: any) => ({ ...m, status: "in_progress", decision_status: "approved" }));
      fireAiEvent("change_approved", { changeId: routeId, uiId }).catch(() => {});
      router.push(boardReturnHref());
    } catch (e: any) {
      setError(safeStr(e?.message) || "Approve failed");
    } finally {
      setSaving(false);
    }
  }

  async function doReject() {
    if (!routeIsDbId) return;
    setError("");
    setSaving(true);
    try {
      await apiPost(`/api/change/${encodeURIComponent(routeId)}/reject`, { note: "" });
      setModel((m: any) => ({ ...m, status: "new", decision_status: "rejected" }));
      fireAiEvent("change_rejected", { changeId: routeId, uiId }).catch(() => {});
      router.push(boardReturnHref());
    } catch (e: any) {
      setError(safeStr(e?.message) || "Reject failed");
    } finally {
      setSaving(false);
    }
  }

  async function doRequestChanges() {
    if (!routeIsDbId) return;
    setError("");
    setSaving(true);
    try {
      await apiPost(`/api/change/${encodeURIComponent(routeId)}/request-changes`, { note: "" });
      setModel((m: any) => ({ ...m, status: "analysis", decision_status: "rework" }));
      fireAiEvent("change_rework_requested", { changeId: routeId, uiId }).catch(() => {});
      router.push(boardReturnHref());
    } catch (e: any) {
      setError(safeStr(e?.message) || "Request changes failed");
    } finally {
      setSaving(false);
    }
  }

  const canSubmit = routeIsDbId && lane === "analysis" && !lockedByGovernance && analysisReadiness.ready;
  const canApprove = routeIsDbId && lane === "review";
  const canRework = routeIsDbId && lane === "review";
  const canReject = routeIsDbId && lane === "review";

  /* ---------------- Attachments ---------------- */
  const [attLoading, setAttLoading] = useState(false);
  const [attErr, setAttErr] = useState("");
  const [attachments, setAttachments] = useState<AttachmentRow[]>([]);
  const [uploading, setUploading] = useState(false);

  // ✅ shown on Attach button even when modal closed
  const [attCount, setAttCount] = useState<number>(0);
  const [attCountLoading, setAttCountLoading] = useState(false);

  const attachmentsEndpoint = useMemo(() => {
    if (!routeIsDbId) return "";
    return `/api/change/${encodeURIComponent(routeId)}/attachments`;
  }, [routeIsDbId, routeId]);

  function extractItems(j: any): AttachmentRow[] {
    const items = j?.items ?? j?.attachments ?? j?.data ?? [];
    return Array.isArray(items) ? items : [];
  }

  async function loadAttachments() {
    if (!routeIsDbId) return;
    if (!attachmentsEndpoint) return;

    setAttErr("");
    setAttLoading(true);
    try {
      const j = await apiGet(attachmentsEndpoint);
      const items = extractItems(j);
      setAttachments(items);
      setAttCount(items.length);
    } catch (e: any) {
      setAttErr(safeStr(e?.message) || "Failed to load attachments");
      setAttachments([]);
      setAttCount(0);
    } finally {
      setAttLoading(false);
    }
  }

  async function loadAttachmentCount() {
    if (!routeIsDbId) return;
    if (!attachmentsEndpoint) return;

    setAttCountLoading(true);
    try {
      const j = await apiGet(attachmentsEndpoint);
      const items = extractItems(j);
      setAttCount(items.length);
      // keep a light cache so if user opens modal it’s already there
      setAttachments((prev) => (prev.length ? prev : items));
    } catch {
      // don’t spam errors for count
    } finally {
      setAttCountLoading(false);
    }
  }

  // ✅ keep button count fresh when we have a DB id
  useEffect(() => {
    if (!routeIsDbId) return;
    if (!attachmentsEndpoint) return;
    loadAttachmentCount().catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeIsDbId, attachmentsEndpoint]);

  async function uploadAttachment(file: File) {
    if (!routeIsDbId) return;
    if (!attachmentsEndpoint) return;

    setAttErr("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.set("file", file);
      if (safeStr(artifactId).trim()) fd.set("artifactId", safeStr(artifactId).trim());

      const res = await fetch(attachmentsEndpoint, { method: "POST", body: fd });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !(json as any)?.ok) throw new Error(safeStr((json as any)?.error) || "Upload failed");

      await loadAttachments();
    } catch (e: any) {
      setAttErr(safeStr(e?.message) || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // ✅ Delete attachment (UUID id if present; else path; sends both query + body)
  async function deleteAttachment(a: AttachmentRow) {
    if (!routeIsDbId) return;
    if (!attachmentsEndpoint) return;

    const rawId = safeStr(a.id).trim();
    const path = safeStr((a as any)?.path).trim();

    const attachmentId = rawId && isUuid(rawId) ? rawId : "";

    const qp = new URLSearchParams();
    if (path) qp.set("path", path);
    if (attachmentId) qp.set("attachmentId", attachmentId);

    if (!path && rawId && rawId.includes("/") && rawId.startsWith("change/")) {
      qp.set("path", rawId);
    }

    const finalPath = qp.get("path") || "";
    const finalAttachmentId = qp.get("attachmentId") || "";

    if (!finalPath && !finalAttachmentId) {
      setAttErr("Cannot delete: missing attachment path/id");
      return;
    }

    const ok = window.confirm(`Delete "${attachmentName(a)}"? This cannot be undone.`);
    if (!ok) return;

    setAttErr("");
    setUploading(true);
    try {
      const url = qp.toString() ? `${attachmentsEndpoint}?${qp.toString()}` : attachmentsEndpoint;

      const res = await fetch(url, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: finalPath || null,
          attachmentId: finalAttachmentId || null,
        }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok || !(json as any)?.ok) throw new Error(safeStr((json as any)?.error) || "Delete failed");

      await loadAttachments();
    } catch (e: any) {
      setAttErr(safeStr(e?.message) || "Delete failed");
    } finally {
      setUploading(false);
    }
  }

  useEffect(() => {
    if (!attachOpen) return;
    loadAttachments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachOpen, attachmentsEndpoint]);

  function renderDraftAi(ai: DraftCopilotAi | null) {
    if (!ai) return <div style={{ opacity: 0.85 }}>No AI output yet. Click “Run AI scan”.</div>;

    const nextActions = Array.isArray(ai.next_actions)
      ? ai.next_actions
      : typeof ai.next_actions === "string"
      ? ai.next_actions.split("\n").map((x) => x.trim()).filter(Boolean)
      : [];

    return (
      <div style={{ display: "grid", gap: 12 }}>
        <div style={{ fontWeight: 800, fontSize: 16 }}>{safeStr(ai.headline) || "Draft change scanned"}</div>

        <div style={{ display: "grid", gap: 10 }}>
          {ai.priority_note ? (
            <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Priority</div>
              <div style={{ opacity: 0.9, whiteSpace: "pre-wrap" }}>{ai.priority_note}</div>
            </div>
          ) : null}

          <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Schedule / milestones</div>
            <div style={{ opacity: 0.9, whiteSpace: "pre-wrap" }}>{safeStr(ai.schedule) || "—"}</div>
          </div>

          <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Cost</div>
            <div style={{ opacity: 0.9, whiteSpace: "pre-wrap" }}>{safeStr(ai.cost) || "—"}</div>
          </div>

          <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
            <div style={{ fontWeight: 800, marginBottom: 6 }}>Scope / justification</div>
            <div style={{ opacity: 0.9, whiteSpace: "pre-wrap" }}>{safeStr(ai.scope) || "—"}</div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Risks</div>
              <div style={{ opacity: 0.9, whiteSpace: "pre-wrap" }}>{safeStr(ai.risk) || "—"}</div>
            </div>

            <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Dependencies</div>
              <div style={{ opacity: 0.9, whiteSpace: "pre-wrap" }}>{safeStr(ai.dependencies) || "—"}</div>
            </div>
          </div>

          {ai.assumptions ? (
            <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
              <div style={{ fontWeight: 800, marginBottom: 6 }}>Assumptions</div>
              <div style={{ opacity: 0.9, whiteSpace: "pre-wrap" }}>{ai.assumptions}</div>
            </div>
          ) : null}

          {nextActions.length ? (
            <div style={{ border: "1px solid var(--cr-border)", borderRadius: 14, padding: 12, background: "var(--cr-card)" }}>
              <div style={{ fontWeight: 800, marginBottom: 8 }}>Next best actions</div>
              <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.95, display: "grid", gap: 6 }}>
                {nextActions.slice(0, 10).map((x, i) => (
                  <li key={`${i}`}>{x}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <section className="crDetailShell">
      <section className="crFormShell">
        {/* TOP ACTION BAR */}
        <div className="crTopbar2" style={{ gridTemplateColumns: "1fr auto" }}>
          <div className="crTopbarLeft">
            <div className="crTopMsg">
              {loading
                ? "Loading change request…"
                : lockedByGovernance
                ? "Locked (submitted for approval)."
                : routeIsDbId
                ? "Edit the change request and save."
                : "Draft mode — AI co-pilot can guide you before saving."}
              {uiId ? <span className="crTopScope"> • {uiId}</span> : null}
              <span className="crTopScope"> • {lane.replace(/_/g, " ")}</span>
              {decision ? <span className="crTopScope"> • {decision}</span> : null}
            </div>

            {analysisReadiness.isAnalysis ? (
              <div
                style={{
                  marginTop: 8,
                  border: "1px solid var(--cr-border)",
                  borderRadius: 14,
                  padding: "10px 12px",
                  background: "var(--cr-card)",
                  display: "grid",
                  gap: 8,
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                  <div style={{ fontWeight: 900 }}>{analysisReadiness.ready ? "Ready for submission" : "Not ready for submission"}</div>
                  <button
                    type="button"
                    className="crBtn crBtnGhost"
                    data-no-nav="true"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      runAiScanNow().catch(() => {});
                    }}
                    disabled={aiBusy || disabled}
                    title="Run AI scan to help populate impact quickly"
                  >
                    {aiBusy ? "Scanning…" : "Run AI scan"}
                  </button>
                </div>

                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, fontSize: 12, opacity: 0.95 }}>
                  {analysisReadiness.items.map((it) => (
                    <span key={it.label} style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <span style={{ opacity: 0.9 }}>{it.ok ? "✅" : "⬜"}</span>
                      <span style={{ opacity: it.ok ? 0.95 : 0.8 }}>{it.label}</span>
                    </span>
                  ))}
                </div>

                {!analysisReadiness.ready ? <div style={{ fontSize: 12, opacity: 0.85 }}>{analysisReadiness.blockingMsg}</div> : null}
              </div>
            ) : null}

            {error ? <div className="crTopErr">{error}</div> : null}
          </div>

          <div className="crTopbarRight" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button type="button" className="crBtn crBtnGhost" onClick={() => setPanelParam("comment")} disabled={!routeIsDbId} title="Open comments (placeholder panel)">
              Comment
            </button>

            <button
              type="button"
              className="crBtn crBtnGhost"
              onClick={() => {
                setAttachOpen(true);
                setPanelParam("attach");
              }}
              disabled={!routeIsDbId}
              title="Open attachments"
            >
              {/* ✅ count on button */}
              Attach{attCountLoading ? "" : attCount > 0 ? ` (${attCount})` : ""}
            </button>

            <button
              type="button"
              className="crBtn crBtnGhost"
              onClick={() => {
                setTimelineOpen(true);
                setPanelParam("timeline");
              }}
              disabled={!routeIsDbId}
              title="Open timeline"
            >
              Timeline
            </button>

            <button
              type="button"
              className="crBtn crBtnGhost"
              onClick={async (e) => {
                e.preventDefault();
                e.stopPropagation();
                if (routeIsDbId) {
                  setPanelParam("ai");
                  runAiScanNow().catch(() => {});
                  return;
                }
                setDraftAiOpen(true);
                if (!draftAi) await runDraftCopilotScanNow();
              }}
              disabled={!safeStr(projectId).trim()}
              title="Open AI co-pilot"
            >
              {aiBusy || draftAiBusy ? "AI…" : "AI"}
            </button>

            <button type="button" className="crBtn" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} disabled={saving || loading} title="Toggle theme">
              {mounted ? (theme === "dark" ? "Light theme" : "Dark theme") : "Theme"}
            </button>

            {canSubmit ? (
              <button type="button" className="crPrimaryBtn" onClick={doSubmit} disabled={saving || loading}>
                {saving ? "Submitting…" : "Submit for approval"}
              </button>
            ) : routeIsDbId && lane === "analysis" && !lockedByGovernance ? (
              <button
                type="button"
                className="crPrimaryBtn"
                onClick={doSubmit}
                disabled={true}
                title="Complete the readiness checklist before submitting"
                style={{ opacity: 0.6, cursor: "not-allowed" }}
              >
                Submit for approval
              </button>
            ) : null}

            {canApprove ? (
              <button type="button" className="crPrimaryBtn" onClick={doApprove} disabled={saving || loading}>
                {saving ? "Approving…" : "Approve"}
              </button>
            ) : null}

            {canRework ? (
              <button type="button" className="crBtn" onClick={doRequestChanges} disabled={saving || loading}>
                Request rework
              </button>
            ) : null}

            {canReject ? (
              <button type="button" className="crBtn" onClick={doReject} disabled={saving || loading}>
                Reject
              </button>
            ) : null}

            <button type="button" className="crPrimaryBtn" onClick={save} disabled={disabled} title={lockedByGovernance ? "Locked while in review" : "Save"}>
              {saving ? "Saving…" : "Save changes"}
            </button>

            <button type="button" className="crBtn crBtnGhost" onClick={() => router.push(boardReturnHref())}>
              Back to board
            </button>
          </div>
        </div>

        <div className="crFormGrid">
          {/* LEFT / MAIN */}
          <div className="crSection">
            <h2 className="crH2">Change Summary</h2>

            <div className="crField">
              <label className="crLabel">Title *</label>
              <input className="crInput" value={model.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g., Extend firewall scope for vendor access" disabled={disabled} />
            </div>

            <div className="crFieldRow">
              <div className="crField">
                <label className="crLabel">Requester</label>
                <input className="crInput" value={model.requester} onChange={(e) => set("requester", e.target.value)} placeholder="Name" disabled={disabled} />
              </div>

              <div className="crField">
                <label className="crLabel">Status</label>
                <select className="crSelect" value={model.status} onChange={(e) => set("status", normalizeStatus(e.target.value))} disabled={disabled}>
                  {CHANGE_COLUMNS.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div className="crField">
                <label className="crLabel">Priority</label>
                <select className="crSelect" value={model.priority} onChange={(e) => set("priority", normalizePriority(e.target.value))} disabled={disabled}>
                  <option>Low</option>
                  <option>Medium</option>
                  <option>High</option>
                  <option>Critical</option>
                </select>
              </div>
            </div>

            <div className="crField">
              <label className="crLabel">Summary *</label>
              <textarea
                className="crTextarea"
                value={model.summary}
                onChange={(e) => set("summary", e.target.value)}
                rows={4}
                placeholder="2–3 line summary for quick scanning..."
                disabled={disabled}
                style={{ resize: "vertical" }}
              />
            </div>

            {!routeIsDbId ? (
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                <button
                  className="crBtn"
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDraftAiOpen(true);
                    runDraftCopilotScanNow().catch(() => {});
                  }}
                  disabled={!safeStr(projectId).trim()}
                >
                  {draftAiBusy ? "Scanning…" : "Run AI scan"}
                </button>
                <div style={{ fontSize: 12, opacity: 0.8 }}>
                  Draft ID: <span style={{ opacity: 0.95 }}>{draftId}</span>
                </div>
              </div>
            ) : null}
          </div>

          {/* RIGHT / ASIDE */}
          <div className="crAside">
            <AiImpactPanel
              days={model.aiImpact.days}
              cost={model.aiImpact.cost}
              risk={model.aiImpact.risk}
              onChange={(next) => set("aiImpact", next)}
              onAiScan={runAiScanNow}
              aiBusy={aiBusy || draftAiBusy}
              disabled={disabled || !safeStr(projectId).trim()}
            />
          </div>

          <div className="crSection crSpanAll">
            <h2 className="crH2">Business Justification</h2>
            <textarea
              className="crTextarea"
              value={model.justification ?? ""}
              onChange={(e) => set("justification", e.target.value)}
              rows={4}
              placeholder="Why is this change needed? What value does it unlock?"
              disabled={disabled}
              style={{ resize: "vertical" }}
            />
          </div>

          <div className="crSection crSpanAll">
            <h2 className="crH2">Financial Impact</h2>
            <textarea
              className="crTextarea"
              value={model.financial ?? ""}
              onChange={(e) => set("financial", e.target.value)}
              rows={4}
              placeholder="Cost drivers, budget impact, commercial notes..."
              disabled={disabled}
              style={{ resize: "vertical" }}
            />
          </div>

          <div className="crSection crSpanAll">
            <h2 className="crH2">Schedule Impact</h2>
            <textarea
              className="crTextarea"
              value={model.schedule ?? ""}
              onChange={(e) => set("schedule", e.target.value)}
              rows={4}
              placeholder="Milestone impacts, critical path changes, sequencing..."
              disabled={disabled}
              style={{ resize: "vertical" }}
            />
          </div>

          <div className="crSection crSpanAll">
            <h2 className="crH2">Risks &amp; Dependencies</h2>
            <div className="crFieldRow" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <div className="crField">
                <label className="crLabel">Risks</label>
                <textarea
                  className="crTextarea"
                  value={model.risks ?? ""}
                  onChange={(e) => set("risks", e.target.value)}
                  rows={4}
                  placeholder="Top risks and mitigations..."
                  disabled={disabled}
                  style={{ resize: "vertical" }}
                />
              </div>

              <div className="crField">
                <label className="crLabel">Dependencies</label>
                <textarea
                  className="crTextarea"
                  value={model.dependencies ?? ""}
                  onChange={(e) => set("dependencies", e.target.value)}
                  rows={4}
                  placeholder="Approvals, vendors, technical prerequisites..."
                  disabled={disabled}
                  style={{ resize: "vertical" }}
                />
              </div>
            </div>
          </div>

          <div className="crSection crSpanAll">
            <h2 className="crH2">Tags</h2>

            <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center" }}>
              <input
                className="crInput"
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                placeholder="Add a tag (e.g., Security)"
                disabled={disabled}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <button className="crPrimaryBtn" type="button" onClick={addTag} disabled={disabled}>
                Add
              </button>
            </div>

            <div className="crChips" style={{ marginTop: 10, gap: 8 }}>
              {(model.tags ?? []).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="crChipBtn"
                  onClick={() => removeTag(t)}
                  title="Remove tag"
                  disabled={disabled}
                  style={{
                    borderRadius: 999,
                    border: "1px solid var(--cr-border)",
                    background: "var(--cr-input-bg2)",
                    color: "var(--cr-text)",
                    padding: "6px 10px",
                    fontSize: 12,
                    cursor: disabled ? "not-allowed" : "pointer",
                    display: "inline-flex",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  {t} <span style={{ opacity: 0.7 }}>×</span>
                </button>
              ))}
            </div>
          </div>

          <ChangeTimeline
            open={timelineOpen}
            onClose={() => {
              setTimelineOpen(false);
              if (panel === "timeline") setPanelParam("");
            }}
            projectId={safeStr(projectId)}
            projectCode={projectCode as any} // ✅ NEW: lets Timeline display human PRJ id even if API fallback
            changeId={routeId}
            changeCode={uiId || undefined}
          />
        </div>

        <ChangeAiDrawer
          open={routeIsDbId && panel === "ai"}
          onClose={() => setPanelParam("")}
          changeId={routeId}
          projectId={projectId}
          title={safeStr(model.title) || uiId || "Change request"}
        />

        <ModalShell open={draftAiOpen} title={`AI Co-pilot (Draft)${uiId ? ` • ${uiId}` : ""}`} onClose={() => setDraftAiOpen(false)}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="crPrimaryBtn" type="button" onClick={() => runDraftCopilotScanNow()} disabled={draftAiBusy || !safeStr(projectId).trim()}>
                {draftAiBusy ? "Scanning…" : "Run AI scan"}
              </button>

              <button className="crBtn crBtnGhost" type="button" onClick={() => setDraftAutoScan((v) => !v)} title="Auto-scan while typing">
                Auto-scan: {draftAutoScan ? "On" : "Off"}
              </button>

              <div style={{ fontSize: 12, opacity: 0.8 }}>
                Project: <span style={{ opacity: 0.95 }}>{safeStr(projectCode ?? projectId) || "—"}</span>
                <span style={{ opacity: 0.5 }}> • </span>
                Draft: <span style={{ opacity: 0.95 }}>{draftId}</span>
              </div>

              {draftAiErr ? <div className="crErr">{draftAiErr}</div> : null}
            </div>

            <div style={{ borderTop: "1px solid var(--cr-border)", paddingTop: 12 }}>{renderDraftAi(draftAi)}</div>
          </div>
        </ModalShell>

        {/* Attachments modal */}
        <ModalShell
          open={attachOpen}
          title={`Attachments${uiId ? ` • ${uiId}` : ""}`}
          onClose={() => {
            setAttachOpen(false);
            if (panel === "attach") setPanelParam("");
          }}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 8 }}>
              <div style={{ fontSize: 13, opacity: 0.85 }}>Upload files to support the change request (emails, screenshots, approvals).</div>

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label className="crBtn" style={{ cursor: uploading ? "not-allowed" : "pointer" }}>
                  {uploading ? "Uploading…" : "Upload file"}
                  <input
                    type="file"
                    style={{ display: "none" }}
                    disabled={uploading || !routeIsDbId}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      uploadAttachment(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </label>

                <button className="crBtn crBtnGhost" type="button" disabled={attLoading} onClick={loadAttachments}>
                  {attLoading ? "Refreshing…" : "Refresh"}
                </button>

                {attErr ? <div className="crErr">{attErr}</div> : null}
              </div>
            </div>

            <div style={{ borderTop: "1px solid var(--cr-border)", paddingTop: 12 }}>
              {attLoading ? (
                <div style={{ opacity: 0.85 }}>Loading attachments…</div>
              ) : attachments.length ? (
                <div style={{ display: "grid", gap: 10 }}>
                  {attachments.map((a, idx) => {
                    const name = attachmentName(a);
                    const size = formatBytes((a as any).size ?? (a as any).size_bytes);
                    const url = safeStr((a as any)?.url || (a as any)?.signedUrl).trim();

                    return (
                      <div
                        key={safeStr(a.id) || safeStr((a as any)?.path) || `${idx}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 10,
                          alignItems: "center",
                          border: "1px solid var(--cr-border)",
                          borderRadius: 14,
                          padding: "10px 12px",
                          background: "var(--cr-card)",
                        }}
                      >
                        <div style={{ display: "grid", gap: 4 }}>
                          <div style={{ fontWeight: 700 }}>{name}</div>
                          <div style={{ fontSize: 12, opacity: 0.8 }}>
                            {size ? <span>{size}</span> : null}
                            {safeStr(a.created_at) ? (
                              <span>
                                {size ? " • " : ""}
                                {safeStr(a.created_at)}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          {url ? (
                            <a className="crBtn crBtnGhost" href={url} target="_blank" rel="noreferrer">
                              Open
                            </a>
                          ) : (
                            <div style={{ fontSize: 12, opacity: 0.7 }}>No URL</div>
                          )}

                          <button
                            type="button"
                            className="crBtn"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              deleteAttachment(a);
                            }}
                            disabled={uploading || attLoading}
                            title="Delete attachment"
                            style={{ opacity: 0.92 }}
                          >
                            {uploading ? "…" : "Delete"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ opacity: 0.85 }}>No attachments found.</div>
              )}
            </div>
          </div>
        </ModalShell>
      </section>
    </section>
  );
}
