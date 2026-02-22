// src/components/change/ChangeBoardDnd.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";

import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";

/* =========================
   Lazy UI (keeps bundle light)
========================= */

const ChangeCreateModal = dynamic(() => import("./ChangeCreateModal"), { ssr: false });
const ChangeAiDrawer = dynamic(() => import("./ChangeAiDrawer"), { ssr: false });
const ChangeTimeline = dynamic(() => import("./ChangeTimeline"), { ssr: false });
const AttachmentsDrawer = dynamic(() => import("./AttachmentsDrawer"), { ssr: false });

/* =========================
   Types
========================= */

type DeliveryLane = "intake" | "analysis" | "review" | "in_progress" | "implemented" | "closed";
type Priority = "Low" | "Medium" | "High" | "Critical";
type Decision = "draft" | "submitted" | "approved" | "rejected" | "rework" | "" | null;
type ChangeStatus = "new" | "analysis" | "review" | "in_progress" | "implemented" | "closed";

type ChangeItem = {
  id: string;
  seq?: number | null;
  public_id?: string | null;
  title: string | null;
  description?: string | null;
  project_id: string;
  artifact_id?: string | null;
  delivery_status?: DeliveryLane | null;
  decision_status?: Decision;
  priority?: Priority | string | null;
  assignee_id?: string | null;
  links?: any;
  impact_analysis?: any;
  ai_score?: number | null;
  updated_at?: string | null;
  created_at?: string | null;
  requester_name?: string | null;
  justification?: string | null;
  financial?: string | null;
  schedule?: string | null;
  risks?: string | null;
  dependencies?: string | null;
  assumptions?: string | null;
  implementationPlan?: string | null;
  rollbackPlan?: string | null;
  implementation_plan?: string | null;
  rollback_plan?: string | null;
};

type LanesResponse = Record<DeliveryLane, ChangeItem[]>;

/* =========================
   Constants
========================= */

const LANES: DeliveryLane[] = ["intake", "analysis", "review", "in_progress", "implemented", "closed"];

const WIP_LIMITS: Partial<Record<DeliveryLane, number>> = {
  intake: 99,
  analysis: 8,
  review: 6,
  in_progress: 8,
  implemented: 99,
  closed: 99,
};

const dropAnimation: DropAnimation = {
  sideEffects: defaultDropAnimationSideEffects({ styles: { active: { opacity: "0.4" } } }),
};

/* =========================
   Design tokens per lane
========================= */

const LANE_CONFIG: Record<DeliveryLane, {
  label: string;
  color: string;
  gradient: string;
  bg: string;
  textColor: string;
  dotColor: string;
  dropBg: string;
}> = {
  intake: {
    label: "Intake",
    color: "#94a3b8",
    gradient: "linear-gradient(90deg,#94a3b8,#cbd5e1)",
    bg: "#f8f9fc",
    textColor: "#475569",
    dotColor: "#94a3b8",
    dropBg: "rgba(148,163,184,0.06)",
  },
  analysis: {
    label: "Analysis",
    color: "#f59e0b",
    gradient: "linear-gradient(90deg,#f59e0b,#fbbf24)",
    bg: "#fffbeb",
    textColor: "#92400e",
    dotColor: "#f59e0b",
    dropBg: "rgba(245,158,11,0.06)",
  },
  review: {
    label: "Review",
    color: "#6366f1",
    gradient: "linear-gradient(90deg,#6366f1,#8b5cf6)",
    bg: "#f5f3ff",
    textColor: "#4338ca",
    dotColor: "#6366f1",
    dropBg: "rgba(99,102,241,0.06)",
  },
  in_progress: {
    label: "Implementation",
    color: "#3b82f6",
    gradient: "linear-gradient(90deg,#3b82f6,#60a5fa)",
    bg: "#eff6ff",
    textColor: "#1d4ed8",
    dotColor: "#3b82f6",
    dropBg: "rgba(59,130,246,0.06)",
  },
  implemented: {
    label: "Implemented",
    color: "#10b981",
    gradient: "linear-gradient(90deg,#10b981,#34d399)",
    bg: "#f0fdf4",
    textColor: "#065f46",
    dotColor: "#10b981",
    dropBg: "rgba(16,185,129,0.06)",
  },
  closed: {
    label: "Closed",
    color: "#64748b",
    gradient: "linear-gradient(90deg,#64748b,#94a3b8)",
    bg: "#f8fafc",
    textColor: "#334155",
    dotColor: "#64748b",
    dropBg: "rgba(100,116,139,0.06)",
  },
};

