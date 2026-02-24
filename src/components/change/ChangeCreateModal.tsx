"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/* ─── Types ─── */
type ChangeStatus = "new" | "analysis" | "review" | "in_progress" | "implemented" | "closed";
type ChangePriority = "Low" | "Medium" | "High" | "Critical";
type DeliveryLane = "intake" | "analysis" | "review" | "in_progress" | "implemented" | "closed";

export type ApprovalProgressInput = {
  canApprove?: boolean;
  currentStepIndex?: number;
  totalSteps?: number;
  currentStepLabel?: string;
  remainingApprovers?: number;
  actingOnBehalfOf?: { name?: string; email?: string } | null;
  chainName?: string;
};

type DraftAssistAi = {
  summary?: string; justification?: string; financial?: string; schedule?: string;
  risks?: string; dependencies?: string; assumptions?: string;
  implementation?: string; rollback?: string;
  impact?: { days: number; cost: number; risk: string };
};
type DraftAssistResp = { ok: true; model?: string; draftId?: string; ai?: DraftAssistAi; };
type AiInterview = {
  about: string; why: string; impacted: string; when: string;
  constraints: string; costs: string; riskLevel: "Low" | "Medium" | "High"; rollback: string;
};
type ChangeFormValue = {
  title: string; requester: string; status: ChangeStatus; priority: ChangePriority;
  summary: string; justification: string; financial: string; schedule: string;
  risks: string; dependencies: string; assumptions: string;
  implementationPlan: string; rollbackPlan: string;
  aiImpact: { days: number; cost: number; risk: string };
  files: File[];
};

/* ─── Utils (all logic preserved from original) ─── */
function safeStr(x: unknown): string { return typeof x === "string" ? x : x == null ? "" : String(x); }
function clampText(s: string, max: number): string { const t = String(s ?? ""); return t.length > max ? t.slice(0, max) : t; }
function isValidPriority(p: string): p is ChangePriority { return ["Low","Medium","High","Critical"].includes(p); }
function isValidStatus(s: string): s is ChangeStatus { return ["new","analysis","review","in_progress","implemented","closed"].includes(s); }
function normalizeStatus(raw: unknown): ChangeStatus {
  const v = safeStr(raw).trim().toLowerCase();
  if (isValidStatus(v)) return v as ChangeStatus;
  if (v === "in progress") return "in_progress";
  return "new";
}
function normalizePriority(raw: unknown): ChangePriority {
  const v = safeStr(raw).trim();
  if (isValidPriority(v)) return v as ChangePriority;
  return "Medium";
}
function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function uiStatusToDeliveryLane(s: ChangeStatus): DeliveryLane {
  const m: Record<ChangeStatus, DeliveryLane> = { new: "intake", analysis: "analysis", review: "review", in_progress: "in_progress", implemented: "implemented", closed: "closed" };
  return m[s] ?? "intake";
}
async function apiPost(url: string, body?: any): Promise<any> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "{}" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}
async function apiPatch(url: string, body?: any): Promise<any> {
  const res = await fetch(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : "{}" });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}
