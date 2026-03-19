// src/components/editors/WBSEditor.tsx
"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  useCallback,
  useReducer,
} from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import VirtualizedWbsList from "./wbs/VirtualizedWbsList";

type WbsStatus = "not_started" | "in_progress" | "done" | "blocked";
type Effort = "S" | "M" | "L" | "";

export type WbsRow = {
  id: string;
  level: number;
  code?: string;
  deliverable: string;
  description?: string;
  acceptance_criteria?: string;
  owner?: string;
  status?: WbsStatus;
  effort?: Effort;
  due_date?: string;
  predecessor?: string;
  tags?: string[];
};

export type WbsDocV1 = {
  version: 1;
  type: "wbs";
  title?: string;
  due_date?: string;
  auto_rollup?: boolean;
  rows: WbsRow[];
};

type ViewState = {
  q: string;
  ownerFilter: string;
  statusFilter: WbsStatus | "";
  tagFilter: string;
  dueFrom: string;
  dueTo: string;
  onlyOverdue: boolean;
  onlyBlocked: boolean;
  leavesOnly: boolean;
  onlyMissingEffort: boolean;
};

type SavedView = { id: string; name: string; state: ViewState; createdAt: string };
const LS_KEY_VIEWS = "wbs_saved_views_v1";
const LS_KEY_MYWORK = "wbs_my_work_owner_v1";

const LazyWbsAssistantRail = dynamic(() => import("./wbs/WbsAssistantRail"), {
  ssr: false,
  loading: () => null,
});

const IC = {
  ChevRight: () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M3.5 2l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  ChevDown: () => (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
      <path
        d="M2 3.5l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Dots: () => (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <circle cx="2.5" cy="7" r="1.2" fill="currentColor" />
      <circle cx="7" cy="7" r="1.2" fill="currentColor" />
      <circle cx="11.5" cy="7" r="1.2" fill="currentColor" />
    </svg>
  ),
  UpDown: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M6.5 1v11M3.5 4l3-3 3 3M3.5 9l3 3 3-3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  IndentIn: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M2 2v7h9M8 6l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  ArrRight: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M2 6.5h9M8 3l3 3.5-3 3.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  ArrLeft: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M11 6.5H2M5 3L2 6.5 5 10"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
  Sparkle: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path
        d="M6.5 1L8 4.5h3.5L8.5 6.5 10 10 6.5 8 3 10l1.5-3.5L2 4.5h3.5L6.5 1z"
        fill="currentColor"
        fillOpacity="0.8"
      />
    </svg>
  ),
  Robot: () => (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="6.5" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
  Close: () => (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
      <path
        d="M2 2l7 7M9 2l-7 7"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  ),
  Download: () => (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path
        d="M6 1v6M3.5 5l2.5 2 2.5-2M1.5 9v.5A1 1 0 002.5 10.5h7a1 1 0 001-1V9"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ),
};

const T = {
  page: {
    minHeight: "100vh",
    background: "#f6f8fa",
    fontFamily: "'Geist', -apple-system, sans-serif",
  } as React.CSSProperties,
  header: {
    background: "#ffffff",
    borderBottom: "1px solid #e8ecf0",
    padding: "0 28px",
    display: "flex",
    alignItems: "center",
    gap: 12,
    height: 56,
    position: "sticky" as const,
    top: 0,
    zIndex: 30,
  },
  card: { background: "#ffffff", borderRadius: 12, border: "1px solid #e8ecf0" } as React.CSSProperties,
  input: {
    background: "#f6f8fa",
    border: "1px solid #e8ecf0",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13,
    color: "#0d1117",
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box" as const,
  },
  select: {
    background: "#f6f8fa",
    border: "1px solid #e8ecf0",
    borderRadius: 8,
    padding: "7px 10px",
    fontSize: 13,
    color: "#0d1117",
    fontFamily: "inherit",
    outline: "none",
    appearance: "none" as const,
    cursor: "pointer",
  },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid #e8ecf0",
    background: "#ffffff",
    fontSize: 12,
    fontWeight: 600,
    color: "#57606a",
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  btnDark: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid #0d1117",
    background: "#0d1117",
    fontSize: 12,
    fontWeight: 600,
    color: "#ffffff",
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  btnVio: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid #c4b5fd",
    background: "#ede9fe",
    fontSize: 12,
    fontWeight: 600,
    color: "#6d28d9",
    cursor: "pointer",
    fontFamily: "inherit",
    whiteSpace: "nowrap" as const,
  } as React.CSSProperties,
  lbl: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: "0.07em",
    textTransform: "uppercase" as const,
    color: "#8b949e",
    marginBottom: 4,
    display: "block",
  },
};

const STATUS_CFG: Record<
  WbsStatus,
  { label: string; dot: string; bg: string; border: string; text: string; track: string }
> = {
  not_started: {
    label: "Not started",
    dot: "#94a3b8",
    bg: "#f8fafc",
    border: "#e2e8f0",
    text: "#475569",
    track: "#cbd5e1",
  },
  in_progress: {
    label: "In progress",
    dot: "#f59e0b",
    bg: "#fffbeb",
    border: "#fde68a",
    text: "#92400e",
    track: "#f59e0b",
  },
  done: {
    label: "Done",
    dot: "#16a34a",
    bg: "#f0fdf4",
    border: "#bbf7d0",
    text: "#15803d",
    track: "#22c55e",
  },
  blocked: {
    label: "Blocked",
    dot: "#ef4444",
    bg: "#fff5f5",
    border: "#fecaca",
    text: "#b91c1c",
    track: "#ef4444",
  },
};

const LEVEL_STRIPE = ["#0d1117", "#6366f1", "#3b82f6", "#0d9488", "#f59e0b", "#ef4444"];

