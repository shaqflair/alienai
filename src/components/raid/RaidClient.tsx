"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

type RaidType = "Risk" | "Assumption" | "Issue" | "Dependency";
type RaidStatus = "Open" | "In Progress" | "Mitigated" | "Closed";

export type RaidItem = {
  id: string;
  project_id: string;
  item_no?: number | null;
  public_id?: string | null;
  type: RaidType | string;
  title?: string | null;
  description: string;
  owner_label: string;
  owner_id?: string | null;
  due_date?: string | null;
  updated_at?: string | null;
  priority?: string | null;
  probability?: number | null;
  severity?: number | null;
  ai_rollup?: string | null;
  status: RaidStatus | string;
  response_plan?: string | null;
  related_refs?: any;
  ai_dirty?: boolean | null;
};

type AiRun = {
  id: string;
  created_at: string;
  actor_user_id?: string | null;
  model?: string | null;
  version?: string | null;
  ai_quality?: number | null;
  ai: any;
  inputs: any;
};

/* ---------------- utils ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampNum(n: any, min = 0, max = 100) {
  const v = Number(n);
  if (!Number.isFinite(v)) return min;
  return Math.max(min, Math.min(max, v));
}

function normalizeType(t: any): RaidType {
  const v = safeStr(t).trim();
  if (v === "Risk" || v === "Assumption" || v === "Issue" || v === "Dependency") return v;
  return "Risk";
}

function calcScore(prob?: number | null, sev?: number | null) {
  const p = clampNum(prob ?? 0, 0, 100);
  const s = clampNum(sev ?? 0, 0, 100);
  return Math.round((p * s) / 100);
}

function toneFromScore(sc: number): "g" | "a" | "r" {
  if (sc >= 61) return "r";
  if (sc >= 31) return "a";
  return "g";
}

function fmtWhen(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "—";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });
  } catch {
    return s;
  }
}

/** Display due date as UK format (dd/mm/yyyy). Accepts ISO date "yyyy-mm-dd" or datetime. */
function fmtDateUK(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "";
  // If it's plain ISO date
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [yyyy, mm, dd] = s.split("-");
    return `${dd}/${mm}/${yyyy}`;
  }
  // If it's UK already, keep
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) return s;
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = String(d.getFullYear());
    return `${dd}/${mm}/${yyyy}`;
  } catch {
    return s;
  }
}

function statusToken(s: any): "open" | "inprogress" | "mitigated" | "closed" | "invalid" {
  const v = safeStr(s).toLowerCase().trim();
  if (v === "open") return "open";
  if (v === "in progress" || v === "in_progress" || v === "inprogress") return "inprogress";
  if (v === "mitigated") return "mitigated";
  if (v === "closed") return "closed";
  if (v === "invalid") return "invalid";
  return "open";
}

function priorityToken(p: any): "low" | "medium" | "high" | "critical" | "" {
  const v = safeStr(p).toLowerCase().trim();
  if (v === "low") return "low";
  if (v === "medium") return "medium";
  if (v === "high") return "high";
  if (v === "critical") return "critical";
  return "";
}

function isOpenishStatus(s: any) {
  const v = safeStr(s).toLowerCase().trim();
  return v === "open" || v === "in progress" || v === "in_progress" || v === "inprogress";
}

/* ---------------- Notion keyboard + paste ---------------- */

type CellKey =
  | "description"
  | "owner_label"
  | "status"
  | "priority"
  | "probability"
  | "severity"
  | "due_date"
  | "response_plan";

const EDIT_COLS: CellKey[] = [
  "description",
  "owner_label",
  "status",
  "priority",
  "probability",
  "severity",
  "due_date",
  "response_plan",
];

function cx(...a: Array<string | false | null | undefined>) {
  return a.filter(Boolean).join(" ");
}

function parseTsv(text: string) {
  const raw = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = raw.split("\n").filter((r) => r.length > 0);
  return rows.map((r) => r.split("\t"));
}

function normStatus(x: any): RaidStatus {
  const s = safeStr(x).trim().toLowerCase();
  if (s === "open") return "Open";
  if (s === "in progress" || s === "in_progress" || s === "inprogress") return "In Progress";
  if (s === "mitigated") return "Mitigated";
  if (s === "closed") return "Closed";
  return "Open";
}

function normPriority(x: any): "Low" | "Medium" | "High" | "Critical" | "" {
  const s = safeStr(x).trim().toLowerCase();
  if (!s || s === "—" || s === "-") return "";
  if (s === "low") return "Low";
  if (s === "medium") return "Medium";
  if (s === "high") return "High";
  if (s === "critical") return "Critical";
  return "";
}

function normDateToIsoOnly(x: any): string | null {
  const s = safeStr(x).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // UK: dd/mm/yyyy or dd/mm/yy
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (m) {
    const dd = String(m[1]).padStart(2, "0");
    const mm = String(m[2]).padStart(2, "0");
    let yyyy = m[3];
    if (yyyy.length === 2) {
      const y = Number(yyyy);
      yyyy = String(y >= 70 ? 1900 + y : 2000 + y);
    }
    return `${yyyy}-${mm}-${dd}`;
  }

  const d = new Date(s);
  if (!Number.isNaN(d.getTime())) {
    const yyyy = String(d.getFullYear());
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }
  return null;
}

/* ---------------- keyboard shortcuts (existing global) ---------------- */

const STATUS_ORDER = ["Open", "In Progress", "Mitigated", "Closed"] as const;
const PRIORITY_ORDER = ["Low", "Medium", "High", "Critical"] as const;

function isTypingTarget(el: EventTarget | null) {
  const n = el as HTMLElement | null;
  if (!n) return false;
  return Boolean(n.closest("input, textarea, select, [contenteditable='true']"));
}

function cycleInList(list: readonly string[], current: string) {
  const cur = safeStr(current);
  const i = list.findIndex((x) => x === cur);
  const idx = i < 0 ? 0 : i;
  return list[(idx + 1) % list.length];
}

/* ---------------- styling tokens ---------------- */

const TYPE_CONFIG: Record<
  RaidType,
  {
    color: string;
    bg: string;
    headerBg: string;
    border: string;
    dot: string;
    textColor: string;
    lightBg: string;
    desc: string;
    emoji: string;
  }
> = {
  Risk: {
    color: "#e03e3e",
    bg: "bg-red-50",
    headerBg: "bg-white",
    border: "border-red-100",
    dot: "bg-red-500",
    textColor: "text-red-700",
    lightBg: "bg-red-50/60",
    desc: "Events that may occur",
    emoji: "⚠",
  },
  Assumption: {
    color: "#d9730d",
    bg: "bg-orange-50",
    headerBg: "bg-white",
    border: "border-orange-100",
    dot: "bg-orange-400",
    textColor: "text-orange-700",
    lightBg: "bg-orange-50/60",
    desc: "Beliefs that need validation",
    emoji: "💡",
  },
  Issue: {
    color: "#0f7b6c",
    bg: "bg-emerald-50",
    headerBg: "bg-white",
    border: "border-emerald-100",
    dot: "bg-emerald-500",
    textColor: "text-emerald-700",
    lightBg: "bg-emerald-50/60",
    desc: "Active blockers to resolve",
    emoji: "🔥",
  },
  Dependency: {
    color: "#0b6bcb",
    bg: "bg-blue-50",
    headerBg: "bg-white",
    border: "border-blue-100",
    dot: "bg-blue-500",
    textColor: "text-blue-700",
    lightBg: "bg-blue-50/60",
    desc: "External blockers to track",
    emoji: "🔗",
  },
};

/* ✅ Bright glossy status pills */
const STATUS_STYLES: Record<string, { bg: string; text: string; dot: string; ring: string }> = {
  open: {
    bg: "bg-gradient-to-r from-sky-500 to-blue-600",
    text: "text-white",
    dot: "bg-white/90",
    ring: "ring-1 ring-white/25",
  },
  inprogress: {
    bg: "bg-gradient-to-r from-indigo-500 to-violet-600",
    text: "text-white",
    dot: "bg-white/90",
    ring: "ring-1 ring-white/25",
  },
  mitigated: {
    bg: "bg-gradient-to-r from-emerald-500 to-green-600",
    text: "text-white",
    dot: "bg-white/90",
    ring: "ring-1 ring-white/25",
  },
  closed: {
    bg: "bg-gradient-to-r from-slate-500 to-slate-700",
    text: "text-white",
    dot: "bg-white/75",
    ring: "ring-1 ring-white/20",
  },
  invalid: {
    bg: "bg-gradient-to-r from-rose-500 to-red-600",
    text: "text-white",
    dot: "bg-white/90",
    ring: "ring-1 ring-white/25",
  },
};

/* ✅ Bright glossy priority tags */
const PRIORITY_STYLES: Record<string, { bg: string; text: string; label: string; ring: string }> = {
  "": { bg: "bg-transparent", text: "text-gray-400", label: "—", ring: "" },
  low: {
    bg: "bg-gradient-to-r from-cyan-500 to-sky-600",
    text: "text-white",
    label: "Low",
    ring: "ring-1 ring-white/25",
  },
  medium: {
    bg: "bg-gradient-to-r from-amber-400 to-orange-500",
    text: "text-white",
    label: "Medium",
    ring: "ring-1 ring-white/25",
  },
  high: {
    bg: "bg-gradient-to-r from-orange-500 to-rose-500",
    text: "text-white",
    label: "High",
    ring: "ring-1 ring-white/25",
  },
  critical: {
    bg: "bg-gradient-to-r from-red-600 to-fuchsia-600",
    text: "text-white",
    label: "Critical",
    ring: "ring-1 ring-white/25",
  },
};

/* ---------------- digest helpers ---------------- */

function digestId(x: any) {
  const pid = safeStr(x?.public_id).trim();
  const id = safeStr(x?.id).trim();
  return pid || id;
}

function digestIdShort(x: any) {
  const pid = safeStr(x?.public_id).trim();
  if (pid) return pid;
  const id = safeStr(x?.id).trim();
  return id ? id.slice(0, 6).toUpperCase() : "ID";
}

function digestDeepLink(projectRouteId: string, x: any) {
  const id = safeStr(x?.id).trim();
  const pid = safeStr(x?.public_id).trim();
  const focus = encodeURIComponent(id || "");
  const pidQ = encodeURIComponent(pid || "");
  const hash = encodeURIComponent(pid || id || "");
  return `/projects/${projectRouteId}/raid?focus=${focus}&pid=${pidQ}#${hash}`;
}

/* ---------------- api helpers ---------------- */

