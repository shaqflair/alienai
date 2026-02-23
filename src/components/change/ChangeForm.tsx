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
  open?:  boolean;
  titleText?:  string;
  subtitleText?: string;

  projectId: string;
  projectTitle?: string;
  projectLabel?: string;
  artifactId?: string | null;

  /** For edit mode: the DB uuid of the change */
  changeId?: string | null;

  initialValue?: Partial<ChangeFormValue>;

  onSubmit?:  (payload: {
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

  /** Called after a successful delete */
  onDelete?: () => void;

  onClose?:  () => void;
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

export function uiStatusToDeliveryLane(s: ChangeStatus): DeliveryLane {
  if (s === "new") return "intake";
  if (s === "analysis") return "analysis";
  if (s === "review") return "review";
  if (s === "in_progress") return "in_progress";
  if (s === "implemented") return "implemented";
  return "closed";
}

/** A CR is "draft" (deletable) only when in intake or analysis */
function isDraftLane(status: ChangeStatus): boolean {
  return status === "new" || status === "analysis";
}

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

async function apiDelete(url: string) {
  const res = await fetch(url, { method: "DELETE" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) {
    throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  }
  return json;
}

/* ─── Design tokens ─── */
const T = {
  bg: "#0d0f14",
  panel: "#13161e",
  panelBorder: "rgba(255,255,255,0.06)",
  surface: "#1a1e2a",
  surfaceBorder: "rgba(255,255,255,0.08)",
  surfaceHover: "#1f2436",
  accent: "#6c8fff",
  accentGlow: "rgba(108,143,255,0.18)",
  accentAlt: "#a78bfa",
  danger: "#f87171",
  dangerGlow: "rgba(248,113,113,0.15)",
  amber: "#fbbf24",
  green: "#34d399",
  text: "#e8eaf4",
  textMid: "#9ba3c4",
  textDim: "#4e5470",
  radius: "14px",
  radiusSm: "8px",
  font: "'Sora', 'DM Sans', system-ui, sans-serif",
  fontMono: "'JetBrains Mono', 'Fira Code', monospace",
};

/* ─── Global styles injected once ─── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap');

  .cf-overlay {
    position:fixed; inset:0; z-index:9000;
    background:rgba(6,8,14,0.82);
    backdrop-filter:blur(12px);
    display:flex; align-items:center; justify-content:center;
    padding:20px;
    animation: cf-fadein 0.2s ease;
  }
  @keyframes cf-fadein { from{opacity:0} to{opacity:1} }

  .cf-modal {
    width:min(1080px,98vw);
    max-height:92vh;
    background:${T.panel};
    border:1px solid ${T.panelBorder};
    border-radius:20px;
    box-shadow:0 32px 96px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04);
    display:flex; flex-direction:column;
    overflow:hidden;
    animation:cf-slidein 0.25s cubic-bezier(0.34,1.56,0.64,1);
    font-family:${T.font};
    color:${T.text};
  }
  @keyframes cf-slidein {
    from{opacity:0;transform:translateY(24px) scale(0.97)}
    to{opacity:1;transform:translateY(0) scale(1)}
  }

  /* Header */
  .cf-header {
    display:grid;
    grid-template-columns:1fr auto;
    align-items:start;
    gap:16px;
    padding:22px 28px 18px;
    border-bottom:1px solid ${T.panelBorder};
    background:linear-gradient(180deg,${T.surface} 0%, transparent 100%);
    flex-shrink:0;
  }
  .cf-header-title {
    font-size:18px; font-weight:700;
    color:${T.text}; letter-spacing:-0.02em;
  }
  .cf-header-sub {
    font-size:12px; color:${T.textMid};
    margin-top:3px;
  }
  .cf-header-meta {
    display:flex; gap:8px; align-items:center; flex-wrap:wrap;
    margin-top:10px;
  }
  .cf-chip {
    display:inline-flex; align-items:center; gap:5px;
    padding:3px 10px;
    background:${T.surface}; border:1px solid ${T.surfaceBorder};
    border-radius:20px; font-size:10.5px; font-weight:600;
    color:${T.textMid}; letter-spacing:0.04em; text-transform:uppercase;
  }
  .cf-chip-accent { color:${T.accent}; border-color:rgba(108,143,255,0.25); background:rgba(108,143,255,0.08); }
  .cf-chip-dot { width:5px;height:5px;border-radius:50%; }

  /* Header actions */
  .cf-hactions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }

  /* Body scroll */
  .cf-body {
    display:grid;
    grid-template-columns:1fr 300px;
    flex:1; overflow:hidden;
  }
  .cf-main { overflow-y:auto; padding:24px 24px 32px; display:flex; flex-direction:column; gap:20px; }
  .cf-sidebar {
    overflow-y:auto;
    background:${T.bg};
    border-left:1px solid ${T.panelBorder};
    padding:20px;
    display:flex; flex-direction:column; gap:16px;
  }
  .cf-main::-webkit-scrollbar, .cf-sidebar::-webkit-scrollbar { width:4px; }
  .cf-main::-webkit-scrollbar-track, .cf-sidebar::-webkit-scrollbar-track { background:transparent; }
  .cf-main::-webkit-scrollbar-thumb, .cf-sidebar::-webkit-scrollbar-thumb { background:${T.textDim}; border-radius:2px; }

  /* Cards */
  .cf-card {
    background:${T.surface};
    border:1px solid ${T.surfaceBorder};
    border-radius:${T.radius};
    padding:20px;
  }
  .cf-card-title {
    font-size:11px; font-weight:700;
    letter-spacing:0.1em; text-transform:uppercase;
    color:${T.textMid}; margin-bottom:16px;
    display:flex; align-items:center; gap:8px;
  }
  .cf-card-title::after {
    content:'';flex:1;height:1px;background:${T.surfaceBorder};
  }

  /* Fields */
  .cf-field { display:flex; flex-direction:column; gap:6px; }
  .cf-label {
    font-size:11px; font-weight:600; letter-spacing:0.05em;
    text-transform:uppercase; color:${T.textMid};
  }
  .cf-label-req { color:${T.accent}; }

  .cf-input, .cf-select, .cf-textarea {
    width:100%;
    background:${T.bg};
    border:1px solid ${T.surfaceBorder};
    border-radius:${T.radiusSm};
    padding:10px 14px;
    font-size:13px; font-family:${T.font};
    color:${T.text};
    outline:none;
    transition:border-color 0.15s, box-shadow 0.15s, background 0.15s;
    box-sizing:border-box;
    resize:none;
  }
  .cf-input::placeholder, .cf-textarea::placeholder { color:${T.textDim}; }
  .cf-input:focus, .cf-select:focus, .cf-textarea:focus {
    border-color:${T.accent};
    box-shadow:0 0 0 3px ${T.accentGlow};
    background:rgba(108,143,255,0.04);
  }
  .cf-input:disabled, .cf-select:disabled, .cf-textarea:disabled {
    opacity:0.45; cursor:not-allowed;
  }
  .cf-select {
    appearance:none;
    background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ba3c4' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat:no-repeat;
    background-position:right 12px center;
    padding-right:32px;
    cursor:pointer;
  }
  .cf-select option { background:${T.surface}; }

  .cf-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  .cf-row-3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px; }

  /* Relative wrapper for inline AI button */
  .cf-field-wrap { position:relative; }
  .cf-inline-ai {
    position:absolute; top:8px; right:8px; z-index:2;
    display:inline-flex; align-items:center; gap:5px;
    padding:4px 10px;
    background:rgba(108,143,255,0.12);
    border:1px solid rgba(108,143,255,0.3);
    border-radius:6px;
    font-size:10px; font-weight:700;
    color:${T.accent}; letter-spacing:0.04em;
    cursor:pointer; transition:all 0.12s;
  }
  .cf-inline-ai:hover:not(:disabled) {
    background:rgba(108,143,255,0.22);
    border-color:${T.accent};
  }
  .cf-inline-ai:disabled { opacity:0.35; cursor:not-allowed; }

  /* Buttons */
  .cf-btn {
    display:inline-flex; align-items:center; justify-content:center; gap:7px;
    padding:9px 18px;
    border-radius:9px; border:none;
    font-size:12.5px; font-weight:600; font-family:${T.font};
    cursor:pointer; transition:all 0.15s;
    white-space:nowrap;
  }
  .cf-btn:disabled { opacity:0.4; cursor:not-allowed; }

  .cf-btn-primary {
    background:linear-gradient(135deg,${T.accent},${T.accentAlt});
    color:#fff;
    box-shadow:0 2px 16px rgba(108,143,255,0.3);
  }
  .cf-btn-primary:hover:not(:disabled) {
    box-shadow:0 4px 24px rgba(108,143,255,0.45);
    transform:translateY(-1px);
  }

  .cf-btn-ghost {
    background:transparent;
    border:1px solid ${T.surfaceBorder};
    color:${T.textMid};
  }
  .cf-btn-ghost:hover:not(:disabled) {
    background:${T.surfaceHover};
    color:${T.text};
    border-color:rgba(255,255,255,0.15);
  }

  .cf-btn-ai {
    background:rgba(108,143,255,0.1);
    border:1px solid rgba(108,143,255,0.28);
    color:${T.accent};
  }
  .cf-btn-ai:hover:not(:disabled) {
    background:rgba(108,143,255,0.2);
    box-shadow:0 0 16px rgba(108,143,255,0.2);
  }

  .cf-btn-danger {
    background:${T.dangerGlow};
    border:1px solid rgba(248,113,113,0.3);
    color:${T.danger};
  }
  .cf-btn-danger:hover:not(:disabled) {
    background:rgba(248,113,113,0.22);
    border-color:${T.danger};
    box-shadow:0 0 16px ${T.dangerGlow};
  }

  .cf-btn-sm { padding:6px 12px; font-size:11px; border-radius:7px; }

  /* Error */
  .cf-err {
    margin:0 24px;
    padding:10px 14px;
    background:${T.dangerGlow};
    border:1px solid rgba(248,113,113,0.25);
    border-radius:9px;
    font-size:12px; color:${T.danger};
    flex-shrink:0;
  }

  /* Footer */
  .cf-footer {
    display:flex; align-items:center; justify-content:space-between;
    padding:14px 24px;
    border-top:1px solid ${T.panelBorder};
    background:${T.bg};
    flex-shrink:0;
    gap:12px;
  }
  .cf-footer-meta { font-size:11px; color:${T.textDim}; }
  .cf-footer-actions { display:flex; gap:8px; align-items:center; }

  /* Delete confirm */
  .cf-delete-confirm {
    position:absolute; inset:0; z-index:10;
    display:flex; align-items:center; justify-content:center;
    background:rgba(13,15,20,0.88);
    backdrop-filter:blur(8px);
    border-radius:20px;
    animation:cf-fadein 0.15s ease;
  }
  .cf-delete-box {
    background:${T.surface};
    border:1px solid rgba(248,113,113,0.3);
    border-radius:16px;
    padding:28px 32px;
    max-width:380px;
    text-align:center;
    box-shadow:0 20px 60px rgba(0,0,0,0.6), 0 0 0 1px rgba(248,113,113,0.1);
  }
  .cf-delete-icon {
    width:48px; height:48px;
    background:${T.dangerGlow};
    border:1px solid rgba(248,113,113,0.3);
    border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    margin:0 auto 16px;
  }
  .cf-delete-title { font-size:16px; font-weight:700; margin-bottom:8px; }
  .cf-delete-desc { font-size:12.5px; color:${T.textMid}; margin-bottom:20px; line-height:1.6; }
  .cf-delete-actions { display:flex; gap:10px; justify-content:center; }

  /* AI Drawer */
  .cf-drawer-overlay {
    position:fixed; inset:0; z-index:9100;
    background:rgba(6,8,14,0.6);
    backdrop-filter:blur(6px);
    animation:cf-fadein 0.15s ease;
  }
  .cf-drawer {
    position:absolute; right:0; top:0; height:100%;
    width:min(480px,96vw);
    background:${T.panel};
    border-left:1px solid ${T.panelBorder};
    display:flex; flex-direction:column;
    box-shadow:-24px 0 80px rgba(0,0,0,0.5);
    animation:cf-drawer-in 0.22s cubic-bezier(0.34,1.2,0.64,1);
  }
  @keyframes cf-drawer-in {
    from{transform:translateX(40px);opacity:0}
    to{transform:translateX(0);opacity:1}
  }
  .cf-drawer-head {
    padding:18px 20px;
    border-bottom:1px solid ${T.panelBorder};
    display:flex; align-items:center; justify-content:space-between;
    background:${T.surface};
    flex-shrink:0;
  }
  .cf-drawer-body { flex:1; overflow-y:auto; padding:20px; display:flex; flex-direction:column; gap:16px; }
  .cf-drawer-body::-webkit-scrollbar { width:3px; }
  .cf-drawer-body::-webkit-scrollbar-thumb { background:${T.textDim}; border-radius:2px; }

  /* Interview field */
  .cf-ifield { display:flex; flex-direction:column; gap:6px; }
  .cf-ifield label { font-size:11px; font-weight:600; color:${T.textMid}; letter-spacing:0.05em; text-transform:uppercase; }

  /* Attachments */
  .cf-att-item {
    display:flex; align-items:center; justify-content:space-between; gap:10px;
    padding:9px 12px;
    background:${T.bg}; border:1px solid ${T.surfaceBorder};
    border-radius:${T.radiusSm};
  }
  .cf-att-name { font-size:12px; font-weight:600; color:${T.text}; }
  .cf-att-size { font-size:10px; color:${T.textDim}; margin-top:1px; }

  /* Impact meter */
  .cf-impact-grid { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .cf-impact-cell {
    background:${T.bg}; border:1px solid ${T.surfaceBorder};
    border-radius:10px; padding:12px;
    display:flex; flex-direction:column; gap:4px;
  }
  .cf-impact-label { font-size:9px; font-weight:700; letter-spacing:0.1em; text-transform:uppercase; color:${T.textDim}; }
  .cf-impact-val { font-size:20px; font-weight:800; font-family:${T.fontMono}; color:${T.text}; letter-spacing:-0.02em; }
  .cf-impact-val-sm { font-size:13px; }

  /* Progress bar */
  .cf-risk-bar {
    height:3px; border-radius:2px; margin-top:4px;
    background:linear-gradient(90deg,${T.green},${T.amber},${T.danger});
    width:100%; overflow:hidden;
  }
  .cf-risk-fill { height:100%; background:${T.text}; opacity:0.15; transition:width 0.4s; }

  /* PM tips */
  .cf-tip {
    display:flex; gap:10px; align-items:flex-start;
    padding:10px 12px; background:${T.bg};
    border:1px solid ${T.surfaceBorder}; border-radius:9px;
    font-size:11.5px; line-height:1.55; color:${T.textMid};
  }
  .cf-tip-icon { flex-shrink:0; margin-top:1px; color:${T.accent}; }

  /* Proj resolve notice */
  .cf-proj-warn {
    display:inline-flex; align-items:center; gap:5px;
    padding:4px 10px; background:rgba(251,191,36,0.1);
    border:1px solid rgba(251,191,36,0.25); border-radius:6px;
    font-size:10.5px; color:${T.amber};
  }

  /* Draft ready badge */
  .cf-draft-ready {
    display:inline-flex; align-items:center; gap:5px;
    padding:4px 10px; background:rgba(52,211,153,0.1);
    border:1px solid rgba(52,211,153,0.25); border-radius:6px;
    font-size:10.5px; color:${T.green};
  }

  /* Scrollbar for modal */
  .cf-modal ::-webkit-scrollbar { width:4px; height:4px; }
  .cf-modal ::-webkit-scrollbar-track { background:transparent; }
  .cf-modal ::-webkit-scrollbar-thumb { background:${T.textDim}; border-radius:2px; }

  /* Section divider label */
  .cf-divider-label {
    display:flex; align-items:center; gap:10px;
    font-size:10px; font-weight:700; letter-spacing:0.12em;
    text-transform:uppercase; color:${T.textDim};
    margin-bottom:-4px;
  }
  .cf-divider-label::before, .cf-divider-label::after {
    content:''; flex:1; height:1px; background:${T.surfaceBorder};
  }
`;

let cfCssInjected = false;
function injectCfCss() {
  if (typeof document === "undefined" || cfCssInjected) return;
  cfCssInjected = true;
  const el = document.createElement("style");
  el.textContent = GLOBAL_CSS;
  document.head.appendChild(el);
}

/* ─── Inline AI button ─── */
function InlineAiBtn({ disabled, busy, onClick, title }: { disabled?: boolean; busy?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" className="cf-inline-ai" onClick={onClick} disabled={disabled || busy} title={title}>
      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
      {busy ? "…" : "AI"}
    </button>
  );
}

/* ─── Drawer (AI Interview) ─── */
function Drawer({ open, onClose, children, title, sub }: { open?:  boolean; onClose?:  () => void; children: React.ReactNode; title: string; sub?: string }) {
  if (!open) return null;
  return (
    <div className="cf-drawer-overlay" role="dialog" aria-modal="true">
      <div className="cf-drawer">
        <div className="cf-drawer-head">
          <div>
            {sub && <div style={{ fontSize: 10, color: T.accent, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>{sub}</div>}
            <div style={{ fontSize: 15, fontWeight: 700, color: T.text }}>{title}</div>
          </div>
          <button type="button" className="cf-btn cf-btn-ghost cf-btn-sm" onClick={onClose}>✕ Close</button>
        </div>
        <div className="cf-drawer-body">{children}</div>
      </div>
    </div>
  );
}

/* ─── Defaults ─── */
const DEFAULTS: ChangeFormValue = {
  title: "", requester: "", status: "new", priority: "Medium", summary: "",
  justification: "", financial: "", schedule: "", risks: "", dependencies: "",
  assumptions: "", implementationPlan: "", rollbackPlan: "",
  aiImpact: { days: 0, cost: 0, risk: "None identified" },
  files: [],
};

/* ─── Priority color map ─── */
function priorityColor(p: ChangePriority) {
  if (p === "Critical") return T.danger;
  if (p === "High") return "#fb923c";
  if (p === "Medium") return T.amber;
  return T.textMid;
}

/* ─── StatusDot ─── */
function StatusDot({ status }: { status: ChangeStatus }) {
  const colors: Record<ChangeStatus, string> = {
    new: T.textMid, analysis: T.amber, review: T.accent,
    in_progress: "#60a5fa", implemented: T.green, closed: T.textDim,
  };
  return <span className="cf-chip-dot" style={{ background: colors[status] ?? T.textMid }} />;
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════ */
export default function ChangeForm(props: ChangeFormProps) {
  const { mode, open, titleText, subtitleText, projectId, artifactId, changeId, initialValue, onSubmit, onDelete, onClose } = props;

  useEffect(() => { injectCfCss(); }, []);

  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState("");

  const [resolvedProjectId, setResolvedProjectId] = useState<string>("");
  const [projResolveBusy, setProjResolveBusy] = useState(false);
  const [projResolveErr, setProjResolveErr] = useState("");

  const [v, setV] = useState<ChangeFormValue>(DEFAULTS);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [drafts, setDrafts] = useState<DraftAssistAi | null>(null);
  const [draftModel, setDraftModel] = useState("rules-v1");

  const [aiInterviewOpen, setAiInterviewOpen] = useState(false);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [interview, setInterview] = useState<AiInterview>({
    about: "", why: "", impacted: "", when: "",
    constraints: "", costs: "", riskLevel: "Medium", rollback: "",
  });

  const disabled = saving || projResolveBusy || deleting;
  const draftId = useMemo(() => newDraftId(), [open]);

  /* Can this CR be deleted? Only if it's still in intake/analysis */
  const canDelete = mode === "edit" && !!changeId && looksLikeUuid(changeId) && isDraftLane(v.status) && !!onDelete;

  /* ── Resolve project ── */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    async function resolve() {
      const raw = safeStr(projectId).trim();
      setProjResolveErr(""); setResolvedProjectId("");
      if (!raw) { setProjResolveErr("Missing projectId."); return; }
      if (looksLikeUuid(raw)) { setResolvedProjectId(raw); return; }
      try {
        setProjResolveBusy(true);
        const res = await fetch(`/api/projects/${encodeURIComponent(raw)}`, { cache: "no-store" });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json?.ok === false) throw new Error(safeStr(json?.error) || `HTTP ${res.status}`);
        const uuid = safeStr(json?.project?.id || json?.data?.id || json?.item?.id).trim();
        if (!uuid || !looksLikeUuid(uuid)) throw new Error("Project UUID not found from API.");
        if (!cancelled) setResolvedProjectId(uuid);
      } catch (e: any) {
        if (!cancelled) setProjResolveErr(safeStr(e?.message) || "Failed to resolve projectId.");
      } finally {
        if (!cancelled) setProjResolveBusy(false);
      }
    }
    resolve();
    return () => { cancelled = true; };
  }, [open, projectId]);

  /* ── Reset on open ── */
  useEffect(() => {
    if (!open) return;
    setSaving(false); setDeleting(false); setConfirmDelete(false);
    setError(""); setAiErr(""); setDrafts(null); setDraftModel("rules-v1"); setForceOverwrite(false);

    const merged: ChangeFormValue = {
      ...DEFAULTS,
      ...(initialValue ?? {}),
      status: normalizeStatus((initialValue as any)?.status ?? DEFAULTS.status),
      priority: normalizePriority((initialValue as any)?.priority ?? DEFAULTS.priority),
      aiImpact: {
        days: Number((initialValue as any)?.aiImpact?.days ?? 0) || 0,
        cost: Number((initialValue as any)?.aiImpact?.cost ?? 0) || 0,
        risk: safeStr((initialValue as any)?.aiImpact?.risk ?? "None identified") || "None identified",
      },
      files: [],
    };
    setV(merged);

    setInterview({
      about: safeStr(merged.title),
      why: safeStr(merged.summary),
      impacted: merged.requester ? `Requester: ${merged.requester}` : "",
      when: "", constraints: "", costs: [
        merged.aiImpact.cost > 0 ? `£${merged.aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "",
        merged.aiImpact.days > 0 ? `${merged.aiImpact.days}d` : "",
      ].filter(Boolean).join(" / "),
      riskLevel: "Medium", rollback: safeStr(merged.rollbackPlan),
    });
  }, [open, initialValue]);

  /* ── File handling ── */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setV(p => ({ ...p, files: [...p.files, ...Array.from(e.target.files!)] }));
    }
  };
  const removeFile = (i: number) => setV(p => ({ ...p, files: p.files.filter((_, idx) => idx !== i) }));

  /* ── AI helpers ── */
  function improveOrSet(current: string, setter: (v: string) => void, suggestion: string, max = 8000) {
    const s = safeStr(suggestion).trim();
    if (!s) return;
    const cur = safeStr(current).trim();
    setter(clampText(cur.length >= 50 ? `${cur}\n\n—\nImproved:\n${s}` : s, max));
  }

  function hasInterviewSignal() {
    const ok = (x: string) => safeStr(x).trim().length >= 3;
    return ok(interview.about) || ok(interview.why) || ok(interview.impacted) || ok(interview.when);
  }

  function pullIntoInterview(overwrite: boolean) {
    const mapIf = (cur: string, next: string) => overwrite ? next : cur.trim() ? cur : next;
    setInterview(prev => ({
      ...prev,
      about: mapIf(prev.about, safeStr(v.title).trim()),
      why: mapIf(prev.why, safeStr(v.summary).trim()),
      impacted: mapIf(prev.impacted, v.requester ? `Requester: ${v.requester}` : ""),
      costs: mapIf(prev.costs, [
        v.aiImpact.cost > 0 ? `£${v.aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "",
        v.aiImpact.days > 0 ? `${v.aiImpact.days}d` : "",
      ].filter(Boolean).join(" / ")),
      rollback: mapIf(prev.rollback, safeStr(v.rollbackPlan).trim()),
    }));
  }

  async function runDraftAssist(): Promise<DraftAssistAi | null> {
    const pid = safeStr(resolvedProjectId).trim();
    if (!pid) { setAiErr(projResolveErr || "Missing projectId."); return null; }
    setAiErr(""); setAiBusy(true);
    try {
      const j = await apiPost("/api/ai/events", {
        projectId: pid, artifactId: artifactId ?? null,
        eventType: "change_draft_assist_requested",
        severity: "info", source: mode === "edit" ? "change_edit_form" : "change_create_form",
        payload: {
          draftId, mode,
          title: safeStr(v.title), summary: safeStr(v.summary),
          priority: safeStr(v.priority), status: safeStr(v.status),
          requester: safeStr(v.requester),
          justification: safeStr(v.justification), financial: safeStr(v.financial),
          schedule: safeStr(v.schedule), risks: safeStr(v.risks),
          dependencies: safeStr(v.dependencies), assumptions: safeStr(v.assumptions),
          implementation: safeStr(v.implementationPlan), rollback: safeStr(v.rollbackPlan),
          interview,
        },
      }) as DraftAssistResp;
      const ai = (j && typeof j === "object" ? (j as any).ai : null) || null;
      setDrafts(ai); setDraftModel(safeStr((j as any)?.model) || "rules-v1");
      return ai;
    } catch (e: any) {
      setAiErr(safeStr(e?.message) || "AI draft failed");
      setDrafts(null); return null;
    } finally {
      setAiBusy(false);
    }
  }

  async function ensureDrafts(): Promise<DraftAssistAi | null> {
    if (drafts) return drafts;
    if (!hasInterviewSignal()) {
      setAiInterviewOpen(true);
      setAiErr("Tell AI about the change first (Start AI → Generate Draft).");
      return null;
    }
    return runDraftAssist();
  }

  async function applyAllAi() {
    const d = await ensureDrafts();
    if (!d) return;
    setV(p => {
      const n = { ...p };
      const setText = (key: keyof ChangeFormValue, s?: string, max = 8000) => {
        const cur = safeStr((n as any)[key]);
        const sug = safeStr(s);
        if (!sug.trim()) return;
        (n as any)[key] = clampText(cur.trim().length >= 50 ? `${cur}\n\n—\nImproved:\n${sug}` : sug, max);
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
      if (imp) n.aiImpact = { days: Number(imp?.days ?? 0) || 0, cost: Number(imp?.cost ?? 0) || 0, risk: safeStr(imp?.risk ?? "").trim() || "None identified" };
      return n;
    });
  }

  /* ── Submit ── */
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
      const proposed_change = clampText([
        v.justification ? `Justification:\n${v.justification}` : "",
        v.financial ? `Financial:\n${v.financial}` : "",
        v.schedule ? `Schedule:\n${v.schedule}` : "",
        v.risks ? `Risks:\n${v.risks}` : "",
        v.dependencies ? `Dependencies:\n${v.dependencies}` : "",
        v.assumptions ? `Assumptions:\n${v.assumptions}` : "",
        v.implementationPlan ? `Implementation Plan:\n${v.implementationPlan}` : "",
        v.rollbackPlan ? `Rollback / Validation:\n${v.rollbackPlan}` : "",
      ].filter(Boolean).join("\n\n"), 8000);

      const payload: any = {
        title: t, requester: safeStr(v.requester).trim(),
        status: v.status, priority: normalizePriority(v.priority), summary: s,
        justification: v.justification, financial: v.financial, schedule: v.schedule,
        risks: v.risks, dependencies: v.dependencies, assumptions: v.assumptions,
        implementationPlan: v.implementationPlan, rollbackPlan: v.rollbackPlan,
        aiImpact: v.aiImpact, proposed_change, impact_analysis, files: v.files,
      };
      if (mode === "create") payload.delivery_status = uiStatusToDeliveryLane(v.status);
      await onSubmit?.(payload);
      onClose?.();
    } catch (e: any) {
      setError(safeStr(e?.message) || "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  /* ── Delete ── */
  async function doDelete() {
    if (!changeId || !looksLikeUuid(changeId)) return;
    setDeleting(true);
    setError("");
    try {
      await apiDelete(`/api/change/${encodeURIComponent(changeId)}`);
      setConfirmDelete(false);
      if (onDelete) onDelete();
      onClose?.();
    } catch (e: any) {
      setError(safeStr(e?.message) || "Delete failed.");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  if (!open) return null;

  const pColor = priorityColor(v.priority);
  const laneLabel = uiStatusToDeliveryLane(v.status).replace(/_/g, " ");

  return (
    <>
      <div className="cf-overlay" onClick={(e) => { if (e.target === e.currentTarget && !confirmDelete) onClose?.(); }}>
        <div className="cf-modal" style={{ position: "relative" }}>

          {/* ── Header ── */}
          <div className="cf-header">
            <div>
              <div className="cf-header-title">{titleText}</div>
              <div className="cf-header-sub">
                {subtitleText || (mode === "edit" ? "Update this change request with precision." : "Draft a new change request — AI helps fill the gaps.")}
              </div>
              <div className="cf-header-meta">
                <span className="cf-chip">
                  <StatusDot status={v.status} />
                  {v.status.replace(/_/g, " ")}
                </span>
                {v.priority && (
                  <span className="cf-chip" style={{ color: pColor, borderColor: `${pColor}44`, background: `${pColor}14` }}>
                    {v.priority}
                  </span>
                )}
                {projResolveBusy && <span className="cf-proj-warn">⌛ Resolving project…</span>}
                {projResolveErr && !projResolveBusy && <span style={{ fontSize: 10.5, color: T.danger }}>{projResolveErr}</span>}
                {drafts && <span className="cf-draft-ready">✦ AI draft ready · {draftModel}</span>}
              </div>
            </div>

            <div className="cf-hactions">
              <button type="button" className="cf-btn cf-btn-ai cf-btn-sm"
                onClick={() => { pullIntoInterview(false); setAiInterviewOpen(true); }}
                disabled={disabled || aiBusy}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                {aiBusy ? "Scanning…" : "Start AI"}
              </button>

              <button type="button" className="cf-btn cf-btn-ai cf-btn-sm"
                onClick={applyAllAi} disabled={disabled || aiBusy}>
                Apply All AI
              </button>

              {canDelete && (
                <button type="button" className="cf-btn cf-btn-danger cf-btn-sm"
                  onClick={() => setConfirmDelete(true)} disabled={disabled} title="Delete this draft change request">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                  </svg>
                  Delete
                </button>
              )}

              <button type="button" className="cf-btn cf-btn-ghost cf-btn-sm" onClick={onClose} disabled={disabled}>✕ Close</button>

              <button type="button" className="cf-btn cf-btn-primary cf-btn-sm" onClick={submit} disabled={disabled}>
                {saving ? (mode === "edit" ? "Saving…" : "Creating…") : mode === "edit" ? "Save Changes" : "Create CR"}
              </button>
            </div>
          </div>

          {/* ── Error ── */}
          {(error || aiErr) && (
            <div className="cf-err" style={{ margin: "12px 24px 0" }}>
              {error || aiErr}
            </div>
          )}

          {/* ── Body ── */}
          <div className="cf-body">

            {/* Main column */}
            <div className="cf-main">

              {/* — Change Summary — */}
              <div className="cf-card">
                <div className="cf-card-title">Change Summary</div>

                <div className="cf-field" style={{ marginBottom: 14 }}>
                  <label className="cf-label">Title <span className="cf-label-req">*</span></label>
                  <input className="cf-input" value={v.title}
                    onChange={e => setV(p => ({ ...p, title: e.target.value }))}
                    placeholder="e.g., Extend firewall scope for vendor access"
                    disabled={disabled} />
                </div>

                <div className="cf-row-3" style={{ marginBottom: 14 }}>
                  <div className="cf-field">
                    <label className="cf-label">Requester</label>
                    <input className="cf-input" value={v.requester}
                      onChange={e => setV(p => ({ ...p, requester: e.target.value }))}
                      placeholder="Name" disabled={disabled} />
                  </div>
                  <div className="cf-field">
                    <label className="cf-label">Status</label>
                    <select className="cf-select" value={v.status}
                      onChange={e => setV(p => ({ ...p, status: normalizeStatus(e.target.value) }))}
                      disabled={disabled}>
                      <option value="new">New (Intake)</option>
                      <option value="analysis">Analysis</option>
                      <option value="review">Review</option>
                      <option value="in_progress">Implementation</option>
                      <option value="implemented">Implemented</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>
                  <div className="cf-field">
                    <label className="cf-label">Priority <span className="cf-label-req">*</span></label>
                    <select className="cf-select" value={v.priority}
                      onChange={e => setV(p => ({ ...p, priority: normalizePriority(e.target.value) }))}
                      disabled={disabled}
                      style={{ borderColor: `${pColor}55` }}>
                      <option>Low</option>
                      <option>Medium</option>
                      <option>High</option>
                      <option>Critical</option>
                    </select>
                  </div>
                </div>

                <div className="cf-field">
                  <label className="cf-label">Summary <span className="cf-label-req">*</span></label>
                  <div className="cf-field-wrap">
                    <textarea className="cf-textarea" value={v.summary}
                      onChange={e => setV(p => ({ ...p, summary: e.target.value }))}
                      rows={4} placeholder="2–3 lines for quick scanning…" disabled={disabled}
                      style={{ paddingRight: 56 }} />
                    <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: write/improve summary"
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSet(v.summary, val => setV(p => ({ ...p, summary: val })), safeStr(d.summary), 1200);
                      }} />
                  </div>
                </div>
              </div>

              {/* — Justification — */}
              <div className="cf-card">
                <div className="cf-card-title">Business Justification</div>
                <div className="cf-field-wrap">
                  <textarea className="cf-textarea" value={v.justification}
                    onChange={e => setV(p => ({ ...p, justification: e.target.value }))}
                    rows={4} placeholder="Why is this needed? What value does it unlock?" disabled={disabled}
                    style={{ paddingRight: 56 }} />
                  <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft justification"
                    onClick={async () => {
                      const d = await ensureDrafts();
                      if (!d) return;
                      improveOrSet(v.justification, val => setV(p => ({ ...p, justification: val })), safeStr(d.justification));
                    }} />
                </div>
              </div>

              {/* — Financial & Schedule — */}
              <div className="cf-row" style={{ alignItems: "start" }}>
                <div className="cf-card">
                  <div className="cf-card-title">Financial Impact</div>
                  <div className="cf-field-wrap">
                    <textarea className="cf-textarea" value={v.financial}
                      onChange={e => setV(p => ({ ...p, financial: e.target.value }))}
                      rows={4} placeholder="Cost drivers, budget, commercial notes…" disabled={disabled}
                      style={{ paddingRight: 56 }} />
                    <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft financials"
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSet(v.financial, val => setV(p => ({ ...p, financial: val })), safeStr(d.financial));
                      }} />
                  </div>
                </div>
                <div className="cf-card">
                  <div className="cf-card-title">Schedule Impact</div>
                  <div className="cf-field-wrap">
                    <textarea className="cf-textarea" value={v.schedule}
                      onChange={e => setV(p => ({ ...p, schedule: e.target.value }))}
                      rows={4} placeholder="Milestone impacts, critical path, sequencing…" disabled={disabled}
                      style={{ paddingRight: 56 }} />
                    <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft schedule"
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSet(v.schedule, val => setV(p => ({ ...p, schedule: val })), safeStr(d.schedule));
                      }} />
                  </div>
                </div>
              </div>

              {/* — Risks & Dependencies — */}
              <div className="cf-card">
                <div className="cf-card-title">Risks & Dependencies</div>
                <div className="cf-row" style={{ marginBottom: 14 }}>
                  <div className="cf-field">
                    <label className="cf-label">Risks</label>
                    <div className="cf-field-wrap">
                      <textarea className="cf-textarea" value={v.risks}
                        onChange={e => setV(p => ({ ...p, risks: e.target.value }))}
                        rows={4} placeholder="Top risks and mitigations…" disabled={disabled}
                        style={{ paddingRight: 56 }} />
                      <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft risks"
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSet(v.risks, val => setV(p => ({ ...p, risks: val })), safeStr(d.risks));
                        }} />
                    </div>
                  </div>
                  <div className="cf-field">
                    <label className="cf-label">Dependencies</label>
                    <div className="cf-field-wrap">
                      <textarea className="cf-textarea" value={v.dependencies}
                        onChange={e => setV(p => ({ ...p, dependencies: e.target.value }))}
                        rows={4} placeholder="Approvals, vendors, prerequisites…" disabled={disabled}
                        style={{ paddingRight: 56 }} />
                      <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft dependencies"
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSet(v.dependencies, val => setV(p => ({ ...p, dependencies: val })), safeStr(d.dependencies));
                        }} />
                    </div>
                  </div>
                </div>
                <div className="cf-field">
                  <label className="cf-label">Assumptions</label>
                  <div className="cf-field-wrap">
                    <textarea className="cf-textarea" value={v.assumptions}
                      onChange={e => setV(p => ({ ...p, assumptions: e.target.value }))}
                      rows={3} placeholder="Any assumptions the plan relies on…" disabled={disabled}
                      style={{ paddingRight: 56 }} />
                    <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft assumptions"
                      onClick={async () => {
                        const d = await ensureDrafts();
                        if (!d) return;
                        improveOrSet(v.assumptions, val => setV(p => ({ ...p, assumptions: val })), safeStr((d as any).assumptions));
                      }} />
                  </div>
                </div>
              </div>

              {/* — Implementation & Rollback — */}
              <div className="cf-card">
                <div className="cf-card-title">Implementation & Rollback</div>
                <div className="cf-row">
                  <div className="cf-field">
                    <label className="cf-label">Implementation Plan</label>
                    <div className="cf-field-wrap">
                      <textarea className="cf-textarea" value={v.implementationPlan}
                        onChange={e => setV(p => ({ ...p, implementationPlan: e.target.value }))}
                        rows={7} placeholder="Steps, sequencing, dependencies, testing, cutover…" disabled={disabled}
                        style={{ paddingRight: 56 }} />
                      <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft implementation plan"
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSet(v.implementationPlan, val => setV(p => ({ ...p, implementationPlan: val })), safeStr((d as any).implementation));
                        }} />
                    </div>
                  </div>
                  <div className="cf-field">
                    <label className="cf-label">Rollback / Validation</label>
                    <div className="cf-field-wrap">
                      <textarea className="cf-textarea" value={v.rollbackPlan}
                        onChange={e => setV(p => ({ ...p, rollbackPlan: e.target.value }))}
                        rows={7} placeholder="How to revert safely + validation checks…" disabled={disabled}
                        style={{ paddingRight: 56 }} />
                      <InlineAiBtn disabled={disabled} busy={aiBusy} title="AI: draft rollback"
                        onClick={async () => {
                          const d = await ensureDrafts();
                          if (!d) return;
                          improveOrSet(v.rollbackPlan, val => setV(p => ({ ...p, rollbackPlan: val })), safeStr((d as any).rollback));
                        }} />
                    </div>
                  </div>
                </div>
              </div>

              {/* — Attachments — */}
              <div className="cf-card">
                <div className="cf-card-title">Attachments</div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 11.5, color: T.textMid }}>Designs, screenshots, vendor comms, impact calcs.</div>
                  <label className="cf-btn cf-btn-ghost cf-btn-sm" style={{ cursor: "pointer" }}>
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
                    </svg>
                    Attach file
                    <input type="file" style={{ display: "none" }} multiple onChange={handleFileSelect} disabled={disabled} />
                  </label>
                </div>
                {v.files.length === 0 ? (
                  <div style={{ padding: "16px", textAlign: "center", border: `1px dashed ${T.surfaceBorder}`, borderRadius: T.radiusSm, fontSize: 12, color: T.textDim }}>
                    No files attached
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {v.files.map((f, i) => (
                      <div key={`${f.name}_${i}`} className="cf-att-item">
                        <div>
                          <div className="cf-att-name">{f.name}</div>
                          <div className="cf-att-size">{(f.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <button type="button" className="cf-btn cf-btn-ghost cf-btn-sm" onClick={() => removeFile(i)} disabled={disabled}>Remove</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

            {/* ── Sidebar ── */}
            <div className="cf-sidebar">

              {/* AI Impact */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.textMid }}>AI Impact</div>
                  <button type="button" className="cf-btn cf-btn-ai cf-btn-sm"
                    onClick={async () => {
                      const d = await ensureDrafts();
                      const imp = (d as any)?.impact;
                      if (!imp) { setAiErr("No impact from AI yet."); return; }
                      setV(p => ({ ...p, aiImpact: { days: Number(imp?.days ?? 0) || 0, cost: Number(imp?.cost ?? 0) || 0, risk: safeStr(imp?.risk ?? "").trim() || "None identified" } }));
                    }}
                    disabled={disabled || aiBusy} title="Estimate with AI">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    {aiBusy ? "…" : "Scan"}
                  </button>
                </div>

                <div className="cf-impact-grid" style={{ marginBottom: 10 }}>
                  <div className="cf-impact-cell">
                    <div className="cf-impact-label">Cost (£)</div>
                    <div className="cf-impact-val cf-impact-val-sm">
                      {v.aiImpact.cost > 0 ? `£${v.aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}
                    </div>
                    <input type="number" className="cf-input" style={{ marginTop: 6, fontSize: 11 }}
                      value={String(v.aiImpact.cost ?? 0)}
                      onChange={e => setV(p => ({ ...p, aiImpact: { ...p.aiImpact, cost: Number(e.target.value || 0) } }))}
                      disabled={disabled} placeholder="0" />
                  </div>
                  <div className="cf-impact-cell">
                    <div className="cf-impact-label">Delay (days)</div>
                    <div className="cf-impact-val">{v.aiImpact.days > 0 ? `+${v.aiImpact.days}d` : "—"}</div>
                    <input type="number" className="cf-input" style={{ marginTop: 6, fontSize: 11 }}
                      value={String(v.aiImpact.days ?? 0)}
                      onChange={e => setV(p => ({ ...p, aiImpact: { ...p.aiImpact, days: Number(e.target.value || 0) } }))}
                      disabled={disabled} placeholder="0" />
                  </div>
                </div>

                <div className="cf-field">
                  <label className="cf-label">Risk descriptor</label>
                  <input type="text" className="cf-input"
                    value={safeStr(v.aiImpact.risk)}
                    onChange={e => setV(p => ({ ...p, aiImpact: { ...p.aiImpact, risk: e.target.value } }))}
                    disabled={disabled} placeholder="e.g., Medium — mitigated by rollback plan" />
                  <div style={{ fontSize: 10, color: T.textDim, marginTop: 3 }}>Include risk level + mitigation condition.</div>
                </div>
              </div>

              <div style={{ height: 1, background: T.panelBorder }} />

              {/* Delete section — only for draft CRs */}
              {canDelete && (
                <>
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.textDim, marginBottom: 10 }}>
                      Draft Actions
                    </div>
                    <div style={{ padding: "12px", background: T.dangerGlow, border: `1px solid rgba(248,113,113,0.2)`, borderRadius: T.radiusSm }}>
                      <div style={{ fontSize: 11.5, color: T.danger, fontWeight: 600, marginBottom: 6 }}>Delete this CR</div>
                      <div style={{ fontSize: 11, color: T.textMid, marginBottom: 10, lineHeight: 1.55 }}>
                        Permanently removes this draft. Only available while in Intake or Analysis.
                      </div>
                      <button type="button" className="cf-btn cf-btn-danger cf-btn-sm"
                        style={{ width: "100%", justifyContent: "center" }}
                        onClick={() => setConfirmDelete(true)} disabled={disabled}>
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                          <path d="M10 11v6M14 11v6" />
                        </svg>
                        Delete Draft CR
                      </button>
                    </div>
                  </div>
                  <div style={{ height: 1, background: T.panelBorder }} />
                </>
              )}

              {/* PM Tips */}
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.textMid, marginBottom: 10 }}>PM Tips</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {[
                    { icon: "⚡", text: "Use Start AI if the form is empty — give it a title and summary first." },
                    { icon: "📐", text: "Keep impacts measurable: £, days, named services, exact implementation window." },
                    { icon: "🔁", text: "Approvers want: test evidence, a rollback plan, and a clear comms message." },
                    { icon: "🗑️", text: canDelete ? "Delete is available while in Intake or Analysis only." : "Delete is locked once CR moves past Analysis." },
                  ].map((tip, i) => (
                    <div key={i} className="cf-tip">
                      <span className="cf-tip-icon">{tip.icon}</span>
                      <span>{tip.text}</span>
                    </div>
                  ))}
                </div>
              </div>

            </div>
          </div>

          {/* ── Footer ── */}
          <div className="cf-footer">
            <div className="cf-footer-meta">
              {mode === "edit" ? "Editing" : "Creating"} · Lane: <strong style={{ color: T.textMid }}>{laneLabel}</strong>
              {changeId && looksLikeUuid(changeId) ? (
                <> · <span style={{ fontFamily: T.fontMono, fontSize: 10 }}>{changeId.slice(0, 8)}…</span></>
              ) : null}
            </div>
            <div className="cf-footer-actions">
              <button type="button" className="cf-btn cf-btn-ghost cf-btn-sm" onClick={onClose} disabled={disabled}>Cancel</button>
              <button type="button" className="cf-btn cf-btn-primary cf-btn-sm" onClick={submit} disabled={disabled}>
                {saving ? (mode === "edit" ? "Saving…" : "Creating…") : mode === "edit" ? "Save Changes" : "Create Request"}
              </button>
            </div>
          </div>

          {/* ── Delete confirmation overlay ── */}
          {confirmDelete && (
            <div className="cf-delete-confirm">
              <div className="cf-delete-box">
                <div className="cf-delete-icon">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={T.danger} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                    <path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                  </svg>
                </div>
                <div className="cf-delete-title">Delete Draft CR?</div>
                <div className="cf-delete-desc">
                  This will permanently delete <strong>"{safeStr(v.title) || "this change request"}"</strong>.<br />
                  Only draft CRs in Intake or Analysis can be deleted. This action cannot be undone.
                </div>
                <div className="cf-delete-actions">
                  <button type="button" className="cf-btn cf-btn-ghost" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                    Cancel
                  </button>
                  <button type="button" className="cf-btn cf-btn-danger" onClick={doDelete} disabled={deleting}>
                    {deleting ? "Deleting…" : "Yes, Delete"}
                  </button>
                </div>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* ── AI Interview Drawer ── */}
      <Drawer open={aiInterviewOpen} onClose={() => setAiInterviewOpen(false)}
        title="PM AI Assistant" sub="Answer prompts → Generate draft">
        <div style={{ background: T.surface, border: `1px solid ${T.surfaceBorder}`, borderRadius: T.radiusSm, padding: "10px 14px", fontSize: 11.5, color: T.textMid, lineHeight: 1.6 }}>
          Fill what you can — bullet points are fine. Then click <strong style={{ color: T.text }}>Generate Draft</strong>.
        </div>

        {[
          { label: "What is changing?", key: "about", placeholder: "Describe the change in plain language…", rows: 3 },
          { label: "Why is it needed?", key: "why", placeholder: "Benefits, drivers, compliance, incidents, customer need…", rows: 3 },
          { label: "Who / what is impacted?", key: "impacted", placeholder: "Services, users, stakeholders, suppliers…", rows: 3 },
        ].map(({ label, key, placeholder, rows }) => (
          <div key={key} className="cf-ifield">
            <label>{label}</label>
            <textarea className="cf-textarea"
              value={(interview as any)[key]}
              onChange={e => setInterview(p => ({ ...p, [key]: e.target.value }))}
              rows={rows} placeholder={placeholder} disabled={aiBusy} />
          </div>
        ))}

        <div className="cf-row">
          <div className="cf-ifield">
            <label>When will it happen?</label>
            <input className="cf-input" value={interview.when}
              onChange={e => setInterview(p => ({ ...p, when: e.target.value }))}
              placeholder="Window / date / time…" disabled={aiBusy} />
          </div>
          <div className="cf-ifield">
            <label>Risk level</label>
            <select className="cf-select" value={interview.riskLevel}
              onChange={e => setInterview(p => ({ ...p, riskLevel: e.target.value as any }))}
              disabled={aiBusy}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
        </div>

        {[
          { label: "Constraints / dependencies", key: "constraints", placeholder: "Approvals, vendor lead times, blackout windows…" },
          { label: "Costs / effort notes", key: "costs", placeholder: "£ estimate, days, internal vs external effort…" },
          { label: "Rollback approach", key: "rollback", placeholder: "How to revert safely / validation checks…" },
        ].map(({ label, key, placeholder }) => (
          <div key={key} className="cf-ifield">
            <label>{label}</label>
            <textarea className="cf-textarea"
              value={(interview as any)[key]}
              onChange={e => setInterview(p => ({ ...p, [key]: e.target.value }))}
              rows={3} placeholder={placeholder} disabled={aiBusy} />
          </div>
        ))}

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingTop: 4 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: T.textMid, cursor: "pointer" }}>
            <input type="checkbox" checked={forceOverwrite} onChange={e => setForceOverwrite(e.target.checked)} disabled={aiBusy} />
            Overwrite from form
          </label>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="cf-btn cf-btn-ghost cf-btn-sm"
              onClick={() => pullIntoInterview(forceOverwrite)} disabled={aiBusy}>
              Pull from form
            </button>
            <button type="button" className="cf-btn cf-btn-primary cf-btn-sm"
              onClick={async () => { const d = await runDraftAssist(); if (d) setAiInterviewOpen(false); }}
              disabled={aiBusy || disabled}>
              {aiBusy ? "Generating…" : "Generate Draft"}
            </button>
          </div>
        </div>

        {drafts && (
          <div style={{ padding: "12px 14px", background: T.surface, border: `1px solid rgba(52,211,153,0.25)`, borderRadius: T.radiusSm }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: T.green, marginBottom: 4 }}>✦ Draft ready</div>
            <div style={{ fontSize: 11.5, color: T.textMid }}>Click <strong style={{ color: T.text }}>Apply All AI</strong> in the header to fill all fields.</div>
          </div>
        )}
      </Drawer>
    </>
  );
}