function uuidish() {
  try {
    return (globalThis as any)?.crypto?.randomUUID?.() ?? `r_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  } catch {
    return `r_${Math.random().toString(16).slice(2)}_${Date.now()}`;
  }
}
function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function todayISO() {
  return new Date().toISOString().slice(0, 10);
}
function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

const EFFORT_SET = new Set(["S", "M", "L"]);
function normalizeEffort(x: any): Effort {
  const s = safeStr(x).trim().toUpperCase();
  return EFFORT_SET.has(s) ? (s as Effort) : "";
}
function isEffortMissing(e: any) {
  return !normalizeEffort(e);
}
function effortWeight(e: Effort | undefined) {
  if (e === "S") return 1;
  if (e === "L") return 3;
  return 2;
}
function statusScore(s: WbsStatus | undefined) {
  if (s === "done") return 1;
  if (s === "in_progress") return 0.5;
  return 0;
}
function isOverdue(rowDue: string | undefined, status?: WbsStatus) {
  if (status === "done") return false;
  const d = safeStr(rowDue);
  if (!d) return false;
  return d < todayISO();
}
function parseTags(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .slice(0, 12);
}
function joinTags(tags?: string[]) {
  return (tags ?? []).filter(Boolean).join(", ");
}
function rowHasChildren(rows: WbsRow[], idx: number) {
  const cur = rows[idx];
  const next = rows[idx + 1];
  return !!(cur && next && next.level > cur.level);
}
function subtreeRange(rows: WbsRow[], idx: number) {
  const base = rows[idx];
  let end = idx + 1;
  for (let i = idx + 1; i < rows.length; i++) {
    if (rows[i].level <= base.level) break;
    end = i + 1;
  }
  return { start: idx, end };
}
function pickFilenameFromDisposition(d: string | null, fallback: string) {
  const m1 = (d || "").match(/filename\*=\s*UTF-8''([^;]+)/i);
  if (m1?.[1]) return decodeURIComponent(m1[1].replace(/(^"|"$)/g, ""));
  const m2 = (d || "").match(/filename\s*=\s*"?([^"]+)"?/i);
  if (m2?.[1]) return m2[1].trim();
  return fallback;
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  const arr = safeParseJson<SavedView[]>(window.localStorage.getItem(LS_KEY_VIEWS));
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v) => v && typeof v === "object" && typeof (v as any).id === "string")
    .slice(0, 50);
}
function persistSavedViews(next: SavedView[]) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(LS_KEY_VIEWS, JSON.stringify(next.slice(0, 50)));
  }
}

function normalizeInitial(initialJson: any): WbsDocV1 {
  let obj: any = initialJson;
  if (typeof initialJson === "string") {
    try {
      obj = JSON.parse(initialJson);
    } catch {
      obj = null;
    }
  }
  if (
    obj &&
    typeof obj === "object" &&
    safeLower(obj.type) === "wbs" &&
    Number(obj.version) === 1 &&
    Array.isArray(obj.rows)
  ) {
    return {
      version: 1,
      type: "wbs",
      title: safeStr(obj.title || "Work Breakdown Structure"),
      due_date: safeStr(obj.due_date || ""),
      auto_rollup: obj.auto_rollup !== false,
      rows: (obj.rows as WbsRow[]).map((r) => ({
        id: safeStr((r as any).id) || uuidish(),
        level: clamp(Number((r as any).level ?? 0), 0, 10),
        deliverable: safeStr((r as any).deliverable),
        description: safeStr((r as any).description),
        acceptance_criteria: safeStr((r as any).acceptance_criteria),
        owner: safeStr((r as any).owner),
        status: (((r as any).status ?? "not_started") as WbsStatus) || "not_started",
        effort: normalizeEffort((r as any).effort),
        due_date: safeStr((r as any).due_date),
        predecessor: safeStr((r as any).predecessor),
        tags: Array.isArray((r as any).tags)
          ? (r as any).tags.map((t: any) => safeStr(t)).filter(Boolean)
          : [],
      })),
    };
  }
  return {
    version: 1,
    type: "wbs",
    title: "Work Breakdown Structure",
    due_date: "",
    auto_rollup: true,
    rows: [
      {
        id: uuidish(),
        level: 0,
        deliverable: "Project Governance & Management",
        status: "in_progress" as WbsStatus,
        effort: "M",
      },
      {
        id: uuidish(),
        level: 1,
        deliverable: "Project Charter",
        status: "done" as WbsStatus,
        effort: "S",
      },
      {
        id: uuidish(),
        level: 1,
        deliverable: "Stakeholder Register",
        status: "in_progress" as WbsStatus,
        effort: "S",
      },
    ],
  };
}

function computeCodes(rows: WbsRow[]): WbsRow[] {
  const counters: number[] = [];
  return rows.map((r) => {
    const lvl = clamp(Number(r.level ?? 0), 0, 10);
    counters[lvl] = (counters[lvl] ?? 0) + 1;
    for (let i = lvl + 1; i < counters.length; i++) counters[i] = 0;
    const parts = counters.slice(0, lvl + 1).filter((x) => x > 0);
    return { ...r, level: lvl, code: parts.join(".") };
  });
}

function serialize(doc: WbsDocV1): any {
  return {
    version: 1,
    type: "wbs",
    title: safeStr(doc.title).trim() || "Work Breakdown Structure",
    due_date: safeStr(doc.due_date).trim(),
    auto_rollup: doc.auto_rollup !== false,
    rows: doc.rows.map((r) => ({
      id: r.id,
      level: r.level,
      deliverable: safeStr(r.deliverable),
      description: safeStr(r.description),
      acceptance_criteria: safeStr(r.acceptance_criteria),
      owner: safeStr(r.owner),
      status: ((r.status ?? "not_started") as WbsStatus) || "not_started",
      effort: normalizeEffort(r.effort),
      due_date: safeStr(r.due_date),
      predecessor: safeStr(r.predecessor),
      tags: Array.isArray(r.tags) ? r.tags.map((t) => safeStr(t)).filter(Boolean) : [],
    })),
  };
}

function deriveRollups(
  rows: WbsRow[],
  autoRollup: boolean
): Array<WbsRow & { _derivedStatus?: WbsStatus; _derivedProgress?: number; _isParent?: boolean }> {
  const out = rows.map((r) => ({
    ...r,
    _derivedStatus: undefined as any,
    _derivedProgress: undefined as any,
    _isParent: false,
  }));
  if (!autoRollup) return out;

  for (let i = out.length - 1; i >= 0; i--) {
    const isParent = rowHasChildren(out, i);
    out[i]._isParent = isParent;

    if (!isParent) {
      out[i]._derivedStatus = (((out[i].status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus;
      out[i]._derivedProgress = Math.round(statusScore(out[i]._derivedStatus) * 100);
      continue;
    }

    const { start, end } = subtreeRange(out, i);
    const leafs: any[] = [];
    for (let j = start + 1; j < end; j++) {
      if (!rowHasChildren(out, j)) leafs.push(out[j]);
    }

    if (leafs.length === 0) {
      out[i]._derivedStatus = (((out[i].status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus;
      out[i]._derivedProgress = Math.round(statusScore(out[i]._derivedStatus) * 100);
      continue;
    }

    const anyBlocked = leafs.some((x) => ((x.status ?? "not_started") as WbsStatus) === "blocked");
    const allDone = leafs.every((x) => ((x.status ?? "not_started") as WbsStatus) === "done");
    const anyStarted = leafs.some((x) => {
      const s = (((x.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus;
      return s === "in_progress" || s === "done";
    });
    const derivedStatus: WbsStatus = anyBlocked
      ? "blocked"
      : allDone
        ? "done"
        : anyStarted
          ? "in_progress"
          : "not_started";

    let wSum = 0;
    let pSum = 0;
    for (const x of leafs) {
      const w = effortWeight(normalizeEffort(x.effort));
      wSum += w;
      pSum += w * statusScore((((x.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus);
    }

    out[i]._derivedStatus = derivedStatus;
    out[i]._derivedProgress = Math.max(0, Math.min(100, wSum ? Math.round((pSum / wSum) * 100) : 0));
  }
  return out;
}

async function tryCreateArtifactViaEndpoints(body: any): Promise<any> {
  for (const url of ["/api/artifacts", "/api/artifacts/create", "/api/artifacts/new"]) {
    try {
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await safeJson(resp);
      if (resp.status === 404 || resp.status === 405) continue;
      if (!resp.ok || (j as any)?.ok === false) {
        throw new Error(safeStr((j as any)?.error) || `Create failed (${resp.status})`);
      }
      return j;
    } catch (e: any) {
      if (e?.message?.includes("Create failed")) throw e;
    }
  }
  throw new Error("Artifact create failed (no create endpoint accepted POST)");
}

async function syncWbsItems(args: { projectId: string; artifactId: string; rows: any[] }) {
  try {
    const resp = await fetch(`/api/wbs/${encodeURIComponent(args.artifactId)}/sync`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: args.projectId,
        project_id: args.projectId,
        rows: Array.isArray(args.rows) ? args.rows : [],
      }),
    });
    if (!resp.ok) console.warn("[WBS sync] failed", resp.status);
  } catch (e) {
    console.warn("[WBS sync] error", e);
  }
}

type RowsState = { byId: Record<string, WbsRow>; order: string[] };
type RowsAction =
  | { type: "HYDRATE"; rows: WbsRow[] }
  | { type: "UPDATE"; id: string; patch: Partial<WbsRow> }
  | { type: "INSERT_AT"; index: number; row: WbsRow }
  | { type: "REMOVE_SUBTREE"; id: string }
  | { type: "INDENT"; id: string }
  | { type: "OUTDENT"; id: string }
  | { type: "REPLACE_ALL"; rows: WbsRow[] };

function rowsArrayFrom(state: RowsState): WbsRow[] {
  const out: WbsRow[] = [];
  for (const id of state.order) {
    const r = state.byId[id];
    if (r) out.push(r);
  }
  return out;
}

function rowsReducer(state: RowsState, action: RowsAction): RowsState {
  if (action.type === "HYDRATE" || action.type === "REPLACE_ALL") {
    const byId: Record<string, WbsRow> = {};
    const order: string[] = [];
    const rows = Array.isArray(action.rows) ? action.rows : [];
    for (const r of rows) {
      const id = safeStr(r?.id) || uuidish();
      byId[id] = {
        id,
        level: clamp(Number((r as any)?.level ?? 0), 0, 10),
        deliverable: safeStr((r as any)?.deliverable),
        description: safeStr((r as any)?.description),
        acceptance_criteria: safeStr((r as any)?.acceptance_criteria),
        owner: safeStr((r as any)?.owner),
        status: (((r as any)?.status ?? "not_started") as WbsStatus) || "not_started",
        effort: normalizeEffort((r as any)?.effort),
        due_date: safeStr((r as any)?.due_date),
        predecessor: safeStr((r as any)?.predecessor),
        tags: Array.isArray((r as any)?.tags)
          ? (r as any).tags.map((t: any) => safeStr(t)).filter(Boolean)
          : [],
      };
      order.push(id);
    }
    if (!order.length) {
      const nid = uuidish();
      byId[nid] = { id: nid, level: 0, deliverable: "", effort: "", status: "not_started" as WbsStatus };
      order.push(nid);
    }
    return { byId, order };
  }

  if (action.type === "UPDATE") {
    const cur = state.byId[action.id];
    if (!cur) return state;
    return {
      ...state,
      byId: { ...state.byId, [action.id]: { ...cur, ...action.patch, id: cur.id } },
    };
  }

  if (action.type === "INSERT_AT") {
    const row = action.row;
    const id = safeStr(row?.id) || uuidish();
    const safeRow: WbsRow = {
      id,
      level: clamp(Number((row as any)?.level ?? 0), 0, 10),
      deliverable: safeStr((row as any)?.deliverable),
      description: safeStr((row as any)?.description),
      acceptance_criteria: safeStr((row as any)?.acceptance_criteria),
      owner: safeStr((row as any)?.owner),
      status: (((row as any)?.status ?? "not_started") as WbsStatus) || "not_started",
      effort: normalizeEffort((row as any)?.effort),
      due_date: safeStr((row as any)?.due_date),
      predecessor: safeStr((row as any)?.predecessor),
      tags: Array.isArray((row as any)?.tags)
        ? (row as any).tags.map((t: any) => safeStr(t)).filter(Boolean)
        : [],
    };
    const index = clamp(Number(action.index ?? 0), 0, state.order.length);
    const nextOrder = [...state.order];
    nextOrder.splice(index, 0, id);
    return { byId: { ...state.byId, [id]: safeRow }, order: nextOrder };
  }

  if (action.type === "REMOVE_SUBTREE") {
    const rows = rowsArrayFrom(state);
    const idx = rows.findIndex((r) => r.id === action.id);
    if (idx < 0) return state;

    const target = rows[idx];
    let end = idx + 1;
    for (let i = idx + 1; i < rows.length; i++) {
      if (rows[i].level <= target.level) break;
      end = i + 1;
    }

    const idsToRemove = new Set<string>();
    for (let i = idx; i < end; i++) idsToRemove.add(rows[i].id);

    const nextOrder = state.order.filter((x) => !idsToRemove.has(x));
    const nextById: Record<string, WbsRow> = { ...state.byId };
    idsToRemove.forEach((x) => delete nextById[x]);

    if (!nextOrder.length) {
      const nid = uuidish();
      nextById[nid] = {
        id: nid,
        level: 0,
        deliverable: "",
        effort: "",
        status: "not_started" as WbsStatus,
      };
      return { byId: nextById, order: [nid] };
    }

    return { byId: nextById, order: nextOrder };
  }

  if (action.type === "INDENT") {
    const rows = rowsArrayFrom(state);
    const idx = rows.findIndex((r) => r.id === action.id);
    if (idx <= 0) return state;
    const prevRow = rows[idx - 1];
    const cur = rows[idx];
    const nextLevel = clamp(cur.level + 1, 0, (prevRow.level ?? 0) + 1);
    return {
      ...state,
      byId: { ...state.byId, [action.id]: { ...cur, level: nextLevel } },
    };
  }

  if (action.type === "OUTDENT") {
    const cur = state.byId[action.id];
    if (!cur) return state;
    return {
      ...state,
      byId: { ...state.byId, [action.id]: { ...cur, level: clamp(cur.level - 1, 0, 10) } },
    };
  }

  return state;
}

type RolledRow = WbsRow & {
  _derivedStatus?: WbsStatus;
  _derivedProgress?: number;
  _isParent?: boolean;
};

const WbsRowCard = React.memo(function WbsRowCard(props: {
  r: RolledRow;
  isSelected: boolean;
  isCollapsed: boolean;
  detailsOpen: boolean;
  readOnly: boolean;
  autoRollup: boolean;
  statusShown: WbsStatus;
  progressShown: number;
  overdue: boolean;
  effortVal: Effort;
  effortMissing: boolean;
  stripeColor: string;
  onSelect: (id: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleDetails: (id: string) => void;
  onUpdateRow: (id: string, patch: Partial<WbsRow>) => void;
  onEnsureArtifact: () => void;
  renderRowActions: (rowId: string) => React.ReactNode;
}) {
  const {
    r,
    isSelected,
    isCollapsed,
    detailsOpen,
    readOnly,
    autoRollup,
    statusShown,
    progressShown,
    overdue,
    effortVal,
    effortMissing,
    stripeColor,
    onSelect,
    onToggleCollapse,
    onToggleDetails,
    onUpdateRow,
    onEnsureArtifact,
    renderRowActions,
  } = props;

  const isParent = !!r._isParent;
  const cfg = STATUS_CFG[statusShown];

  const cardStyle: React.CSSProperties = {
    background: isSelected ? "#f8faff" : "#ffffff",
    borderRadius: 10,
    border: `1px solid ${isSelected ? "#c7d2fe" : "#e8ecf0"}`,
    borderLeft: `3px solid ${stripeColor}`,
    marginBottom: 6,
    boxShadow: isSelected ? "0 0 0 2px rgba(99,102,241,0.1)" : "none",
    transition: "all 0.1s",
    cursor: "pointer",
  };

  const selStyle = (val: string, isEmpty: boolean): React.CSSProperties => ({
    width: "100%",
    background: isEmpty ? "#fff5f5" : cfg.bg,
    border: `1px solid ${isEmpty ? "#fecaca" : cfg.border}`,
    borderRadius: 8,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 600,
    color: isEmpty ? "#b91c1c" : cfg.text,
    fontFamily: "inherit",
    outline: "none",
    appearance: "none" as const,
    cursor: readOnly ? "default" : "pointer",
  });

  return (
    <div style={cardStyle} onClick={() => onSelect(r.id)}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px 8px" }}>
        <div style={{ width: r.level * 18, flexShrink: 0 }} />
        {isParent ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleCollapse(r.id);
            }}
            style={{
              width: 22,
              height: 22,
              borderRadius: 6,
              border: "1px solid #e8ecf0",
              background: "#f6f8fa",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#57606a",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            {isCollapsed ? <IC.ChevRight /> : <IC.ChevDown />}
          </button>
        ) : (
          <div
            style={{
              width: 22,
              height: 22,
              flexShrink: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: cfg.dot }} />
          </div>
        )}
        <code
          style={{
            fontSize: 11,
            fontFamily: "ui-monospace, monospace",
            color: "#8b949e",
            flexShrink: 0,
            width: 36,
            textAlign: "right",
          }}
        >
          {r.code || "-"}
        </code>
        <input
          value={r.deliverable}
          placeholder={isParent ? "Phase or group" : "Work package"}
          onFocus={() => onEnsureArtifact()}
          onChange={(e) => onUpdateRow(r.id, { deliverable: e.target.value })}
          disabled={!!readOnly}
          onClick={(e) => e.stopPropagation()}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            fontSize: isParent && r.level === 0 ? 14 : 13,
            fontWeight: isParent ? 700 : 500,
            color: "#0d1117",
            fontFamily: "inherit",
            minWidth: 0,
          }}
        />
        <div
          style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}
          onClick={(e) => e.stopPropagation()}
        >
          {overdue && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#b91c1c",
                background: "#fff5f5",
                border: "1px solid #fecaca",
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              Overdue
            </span>
          )}
          {effortMissing && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#b45309",
                background: "#fffbeb",
                border: "1px solid #fde68a",
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              No effort
            </span>
          )}
          {statusShown === "blocked" && !isParent && (
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#b91c1c",
                background: "#fff5f5",
                border: "1px solid #fecaca",
                padding: "2px 6px",
                borderRadius: 6,
              }}
            >
              Blocked
            </span>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDetails(r.id);
            }}
            style={{
              fontSize: 11,
              padding: "4px 8px",
              borderRadius: 6,
              border: "1px solid #e8ecf0",
              background: "#f6f8fa",
              color: "#57606a",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {detailsOpen ? "Hide" : "Details"}
          </button>
          {!readOnly && renderRowActions(r.id)}
        </div>
      </div>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10, padding: "0 12px 10px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <div style={T.lbl}>Status</div>
          <select
            value={statusShown}
            disabled={!!readOnly || (autoRollup && isParent)}
            onChange={(e) => onUpdateRow(r.id, { status: e.target.value as WbsStatus })}
            style={selStyle(statusShown, false)}
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="done">Done</option>
            <option value="blocked">Blocked</option>
          </select>
        </div>
        <div>
          <div style={T.lbl}>Effort</div>
          <select
            value={effortVal}
            disabled={!!readOnly}
            onChange={(e) => onUpdateRow(r.id, { effort: normalizeEffort(e.target.value) })}
            style={selStyle(effortVal, effortMissing)}
          >
            <option value="">-- not set --</option>
            <option value="S">S - Small</option>
            <option value="M">M - Medium</option>
            <option value="L">L - Large</option>
          </select>
        </div>
        <div>
          <div
            style={{
              ...T.lbl,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <span>Progress</span>
            <span style={{ color: "#0d1117", fontWeight: 700, letterSpacing: 0 }}>{progressShown}%</span>
          </div>
          <div style={{ height: 6, background: "#e8ecf0", borderRadius: 999, overflow: "hidden" }}>
            <div
              style={{
                height: "100%",
                width: `${progressShown}%`,
                background: cfg.track,
                borderRadius: 999,
                transition: "width 0.5s ease",
              }}
            />
          </div>
        </div>
        <div>
          <div style={T.lbl}>Due</div>
          <input
            type="date"
            value={r.due_date ?? ""}
            disabled={!!readOnly}
            onFocus={() => onEnsureArtifact()}
            onChange={(e) => onUpdateRow(r.id, { due_date: e.target.value })}
            style={{
              ...T.input,
              background: overdue ? "#fff5f5" : "#f6f8fa",
              borderColor: overdue ? "#fecaca" : "#e8ecf0",
              color: overdue ? "#b91c1c" : "#0d1117",
              width: "100%",
            }}
          />
        </div>
      </div>

      {detailsOpen && (
        <div
          style={{
            borderTop: "1px solid #e8ecf0",
            padding: "14px 12px",
            display: "grid",
            gridTemplateColumns: "1fr 2fr",
            gap: 14,
            background: "#fafbfc",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {[
              { label: "Owner", key: "owner", placeholder: "Assign owner" },
              { label: "Predecessor", key: "predecessor", placeholder: "e.g. 1.2" },
              { label: "Tags", key: "tags", placeholder: "governance, risk..." },
            ].map((f) => (
              <div key={f.key}>
                <div style={T.lbl}>{f.label}</div>
                <input
                  value={f.key === "tags" ? joinTags(r.tags) : safeStr((r as any)[f.key])}
                  disabled={!!readOnly}
                  placeholder={f.placeholder}
                  onFocus={() => onEnsureArtifact()}
                  onChange={(e) =>
                    onUpdateRow(
                      r.id,
                      { [f.key]: f.key === "tags" ? parseTags(e.target.value) : e.target.value } as any
                    )
                  }
                  style={{ ...T.input, width: "100%" }}
                />
              </div>
            ))}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div>
              <div style={T.lbl}>Description</div>
              <textarea
                value={r.description ?? ""}
                disabled={!!readOnly}
                rows={3}
                placeholder="Context, notes, approach..."
                onFocus={() => onEnsureArtifact()}
                onChange={(e) => onUpdateRow(r.id, { description: e.target.value })}
                style={{
                  ...T.input,
                  width: "100%",
                  resize: "vertical",
                  minHeight: 64,
                  lineHeight: 1.5,
                }}
              />
            </div>
            <div>
              <div style={T.lbl}>Acceptance Criteria</div>
              <textarea
                value={r.acceptance_criteria ?? ""}
                disabled={!!readOnly}
                rows={4}
                placeholder={"- Must be measurable\n- Must be testable"}
                onFocus={() => onEnsureArtifact()}
                onChange={(e) => onUpdateRow(r.id, { acceptance_criteria: e.target.value })}
                style={{
                  ...T.input,
                  width: "100%",
                  resize: "vertical",
                  minHeight: 88,
                  lineHeight: 1.5,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default function WBSEditor({
  projectId,
  artifactId,
  initialJson,
  readOnly,
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [docMeta, setDocMeta] = useState(() => {
    const d = normalizeInitial(initialJson);
    return {
      version: 1 as const,
      type: "wbs" as const,
      title: d.title || "Work Breakdown Structure",
      due_date: d.due_date || "",
      auto_rollup: d.auto_rollup !== false,
    };
  });
  const [title, setTitle] = useState<string>(
    () => normalizeInitial(initialJson)?.title || "Work Breakdown Structure"
  );

  const [rowsState, dispatchRows] = useReducer(
    rowsReducer,
    undefined as any,
    () => ({ byId: {}, order: [] } as RowsState)
  );
  useEffect(() => {
    const d = normalizeInitial(initialJson);
    dispatchRows({ type: "HYDRATE", rows: d.rows ?? [] });
  }, []); // eslint-disable-line

  const [msg, setMsg] = useState("");
  const [msgKind, setMsgKind] = useState<"info" | "error" | "success">("info");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState("");
  const [artifactCreateAttempted, setArtifactCreateAttempted] = useState(false);

  const [artifactIdLocal, setArtifactIdLocal] = useState<string>(() => safeStr(artifactId).trim());
  const artifactIdRef = useRef<string>(safeStr(artifactId).trim());

  const [exportingXlsx, setExportingXlsx] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [q, setQ] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState<WbsStatus | "">("");
  const [tagFilter, setTagFilter] = useState("");
  const [dueFrom, setDueFrom] = useState("");
  const [dueTo, setDueTo] = useState("");
  const [onlyOverdue, setOnlyOverdue] = useState(false);
  const [onlyBlocked, setOnlyBlocked] = useState(false);
  const [leavesOnly, setLeavesOnly] = useState(false);
  const [onlyMissingEffort, setOnlyMissingEffort] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState("__all");
  const [myWorkOwner, setMyWorkOwner] = useState("");
  const [aiIssues, setAiIssues] = useState<
    Array<{ severity: "high" | "medium" | "low"; message: string; rowId?: string }>
  >([]);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateSummary, setValidateSummary] = useState("");
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<any | null>(null);

  const lastHydratedRef = useRef("");
  const autosaveTimerRef = useRef<any>(null);
  const autosaveInFlightRef = useRef(false);
  const createPromiseRef = useRef<Promise<string> | null>(null);

  const initialFingerprint = useMemo(() => {
    try {
      return typeof initialJson === "string"
        ? initialJson
        : JSON.stringify(initialJson ?? {});
    } catch {
      return String(initialJson ?? "");
    }
  }, [initialJson]);

  const rowsArr = useMemo(() => rowsArrayFrom(rowsState as RowsState), [rowsState]);
  const coded = useMemo(() => computeCodes(rowsArr ?? []), [rowsArr]);
  const rolled = useMemo(
    () => deriveRollups(coded, docMeta.auto_rollup !== false),
    [coded, docMeta.auto_rollup]
  );
  const selectedRow = useMemo(
    () => coded.find((r) => r.id === selectedRowId) ?? null,
    [coded, selectedRowId]
  );

  function flashMessage(text: string, kind: "info" | "error" | "success" = "info", ttl = 1200) {
    setMsgKind(kind);
    setMsg(text);
    if (ttl > 0) {
      window.setTimeout(() => setMsg(""), ttl);
    }
  }

  useEffect(() => {
    const v = safeStr(artifactId).trim();
    if (v && v !== artifactIdLocal) {
      artifactIdRef.current = v;
      setArtifactIdLocal(v);
    }
  }, [artifactId]); // eslint-disable-line

  useEffect(() => {
    if (dirty) return;
    if (initialFingerprint && initialFingerprint !== lastHydratedRef.current) {
      lastHydratedRef.current = initialFingerprint;
      const next = normalizeInitial(initialJson);
      setDocMeta({
        version: 1,
        type: "wbs",
        title: next.title || "Work Breakdown Structure",
        due_date: next.due_date || "",
        auto_rollup: next.auto_rollup !== false,
      });
      setTitle(next.title || "Work Breakdown Structure");
      dispatchRows({ type: "HYDRATE", rows: next.rows ?? [] });
      setSaveMode("idle");
    }
  }, [initialFingerprint, artifactId, dirty, initialJson]); // eslint-disable-line

  useEffect(() => {
    setSavedViews(loadSavedViews());
    if (typeof window !== "undefined") {
      setMyWorkOwner(safeStr(window.localStorage.getItem(LS_KEY_MYWORK)));
    }
  }, []);

  useEffect(() => {
    if (!openRowId) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenRowId(null);
    }
    function onPtr(e: PointerEvent) {
      if (!(e.target as HTMLElement)?.closest?.("[data-wbs-rowmenu]")) setOpenRowId(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPtr, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPtr, { capture: true } as any);
    };
  }, [openRowId]);

  function markDirty() {
    if (readOnly) return;
    if (!dirty) setDirty(true);
    setSaveMode("dirty");
    void requestCreateArtifactIfNeeded("edit");
  }

  async function requestCreateArtifactIfNeeded(
    _reason: "edit" | "focus" | "autosave"
  ): Promise<void> {
    if (readOnly) return;
    if (artifactIdRef.current) return;

    if (createPromiseRef.current) {
      try {
        await createPromiseRef.current;
      } catch {}
      return;
    }

    const safeProjectId = safeStr(projectId).trim();
    if (!safeProjectId) return;

    setArtifactCreateAttempted(true);

    const p = (async (): Promise<string> => {
      const content = serialize({
        version: 1,
        type: "wbs",
        title: title.trim() || "Work Breakdown Structure",
        due_date: safeStr(docMeta.due_date || ""),
        auto_rollup: docMeta.auto_rollup !== false,
        rows: computeCodes(rowsArr ?? []),
      });
      return await ensureArtifactIdOrCreate(content);
    })();

    createPromiseRef.current = p;
    try {
      const id = await p;
      if (id) {
        try {
          router.refresh();
        } catch {}
      }
    } catch (e) {
      console.warn("WBS auto-create failed:", e);
    } finally {
      createPromiseRef.current = null;
    }
  }

  const updateRow = useCallback(
    (id: string, patch: Partial<WbsRow>) => {
      markDirty();
      dispatchRows({ type: "UPDATE", id, patch });
    },
    [readOnly, dirty]
  ); // eslint-disable-line

  function updateDoc(patch: Partial<WbsDocV1>) {
    markDirty();
    setDocMeta((prev) => ({
      ...prev,
      title: patch.title ?? prev.title,
      due_date: patch.due_date ?? prev.due_date,
      auto_rollup: patch.auto_rollup ?? prev.auto_rollup,
    }));
  }

  function insertAt(index: number, row: WbsRow) {
    markDirty();
    dispatchRows({ type: "INSERT_AT", index, row });
  }

  function addSibling(afterId: string) {
    markDirty();
    const idx = rowsState.order.findIndex((id) => id === afterId);
    if (idx < 0) return;
    const base = rowsState.byId[afterId];
    const next: WbsRow = {
      id: uuidish(),
      level: clamp(Number(base?.level ?? 0), 0, 10),
      deliverable: "",
      description: "",
      acceptance_criteria: "",
      owner: "",
      status: "not_started" as WbsStatus,
      effort: "",
      due_date: "",
      predecessor: "",
      tags: [],
    };
    dispatchRows({ type: "INSERT_AT", index: idx + 1, row: next });
    setExpanded((p) => {
      const n = new Set(p);
      n.add(afterId);
      return n;
    });
  }

  function addChild(parentId: string) {
    markDirty();
    const rows = rowsArr;
    const idx = rows.findIndex((r) => r.id === parentId);
    if (idx < 0) return;
    const parent = rows[idx];
    let insertIndex = idx + 1;
    for (let i = idx + 1; i < rows.length; i++) {
      if (rows[i].level <= parent.level) break;
      insertIndex = i + 1;
    }
    const next: WbsRow = {
      id: uuidish(),
      level: clamp(parent.level + 1, 0, 10),
      deliverable: "",
      description: "",
      acceptance_criteria: "",
      owner: "",
      status: "not_started" as WbsStatus,
      effort: "",
      due_date: "",
      predecessor: "",
      tags: [],
    };
    dispatchRows({ type: "INSERT_AT", index: insertIndex, row: next });
    setCollapsed((prev) => {
      const nextSet = new Set(prev);
      nextSet.delete(parentId);
      return nextSet;
    });
    setExpanded((p) => {
      const n = new Set(p);
      n.add(parentId);
      return n;
    });
  }

  function indent(id: string) {
    markDirty();
    dispatchRows({ type: "INDENT", id });
  }

  function outdent(id: string) {
    markDirty();
    dispatchRows({ type: "OUTDENT", id });
  }

  function removeRow(id: string) {
    markDirty();
    dispatchRows({ type: "REMOVE_SUBTREE", id });
    setCollapsed((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    setExpanded((p) => {
      const n = new Set(p);
      n.delete(id);
      return n;
    });
    if (selectedRowId === id) setSelectedRowId(null);
  }

  function toggleDetails(rowId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function applyCollapseStateToVisible(rowsInOrder: typeof rolled) {
    const out: any[] = [];
    const stack: Array<{ level: number; id: string }> = [];
    for (let i = 0; i < rowsInOrder.length; i++) {
      const r = rowsInOrder[i];
      while (stack.length && r.level <= stack[stack.length - 1].level) stack.pop();
      const parentCollapsed = stack.some((p) => collapsed.has(p.id));
      if (!parentCollapsed) out.push(r);
      if ((r as any)._isParent) stack.push({ level: r.level, id: r.id });
    }
    return out;
  }

  function statusShownForRow(r: any, autoRollup: boolean): WbsStatus {
    const isParent = !!r._isParent;
    const derivedStatus = r._derivedStatus as WbsStatus | undefined;
    if (autoRollup && isParent && derivedStatus) return derivedStatus;
    return (((r.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus;
  }

  function progressShownForRow(r: any, autoRollup: boolean) {
    const dp = r._derivedProgress as number | undefined;
    if (autoRollup && typeof dp === "number") return dp;
    return Math.round(
      statusScore((((r.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus) * 100
    );
  }

  const missingEffortLeafIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of rolled as any[]) {
      if (!r._isParent && isEffortMissing(r.effort)) ids.push(r.id);
    }
    return ids;
  }, [rolled]);

  const missingEffortCount = missingEffortLeafIds.length;

  function rowMatchesSlicers(r: any) {
    const qq = safeLower(q);
    const ownerF = safeLower(ownerFilter);
    const tagF = safeLower(tagFilter);
    const deliverable = safeLower(r.deliverable);
    const desc = safeLower(r.description);
    const ac = safeLower(r.acceptance_criteria);
    const owner = safeLower(r.owner);
    const pred = safeLower(r.predecessor);
    const tags = (r.tags ?? []).map((t: string) => safeLower(t));

    if (qq) {
      const hit =
        deliverable.includes(qq) ||
        desc.includes(qq) ||
        ac.includes(qq) ||
        owner.includes(qq) ||
        pred.includes(qq) ||
        tags.some((t: string) => t.includes(qq)) ||
        safeLower(r.code).includes(qq);
      if (!hit) return false;
    }

    if (ownerF && !safeLower(r.owner).includes(ownerF)) return false;
    if (statusFilter) {
      const shown = statusShownForRow(r, docMeta.auto_rollup !== false);
      if (shown !== statusFilter) return false;
    }
    if (tagF) {
      const hit = tags.some((t: string) => t.includes(tagF)) || deliverable.includes(tagF);
      if (!hit) return false;
    }
    if (onlyOverdue) {
      const rowStatus = statusShownForRow(r, docMeta.auto_rollup !== false);
      if (!isOverdue(r.due_date, rowStatus)) return false;
    }
    if (onlyBlocked) {
      const shown = statusShownForRow(r, docMeta.auto_rollup !== false);
      if (shown !== "blocked") return false;
    }
    if (dueFrom) {
      const d = safeStr(r.due_date);
      if (!d || d < dueFrom) return false;
    }
    if (dueTo) {
      const d = safeStr(r.due_date);
      if (!d || d > dueTo) return false;
    }
    if (leavesOnly && r._isParent) return false;
    if (onlyMissingEffort) {
      if (r._isParent) return false;
      if (!isEffortMissing(r.effort)) return false;
    }
    return true;
  }

  const filtered = useMemo(
    () => rolled.filter(rowMatchesSlicers),
    [
      rolled,
      q,
      ownerFilter,
      statusFilter,
      tagFilter,
      dueFrom,
      dueTo,
      onlyOverdue,
      onlyBlocked,
      leavesOnly,
      onlyMissingEffort,
      docMeta.auto_rollup,
    ]
  ); // eslint-disable-line

  const visibleRows = useMemo(() => applyCollapseStateToVisible(filtered), [filtered, collapsed]); // eslint-disable-line

  async function ensureArtifactIdOrCreate(content: any): Promise<string> {
    const existing = artifactIdRef.current;
    if (existing) return existing;

    const safeProjectId = safeStr(projectId).trim();
    if (!safeProjectId) throw new Error("Missing projectId");

    const body = {
      projectId: safeProjectId,
      project_id: safeProjectId,
      title: (safeStr(title).trim() || "Work Breakdown Structure").trim(),
      type: "wbs",
      artifact_type: "wbs",
      content_json: content,
      contentJson: content,
      content: JSON.stringify(content),
      content_json_string: JSON.stringify(content),
    };

    const j = await tryCreateArtifactViaEndpoints(body);
    const newId =
      safeStr((j as any)?.id) ||
      safeStr((j as any)?.artifact?.id) ||
      safeStr((j as any)?.data?.id) ||
      safeStr((j as any)?.data?.artifact?.id);

    if (!newId) throw new Error("Create succeeded but no artifact id returned");

    artifactIdRef.current = newId;
    setArtifactIdLocal(newId);

    try {
      window.dispatchEvent(
        new CustomEvent("artifact-created", {
          detail: { artifactId: newId, projectId: safeProjectId },
        })
      );
    } catch {}

    try {
      const u = new URL(window.location.href);
      if (!u.searchParams.get("artifactId")) {
        u.searchParams.set("artifactId", newId);
        router.replace(u.pathname + "?" + u.searchParams.toString());
      }
    } catch {}

    try {
      router.refresh();
    } catch {}

    return newId;
  }

  async function saveInternal(opts?: { silent?: boolean }) {
    if (saving || readOnly) return;

    const silent = !!opts?.silent;
    if (!silent) setMsg("");

    if (createPromiseRef.current) {
      try {
        await createPromiseRef.current;
      } catch {}
    }

    const safeProjectId = safeStr(projectId).trim();
    const safeArtifactId = artifactIdRef.current;

    if (!safeProjectId || !safeArtifactId) {
      if (!silent) flashMessage("Missing project or artifact id", "error", 1800);
      setSaveMode("error");
      return;
    }

    setSaving(true);
    setSaveMode("saving");

    try {
      const content = serialize({
        version: 1,
        type: "wbs",
        title: title.trim() || "Work Breakdown Structure",
        due_date: safeStr(docMeta.due_date || ""),
        auto_rollup: docMeta.auto_rollup !== false,
        rows: computeCodes(rowsArr ?? []),
      });

      const resp = await fetch(`/api/artifacts/${safeArtifactId}/content-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: safeProjectId,
          title: title.trim() || "Work Breakdown Structure",
          content_json: content,
        }),
      });

      const json = await resp.json().catch(() => null);
      if (!resp.ok || (json as any)?.ok === false) {
        throw new Error((json as any)?.error || `Save failed (${resp.status})`);
      }

      await syncWbsItems({
        projectId: safeProjectId,
        artifactId: safeArtifactId,
        rows: (content as any)?.rows ?? [],
      });

      setDirty(false);
      setSaveMode("saved");
      setLastSavedAt(new Date().toISOString());

      if (!silent) flashMessage("Saved", "success", 1200);
    } catch (e: any) {
      setSaveMode("error");
      if (!silent) flashMessage(e?.message || "Save failed", "error", 2200);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    try {
      await requestCreateArtifactIfNeeded("focus");
      const eid = artifactIdRef.current;
      if (!eid) throw new Error("Missing artifactId");
      await saveInternal({ silent: false });
    } catch (e: any) {
      setSaveMode("error");
      flashMessage(e?.message || "Unable to create artifact before save", "error", 2200);
    }
  }

  useEffect(() => {
    if (readOnly) return;

    if (!dirty) {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
      return;
    }

    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);

    autosaveTimerRef.current = setTimeout(async () => {
      if (autosaveInFlightRef.current) return;
      autosaveInFlightRef.current = true;
      try {
        await requestCreateArtifactIfNeeded("autosave");
        await saveInternal({ silent: true });
      } finally {
        autosaveInFlightRef.current = false;
      }
    }, 1200);

    return () => {
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
        autosaveTimerRef.current = null;
      }
    };
  }, [dirty, rowsState, title, docMeta.due_date, docMeta.auto_rollup, readOnly]); // eslint-disable-line

  async function exportXlsx() {
    if (exportingXlsx) return;
    setMsg("");
    setExportingXlsx(true);
    try {
      await requestCreateArtifactIfNeeded("focus");
      const eid = artifactIdRef.current;
      if (!eid) throw new Error("Missing artifactId");
      const base = `WBS_${eid.slice(0, 8)}_${todayISO()}`;
      const qs = new URLSearchParams();
      qs.set("projectId", projectId);
      qs.set("artifactId", eid);
      qs.set("filename", base);
      const resp = await fetch(`/api/artifacts/wbs/export/xlsx?${qs.toString()}`, { method: "GET" });
      if (!resp.ok) {
        const j = await safeJson(resp);
        throw new Error(safeStr((j as any)?.error) || `Export failed (${resp.status})`);
      }
      const blob = await resp.blob();
      downloadBlob(blob, pickFilenameFromDisposition(resp.headers.get("content-disposition"), `${base}.xlsx`));
      flashMessage("XLSX downloaded", "success", 1200);
    } catch (e: any) {
      flashMessage(e?.message ?? "Export failed", "error", 2200);
    } finally {
      setExportingXlsx(false);
    }
  }

  async function aiExpand(rowId: string) {
    const base = coded.find((r) => r.id === rowId);
    if (!base) return;

    setMsg("");
    await requestCreateArtifactIfNeeded("focus");
    const eid = artifactIdRef.current;
    if (!eid) {
      flashMessage("Missing artifactId", "error", 1800);
      return;
    }

    startTransition(async () => {
      try {
        const resp = await fetch(`/api/ai/wbs/expand`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            artifactId: eid,
            row: {
              id: base.id,
              level: base.level,
              deliverable: base.deliverable,
              description: base.description,
              acceptance_criteria: base.acceptance_criteria,
              owner: base.owner,
              due_date: base.due_date,
              predecessor: base.predecessor,
              tags: base.tags ?? [],
            },
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error((j as any)?.error || `AI expand failed (${resp.status})`);
        const children = Array.isArray((j as any)?.children) ? ((j as any)?.children as any[]) : [];
        if (children.length === 0) {
          flashMessage("No expansion suggested", "info", 1200);
          return;
        }

        const rows = rowsArr;
        const idx = rows.findIndex((r) => r.id === rowId);
        if (idx < 0) return;

        const baseLevel = rows[idx].level;
        let insertIndex = idx + 1;
        for (let i = idx + 1; i < rows.length; i++) {
          if (rows[i].level <= baseLevel) break;
          insertIndex = i + 1;
        }

        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(rowId);
          return next;
        });

        for (let k = 0; k < children.length; k++) {
          const c = children[k] ?? {};
          insertAt(insertIndex + k, {
            id: uuidish(),
            level: clamp(baseLevel + 1, 0, 10),
            deliverable: safeStr((c as any).deliverable),
            description: safeStr((c as any).description),
            acceptance_criteria: safeStr((c as any).acceptance_criteria),
            owner: safeStr((c as any).owner),
            status: ((((c as any).status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus,
            effort: normalizeEffort((c as any).effort),
            due_date: safeStr((c as any).due_date),
            predecessor: safeStr((c as any).predecessor),
            tags: Array.isArray((c as any).tags)
              ? (c as any).tags.map((t: any) => safeStr(t)).filter(Boolean)
              : [],
          });
        }

        setExpanded((p) => {
          const n = new Set(p);
          n.add(rowId);
          return n;
        });

        flashMessage("AI expanded", "success", 1200);
      } catch (e: any) {
        flashMessage(e?.message ?? "AI expand failed", "error", 2200);
      }
    });
  }

  async function aiValidate() {
    setMsg("");
    setValidateOpen(true);
    setValidateSummary("Validating...");
    await requestCreateArtifactIfNeeded("focus");
    const eid = artifactIdRef.current;
    if (!eid) {
      setValidateSummary("Missing artifactId");
      return;
    }

    startTransition(async () => {
      try {
        const resp = await fetch(`/api/ai/wbs/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            artifactId: eid,
            due_date: docMeta.due_date ?? "",
            rows: computeCodes(rowsArr ?? []),
          }),
        });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error((j as any)?.error || `AI validate failed (${resp.status})`);
        const issues = Array.isArray((j as any)?.issues) ? (j as any).issues : [];
        setAiIssues(
          issues.map((x: any) => ({
            severity: (x?.severity ?? "low") as any,
            message: safeStr(x?.message),
            rowId: safeStr(x?.rowId),
          }))
        );
        const summary = issues.length ? `Found ${issues.length} improvement(s)` : "Looks good — no issues found.";
        setValidateSummary(summary);
        flashMessage(summary, "info", 1200);
      } catch (e: any) {
        setValidateSummary(e?.message ?? "AI validate failed");
      }
    });
  }

  async function generateWbs() {
    setGenOpen(true);
    setGenLoading(true);
    setGeneratedDoc(null);
    await requestCreateArtifactIfNeeded("focus");
    const eid = artifactIdRef.current;
    if (!eid) {
      setGenOpen(false);
      setGenLoading(false);
      return;
    }
    try {
      const resp = await fetch(`/api/ai/wbs/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, artifactId: eid, due_date: docMeta.due_date ?? "" }),
      });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error((j as any)?.error || `Generate failed (${resp.status})`);
      setGeneratedDoc((j as any)?.generated ?? null);
    } catch (e: any) {
      flashMessage(e?.message ?? "Generate failed", "error", 2200);
      setGenOpen(false);
    } finally {
      setGenLoading(false);
    }
  }

  function applyGeneratedDoc() {
    if (!generatedDoc) return;
    const nextRows = Array.isArray((generatedDoc as any)?.rows) ? (generatedDoc as any).rows : [];
    if (!nextRows.length) {
      flashMessage("Generated doc has no rows", "error", 1800);
      return;
    }

    markDirty();

    const normalizedRows: WbsRow[] = nextRows.map((r: any) => ({
      id: safeStr(r?.id) || uuidish(),
      level: clamp(Number(r?.level ?? 0), 0, 10),
      deliverable: safeStr(r?.deliverable),
      description: safeStr(r?.description),
      acceptance_criteria: safeStr(r?.acceptance_criteria),
      owner: safeStr(r?.owner),
      status: ((((r?.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus),
      effort: normalizeEffort(r?.effort),
      due_date: safeStr(r?.due_date),
      predecessor: safeStr(r?.predecessor),
      tags: Array.isArray(r?.tags) ? r.tags.map((t: any) => safeStr(t)).filter(Boolean) : [],
    }));

    dispatchRows({ type: "REPLACE_ALL", rows: normalizedRows });

    const nt = safeStr((generatedDoc as any)?.title) || title;
    setTitle(nt);
    setDocMeta((prev) => ({
      ...prev,
      title: nt,
      due_date: safeStr((generatedDoc as any)?.due_date) || prev.due_date || "",
    }));

    setGenOpen(false);
    flashMessage("Generated WBS applied", "success", 1200);
  }

  const rowMeta = useMemo(() => {
    const idToIndex = new Map<string, number>();
    const idToHasChildren = new Map<string, boolean>();
    for (let i = 0; i < coded.length; i++) idToIndex.set(coded[i].id, i);
    for (let i = 0; i < coded.length; i++) idToHasChildren.set(coded[i].id, rowHasChildren(coded, i));
    return { idToIndex, idToHasChildren };
  }, [coded]);

  function RowActions({ rowId }: { rowId: string }) {
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const open = openRowId === rowId;
    const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
    const idx = rowMeta.idToIndex.get(rowId) ?? -1;
    const hasChildren = rowMeta.idToHasChildren.get(rowId) ?? false;
    const canIndent = !readOnly && idx > 0;
    const canOutdent = !readOnly && idx >= 0 && (coded[idx]?.level ?? 0) > 0;
    const canDelete = !readOnly && !hasChildren;

    function computePosition() {
      const el = btnRef.current;
      if (!el || typeof window === "undefined") return;
      const r = el.getBoundingClientRect();
      const menuW = 220;
      const pad = 12;
      const left = clamp(r.left, pad, window.innerWidth - menuW - pad);
      let top = r.bottom + 6;
      const menuH = menuRef.current?.getBoundingClientRect().height ?? 320;
      if (top + menuH > window.innerHeight - pad) {
        top = clamp(r.top - menuH - 6, pad, window.innerHeight - menuH - pad);
      }
      setPos({ top, left });
    }

    useLayoutEffect(() => {
      if (!open) return;
      computePosition();
      function onR() {
        computePosition();
      }
      window.addEventListener("resize", onR);
      window.addEventListener("scroll", onR, { capture: true });
      return () => {
        window.removeEventListener("resize", onR);
        window.removeEventListener("scroll", onR, { capture: true } as any);
      };
    }, [open, rowId, idx, coded.length]); // eslint-disable-line

    const menuItems = [
      { label: "Add sibling", action: () => addSibling(rowId), disabled: !!readOnly, icon: <IC.UpDown /> },
      { label: "Add child", action: () => addChild(rowId), disabled: !!readOnly, icon: <IC.IndentIn /> },
      null,
      { label: "Indent", action: () => indent(rowId), disabled: !canIndent, icon: <IC.ArrRight /> },
      { label: "Outdent", action: () => outdent(rowId), disabled: !canOutdent, icon: <IC.ArrLeft /> },
      null,
      { label: "AI Expand", action: async () => { await requestCreateArtifactIfNeeded("focus"); aiExpand(rowId); }, disabled: !!readOnly, icon: <IC.Sparkle /> },
      { label: "AI Assistant", action: () => { setSelectedRowId(rowId); setAssistantOpen(true); }, disabled: !!readOnly, icon: <IC.Robot /> },
      null,
      { label: "Delete row", action: () => removeRow(rowId), disabled: !canDelete, danger: true, icon: <IC.Close /> },
    ];

    const menu = open ? (
      <div
        ref={menuRef}
        data-wbs-rowmenu
        style={{
          position: "fixed",
          width: 220,
          borderRadius: 10,
          border: "1px solid #e8ecf0",
          background: "#ffffff",
          boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
          zIndex: 9999,
          padding: "4px 0",
          ...pos,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {menuItems.map((item, i) =>
          item === null ? (
            <div key={`sep-${i}`} style={{ height: 1, background: "#f6f8fa", margin: "3px 12px" }} />
          ) : (
            <button
              key={(item as any).label}
              type="button"
              disabled={(item as any).disabled}
              style={{
                width: "100%",
                textAlign: "left",
                padding: "8px 14px",
                fontSize: 13,
                display: "flex",
                alignItems: "center",
                gap: 10,
                background: "none",
                border: "none",
                cursor: (item as any).disabled ? "default" : "pointer",
                color: (item as any).danger ? "#b91c1c" : "#0d1117",
                opacity: (item as any).disabled ? 0.35 : 1,
                fontFamily: "inherit",
              }}
              onClick={() => {
                setOpenRowId(null);
                (item as any).action();
              }}
            >
              <span
                style={{
                  width: 16,
                  height: 16,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: 0.6,
                }}
              >
                {(item as any).icon}
              </span>
              {(item as any).label}
            </button>
          )
        )}
      </div>
    ) : null;

    return (
      <div data-wbs-rowmenu style={{ display: "inline-flex" }} onClick={(e) => e.stopPropagation()}>
        <button
          ref={btnRef}
          type="button"
          disabled={!!readOnly}
          onClick={async () => {
            await requestCreateArtifactIfNeeded("focus");
            setOpenRowId(open ? null : rowId);
          }}
          style={{
            width: 28,
            height: 28,
            borderRadius: 7,
            border: "1px solid #e8ecf0",
            background: "#f6f8fa",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#57606a",
            cursor: "pointer",
          }}
        >
          <IC.Dots />
        </button>
        {open && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
      </div>
    );
  }

  const overallProgress = useMemo(() => {
    const leaves = (rolled as any[]).filter((r) => !r._isParent);
    if (!leaves.length) return 0;
    let wSum = 0;
    let pSum = 0;
    for (const x of leaves) {
      const w = effortWeight(normalizeEffort(x.effort));
      wSum += w;
      pSum += w * statusScore((((x.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus);
    }
    return wSum ? Math.round((pSum / wSum) * 100) : 0;
  }, [rolled]);

  const totalRows = rolled.length;
  const doneCount = (rolled as any[]).filter(
    (r) => !r._isParent && ((r.status ?? "not_started") as WbsStatus) === "done"
  ).length;
  const blockedCount = (rolled as any[]).filter(
    (r) => statusShownForRow(r, docMeta.auto_rollup !== false) === "blocked"
  ).length;
  const hasActiveFilters = !!(
    q ||
    ownerFilter ||
    statusFilter ||
    tagFilter ||
    dueFrom ||
    dueTo ||
    onlyOverdue ||
    onlyBlocked ||
    leavesOnly ||
    onlyMissingEffort
  );

  const SaveBadge = () => {
    if (
      !readOnly &&
      artifactCreateAttempted &&
      !artifactIdRef.current &&
      (dirty || saveMode === "error")
    ) {
      return (
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            background: "#fff5f5",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontWeight: 600,
          }}
        >
          Missing ID
        </span>
      );
    }

    if (saveMode === "saving") {
      return (
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            background: "#f6f8fa",
            border: "1px solid #e8ecf0",
            color: "#8b949e",
            fontWeight: 600,
          }}
        >
          Saving…
        </span>
      );
    }

    if (saveMode === "dirty") {
      return (
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            background: "#fffbeb",
            border: "1px solid #fde68a",
            color: "#b45309",
            fontWeight: 600,
          }}
        >
          Unsaved
        </span>
      );
    }

    if (saveMode === "saved") {
      return (
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            background: "#f0fdf4",
            border: "1px solid #bbf7d0",
            color: "#15803d",
            fontWeight: 600,
          }}
        >
          Saved{" "}
          {lastSavedAt
            ? new Date(lastSavedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
              })
            : ""}
        </span>
      );
    }

    if (saveMode === "error") {
      return (
        <span
          style={{
            fontSize: 11,
            padding: "3px 8px",
            borderRadius: 6,
            background: "#fff5f5",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            fontWeight: 600,
          }}
        >
          Save error
        </span>
      );
    }

    return null;
  };

  const filterBtnStyle = (active: boolean): React.CSSProperties => ({
    ...T.btn,
    background: active ? "#0d1117" : "#f6f8fa",
    border: `1px solid ${active ? "#0d1117" : "#e8ecf0"}`,
    color: active ? "#ffffff" : "#57606a",
  });

  return (
    <div style={T.page}>
      <header style={T.header}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 9,
            background: "#0d1117",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <rect x="1" y="1" width="4" height="4" rx="1" fill="white" fillOpacity="0.9" />
            <rect x="7" y="1.5" width="8" height="2" rx="0.75" fill="white" fillOpacity="0.5" />
            <rect x="1" y="6.5" width="4" height="4" rx="1" fill="white" fillOpacity="0.7" />
            <rect x="7" y="7" width="8" height="2" rx="0.75" fill="white" fillOpacity="0.5" />
            <rect x="1" y="12" width="4" height="3" rx="1" fill="white" fillOpacity="0.5" />
            <rect x="7" y="12.5" width="6" height="2" rx="0.75" fill="white" fillOpacity="0.5" />
          </svg>
        </div>

        <input
          value={title}
          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
          onChange={(e) => {
            setTitle(e.target.value);
            markDirty();
            setDocMeta((prev) => ({ ...prev, title: e.target.value }));
          }}
          disabled={!!readOnly}
          style={{
            flex: 1,
            fontSize: 16,
            fontWeight: 700,
            color: "#0d1117",
            background: "transparent",
            border: "none",
            outline: "none",
            fontFamily: "inherit",
            minWidth: 0,
          }}
          placeholder="Work Breakdown Structure"
        />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: 12,
              padding: "3px 8px",
              borderRadius: 20,
              background: "#f6f8fa",
              border: "1px solid #e8ecf0",
              color: "#57606a",
              fontWeight: 600,
            }}
          >
            {totalRows} items
          </span>
          <span
            style={{
              fontSize: 12,
              padding: "3px 8px",
              borderRadius: 20,
              background: "#f0fdf4",
              border: "1px solid #bbf7d0",
              color: "#15803d",
              fontWeight: 600,
            }}
          >
            {doneCount} done
          </span>
          {blockedCount > 0 && (
            <span
              style={{
                fontSize: 12,
                padding: "3px 8px",
                borderRadius: 20,
                background: "#fff5f5",
                border: "1px solid #fecaca",
                color: "#b91c1c",
                fontWeight: 600,
              }}
            >
              {blockedCount} blocked
            </span>
          )}
          {missingEffortCount > 0 && (
            <span
              style={{
                fontSize: 12,
                padding: "3px 8px",
                borderRadius: 20,
                background: "#fffbeb",
                border: "1px solid #fde68a",
                color: "#b45309",
                fontWeight: 600,
              }}
            >
              {missingEffortCount} unestimated
            </span>
          )}
        </div>

        <div style={{ width: 1, height: 20, background: "#e8ecf0" }} />

        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <SaveBadge />
          <button onClick={exportXlsx} disabled={exportingXlsx} style={{ ...T.btn, opacity: exportingXlsx ? 0.4 : 1 }}>
            <IC.Download />
            {exportingXlsx ? "…" : "XLSX"}
          </button>
          <button
            onClick={generateWbs}
            disabled={readOnly || genLoading}
            style={{ ...T.btnVio, opacity: readOnly || genLoading ? 0.4 : 1 }}
          >
            <IC.Sparkle />
            {genLoading ? "Generating…" : "AI Generate"}
          </button>
          <button onClick={aiValidate} disabled={readOnly || isPending} style={{ ...T.btn, opacity: readOnly || isPending ? 0.4 : 1 }}>
            Validate
          </button>
          <button
            onClick={async () => {
              await requestCreateArtifactIfNeeded("focus");
              const last = coded?.[coded.length - 1]?.id;
              if (last) addSibling(last);
            }}
            disabled={readOnly || !coded?.length}
            style={{ ...T.btn, opacity: readOnly || !coded?.length ? 0.4 : 1 }}
          >
            + Add item
          </button>
          <button
            onClick={save}
            disabled={readOnly || saving}
            style={{ ...(dirty ? T.btnDark : T.btn), opacity: readOnly || saving ? 0.4 : 1 }}
          >
            {saving ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
      </header>

      <div style={{ height: 3, background: "#e8ecf0", position: "relative", overflow: "hidden" }}>
        <div
          style={{
            height: "100%",
            width: `${overallProgress}%`,
            background: "#0d1117",
            transition: "width 0.7s ease",
          }}
        />
      </div>

      <div
        style={{
          maxWidth: 1600,
          margin: "0 auto",
          padding: "20px 28px 64px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div style={{ ...T.card, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <div style={{ position: "relative", width: 240 }}>
              <svg
                style={{
                  position: "absolute",
                  left: 10,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "#8b949e",
                }}
                width="13"
                height="13"
                viewBox="0 0 13 13"
                fill="none"
              >
                <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4" />
                <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search…"
                style={{ ...T.input, width: "100%", paddingLeft: 30 }}
              />
            </div>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)} style={T.select}>
              <option value="">All statuses</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
              <option value="blocked">Blocked</option>
            </select>

            <input
              value={ownerFilter}
              onChange={(e) => setOwnerFilter(e.target.value)}
              placeholder="Owner"
              style={{ ...T.input, width: 110 }}
            />
            <input
              value={tagFilter}
              onChange={(e) => setTagFilter(e.target.value)}
              placeholder="Tag"
              style={{ ...T.input, width: 90 }}
            />

            {[
              { label: "Overdue", active: onlyOverdue, toggle: () => setOnlyOverdue((v) => !v) },
              { label: "Blocked", active: onlyBlocked, toggle: () => setOnlyBlocked((v) => !v) },
              { label: "Leaves only", active: leavesOnly, toggle: () => setLeavesOnly((v) => !v) },
              {
                label: "No effort",
                active: onlyMissingEffort,
                toggle: () => {
                  setOnlyMissingEffort((v) => !v);
                  setLeavesOnly(true);
                },
              },
            ].map((f) => (
              <button key={f.label} type="button" onClick={f.toggle} style={filterBtnStyle(f.active)}>
                {f.label}
              </button>
            ))}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={() => {
                  setQ("");
                  setOwnerFilter("");
                  setStatusFilter("");
                  setTagFilter("");
                  setDueFrom("");
                  setDueTo("");
                  setOnlyOverdue(false);
                  setOnlyBlocked(false);
                  setLeavesOnly(false);
                  setOnlyMissingEffort(false);
                  setActiveViewId("__all");
                }}
                style={{ ...T.btn, color: "#b91c1c", borderColor: "#fecaca" }}
              >
                Clear filters
              </button>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto", flexWrap: "wrap" }}>
              <select
                value={activeViewId}
                onChange={(e) => {
                  const id = e.target.value;
                  setActiveViewId(id);
                  if (id !== "__all") {
                    const v = savedViews.find((x) => x.id === id);
                    if (v) {
                      setQ(v.state.q ?? "");
                      setOwnerFilter(v.state.ownerFilter ?? "");
                      setStatusFilter((v.state.statusFilter ?? "") as any);
                      setTagFilter(v.state.tagFilter ?? "");
                      setDueFrom(v.state.dueFrom ?? "");
                      setDueTo(v.state.dueTo ?? "");
                      setOnlyOverdue(!!v.state.onlyOverdue);
                      setOnlyBlocked(!!v.state.onlyBlocked);
                      setLeavesOnly(!!v.state.leavesOnly);
                      setOnlyMissingEffort(!!v.state.onlyMissingEffort);
                    }
                  }
                }}
                style={{ ...T.select, maxWidth: 140 }}
              >
                <option value="__all">All rows</option>
                {savedViews.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>

              <button
                onClick={() => {
                  const name = prompt("Save view as:", "My view");
                  if (!name) return;
                  const v: SavedView = {
                    id: uuidish(),
                    name: name.trim().slice(0, 48),
                    state: {
                      q,
                      ownerFilter,
                      statusFilter,
                      tagFilter,
                      dueFrom,
                      dueTo,
                      onlyOverdue,
                      onlyBlocked,
                      leavesOnly,
                      onlyMissingEffort,
                    },
                    createdAt: new Date().toISOString(),
                  };
                  const next = [v, ...savedViews].slice(0, 50);
                  setSavedViews(next);
                  persistSavedViews(next);
                  setActiveViewId(v.id);
                  flashMessage("View saved", "success", 1200);
                }}
                disabled={!!readOnly}
                style={{ ...T.btn, opacity: readOnly ? 0.4 : 1 }}
              >
                Save view
              </button>

              <div style={{ width: 1, height: 16, background: "#e8ecf0" }} />

              <button
                onClick={() => {
                  if (!myWorkOwner.trim()) {
                    flashMessage("Set My Work owner first", "error", 1600);
                    return;
                  }
                  setActiveViewId("__all");
                  setOwnerFilter(myWorkOwner.trim());
                }}
                style={T.btn}
              >
                My Work
              </button>

              <button
                onClick={() => {
                  const v = prompt("Set My Work owner:", myWorkOwner || "");
                  if (v == null) return;
                  const next = v.trim().slice(0, 80);
                  setMyWorkOwner(next);
                  try {
                    window.localStorage.setItem(LS_KEY_MYWORK, next);
                  } catch {}
                  flashMessage("My Work owner set", "success", 1200);
                }}
                style={T.btn}
              >
                Set owner
              </button>

              <div style={{ width: 1, height: 16, background: "#e8ecf0" }} />

              <input
                type="date"
                value={docMeta.due_date ?? ""}
                disabled={!!readOnly}
                onChange={(e) => updateDoc({ due_date: e.target.value } as any)}
                title="Project due date"
                style={{ ...T.input, width: "auto" }}
              />

              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "#57606a",
                  cursor: "pointer",
                }}
              >
                <input
                  type="checkbox"
                  checked={docMeta.auto_rollup !== false}
                  disabled={!!readOnly}
                  onChange={(e) => updateDoc({ auto_rollup: e.target.checked } as any)}
                />
                Roll-up
              </label>

              <span
                style={{
                  fontSize: 11,
                  color: "#8b949e",
                  background: "#f6f8fa",
                  border: "1px solid #e8ecf0",
                  padding: "3px 8px",
                  borderRadius: 6,
                  fontWeight: 600,
                }}
              >
                {visibleRows.length}/{rolled.length}
              </span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid #e8ecf0", paddingTop: 10 }}>
            <span style={{ fontSize: 12, color: "#8b949e", fontWeight: 500 }}>Due between</span>
            <input type="date" value={dueFrom} onChange={(e) => setDueFrom(e.target.value)} style={{ ...T.input, width: "auto" }} />
            <span style={{ color: "#c9d1d9" }}>–</span>
            <input type="date" value={dueTo} onChange={(e) => setDueTo(e.target.value)} style={{ ...T.input, width: "auto" }} />
          </div>
        </div>

        {missingEffortCount > 0 && (
          <div
            style={{
              background: "#fffbeb",
              border: "1px solid #fde68a",
              borderRadius: 12,
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  background: "#fde68a",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  color: "#92400e",
                  flexShrink: 0,
                }}
              >
                {missingEffortCount}
              </div>
              <div>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#0d1117", margin: 0 }}>
                  Work packages missing effort estimate
                </p>
                <p style={{ fontSize: 12, color: "#b45309", margin: "2px 0 0" }}>
                  Roll-ups default to Medium — may skew capacity planning
                </p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                onClick={() => {
                  setOnlyMissingEffort((v) => !v);
                  setLeavesOnly(true);
                  setActiveViewId("__all");
                }}
                style={filterBtnStyle(onlyMissingEffort)}
              >
                {onlyMissingEffort ? "Showing gaps" : "Filter to gaps"}
              </button>
              <button
                onClick={() => {
                  if (!missingEffortLeafIds.length) return;
                  const curIdx = selectedRowId ? missingEffortLeafIds.indexOf(selectedRowId) : -1;
                  const nextId = missingEffortLeafIds[(curIdx + 1 + missingEffortLeafIds.length) % missingEffortLeafIds.length];
                  setSelectedRowId(nextId);
                  setAssistantOpen(true);
                }}
                style={T.btn}
              >
                Jump to next
              </button>
            </div>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 16 }}>
          <div>
            {visibleRows.length === 0 ? (
              <div style={{ ...T.card, padding: "56px 24px", textAlign: "center" }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "#0d1117", margin: "0 0 4px" }}>
                  No matching items
                </p>
                <p style={{ fontSize: 13, color: "#8b949e", margin: 0 }}>
                  {hasActiveFilters ? "Adjust filters or add new entries above" : "Click + Add item to get started"}
                </p>
              </div>
            ) : (
              <VirtualizedWbsList
                items={visibleRows as any[]}
                renderRow={(rAny: any) => {
                  const r = rAny as RolledRow;
                  const isParent = !!r._isParent;
                  const statusShown = statusShownForRow(r, docMeta.auto_rollup !== false);
                  const progressShown = progressShownForRow(r, docMeta.auto_rollup !== false);
                  const effortVal = normalizeEffort(r.effort);
                  const effortMissing = !isParent && effortVal === "";
                  const stripeColor = LEVEL_STRIPE[Math.min(r.level, LEVEL_STRIPE.length - 1)];
                  return (
                    <WbsRowCard
                      key={r.id}
                      r={r}
                      isSelected={selectedRowId === r.id}
                      isCollapsed={collapsed.has(r.id)}
                      detailsOpen={expanded.has(r.id)}
                      readOnly={!!readOnly}
                      autoRollup={docMeta.auto_rollup !== false}
                      statusShown={statusShown}
                      progressShown={progressShown}
                      overdue={isOverdue(r.due_date, statusShown)}
                      effortVal={effortVal}
                      effortMissing={effortMissing}
                      stripeColor={stripeColor}
                      onSelect={(id) => {
                        setSelectedRowId(id);
                        setAssistantOpen(true);
                      }}
                      onToggleCollapse={(id) => {
                        setCollapsed((prev) => {
                          const next = new Set(prev);
                          if (next.has(id)) next.delete(id);
                          else next.add(id);
                          return next;
                        });
                      }}
                      onToggleDetails={(id) => toggleDetails(id)}
                      onUpdateRow={(id, patch) => updateRow(id, patch)}
                      onEnsureArtifact={() => void requestCreateArtifactIfNeeded("focus")}
                      renderRowActions={(rowId) => <RowActions rowId={rowId} />}
                    />
                  );
                }}
              />
            )}
            {readOnly && (
              <p style={{ fontSize: 11, textAlign: "center", color: "#8b949e", padding: "8px 0" }}>
                Read-only mode
              </p>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ ...T.card, overflow: "hidden", position: "sticky", top: 74 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "12px 16px",
                  borderBottom: "1px solid #e8ecf0",
                  background: "#fafbfc",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: 7,
                      background: "#0d1117",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M6 1L7.5 4h3L8 6l1.5 3.5L6 8l-3.5 1.5L4 6 1.5 4h3L6 1z"
                        fill="white"
                        fillOpacity="0.85"
                      />
                    </svg>
                  </div>
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0d1117" }}>AI Assistant</span>
                  {selectedRow && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: "ui-monospace, monospace",
                        color: "#8b949e",
                        background: "#f6f8fa",
                        border: "1px solid #e8ecf0",
                        padding: "2px 6px",
                        borderRadius: 5,
                      }}
                    >
                      {selectedRow.code}
                    </span>
                  )}
                </div>
                <button onClick={() => setAssistantOpen((v) => !v)} style={T.btn}>
                  {assistantOpen ? "Collapse" : "Expand"}
                </button>
              </div>
              <div style={{ padding: 16 }}>
                {!assistantOpen ? (
                  <div style={{ textAlign: "center", padding: "20px 0" }}>
                    <p style={{ fontSize: 12, color: "#8b949e", margin: 0 }}>
                      Select a row to open the assistant
                    </p>
                  </div>
                ) : (
                  <LazyWbsAssistantRail
                    projectId={projectId}
                    readOnly={!!readOnly}
                    selectedRow={selectedRow}
                    onEnsureArtifact={async () => {
                      await requestCreateArtifactIfNeeded("focus");
                      return artifactIdRef.current;
                    }}
                    onUpdateRow={(rowId, patch) => updateRow(rowId, patch)}
                    onAppendDescription={(rowId, block) => {
                      const row = coded.find((x) => x.id === rowId);
                      const existing = safeStr(row?.description);
                      updateRow(rowId, {
                        description: existing ? `${existing}\n\n${block}` : block,
                      });
                    }}
                    onExpandChildren={(rowId) => aiExpand(rowId)}
                    onMessage={(text) => flashMessage(text, "info", 1200)}
                  />
                )}
              </div>
            </div>

            {validateOpen && (
              <div style={{ ...T.card, overflow: "hidden" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid #e8ecf0",
                    background: "#fafbfc",
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 600, color: "#0d1117" }}>Validation Report</span>
                  <button onClick={() => setValidateOpen(false)} style={T.btn}>
                    Close
                  </button>
                </div>
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <p style={{ fontSize: 13, color: "#57606a", margin: 0 }}>{validateSummary}</p>
                  {aiIssues.map((x, i) => (
                    <div
                      key={i}
                      style={{
                        borderRadius: 8,
                        padding: "10px 12px",
                        border: `1px solid ${
                          x.severity === "high"
                            ? "#fecaca"
                            : x.severity === "medium"
                              ? "#fde68a"
                              : "#e8ecf0"
                        }`,
                        background:
                          x.severity === "high"
                            ? "#fff5f5"
                            : x.severity === "medium"
                              ? "#fffbeb"
                              : "#fafbfc",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginBottom: 4,
                        }}
                      >
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            textTransform: "uppercase" as const,
                            letterSpacing: "0.07em",
                            color:
                              x.severity === "high"
                                ? "#b91c1c"
                                : x.severity === "medium"
                                  ? "#b45309"
                                  : "#8b949e",
                          }}
                        >
                          {x.severity}
                        </span>
                        {x.rowId && (
                          <button
                            onClick={() => {
                              setSelectedRowId(x.rowId!);
                              setAssistantOpen(true);
                            }}
                            style={{ ...T.btn, fontSize: 11, padding: "2px 7px" }}
                          >
                            Jump
                          </button>
                        )}
                      </div>
                      <p style={{ fontSize: 12, color: "#57606a", margin: 0, lineHeight: 1.55 }}>
                        {x.message}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {genOpen && (
              <div style={{ ...T.card, overflow: "hidden" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 16px",
                    borderBottom: "1px solid #e8ecf0",
                    background: "#fafbfc",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {genLoading && (
                      <div
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#6366f1",
                          animation: "pulse 1s infinite",
                        }}
                      />
                    )}
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#0d1117" }}>AI Generated WBS</span>
                  </div>
                  <button
                    onClick={() => {
                      setGenOpen(false);
                      setGeneratedDoc(null);
                    }}
                    style={T.btn}
                  >
                    Close
                  </button>
                </div>
                <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
                  <p style={{ fontSize: 13, color: "#57606a", margin: 0 }}>
                    {genLoading
                      ? "Generating your WBS…"
                      : generatedDoc
                        ? "Preview ready. Apply to replace current rows."
                        : "No output yet."}
                  </p>
                  {generatedDoc && (
                    <>
                      <div
                        style={{
                          borderRadius: 8,
                          border: "1px solid #e8ecf0",
                          background: "#f6f8fa",
                          padding: 12,
                          maxHeight: 200,
                          overflowY: "auto",
                        }}
                      >
                        <pre
                          style={{
                            fontSize: 11,
                            color: "#57606a",
                            whiteSpace: "pre-wrap",
                            fontFamily: "ui-monospace, monospace",
                            lineHeight: 1.5,
                            margin: 0,
                          }}
                        >
                          {JSON.stringify(generatedDoc, null, 2)}
                        </pre>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          onClick={applyGeneratedDoc}
                          disabled={!!readOnly}
                          style={{
                            ...T.btnDark,
                            flex: 1,
                            justifyContent: "center",
                            padding: "9px 0",
                            opacity: readOnly ? 0.4 : 1,
                          }}
                        >
                          Apply WBS
                        </button>
                        <button onClick={() => generateWbs()} style={{ ...T.btn, padding: "9px 14px" }}>
                          Retry
                        </button>
                      </div>
                      <p style={{ fontSize: 11, color: "#8b949e", textAlign: "center", margin: 0 }}>
                        This replaces all current rows
                      </p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {!!msg && (
        <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 9999 }}>
          <div
            style={{
              padding: "8px 16px",
              borderRadius: 10,
              background:
                msgKind === "error" ? "#fff5f5" : msgKind === "success" ? "#f0fdf4" : "#ffffff",
              border:
                msgKind === "error"
                  ? "1px solid #fecaca"
                  : msgKind === "success"
                    ? "1px solid #bbf7d0"
                    : "1px solid #e8ecf0",
              boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
              fontSize: 13,
              color:
                msgKind === "error"
                  ? "#b91c1c"
                  : msgKind === "success"
                    ? "#15803d"
                    : "#0d1117",
              fontWeight: 500,
              fontFamily: "inherit",
            }}
          >
            {msg}
          </div>
        </div>
      )}
    </div>
  );
}