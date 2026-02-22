// src/components/change/ChangeAiDrawer.tsx
"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────
   Types
───────────────────────────────────────────── */

type RAG = "red" | "amber" | "green" | "unknown";

type DimensionScore = {
  rag: RAG;
  score: number; // 0–100
  headline: string;
  detail: string;
  actions: string[];
};

type AiAnalysis = {
  // Overall
  readiness_score: number; // 0–100
  readiness_label: string; // "Ready" | "Needs Work" | "Not Ready"
  recommendation: string; // "Approve" | "Approve with conditions" | "Request rework" | "Reject"
  executive_summary: string;

  // Per dimension
  schedule: DimensionScore;
  cost: DimensionScore;
  risk: DimensionScore;
  scope: DimensionScore;
  governance: DimensionScore;

  // Blockers / highlights
  blockers: string[];
  strengths: string[];
  next_actions: string[];

  // Meta
  model?: string;
  analysed_at?: string;
};

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeNum(x: unknown, fb = 0): number {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function safeArr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => safeStr(v)).filter(Boolean);
}

function ragFromStr(raw: unknown): RAG {
  const v = safeStr(raw).trim().toLowerCase();
  if (v === "red") return "red";
  if (v === "amber" || v === "yellow" || v === "orange") return "amber";
  if (v === "green") return "green";
  return "unknown";
}

function parseDimension(raw: any, fallbackLabel: string): DimensionScore {
  if (!raw || typeof raw !== "object") {
    return { rag: "unknown", score: 0, headline: fallbackLabel, detail: "No data available.", actions: [] };
  }
  return {
    rag: ragFromStr(raw.rag ?? raw.status ?? raw.rating),
    score: safeNum(raw.score ?? raw.confidence, 0),
    headline: safeStr(raw.headline ?? raw.label ?? fallbackLabel),
    detail: safeStr(raw.detail ?? raw.summary ?? raw.text ?? ""),
    actions: safeArr(raw.actions ?? raw.next_actions ?? raw.recommendations),
  };
}

function parseAnalysis(raw: any): AiAnalysis | null {
  if (!raw || typeof raw !== "object") return null;

  // Unwrap nested payloads
  const data = raw.analysis ?? raw.result ?? raw.payload ?? raw.ai ?? raw;

  const readiness = safeNum(data.readiness_score ?? data.score ?? data.overall_score, 0);

  return {
    readiness_score: readiness,
    readiness_label: safeStr(data.readiness_label ?? data.label ?? (readiness >= 75 ? "Ready" : readiness >= 50 ? "Needs Work" : "Not Ready")),
    recommendation: safeStr(data.recommendation ?? data.verdict ?? ""),
    executive_summary: safeStr(data.executive_summary ?? data.summary ?? data.headline ?? ""),

    schedule: parseDimension(data.schedule, "Schedule Impact"),
    cost: parseDimension(data.cost ?? data.financial, "Cost Analysis"),
    risk: parseDimension(data.risk, "Risk Assessment"),
    scope: parseDimension(data.scope ?? data.business_justification, "Scope & Justification"),
    governance: parseDimension(data.governance ?? data.compliance, "Governance & Compliance"),

    blockers: safeArr(data.blockers ?? data.issues ?? data.gaps),
    strengths: safeArr(data.strengths ?? data.positives ?? data.highlights),
    next_actions: safeArr(data.next_actions ?? data.actions ?? data.recommendations),

    model: safeStr(data.model ?? raw.model ?? ""),
    analysed_at: safeStr(data.analysed_at ?? data.timestamp ?? raw.analysed_at ?? ""),
  };
}

/* ─────────────────────────────────────────────
   RAG colour system
───────────────────────────────────────────── */