/* =========================
   Helpers
========================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeNum(x: any, fb = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function isLocked(item: ChangeItem) {
  return safeStr(item.decision_status).trim().toLowerCase() === "submitted";
}

function isDecided(item: ChangeItem) {
  const d = safeStr(item.decision_status).trim().toLowerCase();
  return d === "approved" || d === "rejected";
}

function changeDisplay(it: ChangeItem) {
  if (it.public_id) return it.public_id.toUpperCase();
  if (typeof it.seq === "number") return `CR-${it.seq}`;
  const id = safeStr(it.id);
  return id ? `CR-${id.slice(0, 6)}` : "CR";
}

function riskLabelFromImpact(impact: any): { label: string; level: "High" | "Medium" | "Low" | "None" } {
  const raw =
    safeStr(impact?.risk_level).trim() ||
    safeStr(impact?.risk_rating).trim() ||
    safeStr(impact?.risk).trim();
  if (!raw) return { label: "", level: "None" };
  const v = raw.toLowerCase();
  if (v.includes("critical") || v.includes("high")) return { label: "High", level: "High" };
  if (v.includes("medium") || v.includes("med")) return { label: "Medium", level: "Medium" };
  if (v.includes("low") || v.includes("none")) return { label: "Low", level: "Low" };
  return { label: raw.slice(0, 14), level: "None" };
}

function priorityConfig(p: unknown) {
  const v = safeStr(p).trim().toLowerCase();
  if (v === "critical") return { color: "#dc2626", bg: "rgba(220,38,38,0.08)", border: "rgba(220,38,38,0.22)" };
  if (v === "high") return { color: "#ea580c", bg: "rgba(234,88,12,0.08)", border: "rgba(234,88,12,0.22)" };
  if (v === "medium") return { color: "#6366f1", bg: "rgba(99,102,241,0.08)", border: "rgba(99,102,241,0.22)" };
  if (v === "low") return { color: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.22)" };
  return { color: "#64748b", bg: "rgba(100,116,139,0.08)", border: "rgba(100,116,139,0.22)" };
}

function riskConfig(level: "High" | "Medium" | "Low" | "None") {
  if (level === "High") return { dot: "#ef4444", bg: "rgba(239,68,68,0.08)", text: "#dc2626", border: "rgba(239,68,68,0.22)" };
  if (level === "Medium") return { dot: "#f59e0b", bg: "rgba(245,158,11,0.08)", text: "#d97706", border: "rgba(245,158,11,0.22)" };
  if (level === "Low") return { dot: "#3b82f6", bg: "rgba(59,130,246,0.08)", text: "#2563eb", border: "rgba(59,130,246,0.22)" };
  return { dot: "#94a3b8", bg: "rgba(148,163,184,0.08)", text: "#64748b", border: "rgba(148,163,184,0.22)" };
}

function deliveryLaneToUiStatus(raw: any): ChangeStatus {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "intake") return "new";
  if (v === "analysis") return "analysis";
  if (v === "review") return "review";
  if (v === "in_progress") return "in_progress";
  if (v === "implemented") return "implemented";
  if (v === "closed") return "closed";
  if (v === "new") return "new";
  return "new";
}

function mapRowToModalInitialValue(it: ChangeItem) {
  const impact = it.impact_analysis && typeof it.impact_analysis === "object" ? it.impact_analysis : null;
  return {
    title: safeStr(it.title),
    requester: safeStr((it as any)?.requester_name),
    status: deliveryLaneToUiStatus(it.delivery_status),
    priority: (safeStr(it.priority) as any) || "Medium",
    summary: safeStr(it.description),
    justification: safeStr((it as any)?.justification),
    financial: safeStr((it as any)?.financial),
    schedule: safeStr((it as any)?.schedule),
    risks: safeStr((it as any)?.risks),
    dependencies: safeStr((it as any)?.dependencies),
    assumptions: safeStr((it as any)?.assumptions),
    implementationPlan: safeStr((it as any)?.implementationPlan) || safeStr((it as any)?.implementation_plan) || "",
    rollbackPlan: safeStr((it as any)?.rollbackPlan) || safeStr((it as any)?.rollback_plan) || "",
    aiImpact: impact
      ? { days: safeNum(impact?.days, 0), cost: safeNum(impact?.cost, 0), risk: safeStr(impact?.risk ?? "None identified") || "None identified" }
      : undefined,
  };
}

function dedupeKeepLatest(rows: ChangeItem[]) {
  const byId = new Map<string, ChangeItem>();
  for (const r of Array.isArray(rows) ? rows : []) {
    const id = safeStr((r as any)?.id).trim();
    if (!id) continue;
    const prev = byId.get(id);
    if (!prev) { byId.set(id, { ...(r as any), id }); continue; }
    const tPrev = new Date(prev.updated_at || prev.created_at || (0 as any)).getTime();
    const tCur = new Date((r as any).updated_at || (r as any).created_at || (0 as any)).getTime();
    if (tCur >= tPrev) byId.set(id, { ...(r as any), id });
  }
  return Array.from(byId.values());
}

function sortForBoard(a: ChangeItem, b: ChangeItem) {
  const ta = new Date(a.updated_at || a.created_at || (0 as any)).getTime();
  const tb = new Date(b.updated_at || b.created_at || (0 as any)).getTime();
  if (tb !== ta) return tb - ta;
  return safeNum(b.seq, 0) - safeNum(a.seq, 0);
}

async function apiJson(url: string, init?: RequestInit) {
  const res = await fetch(url, init);
  const json = await res.json().catch(() => ({}));
  if (!res.ok || (json as any)?.ok === false) throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  return json;
}

/* =========================
   CSS (injected once)
========================= */

