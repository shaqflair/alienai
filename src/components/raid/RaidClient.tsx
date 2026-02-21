"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { DragDropContext, Droppable, Draggable, type DropResult } from "@hello-pangea/dnd";

type RaidType = "Risk" | "Assumption" | "Issue" | "Dependency";
// ✅ Invalid removed from dropdown + keyboard cycling
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

function fmtDateOnly(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "";
  return s;
}

// Note: we still handle "invalid" rows coming from DB, but we DON'T offer it in the UI.
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

const TYPE_STYLES: Record<RaidType, { border: string; text: string; desc: string; headerBg: string; dot: string }> = {
  Risk: {
    border: "border-rose-200",
    text: "text-rose-900",
    dot: "bg-rose-500",
    desc: "Events that may happen — mitigate early",
    headerBg: "bg-rose-50",
  },
  Assumption: {
    border: "border-amber-200",
    text: "text-amber-900",
    dot: "bg-amber-500",
    desc: "Beliefs we hold — validate them",
    headerBg: "bg-amber-50",
  },
  Issue: {
    border: "border-orange-200",
    text: "text-orange-900",
    dot: "bg-orange-500",
    desc: "Active problems — resolve quickly",
    headerBg: "bg-orange-50",
  },
  Dependency: {
    border: "border-blue-200",
    text: "text-blue-900",
    dot: "bg-blue-500",
    desc: "External blockers — track closely",
    headerBg: "bg-blue-50",
  },
};

const STATUS_PILL: Record<string, { bg: string; text: string; ring: string }> = {
  open: {
    bg: "bg-gradient-to-b from-slate-400 to-slate-500",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-slate-400/50",
  },
  inprogress: {
    bg: "bg-gradient-to-b from-sky-400 to-sky-600",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-sky-400/50",
  },
  mitigated: {
    bg: "bg-gradient-to-b from-emerald-400 to-emerald-600",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-emerald-400/50",
  },
  closed: {
    bg: "bg-gradient-to-b from-cyan-500 to-cyan-700",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-cyan-500/50",
  },
  invalid: {
    bg: "bg-gradient-to-b from-slate-300 to-slate-500",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-slate-400/50",
  },
};

const PRIORITY_PILL: Record<string, { bg: string; text: string; ring: string; label: string }> = {
  "": {
    bg: "bg-slate-100",
    text: "text-slate-700",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-slate-300/70",
    label: "—",
  },
  low: {
    bg: "bg-gradient-to-b from-slate-400 to-slate-600",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-slate-400/50",
    label: "Low",
  },
  medium: {
    bg: "bg-gradient-to-b from-sky-400 to-sky-600",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-sky-400/50",
    label: "Medium",
  },
  high: {
    bg: "bg-gradient-to-b from-amber-300 to-amber-500",
    text: "text-slate-900",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-amber-300/60",
    label: "High",
  },
  critical: {
    bg: "bg-gradient-to-b from-rose-400 to-rose-600",
    text: "text-white",
    ring: "focus:ring-2 focus:ring-offset-1 focus:ring-rose-400/50",
    label: "Critical",
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

// ✅ IMPORTANT: supports DELETE 204 and empty body responses
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

async function patchRaidItem(id: string, patch: any) {
  const j = await postJson(`/api/raid/${encodeURIComponent(id)}`, "PATCH", patch);
  return j.item as RaidItem;
}

async function createRaidItem(payload: any) {
  const j = await postJson(`/api/raid`, "POST", payload);
  return j.item as RaidItem;
}

/**
 * ✅ Delete reliability:
 * - Primary: DELETE /api/raid/:id
 * - If your route only supports POST (common with some Next handlers), fallback:
 *   POST /api/raid/:id/delete  OR POST /api/raid/delete (id in body)
 * (We try both if 405.)
 */
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
    // Fallback 1
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
      // Fallback 2
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

// ✅ Fix 405: try GET first; if endpoint is POST-only, retry with POST.
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
const DEFAULT_COL_WIDTHS: Record<ColKey, number> = { desc: 420, resp: 360 };

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

/* ---------------- Spreadsheet-like primitives ----------------
   Goal: remove "card / white canvas" feel and make a true grid:
   - outer border + full cell borders
   - border-separate + border-spacing-0 for crisp lines
--------------------------------------------------------------- */

// ✅ Every cell gets bottom + right border for grid feel
const CELL_WRAP =
  "px-3 py-2 min-h-[38px] align-top bg-white " +
  "border-b border-slate-200 border-r border-slate-200 " +
  "group-hover:bg-slate-50/40 transition-colors";

// ✅ For <th> we match the same grid border rules
const TH_WRAP =
  "px-3 py-2 text-left text-[11px] font-semibold text-slate-600 uppercase tracking-wider " +
  "bg-slate-50 border-b border-slate-200 border-r border-slate-200";

function pluralLabel(type: RaidType) {
  if (type === "Dependency") return "Dependencies";
  return `${type}s`;
}

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
        "w-full min-h-[28px] px-2 py-1 rounded",
        "outline-none",
        "hover:bg-white/80",
        "focus:bg-white focus:shadow-[0_0_0_2px_rgba(99,102,241,0.18)]",
        align === "center" && "text-center",
        align === "right" && "text-right",
        mono && "font-mono text-[12px]",
        !mono && "text-[13px]",
        "truncate"
      )}
      title={title ?? (v || "")}
    >
      {v ? (
        <span className="text-slate-900">{v}</span>
      ) : (
        <span className={cx(dimIfEmpty ? "text-slate-400" : "text-slate-500")}>{placeholder || "—"}</span>
      )}
    </div>
  );
}