const RAG_MAP: Record<RAG, { bg: string; border: string; text: string; dot: string; label: string; glow: string }> = {
  green:   { bg: "rgba(16,185,129,0.10)", border: "rgba(16,185,129,0.28)", text: "#10b981", dot: "#10b981", label: "Green",   glow: "rgba(16,185,129,0.20)" },
  amber:   { bg: "rgba(245,158,11,0.10)", border: "rgba(245,158,11,0.28)", text: "#f59e0b", dot: "#f59e0b", label: "Amber",   glow: "rgba(245,158,11,0.20)" },
  red:     { bg: "rgba(239,68,68,0.10)",  border: "rgba(239,68,68,0.28)",  text: "#ef4444", dot: "#ef4444", label: "Red",     glow: "rgba(239,68,68,0.20)" },
  unknown: { bg: "rgba(148,163,184,0.08)",border: "rgba(148,163,184,0.2)", text: "#94a3b8", dot: "#94a3b8", label: "–",       glow: "rgba(148,163,184,0.10)" },
};

const RECOMMENDATION_STYLE: Record<string, { bg: string; border: string; text: string }> = {
  "Approve":                  { bg: "rgba(16,185,129,0.12)",  border: "rgba(16,185,129,0.35)",  text: "#10b981" },
  "Approve with conditions":  { bg: "rgba(245,158,11,0.12)",  border: "rgba(245,158,11,0.35)",  text: "#f59e0b" },
  "Request rework":           { bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.35)",  text: "#fb923c" },
  "Reject":                   { bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.35)",   text: "#ef4444" },
};