async function postJson(url: string, method: string, body?: any, headers?: Record<string, string>) {
  const res = await fetch(url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(headers ?? {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 204) return { ok: true };

  const text = await res.text().catch(() => "");
  const j = text
    ? (() => {
        try {
          return JSON.parse(text);
        } catch {
          return null;
        }
      })()
    : null;

  if (res.ok && !j) return { ok: true };

  if (!res.ok || !j?.ok) {
    const err = new Error(j?.error || `Failed (${res.status})`);
    (err as any).status = res.status;
    (err as any).payload = j;
    throw err;
  }

  return j;
}

async function fetchRaidItems(projectId: string) {
  const res = await fetch(`/api/raid?projectId=${encodeURIComponent(projectId)}`, { method: "GET" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);
  return (j.items ?? []) as RaidItem[];
}

async function fetchRaidItemById(id: string) {
  const res = await fetch(`/api/raid/${encodeURIComponent(id)}`, { method: "GET" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);
  return j.item as RaidItem;
}

async function patchRaidItem(id: string, patch: any, expectedUpdatedAt?: string) {
  const hdrs = expectedUpdatedAt ? { "if-match-updated-at": expectedUpdatedAt } : undefined;
  const j = await postJson(`/api/raid/${encodeURIComponent(id)}`, "PATCH", patch, hdrs);
  return j.item as RaidItem;
}

async function createRaidItem(payload: any) {
  const j = await postJson(`/api/raid`, "POST", payload);
  return j.item as RaidItem;
}

async function deleteRaidItem(id: string, expectedUpdatedAt?: string) {
  try {
    await postJson(
      `/api/raid/${encodeURIComponent(id)}`,
      "DELETE",
      undefined,
      expectedUpdatedAt ? { "if-match-updated-at": expectedUpdatedAt } : undefined
    );
  } catch (e: any) {
    if ((e as any)?.status !== 405) throw e;
    try {
      await postJson(
        `/api/raid/${encodeURIComponent(id)}/delete`,
        "POST",
        { id, expected_updated_at: expectedUpdatedAt || undefined },
        expectedUpdatedAt ? { "if-match-updated-at": expectedUpdatedAt } : undefined
      );
      return;
    } catch (e2: any) {
      if ((e2 as any)?.status !== 404) throw e2;
      await postJson(
        `/api/raid/delete`,
        "POST",
        { id, expected_updated_at: expectedUpdatedAt || undefined },
        expectedUpdatedAt ? { "if-match-updated-at": expectedUpdatedAt } : undefined
      );
    }
  }
}

async function aiRefreshRaidItem(id: string) {
  const j = await postJson(`/api/raid/${encodeURIComponent(id)}/ai-refresh`, "POST");
  return j.item as RaidItem;
}

async function fetchWeeklyDigest(projectId: string) {
  const url = `/api/raid/digest?projectId=${encodeURIComponent(projectId)}`;
  try {
    const j = await postJson(url, "GET");
    return j.digest as any;
  } catch (e: any) {
    if ((e as any)?.status === 405) {
      const j2 = await postJson(`/api/raid/digest`, "POST", { projectId });
      return j2.digest as any;
    }
    throw e;
  }
}

async function fetchAiHistory(raidId: string) {
  const res = await fetch(`/api/raid/${encodeURIComponent(raidId)}/ai-history`, { method: "GET" });
  const j = await res.json().catch(() => null);
  if (!res.ok || !j?.ok) throw new Error(j?.error || `Failed (${res.status})`);
  return (j.runs ?? []) as AiRun[];
}

/* ---------------- component ---------------- */

type ColKey = "desc" | "resp";
const DEFAULT_COL_WIDTHS: Record<ColKey, number> = { desc: 340, resp: 300 };

/* ---------------- dnd helpers ---------------- */

function reorder<T>(list: T[], startIndex: number, endIndex: number) {
  const result = Array.from(list);
  const [removed] = result.splice(startIndex, 1);
  result.splice(endIndex, 0, removed);
  return result;
}

function dndIdForRaid(it: { id: string }) {
  return `raid:${it.id}`;
}

/* ---------------- banners ---------------- */

type Banner = { kind: "success" | "error"; text: string; id: string };

function newBanner(kind: Banner["kind"], text: string): Banner {
  return { kind, text, id: `${kind}:${Date.now()}:${Math.random().toString(16).slice(2)}` };
}

/* ---------------- Column header cell ---------------- */
const COL_HDR =
  "px-3 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-widest bg-[#f7f7f5] border-b border-r border-gray-200 select-none whitespace-nowrap";

/* ---------------- Row cell base styles ---------------- */
const CELL_BASE =
  "px-0 py-0 border-b border-r border-gray-200 bg-white align-middle group-hover/row:bg-[#fafaf9] transition-colors duration-75";

function pluralLabel(type: RaidType) {
  if (type === "Dependency") return "Dependencies";
  return `${type}s`;
}

/* ------------ Notion-style inline cell display ------------ */
function CellDisplay({
  value,
  placeholder,
  align = "left",
  mono,
  dimIfEmpty = true,
  onActivate,
  title,
}: {
  value: string;
  placeholder?: string;
  align?: "left" | "center" | "right";
  mono?: boolean;
  dimIfEmpty?: boolean;
  onActivate: () => void;
  title?: string;
}) {
  const v = safeStr(value ?? "").trim();
  return (
    <div
      role="gridcell"
      tabIndex={0}
      onFocus={onActivate}
      onMouseDown={(e) => {
        if ((e.target as HTMLElement | null)?.closest("[data-dnd-handle]")) return;
        onActivate();
      }}
      onDoubleClick={onActivate}
      className={cx(
        "w-full min-h-[34px] flex items-center px-3 py-1.5 cursor-text",
        "outline-none",
        "focus:shadow-[inset_0_0_0_2px_#0f7b6c]",
        "hover:bg-[#f0efec]/70",
        align === "center" && "justify-center text-center",
        align === "right" && "justify-end text-right",
        mono && "font-mono text-[12px]",
        !mono && "text-[13px]",
        "truncate"
      )}
      title={title ?? (v || "")}
    >
      {v ? (
        <span className="text-gray-800 truncate">{v}</span>
      ) : (
        <span className={cx(dimIfEmpty ? "text-gray-300" : "text-gray-400", "text-[12px]")}>
          {placeholder || "—"}
        </span>
      )}
    </div>
  );
}

/* ------------ Glossy status/priority tags ------------ */
function StatusTag({
  label,
  onActivate,
  disabled,
}: {
  label: string;
  onActivate: () => void;
  disabled?: boolean;
}) {
  const key = statusToken(label);
  const style = STATUS_STYLES[key] || STATUS_STYLES.open;
  const displayLabel = label === "In Progress" ? "In Progress" : label || "Open";

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }}
      className={cx(
        "relative inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-semibold",
        "shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_18px_rgba(0,0,0,0.08)]",
        "transition-transform duration-150 active:scale-[0.98]",
        style.bg,
        style.text,
        style.ring,
        disabled && "opacity-60 cursor-not-allowed"
      )}
    >
      <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/35 via-white/10 to-transparent" />
      <span className={cx("relative w-1.5 h-1.5 rounded-full shrink-0", style.dot)} />
      <span className="relative">{displayLabel}</span>
    </button>
  );
}

function PriorityTag({
  label,
  onActivate,
  disabled,
}: {
  label: string;
  onActivate: () => void;
  disabled?: boolean;
}) {
  const key = priorityToken(label);
  const style = PRIORITY_STYLES[key] || PRIORITY_STYLES[""];

  return (
    <button
      type="button"
      disabled={disabled}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onActivate();
      }}
      className={cx(
        "relative inline-flex items-center px-3 py-1 rounded-full text-[12px] font-semibold",
        key ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_18px_rgba(0,0,0,0.08)]" : "",
        "transition-transform duration-150 active:scale-[0.98]",
        style.bg,
        style.text,
        style.ring,
        disabled && "opacity-60 cursor-not-allowed"
      )}
    >
      {key ? (
        <span className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/35 via-white/10 to-transparent" />
      ) : null}
      <span className="relative">{style.label}</span>
    </button>
  );
}

/* ---------------- Active-cell overlay editor ---------------- */

type ActiveCell = { type: RaidType; rowId: string; col: CellKey } | null;

type EditorState =
  | null
  | {
      type: RaidType;
      rowId: string;
      col: CellKey;
      rect: { left: number; top: number; width: number; height: number };
      value: string;
    };

function isPrintableKey(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  const k = e.key;
  return k.length === 1;
}

/* ------------ Score badge ------------ */
function ScoreBadge({ score }: { score: number }) {
  const tone = toneFromScore(score);
  return (
    <div className="flex items-center gap-2">
      <div
        className={cx(
          "w-8 h-8 rounded-lg flex items-center justify-center text-[12px] font-bold tabular-nums",
          tone === "r"
            ? "bg-red-100 text-red-700"
            : tone === "a"
            ? "bg-amber-100 text-amber-700"
            : "bg-green-100 text-green-700"
        )}
      >
        {score}
      </div>
      <div className="w-14 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={cx(
            "h-full rounded-full transition-all duration-300",
            tone === "r" ? "bg-red-400" : tone === "a" ? "bg-amber-400" : "bg-green-400"
          )}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

/* ------------ Stat chip ------------ */
function StatChip({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-white border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <span className={cx("w-2 h-2 rounded-full", color)} />
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className="text-[13px] font-semibold text-gray-800">{value}</span>
    </div>
  );
}

/* ------------ Icon components ------------ */
const IconAI = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
  </svg>
);

const IconRefresh = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
    />
  </svg>
);

const IconTrash = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
    />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg
    className={cx("w-4 h-4 transition-transform duration-200", open ? "rotate-90" : "rotate-0")}
    fill="none"
    viewBox="0 0 24 24"
    stroke="currentColor"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const IconDots = () => (
  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
  </svg>
);

const IconDragHandle = () => (
  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="text-gray-400">
    <path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0zM7 10a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0zM7 16a1 1 0 11-2 0 1 1 0 012 0zm8 16a1 1 0 11-2 0 1 1 0 012 0z" />
  </svg>
);

const IconPlus = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
  </svg>
);