const BOARD_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Mono:wght@500;600&display=swap');

  .kb-root { font-family:'Inter',system-ui,sans-serif; -webkit-font-smoothing:antialiased; }

  /* ── Top bar ── */
  .kb-topbar {
    display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
    padding:20px 24px 0;
  }
  .kb-title { font-size:17px; font-weight:800; color:#1a1d2e; letter-spacing:-0.02em; }
  .kb-sub { font-size:12.5px; color:#9ba3bc; margin-top:3px; font-weight:400; }
  .kb-wip-warn {
    margin-top:6px; font-size:11px; color:#dc2626;
    background:rgba(220,38,38,0.06); padding:4px 8px; border-radius:6px;
    border:1px solid rgba(220,38,38,0.15); display:inline-block;
  }
  .kb-actions { display:flex; gap:8px; align-items:center; flex-shrink:0; }
  .kb-btn-primary {
    padding:8px 16px; background:linear-gradient(135deg,#4f46e5,#6366f1);
    color:#fff; font-size:12px; font-weight:700; border:none; border-radius:9px;
    cursor:pointer; font-family:inherit; letter-spacing:0.02em;
    box-shadow:0 1px 4px rgba(99,102,241,0.3);
    transition:opacity 0.12s, transform 0.1s, box-shadow 0.12s;
    display:flex; align-items:center; gap:6px;
  }
  .kb-btn-primary:hover:not(:disabled) { opacity:0.9; transform:translateY(-1px); box-shadow:0 3px 10px rgba(99,102,241,0.35); }
  .kb-btn-primary:disabled { opacity:0.45; cursor:not-allowed; }
  .kb-btn-ghost {
    padding:7px 13px; background:#fff; border:1px solid #e4e7f0;
    color:#5a6080; font-size:12px; font-weight:600; border-radius:9px;
    cursor:pointer; font-family:inherit; transition:background 0.12s, border-color 0.12s, color 0.12s;
  }
  .kb-btn-ghost:hover:not(:disabled) { background:#f4f5fa; color:#1a1d2e; border-color:#d0d5e8; }
  .kb-btn-ghost:disabled { opacity:0.4; cursor:not-allowed; }

  /* ── Error banner ── */
  .kb-err {
    margin:12px 24px 0;
    padding:10px 14px; border-radius:9px;
    background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.2);
    font-size:12.5px; color:#dc2626;
    display:flex; align-items:center; gap:8px;
  }

  /* ── Board scroll ── */
  .kb-board {
    display:flex; gap:14px; padding:18px 24px 32px;
    overflow-x:auto; align-items:flex-start; min-height:80vh;
  }
  .kb-board::-webkit-scrollbar { height:6px; }
  .kb-board::-webkit-scrollbar-track { background:transparent; }
  .kb-board::-webkit-scrollbar-thumb { background:#d5d9ef; border-radius:3px; }
  .kb-board::-webkit-scrollbar-thumb:hover { background:#b0b7cc; }

  /* ── Column ── */
  .kb-col {
    width:282px; min-width:282px; flex-shrink:0;
    display:flex; flex-direction:column;
    background:#fff; border-radius:14px; border:1px solid #e4e7f0;
    box-shadow:0 1px 3px rgba(0,0,0,0.04);
    overflow:hidden;
  }
  .kb-col-top { height:3px; }
  .kb-col-head {
    padding:11px 13px 10px;
    border-bottom:1px solid #f0f1f8;
    display:flex; align-items:center; gap:7px;
  }
  .kb-col-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .kb-col-title {
    font-size:10.5px; font-weight:800; letter-spacing:0.07em;
    text-transform:uppercase; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;
  }
  .kb-col-meta { font-size:10px; color:#9ba3bc; font-weight:500; white-space:nowrap; }
  .kb-col-count {
    font-size:10.5px; font-weight:700; color:#9ba3bc;
    background:#f4f5f9; border:1px solid #e8eaf0;
    padding:2px 7px; border-radius:20px;
  }
  .kb-col-wip-over { color:#dc2626 !important; background:rgba(220,38,38,0.08) !important; border-color:rgba(220,38,38,0.2) !important; }
  .kb-col-add {
    width:22px; height:22px; display:flex; align-items:center; justify-content:center;
    border:1px solid #e4e7f0; border-radius:6px; background:transparent;
    color:#9ba3bc; cursor:pointer; font-size:15px; line-height:1;
    transition:background 0.1s, color 0.1s, border-color 0.1s;
  }
  .kb-col-add:hover { background:#f4f5f9; color:#1a1d2e; border-color:#d0d5e8; }

  /* ── Drop zone ── */
  .kb-drop {
    padding:10px; display:flex; flex-direction:column; gap:8px;
    min-height:340px; transition:background 0.15s;
  }
  .kb-drop.over { background:rgba(99,102,241,0.04); }
  .kb-empty {
    border:2px dashed #e2e5f0; border-radius:10px;
    padding:18px 14px; text-align:center;
    font-size:11.5px; color:#b0b7cc; font-weight:500;
  }

  /* ── Card ── */
  @keyframes kb-card-in {
    from { opacity:0; transform:translateY(5px); }
    to { opacity:1; transform:translateY(0); }
  }
  .kb-card {
    background:#fff; border-radius:11px; border:1px solid #e4e7f0;
    box-shadow:0 1px 2px rgba(0,0,0,0.04),0 1px 4px rgba(0,0,0,0.03);
    transition:box-shadow 0.14s,transform 0.14s,border-color 0.14s;
    animation:kb-card-in 0.18s ease backwards;
    overflow:hidden; position:relative;
  }
  .kb-card:hover { box-shadow:0 4px 14px rgba(0,0,0,0.08); border-color:#d0d5e8; transform:translateY(-1px); }
  .kb-card.kb-saving { ring:1px solid rgba(99,102,241,0.3); }
  .kb-card.kb-locked { opacity:0.68; }
  .kb-card-top { height:2.5px; width:100%; }
  .kb-card-body { padding:12px 12px 11px; }
  .kb-card-head { display:flex; align-items:center; justify-content:space-between; margin-bottom:9px; gap:8px; }
  .kb-card-id {
    font-family:'DM Mono',monospace; font-size:9.5px; font-weight:600;
    letter-spacing:0.07em; color:#8b91a7;
    background:#f4f5f9; padding:2px 7px; border-radius:5px; border:1px solid #e8eaf0;
    flex-shrink:0;
  }
  .kb-card-badges { display:flex; gap:4px; flex-wrap:wrap; flex:1; min-width:0; }
  .kb-badge {
    display:inline-flex; align-items:center; gap:3px;
    font-size:10px; font-weight:600; padding:2px 6px;
    border-radius:20px; border:1px solid; letter-spacing:0.01em; white-space:nowrap;
  }
  .kb-badge-dot { width:4px; height:4px; border-radius:50%; flex-shrink:0; }
  .kb-drag-handle {
    width:22px; height:22px; display:flex; align-items:center; justify-content:center;
    border-radius:5px; background:transparent; border:none;
    color:#c4cade; cursor:grab; transition:background 0.1s, color 0.1s; flex-shrink:0;
    padding:0;
  }
  .kb-drag-handle:hover { background:#f0f1f8; color:#5a6080; }
  .kb-drag-handle:disabled { opacity:0.25; cursor:not-allowed; }
  .kb-card-title-btn {
    display:block; width:100%; text-align:left;
    background:transparent; border:none; padding:0; cursor:pointer;
    font-size:12.5px; font-weight:600; color:#1a1d2e; line-height:1.45;
    margin-bottom:7px;
    display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical;
    overflow:hidden; transition:color 0.12s; font-family:inherit;
  }
  .kb-card-title-btn:hover:not(:disabled) { color:#4f46e5; }
  .kb-card-title-btn:disabled { cursor:not-allowed; }
  .kb-card-meta {
    font-size:10.5px; color:#9ba3bc; margin-bottom:8px;
    display:flex; align-items:center; gap:5px; overflow:hidden;
  }
  .kb-avatar {
    width:15px; height:15px; border-radius:50%;
    display:flex; align-items:center; justify-content:center;
    font-size:7.5px; font-weight:800; color:#fff; flex-shrink:0;
  }
  .kb-impact {
    background:#f8f9fc; border:1px solid #eceef5; border-radius:7px;
    padding:7px 9px; margin-bottom:8px;
    display:flex; align-items:center; justify-content:space-between; gap:8px;
  }
  .kb-impact-label {
    font-size:8.5px; font-weight:700; letter-spacing:0.09em;
    text-transform:uppercase; color:#b0b7cc; margin-bottom:4px;
  }
  .kb-impact-vals { display:flex; gap:12px; }
  .kb-impact-item {
    display:flex; align-items:center; gap:4px;
    font-size:11.5px; font-weight:700; color:#2d3152;
  }
  .kb-impact-icon { color:#c4cade; }
  .kb-risk-orb {
    width:30px; height:30px; border-radius:50%;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
  }
  .kb-divider { height:1px; background:#f0f1f8; margin:8px 0; }
  .kb-card-actions { display:flex; gap:4px; flex-wrap:wrap; }
  .kb-action {
    display:inline-flex; align-items:center; gap:3px;
    padding:4px 8px; font-size:10.5px; font-weight:500; color:#6b7280;
    background:#f8f9fc; border:1px solid #eceef5; border-radius:6px;
    cursor:pointer; transition:background 0.1s, color 0.1s, border-color 0.1s;
    font-family:inherit;
  }
  .kb-action:hover:not(:disabled) { background:#eceef5; color:#1a1d2e; border-color:#dde0ee; }
  .kb-action:disabled { opacity:0.4; cursor:not-allowed; }
  .kb-action-ai { color:#6366f1; background:rgba(99,102,241,0.05); border-color:rgba(99,102,241,0.18); }
  .kb-action-ai:hover:not(:disabled) { background:rgba(99,102,241,0.1); border-color:rgba(99,102,241,0.3); color:#4338ca; }
  .kb-action-submit {
    color:#b45309; background:rgba(245,158,11,0.07);
    border-color:rgba(245,158,11,0.22); font-weight:600;
  }
  .kb-action-submit:hover:not(:disabled) { background:rgba(245,158,11,0.14); }
  .kb-locked-msg {
    margin-top:8px; padding:5px 9px;
    background:rgba(245,158,11,0.07); border:1px solid rgba(245,158,11,0.2);
    border-radius:6px; font-size:10.5px; font-weight:500; color:#b45309;
    display:flex; align-items:center; gap:5px;
  }

  /* ── Drag overlay card ── */
  .kb-overlay-card {
    width:270px; background:#fff; border-radius:11px;
    border:1px solid #d0d5e8; box-shadow:0 16px 48px rgba(0,0,0,0.18);
    transform:rotate(1.5deg); padding:12px;
    font-family:'Inter',system-ui,sans-serif;
  }
  .kb-overlay-id {
    font-family:'DM Mono',monospace; font-size:9.5px; font-weight:600;
    color:#8b91a7; background:#f4f5f9; padding:2px 7px;
    border-radius:5px; border:1px solid #e8eaf0; display:inline-block; margin-bottom:7px;
  }
  .kb-overlay-title { font-size:12.5px; font-weight:600; color:#1a1d2e; line-height:1.45; }
`;

let cssInjected = false;
function injectCss() {
  if (typeof document === "undefined" || cssInjected) return;
  cssInjected = true;
  const el = document.createElement("style");
  el.textContent = BOARD_CSS;
  document.head.appendChild(el);
}

/* =========================
   Droppable lane list wrapper
========================= */

function LaneList({ lane, children }: { lane: DeliveryLane; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: lane, data: { type: "Lane", lane } });
  return (
    <div ref={setNodeRef} className={`kb-drop${isOver ? " over" : ""}`}>
      {children}
    </div>
  );
}

/* =========================
   SortableCard
========================= */

function SortableCard({
  lane,
  item,
  saving,
  onClick,
  onAi,
  onTimeline,
  onAttachments,
  onSubmit,
  showSubmit,
}: {
  lane: DeliveryLane;
  item: ChangeItem;
  saving: boolean;
  onClick: (it: ChangeItem) => void;
  onAi: (it: ChangeItem) => void;
  onTimeline: (it: ChangeItem) => void;
  onAttachments: (it: ChangeItem) => void;
  onSubmit: (it: ChangeItem) => void;
  showSubmit: boolean;
}) {
  const sortableId = `card:${item.id}`;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { type: "Card", id: item.id, lane },
    disabled: saving || isLocked(item),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0 : 1,
  };

  const locked = isLocked(item);
  const impactDays = safeNum(item.impact_analysis?.days, 0);
  const impactCost = safeNum(item.impact_analysis?.cost, 0);
  const { label: riskLabel, level: riskLevel } = riskLabelFromImpact(item.impact_analysis);
  const risk = riskConfig(riskLevel);
  const laneConf = LANE_CONFIG[lane];
  const score = safeNum(item.ai_score, 0);

  const requesterName = safeStr(item.requester_name).trim();
  const priConf = item.priority ? priorityConfig(item.priority) : null;

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div className={`kb-card${locked ? " kb-locked" : ""}${saving ? " kb-saving" : ""}`}>
        <div className="kb-card-top" style={{ background: laneConf.gradient }} />
        <div className="kb-card-body">
          {/* Head: ID + badges + drag handle */}
          <div className="kb-card-head">
            <span className="kb-card-id">{changeDisplay(item)}</span>
            <div className="kb-card-badges">
              {priConf && item.priority && (
                <span className="kb-badge" style={{ color: priConf.color, background: priConf.bg, borderColor: priConf.border }}>
                  <span className="kb-badge-dot" style={{ background: priConf.color }} />
                  {safeStr(item.priority)}
                </span>
              )}
              {riskLabel && (
                <span className="kb-badge" style={{ color: risk.text, background: risk.bg, borderColor: risk.border }}>
                  <span className="kb-badge-dot" style={{ background: risk.dot }} />
                  {riskLabel}
                </span>
              )}
            </div>
            <button
              type="button"
              className="kb-drag-handle"
              disabled={locked || saving}
              title={locked ? "Locked during approval" : "Drag to move"}
              {...(!locked && !saving ? listeners : {})}
            >
              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0zm10-12a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0z" />
              </svg>
            </button>
          </div>

          {/* Title */}
          <button
            type="button"
            className="kb-card-title-btn"
            onClick={() => onClick(item)}
            disabled={saving}
          >
            {safeStr(item.title) || "Untitled"}
          </button>

          {/* Requester */}
          {requesterName && (
            <div className="kb-card-meta">
              <div className="kb-avatar" style={{ background: laneConf.gradient }}>
                {requesterName.charAt(0).toUpperCase()}
              </div>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{requesterName}</span>
            </div>
          )}

          {/* AI Impact */}
          <div className="kb-impact">
            <div>
              <div className="kb-impact-label">AI Impact</div>
              <div className="kb-impact-vals">
                <div className="kb-impact-item">
                  <svg className="kb-impact-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
                  </svg>
                  {impactDays ? `+${impactDays}d` : "—"}
                </div>
                <div className="kb-impact-item">
                  <svg className="kb-impact-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                  </svg>
                  {impactCost ? `£${impactCost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}` : "—"}
                </div>
                {score > 0 && (
                  <div className="kb-impact-item" style={{ color: "#9ba3bc", fontWeight: 500 }}>
                    <svg className="kb-impact-icon" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
                    </svg>
                    {Math.round(score)}
                  </div>
                )}
              </div>
            </div>
            <div className="kb-risk-orb" style={{ background: risk.bg, border: `1.5px solid ${risk.border}` }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={risk.dot} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
            </div>
          </div>

          <div className="kb-divider" />

          {/* Actions */}
          <div className="kb-card-actions">
            <button type="button" className="kb-action" onClick={() => onTimeline(item)} disabled={saving} title="Timeline">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
              </svg>
              Timeline
            </button>
            <button type="button" className="kb-action" onClick={() => onAttachments(item)} disabled={saving} title="Attachments">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
              </svg>
              Attach
            </button>
            <button type="button" className="kb-action kb-action-ai" onClick={() => onAi(item)} disabled={saving} title="AI Analysis">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
              </svg>
              AI
            </button>
            {showSubmit && (
              <button type="button" className="kb-action kb-action-submit" onClick={() => onSubmit(item)} disabled={saving} title="Submit for approval">
                Submit →
              </button>
            )}
          </div>

          {locked && (
            <div className="kb-locked-msg">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0110 0v4" />
              </svg>
              Awaiting approval
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* =========================
   Main Board
========================= */

export default function ChangeBoardDnd({
  projectUuid,
  artifactId,
  projectHumanId,
  projectLabel,
  initialOpenChangeId,
  initialOpenPublicId,
}: {
  projectUuid: string;
  artifactId?: string | null;
  projectHumanId?: string | null;
  projectLabel?: string | null;
  initialOpenChangeId?: string;
  initialOpenPublicId?: string;
}) {
  useEffect(() => { injectCss(); }, []);

  const [items, setItems] = useState<ChangeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [savingIds, setSavingIds] = useState<Record<string, true>>({});
  const savingSeqRef = useRef<Record<string, number>>({});
  const [activeSortableId, setActiveSortableId] = useState<string | null>(null);

  // Create/Edit
  const [createOpen, setCreateOpen] = useState(false);
  const [createLane, setCreateLane] = useState<DeliveryLane>("intake");
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editInitialValue, setEditInitialValue] = useState<any | null>(null);

  // Drawers
  const [aiOpen, setAiOpen] = useState(false);
  const [aiChangeId, setAiChangeId] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineChangeId, setTimelineChangeId] = useState<string | null>(null);
  const [attOpen, setAttOpen] = useState(false);
  const [attChangeId, setAttChangeId] = useState<string | null>(null);

  const autoOpenDoneRef = useRef(false);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchData = useCallback(async () => {
    if (!projectUuid) return;
    setLoading(true);
    setErr("");
    try {
      const j = await apiJson(`/api/change?projectId=${encodeURIComponent(projectUuid)}&shape=lanes`, { cache: "no-store" });
      const lanes = (j as any)?.lanes as LanesResponse | undefined;
      const list = Array.isArray((j as any)?.items) ? ((j as any).items as ChangeItem[]) : [];
      const flattened = lanes && typeof lanes === "object"
        ? LANES.flatMap((l) => (Array.isArray((lanes as any)[l]) ? (lanes as any)[l] : []))
        : list;
      const deduped = dedupeKeepLatest(flattened).sort(sortForBoard);
      setItems(deduped);
    } catch (e: any) {
      setItems([]);
      setErr(safeStr(e?.message) || "Failed to load changes");
    } finally {
      setLoading(false);
    }
  }, [projectUuid]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const laneMap = useMemo(() => {
    const canonical = dedupeKeepLatest(items);
    const map: Record<DeliveryLane, ChangeItem[]> = { intake: [], analysis: [], review: [], in_progress: [], implemented: [], closed: [] };
    for (const raw of canonical) {
      const id = safeStr((raw as any)?.id).trim();
      if (!id) continue;
      const it = { ...(raw as any), id } as ChangeItem;
      const l = (safeStr(it.delivery_status).trim() as DeliveryLane) || "intake";
      if (LANES.includes(l)) map[l].push(it);
      else map.intake.push(it);
    }
    for (const l of LANES) map[l] = dedupeKeepLatest(map[l]).sort(sortForBoard);
    return map;
  }, [items]);

  const activeItem = useMemo(() => {
    if (!activeSortableId?.startsWith("card:")) return null;
    const id = activeSortableId.slice("card:".length);
    return items.find((x) => safeStr(x.id).trim() === id) || null;
  }, [activeSortableId, items]);

  const wipWarning = useMemo(() => {
    const over = LANES.filter((l) => (laneMap[l]?.length ?? 0) > (WIP_LIMITS[l] ?? 99));
    if (!over.length) return "";
    return `WIP exceeded: ${over.map((l) => `${LANE_CONFIG[l].label} (${laneMap[l].length}/${WIP_LIMITS[l] ?? 99})`).join(", ")}`;
  }, [laneMap]);

  const openCreate = useCallback((lane: DeliveryLane) => { setCreateLane(lane); setCreateOpen(true); }, []);
  const openEdit = useCallback((it: ChangeItem) => { setEditId(it.id); setEditInitialValue(mapRowToModalInitialValue(it)); setEditOpen(true); }, []);
  const openAi = useCallback((it: ChangeItem) => { setAiChangeId(it.id); setAiOpen(true); }, []);
  const openTimeline = useCallback((it: ChangeItem) => { setTimelineChangeId(it.id); setTimelineOpen(true); }, []);
  const openAttachments = useCallback((it: ChangeItem) => { setAttChangeId(it.id); setAttOpen(true); }, []);

  // ✅ Auto-open from deep link once we have items
  useEffect(() => {
    if (autoOpenDoneRef.current) return;
    if (!items.length) return;
    const targetId = safeStr(initialOpenChangeId).trim();
    const targetPublic = safeStr(initialOpenPublicId).trim().toLowerCase();
    if (!targetId && !targetPublic) return;
    let found: ChangeItem | undefined;
    if (targetId) found = items.find((x) => safeStr(x.id).trim() === targetId);
    if (!found && targetPublic) {
      found = items.find((x) => safeStr((x as any)?.public_id).trim().toLowerCase() === targetPublic);
      if (!found) {
        const norm = targetPublic.replace(/\s+/g, "").replace(/_/g, "-");
        found = items.find((x) => {
          const p = safeStr((x as any)?.public_id).trim().toLowerCase().replace(/\s+/g, "").replace(/_/g, "-");
          return !!p && p === norm;
        });
      }
    }
    if (found) { autoOpenDoneRef.current = true; openEdit(found); }
  }, [items, initialOpenChangeId, initialOpenPublicId, openEdit]);

  const patchDeliveryStatus = useCallback(async (id: string, toLane: DeliveryLane) => {
    await apiJson(`/api/change/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ delivery_status: toLane }),
    });
  }, []);

  function resolveDropLane(over: any): DeliveryLane | null {
    const overId = safeStr(over?.id).trim();
    if (!overId) return null;
    if (LANES.includes(overId as DeliveryLane)) return overId as DeliveryLane;
    if (overId.startsWith("card:")) {
      const id = overId.slice("card:".length);
      const overItem = items.find((x) => safeStr(x.id).trim() === id);
      const lane = safeStr(overItem?.delivery_status).trim() as DeliveryLane;
      if (lane && LANES.includes(lane)) return lane;
    }
    return null;
  }

  const onDragStart = useCallback((e: DragStartEvent) => { setActiveSortableId(String(e.active.id)); }, []);

  const onDragEnd = useCallback(async (e: DragEndEvent) => {
    setActiveSortableId(null);
    const activeSortable = String(e.active?.id || "");
    if (!activeSortable?.startsWith("card:")) return;
    const activeId = activeSortable.slice("card:".length);
    if (!activeId || savingIds[activeId]) return;
    const it = items.find((x) => safeStr(x.id).trim() === activeId);
    if (!it) return;
    const targetLane = resolveDropLane(e.over);
    if (!targetLane) return;
    const fromLane = (safeStr(it.delivery_status).trim() as DeliveryLane) || "intake";
    if (fromLane === targetLane) return;
    if (isLocked(it)) { setErr("This change is locked during approval (submitted)."); return; }
    const snapshot = items;
    const nextToken = (savingSeqRef.current[activeId] || 0) + 1;
    savingSeqRef.current[activeId] = nextToken;
    setErr("");
    setSavingIds((p) => ({ ...p, [activeId]: true }));
    setItems((prev) => dedupeKeepLatest(prev.map((x) => safeStr(x.id).trim() === activeId ? { ...x, delivery_status: targetLane, updated_at: new Date().toISOString() } : x)));
    try {
      await patchDeliveryStatus(activeId, targetLane);
      if (savingSeqRef.current[activeId] !== nextToken) return;
      setSavingIds((p) => { const n = { ...p }; delete n[activeId]; return n; });
    } catch (ex: any) {
      if (savingSeqRef.current[activeId] !== nextToken) return;
      setItems(snapshot);
      setSavingIds((p) => { const n = { ...p }; delete n[activeId]; return n; });
      setErr(safeStr(ex?.message) || "Move failed");
    }
  }, [items, savingIds, patchDeliveryStatus]);

  const submitForApproval = useCallback(async (it: ChangeItem) => {
    try {
      setErr("");
      if (safeStr(it.delivery_status).trim() !== "analysis") { setErr("Only changes in Analysis can be submitted for approval."); return; }
      if (isLocked(it)) { setErr("Already submitted."); return; }
      if (isDecided(it)) { setErr("Already decided."); return; }
      await apiJson(`/api/change/${encodeURIComponent(it.id)}/submit`, { method: "POST" });
      await fetchData();
    } catch (e: any) {
      setErr(safeStr(e?.message) || "Submit failed");
    }
  }, [fetchData]);

  const totalItems = items.length;

  return (
    <div className="kb-root">
      {/* Top bar */}
      <div className="kb-topbar">
        <div>
          <div className="kb-title">
            Change Board
            {projectLabel ? <span style={{ color: "#9ba3bc", fontWeight: 500 }}> · {projectLabel}</span> : null}
          </div>
          <div className="kb-sub">
            {totalItems} change{totalItems !== 1 ? "s" : ""} across {LANES.length} stages · drag to move
          </div>
          {wipWarning ? <div className="kb-wip-warn">{wipWarning}</div> : null}
        </div>
        <div className="kb-actions">
          <button type="button" className="kb-btn-ghost" onClick={fetchData} disabled={loading || !projectUuid}>
            {loading ? (
              <>
                <svg style={{ animation: "spin 1s linear infinite" }} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 12a9 9 0 11-6.219-8.56" />
                </svg>
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                Loading…
              </>
            ) : "Refresh"}
          </button>
          <button type="button" className="kb-btn-primary" onClick={() => openCreate("intake")} disabled={!projectUuid}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            New Change
          </button>
        </div>
      </div>

      {err && (
        <div className="kb-err">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          {err}
        </div>
      )}

      {/* Board */}
      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="kb-board">
          {LANES.map((lane) => {
            const laneItems = laneMap[lane] || [];
            const limit = WIP_LIMITS[lane] ?? 99;
            const isOver = laneItems.length > limit;
            const conf = LANE_CONFIG[lane];
            const sortableIds = laneItems.map((i) => `card:${i.id}`);

            return (
              <div key={lane} className="kb-col">
                <div className="kb-col-top" style={{ background: conf.gradient }} />
                <div className="kb-col-head">
                  <div className="kb-col-dot" style={{ background: conf.color }} />
                  <div className="kb-col-title" style={{ color: conf.textColor }}>{conf.label}</div>
                  <span className={`kb-col-count${isOver ? " kb-col-wip-over" : ""}`}>
                    {laneItems.length}{isOver ? `/${limit}` : ""}
                  </span>
                  <button type="button" className="kb-col-add" onClick={() => openCreate(lane)} title={`New ${conf.label}`}>+</button>
                </div>

                <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                  <LaneList lane={lane}>
                    {laneItems.length === 0 ? (
                      <div className="kb-empty">Drop changes here</div>
                    ) : laneItems.map((item) => (
                      <SortableCard
                        key={item.id}
                        lane={lane}
                        item={item}
                        saving={!!savingIds[item.id]}
                        onClick={openEdit}
                        onAi={openAi}
                        onTimeline={openTimeline}
                        onAttachments={openAttachments}
                        onSubmit={submitForApproval}
                        showSubmit={
                          safeStr(item.delivery_status).trim() === "analysis" &&
                          !isLocked(item) &&
                          !isDecided(item)
                        }
                      />
                    ))}
                  </LaneList>
                </SortableContext>
              </div>
            );
          })}
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={dropAnimation}>
          {activeItem ? (
            <div className="kb-overlay-card">
              <div className="kb-overlay-id">{changeDisplay(activeItem)}</div>
              <div className="kb-overlay-title">{safeStr(activeItem.title) || "Untitled change"}</div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Create modal */}
      <ChangeCreateModal
        open={createOpen}
        onClose={() => { setCreateOpen(false); fetchData(); }}
        projectId={projectUuid}
        artifactId={artifactId ?? null}
        initialStatus={createLane === "intake" ? "new" : (createLane as any)}
      />

      {/* Edit modal */}
      <ChangeCreateModal
        open={editOpen}
        onClose={() => { setEditOpen(false); setEditId(null); setEditInitialValue(null); fetchData(); }}
        projectId={projectUuid}
        artifactId={artifactId ?? null}
        mode="edit"
        changeId={editId}
        initialValue={editInitialValue ?? undefined}
        titleOverride="Edit Change Request"
      />

      {/* AI drawer */}
      <ChangeAiDrawer open={aiOpen} onClose={() => setAiOpen(false)} projectId={projectUuid} artifactId={artifactId ?? null} changeId={aiChangeId} />

      {/* Timeline drawer */}
      {timelineChangeId ? (
        <ChangeTimeline
          open={timelineOpen}
          onClose={() => setTimelineOpen(false)}
          projectId={projectUuid}
          projectCode={projectHumanId ?? undefined}
          changeId={timelineChangeId}
        />
      ) : null}

      {/* Attachments drawer */}
      {attChangeId ? (
        <AttachmentsDrawer
          open={attOpen}
          onClose={() => setAttOpen(false)}
          projectId={projectUuid}
          artifactId={artifactId ?? null}
          changeId={attChangeId}
        />
      ) : null}
    </div>
  );
}