function recStyle(rec: string) {
  for (const [key, val] of Object.entries(RECOMMENDATION_STYLE)) {
    if (rec.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return { bg: "rgba(99,102,241,0.10)", border: "rgba(99,102,241,0.28)", text: "#818cf8" };
}

/* ─────────────────────────────────────────────
   CSS — injected once, pure dark intelligence
───────────────────────────────────────────── */

const CSS_TEXT = `
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=JetBrains+Mono:wght@400;500;600&display=swap');

.cad-backdrop {
  position: fixed; inset: 0; z-index: 8000;
  background: rgba(4,6,12,0.65);
  backdrop-filter: blur(10px);
  animation: cad-fade 0.2s ease;
}
@keyframes cad-fade { from{opacity:0} to{opacity:1} }

.cad-panel {
  position: absolute; right: 0; top: 0; bottom: 0;
  width: min(600px, 100vw);
  background: #080c14;
  border-left: 1px solid rgba(255,255,255,0.06);
  display: flex; flex-direction: column;
  box-shadow: -40px 0 120px rgba(0,0,0,0.7);
  animation: cad-slide 0.28s cubic-bezier(0.22,1,0.36,1);
  font-family: 'Outfit', system-ui, sans-serif;
  color: #e2e8f8;
  overflow: hidden;
}
@keyframes cad-slide {
  from { transform: translateX(60px); opacity: 0; }
  to   { transform: translateX(0);    opacity: 1; }
}

/* Header */
.cad-head {
  padding: 20px 22px 18px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  background: linear-gradient(180deg, rgba(255,255,255,0.03) 0%, transparent 100%);
  flex-shrink: 0;
}
.cad-head-top {
  display: flex; align-items: flex-start;
  justify-content: space-between; gap: 12px;
  margin-bottom: 14px;
}
.cad-label {
  font-size: 9.5px; font-weight: 700; letter-spacing: 0.14em;
  text-transform: uppercase; color: #818cf8;
  display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
}
.cad-label-dot {
  width: 5px; height: 5px; border-radius: 50%;
  background: #818cf8;
  box-shadow: 0 0 6px rgba(129,140,248,0.8);
  animation: cad-pulse 2s ease infinite;
}
@keyframes cad-pulse {
  0%,100% { opacity:1; transform:scale(1); }
  50%      { opacity:0.5; transform:scale(0.7); }
}
.cad-title {
  font-size: 17px; font-weight: 800;
  color: #f1f5ff; letter-spacing: -0.02em;
  line-height: 1.25;
}
.cad-meta {
  font-size: 11px; color: rgba(148,163,184,0.7);
  margin-top: 3px; font-family: 'JetBrains Mono', monospace;
}
.cad-close {
  width: 32px; height: 32px; border-radius: 8px;
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  color: #64748b; cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.15s; flex-shrink: 0;
}
.cad-close:hover { background: rgba(255,255,255,0.09); color: #e2e8f8; border-color: rgba(255,255,255,0.15); }

/* Action buttons */
.cad-btns { display: flex; gap: 8px; }
.cad-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 8px 16px; border-radius: 9px; border: none;
  font-size: 12px; font-weight: 700; font-family: 'Outfit', system-ui, sans-serif;
  cursor: pointer; transition: all 0.15s; letter-spacing: 0.01em;
}
.cad-btn:disabled { opacity: 0.4; cursor: not-allowed; }
.cad-btn-primary {
  background: linear-gradient(135deg, #6366f1, #8b5cf6);
  color: #fff;
  box-shadow: 0 2px 16px rgba(99,102,241,0.35);
}
.cad-btn-primary:hover:not(:disabled) {
  box-shadow: 0 4px 24px rgba(99,102,241,0.5);
  transform: translateY(-1px);
}
.cad-btn-ghost {
  background: rgba(255,255,255,0.05);
  border: 1px solid rgba(255,255,255,0.09) !important;
  color: #94a3b8;
}
.cad-btn-ghost:hover:not(:disabled) {
  background: rgba(255,255,255,0.09); color: #e2e8f8;
}

/* Scroll body */
.cad-body {
  flex: 1; overflow-y: auto;
  padding: 20px 22px 32px;
  display: flex; flex-direction: column; gap: 18px;
}
.cad-body::-webkit-scrollbar { width: 3px; }
.cad-body::-webkit-scrollbar-track { background: transparent; }
.cad-body::-webkit-scrollbar-thumb { background: rgba(99,102,241,0.3); border-radius: 2px; }

/* ── Readiness gauge ── */
.cad-gauge-wrap {
  background: linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.05));
  border: 1px solid rgba(99,102,241,0.18);
  border-radius: 16px;
  padding: 20px;
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 20px;
  align-items: center;
  position: relative;
  overflow: hidden;
}
.cad-gauge-wrap::before {
  content: '';
  position: absolute; top: -40px; right: -40px;
  width: 140px; height: 140px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(99,102,241,0.12), transparent 70%);
  pointer-events: none;
}
.cad-gauge-ring {
  width: 88px; height: 88px;
  flex-shrink: 0;
  position: relative;
}
.cad-gauge-ring svg { transform: rotate(-90deg); }
.cad-gauge-track { fill: none; stroke: rgba(255,255,255,0.06); stroke-width: 7; }
.cad-gauge-fill { fill: none; stroke-width: 7; stroke-linecap: round; transition: stroke-dashoffset 1.2s cubic-bezier(0.34,1.56,0.64,1); }
.cad-gauge-inner {
  position: absolute; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.cad-gauge-num {
  font-size: 22px; font-weight: 900;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1; letter-spacing: -0.03em;
}
.cad-gauge-pct { font-size: 9px; color: #64748b; font-weight: 600; margin-top: 1px; }

.cad-gauge-right { min-width: 0; }
.cad-readiness-label {
  font-size: 13px; font-weight: 700; color: #94a3b8;
  letter-spacing: 0.04em; text-transform: uppercase;
  margin-bottom: 4px;
}
.cad-verdict {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 20px; border: 1px solid;
  font-size: 12px; font-weight: 700; letter-spacing: 0.02em;
  margin-bottom: 10px;
}
.cad-exec-summary {
  font-size: 13.5px; line-height: 1.65;
  color: #c7d0e8; font-weight: 400;
}

/* ── Dimension grid ── */
.cad-dim-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}
.cad-dim-card {
  background: rgba(255,255,255,0.025);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 13px;
  padding: 14px;
  transition: border-color 0.2s, background 0.2s;
  cursor: default;
  position: relative;
  overflow: hidden;
}
.cad-dim-card:hover {
  background: rgba(255,255,255,0.04);
  border-color: rgba(255,255,255,0.12);
}
.cad-dim-card-accent {
  position: absolute; top: 0; left: 0; right: 0;
  height: 2px; border-radius: 13px 13px 0 0;
}
.cad-dim-head {
  display: flex; align-items: center;
  justify-content: space-between; gap: 8px;
  margin-bottom: 8px;
}
.cad-dim-name {
  font-size: 10px; font-weight: 800;
  letter-spacing: 0.08em; text-transform: uppercase;
  color: #64748b; display: flex; align-items: center; gap: 6px;
}
.cad-rag-pill {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 20px; border: 1px solid;
  font-size: 9.5px; font-weight: 800; letter-spacing: 0.05em;
}
.cad-rag-dot { width: 5px; height: 5px; border-radius: 50%; flex-shrink: 0; }
.cad-dim-score-bar {
  height: 3px; border-radius: 2px;
  background: rgba(255,255,255,0.06);
  margin-bottom: 9px; overflow: hidden;
}
.cad-dim-score-fill {
  height: 100%; border-radius: 2px;
  transition: width 1s cubic-bezier(0.34,1.56,0.64,1);
}
.cad-dim-headline {
  font-size: 12.5px; font-weight: 700;
  color: #dde3f8; margin-bottom: 5px; line-height: 1.35;
}
.cad-dim-detail {
  font-size: 11.5px; line-height: 1.6;
  color: #7880a0;
}
.cad-dim-actions {
  margin-top: 8px; display: flex; flex-direction: column; gap: 4px;
}
.cad-dim-action {
  display: flex; align-items: flex-start; gap: 6px;
  font-size: 10.5px; color: #818cf8; line-height: 1.5;
}
.cad-dim-action-dot {
  width: 4px; height: 4px; border-radius: 50%;
  background: #818cf8; flex-shrink: 0; margin-top: 5px;
}

/* ── Blockers / strengths ── */
.cad-section-title {
  font-size: 9.5px; font-weight: 800;
  letter-spacing: 0.12em; text-transform: uppercase;
  color: #4e5470; margin-bottom: 10px;
  display: flex; align-items: center; gap: 8px;
}
.cad-section-title::after {
  content: ''; flex: 1; height: 1px;
  background: rgba(255,255,255,0.05);
}

.cad-blocker-list, .cad-strength-list, .cad-action-list {
  display: flex; flex-direction: column; gap: 7px;
}
.cad-blocker-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 12px;
  background: rgba(239,68,68,0.07);
  border: 1px solid rgba(239,68,68,0.18);
  border-radius: 9px;
  font-size: 12px; color: #fca5a5; line-height: 1.55;
}
.cad-blocker-icon { flex-shrink: 0; margin-top: 1px; }
.cad-strength-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 9px 12px;
  background: rgba(16,185,129,0.07);
  border: 1px solid rgba(16,185,129,0.18);
  border-radius: 9px;
  font-size: 12px; color: #6ee7b7; line-height: 1.55;
}
.cad-action-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 10px 12px;
  background: rgba(99,102,241,0.07);
  border: 1px solid rgba(99,102,241,0.18);
  border-radius: 9px;
  font-size: 12px; color: #a5b4fc; line-height: 1.55;
}
.cad-action-num {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px; font-weight: 700;
  color: #6366f1; flex-shrink: 0;
  padding-top: 1px;
}

/* ── Empty / error / loading states ── */
.cad-state {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  gap: 16px; padding: 40px 24px; text-align: center;
}
.cad-state-icon {
  width: 56px; height: 56px; border-radius: 16px;
  display: flex; align-items: center; justify-content: center;
  margin: 0 auto;
}
.cad-state-title { font-size: 15px; font-weight: 700; color: #c7d0e8; }
.cad-state-sub { font-size: 12.5px; color: #4e5470; line-height: 1.6; max-width: 280px; margin: 0 auto; }

/* Spinner */
@keyframes cad-spin { to { transform: rotate(360deg); } }
.cad-spinner {
  width: 20px; height: 20px; border-radius: 50%;
  border: 2px solid rgba(99,102,241,0.25);
  border-top-color: #6366f1;
  animation: cad-spin 0.8s linear infinite;
}

/* Score arc colours */
.cad-arc-green   { stroke: #10b981; }
.cad-arc-amber   { stroke: #f59e0b; }
.cad-arc-red     { stroke: #ef4444; }
.cad-arc-neutral { stroke: #6366f1; }

/* Stagger animation for cards */
.cad-dim-card { animation: cad-card-in 0.3s ease backwards; }
.cad-dim-card:nth-child(1) { animation-delay: 0.05s; }
.cad-dim-card:nth-child(2) { animation-delay: 0.10s; }
.cad-dim-card:nth-child(3) { animation-delay: 0.15s; }
.cad-dim-card:nth-child(4) { animation-delay: 0.20s; }
.cad-dim-card:nth-child(5) { animation-delay: 0.25s; }
@keyframes cad-card-in {
  from { opacity:0; transform:translateY(8px); }
  to   { opacity:1; transform:translateY(0); }
}

/* Footer timestamp */
.cad-footer {
  padding: 12px 22px;
  border-top: 1px solid rgba(255,255,255,0.05);
  display: flex; align-items: center; justify-content: space-between;
  flex-shrink: 0;
}
.cad-footer-meta {
  font-size: 10px; color: #2e3453;
  font-family: 'JetBrains Mono', monospace;
}
`;

let cadCssInjected = false;
function injectCadCss() {
  if (typeof document === "undefined" || cadCssInjected) return;
  cadCssInjected = true;
  const el = document.createElement("style");
  el.textContent = CSS_TEXT;
  document.head.appendChild(el);
}

/* ─────────────────────────────────────────────
   Score gauge
───────────────────────────────────────────── */

function ScoreGauge({ score }: { score: number }) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const offset = circ - (pct / 100) * circ;

  const arcClass =
    pct >= 75 ? "cad-arc-green" :
    pct >= 50 ? "cad-arc-amber" :
    pct > 0   ? "cad-arc-red"   : "cad-arc-neutral";

  const numColor =
    pct >= 75 ? "#10b981" :
    pct >= 50 ? "#f59e0b" :
    pct > 0   ? "#ef4444" : "#818cf8";

  return (
    <div className="cad-gauge-ring">
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle className="cad-gauge-track" cx="44" cy="44" r={r} />
        <circle
          className={`cad-gauge-fill ${arcClass}`}
          cx="44" cy="44" r={r}
          strokeDasharray={circ}
          strokeDashoffset={offset}
        />
      </svg>
      <div className="cad-gauge-inner">
        <div className="cad-gauge-num" style={{ color: numColor }}>{pct}</div>
        <div className="cad-gauge-pct">/ 100</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Dimension card
───────────────────────────────────────────── */

const DIM_ICONS: Record<string, React.ReactNode> = {
  schedule: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
    </svg>
  ),
  cost: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
    </svg>
  ),
  risk: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  ),
  scope: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  ),
  governance: (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  ),
};