function PillTag({
  kind,
  label,
  onActivate,
  disabled,
}: {
  kind: "status" | "priority";
  label: string;
  onActivate: () => void;
  disabled?: boolean;
}) {
  const stKey = kind === "status" ? statusToken(label) : "";
  const priKey = kind === "priority" ? priorityToken(label) : "";
  const st = STATUS_PILL[stKey] || STATUS_PILL.open;
  const pr = PRIORITY_PILL[priKey] || PRIORITY_PILL[""];
  const klass =
    kind === "status"
      ? cx("w-full h-8 px-3 rounded-full border-0", "text-[12px] font-semibold text-center", st.bg, st.text, st.ring)
      : cx("w-full h-8 px-3 rounded-full border-0", "text-[12px] font-semibold text-center", pr.bg, pr.text, pr.ring);

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
        klass,
        "shadow-[0_6px_14px_rgba(2,6,23,0.08)] hover:brightness-105 transition",
        disabled && "opacity-60 cursor-not-allowed"
      )}
      title="Click to edit"
    >
      {kind === "priority" ? (PRIORITY_PILL[priKey]?.label ?? "—") : safeStr(label || "Open")}
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

export default function RaidClient({
  projectId,
  projectRouteId,
  projectTitle,
  projectClient,
  projectPublicId,
  initialItems,
}: {
  projectId: string; // UUID (API)
  projectRouteId?: string; // human id (URLs) — optional + safe fallback
  projectTitle?: string;
  projectClient?: string;
  projectPublicId?: string;
  initialItems: RaidItem[];
}) {
  const routeProjectId = useMemo(() => safeStr(projectRouteId).trim() || projectId, [projectRouteId, projectId]);

  const [items, setItems] = useState<RaidItem[]>(initialItems ?? []);
  const [busyId, setBusyId] = useState<string>("");

  // ✅ banners that you can dismiss
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

  // ✅ Notion cell tracking
  const [hotCell, setHotCell] = useState<ActiveCell>(null);

  // ✅ Each read-mode cell is a DIV; we keep refs for overlay positioning
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
      setEditor({
        ...ctx,
        rect,
        value: initialValue != null ? initialValue : fallback,
      });

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

  const commitEditor = useCallback(
    async (opts?: { close?: boolean }) => {
      if (!editor) return;
      const { rowId, col } = editor;
      const current = items.find((x) => x.id === rowId);
      const expected = safeStr(current?.updated_at).trim();

      const raw = editor.value ?? "";
      const patch: any = {};
      if (col === "description") patch.description = safeStr(raw).trim() || "Untitled";
      if (col === "owner_label") patch.owner_label = safeStr(raw).trim();
      if (col === "status") patch.status = normStatus(raw);
      if (col === "priority") patch.priority = normPriority(raw) || null;
      if (col === "probability") patch.probability = clampNum(raw, 0, 100);
      if (col === "severity") patch.severity = clampNum(raw, 0, 100);
      if (col === "due_date") patch.due_date = safeStr(raw).trim() || null;
      if (col === "response_plan") patch.response_plan = safeStr(raw).trim() || null;

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
        if ("status" in patch && safeStr(patch.status).trim().toLowerCase() === "invalid") patch.status = "Closed";

        const updated = await patchRaidItem(rowId, { ...patch, expected_updated_at: expected || undefined });
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
    [editor, items, pushBanner, closeEditor]
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
      const next = Math.max(280, Math.min(900, resizeRef.current.startW + dx));
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
        if (status === 409 || payload?.stale) {
          setItems(prev);
          setStaleById((p) => ({
            ...p,
            [id]: { at: new Date().toISOString(), message: "Delete blocked: item was updated by someone else" },
          }));
          pushBanner("error", "Delete blocked: item updated by someone else");
          return;
        }
        setItems(prev);
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

  // Global keyboard shortcuts (keep)
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
        window.setTimeout(() => void commitEditor(), 0);
        return;
      }

      if (key === "p") {
        e.preventDefault();
        const next = cycleInList(PRIORITY_ORDER, safeStr(it.priority || ""));
        openEditor({ type: normalizeType(it.type), rowId: it.id, col: "priority" }, next);
        window.setTimeout(() => void commitEditor(), 0);
        return;
      }
    }

    window.addEventListener("keydown", onKeyDown, { passive: false });
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hotRowId, items, openEditor, commitEditor]);

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

      setItems((prev) =>
        prev.map((it) => (localById[it.id] ? ({ ...it, ...localById[it.id] } as RaidItem) : it))
      );

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

          const updated = await patchRaidItem(id, { ...patch, expected_updated_at: expected || undefined });
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
    window.open(
      `/api/raid/export/excel?projectId=${encodeURIComponent(projectId)}&type=${encodeURIComponent(type)}`,
      "_blank"
    );
    closeMenu();
  }

  function exportGroupPdf(type: RaidType) {
    window.open(
      `/api/raid/export/pdf?projectId=${encodeURIComponent(projectId)}&type=${encodeURIComponent(type)}`,
      "_blank"
    );
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

  // ✅ DnD: reorder only within a group
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

  // ✅ Type-to-edit (Notion feel)
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

  // ✅ Keep overlay aligned on scroll/resize
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

  return (
    <div className="min-h-screen bg-white text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="min-w-0">
              <h1 className="text-[16px] font-semibold tracking-tight text-slate-900">RAID Log</h1>
              <div className="flex items-center gap-2 text-[12px] text-slate-500 mt-1 min-w-0">
                <span className="font-medium text-slate-700 truncate">{humanProjectTitle}</span>
                {humanClient && <span className="text-slate-300">•</span>}
                {humanClient && <span className="truncate">{humanClient}</span>}
                <span className="text-slate-300">•</span>
                <span className="font-mono text-[11px] bg-slate-50 px-2 py-0.5 border border-slate-200">
                  {humanProjectId}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href={`/projects/${routeProjectId}`}
                className="text-[13px] text-slate-600 hover:text-slate-900 font-medium px-3 py-2 hover:bg-slate-50 transition-colors border border-transparent hover:border-slate-200"
              >
                Back
              </Link>
              <div className="h-6 w-px bg-slate-200 mx-1" />
              <button
                onClick={onWeeklyDigest}
                disabled={digestBusy}
                className="text-[13px] px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                {digestBusy ? "Generating…" : "Weekly Digest"}
              </button>
              <button
                onClick={onRefreshAll}
                disabled={busyId === "refresh:all"}
                className="text-[13px] px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50"
              >
                {busyId === "refresh:all" ? "Refreshing…" : "Refresh"}
              </button>

              <div className="relative group">
                <button className="text-[13px] px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50">
                  Export
                </button>
                <div className="absolute right-0 mt-2 w-48 bg-white shadow-xl border border-slate-200 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50">
                  <button
                    onClick={() =>
                      window.open(`/api/raid/export/excel?projectId=${encodeURIComponent(projectId)}`, "_blank")
                    }
                    className="block w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                  >
                    Export Excel
                  </button>
                  <button
                    onClick={() => window.open(`/api/raid/export/pdf?projectId=${encodeURIComponent(projectId)}`, "_blank")}
                    className="block w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                  >
                    Export PDF
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-5 py-3 border-t border-slate-100">
            <div className="flex items-center gap-2 text-[13px] text-slate-600">
              <span className="inline-block w-2 h-2 rounded-full bg-sky-500" />
              <span>
                <span className="font-semibold text-slate-900">{stats.open}</span> Open
              </span>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-slate-600">
              <span className="inline-block w-2 h-2 rounded-full bg-rose-500" />
              <span>
                <span className="font-semibold text-slate-900">{stats.high}</span> High Exposure
              </span>
            </div>
            <div className="flex items-center gap-2 text-[13px] text-slate-600">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
              <span>
                <span className="font-semibold text-slate-900">{stats.mitigated}</span> Mitigated
              </span>
            </div>
            <div className="ml-auto text-[13px] text-slate-500">{stats.total} items</div>
          </div>
        </div>
      </header>

      {/* Banners */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 mt-4 space-y-2">
        {banners.map((b) => (
          <div
            key={b.id}
            className={cx(
              "px-3 py-2 text-[13px] flex items-center gap-2 border",
              b.kind === "success"
                ? "bg-emerald-50 border-emerald-200 text-emerald-900"
                : "bg-rose-50 border-rose-200 text-rose-900"
            )}
          >
            <span className="inline-flex items-center justify-center w-5 h-5 bg-white/70 border border-black/5">
              {b.kind === "success" ? "✓" : "!"}
            </span>
            <div className="flex-1">{b.text}</div>
            <button
              onClick={() => dismissBanner(b.id)}
              className="p-1 hover:bg-black/5"
              aria-label="Dismiss"
              title="Dismiss"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <main className="max-w-[1800px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-20">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="space-y-8">
            {(Object.keys(grouped) as RaidType[]).map((type) => {
              const typeStyle = TYPE_STYLES[type];
              const groupItems = grouped[type];
              const isOpen = openGroups[type];
              const rowIds = groupItems.map((x) => x.id);

              return (
                <section key={type} className="border border-slate-200">
                  {/* Group Header (no card, no canvas) */}
                  <div className={cx("relative px-4 py-3 border-b border-slate-200", typeStyle.headerBg)}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={() => toggleGroup(type)}
                          className={cx("p-1 hover:bg-black/5 transition-colors", typeStyle.text)}
                          aria-label="Toggle group"
                          title="Toggle"
                        >
                          <svg
                            className={cx("w-5 h-5 transform transition-transform", isOpen ? "rotate-90" : "")}
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>

                        <div className="flex items-center gap-2 min-w-0">
                          <span className={cx("w-2 h-2 rounded-full", typeStyle.dot)} />
                          <div className="min-w-0">
                            <div className={cx("font-semibold text-[14px]", typeStyle.text)}>{pluralLabel(type)}</div>
                            <div className="text-[12px] text-slate-500 truncate">{typeStyle.desc}</div>
                          </div>
                        </div>

                        <span className="ml-2 px-2 py-0.5 bg-white border border-slate-200 text-[12px] font-medium text-slate-600">
                          {groupItems.length}
                        </span>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          ref={(el) => {
                            menuBtnRefs.current[type] = el;
                          }}
                          onClick={() => setMenuOpenFor(menuOpenFor === type ? "" : type)}
                          className="p-2 text-slate-500 hover:text-slate-700 hover:bg-white/70 border border-transparent hover:border-slate-200"
                          aria-label="Group menu"
                          title="Group menu"
                        >
                          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                            <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                          </svg>
                        </button>

                        {menuOpenFor === type && (
                          <div
                            ref={menuRef}
                            className="absolute right-4 top-[46px] w-56 bg-white shadow-xl border border-slate-200 z-50 py-1"
                          >
                            <div className="px-3 py-2 text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
                              {type} Actions
                            </div>
                            <button
                              onClick={() => exportGroupExcel(type)}
                              className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                            >
                              Export to Excel
                            </button>
                            <button
                              onClick={() => exportGroupPdf(type)}
                              className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                            >
                              Export to PDF
                            </button>
                            <div className="h-px bg-slate-100 my-1" />
                            <button
                              onClick={() => refreshAiForGroup(type)}
                              disabled={busyId === `ai:group:${type}`}
                              className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                            >
                              {busyId === `ai:group:${type}` ? "Refreshing AI…" : "Refresh AI (Group)"}
                            </button>
                            <button
                              onClick={() => copyGroupLink(type)}
                              className="w-full text-left px-4 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
                            >
                              Copy Group Link
                            </button>
                          </div>
                        )}

                        <button
                          onClick={() => onCreate(type)}
                          disabled={busyId === `new:${type}`}
                          className="inline-flex items-center gap-2 px-3 py-2 border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-50 text-[13px] font-medium text-slate-700"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          New {type}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Table */}
                  {isOpen && (
                    <Droppable droppableId={`group:${type}`} direction="vertical">
                      {(dropProvided, dropSnapshot) => (
                        <div
                          ref={dropProvided.innerRef}
                          {...dropProvided.droppableProps}
                          className={cx(
                            "overflow-x-auto",
                            "bg-white",
                            dropSnapshot.isDraggingOver && "bg-indigo-50/20"
                          )}
                        >
                          {/* ✅ True spreadsheet grid: border-separate + border-spacing-0 + full cell borders */}
                          <table className="w-full text-[13px] table-fixed border-separate border-spacing-0">
                            <thead className="bg-slate-50 sticky top-16 z-10">
                              <tr>
                                <th className={cx(TH_WRAP, "w-40 border-l border-slate-200")}>ID</th>

                                <th className={cx(TH_WRAP, "relative")} style={{ width: colW.desc }}>
                                  Description
                                  <span
                                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300/70"
                                    onMouseDown={(e) => startResize("desc", e)}
                                  />
                                </th>

                                <th className={cx(TH_WRAP, "w-80")}>Owner *</th>
                                <th className={cx(TH_WRAP, "w-44")}>Status *</th>
                                <th className={cx(TH_WRAP, "w-44")}>Priority</th>
                                <th className={cx(TH_WRAP, "w-28")}>Likelihood</th>
                                <th className={cx(TH_WRAP, "w-28")}>Severity</th>
                                <th className={cx(TH_WRAP, "w-24")}>Score</th>
                                <th className={cx(TH_WRAP, "w-40")}>Due Date</th>

                                <th className={cx(TH_WRAP, "relative")} style={{ width: colW.resp }}>
                                  Response Plan
                                  <span
                                    className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300/70"
                                    onMouseDown={(e) => startResize("resp", e)}
                                  />
                                </th>

                                <th className={cx(TH_WRAP, "w-72")}>AI Rollup</th>
                                <th className={cx(TH_WRAP, "w-28")}>Updated</th>

                                {/* ✅ last header cell: no right border */}
                                <th className={cx(TH_WRAP, "w-24 text-right border-r-0")}>Actions</th>
                              </tr>
                            </thead>

                            <tbody>
                              {groupItems.length === 0 ? (
                                <tr>
                                  <td
                                    colSpan={13}
                                    className="px-4 py-12 text-center text-slate-500 border-b border-slate-200 border-l border-slate-200 border-r border-slate-200"
                                  >
                                    No {type.toLowerCase()}s yet. Create one to get started.
                                  </td>
                                </tr>
                              ) : (
                                groupItems.map((it, index) => {
                                  const sc = calcScore(it.probability, it.severity);
                                  const tone = toneFromScore(sc);
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

                                  return (
                                    <Draggable
                                      key={dndIdForRaid(it)}
                                      draggableId={dndIdForRaid(it)}
                                      index={index}
                                      isDragDisabled={Boolean(isBusy)}
                                    >
                                      {(dragProvided, dragSnapshot) => (
                                        <React.Fragment>
                                          <tr
                                            ref={dragProvided.innerRef}
                                            {...dragProvided.draggableProps}
                                            data-raid-id={it.id}
                                            data-raid-public={safeStr(it.public_id || "").trim()}
                                            className={cx(
                                              "group",
                                              isBusy && "opacity-60",
                                              stale && "bg-amber-50/30",
                                              dragSnapshot.isDragging && "bg-indigo-50/50"
                                            )}
                                            tabIndex={0}
                                            onFocus={() => setHotRowId(it.id)}
                                            onMouseDown={() => setHotRowId(it.id)}
                                          >
                                            {/* ID + handle (✅ left border to close grid) */}
                                            <td className={cx(CELL_WRAP, "w-40 border-l border-slate-200")}>
                                              <div className="flex items-center gap-2 min-w-0">
                                                <button
                                                  type="button"
                                                  data-dnd-handle
                                                  {...dragProvided.dragHandleProps}
                                                  className="p-1 text-slate-400 hover:text-slate-600 hover:bg-slate-100 cursor-grab active:cursor-grabbing"
                                                  title="Drag"
                                                  aria-label="Drag"
                                                  onMouseDown={(e) => {
                                                    e.stopPropagation();
                                                  }}
                                                >
                                                  <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor">
                                                    <path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0zM7 10a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0zM7 16a1 1 0 11-2 0 1 1 0 012 0zm8 0a1 1 0 11-2 0 1 1 0 012 0z" />
                                                  </svg>
                                                </button>

                                                <span className="font-mono text-[11px] bg-slate-50 text-slate-700 px-2 py-0.5 border border-slate-200 truncate">
                                                  {safeStr(it.public_id) || "—"}
                                                </span>

                                                {stale && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      void onReloadRow(it.id);
                                                    }}
                                                    title="Reload"
                                                    className="text-amber-700 hover:text-amber-800"
                                                  >
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                      <path
                                                        strokeLinecap="round"
                                                        strokeLinejoin="round"
                                                        strokeWidth={2}
                                                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                                                      />
                                                    </svg>
                                                  </button>
                                                )}
                                              </div>
                                              {stale && <div className="text-[12px] text-amber-800 mt-1">{stale.message}</div>}
                                            </td>

                                            {/* Description (read-mode) */}
                                            <td className={CELL_WRAP} style={{ width: colW.desc }}>
                                              <div ref={(el) => setCellRef(it.id, "description", el)} className="w-full">
                                                <CellDisplay
                                                  value={safeStr(it.description)}
                                                  placeholder="Describe…"
                                                  onActivate={() => openEditor({ type, rowId: it.id, col: "description" })}
                                                  title={safeStr(it.description)}
                                                />
                                              </div>
                                            </td>

                                            {/* Owner (read-mode) */}
                                            <td className={CELL_WRAP}>
                                              <div ref={(el) => setCellRef(it.id, "owner_label", el)} className="w-full">
                                                <CellDisplay
                                                  value={safeStr(it.owner_label)}
                                                  placeholder="Owner name…"
                                                  onActivate={() => {
                                                    touch(it.id, "owner");
                                                    openEditor({ type, rowId: it.id, col: "owner_label" });
                                                  }}
                                                />
                                                {showOwnerWarn && (
                                                  <div className="text-[12px] text-rose-700 mt-1 font-medium">Owner required</div>
                                                )}
                                              </div>
                                            </td>

                                            {/* Status (tag) */}
                                            <td className={CELL_WRAP}>
                                              <div ref={(el) => setCellRef(it.id, "status", el)} className="w-full">
                                                <PillTag
                                                  kind="status"
                                                  label={safeStr(it.status || "Open")}
                                                  disabled={isBusy}
                                                  onActivate={() => openEditor({ type, rowId: it.id, col: "status" })}
                                                />
                                              </div>
                                            </td>

                                            {/* Priority (tag) */}
                                            <td className={CELL_WRAP}>
                                              <div ref={(el) => setCellRef(it.id, "priority", el)} className="w-full">
                                                <PillTag
                                                  kind="priority"
                                                  label={safeStr(it.priority || "")}
                                                  disabled={isBusy}
                                                  onActivate={() => openEditor({ type, rowId: it.id, col: "priority" })}
                                                />
                                              </div>
                                            </td>

                                            {/* Likelihood (read-mode) */}
                                            <td className={CELL_WRAP}>
                                              <div ref={(el) => setCellRef(it.id, "probability", el)} className="w-full">
                                                <CellDisplay
                                                  value={String(Number.isFinite(Number(it.probability)) ? Number(it.probability) : 0)}
                                                  placeholder="0"
                                                  align="center"
                                                  onActivate={() => openEditor({ type, rowId: it.id, col: "probability" })}
                                                />
                                              </div>
                                            </td>

                                            {/* Severity (read-mode) */}
                                            <td className={CELL_WRAP}>
                                              <div ref={(el) => setCellRef(it.id, "severity", el)} className="w-full">
                                                <CellDisplay
                                                  value={String(Number.isFinite(Number(it.severity)) ? Number(it.severity) : 0)}
                                                  placeholder="0"
                                                  align="center"
                                                  onActivate={() => openEditor({ type, rowId: it.id, col: "severity" })}
                                                />
                                              </div>
                                            </td>

                                            {/* Score */}
                                            <td className={CELL_WRAP}>
                                              <div className="flex items-center gap-2 w-full">
                                                <div
                                                  className={cx(
                                                    "w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold",
                                                    tone === "r"
                                                      ? "bg-rose-500 text-white"
                                                      : tone === "a"
                                                      ? "bg-amber-400 text-slate-900"
                                                      : "bg-emerald-500 text-white"
                                                  )}
                                                >
                                                  {sc}
                                                </div>
                                                <div className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                  <div
                                                    className={cx(
                                                      "h-full rounded-full",
                                                      tone === "r" ? "bg-rose-500" : tone === "a" ? "bg-amber-400" : "bg-emerald-500"
                                                    )}
                                                    style={{ width: `${sc}%` }}
                                                  />
                                                </div>
                                              </div>
                                            </td>

                                            {/* Due Date (read-mode) */}
                                            <td className={CELL_WRAP}>
                                              <div ref={(el) => setCellRef(it.id, "due_date", el)} className="w-full">
                                                <CellDisplay
                                                  value={fmtDateOnly(it.due_date)}
                                                  placeholder="—"
                                                  align="center"
                                                  mono
                                                  onActivate={() => openEditor({ type, rowId: it.id, col: "due_date" })}
                                                />
                                              </div>
                                            </td>

                                            {/* Response Plan (read-mode) */}
                                            <td className={CELL_WRAP} style={{ width: colW.resp }}>
                                              <div ref={(el) => setCellRef(it.id, "response_plan", el)} className="w-full">
                                                <CellDisplay
                                                  value={safeStr(it.response_plan || "")}
                                                  placeholder="Plan…"
                                                  onActivate={() => {
                                                    touch(it.id, "plan");
                                                    openEditor({ type, rowId: it.id, col: "response_plan" });
                                                  }}
                                                />
                                                {showPlanWarn && (
                                                  <div className="text-[12px] text-rose-700 mt-1 font-medium">Plan required</div>
                                                )}
                                              </div>
                                            </td>

                                            {/* AI Rollup */}
                                            <td className={CELL_WRAP}>
                                              <div className="w-full">
                                                {it.ai_rollup ? (
                                                  <p className="text-[13px] text-slate-600 line-clamp-2" title={it.ai_rollup}>
                                                    {it.ai_rollup}
                                                  </p>
                                                ) : (
                                                  <span className="text-[13px] text-slate-400 italic">No AI yet</span>
                                                )}
                                              </div>
                                            </td>

                                            {/* Updated */}
                                            <td className={CELL_WRAP}>
                                              <span className="text-[12px] text-slate-500">{fmtWhen(it.updated_at)}</span>
                                            </td>

                                            {/* Actions (✅ last cell: remove right border to avoid double line) */}
                                            <td className="px-2 py-2 min-h-[38px] bg-white border-b border-slate-200 border-r-0">
                                              <div className="flex items-center justify-end gap-1">
                                                <button
                                                  onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    setAiOpenId(aiOpenId === it.id ? "" : it.id);
                                                  }}
                                                  className={cx(
                                                    "p-2 border border-transparent hover:border-slate-200 hover:bg-slate-50",
                                                    aiOpenId === it.id ? "bg-indigo-50 text-indigo-700 border-indigo-200" : "text-slate-500"
                                                  )}
                                                  title="AI Insights"
                                                >
                                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                  </svg>
                                                </button>

                                                <button
                                                  onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    void onAiRefresh(it.id);
                                                  }}
                                                  disabled={isBusy}
                                                  className="p-2 text-slate-500 border border-transparent hover:border-slate-200 hover:bg-slate-50 disabled:opacity-50"
                                                  title="Refresh AI"
                                                >
                                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                  </svg>
                                                </button>

                                                <button
                                                  onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    void onDelete(it.id);
                                                  }}
                                                  disabled={isBusy}
                                                  className="p-2 text-rose-600 border border-transparent hover:border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                                                  title="Delete"
                                                >
                                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      strokeWidth={2}
                                                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                                    />
                                                  </svg>
                                                </button>
                                              </div>
                                            </td>
                                          </tr>

                                          {/* AI Panel (left as functional, minimal "card") */}
                                          {aiOpenId === it.id && (
                                            <tr>
                                              <td colSpan={13} className="bg-indigo-50/40 border-b border-indigo-100 border-l border-slate-200 border-r border-slate-200">
                                                <div className="p-4">
                                                  <div className="flex items-center justify-between mb-3">
                                                    <div className="flex items-center gap-3">
                                                      <div className="w-8 h-8 bg-indigo-100 flex items-center justify-center text-indigo-700 border border-indigo-200">
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                                        </svg>
                                                      </div>
                                                      <div>
                                                        <h3 className="font-semibold text-slate-900">AI Insights</h3>
                                                        <p className="text-[12px] text-slate-500">
                                                          Status: {safeStr(ai.ai_status) || "—"} • Quality:{" "}
                                                          {Number.isFinite(ai.ai_quality) ? `${Math.round(ai.ai_quality)}/100` : "—"} •{" "}
                                                          {safeStr(ai.last_run_at) ? fmtWhen(ai.last_run_at) : "Never"}
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
                                                        className="px-3 py-2 text-[13px] font-medium text-indigo-700 bg-indigo-100 hover:bg-indigo-200 border border-indigo-200 disabled:opacity-50"
                                                      >
                                                        {aiHistBusyId === it.id
                                                          ? "Loading…"
                                                          : aiHistOpenId === it.id
                                                          ? "Hide History"
                                                          : "View History"}
                                                      </button>
                                                      <button
                                                        onClick={(e) => {
                                                          e.preventDefault();
                                                          e.stopPropagation();
                                                          setAiOpenId("");
                                                        }}
                                                        className="p-2 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200"
                                                        title="Close"
                                                      >
                                                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                                        </svg>
                                                      </button>
                                                    </div>
                                                  </div>

                                                  <div className="grid gap-3">
                                                    <div className="bg-white p-4 border border-indigo-100">
                                                      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                                        Summary
                                                      </h4>
                                                      <p className="text-[13px] text-slate-700 leading-relaxed">
                                                        {safeStr(ai.summary || it.ai_rollup || "No summary available.")}
                                                      </p>
                                                    </div>

                                                    <div className="bg-white p-4 border border-indigo-100">
                                                      <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                                        Recommendations
                                                      </h4>
                                                      <div className="grid gap-2">
                                                        {(ai?.recommendations || []).length > 0 ? (
                                                          ai.recommendations.map((r: string, idx: number) => (
                                                            <div key={idx} className="flex items-start gap-3 p-3 bg-slate-50 border border-slate-200">
                                                              <span className="flex-shrink-0 w-6 h-6 bg-indigo-100 text-indigo-700 border border-indigo-200 flex items-center justify-center text-[12px] font-bold">
                                                                {idx + 1}
                                                              </span>
                                                              <p className="text-[13px] text-slate-700">{r}</p>
                                                            </div>
                                                          ))
                                                        ) : (
                                                          <p className="text-[13px] text-slate-500 italic">No recommendations yet.</p>
                                                        )}
                                                      </div>
                                                    </div>

                                                    {aiHistOpenId === it.id && (
                                                      <div className="bg-white p-4 border border-indigo-100">
                                                        <h4 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-3">
                                                          Version History & Diff
                                                        </h4>

                                                        {runs.length === 0 ? (
                                                          <p className="text-[13px] text-slate-500">No history available.</p>
                                                        ) : (
                                                          <div className="space-y-4">
                                                            <div className="flex items-center gap-4">
                                                              <div className="flex-1">
                                                                <label className="text-[12px] text-slate-500 mb-1 block">Version A</label>
                                                                <select
                                                                  className="w-full text-[13px] border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                                                                  value={cmp.a}
                                                                  onChange={(e) =>
                                                                    setAiCompareById((prev) => ({
                                                                      ...prev,
                                                                      [it.id]: { ...prev[it.id], a: e.target.value },
                                                                    }))
                                                                  }
                                                                >
                                                                  {runs.map((r) => (
                                                                    <option key={r.id} value={r.id}>
                                                                      {fmtWhen(r.created_at)} • {safeStr(r.version) || "v?"} • Q{Math.round(r.ai_quality || 0)}
                                                                    </option>
                                                                  ))}
                                                                </select>
                                                              </div>
                                                              <div className="text-slate-400 pt-6">vs</div>
                                                              <div className="flex-1">
                                                                <label className="text-[12px] text-slate-500 mb-1 block">Version B</label>
                                                                <select
                                                                  className="w-full text-[13px] border border-slate-200 px-3 py-2 focus:ring-2 focus:ring-indigo-500"
                                                                  value={cmp.b}
                                                                  onChange={(e) =>
                                                                    setAiCompareById((prev) => ({
                                                                      ...prev,
                                                                      [it.id]: { ...prev[it.id], b: e.target.value },
                                                                    }))
                                                                  }
                                                                >
                                                                  {runs.map((r) => (
                                                                    <option key={r.id} value={r.id}>
                                                                      {fmtWhen(r.created_at)} • {safeStr(r.version) || "v?"} • Q{Math.round(r.ai_quality || 0)}
                                                                    </option>
                                                                  ))}
                                                                </select>
                                                              </div>
                                                            </div>

                                                            {runA && runB && (
                                                              <div className="space-y-3 border-t border-slate-100 pt-4">
                                                                {diffRollup && (
                                                                  <div className="grid grid-cols-2 gap-4">
                                                                    <div className="p-3 bg-rose-50 border border-rose-100">
                                                                      <div className="text-[11px] font-semibold text-rose-700 mb-1">Previous</div>
                                                                      <div className="text-[13px] text-slate-700">{diffRollup.a}</div>
                                                                    </div>
                                                                    <div className="p-3 bg-emerald-50 border border-emerald-100">
                                                                      <div className="text-[11px] font-semibold text-emerald-700 mb-1">Current</div>
                                                                      <div className="text-[13px] text-slate-700">{diffRollup.b}</div>
                                                                    </div>
                                                                  </div>
                                                                )}

                                                                {diffSummary && (
                                                                  <div className="grid grid-cols-2 gap-4">
                                                                    <div className="p-3 bg-rose-50 border border-rose-100">
                                                                      <div className="text-[11px] font-semibold text-rose-700 mb-1">Previous Summary</div>
                                                                      <div className="text-[13px] text-slate-700">{diffSummary.a}</div>
                                                                    </div>
                                                                    <div className="p-3 bg-emerald-50 border border-emerald-100">
                                                                      <div className="text-[11px] font-semibold text-emerald-700 mb-1">Current Summary</div>
                                                                      <div className="text-[13px] text-slate-700">{diffSummary.b}</div>
                                                                    </div>
                                                                  </div>
                                                                )}

                                                                {diffRecs && (
                                                                  <div className="grid grid-cols-2 gap-4">
                                                                    <div className="p-3 bg-rose-50 border border-rose-100">
                                                                      <div className="text-[11px] font-semibold text-rose-700 mb-2">Previous Recommendations</div>
                                                                      <ul className="list-disc list-inside text-[13px] text-slate-700 space-y-1">
                                                                        {diffRecs.a.map((x, i) => (
                                                                          <li key={i}>{x}</li>
                                                                        ))}
                                                                      </ul>
                                                                    </div>
                                                                    <div className="p-3 bg-emerald-50 border border-emerald-100">
                                                                      <div className="text-[11px] font-semibold text-emerald-700 mb-2">Current Recommendations</div>
                                                                      <ul className="list-disc list-inside text-[13px] text-slate-700 space-y-1">
                                                                        {diffRecs.b.map((x, i) => (
                                                                          <li key={i}>{x}</li>
                                                                        ))}
                                                                      </ul>
                                                                    </div>
                                                                  </div>
                                                                )}

                                                                {!diffRollup && !diffSummary && !diffRecs && (
                                                                  <p className="text-[13px] text-slate-500 text-center py-4">
                                                                    No differences between selected versions.
                                                                  </p>
                                                                )}
                                                              </div>
                                                            )}
                                                          </div>
                                                        )}
                                                      </div>
                                                    )}
                                                  </div>
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
                        </div>
                      )}
                    </Droppable>
                  )}
                </section>
              );
            })}
          </div>
        </DragDropContext>
      </main>

      {/* ✅ Active-cell editor overlay (Notion-style) */}
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
            <div className="bg-white shadow-[0_10px_30px_rgba(2,6,23,0.18)] border border-indigo-200 overflow-hidden">
              {editor.col === "status" ? (
                <select
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  className={cx("w-full h-10 px-3 border-0 outline-none text-[13px] font-semibold", "bg-indigo-50")}
                  value={safeStr(editor.value || "Open")}
                  onChange={(e) => {
                    setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur));
                    window.setTimeout(() => void commitEditor(), 0);
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
                  className={cx("w-full h-10 px-3 border-0 outline-none text-[13px] font-semibold", "bg-indigo-50")}
                  value={safeStr(editor.value || "")}
                  onChange={(e) => {
                    setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur));
                    window.setTimeout(() => void commitEditor(), 0);
                  }}
                >
                  <option value="">—</option>
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
                  className="w-full h-10 px-3 border-0 outline-none text-[13px]"
                  value={safeStr(editor.value || "")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                />
              ) : editor.col === "probability" || editor.col === "severity" ? (
                <input
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  type="number"
                  min={0}
                  max={100}
                  className="w-full h-10 px-3 border-0 outline-none text-[13px] text-center"
                  value={safeStr(editor.value || "0")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                />
              ) : editor.col === "description" || editor.col === "response_plan" ? (
                <textarea
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  className="w-full min-h-[84px] px-3 py-2 border-0 outline-none text-[13px] leading-5 resize-none"
                  value={safeStr(editor.value || "")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                />
              ) : (
                <input
                  ref={(el) => {
                    editorInputRef.current = el;
                  }}
                  className="w-full h-10 px-3 border-0 outline-none text-[13px]"
                  value={safeStr(editor.value || "")}
                  onChange={(e) => setEditor((cur) => (cur ? { ...cur, value: e.target.value } : cur))}
                  onBlur={() => void commitEditor()}
                />
              )}

              <div className="px-3 py-2 border-t border-slate-100 bg-slate-50 flex items-center justify-between text-[12px] text-slate-500">
                <span>Enter / Tab / ↑ ↓ to navigate • Paste TSV supported</span>
                <button
                  className="px-2 py-1 hover:bg-slate-200 text-slate-600"
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

      {/* Digest Modal (unchanged) */}
      {digest && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-start justify-center p-4 sm:p-6 overflow-y-auto"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDigest(null);
          }}
        >
          <div className="bg-white shadow-2xl w-full max-w-5xl my-8 overflow-hidden border border-slate-200">
            <div className="sticky top-0 bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between z-10">
              <div>
                <h2 className="text-[16px] font-semibold text-slate-900">
                  {safeStr(digest?.header?.title) || "Weekly RAID Digest"}
                </h2>
                <p className="text-[13px] text-slate-500 mt-1">
                  {safeStr(digest?.header?.project_code) || humanProjectId} • {safeStr(digest?.header?.project_name) || humanProjectTitle} •{" "}
                  {fmtWhen(digest?.generated_at)}
                </p>
              </div>
              <button onClick={() => setDigest(null)} className="p-2 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200">
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 bg-slate-50/60">
              <div className="grid md:grid-cols-2 gap-4">
                {(Array.isArray(digest?.sections) ? digest.sections : []).map((sec: any) => (
                  <div key={safeStr(sec?.key) || safeStr(sec?.title)} className="bg-white border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                      <h3 className="font-semibold text-slate-900">{safeStr(sec?.title) || "Section"}</h3>
                      <span className="px-2.5 py-0.5 bg-slate-200 text-slate-700 text-[12px] font-bold">{sec?.count || sec?.items?.length || 0}</span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {Array.isArray(sec?.items) && sec.items.length > 0 ? (
                        sec.items.map((x: any, i: number) => {
                          const link = digestDeepLink(routeProjectId, x);
                          const idTxt = digestId(x);
                          return (
                            <li key={safeStr(x?.id) || i} className="p-3 hover:bg-slate-50 transition-colors flex items-center gap-3">
                              <div className="w-2 h-2 rounded-full bg-slate-400" />
                              <Link href={link} className="font-mono text-[11px] bg-slate-100 text-slate-700 px-2 py-1 hover:bg-slate-200 transition-colors border border-slate-200">
                                {digestIdShort(x)}
                              </Link>
                              <div className="flex-1 min-w-0">
                                <Link href={link} className="text-[13px] font-medium text-slate-900 hover:text-indigo-600 truncate block">
                                  {safeStr(x?.title) || safeStr(x?.description) || "Untitled"}
                                </Link>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => copyToClipboard(idTxt)}
                                  className="p-2 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
                                  title="Copy ID"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                                  className="p-2 text-slate-500 hover:bg-slate-100 border border-transparent hover:border-slate-200 transition-colors"
                                  title="Copy Link"
                                >
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
                        <li className="p-4 text-[13px] text-slate-500 text-center">No items</li>
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