function newDraftId(): string {
  const c = (globalThis as any)?.crypto;
  const fn = c?.randomUUID;
  if (typeof fn === "function") return fn.call(c);
  return `d_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

/* ═══════════════════════════════════════════
   DESIGN SYSTEM — CSS injected once at mount
═══════════════════════════════════════════ */
const CCM_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');

  .ccm-overlay{position:fixed;inset:0;z-index:9000;background:rgba(8,10,18,.72);backdrop-filter:blur(14px) saturate(1.4);display:flex;align-items:center;justify-content:center;padding:20px;animation:ccm-fade .2s ease;}
  @keyframes ccm-fade{from{opacity:0}to{opacity:1}}
  .ccm-modal{width:min(1100px,98vw);max-height:93vh;background:#F5F7FD;border:1px solid rgba(255,255,255,.92);border-radius:22px;box-shadow:0 0 0 1px rgba(99,102,241,.07),0 4px 16px rgba(30,40,80,.07),0 20px 60px rgba(30,40,80,.12),0 60px 120px rgba(30,40,80,.07);display:flex;flex-direction:column;overflow:hidden;animation:ccm-slide .28s cubic-bezier(.34,1.4,.64,1);font-family:'Instrument Sans',system-ui,sans-serif;color:#111827;}
  @keyframes ccm-slide{from{opacity:0;transform:translateY(28px) scale(.97)}to{opacity:1;transform:translateY(0) scale(1)}}

  .ccm-header{padding:18px 26px 16px;background:linear-gradient(160deg,#fff 0%,#f4f6ff 100%);border-bottom:1px solid rgba(99,102,241,.1);flex-shrink:0;position:relative;overflow:hidden;}
  .ccm-header::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#6366f1 0%,#818cf8 40%,#a78bfa 70%,#6366f1 100%);background-size:200% 100%;animation:ccm-shimmer 3.5s linear infinite;}
  @keyframes ccm-shimmer{0%{background-position:0% 0%}100%{background-position:200% 0%}}
  .ccm-htop{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;}
  .ccm-htitle{font-size:16px;font-weight:700;color:#0d1023;letter-spacing:-.025em;}
  .ccm-hsub{font-size:12px;color:#6b7280;margin-top:2px;}
  .ccm-hpills{display:flex;gap:7px;align-items:center;margin-top:10px;flex-wrap:wrap;}
  .ccm-hacts{display:flex;gap:7px;align-items:center;flex-shrink:0;}

  .ccm-body{flex:1;display:grid;grid-template-columns:1fr 284px;overflow:hidden;}
  .ccm-main{overflow-y:auto;padding:22px 22px 32px;display:flex;flex-direction:column;gap:14px;}
  .ccm-sidebar{overflow-y:auto;background:linear-gradient(180deg,#fff 0%,#f8f9ff 100%);border-left:1px solid rgba(99,102,241,.1);padding:18px 16px;display:flex;flex-direction:column;gap:16px;}
  .ccm-main::-webkit-scrollbar,.ccm-sidebar::-webkit-scrollbar{width:3px;}
  .ccm-main::-webkit-scrollbar-thumb,.ccm-sidebar::-webkit-scrollbar-thumb{background:rgba(99,102,241,.16);border-radius:2px;}

  .ccm-card{background:#fff;border:1px solid rgba(99,102,241,.09);border-radius:16px;padding:18px 20px;box-shadow:0 1px 3px rgba(30,40,100,.04),0 3px 10px rgba(30,40,100,.04);transition:box-shadow .2s;}
  .ccm-card:hover{box-shadow:0 2px 8px rgba(99,102,241,.07),0 6px 20px rgba(30,40,100,.06);}
  .ccm-chead{font-size:12.5px;font-weight:700;color:#0d1023;letter-spacing:-.01em;margin-bottom:14px;display:flex;align-items:center;gap:8px;}
  .ccm-cicon{width:26px;height:26px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:7px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}

  .ccm-field{display:flex;flex-direction:column;gap:5px;}
  .ccm-label{font-size:10.5px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:#6b7280;}
  .ccm-req{color:#6366f1;}

  .ccm-input,.ccm-select,.ccm-textarea{width:100%;box-sizing:border-box;background:#fafbff;border:1.5px solid #e5e7f0;border-radius:10px;padding:9px 13px;font-size:13px;font-family:'Instrument Sans',system-ui,sans-serif;color:#111827;outline:none;resize:none;transition:border-color .14s,box-shadow .14s,background .14s;}
  .ccm-input::placeholder,.ccm-textarea::placeholder{color:#c5c9dc;}
  .ccm-input:focus,.ccm-select:focus,.ccm-textarea:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.11);background:#fff;}
  .ccm-input:disabled,.ccm-select:disabled,.ccm-textarea:disabled{opacity:.5;cursor:not-allowed;}
  .ccm-select{appearance:none;cursor:pointer;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%236b7280' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 11px center;padding-right:30px;}
  .ccm-select option{background:#fff;}
  .ccm-row2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .ccm-row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}

  .ccm-fwrap{position:relative;}
  .ccm-aibtn{position:absolute;top:9px;right:9px;z-index:2;display:inline-flex;align-items:center;gap:4px;padding:4px 9px;background:linear-gradient(135deg,#6366f1,#818cf8);border:none;border-radius:7px;font-size:10px;font-weight:700;font-family:'Instrument Sans',sans-serif;color:#fff;letter-spacing:.04em;cursor:pointer;box-shadow:0 2px 8px rgba(99,102,241,.3);transition:all .13s;}
  .ccm-aibtn:hover:not(:disabled){background:linear-gradient(135deg,#4f46e5,#6366f1);box-shadow:0 4px 14px rgba(99,102,241,.4);transform:translateY(-1px);}
  .ccm-aibtn:disabled{opacity:.4;cursor:not-allowed;transform:none;}

  .ccm-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:9px 16px;border-radius:10px;border:none;font-size:12px;font-weight:600;font-family:'Instrument Sans',sans-serif;cursor:pointer;transition:all .14s;white-space:nowrap;}
  .ccm-btn:disabled{opacity:.45;cursor:not-allowed;}
  .ccm-btn-primary{background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;box-shadow:0 2px 12px rgba(99,102,241,.28);}
  .ccm-btn-primary:hover:not(:disabled){background:linear-gradient(135deg,#4f46e5,#6366f1);box-shadow:0 4px 20px rgba(99,102,241,.4);transform:translateY(-1px);}
  .ccm-btn-ghost{background:transparent;border:1.5px solid #e5e7f0;color:#6b7280;}
  .ccm-btn-ghost:hover:not(:disabled){background:#f4f6ff;border-color:#c7d2fe;color:#4338ca;}
  .ccm-btn-ai{background:#eef2ff;border:1.5px solid #c7d2fe;color:#4338ca;}
  .ccm-btn-ai:hover:not(:disabled){background:#e0e7ff;border-color:#818cf8;box-shadow:0 0 12px rgba(99,102,241,.15);}
  .ccm-btn-danger{background:#fff1f2;border:1.5px solid #fecaca;color:#dc2626;}
  .ccm-btn-danger:hover:not(:disabled){background:#ffe4e6;border-color:#f87171;}
  .ccm-btn-sm{padding:7px 12px;font-size:11.5px;border-radius:8px;}
  .ccm-btn-xs{padding:5px 9px;font-size:10.5px;border-radius:7px;}

  .ccm-err{margin:10px 22px 0;padding:10px 14px;background:#fff1f2;border:1.5px solid rgba(239,68,68,.2);border-radius:10px;font-size:12px;color:#dc2626;flex-shrink:0;}

  .ccm-footer{display:flex;align-items:center;justify-content:space-between;padding:13px 22px;border-top:1px solid rgba(99,102,241,.09);background:linear-gradient(180deg,#f8f9ff 0%,#fff 100%);flex-shrink:0;gap:12px;}
  .ccm-fmeta{font-size:10.5px;color:#9ca3af;font-family:'DM Mono',monospace;}

  .ccm-pill{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;border:1.5px solid;font-size:10.5px;font-weight:600;}
  .ccm-pill-status{color:#6b7280;border-color:#e5e7f0;background:#fafbff;}
  .ccm-pill-low{color:#6b7280;border-color:#d1d5db;background:#f9fafb;}
  .ccm-pill-medium{color:#d97706;border-color:#fde68a;background:#fffbeb;}
  .ccm-pill-high{color:#ea580c;border-color:#fed7aa;background:#fff7ed;}
  .ccm-pill-critical{color:#dc2626;border-color:#fecaca;background:#fff1f2;}
  .ccm-pill-green{color:#15803d;border-color:#bbf7d0;background:#f0fdf4;}
  .ccm-pill-amber{color:#b45309;border-color:#fde68a;background:#fffbeb;}

  .ccm-statuslock{display:flex;align-items:center;justify-content:space-between;padding:9px 13px;background:#f8f9ff;border:1.5px solid #e5e7f0;border-radius:10px;font-size:13px;font-weight:500;color:#111827;}

  .ccm-drop{border:2px dashed #c7d2fe;border-radius:12px;padding:22px 16px;text-align:center;background:#fafbff;cursor:pointer;transition:all .14s;}
  .ccm-drop:hover{border-color:#818cf8;background:#eef2ff;}
  .ccm-dropico{width:38px;height:38px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:11px;display:flex;align-items:center;justify-content:center;margin:0 auto 9px;}
  .ccm-att{display:flex;align-items:center;gap:10px;padding:10px 12px;background:#fafbff;border:1.5px solid #e5e7f0;border-radius:10px;transition:border-color .14s;}
  .ccm-att:hover{border-color:#c7d2fe;}
  .ccm-attico{width:32px;height:32px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0;}
  .ccm-attname{font-size:12px;font-weight:600;color:#111827;}
  .ccm-attsize{font-size:10px;color:#9ca3af;margin-top:1px;}

  .ccm-impact{background:#fafbff;border:1.5px solid #e5e7f0;border-radius:12px;padding:13px;display:flex;flex-direction:column;gap:3px;}
  .ccm-ilabel{font-size:9.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#9ca3af;}
  .ccm-ival{font-size:22px;font-weight:800;font-family:'DM Mono',monospace;color:#0d1023;letter-spacing:-.03em;line-height:1;}
  .ccm-isub{font-size:10px;color:#9ca3af;margin-top:2px;}

  .ccm-appr{margin-top:12px;border:1.5px solid rgba(99,102,241,.15);border-radius:14px;overflow:hidden;background:#fff;}
  .ccm-apprhead{padding:10px 14px;background:linear-gradient(135deg,#4f46e5,#1e1b4b);display:flex;align-items:center;justify-content:space-between;gap:10px;}
  .ccm-apprchip{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;background:rgba(255,255,255,.12);border-radius:6px;font-size:10.5px;font-weight:600;color:#fff;}
  .ccm-apprbody{padding:11px 14px;}
  .ccm-progtrack{height:4px;border-radius:4px;background:#e5e7f0;overflow:hidden;}
  .ccm-progfill{height:100%;border-radius:4px;background:linear-gradient(90deg,#6366f1,#818cf8);transition:width .4s ease;}

  .ccm-stitle{font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#9ca3af;margin-bottom:10px;display:flex;align-items:center;gap:6px;}
  .ccm-tip{display:flex;gap:9px;align-items:flex-start;padding:8px 10px;background:#fafbff;border:1.5px solid #eef0f8;border-radius:9px;font-size:11px;line-height:1.5;color:#6b7280;}
  .ccm-div{height:1px;background:#eef0f8;}
  .ccm-ready{padding:8px 12px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:10px;font-size:11px;color:#15803d;font-weight:600;}
  .ccm-modelbadge{padding:8px 12px;background:#f8f9ff;border:1.5px solid #e5e7f0;border-radius:10px;font-size:10.5px;color:#6b7280;font-family:'DM Mono',monospace;}

  .ccm-doverlay{position:fixed;inset:0;z-index:9100;background:rgba(8,10,18,.5);backdrop-filter:blur(8px);animation:ccm-fade .15s ease;}
  .ccm-drawer{position:absolute;right:0;top:0;height:100%;width:min(500px,96vw);background:#fff;border-left:1px solid rgba(99,102,241,.1);display:flex;flex-direction:column;box-shadow:-16px 0 50px rgba(30,40,100,.11);animation:ccm-din .22s cubic-bezier(.34,1.3,.64,1);}
  @keyframes ccm-din{from{transform:translateX(32px);opacity:0}to{transform:translateX(0);opacity:1}}
  .ccm-dhead{padding:17px 20px;border-bottom:1px solid #eef0f8;display:flex;align-items:center;justify-content:space-between;background:linear-gradient(160deg,#fff 0%,#f4f6ff 100%);flex-shrink:0;position:relative;overflow:hidden;}
  .ccm-dhead::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,#6366f1,#818cf8,#a78bfa);}
  .ccm-dbody{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:14px;}
  .ccm-dbody::-webkit-scrollbar{width:3px;}
  .ccm-dbody::-webkit-scrollbar-thumb{background:rgba(99,102,241,.2);border-radius:2px;}
`;

let ccmCssInjected = false;
function injectCss() {
  if (typeof document === "undefined" || ccmCssInjected) return;
  ccmCssInjected = true;
  const el = document.createElement("style");
  el.textContent = CCM_CSS;
  document.head.appendChild(el);
}

/* ─── SVG Icons — NO emoji, NO rendering issues ─── */
const Ic = {
  Bolt: ({ s = 11 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
  X:    ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>,
  Trash:({ s = 12 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>,
  Clip: ({ s = 14 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"/></svg>,
  File: ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>,
  Doc:  ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>,
  Star: ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>,
  Dollar:({s=13}:{s?:number})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6"/></svg>,
  Cal:  ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>,
  Warn: ({ s = 13 }: { s?: number }) => <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>,
  Arrows:({s=13}:{s?:number})=><svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>,
};

function AiBtn({ disabled, busy, onClick, title }: { disabled?: boolean; busy?: boolean; onClick: () => void; title?: string }) {
  return (
    <button type="button" className="ccm-aibtn" onClick={onClick} disabled={disabled || busy} title={title}>
      <Ic.Bolt s={9} /> {busy ? "…" : "AI"}
    </button>
  );
}

function CHead({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="ccm-chead">
      <div className="ccm-cicon">{icon}</div>
      {children}
    </div>
  );
}

function Drawer({ open, title, sub, onClose, children }: { open: boolean; title: string; sub?: string; onClose: () => void; children: React.ReactNode }) {
  if (!open) return null;
  return (
    <div className="ccm-doverlay" role="dialog" aria-modal="true">
      <div className="ccm-drawer">
        <div className="ccm-dhead">
          <div>
            {sub && <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "#6366f1", marginBottom: 3 }}>{sub}</div>}
            <div style={{ fontSize: 15, fontWeight: 700, color: "#0d1023" }}>{title}</div>
          </div>
          <button type="button" className="ccm-btn ccm-btn-ghost ccm-btn-sm" onClick={onClose}><Ic.X s={11} /> Close</button>
        </div>
        <div className="ccm-dbody">{children}</div>
      </div>
    </div>
  );
}

function ApprovalBar({ approval }: { approval?: ApprovalProgressInput | null }) {
  if (!approval) return null;
  const totalSteps = Math.max(0, Number(approval.totalSteps ?? 0) || 0);
  const currentIndex = Math.max(0, Number(approval.currentStepIndex ?? 0) || 0);
  const stepNo = totalSteps > 0 ? Math.min(currentIndex + 1, totalSteps) : 0;
  const pct = totalSteps > 0 ? Math.round((Math.min(stepNo, totalSteps) / totalSteps) * 100) : 0;
  const label = safeStr(approval.currentStepLabel).trim();
  const remaining = Math.max(0, Number(approval.remainingApprovers ?? 0) || 0);
  const canApprove = approval.canApprove !== false;
  const acting = approval.actingOnBehalfOf || null;
  const actingName = safeStr(acting?.name).trim();
  const actingEmail = safeStr(acting?.email).trim();
  return (
    <div className="ccm-appr">
      <div className="ccm-apprhead">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="ccm-apprchip">{totalSteps > 0 ? `Step ${stepNo} / ${totalSteps}` : "Approval"}</span>
          {label && <span style={{ fontSize: 11.5, color: "rgba(255,255,255,.72)", fontWeight: 500 }}>{label}</span>}
        </div>
        <div style={{ display: "flex", gap: 7, alignItems: "center" }}>
          {remaining > 0 && <span className="ccm-apprchip">{remaining} remaining</span>}
          <span className="ccm-apprchip" style={{ background: canApprove ? "rgba(52,211,153,.2)" : "rgba(251,191,36,.2)" }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: canApprove ? "#34d399" : "#fbbf24", display: "inline-block" }} />
            {canApprove ? "You can approve" : "View only"}
          </span>
        </div>
      </div>
      <div className="ccm-apprbody">
        <div className="ccm-progtrack"><div className="ccm-progfill" style={{ width: `${pct}%` }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 5 }}>
          <span style={{ fontSize: 10.5, color: "#9ca3af" }}>{(actingName || actingEmail) ? <>Acting for <strong style={{ color: "#374151" }}>{actingName || actingEmail}</strong></> : null}</span>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#6366f1", fontFamily: "'DM Mono',monospace" }}>{pct}%</span>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════ */
export default function ChangeCreateModal({
  open, onClose, projectId, artifactId,
  initialStatus, initialPriority,
  mode = "create", changeId = null, initialValue, titleOverride, approval,
}: {
  open: boolean; onClose: () => void; projectId: string; artifactId?: string | null;
  initialStatus?: ChangeStatus; initialPriority?: ChangePriority;
  mode?: "create" | "edit"; changeId?: string | null;
  initialValue?: Partial<ChangeFormValue> & Record<string, any>;
  titleOverride?: string; approval?: ApprovalProgressInput | null;
}) {
  const router = useRouter();
  useEffect(() => { injectCss(); }, []);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [resolvedProjectId, setResolvedProjectId] = useState<string>("");
  const [projResolveBusy, setProjResolveBusy] = useState(false);
  const [projResolveErr, setProjResolveErr] = useState("");

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
  const [files, setFiles] = useState<File[]>([]);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadErr, setUploadErr] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiErr, setAiErr] = useState("");
  const [drafts, setDrafts] = useState<DraftAssistAi | null>(null);
  const [draftModel, setDraftModel] = useState("rules-v1");
  const [aiInterviewOpen, setAiInterviewOpen] = useState(false);
  const [forceOverwrite, setForceOverwrite] = useState(false);
  const [interview, setInterview] = useState<AiInterview>({ about: "", why: "", impacted: "", when: "", constraints: "", costs: "", riskLevel: "Medium", rollback: "" });

  const isEdit = mode === "edit";
  const disabled = saving || projResolveBusy;
  const draftId = useMemo(() => newDraftId(), [open]);

  /* ── Resolve project (all original logic) ── */
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
        if (!uuid || !looksLikeUuid(uuid)) throw new Error("Project UUID not found.");
        if (!cancelled) setResolvedProjectId(uuid);
      } catch (e: any) {
        if (!cancelled) setProjResolveErr(safeStr(e?.message) || "Failed to resolve projectId.");
      } finally { if (!cancelled) setProjResolveBusy(false); }
    }
    resolve();
    return () => { cancelled = true; };
  }, [open, projectId]);

  /* ── Reset on open (all original logic) ── */
  useEffect(() => {
    if (!open) return;
    setError(""); setAiErr(""); setDrafts(null); setDraftModel("rules-v1");
    setUploadBusy(false); setUploadErr(""); setFiles([]);
    const iv: any = initialValue ?? {};
    const merged: ChangeFormValue = {
      title: safeStr(iv.title ?? ""),
      requester: safeStr(iv.requester ?? iv.requester_name ?? ""),
      status: normalizeStatus(iv.status ?? iv.delivery_status ?? initialStatus ?? "new"),
      priority: normalizePriority(iv.priority ?? initialPriority ?? "Medium"),
      summary: safeStr(iv.summary ?? iv.description ?? ""),
      justification: safeStr(iv.justification ?? ""), financial: safeStr(iv.financial ?? ""),
      schedule: safeStr(iv.schedule ?? ""), risks: safeStr(iv.risks ?? ""),
      dependencies: safeStr(iv.dependencies ?? ""), assumptions: safeStr(iv.assumptions ?? ""),
      implementationPlan: safeStr(iv.implementationPlan ?? iv.implementation_plan ?? iv.implementation ?? ""),
      rollbackPlan: safeStr(iv.rollbackPlan ?? iv.rollback_plan ?? iv.rollback ?? ""),
      aiImpact: {
        days: Number(iv?.aiImpact?.days ?? iv?.impact_analysis?.days ?? 0) || 0,
        cost: Number(iv?.aiImpact?.cost ?? iv?.impact_analysis?.cost ?? 0) || 0,
        risk: safeStr(iv?.aiImpact?.risk ?? iv?.impact_analysis?.risk ?? "None identified") || "None identified",
      },
      files: [],
    };
    setTitle(merged.title); setRequester(merged.requester); setStatus(merged.status); setPriority(merged.priority); setSummary(merged.summary);
    setJustification(merged.justification); setFinancial(merged.financial); setSchedule(merged.schedule); setRisks(merged.risks);
    setDependencies(merged.dependencies); setAssumptions(merged.assumptions);
    setImplementationPlan(merged.implementationPlan); setRollbackPlan(merged.rollbackPlan);
    setAiImpact({ days: Number(merged.aiImpact.days ?? 0) || 0, cost: Number(merged.aiImpact.cost ?? 0) || 0, risk: safeStr(merged.aiImpact.risk ?? "None identified") || "None identified" });
    setInterview({ about: safeStr(merged.title), why: safeStr(merged.summary), impacted: merged.requester ? `Stakeholders/requester: ${merged.requester}. (Confirm impacted services/users)` : "", when: "", constraints: "", costs: "", riskLevel: "Medium", rollback: safeStr(merged.rollbackPlan) });
    setForceOverwrite(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [open, initialStatus, initialPriority, initialValue]);

  /* ── File handling (all original logic) ── */
  const removeFile = (idx: number) => setFiles(p => p.filter((_, i) => i !== idx));

  async function uploadFilesToChange(changeUuid: string, picked?: File[]) {
    const pid = safeStr(resolvedProjectId).trim();
    const aId = safeStr(artifactId).trim();
    const list = (picked && picked.length ? picked : files) ?? [];
    if (!list.length) return;
    setUploadErr(""); setUploadBusy(true);
    try {
      const url = `/api/change/${encodeURIComponent(changeUuid)}/attachments`;
      for (const file of list) {
        const fd = new FormData();
        fd.append("file", file); fd.append("filename", file.name);
        fd.append("content_type", file.type || "application/octet-stream");
        if (pid) fd.append("projectId", pid);
        if (aId) fd.append("artifactId", aId);
        const res = await fetch(url, { method: "POST", body: fd });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `Attachment upload failed (HTTP ${res.status})`);
      }
    } catch (e: any) { setUploadErr(safeStr(e?.message) || "Failed to upload attachment(s)"); throw e; }
    finally { setUploadBusy(false); }
  }

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(e.currentTarget.files ?? []);
    if (!picked.length) return;
    setFiles(p => [...p, ...picked]);
    const cid = safeStr(changeId).trim();
    if (cid) { try { await uploadFilesToChange(cid, picked); } catch {} }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  async function removeUploadedAttachmentByFilename(filename: string) {
    const cid = safeStr(changeId).trim(); if (!cid) return;
    const listRes = await fetch(`/api/change/${encodeURIComponent(cid)}/attachments`);
    const listJson = await listRes.json().catch(() => ({}));
    if (!listRes.ok || (listJson as any)?.ok === false) throw new Error(safeStr((listJson as any)?.error) || "Failed to load attachments");
    const items: any[] = Array.isArray((listJson as any)?.items) ? (listJson as any).items : [];
    const match = items.find(x => safeStr(x?.filename) === filename);
    const path = safeStr(match?.path).trim(); if (!path) throw new Error("Attachment path not found");
    const delRes = await fetch(`/api/change/${encodeURIComponent(cid)}/attachments?path=${encodeURIComponent(path)}`, { method: "DELETE" });
    const delJson = await delRes.json().catch(() => ({}));
    if (!delRes.ok || (delJson as any)?.ok === false) throw new Error(safeStr((delJson as any)?.error) || "Failed to delete attachment");
  }

  /* ── AI (all original logic) ── */
  function improveOrSetLocal(current: string, setter: (v: string) => void, suggestion: string, max = 8000) {
    const s = safeStr(suggestion).trim(); if (!s) return;
    const cur = safeStr(current).trim();
    if (cur.length >= 50) { setter(clampText(`${cur}\n\n—\nImproved draft:\n${s}`, max)); return; }
    setter(clampText(s, max));
  }
  function hasInterviewSignal() {
    const ok = (x: string) => safeStr(x).trim().length >= 3;
    return ok(interview.about) || ok(interview.why) || ok(interview.impacted) || ok(interview.when);
  }
  function useCurrentDraftIntoInterview({ overwrite }: { overwrite: boolean }) {
    const mapIf = (current: string, next: string) => { if (overwrite) return next; return safeStr(current).trim() ? current : next; };
    setInterview(prev => {
      const next = { ...prev };
      next.about = mapIf(next.about, safeStr(title).trim());
      next.why = mapIf(next.why, safeStr(summary).trim());
      next.impacted = mapIf(next.impacted, requester ? `Stakeholders/requester: ${requester}. (Confirm impacted services/users)` : "");
      next.costs = mapIf(next.costs, [aiImpact.cost > 0 ? `£${aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "", aiImpact.days > 0 ? `${aiImpact.days} day(s)` : ""].filter(Boolean).join(" / "));
      next.rollback = mapIf(next.rollback, safeStr(rollbackPlan).trim());
      return next;
    });
  }
  async function runPmoDraftAssist(): Promise<DraftAssistAi | null> {
    const pid = safeStr(resolvedProjectId).trim();
    if (!pid) { setAiErr(projResolveErr || "Missing projectId."); return null; }
    setAiErr(""); setAiBusy(true);
    try {
      const j = await apiPost("/api/ai/events", {
        projectId: pid, artifactId: safeStr(artifactId).trim() || null,
        eventType: "change_draft_assist_requested", severity: "info",
        source: isEdit ? "change_edit_modal" : "change_create_modal",
        payload: { draftId, mode, title: safeStr(title), summary: safeStr(summary), priority: safeStr(priority), status: safeStr(status), requester: safeStr(requester), justification: safeStr(justification), financial: safeStr(financial), schedule: safeStr(schedule), risks: safeStr(risks), dependencies: safeStr(dependencies), assumptions: safeStr(assumptions), implementation: safeStr(implementationPlan), rollback: safeStr(rollbackPlan), interview },
      }) as DraftAssistResp;
      const ai = (j && typeof j === "object" ? (j as any).ai : null) || null;
      setDrafts(ai); setDraftModel(safeStr((j as any)?.model) || "rules-v1"); return ai;
    } catch (e: any) { setAiErr(safeStr(e?.message) || "AI draft failed"); setDrafts(null); return null; }
    finally { setAiBusy(false); }
  }
  async function ensureDrafts() {
    if (drafts) return drafts;
    if (!hasInterviewSignal()) { setAiInterviewOpen(true); setAiErr("Tell AI what the change is about (Start AI) to generate accurate drafts."); return null; }
    return runPmoDraftAssist();
  }
  async function applyAllAi() {
    const d = await ensureDrafts(); if (!d) return;
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
    if (imp) setAiImpact({ days: Number(imp?.days ?? 0) || 0, cost: Number(imp?.cost ?? 0) || 0, risk: safeStr(imp?.risk ?? "").trim() || "None identified" });
  }
  async function runAiImpactScan() {
    const d = await ensureDrafts(); if (!d) return;
    const imp = (d as any)?.impact;
    if (!imp) { setAiErr("AI returned no impact suggestion."); return; }
    setAiImpact({ days: Number(imp?.days ?? 0) || 0, cost: Number(imp?.cost ?? 0) || 0, risk: safeStr(imp?.risk ?? "").trim() || "None identified" });
  }
  async function fireAiAfterSuccess(args: { projectId: string; changeId: string; eventType: "change_created" | "change_saved"; action: "created" | "updated" }) {
    try { await fetch("/api/ai/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: args.projectId, artifactId: args.changeId, eventType: args.eventType, severity: "info", source: isEdit ? "change_edit_modal" : "change_create_modal", payload: { target_artifact_type: "change_request", change_id: args.changeId, action: args.action } }) }).catch(() => null); } catch {}
  }

  /* ── Submit (all original logic) ── */
  async function submitChange() {
    setError(""); setUploadErr("");
    const pid = safeStr(resolvedProjectId).trim();
    if (!pid) return setError(projResolveErr || "Missing projectId.");
    const t = clampText(safeStr(title).trim(), 160);
    if (!t) return setError("Title is required.");
    const s = clampText(safeStr(summary).trim(), 1200);
    if (!s) return setError("Summary is required.");
    if (mode === "edit" && !safeStr(changeId).trim()) return setError("Missing changeId for edit.");
    setSaving(true);
    try {
      const impact_analysis = { days: Number(aiImpact.days ?? 0) || 0, cost: Number(aiImpact.cost ?? 0) || 0, risk: clampText(safeStr(aiImpact.risk ?? "None identified"), 280), highlights: [] };
      const proposed_change = clampText([justification ? `Justification:\n${justification}` : "", financial ? `Financial:\n${financial}` : "", schedule ? `Schedule:\n${schedule}` : "", risks ? `Risks:\n${risks}` : "", dependencies ? `Dependencies:\n${dependencies}` : "", assumptions ? `Assumptions:\n${assumptions}` : "", implementationPlan ? `Implementation Plan:\n${implementationPlan}` : "", rollbackPlan ? `Rollback Plan:\n${rollbackPlan}` : ""].filter(Boolean).join("\n\n"), 8000);
      const delivery_status = uiStatusToDeliveryLane(status);
      const payload: any = { project_id: pid, artifact_id: safeStr(artifactId).trim() || null, title: t, description: s, requester_name: safeStr(requester).trim() || "Unknown requester", priority: normalizePriority(priority), tags: [], proposed_change, impact_analysis, justification, financial, schedule, risks, dependencies, assumptions, implementationPlan: safeStr(implementationPlan), rollbackPlan: safeStr(rollbackPlan), implementation_plan: safeStr(implementationPlan), rollback_plan: safeStr(rollbackPlan) };
      if (!isEdit) payload.delivery_status = delivery_status;
      if (isEdit) {
        const cid = String(changeId);
        await apiPatch(`/api/change/${encodeURIComponent(cid)}`, payload);
        if (files.length) await uploadFilesToChange(cid);
        await fireAiAfterSuccess({ projectId: pid, changeId: cid, eventType: "change_saved", action: "updated" });
        onClose(); router.refresh(); return;
      }
      const j = await apiPost("/api/change", payload);
      const newId = safeStr((j as any)?.item?.id || (j as any)?.id || (j as any)?.data?.id).trim();
      if (!newId) throw new Error("Create succeeded but no id returned");
      if (files.length) await uploadFilesToChange(newId);
      await fireAiAfterSuccess({ projectId: pid, changeId: newId, eventType: "change_created", action: "created" });
      onClose(); router.replace(`/projects/${projectId}/change/${newId}`); router.refresh();
    } catch (e: any) { setError(safeStr(e?.message) || (isEdit ? "Save failed" : "Create failed")); }
    finally { setSaving(false); }
  }

  function statusLabel(s: ChangeStatus) {
    const m: Record<ChangeStatus, string> = { new: "New", analysis: "Analysis", review: "Review", in_progress: "Implementation", implemented: "Implemented", closed: "Closed" };
    return m[s] ?? s;
  }
  const ppClass: Record<ChangePriority, string> = { Low: "ccm-pill ccm-pill-low", Medium: "ccm-pill ccm-pill-medium", High: "ccm-pill ccm-pill-high", Critical: "ccm-pill ccm-pill-critical" };
  const laneLabel = uiStatusToDeliveryLane(status).replace(/_/g, " ");

  if (!open) return null;

  /* Reusable AI textarea */
  const AF = ({ value, onChange, rows = 4, placeholder, onAi, label, req }: {
    value: string; onChange: (v: string) => void; rows?: number; placeholder?: string;
    onAi: () => void; label?: string; req?: boolean;
  }) => (
    <div className="ccm-field">
      {label && <label className="ccm-label">{label}{req && <span className="ccm-req"> *</span>}</label>}
      <div className="ccm-fwrap">
        <textarea className="ccm-textarea" value={value} onChange={e => onChange(e.target.value)}
          rows={rows} placeholder={placeholder} disabled={disabled} style={{ paddingRight: 52 }} />
        <AiBtn disabled={disabled} busy={aiBusy} onClick={onAi} />
      </div>
    </div>
  );

  return (
    <>
      <div className="ccm-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
        <div className="ccm-modal">

          {/* ── Header ── */}
          <div className="ccm-header">
            <div className="ccm-htop">
              <div>
                <div className="ccm-htitle">{titleOverride || (isEdit ? "Edit Change Request" : "New Change Request")}</div>
                <div className="ccm-hsub">{isEdit ? "Update with AI assistance." : "Draft a complete change request — AI fills the gaps."}</div>
                <div className="ccm-hpills">
                  <span className="ccm-pill ccm-pill-status">
                    <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#6366f1", display: "inline-block" }} />
                    {statusLabel(status)}
                  </span>
                  <span className={ppClass[priority]}>{priority}</span>
                  {projResolveBusy && <span className="ccm-pill ccm-pill-amber">Resolving project…</span>}
                  {projResolveErr && !projResolveBusy && <span style={{ fontSize: 10.5, color: "#dc2626" }}>{projResolveErr}</span>}
                  {drafts && <span className="ccm-pill ccm-pill-green">✦ AI draft ready · {draftModel}</span>}
                </div>
              </div>
              <div className="ccm-hacts">
                <button type="button" className="ccm-btn ccm-btn-ai ccm-btn-sm"
                  onClick={() => { useCurrentDraftIntoInterview({ overwrite: false }); setAiInterviewOpen(true); }} disabled={disabled || aiBusy}>
                  <Ic.Bolt s={11} /> {aiBusy ? "Scanning…" : "Start AI"}
                </button>
                <button type="button" className="ccm-btn ccm-btn-ai ccm-btn-sm" onClick={applyAllAi} disabled={disabled || aiBusy}>Apply All</button>
                <button type="button" className="ccm-btn ccm-btn-ghost ccm-btn-sm" onClick={onClose} disabled={disabled}><Ic.X s={11} /> Close</button>
                <button type="button" className="ccm-btn ccm-btn-primary ccm-btn-sm" onClick={submitChange} disabled={disabled}>
                  {saving ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save Changes" : "Create CR"}
                </button>
              </div>
            </div>
            <ApprovalBar approval={approval} />
          </div>

          {/* ── Errors ── */}
          {(error || aiErr || uploadErr) && <div className="ccm-err">{error || aiErr || uploadErr}</div>}

          {/* ── Body ── */}
          <div className="ccm-body">
            <div className="ccm-main">

              {/* Change Summary */}
              <div className="ccm-card">
                <CHead icon={<Ic.Doc />}>Change Summary</CHead>
                <div className="ccm-field" style={{ marginBottom: 12 }}>
                  <label className="ccm-label">Title <span className="ccm-req">*</span></label>
                  <input className="ccm-input" value={title} onChange={e => setTitle(e.target.value)}
                    placeholder="e.g., Extend firewall scope for vendor access" disabled={disabled} />
                </div>
                <div className="ccm-row3" style={{ marginBottom: 12 }}>
                  <div className="ccm-field">
                    <label className="ccm-label">Requester</label>
                    <input className="ccm-input" value={requester} onChange={e => setRequester(e.target.value)} placeholder="Name" disabled={disabled} />
                  </div>
                  <div className="ccm-field">
                    <label className="ccm-label">Status</label>
                    {isEdit ? (
                      <div className="ccm-statuslock">
                        <span style={{ fontWeight: 600 }}>{statusLabel(status)}</span>
                        <span style={{ fontSize: 10, color: "#9ca3af" }}>Governed</span>
                      </div>
                    ) : (
                      <select className="ccm-select" value={status} onChange={e => setStatus(normalizeStatus(e.target.value))} disabled={disabled}>
                        <option value="new">New (Intake)</option>
                        <option value="analysis">Analysis</option>
                        <option value="review">Review</option>
                        <option value="in_progress">Implementation</option>
                        <option value="implemented">Implemented</option>
                        <option value="closed">Closed</option>
                      </select>
                    )}
                  </div>
                  <div className="ccm-field">
                    <label className="ccm-label">Priority <span className="ccm-req">*</span></label>
                    <select className="ccm-select" value={priority} onChange={e => setPriority(normalizePriority(e.target.value))} disabled={disabled}>
                      <option>Low</option><option>Medium</option><option>High</option><option>Critical</option>
                    </select>
                  </div>
                </div>
                <AF value={summary} onChange={setSummary} rows={4} label="Summary" req
                  placeholder="2–3 lines for quick scanning…"
                  onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(summary, setSummary, safeStr(d.summary), 1200); }} />
              </div>

              {/* Business Justification */}
              <div className="ccm-card">
                <CHead icon={<Ic.Star />}>Business Justification</CHead>
                <AF value={justification} onChange={setJustification} rows={4}
                  placeholder="Why is this needed? What value does it unlock?"
                  onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(justification, setJustification, safeStr(d.justification)); }} />
              </div>

              {/* Financial & Schedule */}
              <div className="ccm-row2">
                <div className="ccm-card">
                  <CHead icon={<Ic.Dollar />}>Financial Impact</CHead>
                  <AF value={financial} onChange={setFinancial} rows={4}
                    placeholder="Cost drivers, budget impact, commercial notes…"
                    onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(financial, setFinancial, safeStr(d.financial)); }} />
                </div>
                <div className="ccm-card">
                  <CHead icon={<Ic.Cal />}>Schedule Impact</CHead>
                  <AF value={schedule} onChange={setSchedule} rows={4}
                    placeholder="Milestone impacts, critical path changes, sequencing…"
                    onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(schedule, setSchedule, safeStr(d.schedule)); }} />
                </div>
              </div>

              {/* Risks & Dependencies */}
              <div className="ccm-card">
                <CHead icon={<Ic.Warn />}>Risks & Dependencies</CHead>
                <div className="ccm-row2" style={{ marginBottom: 12 }}>
                  <AF value={risks} onChange={setRisks} rows={4} label="Risks"
                    placeholder="Top risks and mitigations…"
                    onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(risks, setRisks, safeStr(d.risks)); }} />
                  <AF value={dependencies} onChange={setDependencies} rows={4} label="Dependencies"
                    placeholder="Approvals, vendors, prerequisites…"
                    onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(dependencies, setDependencies, safeStr(d.dependencies)); }} />
                </div>
                <AF value={assumptions} onChange={setAssumptions} rows={3} label="Assumptions"
                  placeholder="Any assumptions the plan relies on…"
                  onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(assumptions, setAssumptions, safeStr(d.assumptions)); }} />
              </div>

              {/* Implementation & Rollback */}
              <div className="ccm-card">
                <CHead icon={<Ic.Arrows />}>Implementation & Rollback</CHead>
                <div className="ccm-row2">
                  <AF value={implementationPlan} onChange={setImplementationPlan} rows={7} label="Implementation Plan"
                    placeholder="Outline steps, approach, owners, sequence, and validation checkpoints…"
                    onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(implementationPlan, setImplementationPlan, safeStr(d.implementation)); }} />
                  <AF value={rollbackPlan} onChange={setRollbackPlan} rows={7} label="Rollback Plan"
                    placeholder="Backout steps, restore points, success criteria, and how you'll confirm rollback is complete…"
                    onAi={async () => { const d = await ensureDrafts(); if (!d) return; improveOrSetLocal(rollbackPlan, setRollbackPlan, safeStr(d.rollback)); }} />
                </div>
              </div>

              {/* Attachments */}
              <div className="ccm-card">
                <CHead icon={<Ic.Clip s={13} />}>
                  Attachments
                  <span style={{ marginLeft: "auto", fontSize: 10.5, color: "#9ca3af", fontWeight: 400, fontFamily: "'DM Mono',monospace" }}>
                    {files.length} file{files.length !== 1 ? "s" : ""}
                  </span>
                </CHead>

                {!safeStr(changeId).trim() && (
                  <div style={{ padding: "9px 12px", background: "#fffbeb", border: "1.5px solid #fde68a", borderRadius: 9, fontSize: 11.5, color: "#92400e", marginBottom: 12 }}>
                    Save this CR first to enable server-side attachment uploads.
                  </div>
                )}

                <label htmlFor="ccm-file-input" style={{ cursor: disabled ? "not-allowed" : "pointer", display: "block" }}>
                  <div className="ccm-drop" style={{ opacity: disabled ? 0.5 : 1 }}>
                    <div className="ccm-dropico"><Ic.Clip s={16} /></div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 3 }}>Drop files or click to browse</div>
                    <div style={{ fontSize: 11, color: "#9ca3af" }}>Designs, screenshots, vendor comms, impact calcs</div>
                    {uploadBusy && <div style={{ marginTop: 7, fontSize: 11, color: "#6366f1", fontWeight: 600 }}>Uploading…</div>}
                  </div>
                </label>
                <input ref={fileInputRef} id="ccm-file-input" type="file" multiple
                  onChange={handleFileSelect} disabled={disabled} style={{ display: "none" }} />

                {files.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 7, marginTop: 10 }}>
                    {files.map((f, idx) => (
                      <div key={`${f.name}-${f.size}-${idx}`} className="ccm-att">
                        <div className="ccm-attico"><Ic.File s={13} /></div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="ccm-attname" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</div>
                          <div className="ccm-attsize">{(f.size / 1024).toFixed(1)} KB</div>
                        </div>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button type="button" className="ccm-btn ccm-btn-danger ccm-btn-xs"
                            onClick={() => removeFile(idx)} disabled={disabled} title="Remove from list">
                            <Ic.Trash s={11} />
                          </button>
                          {safeStr(changeId).trim() && (
                            <button type="button" className="ccm-btn ccm-btn-ghost ccm-btn-xs"
                              onClick={async () => {
                                try { setUploadErr(""); setUploadBusy(true); await removeUploadedAttachmentByFilename(f.name); removeFile(idx); }
                                catch (e: any) { setUploadErr(safeStr(e?.message) || "Failed to remove attachment"); }
                                finally { setUploadBusy(false); }
                              }}
                              disabled={disabled || uploadBusy} title="Remove from server">
                              <Ic.X s={11} />
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                    <button type="button" onClick={() => setFiles([])} disabled={disabled}
                      style={{ fontSize: 11, color: "#dc2626", background: "none", border: "none", cursor: "pointer", textAlign: "left", padding: "0 2px", fontFamily: "'Instrument Sans',sans-serif", fontWeight: 600 }}>
                      Remove all
                    </button>
                  </div>
                )}
              </div>

            </div>

            {/* ── Sidebar ── */}
            <div className="ccm-sidebar">

              {/* AI Impact */}
              <div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 11 }}>
                  <div className="ccm-stitle" style={{ marginBottom: 0 }}><Ic.Bolt s={10} /> Estimated Impact</div>
                  <button type="button" className="ccm-btn ccm-btn-ai ccm-btn-xs" onClick={runAiImpactScan} disabled={disabled || aiBusy}>
                    <Ic.Bolt s={9} /> {aiBusy ? "…" : "AI Scan"}
                  </button>
                </div>
                <div className="ccm-row2" style={{ gap: 9, marginBottom: 10 }}>
                  <div className="ccm-impact">
                    <div className="ccm-ilabel">Delay</div>
                    <div className="ccm-ival">{aiImpact.days > 0 ? `+${aiImpact.days}` : "—"}</div>
                    <div className="ccm-isub">days</div>
                    <input type="number" className="ccm-input" style={{ marginTop: 7, fontSize: 11, padding: "6px 9px" }}
                      value={String(aiImpact.days ?? 0)} onChange={e => setAiImpact(p => ({ ...p, days: parseInt(e.target.value, 10) || 0 }))} disabled={disabled} placeholder="0" />
                  </div>
                  <div className="ccm-impact">
                    <div className="ccm-ilabel">Cost (£)</div>
                    <div className="ccm-ival" style={{ fontSize: 16 }}>{aiImpact.cost > 0 ? `£${aiImpact.cost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}</div>
                    <div className="ccm-isub">budget</div>
                    <input type="number" className="ccm-input" style={{ marginTop: 7, fontSize: 11, padding: "6px 9px" }}
                      value={String(aiImpact.cost ?? 0)} onChange={e => setAiImpact(p => ({ ...p, cost: parseInt(e.target.value, 10) || 0 }))} disabled={disabled} placeholder="0" />
                  </div>
                </div>
                <div className="ccm-field">
                  <label className="ccm-label">Risk descriptor</label>
                  <input type="text" className="ccm-input"
                    value={safeStr(aiImpact.risk)} onChange={e => setAiImpact(p => ({ ...p, risk: e.target.value }))}
                    disabled={disabled} placeholder="e.g., Medium — mitigated by rollback" />
                  <div style={{ fontSize: 10, color: "#c5c9dc", marginTop: 2 }}>Include risk level + mitigation condition.</div>
                </div>
              </div>

              <div className="ccm-div" />

              {drafts && <div className="ccm-modelbadge">AI · <strong style={{ color: "#374151" }}>{draftModel}</strong></div>}

              {/* PM Tips */}
              <div>
                <div className="ccm-stitle">PM Tips</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {[
                    ["⚡", "Start AI with a title + summary for best results."],
                    ["📐", "Make impacts measurable: £, days, named services, implementation window."],
                    ["🔁", "Approvers want: test evidence, rollback plan, comms message."],
                    ["🔒", isEdit ? "Status changes happen on the board." : "Delete is available in Intake or Analysis only."],
                  ].map(([ico, txt], i) => (
                    <div key={i} className="ccm-tip">
                      <span style={{ flexShrink: 0 }}>{ico}</span>
                      <span>{txt}</span>
                    </div>
                  ))}
                </div>
              </div>

              {approval && (
                <>
                  <div className="ccm-div" />
                  <div style={{ padding: "12px 14px", background: "#f8f9ff", border: "1.5px solid #e0e7ff", borderRadius: 12, fontSize: 11.5, color: "#6b7280" }}>
                    <div style={{ fontWeight: 700, color: "#0d1023", marginBottom: 4 }}>Approval chain</div>
                    <div>Approve/Reject: <strong style={{ color: "#0d1023" }}>{approval.canApprove !== false ? "Enabled" : "Disabled"}</strong></div>
                    {approval.canApprove === false && <div style={{ marginTop: 4, color: "#9ca3af" }}>View and edit draft fields still available.</div>}
                  </div>
                </>
              )}

            </div>
          </div>

          {/* ── Footer ── */}
          <div className="ccm-footer">
            <div className="ccm-fmeta">
              {isEdit ? "Editing" : "Creating"} · Lane: <strong style={{ color: "#6366f1" }}>{laneLabel}</strong>
              {changeId && looksLikeUuid(changeId) && <> · {changeId.slice(0, 8)}…</>}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" className="ccm-btn ccm-btn-ghost ccm-btn-sm" onClick={onClose} disabled={disabled}>Cancel</button>
              <button type="button" className="ccm-btn ccm-btn-primary ccm-btn-sm" onClick={submitChange} disabled={disabled}>
                {saving ? (isEdit ? "Saving…" : "Creating…") : isEdit ? "Save Changes" : "Create Request"}
              </button>
            </div>
          </div>

        </div>
      </div>

      {/* ── AI Interview Drawer ── */}
      <Drawer open={aiInterviewOpen} onClose={() => setAiInterviewOpen(false)} title="PM AI Assistant" sub="Answer prompts → Generate draft">
        <div style={{ padding: "10px 13px", background: "#f8f9ff", border: "1.5px solid #e0e7ff", borderRadius: 9, fontSize: 11.5, color: "#6b7280", lineHeight: 1.6 }}>
          Fill what you know — bullet points are fine. Click <strong style={{ color: "#0d1023" }}>Generate Draft</strong>.
        </div>

        {aiErr && <div className="ccm-err" style={{ margin: 0 }}>{aiErr}</div>}

        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, padding: "10px 12px", background: "#f8f9ff", borderRadius: 9, border: "1.5px solid #eef0f8" }}>
          <button type="button" className="ccm-btn ccm-btn-ghost ccm-btn-sm"
            onClick={() => useCurrentDraftIntoInterview({ overwrite: forceOverwrite })} disabled={aiBusy}>
            Use my current draft
          </button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11, color: "#6b7280", cursor: "pointer", userSelect: "none", marginLeft: "auto" }}>
            <input type="checkbox" checked={forceOverwrite} onChange={e => setForceOverwrite(e.target.checked)} disabled={aiBusy} />
            Overwrite existing answers
          </label>
        </div>

        {[
          { label: "What is the change about?", key: "about", rows: 3, placeholder: "e.g., Extend firewall scope for vendor access on SZC workstream…" },
          { label: "Why is it needed / what value does it unlock?", key: "why", rows: 3, placeholder: "Drivers, benefits, risk reduction, compliance, customer impact…" },
          { label: "Who / what is impacted?", key: "impacted", rows: 3, placeholder: "Systems, services, users, suppliers, environments…" },
        ].map(({ label, key, rows, placeholder }) => (
          <div key={key} className="ccm-field">
            <label className="ccm-label">{label}</label>
            <textarea className="ccm-textarea" value={(interview as any)[key]}
              onChange={e => setInterview(p => ({ ...p, [key]: e.target.value }))}
              rows={rows} placeholder={placeholder} disabled={aiBusy} />
          </div>
        ))}

        <div className="ccm-row2">
          <div className="ccm-field">
            <label className="ccm-label">When does it need to happen?</label>
            <textarea className="ccm-textarea" value={interview.when}
              onChange={e => setInterview(p => ({ ...p, when: e.target.value }))}
              rows={3} placeholder="Target window, milestones, blackout dates…" disabled={aiBusy} />
          </div>
          <div className="ccm-field">
            <label className="ccm-label">Constraints / assumptions</label>
            <textarea className="ccm-textarea" value={interview.constraints}
              onChange={e => setInterview(p => ({ ...p, constraints: e.target.value }))}
              rows={3} placeholder="Access, approvals, resourcing, dependencies…" disabled={aiBusy} />
          </div>
        </div>

        <div className="ccm-row2">
          <div className="ccm-field">
            <label className="ccm-label">Costs (if known)</label>
            <input className="ccm-input" value={interview.costs}
              onChange={e => setInterview(p => ({ ...p, costs: e.target.value }))}
              placeholder="e.g., £12,000 / 3 days / vendor day-rate…" disabled={aiBusy} />
          </div>
          <div className="ccm-field">
            <label className="ccm-label">Risk level (your view)</label>
            <select className="ccm-select" value={interview.riskLevel}
              onChange={e => setInterview(p => ({ ...p, riskLevel: e.target.value as any }))} disabled={aiBusy}>
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
          </div>
        </div>

        <div className="ccm-field">
          <label className="ccm-label">Rollback / backout approach</label>
          <textarea className="ccm-textarea" value={interview.rollback}
            onChange={e => setInterview(p => ({ ...p, rollback: e.target.value }))}
            rows={3} placeholder="How would you revert safely / validate success?" disabled={aiBusy} />
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, paddingTop: 4 }}>
          <button type="button" className="ccm-btn ccm-btn-ghost ccm-btn-sm" onClick={() => setAiInterviewOpen(false)} disabled={aiBusy}>Close</button>
          <button type="button" className="ccm-btn ccm-btn-primary ccm-btn-sm"
            onClick={async () => { const d = await runPmoDraftAssist(); if (d) setAiInterviewOpen(false); }}
            disabled={aiBusy || disabled}>
            {aiBusy ? "Generating…" : "Generate drafts"}
          </button>
        </div>

        {drafts && (
          <div className="ccm-ready">
            ✦ Draft ready — click <strong>Apply All</strong> in the header to fill all fields.
          </div>
        )}
      </Drawer>
    </>
  );
}