function DimCard({ dim, kind }: { dim: DimensionScore; kind: string }) {
  const rag = RAG_MAP[dim.rag];
  const fillPct = Math.max(0, Math.min(100, dim.score));

  return (
    <div className="cad-dim-card">
      <div className="cad-dim-card-accent" style={{ background: rag.text }} />
      <div className="cad-dim-head">
        <div className="cad-dim-name" style={{ color: rag.text }}>
          {DIM_ICONS[kind]}
          {kind.charAt(0).toUpperCase() + kind.slice(1)}
        </div>
        <div className="cad-rag-pill" style={{ background: rag.bg, borderColor: rag.border, color: rag.text }}>
          <span className="cad-rag-dot" style={{ background: rag.dot }} />
          {rag.label}
        </div>
      </div>

      <div className="cad-dim-score-bar">
        <div
          className="cad-dim-score-fill"
          style={{ width: `${fillPct}%`, background: rag.text }}
        />
      </div>

      <div className="cad-dim-headline">{dim.headline || "—"}</div>
      {dim.detail && <div className="cad-dim-detail">{dim.detail}</div>}

      {dim.actions.length > 0 && (
        <div className="cad-dim-actions">
          {dim.actions.slice(0, 3).map((a, i) => (
            <div key={i} className="cad-dim-action">
              <div className="cad-dim-action-dot" />
              {a}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main analysis view
───────────────────────────────────────────── */

function AnalysisView({ analysis }: { analysis: AiAnalysis }) {
  const rec = recStyle(analysis.recommendation);

  return (
    <>
      {/* Readiness gauge + executive summary */}
      <div className="cad-gauge-wrap">
        <ScoreGauge score={analysis.readiness_score} />
        <div className="cad-gauge-right">
          <div className="cad-readiness-label">Approval Readiness</div>
          {analysis.recommendation && (
            <div className="cad-verdict" style={{ background: rec.bg, borderColor: rec.border, color: rec.text }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              {analysis.recommendation}
            </div>
          )}
          {analysis.executive_summary && (
            <div className="cad-exec-summary">{analysis.executive_summary}</div>
          )}
        </div>
      </div>

      {/* Dimension grid */}
      <div>
        <div className="cad-section-title">Impact Dimensions</div>
        <div className="cad-dim-grid">
          {(["schedule", "cost", "risk", "scope", "governance"] as const).map((k) => (
            <DimCard key={k} dim={analysis[k]} kind={k} />
          ))}
        </div>
      </div>

      {/* Blockers */}
      {analysis.blockers.length > 0 && (
        <div>
          <div className="cad-section-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2.5">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            Blockers · {analysis.blockers.length}
          </div>
          <div className="cad-blocker-list">
            {analysis.blockers.map((b, i) => (
              <div key={i} className="cad-blocker-item">
                <svg className="cad-blocker-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
                </svg>
                {b}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths */}
      {analysis.strengths.length > 0 && (
        <div>
          <div className="cad-section-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
            Strengths · {analysis.strengths.length}
          </div>
          <div className="cad-strength-list">
            {analysis.strengths.map((s, i) => (
              <div key={i} className="cad-strength-item">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
                {s}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next actions */}
      {analysis.next_actions.length > 0 && (
        <div>
          <div className="cad-section-title">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="2.5">
              <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
            Next Actions for PM
          </div>
          <div className="cad-action-list">
            {analysis.next_actions.map((a, i) => (
              <div key={i} className="cad-action-item">
                <div className="cad-action-num">#{i + 1}</div>
                {a}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   API
───────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────
   Main drawer
───────────────────────────────────────────── */

export default function ChangeAiDrawer({
  open,
  onClose,
  projectId,
  artifactId,
  changeId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  artifactId?: string | null;
  changeId?: string | null;
  title?: string;
}) {
  useEffect(() => { injectCadCss(); }, []);

  const [analysis, setAnalysis] = useState<AiAnalysis | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lastRun, setLastRun] = useState<string>("");
  const hasAutoRun = useRef(false);

  // Reset when changeId changes
  useEffect(() => {
    if (changeId) {
      setAnalysis(null);
      setError("");
      hasAutoRun.current = false;
    }
  }, [changeId]);

  const runScan = useCallback(async () => {
    if (!projectId || !changeId || busy) return;
    setBusy(true);
    setError("");
    try {
      const json = await apiPost("/api/ai/events", {
        projectId,
        artifactId: artifactId ?? null,
        eventType: "change_ai_impact_assessment",
        severity: "info",
        source: "change_ai_drawer",
        payload: { changeId },
      });

      // Try multiple paths for the analysis payload
      const raw =
        json?.analysis ??
        json?.result?.analysis ??
        json?.payload?.analysis ??
        json?.result ??
        json?.payload ??
        json?.ai ??
        json;

      const parsed = parseAnalysis(raw);
      if (parsed) {
        setAnalysis(parsed);
        setLastRun(new Date().toLocaleTimeString());
      } else {
        // Fallback: build a structured view from whatever came back
        setAnalysis(buildFallbackAnalysis(json));
        setLastRun(new Date().toLocaleTimeString());
      }
    } catch (e: any) {
      setError(safeStr(e?.message) || "Analysis failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [projectId, changeId, artifactId, busy]);

  // Auto-run on open if no cached result
  useEffect(() => {
    if (!open) return;
    if (hasAutoRun.current) return;
    if (!projectId || !changeId) return;
    hasAutoRun.current = true;
    runScan();
  }, [open, projectId, changeId, runScan]);

  if (!open) return null;

  return (
    <div className="cad-backdrop" role="dialog" aria-modal="true">
      <div className="cad-panel">
        {/* Header */}
        <div className="cad-head">
          <div className="cad-head-top">
            <div>
              <div className="cad-label">
                <span className="cad-label-dot" />
                AI Analysis · Change Review
              </div>
              <div className="cad-title">{title || "Change Request"}</div>
              {changeId && (
                <div className="cad-meta">{changeId.slice(0, 8)}… · {lastRun ? `Analysed ${lastRun}` : "Not yet analysed"}</div>
              )}
            </div>
            <button className="cad-close" type="button" onClick={onClose} title="Close">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div className="cad-btns">
            <button
              type="button"
              className="cad-btn cad-btn-primary"
              onClick={runScan}
              disabled={busy || !projectId || !changeId}
            >
              {busy ? (
                <>
                  <div className="cad-spinner" style={{ width: 14, height: 14, borderWidth: 2 }} />
                  Analysing CR…
                </>
              ) : (
                <>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                  </svg>
                  {analysis ? "Re-run Analysis" : "Run AI Analysis"}
                </>
              )}
            </button>

            {analysis && (
              <button type="button" className="cad-btn cad-btn-ghost" onClick={() => { setAnalysis(null); setError(""); }}>
                Clear
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="cad-body">
          {/* Loading */}
          {busy && !analysis && (
            <div className="cad-state">
              <div className="cad-state-icon" style={{ background: "rgba(99,102,241,0.1)", border: "1px solid rgba(99,102,241,0.2)" }}>
                <div className="cad-spinner" />
              </div>
              <div className="cad-state-title">Analysing change request…</div>
              <div className="cad-state-sub">
                Reviewing schedule, cost, risk, scope, and governance dimensions against PMO standards.
              </div>
            </div>
          )}

          {/* Error */}
          {!busy && error && (
            <div className="cad-state">
              <div className="cad-state-icon" style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.2)" }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
                </svg>
              </div>
              <div className="cad-state-title">Analysis failed</div>
              <div className="cad-state-sub">{error}</div>
              <button type="button" className="cad-btn cad-btn-primary" onClick={runScan} disabled={busy}>
                Try again
              </button>
            </div>
          )}

          {/* Empty */}
          {!busy && !error && !analysis && (
            <div className="cad-state">
              <div className="cad-state-icon" style={{ background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.15)" }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#818cf8" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                </svg>
              </div>
              <div className="cad-state-title">PM Intelligence Panel</div>
              <div className="cad-state-sub">
                Run an AI analysis to get a full impact assessment — schedule, cost, risk, scope, governance — with a readiness score and next actions.
              </div>
              <button type="button" className="cad-btn cad-btn-primary" onClick={runScan} disabled={busy || !changeId}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M13 10V3L4 14h7v7l9-11h-7z"/>
                </svg>
                Run AI Analysis
              </button>
            </div>
          )}

          {/* Results */}
          {!busy && !error && analysis && <AnalysisView analysis={analysis} />}
        </div>

        {/* Footer */}
        <div className="cad-footer">
          <div className="cad-footer-meta">
            {analysis?.model ? `model · ${analysis.model}` : ""}
          </div>
          <div className="cad-footer-meta">
            {lastRun ? `last run · ${lastRun}` : "not yet run"}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Fallback parser — handles the current raw
   response format shown in the screenshot
───────────────────────────────────────────── */

function buildFallbackAnalysis(raw: any): AiAnalysis {
  // The current API returns fields like executive_summary, schedule, cost etc.
  // but nested differently — this handles all plausible shapes.
  const getText = (...keys: string[]): string => {
    for (const k of keys) {
      const v = raw?.[k] ?? raw?.result?.[k] ?? raw?.payload?.[k] ?? raw?.ai?.[k];
      if (v && typeof v === "string") return v.trim();
      if (v && typeof v === "object" && typeof v.text === "string") return v.text.trim();
      if (v && typeof v === "object" && typeof v.summary === "string") return v.summary.trim();
    }
    return "";
  };

  const getArr = (...keys: string[]): string[] => {
    for (const k of keys) {
      const v = raw?.[k] ?? raw?.result?.[k] ?? raw?.payload?.[k];
      if (Array.isArray(v)) return v.map(safeStr).filter(Boolean);
      if (typeof v === "string" && v.trim()) {
        return v.split(/\n|·|-\s/).map(s => s.trim()).filter(Boolean);
      }
    }
    return [];
  };

  const score = safeNum(raw?.score ?? raw?.readiness_score ?? raw?.result?.score, 60);

  const makeDim = (keys: string[], fallback: string): DimensionScore => {
    const text = getText(...keys);
    if (!text) return { rag: "unknown", score: 0, headline: fallback, detail: "No data captured.", actions: [] };
    // Infer RAG from content
    const lower = text.toLowerCase();
    const rag: RAG =
      lower.includes("high") || lower.includes("critical") || lower.includes("major") ? "red" :
      lower.includes("medium") || lower.includes("moderate") || lower.includes("tbc") ? "amber" :
      lower.includes("low") || lower.includes("minimal") || lower.includes("none") ? "green" : "amber";
    return {
      rag,
      score: rag === "green" ? 80 : rag === "amber" ? 55 : 30,
      headline: fallback,
      detail: text.slice(0, 320),
      actions: [],
    };
  };

  return {
    readiness_score: score,
    readiness_label: score >= 75 ? "Ready" : score >= 50 ? "Needs Work" : "Not Ready",
    recommendation: score >= 75 ? "Approve" : score >= 50 ? "Approve with conditions" : "Request rework",
    executive_summary: getText("executive_summary", "summary", "headline", "description"),
    schedule: makeDim(["schedule", "schedule_impact", "Schedule Impact"], "Schedule Impact"),
    cost: makeDim(["cost", "financial", "cost_analysis", "Cost Analysis"], "Cost Analysis"),
    risk: makeDim(["risk", "risk_assessment", "Risk Assessment"], "Risk Assessment"),
    scope: makeDim(["scope", "business_justification", "justification", "Scope Changes"], "Scope & Justification"),
    governance: makeDim(["governance", "compliance", "approvals"], "Governance & Compliance"),
    blockers: getArr("blockers", "issues", "gaps", "blocking"),
    strengths: getArr("strengths", "positives", "highlights"),
    next_actions: getArr("next_actions", "actions", "recommendations", "next_steps"),
    model: safeStr(raw?.model ?? ""),
    analysed_at: new Date().toISOString(),
  };
}