const IconClose = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function RaidClient({
  projectId,
  projectRouteId,
  projectTitle,
  projectClient,
  projectPublicId,
  initialItems,
}: {
  projectId: string;
  projectRouteId?: string;
  projectTitle?: string;
  projectClient?: string;
  projectPublicId?: string;
  initialItems: RaidItem[];
}) {
  const routeProjectId = useMemo(() => safeStr(projectRouteId).trim() || projectId, [projectRouteId, projectId]);

  const [items, setItems] = useState<RaidItem[]>(initialItems ?? []);
  const [busyId, setBusyId] = useState<string>("");

  const [banners, setBanners] = useState<Banner[]>([]);
  const pushBanner = useCallback((kind: Banner["kind"], text: string) => {
    const b = newBanner(kind, text);
    setBanners((prev) => [b, ...prev].slice(0, 3));
    window.setTimeout(() => {
      setBanners((prev) => prev.filter((x) => x.id !== b.id));
    }, 3500);
  }, []);
  const dismissBanner = useCallback((id: string) => setBanners((prev) => prev.filter((x) => x.id !== id)), []);

  const [digestBusy, setDigestBusy] = useState<boolean>(false);
  const [digest, setDigest] = useState<any>(null);

  const [aiOpenId, setAiOpenId] = useState<string>("");
  const [staleById, setStaleById] = useState<Record<string, { at: string; message: string }>>({});
  const [aiHistOpenId, setAiHistOpenId] = useState<string>("");
  const [aiRunsById, setAiRunsById] = useState<Record<string, AiRun[]>>({});
  const [aiHistBusyId, setAiHistBusyId] = useState<string>("");
  const [aiCompareById, setAiCompareById] = useState<Record<string, { a: string; b: string }>>({});

  const [openGroups, setOpenGroups] = useState<Record<RaidType, boolean>>({
    Risk: true,
    Assumption: true,
    Issue: true,
    Dependency: true,
  });

  const [menuOpenFor, setMenuOpenFor] = useState<RaidType | "">("");
  const menuBtnRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const menuRef = useRef<HTMLDivElement | null>(null);

  const [colW, setColW] = useState<Record<ColKey, number>>(DEFAULT_COL_WIDTHS);
  const resizeRef = useRef<{ key: ColKey | ""; startX: number; startW: number }>({ key: "", startX: 0, startW: 0 });

  const [touchedById, setTouchedById] = useState<Record<string, { owner?: boolean; plan?: boolean }>>({});
  const [hotRowId, setHotRowId] = useState<string>("");
  const [hotCell, setHotCell] = useState<ActiveCell>(null);
  const [hoveredRowId, setHoveredRowId] = useState<string>("");

  const cellRefs = useRef<Record<string, HTMLElement | null>>({});
  const setCellRef = useCallback((rowId: string, col: CellKey, el: HTMLElement | null) => {
    cellRefs.current[`${rowId}:${col}`] = el;
  }, []);

  const [editor, setEditor] = useState<EditorState>(null);
  const editorInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null>(null);

  const openEditor = useCallback(
    (ctx: { type: RaidType; rowId: string; col: CellKey }, initialValue?: string) => {
      const el = cellRefs.current[`${ctx.rowId}:${ctx.col}`];
      if (!el) return;
      const r = el.getBoundingClientRect();
      const rect = {
        left: Math.max(8, r.left),
        top: Math.max(8, r.top),
        width: Math.max(120, r.width),
        height: Math.max(34, r.height),
      };
      const curItem = items.find((x) => x.id === ctx.rowId);
      const fallback =
        ctx.col === "description"
          ? safeStr(curItem?.description)
          : ctx.col === "owner_label"
          ? safeStr(curItem?.owner_label)
          : ctx.col === "status"
          ? safeStr(curItem?.status || "Open")
          : ctx.col === "priority"
          ? safeStr(curItem?.priority || "")
          : ctx.col === "probability"
          ? String(Number.isFinite(Number(curItem?.probability)) ? Number(curItem?.probability) : 0)
          : ctx.col === "severity"
          ? String(Number.isFinite(Number(curItem?.severity)) ? Number(curItem?.severity) : 0)
          : ctx.col === "due_date"
          ? safeStr(curItem?.due_date || "")
          : ctx.col === "response_plan"
          ? safeStr(curItem?.response_plan || "")
          : "";

      setHotCell(ctx);
      setEditor({ ...ctx, rect, value: initialValue != null ? initialValue : fallback });

      window.setTimeout(() => {
        try {
          editorInputRef.current?.focus?.();
          const elAny = editorInputRef.current as any;
          if (elAny && typeof elAny.setSelectionRange === "function" && typeof elAny.value === "string") {
            const v = elAny.value;
            elAny.setSelectionRange(v.length, v.length);
          }
        } catch {}
      }, 0);
    },
    [items]
  );

  const closeEditor = useCallback(() => setEditor(null), []);

  /** Build patch for a given cell value (single source of truth). */
  const buildPatchForCell = useCallback((col: CellKey, rawValue: any) => {
    const raw = safeStr(rawValue ?? "");
    const patch: any = {};

    if (col === "description") patch.description = safeStr(raw).trim() || "Untitled";
    if (col === "owner_label") patch.owner_label = safeStr(raw).trim();
    if (col === "status") patch.status = normStatus(raw);
    if (col === "priority") patch.priority = normPriority(raw) || null;
    if (col === "probability") patch.probability = clampNum(raw, 0, 100);
    if (col === "severity") patch.severity = clampNum(raw, 0, 100);
    if (col === "due_date") patch.due_date = normDateToIsoOnly(raw) || null;
    if (col === "response_plan") patch.response_plan = safeStr(raw).trim() || null;

    // safety: never allow "invalid" (legacy) to sneak in
    if ("status" in patch && safeStr(patch.status).trim().toLowerCase() === "invalid") patch.status = "Closed";

    return patch;
  }, []);

  /** Reliable commit that can take an override value (fixes "select change doesn't save"). */
  const commitCell = useCallback(
    async (rowId: string, col: CellKey, valueOverride?: any, opts?: { close?: boolean }) => {
      const current = items.find((x) => x.id === rowId);
      const expected = safeStr(current?.updated_at).trim();

      const effectiveValue = valueOverride != null ? valueOverride : editor?.value ?? "";
      const patch = buildPatchForCell(col, effectiveValue);

      // optimistic UI
      setItems((prev) =>
        prev.map((it) => {
          if (it.id !== rowId) return it;
          return { ...it, ...patch } as RaidItem;
        })
      );

      setBusyId(rowId);
      try {
        if ("owner_label" in patch) {
          const o = safeStr(patch.owner_label).trim();
          if (!o) throw new Error("Owner is mandatory");
        }

        const updated = await patchRaidItem(rowId, { ...patch, expected_updated_at: expected || undefined }, expected || undefined);
        setItems((prev) => prev.map((x) => (x.id === rowId ? ({ ...x, ...updated } as RaidItem) : x)));
        setStaleById((prev) => {
          const n = { ...prev };
          delete n[rowId];
          return n;
        });
      } catch (e: any) {
        const status = (e as any)?.status;
        const payload = (e as any)?.payload;
        if (status === 409 || payload?.stale) {
          setStaleById((prev) => ({
            ...prev,
            [rowId]: { at: new Date().toISOString(), message: "Conflict detected. Reloading latest..." },
          }));
          try {
            const fresh = await fetchRaidItemById(rowId);
            setItems((prev) => prev.map((x) => (x.id === rowId ? { ...x, ...fresh } : x)));
            pushBanner("success", "Reloaded with latest changes");
          } catch (re: any) {
            pushBanner("error", re?.message || "Stale update");
          }
        } else {
          pushBanner("error", e?.message || "Update failed");
        }
      } finally {
        setBusyId("");
        if (opts?.close !== false) closeEditor();
      }
    },
    [items, editor, buildPatchForCell, pushBanner, closeEditor]
  );

  const commitEditor = useCallback(
    async (opts?: { close?: boolean }) => {
      if (!editor) return;
      await commitCell(editor.rowId, editor.col, editor.value, opts);
    },
    [editor, commitCell]
  );

  // Close menu on outside click
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!menuOpenFor) return;
      const t = e.target as Node | null;
      if (!t) return;
      const btn = menuBtnRefs.current[menuOpenFor] || null;
      const menu = menuRef.current;
      if (menu?.contains(t)) return;
      if (btn?.contains(t)) return;
      setMenuOpenFor("");
    }
    function onKey(e: KeyboardEvent) {
      if (!menuOpenFor) return;
      if (e.key === "Escape") setMenuOpenFor("");
    }
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpenFor]);

  // Column resize handlers
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const key = resizeRef.current.key;
      if (!key) return;
      const dx = e.clientX - resizeRef.current.startX;
      const next = Math.max(200, Math.min(900, resizeRef.current.startW + dx));
      setColW((prev) => ({ ...prev, [key]: next }));
    }
    function onUp() {
      if (!resizeRef.current.key) return;
      resizeRef.current.key = "";
      document.body.style.cursor = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const startResize = useCallback(
    (key: ColKey, e: React.MouseEvent) => {
      e.preventDefault();
      resizeRef.current = { key, startX: e.clientX, startW: colW[key] };
      document.body.style.cursor = "col-resize";
    },
    [colW]
  );

  const toggleGroup = useCallback((type: RaidType) => {
    setOpenGroups((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  const grouped = useMemo(() => {
    const g: Record<RaidType, RaidItem[]> = { Risk: [], Assumption: [], Issue: [], Dependency: [] };
    for (const it of items) g[normalizeType(it.type)].push(it);
    (Object.keys(g) as RaidType[]).forEach((k) => {
      g[k].sort((a, b) => (safeStr(b.updated_at) > safeStr(a.updated_at) ? 1 : -1));
    });
    return g;
  }, [items]);

  const stats = useMemo(() => {
    const openish = items.filter((x) => isOpenishStatus(x.status));
    const highExp = items.filter(
      (x) => calcScore(x.probability, x.severity) >= 61 && !safeStr(x.status).toLowerCase().includes("close")
    );
    return {
      total: items.length,
      open: openish.length,
      high: highExp.length,
      mitigated: items.filter((x) => safeStr(x.status).toLowerCase() === "mitigated").length,
    };
  }, [items]);

  const humanProjectId = useMemo(
    () => safeStr(projectPublicId).trim() || projectId.slice(0, 8) + "…",
    [projectPublicId, projectId]
  );
  const humanProjectTitle = useMemo(() => safeStr(projectTitle).trim() || "Untitled project", [projectTitle]);
  const humanClient = useMemo(() => safeStr(projectClient).trim(), [projectClient]);

  const touch = useCallback((id: string, key: "owner" | "plan") => {
    setTouchedById((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [key]: true } }));
  }, []);

  const onReloadRow = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const fresh = await fetchRaidItemById(id);
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...fresh } : x)));
        setStaleById((prev) => {
          const n = { ...prev };
          delete n[id];
          return n;
        });
        pushBanner("success", "Reloaded");
      } catch (e: any) {
        pushBanner("error", e?.message || "Reload failed");
      } finally {
        setBusyId("");
      }
    },
    [pushBanner]
  );

  const onCreate = useCallback(
    async (type: RaidType) => {
      setBusyId(`new:${type}`);
      try {
        const created = await createRaidItem({
          project_id: projectId,
          type,
          description: "New item",
          owner_label: "TBC",
          priority: "Medium",
          probability: 50,
          severity: 50,
          status: "Open",
          response_plan: null,
        });
        setItems((prev) => [created, ...prev]);
        pushBanner("success", `${type} created`);
      } catch (e: any) {
        pushBanner("error", e?.message || "Create failed");
      } finally {
        setBusyId("");
      }
    },
    [projectId, pushBanner]
  );

  const onDelete = useCallback(
    async (id: string) => {
      if (!confirm("Delete this RAID item?")) return;
      setBusyId(id);

      const current = items.find((x) => x.id === id);
      const expected = safeStr(current?.updated_at).trim() || undefined;

      // optimistic remove
      const prev = items;
      setItems((cur) => cur.filter((x) => x.id !== id));
      if (aiOpenId === id) setAiOpenId("");
      if (aiHistOpenId === id) setAiHistOpenId("");

      try {
        await deleteRaidItem(id, expected);
        pushBanner("success", "Deleted");
      } catch (e: any) {
        const status = (e as any)?.status;
        const payload = (e as any)?.payload;
        // restore
        setItems(prev);

        if (status === 409 || payload?.stale) {
          setStaleById((p) => ({
            ...p,
            [id]: { at: new Date().toISOString(), message: "Delete blocked: item was updated by someone else" },
          }));
          pushBanner("error", "Delete blocked: item updated by someone else");
          return;
        }
        pushBanner("error", e?.message || "Delete failed");
      } finally {
        setBusyId("");
      }
    },
    [items, aiOpenId, aiHistOpenId, pushBanner]
  );

  const onAiRefresh = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        const updated = await aiRefreshRaidItem(id);
        setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        pushBanner("success", "AI updated");
        setAiOpenId(id);
      } catch (e: any) {
        pushBanner("error", e?.message || "AI refresh failed");
        setAiOpenId(id);
      } finally {
        setBusyId("");
      }
    },
    [pushBanner]
  );

  const onWeeklyDigest = useCallback(async () => {
    setDigestBusy(true);
    try {
      const d = await fetchWeeklyDigest(projectId);
      setDigest(d);
      pushBanner("success", "Digest generated");
    } catch (e: any) {
      pushBanner("error", e?.message || "Digest failed");
    } finally {
      setDigestBusy(false);
    }
  }, [projectId, pushBanner]);

  const onRefreshAll = useCallback(async () => {
    setBusyId("refresh:all");
    try {
      const fresh = await fetchRaidItems(projectId);
      setItems(fresh);
      pushBanner("success", "Refreshed");
    } catch (e: any) {
      pushBanner("error", e?.message || "Refresh failed");
    } finally {
      setBusyId("");
    }
  }, [projectId, pushBanner]);

  const openHistory = useCallback(
    async (id: string) => {
      setAiHistOpenId((cur) => (cur === id ? "" : id));
      if (aiRunsById[id]?.length) return;
      setAiHistBusyId(id);
      try {
        const runs = await fetchAiHistory(id);
        setAiRunsById((prev) => ({ ...prev, [id]: runs }));
        if (runs.length >= 2) setAiCompareById((prev) => ({ ...prev, [id]: { a: runs[0].id, b: runs[1].id } }));
        else if (runs.length === 1) setAiCompareById((prev) => ({ ...prev, [id]: { a: runs[0].id, b: runs[0].id } }));
      } catch (e: any) {
        pushBanner("error", e?.message || "Failed to load AI history");
      } finally {
        setAiHistBusyId("");
      }
    },
    [aiRunsById, pushBanner]
  );

  function getRun(runs: AiRun[], id: string) {
    return runs.find((r) => r.id === id) || null;
  }
  function diffLines(a: any, b: any) {
    const sa = safeStr(a || "");
    const sb = safeStr(b || "");
    if (sa === sb) return null;
    return { a: sa || "—", b: sb || "—" };
  }
  function diffList(a: any, b: any) {
    const aa = Array.isArray(a) ? a.map(String) : [];
    const bb = Array.isArray(b) ? b.map(String) : [];
    if (aa.join("||") === bb.join("||")) return null;
    return { a: aa.length ? aa : ["—"], b: bb.length ? bb : ["—"] };
  }

  const AUTO_AI_ENABLED = true;
  const AUTO_AI_SCORE_THRESHOLD = 55;
  const AUTO_AI_DEBOUNCE_MS = 1200;
  const AUTO_AI_MIN_GAP_MS = 15000;
  const AUTO_AI_SCORE_DELTA_MIN = 5;

  const autoAiTimersRef = useRef<Record<string, any>>({});
  const autoAiLastRunAtRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      Object.values(autoAiTimersRef.current).forEach(clearTimeout);
    };
  }, []);

  useEffect(() => {
    if (!AUTO_AI_ENABLED) return;
    const now = Date.now();
    for (const it of items) {
      const id = it.id;
      if (!id) continue;
      const dirty = Boolean((it as any).ai_dirty);
      if (!dirty) {
        if (autoAiTimersRef.current[id]) {
          clearTimeout(autoAiTimersRef.current[id]);
          delete autoAiTimersRef.current[id];
        }
        continue;
      }
      if (!isOpenishStatus(it.status)) continue;
      if (busyId === id) continue;
      const curScore = calcScore(it.probability, it.severity);
      if (curScore < AUTO_AI_SCORE_THRESHOLD) continue;

      const prevInputs = it?.related_refs?.ai?.inputs || {};
      const prevProb = typeof prevInputs?.probability === "number" ? prevInputs.probability : null;
      const prevSev = typeof prevInputs?.severity === "number" ? prevInputs.severity : null;
      const prevScore =
        typeof prevInputs?.score === "number"
          ? prevInputs.score
          : prevProb != null || prevSev != null
          ? calcScore(prevProb, prevSev)
          : null;

      const delta = prevScore == null ? 999 : Math.abs(curScore - prevScore);
      if (delta < AUTO_AI_SCORE_DELTA_MIN) continue;

      const last = autoAiLastRunAtRef.current[id] || 0;
      if (now - last < AUTO_AI_MIN_GAP_MS) continue;
      if (autoAiTimersRef.current[id]) continue;

      autoAiTimersRef.current[id] = window.setTimeout(async () => {
        delete autoAiTimersRef.current[id];
        autoAiLastRunAtRef.current[id] = Date.now();
        try {
          const updated = await aiRefreshRaidItem(id);
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        } catch {
          /* silent */
        }
      }, AUTO_AI_DEBOUNCE_MS);
    }
  }, [items, busyId]);

  // Global keyboard shortcuts
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!hotRowId || isTypingTarget(e.target)) return;
      const it = items.find((x) => x.id === hotRowId);
      if (!it) return;
      const key = e.key.toLowerCase();

      if (key === "s") {
        e.preventDefault();
        const next = cycleInList(STATUS_ORDER, safeStr(it.status) || "Open");
        openEditor({ type: normalizeType(it.type), rowId: it.id, col: "status" }, next);
        window.setTimeout(() => void commitCell(it.id, "status", next), 0);
        return;
      }

      if (key === "p") {
        e.preventDefault();
        const next = cycleInList(PRIORITY_ORDER, safeStr(it.priority || ""));
        openEditor({ type: normalizeType(it.type), rowId: it.id, col: "priority" }, next);
        window.setTimeout(() => void commitCell(it.id, "priority", next), 0);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotRowId, items, openEditor, commitCell]);

  useEffect(() => {
    if (!digest) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDigest(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [digest]);

  // Focus on deep-linked row
  useEffect(() => {
    const t = setTimeout(() => {
      const qs = new URLSearchParams(window.location.search);
      const focusId = safeStr(qs.get("focus")).trim();
      const focusPid = safeStr(qs.get("pid")).trim();
      const hashPid = safeStr((window.location.hash || "").replace(/^#/, "")).trim();

      const el =
        (focusId && document.querySelector(`[data-raid-id="${CSS.escape(focusId)}"]`)) ||
        (focusPid && document.querySelector(`[data-raid-public="${CSS.escape(focusPid)}"]`)) ||
        (hashPid && document.querySelector(`[data-raid-public="${CSS.escape(hashPid)}"]`)) ||
        null;

      if (el && el instanceof HTMLElement) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        const id = focusId || safeStr(el.getAttribute("data-raid-id")).trim();
        if (id) setHotRowId(id);
        try {
          el.focus();
        } catch {}
      }
    }, 120);

    return () => clearTimeout(t);
  }, []);

  /* ---------- Notion key navigation per-cell ---------- */

  const moveCell = useCallback(
    (type: RaidType, rowIds: string[], rowIndex: number, col: CellKey, dRow: number, dCol: number) => {
      const nextRow = Math.max(0, Math.min(rowIds.length - 1, rowIndex + dRow));
      const colIndex = EDIT_COLS.indexOf(col);
      const nextColIndex = Math.max(0, Math.min(EDIT_COLS.length - 1, colIndex + dCol));
      const nextId = rowIds[nextRow];
      const nextCol = EDIT_COLS[nextColIndex];
      if (nextId && nextCol) {
        setHotCell({ type, rowId: nextId, col: nextCol });
        openEditor({ type, rowId: nextId, col: nextCol });
      }
    },
    [openEditor]
  );

  const onCellKeyDown = useCallback(
    (
      e: React.KeyboardEvent,
      ctx: { type: RaidType; rowIds: string[]; rowIndex: number; col: CellKey; isMultiline?: boolean }
    ) => {
      const { type, rowIds, rowIndex, col, isMultiline } = ctx;

      if (e.key === "Escape") {
        e.preventDefault();
        closeEditor();
        return;
      }

      if (e.key === "Tab") {
        e.preventDefault();
        void commitEditor({ close: false });
        moveCell(type, rowIds, rowIndex, col, 0, e.shiftKey ? -1 : 1);
        return;
      }

      if (e.key === "Enter") {
        if (isMultiline && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          void commitEditor({ close: false });
          moveCell(type, rowIds, rowIndex, col, e.shiftKey ? -1 : 1, 0);
          return;
        }
        if (!isMultiline) {
          e.preventDefault();
          void commitEditor({ close: false });
          moveCell(type, rowIds, rowIndex, col, e.shiftKey ? -1 : 1, 0);
          return;
        }
      }

      if (!isMultiline) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          void commitEditor({ close: false });
          moveCell(type, rowIds, rowIndex, col, 1, 0);
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          void commitEditor({ close: false });
          moveCell(type, rowIds, rowIndex, col, -1, 0);
          return;
        }
        if (e.key === "ArrowRight") {
          e.preventDefault();
          void commitEditor({ close: false });
          moveCell(type, rowIds, rowIndex, col, 0, 1);
          return;
        }
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          void commitEditor({ close: false });
          moveCell(type, rowIds, rowIndex, col, 0, -1);
          return;
        }
      }
    },
    [moveCell, commitEditor, closeEditor]
  );

  /* ---------- Notion paste (multi-cell TSV) ---------- */

  const applyPaste = useCallback(
    async (ctx: { type: RaidType; rowIds: string[]; rowIndex: number; col: CellKey }, tsv: string) => {
      const grid = parseTsv(tsv);
      if (!grid.length) return;

      const startColIndex = EDIT_COLS.indexOf(ctx.col);
      if (startColIndex < 0) return;

      const patchById: Record<string, any> = {};
      const localById: Record<string, Partial<RaidItem>> = {};

      for (let r = 0; r < grid.length; r++) {
        const rowId = ctx.rowIds[ctx.rowIndex + r];
        if (!rowId) break;

        const rowPatch: any = {};
        const rowLocal: any = {};

        for (let c = 0; c < grid[r].length; c++) {
          const colKey = EDIT_COLS[startColIndex + c];
          if (!colKey) break;

          const raw = grid[r][c];
          const s = safeStr(raw).trim();

          if (colKey === "description") {
            rowLocal.description = s;
            rowPatch.description = s || "Untitled";
          } else if (colKey === "owner_label") {
            rowLocal.owner_label = s;
            rowPatch.owner_label = s;
          } else if (colKey === "status") {
            const ns = normStatus(s);
            rowLocal.status = ns;
            rowPatch.status = ns;
          } else if (colKey === "priority") {
            const np = normPriority(s);
            rowLocal.priority = np || null;
            rowPatch.priority = np || null;
          } else if (colKey === "probability") {
            const n = clampNum(s, 0, 100);
            rowLocal.probability = n;
            rowPatch.probability = n;
          } else if (colKey === "severity") {
            const n = clampNum(s, 0, 100);
            rowLocal.severity = n;
            rowPatch.severity = n;
          } else if (colKey === "due_date") {
            const iso = normDateToIsoOnly(s);
            rowLocal.due_date = iso;
            rowPatch.due_date = iso;
          } else if (colKey === "response_plan") {
            rowLocal.response_plan = s;
            rowPatch.response_plan = s || null;
          }
        }

        if (Object.keys(rowPatch).length) {
          patchById[rowId] = rowPatch;
          localById[rowId] = rowLocal;
        }
      }

      const ids = Object.keys(patchById);
      if (!ids.length) return;

      setItems((prev) => prev.map((it) => (localById[it.id] ? ({ ...it, ...localById[it.id] } as RaidItem) : it)));

      setBusyId("paste");
      try {
        for (const id of ids) {
          const current = items.find((x) => x.id === id);
          const expected = safeStr(current?.updated_at).trim();

          const patch = { ...patchById[id] };
          if ("status" in patch && safeStr(patch.status).toLowerCase() === "invalid") patch.status = "Closed";
          if ("owner_label" in patch) {
            const o = safeStr(patch.owner_label).trim();
            if (!o) delete patch.owner_label;
            else patch.owner_label = o;
          }
          if (!Object.keys(patch).length) continue;

          const updated = await patchRaidItem(id, { ...patch, expected_updated_at: expected || undefined }, expected || undefined);
          setItems((prev) => prev.map((x) => (x.id === id ? ({ ...x, ...updated } as RaidItem) : x)));
        }
        pushBanner("success", `Pasted into ${ids.length} row(s)`);
      } catch (e: any) {
        pushBanner("error", e?.message || "Paste save failed");
      } finally {
        setBusyId("");
      }
    },
    [items, pushBanner]
  );

  const onCellPaste = useCallback(
    async (
      e: React.ClipboardEvent,
      ctx: { type: RaidType; rowIds: string[]; rowIndex: number; col: CellKey }
    ) => {
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text || (!text.includes("\t") && !text.includes("\n"))) return;
      e.preventDefault();
      await applyPaste(ctx, text);
    },
    [applyPaste]
  );

  const closeMenu = useCallback(() => setMenuOpenFor(""), []);

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      pushBanner("success", `Copied ${text}`);
    } catch {
      pushBanner("error", "Copy failed");
    }
  }

  async function copyLinkToClipboard(path: string) {
    const origin = typeof window !== "undefined" && window.location?.origin ? window.location.origin : "";
    const full = origin ? `${origin}${path}` : path;
    return copyToClipboard(full);
  }

  function exportGroupExcel(type: RaidType) {
    window.open(`/api/raid/export/excel?projectId=${encodeURIComponent(projectId)}&type=${encodeURIComponent(type)}`, "_blank");
    closeMenu();
  }

  function exportGroupPdf(type: RaidType) {
    window.open(`/api/raid/export/pdf?projectId=${encodeURIComponent(projectId)}&type=${encodeURIComponent(type)}`, "_blank");
    closeMenu();
  }

  async function refreshAiForGroup(type: RaidType) {
    closeMenu();
    const groupItems = items.filter((x) => normalizeType(x.type) === type);
    if (!groupItems.length) {
      pushBanner("success", `No ${pluralLabel(type)} to refresh`);
      return;
    }
    setBusyId(`ai:group:${type}`);
    try {
      for (let i = 0; i < groupItems.length; i++) {
        const id = groupItems[i].id;
        try {
          const updated = await aiRefreshRaidItem(id);
          setItems((prev) => prev.map((x) => (x.id === id ? { ...x, ...updated } : x)));
        } catch {
          /* ignore */
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      pushBanner("success", `${type}: AI refreshed (${groupItems.length})`);
    } catch (e: any) {
      pushBanner("error", e?.message || "Group AI refresh failed");
    } finally {
      setBusyId("");
    }
  }

  async function copyGroupLink(type: RaidType) {
    await copyLinkToClipboard(`/projects/${routeProjectId}/raid#${encodeURIComponent(type.toLowerCase())}`);
    closeMenu();
  }

  const onDragEnd = useCallback(
    (result: DropResult) => {
      const { destination, source, draggableId } = result;
      if (!destination) return;
      if (destination.droppableId === source.droppableId && destination.index === source.index) return;

      const srcGroup = source.droppableId.replace(/^group:/, "") as RaidType;
      const dstGroup = destination.droppableId.replace(/^group:/, "") as RaidType;
      if (srcGroup !== dstGroup) return;

      setItems((prev) => {
        const group = prev.filter((x) => normalizeType(x.type) === srcGroup);
        const moving = group.find((x) => dndIdForRaid(x) === draggableId);
        if (!moving) return prev;

        const nextGroup = reorder(group, source.index, destination.index);
        const others = prev.filter((x) => normalizeType(x.type) !== srcGroup);
        return [...nextGroup, ...others];
      });

      pushBanner("success", `${srcGroup}: reordered`);
    },
    [pushBanner]
  );

  // Type-to-edit (Notion feel)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (isTypingTarget(e.target)) return;
      if (!hotCell) return;
      if (!isPrintableKey(e)) return;
      e.preventDefault();
      openEditor(hotCell, e.key);
    }
    window.addEventListener("keydown", onKey, { passive: false });
    return () => window.removeEventListener("keydown", onKey);
  }, [hotCell, openEditor]);

  // Keep overlay aligned on scroll/resize
  useEffect(() => {
    if (!editor) return;
    function sync() {
      const el = cellRefs.current[`${editor.rowId}:${editor.col}`];
      if (!el) return;
      const r = el.getBoundingClientRect();
      setEditor((cur) => {
        if (!cur) return cur;
        return {
          ...cur,
          rect: {
            left: Math.max(8, r.left),
            top: Math.max(8, r.top),
            width: Math.max(120, r.width),
            height: Math.max(34, r.height),
          },
        };
      });
    }
    window.addEventListener("scroll", sync, true);
    window.addEventListener("resize", sync);
    return () => {
      window.removeEventListener("scroll", sync, true);
      window.removeEventListener("resize", sync);
    };
  }, [editor]);

  /* ============================================================
     RENDER
     ============================================================ */

  return (
    <div className="min-h-screen bg-[#f7f7f5] text-gray-900 font-sans">
      {/* ── TOP NAV ── */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
        <div className="max-w-[1800px] mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 min-w-0">
              <Link href={`/projects/${routeProjectId}`} className="text-[13px] text-gray-500 hover:text-gray-800 transition-colors">
                {humanProjectTitle}
              </Link>
              <svg className="w-3.5 h-3.5 text-gray-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <span className="text-[13px] font-semibold text-gray-900">RAID Log</span>
              {humanClient && (
                <>
                  <span className="text-gray-300 text-[13px]">·</span>
                  <span className="text-[12px] text-gray-400 truncate">{humanClient}</span>
                </>
              )}
              <span className="ml-1 px-2 py-0.5 rounded bg-gray-100 text-[11px] font-mono text-gray-500">{humanProjectId}</span>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5">
              <button
                onClick={onWeeklyDigest}
                disabled={digestBusy}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md border border-gray-200 transition-colors disabled:opacity-50"
              >
                {digestBusy ? (
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-gray-300 border-t-gray-600 animate-spin" />
                ) : (
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                )}
                {digestBusy ? "Generating…" : "Weekly Digest"}
              </button>

              <button
                onClick={onRefreshAll}
                disabled={busyId === "refresh:all"}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md border border-gray-200 transition-colors disabled:opacity-50"
              >
                <svg className={cx("w-3.5 h-3.5", busyId === "refresh:all" && "animate-spin")} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                {busyId === "refresh:all" ? "Refreshing…" : "Refresh"}
              </button>

              {/* Export dropdown */}
              <div className="relative group">
                <button className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded-md border border-gray-200 transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Export
                  <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                <div className="absolute right-0 mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() => window.open(`/api/raid/export/excel?projectId=${encodeURIComponent(projectId)}`, "_blank")}
                    className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                  >
                    <svg className="w-4 h-4 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Excel (.xlsx)
                  </button>
                  <button
                    onClick={() => window.open(`/api/raid/export/pdf?projectId=${encodeURIComponent(projectId)}`, "_blank")}
                    className="flex items-center gap-2 w-full px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                  >
                    <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                    </svg>
                    PDF Report
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* ── STATS BAR ── */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-[1800px] mx-auto px-6 py-3 flex items-center gap-3">
          <StatChip value={stats.open} label="Open" color="bg-blue-400" />
          <StatChip value={stats.high} label="High Exposure" color="bg-red-500" />
          <StatChip value={stats.mitigated} label="Mitigated" color="bg-green-500" />
          <div className="ml-auto text-[12px] text-gray-400 font-medium">{stats.total} total items</div>
        </div>
      </div>

      {/* ── BANNERS ── */}
      {banners.length > 0 && (
        <div className="max-w-[1800px] mx-auto px-6 pt-3 space-y-2">
          {banners.map((b) => (
            <div
              key={b.id}
              className={cx(
                "flex items-center gap-3 px-4 py-2.5 rounded-lg text-[13px] border",
                b.kind === "success" ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"
              )}
            >
              <span
                className={cx(
                  "w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                  b.kind === "success" ? "bg-green-500 text-white" : "bg-red-500 text-white"
                )}
              >
                {b.kind === "success" ? "✓" : "!"}
              </span>
              <span className="flex-1">{b.text}</span>
              <button onClick={() => dismissBanner(b.id)} className="p-0.5 rounded hover:bg-black/10">
                <IconClose />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* ── MAIN CONTENT ── */}
      <main className="max-w-[1800px] mx-auto px-6 py-6 pb-24 space-y-4">
        {/* (rest of your file unchanged from here) */}
        {/* ✅ NOTE: only status/priority styling was changed above */}
        {/* Keep your remaining JSX/Editor/Digest exactly as you pasted. */}
      </main>

      {/* (rest unchanged) */}
    </div>
  );
}
      {/* ── MAIN CONTENT ── */}
      <main className="max-w-[1800px] mx-auto px-6 py-6 pb-24 space-y-4">
        <DragDropContext onDragEnd={onDragEnd}>
          {(Object.keys(grouped) as RaidType[]).map((type) => {
            const cfg = TYPE_CONFIG[type];
            const groupItems = grouped[type];
            const isOpen = openGroups[type];
            const rowIds = groupItems.map((x) => x.id);

            return (
              <section
                key={type}
                className="rounded-xl border border-gray-200 bg-white overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.04)]"
              >
                {/* Group header */}
                <div
                  className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white cursor-pointer select-none"
                  onClick={() => toggleGroup(type)}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-gray-400">
                      <IconChevron open={isOpen} />
                    </span>
                    <span className="text-[15px]">{cfg.emoji}</span>
                    <span className="font-semibold text-[14px] text-gray-800">{pluralLabel(type)}</span>
                    <span className="text-[12px] text-gray-400">{cfg.desc}</span>
                    <span className={cx("px-2 py-0.5 rounded-full text-[11px] font-semibold", cfg.lightBg, cfg.textColor)}>
                      {groupItems.length}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    {/* Group menu button */}
                    <div className="relative">
                      <button
                        ref={(el) => {
                          menuBtnRefs.current[type] = el;
                        }}
                        onClick={() => setMenuOpenFor(menuOpenFor === type ? "" : type)}
                        className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                        title="Group options"
                      >
                        <IconDots />
                      </button>

                      {menuOpenFor === type && (
                        <div ref={menuRef} className="absolute right-0 top-full mt-1 w-52 bg-white rounded-lg shadow-xl border border-gray-200 py-1 z-50">
                          <div className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-widest">{type} options</div>
                          <button
                            onClick={() => exportGroupExcel(type)}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                          >
                            <svg className="w-3.5 h-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                            </svg>
                            Export to Excel
                          </button>
                          <button
                            onClick={() => exportGroupPdf(type)}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                          >
                            <svg className="w-3.5 h-3.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                            </svg>
                            Export to PDF
                          </button>
                          <div className="my-1 border-t border-gray-100" />
                          <button
                            onClick={() => refreshAiForGroup(type)}
                            disabled={busyId === `ai:group:${type}`}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                          >
                            <span className={cx("w-3.5 h-3.5 text-indigo-500", busyId === `ai:group:${type}` && "animate-spin")}>
                              <IconRefresh />
                            </span>
                            {busyId === `ai:group:${type}` ? "Refreshing…" : "Refresh AI (Group)"}
                          </button>
                          <button
                            onClick={() => copyGroupLink(type)}
                            className="flex items-center gap-2.5 w-full px-3 py-2 text-[13px] text-gray-700 hover:bg-gray-50"
                          >
                            <svg className="w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                            </svg>
                            Copy Group Link
                          </button>
                        </div>
                      )}
                    </div>

                    {/* New item button */}
                    <button
                      onClick={() => onCreate(type)}
                      disabled={busyId === `new:${type}`}
                      className={cx(
                        "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[13px] font-medium border transition-colors",
                        cfg.lightBg,
                        cfg.textColor,
                        cfg.border,
                        "hover:brightness-95 disabled:opacity-50"
                      )}
                    >
                      <IconPlus />
                      New {type}
                    </button>
                  </div>
                </div>

                {/* Table */}
                {isOpen && (
                  <Droppable droppableId={`group:${type}`} direction="vertical">
                    {(dropProvided, dropSnapshot) => (
                      <div
                        ref={dropProvided.innerRef}
                        {...dropProvided.droppableProps}
                        className={cx("overflow-x-auto", dropSnapshot.isDraggingOver && "bg-blue-50/30")}
                      >
                        <table className="w-full text-[13px] table-fixed border-separate border-spacing-0">
                          <thead>
                            <tr>
                              <th className={cx(COL_HDR, "w-36 border-l")}>
                                <span className="text-gray-400">#</span> ID
                              </th>
                              <th className={cx(COL_HDR, "relative")} style={{ width: colW.desc }}>
                                Description
                                <span className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400/40 z-10" onMouseDown={(e) => startResize("desc", e)} />
                              </th>
                              <th className={cx(COL_HDR, "w-44")}>Owner</th>
                              <th className={cx(COL_HDR, "w-36")}>Status</th>
                              <th className={cx(COL_HDR, "w-36")}>Priority</th>
                              <th className={cx(COL_HDR, "w-24 text-center")}>Likelihood</th>
                              <th className={cx(COL_HDR, "w-24 text-center")}>Severity</th>
                              <th className={cx(COL_HDR, "w-28")}>Score</th>
                              <th className={cx(COL_HDR, "w-32 text-center")}>Due Date</th>
                              <th className={cx(COL_HDR, "relative")} style={{ width: colW.resp }}>
                                Response Plan
                                <span className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-blue-400/40 z-10" onMouseDown={(e) => startResize("resp", e)} />
                              </th>
                              <th className={cx(COL_HDR, "w-60")}>AI Rollup</th>
                              <th className={cx(COL_HDR, "w-28 text-center")}>Updated</th>
                              <th className={cx(COL_HDR, "w-24 text-center border-r-0")}>Actions</th>
                            </tr>
                          </thead>

                          <tbody>
                            {groupItems.length === 0 ? (
                              <tr>
                                <td colSpan={13} className="px-6 py-12 text-center text-[13px] text-gray-400 border-b border-l border-r border-gray-200">
                                  <div className="flex flex-col items-center gap-2">
                                    <span className="text-2xl opacity-40">{cfg.emoji}</span>
                                    <span>No {type.toLowerCase()}s yet</span>
                                    <button
                                      onClick={() => onCreate(type)}
                                      className={cx("mt-1 px-3 py-1.5 rounded-md text-[12px] font-medium border", cfg.lightBg, cfg.textColor, cfg.border)}
                                    >
                                      + Add first {type.toLowerCase()}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ) : (
                              groupItems.map((it, index) => {
                                const sc = calcScore(it.probability, it.severity);
                                const isBusy = busyId === it.id || busyId === "paste";
                                const owner = safeStr(it.owner_label).trim();
                                const ownerOk = owner.length > 0 && owner.toLowerCase() !== "tbc";
                                const plan = safeStr(it.response_plan || "").trim();
                                const planOk = plan.length > 0 && plan.toLowerCase() !== "tbc";
                                const touched = touchedById[it.id] || {};
                                const showOwnerWarn = Boolean(touched.owner) && !ownerOk;
                                const showPlanWarn = Boolean(touched.plan) && !planOk;
                                const ai = it?.related_refs?.ai || {};
                                const runs = aiRunsById[it.id] || [];
                                const cmp = aiCompareById[it.id] || { a: "", b: "" };
                                const runA = cmp.a ? getRun(runs, cmp.a) : null;
                                const runB = cmp.b ? getRun(runs, cmp.b) : null;
                                const diffSummary = runA && runB ? diffLines(runA.ai?.summary, runB.ai?.summary) : null;
                                const diffRollup = runA && runB ? diffLines(runA.ai?.rollup, runB.ai?.rollup) : null;
                                const diffRecs = runA && runB ? diffList(runA.ai?.recommendations, runB.ai?.recommendations) : null;
                                const stale = staleById[it.id];
                                const isHot = hotRowId === it.id;

                                return (
                                  <Draggable key={dndIdForRaid(it)} draggableId={dndIdForRaid(it)} index={index} isDragDisabled={Boolean(isBusy)}>
                                    {(dragProvided, dragSnapshot) => (
                                      <React.Fragment>
                                        <tr
                                          ref={dragProvided.innerRef}
                                          {...dragProvided.draggableProps}
                                          data-raid-id={it.id}
                                          data-raid-public={safeStr(it.public_id || "").trim()}
                                          className={cx(
                                            "group/row",
                                            isBusy && "opacity-60",
                                            stale && "bg-amber-50/40",
                                            dragSnapshot.isDragging && "shadow-xl bg-white",
                                            isHot && !dragSnapshot.isDragging && "bg-blue-50/30"
                                          )}
                                          tabIndex={0}
                                          onFocus={() => setHotRowId(it.id)}
                                          onMouseDown={() => setHotRowId(it.id)}
                                          onMouseEnter={() => setHoveredRowId(it.id)}
                                          onMouseLeave={() => setHoveredRowId("")}
                                        >
                                          {/* ID cell */}
                                          <td className={cx(CELL_BASE, "w-36 border-l")}>
                                            <div className="flex items-center gap-1.5 px-2 py-2 min-h-[34px]">
                                              {/* Drag handle - visible on hover */}
                                              <button
                                                type="button"
                                                data-dnd-handle
                                                {...dragProvided.dragHandleProps}
                                                className={cx(
                                                  "shrink-0 p-0.5 rounded cursor-grab active:cursor-grabbing",
                                                  "text-gray-300 hover:text-gray-500 hover:bg-gray-100 transition-all",
                                                  "opacity-0 group-hover/row:opacity-100"
                                                )}
                                                onMouseDown={(e) => e.stopPropagation()}
                                              >
                                                <IconDragHandle />
                                              </button>

                                              <span className="font-mono text-[11px] text-gray-500 truncate">
                                                {safeStr(it.public_id) || <span className="text-gray-300">—</span>}
                                              </span>

                                              {stale && (
                                                <button
                                                  onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    void onReloadRow(it.id);
                                                  }}
                                                  title="Reload latest"
                                                  className="text-amber-500 hover:text-amber-700 shrink-0"
                                                >
                                                  <IconRefresh />
                                                </button>
                                              )}
                                            </div>
                                            {stale && <div className="px-2 pb-1.5 text-[11px] text-amber-600">{stale.message}</div>}
                                          </td>

                                          {/* Description */}
                                          <td className={CELL_BASE} style={{ width: colW.desc }}>
                                            <div ref={(el) => setCellRef(it.id, "description", el)} className="w-full">
                                              <CellDisplay
                                                value={safeStr(it.description)}
                                                placeholder="Add description…"
                                                onActivate={() => openEditor({ type, rowId: it.id, col: "description" })}
                                                title={safeStr(it.description)}
                                              />
                                            </div>
                                          </td>

                                          {/* Owner */}
                                          <td className={CELL_BASE}>
                                            <div ref={(el) => setCellRef(it.id, "owner_label", el)} className="w-full">
                                              <CellDisplay
                                                value={safeStr(it.owner_label)}
                                                placeholder="Assign owner…"
                                                onActivate={() => {
                                                  touch(it.id, "owner");
                                                  openEditor({ type, rowId: it.id, col: "owner_label" });
                                                }}
                                              />
                                              {showOwnerWarn && <div className="px-3 pb-1 text-[11px] text-red-500 font-medium">Owner required</div>}
                                            </div>
                                          </td>

                                          {/* Status */}
                                          <td className={CELL_BASE}>
                                            <div ref={(el) => setCellRef(it.id, "status", el)} className="px-2 py-1.5 w-full">
                                              <StatusTag
                                                label={safeStr(it.status || "Open")}
                                                disabled={isBusy}
                                                onActivate={() => openEditor({ type, rowId: it.id, col: "status" })}
                                              />
                                            </div>
                                          </td>

                                          {/* Priority */}
                                          <td className={CELL_BASE}>
                                            <div ref={(el) => setCellRef(it.id, "priority", el)} className="px-2 py-1.5 w-full">
                                              <PriorityTag
                                                label={safeStr(it.priority || "")}
                                                disabled={isBusy}
                                                onActivate={() => openEditor({ type, rowId: it.id, col: "priority" })}
                                              />
                                            </div>
                                          </td>

                                          {/* Likelihood */}
                                          <td className={CELL_BASE}>
                                            <div ref={(el) => setCellRef(it.id, "probability", el)} className="w-full">
                                              <CellDisplay
                                                value={String(Number.isFinite(Number(it.probability)) ? Number(it.probability) : 0)}
                                                placeholder="0"
                                                align="center"
                                                mono
                                                onActivate={() => openEditor({ type, rowId: it.id, col: "probability" })}
                                              />
                                            </div>
                                          </td>

                                          {/* Severity */}
                                          <td className={CELL_BASE}>
                                            <div ref={(el) => setCellRef(it.id, "severity", el)} className="w-full">
                                              <CellDisplay
                                                value={String(Number.isFinite(Number(it.severity)) ? Number(it.severity) : 0)}
                                                placeholder="0"
                                                align="center"
                                                mono
                                                onActivate={() => openEditor({ type, rowId: it.id, col: "severity" })}
                                              />
                                            </div>
                                          </td>

                                          {/* Score */}
                                          <td className={CELL_BASE}>
                                            <div className="px-3 py-1.5">
                                              <ScoreBadge score={sc} />
                                            </div>
                                          </td>

                                          {/* Due Date (UK display) */}
                                          <td className={CELL_BASE}>
                                            <div ref={(el) => setCellRef(it.id, "due_date", el)} className="w-full">
                                              <CellDisplay
                                                value={fmtDateUK(it.due_date)}
                                                placeholder="Set date…"
                                                align="center"
                                                mono
                                                onActivate={() => openEditor({ type, rowId: it.id, col: "due_date" })}
                                              />
                                            </div>
                                          </td>

                                          {/* Response Plan */}
                                          <td className={CELL_BASE} style={{ width: colW.resp }}>
                                            <div ref={(el) => setCellRef(it.id, "response_plan", el)} className="w-full">
                                              <CellDisplay
                                                value={safeStr(it.response_plan || "")}
                                                placeholder="Add response plan…"
                                                onActivate={() => {
                                                  touch(it.id, "plan");
                                                  openEditor({ type, rowId: it.id, col: "response_plan" });
                                                }}
                                              />
                                              {showPlanWarn && <div className="px-3 pb-1 text-[11px] text-red-500 font-medium">Plan required</div>}
                                            </div>
                                          </td>

                                          {/* AI Rollup */}
                                          <td className={CELL_BASE}>
                                            <div className="px-3 py-2">
                                              {it.ai_rollup ? (
                                                <p className="text-[12px] text-gray-500 line-clamp-2 leading-relaxed" title={it.ai_rollup}>
                                                  {it.ai_rollup}
                                                </p>
                                              ) : (
                                                <span className="text-[12px] text-gray-300 italic">No AI summary</span>
                                              )}
                                            </div>
                                          </td>

                                          {/* Updated */}
                                          <td className={CELL_BASE}>
                                            <div className="px-3 py-2 text-center">
                                              <span className="text-[11px] text-gray-400 tabular-nums">{fmtWhen(it.updated_at)}</span>
                                            </div>
                                          </td>

                                          {/* Actions — ALWAYS VISIBLE */}
                                          <td className={cx(CELL_BASE, "border-r-0")}>
                                            <div className="flex items-center justify-center gap-1 px-1 py-1">
                                              <button
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  setAiOpenId(aiOpenId === it.id ? "" : it.id);
                                                }}
                                                className={cx(
                                                  "p-1.5 rounded-md transition-colors border",
                                                  aiOpenId === it.id
                                                    ? "bg-indigo-100 text-indigo-600 border-indigo-200"
                                                    : "bg-white text-gray-500 border-gray-200 hover:text-gray-700 hover:bg-gray-50"
                                                )}
                                                title="AI Insights"
                                              >
                                                <IconAI />
                                              </button>

                                              <button
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  void onAiRefresh(it.id);
                                                }}
                                                disabled={isBusy}
                                                className={cx(
                                                  "p-1.5 rounded-md border transition-colors",
                                                  "bg-white text-gray-500 border-gray-200 hover:text-gray-700 hover:bg-gray-50",
                                                  isBusy && "opacity-40 cursor-not-allowed"
                                                )}
                                                title="Refresh AI"
                                              >
                                                <span className={isBusy ? "animate-spin" : ""}>
                                                  <IconRefresh />
                                                </span>
                                              </button>

                                              <button
                                                onClick={(e) => {
                                                  e.preventDefault();
                                                  e.stopPropagation();
                                                  void onDelete(it.id);
                                                }}
                                                disabled={isBusy}
                                                className={cx(
                                                  "p-1.5 rounded-md border transition-colors",
                                                  "bg-white text-gray-500 border-gray-200 hover:text-red-600 hover:bg-red-50 hover:border-red-200",
                                                  isBusy && "opacity-40 cursor-not-allowed"
                                                )}
                                                title="Delete"
                                              >
                                                <IconTrash />
                                              </button>
                                            </div>
                                          </td>
                                        </tr>

                                        {/* ── AI Panel ── */}
                                        {aiOpenId === it.id && (
                                          <tr>
                                            <td colSpan={13} className="border-b border-gray-200 border-l border-r bg-[#f9f9f8]">
                                              <div className="p-5">
                                                <div className="flex items-start justify-between mb-4">
                                                  <div className="flex items-center gap-3">
                                                    <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                                                      <IconAI />
                                                    </div>
                                                    <div>
                                                      <h3 className="font-semibold text-[14px] text-gray-900">AI Insights</h3>
                                                      <p className="text-[12px] text-gray-400">
                                                        {safeStr(ai.ai_status) || "—"} • Quality:{" "}
                                                        {Number.isFinite(ai.ai_quality) ? `${Math.round(ai.ai_quality)}/100` : "—"} •{" "}
                                                        {safeStr(ai.last_run_at) ? fmtWhen(ai.last_run_at) : "Never run"}
                                                      </p>
                                                    </div>
                                                  </div>
                                                  <div className="flex items-center gap-2">
                                                    <button
                                                      onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        void openHistory(it.id);
                                                      }}
                                                      disabled={aiHistBusyId === it.id}
                                                      className="px-3 py-1.5 rounded-md text-[12px] font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 disabled:opacity-50 transition-colors"
                                                    >
                                                      {aiHistBusyId === it.id ? "Loading…" : aiHistOpenId === it.id ? "Hide History" : "View History"}
                                                    </button>
                                                    <button
                                                      onClick={(e) => {
                                                        e.preventDefault();
                                                        e.stopPropagation();
                                                        setAiOpenId("");
                                                      }}
                                                      className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                                    >
                                                      <IconClose />
                                                    </button>
                                                  </div>
                                                </div>

                                                <div className="grid md:grid-cols-2 gap-3">
                                                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                                                    <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-2">Summary</h4>
                                                    <p className="text-[13px] text-gray-700 leading-relaxed">
                                                      {safeStr(ai.summary || it.ai_rollup || "No AI summary yet.")}
                                                    </p>
                                                  </div>

                                                  <div className="bg-white rounded-lg border border-gray-200 p-4">
                                                    <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Recommendations</h4>
                                                    {(ai?.recommendations || []).length > 0 ? (
                                                      <div className="space-y-2">
                                                        {ai.recommendations.map((r: string, idx: number) => (
                                                          <div key={idx} className="flex items-start gap-2.5">
                                                            <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-[11px] font-bold mt-0.5">
                                                              {idx + 1}
                                                            </span>
                                                            <p className="text-[13px] text-gray-700 leading-relaxed">{r}</p>
                                                          </div>
                                                        ))}
                                                      </div>
                                                    ) : (
                                                      <p className="text-[13px] text-gray-400 italic">No recommendations yet.</p>
                                                    )}
                                                  </div>
                                                </div>

                                                {aiHistOpenId === it.id && (
                                                  <div className="mt-3 bg-white rounded-lg border border-gray-200 p-4">
                                                    <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Version History & Diff</h4>

                                                    {runs.length === 0 ? (
                                                      <p className="text-[13px] text-gray-400">No history available.</p>
                                                    ) : (
                                                      <div className="space-y-4">
                                                        <div className="flex items-end gap-4">
                                                          <div className="flex-1">
                                                            <label className="block text-[11px] text-gray-400 mb-1">Version A</label>
                                                            <select
                                                              className="w-full text-[13px] border border-gray-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                                              value={cmp.a}
                                                              onChange={(e) =>
                                                                setAiCompareById((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] || {}), a: e.target.value } }))
                                                              }
                                                            >
                                                              {runs.map((r) => (
                                                                <option key={r.id} value={r.id}>
                                                                  {fmtWhen(r.created_at)} · {safeStr(r.version) || "v?"} · Q{Math.round(r.ai_quality || 0)}
                                                                </option>
                                                              ))}
                                                            </select>
                                                          </div>
                                                          <div className="text-[12px] text-gray-400 pb-2.5">vs</div>
                                                          <div className="flex-1">
                                                            <label className="block text-[11px] text-gray-400 mb-1">Version B</label>
                                                            <select
                                                              className="w-full text-[13px] border border-gray-200 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none"
                                                              value={cmp.b}
                                                              onChange={(e) =>
                                                                setAiCompareById((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] || {}), b: e.target.value } }))
                                                              }
                                                            >
                                                              {runs.map((r) => (
                                                                <option key={r.id} value={r.id}>
                                                                  {fmtWhen(r.created_at)} · {safeStr(r.version) || "v?"} · Q{Math.round(r.ai_quality || 0)}
                                                                </option>
                                                              ))}
                                                            </select>
                                                          </div>
                                                        </div>

                                                        {runA && runB && (
                                                          <div className="space-y-3 border-t border-gray-100 pt-4">
                                                            {diffRollup && (
                                                              <div className="grid grid-cols-2 gap-3">
                                                                <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                                                                  <div className="text-[11px] font-semibold text-red-500 mb-1.5">Previous</div>
                                                                  <div className="text-[13px] text-gray-700">{diffRollup.a}</div>
                                                                </div>
                                                                <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                                                                  <div className="text-[11px] font-semibold text-green-600 mb-1.5">Current</div>
                                                                  <div className="text-[13px] text-gray-700">{diffRollup.b}</div>
                                                                </div>
                                                              </div>
                                                            )}
                                                            {diffSummary && (
                                                              <div className="grid grid-cols-2 gap-3">
                                                                <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                                                                  <div className="text-[11px] font-semibold text-red-500 mb-1.5">Previous Summary</div>
                                                                  <div className="text-[13px] text-gray-700">{diffSummary.a}</div>
                                                                </div>
                                                                <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                                                                  <div className="text-[11px] font-semibold text-green-600 mb-1.5">Current Summary</div>
                                                                  <div className="text-[13px] text-gray-700">{diffSummary.b}</div>
                                                                </div>
                                                              </div>
                                                            )}
                                                            {diffRecs && (
                                                              <div className="grid grid-cols-2 gap-3">
                                                                <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                                                                  <div className="text-[11px] font-semibold text-red-500 mb-2">Previous Recommendations</div>
                                                                  <ul className="space-y-1 text-[13px] text-gray-700">
                                                                    {diffRecs.a.map((x, i) => (
                                                                      <li key={i} className="flex gap-1.5">
                                                                        <span className="text-red-300">·</span>
                                                                        {x}
                                                                      </li>
                                                                    ))}
                                                                  </ul>
                                                                </div>
                                                                <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                                                                  <div className="text-[11px] font-semibold text-green-600 mb-2">Current Recommendations</div>
                                                                  <ul className="space-y-1 text-[13px] text-gray-700">
                                                                    {diffRecs.b.map((x, i) => (
                                                                      <li key={i} className="flex gap-1.5">
                                                                        <span className="text-green-400">·</span>
                                                                        {x}
                                                                      </li>
                                                                    ))}
                                                                  </ul>
                                                                </div>
                                                              </div>
                                                            )}
                                                            {!diffRollup && !diffSummary && !diffRecs && (
                                                              <p className="text-[13px] text-gray-400 text-center py-4">No differences between selected versions.</p>
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
                                                )}
                                              </div>
                                            </td>
                                          </tr>
                                        )}
                                      </React.Fragment>
                                    )}
                                  </Draggable>
                                );
                              })
                            )}
                            {dropProvided.placeholder}
                          </tbody>
                        </table>

                        {/* Add row footer */}
                        {groupItems.length > 0 && (
                          <button
                            onClick={() => onCreate(type)}
                            disabled={busyId === `new:${type}`}
                            className="w-full px-4 py-2.5 flex items-center gap-2 text-[13px] text-gray-400 hover:text-gray-600 hover:bg-gray-50/80 border-t border-gray-200 transition-colors"
                          >
                            <IconPlus />
                            Add {type.toLowerCase()}
                          </button>
                        )}
                      </div>
                    )}
                  </Droppable>
                )}
              </section>
            );
          })}
        </DragDropContext>
      </main>

      {/* ── EDITOR OVERLAY ── */}
      {editor && (
        <div
          className="fixed inset-0 z-[80]"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) void commitEditor();
          }}
        >
          <div
            className="fixed z-[90]"
            style={{
              left: editor.rect.left,
              top: editor.rect.top,
              width: editor.rect.width,
              minHeight: editor.rect.height,
            }}
          >
            <div className="bg-white rounded-lg shadow-[0_8px_30px_rgba(0,0,0,0.12)] border border-gray-200 overflow-hidden">
              {editor.col === "status" ? (
                <select
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  className="w-full h-10 px-3 border-0 outline-none text-[13px] font-medium bg-white"
                  value={safeStr(editor.value || "Open")}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditor((cur) => (cur ? { ...cur, value: v } : cur));
                    // ✅ commit with override (fixes “changing field nothing saves”)
                    window.setTimeout(() => void commitCell(editor.rowId, "status", v), 0);
                  }}
                >
                  <option value="Open">Open</option>
                  <option value="In Progress">In Progress</option>
                  <option value="Mitigated">Mitigated</option>
                  <option value="Closed">Closed</option>
                </select>
              ) : editor.col === "priority" ? (
                <select
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  className="w-full h-10 px-3 border-0 outline-none text-[13px] font-medium bg-white"
                  value={safeStr(editor.value || "")}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEditor((cur) => (cur ? { ...cur, value: v } : cur));
                    window.setTimeout(() => void commitCell(editor.rowId, "priority", v), 0);
                  }}
                >
                  <option value="">— No priority</option>
                  <option value="Low">Low</option>
                  <option value="Medium">Medium</option>
                  <option value="High">High</option>
                  <option value="Critical">Critical</option>
                </select>
              ) : editor.col === "due_date" ? (
                <input
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  type="date"
                  className="w-full h-10 px-3 border-0 outline-none text-[13px] bg-white"
                  value={safeStr(editor.value || "")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                  onKeyDown={(e) => onCellKeyDown(e as any, { type: editor.type, rowIds: [], rowIndex: 0, col: "due_date" })}
                />
              ) : editor.col === "probability" || editor.col === "severity" ? (
                <input
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  type="number"
                  min={0}
                  max={100}
                  className="w-full h-10 px-3 border-0 outline-none text-[13px] text-center font-mono bg-white"
                  value={safeStr(editor.value || "0")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                />
              ) : editor.col === "description" || editor.col === "response_plan" ? (
                <textarea
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  className="w-full min-h-[96px] px-3 py-2.5 border-0 outline-none text-[13px] leading-5 resize-none bg-white"
                  value={safeStr(editor.value || "")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                  onPaste={(e) =>
                    onCellPaste(e, { type: editor.type, rowIds: [editor.rowId], rowIndex: 0, col: editor.col as any })
                  }
                />
              ) : (
                <input
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  className="w-full h-10 px-3 border-0 outline-none text-[13px] bg-white"
                  value={safeStr(editor.value || "")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                />
              )}
              <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50 flex items-center justify-between">
                <span className="text-[11px] text-gray-400">Enter · Tab · ↑↓ to navigate · Paste TSV</span>
                <button
                  className="text-[11px] text-gray-400 hover:text-gray-600 px-1.5 py-0.5 rounded hover:bg-gray-200 transition-colors"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    closeEditor();
                  }}
                >
                  Esc
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── DIGEST MODAL ── */}
      {digest && (
        <div
          className="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDigest(null);
          }}
        >
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl my-8 overflow-hidden border border-gray-200">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-[16px] font-semibold text-gray-900">{safeStr(digest?.header?.title) || "Weekly RAID Digest"}</h2>
                <p className="text-[12px] text-gray-400 mt-0.5">
                  {safeStr(digest?.header?.project_code) || humanProjectId} · {safeStr(digest?.header?.project_name) || humanProjectTitle} ·{" "}
                  {fmtWhen(digest?.generated_at)}
                </p>
              </div>
              <button onClick={() => setDigest(null)} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                <IconClose />
              </button>
            </div>

            <div className="p-6 bg-[#f9f9f8]">
              <div className="grid md:grid-cols-2 gap-4">
                {(Array.isArray(digest?.sections) ? digest.sections : []).map((sec: any) => (
                  <div key={safeStr(sec?.key) || safeStr(sec?.title)} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                      <h3 className="font-semibold text-[14px] text-gray-800">{safeStr(sec?.title) || "Section"}</h3>
                      <span className="px-2 py-0.5 rounded-full bg-gray-100 text-[11px] font-semibold text-gray-600">
                        {sec?.count || sec?.items?.length || 0}
                      </span>
                    </div>
                    <ul className="divide-y divide-gray-50">
                      {Array.isArray(sec?.items) && sec.items.length > 0 ? (
                        sec.items.map((x: any, i: number) => {
                          const link = digestDeepLink(routeProjectId, x);
                          const idTxt = digestId(x);
                          return (
                            <li key={safeStr(x?.id) || i} className="px-4 py-3 hover:bg-gray-50 transition-colors flex items-center gap-3">
                              <span className="w-1.5 h-1.5 rounded-full bg-gray-300 shrink-0" />
                              <Link
                                href={link}
                                className="font-mono text-[11px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded hover:bg-gray-200 transition-colors shrink-0"
                              >
                                {digestIdShort(x)}
                              </Link>
                              <Link href={link} className="flex-1 text-[13px] text-gray-800 hover:text-indigo-600 truncate min-w-0">
                                {safeStr(x?.title) || safeStr(x?.description) || "Untitled"}
                              </Link>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  onClick={() => copyToClipboard(idTxt)}
                                  className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                  title="Copy ID"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                    />
                                  </svg>
                                </button>
                                <button
                                  onClick={() => copyLinkToClipboard(link)}
                                  className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
                                  title="Copy Link"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      strokeWidth={2}
                                      d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                                    />
                                  </svg>
                                </button>
                              </div>
                            </li>
                          );
                        })
                      ) : (
                        <li className="px-4 py-8 text-[13px] text-gray-400 text-center">No items</li>
                      )}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}