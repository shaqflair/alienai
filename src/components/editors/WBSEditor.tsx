// src/components/editors/WBSEditor.tsx
"use client";

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";

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

type AssistantPayload = {
  acceptance_criteria: string;
  risks: string[];
  checklist: string[];
  deliverables: string[];
  raci: Array<{ role: string; suggested: string }>;
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

type SavedView = {
  id: string;
  name: string;
  state: ViewState;
  createdAt: string;
};

const LS_KEY_VIEWS = "wbs_saved_views_v1";
const LS_KEY_MYWORK = "wbs_my_work_owner_v1";

const LazyWbsAssistantRail = dynamic(() => import("./wbs/WbsAssistantRail"), {
  ssr: false,
  loading: () => null,
});

function uuidish() {
  return crypto?.randomUUID?.() ?? `r_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function safeLower(x: any) { return safeStr(x).trim().toLowerCase(); }
function clamp(n: number, min: number, max: number) { return Math.max(min, Math.min(max, n)); }
function todayISO() { return new Date().toISOString().slice(0, 10); }
function safeParseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  const arr = safeParseJson<SavedView[]>(window.localStorage.getItem(LS_KEY_VIEWS));
  if (!Array.isArray(arr)) return [];
  return arr.filter(v => v && typeof v === "object" && typeof (v as any).id === "string" && typeof (v as any).name === "string" && (v as any).state && typeof (v as any).createdAt === "string").slice(0, 50);
}

function persistSavedViews(next: SavedView[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LS_KEY_VIEWS, JSON.stringify(next.slice(0, 50)));
}

const EFFORT_SET = new Set(["S", "M", "L"]);
function normalizeEffort(x: any): Effort {
  const s = safeStr(x).trim().toUpperCase();
  if (EFFORT_SET.has(s)) return s as any;
  return "";
}
function isEffortMissing(e: any) { return !normalizeEffort(e); }

function normalizeInitial(initialJson: any): WbsDocV1 {
  let obj: any = initialJson;
  if (typeof initialJson === "string") { try { obj = JSON.parse(initialJson); } catch { obj = null; } }
  if (obj && typeof obj === "object" && safeLower(obj.type) === "wbs" && Number(obj.version) === 1 && Array.isArray(obj.rows)) {
    return {
      version: 1, type: "wbs",
      title: safeStr(obj.title || "Work Breakdown Structure"),
      due_date: safeStr(obj.due_date || ""),
      auto_rollup: obj.auto_rollup !== false,
      rows: (obj.rows as WbsRow[]).map(r => ({
        id: safeStr(r.id) || uuidish(),
        level: clamp(Number((r as any).level ?? 0), 0, 10),
        deliverable: safeStr((r as any).deliverable),
        description: safeStr((r as any).description),
        acceptance_criteria: safeStr((r as any).acceptance_criteria),
        owner: safeStr((r as any).owner),
        status: (((r as any).status ?? "not_started") as WbsStatus) || "not_started",
        effort: normalizeEffort((r as any).effort),
        due_date: safeStr((r as any).due_date),
        predecessor: safeStr((r as any).predecessor),
        tags: Array.isArray((r as any).tags) ? (r as any).tags.map((t: any) => safeStr(t)).filter(Boolean) : [],
      })),
    };
  }
  return {
    version: 1, type: "wbs", title: "Work Breakdown Structure", due_date: "", auto_rollup: true,
    rows: [
      { id: uuidish(), level: 0, deliverable: "Project Governance & Management", status: "in_progress" as WbsStatus, effort: "M" },
      { id: uuidish(), level: 1, deliverable: "Project Charter", status: "done" as WbsStatus, effort: "S" },
      { id: uuidish(), level: 1, deliverable: "Stakeholder Register", status: "in_progress" as WbsStatus, effort: "S" },
    ],
  };
}

function computeCodes(rows: WbsRow[]): WbsRow[] {
  const counters: number[] = [];
  return rows.map(r => {
    const lvl = clamp(Number(r.level ?? 0), 0, 10);
    counters[lvl] = (counters[lvl] ?? 0) + 1;
    for (let i = lvl + 1; i < counters.length; i++) counters[i] = 0;
    const parts = counters.slice(0, lvl + 1).filter(x => x > 0);
    return { ...r, level: lvl, code: parts.join(".") };
  });
}

function serialize(doc: WbsDocV1): any {
  return {
    version: 1, type: "wbs",
    title: safeStr(doc.title).trim() || "Work Breakdown Structure",
    due_date: safeStr(doc.due_date).trim(),
    auto_rollup: doc.auto_rollup !== false,
    rows: doc.rows.map(r => ({
      id: r.id, level: r.level,
      deliverable: safeStr(r.deliverable),
      description: safeStr(r.description),
      acceptance_criteria: safeStr(r.acceptance_criteria),
      owner: safeStr(r.owner),
      status: ((r.status ?? "not_started") as WbsStatus) || "not_started",
      effort: normalizeEffort(r.effort),
      due_date: safeStr(r.due_date),
      predecessor: safeStr(r.predecessor),
      tags: Array.isArray(r.tags) ? r.tags.map(t => safeStr(t)).filter(Boolean) : [],
    })),
  };
}

function effortWeight(e: Effort | undefined) { if (e === "S") return 1; if (e === "L") return 3; return 2; }
function statusScore(s: WbsStatus | undefined) { if (s === "done") return 1; if (s === "in_progress") return 0.5; if (s === "blocked") return 0; return 0; }
function rowHasChildren(rows: WbsRow[], idx: number) { const cur = rows[idx]; const next = rows[idx + 1]; return !!(cur && next && next.level > cur.level); }
function subtreeRange(rows: WbsRow[], idx: number) { const base = rows[idx]; let end = idx + 1; for (let i = idx + 1; i < rows.length; i++) { if (rows[i].level <= base.level) break; end = i + 1; } return { start: idx, end }; }

function deriveRollups(rows: WbsRow[], autoRollup: boolean): Array<WbsRow & { _derivedStatus?: WbsStatus; _derivedProgress?: number; _isParent?: boolean }> {
  const out = rows.map(r => ({ ...r, _derivedStatus: undefined as any, _derivedProgress: undefined as any, _isParent: false }));
  if (!autoRollup) return out;
  for (let i = out.length - 1; i >= 0; i--) {
    const isParent = rowHasChildren(out, i);
    out[i]._isParent = isParent;
    if (!isParent) { out[i]._derivedStatus = ((out[i].status ?? "not_started") as WbsStatus) || "not_started"; out[i]._derivedProgress = Math.round(statusScore(out[i]._derivedStatus) * 100); continue; }
    const { start, end } = subtreeRange(out, i);
    const leafs: any[] = [];
    for (let j = start + 1; j < end; j++) { if (!rowHasChildren(out, j)) leafs.push(out[j]); }
    if (leafs.length === 0) { out[i]._derivedStatus = ((out[i].status ?? "not_started") as WbsStatus) || "not_started"; out[i]._derivedProgress = Math.round(statusScore(out[i]._derivedStatus) * 100); continue; }
    const anyBlocked = leafs.some(x => ((x.status ?? "not_started") as WbsStatus) === "blocked");
    const allDone = leafs.every(x => ((x.status ?? "not_started") as WbsStatus) === "done");
    const anyStarted = leafs.some(x => { const s = ((x.status ?? "not_started") as WbsStatus) || "not_started"; return s === "in_progress" || s === "done"; });
    const derivedStatus: WbsStatus = anyBlocked ? "blocked" : allDone ? "done" : anyStarted ? "in_progress" : "not_started";
    let wSum = 0, pSum = 0;
    for (const x of leafs) { const w = effortWeight(normalizeEffort(x.effort)); wSum += w; pSum += w * statusScore(((x.status ?? "not_started") as WbsStatus) || "not_started"); }
    out[i]._derivedStatus = derivedStatus;
    out[i]._derivedProgress = Math.max(0, Math.min(100, wSum ? Math.round((pSum / wSum) * 100) : 0));
  }
  return out;
}

function parseTags(s: string): string[] { return s.split(",").map(x => x.trim()).filter(Boolean).slice(0, 12); }
function joinTags(tags?: string[]) { return (tags ?? []).filter(Boolean).join(", "); }

function isOverdue(rowDue: string | undefined, status?: WbsStatus) {
  if (status === "done") return false;
  const d = safeStr(rowDue);
  if (!d) return false;
  return d < todayISO();
}

async function safeJson(res: Response) { try { return await res.json(); } catch { return {}; } }

function pickFilenameFromDisposition(disposition: string | null, fallback: string) {
  const d = disposition || "";
  const m1 = d.match(/filename\*=\s*UTF-8''([^;]+)/i);
  if (m1?.[1]) return decodeURIComponent(m1[1].replace(/(^"|"$)/g, ""));
  const m2 = d.match(/filename\s*=\s*"?([^"]+)"?/i);
  if (m2?.[1]) return m2[1].trim();
  return fallback;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

const DEFAULT_VIEW_STATE: ViewState = { q: "", ownerFilter: "", statusFilter: "", tagFilter: "", dueFrom: "", dueTo: "", onlyOverdue: false, onlyBlocked: false, leavesOnly: false, onlyMissingEffort: false };

type SaveMode = "idle" | "dirty" | "saving" | "saved" | "error";

// ─── STATUS CONFIG ────────────────────────────────────────────────────────────
const STATUS_CONFIG: Record<WbsStatus, {
  label: string;
  dot: string;
  badge: string;
  ring: string;
  selectCls: string;
  trackCls: string;
}> = {
  not_started: {
    label: "Not started",
    dot: "bg-stone-400",
    badge: "bg-stone-100 text-stone-600 ring-stone-200",
    ring: "ring-stone-200",
    selectCls: "bg-stone-50 border-stone-200 text-stone-700",
    trackCls: "bg-stone-200",
  },
  in_progress: {
    label: "In progress",
    dot: "bg-amber-400",
    badge: "bg-amber-50 text-amber-800 ring-amber-200",
    ring: "ring-amber-200",
    selectCls: "bg-amber-50 border-amber-300 text-amber-900",
    trackCls: "bg-amber-400",
  },
  done: {
    label: "Done",
    dot: "bg-teal-500",
    badge: "bg-teal-50 text-teal-800 ring-teal-200",
    ring: "ring-teal-200",
    selectCls: "bg-teal-50 border-teal-200 text-teal-900",
    trackCls: "bg-teal-500",
  },
  blocked: {
    label: "Blocked",
    dot: "bg-rose-500",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    ring: "ring-rose-200",
    selectCls: "bg-rose-50 border-rose-200 text-rose-800",
    trackCls: "bg-rose-500",
  },
};

// ─── LEVEL ACCENT PALETTE — left border stripe per depth ──────────────────────
// Deeper = softer. Level 0 is the boldest.
const LEVEL_STRIPE = [
  "border-l-slate-800",   // 0 — near-black, strong authority
  "border-l-indigo-400",  // 1 — indigo
  "border-l-sky-400",     // 2 — sky
  "border-l-teal-400",    // 3 — teal
  "border-l-amber-400",   // 4 — amber
  "border-l-rose-300",    // 5 — rose
];

const LEVEL_BG = [
  "bg-slate-50",   // level-0 parent has a very subtle tint
  "bg-white",
  "bg-white",
  "bg-white",
  "bg-white",
  "bg-white",
];

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

  const [doc, setDoc] = useState<WbsDocV1>(() => normalizeInitial(initialJson));
  const [title, setTitle] = useState<string>(() => normalizeInitial(initialJson)?.title || "Work Breakdown Structure");
  const [msg, setMsg] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string>("");

  const lastHydratedRef = useRef<string>("");
  const initialFingerprint = useMemo(() => { try { return typeof initialJson === "string" ? initialJson : JSON.stringify(initialJson ?? {}); } catch { return String(initialJson ?? ""); } }, [initialJson]);

  const [artifactIdLocal, setArtifactIdLocal] = useState<string>(() => safeStr(artifactId).trim());
  useEffect(() => { const v = safeStr(artifactId).trim(); if (v && v !== artifactIdLocal) setArtifactIdLocal(v); }, [artifactId]);

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
  const [filterOpen, setFilterOpen] = useState(false);

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState<string>("__all");
  const [myWorkOwner, setMyWorkOwner] = useState<string>("");

  const [aiIssues, setAiIssues] = useState<Array<{ severity: "high" | "medium" | "low"; message: string; rowId?: string }>>([]);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateSummary, setValidateSummary] = useState<string>("");

  const [assistantOpen, setAssistantOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<any | null>(null);

  const autosaveTimerRef = useRef<any>(null);
  const autosaveInFlightRef = useRef(false);
  const createInFlightRef = useRef(false);

  useEffect(() => {
    if (dirty) return;
    if (initialFingerprint && initialFingerprint !== lastHydratedRef.current) {
      lastHydratedRef.current = initialFingerprint;
      const next = normalizeInitial(initialJson);
      setDoc(next); setTitle(next.title || "Work Breakdown Structure"); setSaveMode("idle");
    }
  }, [initialFingerprint, artifactId, dirty, initialJson]);

  useEffect(() => {
    setSavedViews(loadSavedViews());
    if (typeof window !== "undefined") setMyWorkOwner(safeStr(window.localStorage.getItem(LS_KEY_MYWORK)));
  }, []);

  const coded = useMemo(() => computeCodes(doc.rows ?? []), [doc.rows]);
  const rolled = useMemo(() => deriveRollups(coded, doc.auto_rollup !== false), [coded, doc.auto_rollup]);
  const selectedRow = useMemo(() => coded.find(r => r.id === selectedRowId) ?? null, [coded, selectedRowId]);

  useEffect(() => {
    if (readOnly) return;
    if (artifactIdLocal) return;
    const t = setTimeout(() => { void requestCreateArtifactIfNeeded("focus"); }, 50);
    return () => clearTimeout(t);
  }, [readOnly, artifactIdLocal]);

  useEffect(() => {
    if (!openRowId) return;
    function onKeyDown(e: KeyboardEvent) { if (e.key === "Escape") setOpenRowId(null); }
    function onPointerDown(e: PointerEvent) { const el = e.target as HTMLElement | null; if (!el) return; if (el.closest?.("[data-wbs-rowmenu]")) return; setOpenRowId(null); }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, { capture: true });
    return () => { window.removeEventListener("keydown", onKeyDown); window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any); };
  }, [openRowId]);

  function markDirty() { if (!dirty) setDirty(true); setSaveMode("dirty"); void requestCreateArtifactIfNeeded("edit"); }

  async function requestCreateArtifactIfNeeded(_reason: "edit" | "focus" | "autosave") {
    if (readOnly || artifactIdLocal || createInFlightRef.current) return;
    const safeProjectId = safeStr(projectId).trim();
    if (!safeProjectId) return;
    createInFlightRef.current = true;
    try {
      const content = serialize({ ...doc, title: title.trim() || "Work Breakdown Structure", rows: computeCodes(doc.rows ?? []) });
      const id = await ensureArtifactIdOrCreate(content);
      if (id) { try { router.refresh(); } catch {} }
    } catch (e) { console.warn("WBS auto-create failed:", e); } finally { createInFlightRef.current = false; }
  }

  function updateRow(id: string, patch: Partial<WbsRow>) { markDirty(); setDoc(prev => ({ ...prev, rows: (prev.rows ?? []).map(r => r.id === id ? { ...r, ...patch } : r) })); }
  function updateDoc(patch: Partial<WbsDocV1>) { markDirty(); setDoc(prev => ({ ...prev, ...patch })); }

  function insertAt(index: number, row: WbsRow) { markDirty(); setDoc(prev => { const out = [...prev.rows]; out.splice(index, 0, row); return { ...prev, rows: out as WbsRow[] }; }); }

  function addSibling(afterId: string) {
    markDirty();
    setDoc(prev => {
      const idx = prev.rows.findIndex(r => r.id === afterId); if (idx < 0) return prev;
      const base = prev.rows[idx];
      const next: WbsRow = { id: uuidish(), level: base.level, deliverable: "", description: "", acceptance_criteria: "", owner: "", status: "not_started" as WbsStatus, effort: "", due_date: "", predecessor: "", tags: [] };
      const out = [...prev.rows]; out.splice(idx + 1, 0, next); return { ...prev, rows: out as WbsRow[] };
    });
    setExpanded(p => { const n = new Set(p); n.add(afterId); return n; });
  }

  function addChild(parentId: string) {
    markDirty();
    setDoc(prev => {
      const idx = prev.rows.findIndex(r => r.id === parentId); if (idx < 0) return prev;
      const parent = prev.rows[idx]; let insertIndex = idx + 1;
      for (let i = idx + 1; i < prev.rows.length; i++) { if (prev.rows[i].level <= parent.level) break; insertIndex = i + 1; }
      const next: WbsRow = { id: uuidish(), level: clamp(parent.level + 1, 0, 10), deliverable: "", description: "", acceptance_criteria: "", owner: "", status: "not_started" as WbsStatus, effort: "", due_date: "", predecessor: "", tags: [] };
      const out = [...prev.rows]; out.splice(insertIndex, 0, next); return { ...prev, rows: out as WbsRow[] };
    });
    setCollapsed(prev => { const next = new Set(prev); next.delete(parentId); return next; });
    setExpanded(p => { const n = new Set(p); n.add(parentId); return n; });
  }

  function indent(id: string) { markDirty(); setDoc(prev => { const idx = prev.rows.findIndex(r => r.id === id); if (idx <= 0) return prev; const prevRow = prev.rows[idx - 1]; const cur = prev.rows[idx]; const nextLevel = clamp(cur.level + 1, 0, (prevRow.level ?? 0) + 1); const out = [...prev.rows]; out[idx] = { ...cur, level: nextLevel }; return { ...prev, rows: out as WbsRow[] }; }); }
  function outdent(id: string) { markDirty(); setDoc(prev => { const idx = prev.rows.findIndex(r => r.id === id); if (idx < 0) return prev; const cur = prev.rows[idx]; const out = [...prev.rows]; out[idx] = { ...cur, level: clamp(cur.level - 1, 0, 10) }; return { ...prev, rows: out as WbsRow[] }; }); }

  function removeRow(id: string) {
    markDirty();
    setDoc(prev => {
      const idx = prev.rows.findIndex(r => r.id === id); if (idx < 0) return prev;
      const target = prev.rows[idx]; let end = idx + 1;
      for (let i = idx + 1; i < prev.rows.length; i++) { if (prev.rows[i].level <= target.level) break; end = i + 1; }
      const out = [...prev.rows]; out.splice(idx, end - idx);
      const nextRows = (out.length ? out : [{ id: uuidish(), level: 0, deliverable: "", effort: "", status: "not_started" as WbsStatus }]) as WbsRow[];
      return { ...prev, rows: nextRows };
    });
    setCollapsed(prev => { const next = new Set(prev); next.delete(id); return next; });
    setExpanded(prev => { const next = new Set(prev); next.delete(id); return next; });
    if (selectedRowId === id) setSelectedRowId(null);
  }

  function toggleCollapse(rowId: string) { setCollapsed(prev => { const next = new Set(prev); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); return next; }); }

  function applyCollapseStateToVisible(rowsInOrder: typeof rolled) {
    const out: any[] = [];
    const stack: Array<{ level: number; id: string }> = [];
    for (let i = 0; i < rowsInOrder.length; i++) {
      const r = rowsInOrder[i];
      while (stack.length && r.level <= stack[stack.length - 1].level) stack.pop();
      const parentCollapsed = stack.some(p => collapsed.has(p.id));
      if (!parentCollapsed) out.push(r);
      if ((r as any)._isParent) stack.push({ level: r.level, id: r.id });
    }
    return out;
  }

  function statusShownForRow(r: any, autoRollup: boolean): WbsStatus {
    const isParent = !!(r as any)._isParent;
    const derivedStatus = (r as any)._derivedStatus as WbsStatus | undefined;
    if (autoRollup && isParent && derivedStatus) return derivedStatus;
    return (((r.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus;
  }

  function progressShownForRow(r: any, autoRollup: boolean) {
    const derivedProgress = (r as any)._derivedProgress as number | undefined;
    if (autoRollup && typeof derivedProgress === "number") return derivedProgress;
    return Math.round(statusScore(((r.status ?? "not_started") as WbsStatus) || "not_started") * 100);
  }

  const missingEffortLeafIds = useMemo(() => {
    const ids: string[] = [];
    for (const r of rolled as any[]) { if (!r._isParent && isEffortMissing(r.effort)) ids.push(r.id); }
    return ids;
  }, [rolled]);
  const missingEffortCount = missingEffortLeafIds.length;

  function jumpToNextEffortGap() {
    if (!missingEffortLeafIds.length) return;
    const curIdx = selectedRowId ? missingEffortLeafIds.indexOf(selectedRowId) : -1;
    const nextId = missingEffortLeafIds[(curIdx + 1 + missingEffortLeafIds.length) % missingEffortLeafIds.length];
    setSelectedRowId(nextId); setAssistantOpen(true);
    setExpanded(prev => { const next = new Set(prev); next.add(nextId); return next; });
    setMsg("⚠️ Next effort gap selected");
    setTimeout(() => setMsg(""), 1200);
  }

  function rowMatchesSlicers(r: any) {
    const qq = safeLower(q), ownerF = safeLower(ownerFilter), tagF = safeLower(tagFilter);
    const deliverable = safeLower(r.deliverable), desc = safeLower(r.description), ac = safeLower(r.acceptance_criteria), owner = safeLower(r.owner), pred = safeLower(r.predecessor), tags = (r.tags ?? []).map((t: string) => safeLower(t));
    if (qq) { const hit = deliverable.includes(qq) || desc.includes(qq) || ac.includes(qq) || owner.includes(qq) || pred.includes(qq) || tags.some((t: string) => t.includes(qq)) || safeLower(r.code).includes(qq); if (!hit) return false; }
    if (ownerF && !safeLower(r.owner).includes(ownerF)) return false;
    if (statusFilter) { const shown = statusShownForRow(r, doc.auto_rollup !== false); if (shown !== statusFilter) return false; }
    if (tagF) { const hit = tags.some((t: string) => t.includes(tagF)) || deliverable.includes(tagF) || safeLower(r.predecessor).includes(tagF); if (!hit) return false; }
    if (onlyOverdue) { const rowStatus = statusShownForRow(r, doc.auto_rollup !== false); if (!isOverdue(r.due_date, rowStatus)) return false; }
    if (onlyBlocked) { const shown = statusShownForRow(r, doc.auto_rollup !== false); if (shown !== "blocked") return false; }
    if (dueFrom) { const d = safeStr(r.due_date); if (!d || d < dueFrom) return false; }
    if (dueTo) { const d = safeStr(r.due_date); if (!d || d > dueTo) return false; }
    if (leavesOnly && (r as any)._isParent) return false;
    if (onlyMissingEffort) { if ((r as any)._isParent) return false; if (!isEffortMissing(r.effort)) return false; }
    return true;
  }

  const filtered = useMemo(() => rolled.filter(rowMatchesSlicers), [rolled, q, ownerFilter, statusFilter, tagFilter, dueFrom, dueTo, onlyOverdue, onlyBlocked, leavesOnly, onlyMissingEffort, doc.auto_rollup]);
  const visibleRows = useMemo(() => applyCollapseStateToVisible(filtered), [filtered, collapsed]);

  async function ensureArtifactIdOrCreate(content: any): Promise<string> {
    const existing = safeStr(artifactIdLocal).trim();
    if (existing) return existing;
    const safeProjectId = safeStr(projectId).trim();
    if (!safeProjectId) throw new Error("Missing projectId (cannot create artifact)");
    const body = { projectId: safeProjectId, project_id: safeProjectId, title: (safeStr(title).trim() || "Work Breakdown Structure").trim(), type: "wbs", artifact_type: "wbs", content_json: content, contentJson: content, content: JSON.stringify(content), content_json_string: JSON.stringify(content) };
    const resp = await fetch(`/api/artifacts`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await safeJson(resp);
    if (!resp.ok) throw new Error(safeStr(j?.error) || safeStr(j?.message) || safeStr(j?.details) || `Create failed (${resp.status})`);
    const newId = safeStr(j?.id) || safeStr(j?.artifact?.id) || safeStr(j?.data?.id) || safeStr(j?.data?.artifact?.id);
    if (!newId) throw new Error("Create succeeded but no artifact id returned");
    setArtifactIdLocal(newId);
    try { window.dispatchEvent(new CustomEvent("artifact-created", { detail: { artifactId: newId, projectId: safeProjectId } })); } catch {}
    try { const u = new URL(window.location.href); if (!u.searchParams.get("artifactId")) { u.searchParams.set("artifactId", newId); router.replace(u.pathname + "?" + u.searchParams.toString()); } } catch {}
    try { router.refresh(); } catch {}
    return newId;
  }

  async function saveInternal(opts?: { silent?: boolean }) {
    if (saving || readOnly) return;
    const silent = !!opts?.silent;
    setMsg("");
    const safeProjectId = safeStr(projectId).trim();
    const safeArtifactId = safeStr(artifactIdLocal).trim();
    if (!safeProjectId || !safeArtifactId) { if (!silent) setMsg("⛔ Missing project or artifact id"); setSaveMode("error"); return; }
    setSaving(true); setSaveMode("saving");
    try {
      const content = serialize({ ...doc, title: title.trim() || "Work Breakdown Structure", rows: computeCodes(doc.rows ?? []) });
      const resp = await fetch(`/api/artifacts/${safeArtifactId}/content-json`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId: safeProjectId, title: title.trim() || "Work Breakdown Structure", content_json: content }) });
      const json = await resp.json().catch(() => null);
      if (!resp.ok || json?.ok === false) throw new Error(json?.error || json?.message || `Save failed (${resp.status})`);
      setDirty(false); setSaveMode("saved"); setLastSavedAt(new Date().toISOString());
      if (!silent) { setMsg("✅ Saved"); setTimeout(() => setMsg(""), 1200); }
    } catch (e: any) { setSaveMode("error"); if (!silent) setMsg(`⛔ ${e?.message || "Save failed"}`); } finally { setSaving(false); }
  }

  async function save() { await saveInternal({ silent: false }); }

  useEffect(() => {
    if (readOnly) return;
    if (!dirty) { if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; } return; }
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current);
    autosaveTimerRef.current = setTimeout(async () => {
      if (autosaveInFlightRef.current) return;
      autosaveInFlightRef.current = true;
      try { await requestCreateArtifactIfNeeded("autosave"); await saveInternal({ silent: true }); } finally { autosaveInFlightRef.current = false; }
    }, 1200);
    return () => { if (autosaveTimerRef.current) { clearTimeout(autosaveTimerRef.current); autosaveTimerRef.current = null; } };
  }, [dirty, doc, title, readOnly]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    function onBeforeUnload() {
      try {
        if (!dirty) return;
        const aid = safeStr(artifactIdLocal).trim(); if (!aid) return;
        const safeProjectId = safeStr(projectId).trim(); if (!safeProjectId) return;
        const content = serialize({ ...doc, title: title.trim() || "Work Breakdown Structure", rows: computeCodes(doc.rows ?? []) });
        const payload = JSON.stringify({ artifactId: aid, artifact_id: aid, projectId: safeProjectId, project_id: safeProjectId, title: title.trim() || "Work Breakdown Structure", content_json: content, contentJson: content, content: JSON.stringify(content), content_json_string: JSON.stringify(content) });
        (navigator as any).sendBeacon?.(`/api/artifacts/${aid}/content-json`, new Blob([payload], { type: "application/json" }));
      } catch {}
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty, artifactIdLocal, projectId, doc, title]);

  async function exportXlsx() {
    if (exportingXlsx) return;
    setMsg(""); setExportingXlsx(true);
    try {
      await requestCreateArtifactIfNeeded("focus");
      const effectiveArtifactId = safeStr(artifactIdLocal).trim();
      if (!effectiveArtifactId) throw new Error("Missing artifactId");
      const base = `WBS_${effectiveArtifactId.slice(0, 8)}_${todayISO()}`;
      const qs = new URLSearchParams();
      qs.set("projectId", projectId); qs.set("artifactId", effectiveArtifactId); qs.set("filename", base);
      const resp = await fetch(`/api/artifacts/wbs/export/xlsx?${qs.toString()}`, { method: "GET" });
      if (!resp.ok) { const j = await safeJson(resp); throw new Error(safeStr(j?.error) || `Export failed (${resp.status})`); }
      const blob = await resp.blob();
      downloadBlob(blob, pickFilenameFromDisposition(resp.headers.get("content-disposition"), `${base}.xlsx`));
      setMsg("✅ XLSX downloaded"); setTimeout(() => setMsg(""), 1200);
    } catch (e: any) { setMsg(`⛔ ${e?.message ?? "Export failed"}`); } finally { setExportingXlsx(false); }
  }

  async function aiExpand(rowId: string) {
    const base = coded.find(r => r.id === rowId); if (!base) return;
    setMsg(""); await requestCreateArtifactIfNeeded("focus");
    const effectiveArtifactId = safeStr(artifactIdLocal).trim();
    if (!effectiveArtifactId) { setMsg("⛔ Missing artifactId"); setTimeout(() => setMsg(""), 1200); return; }
    startTransition(async () => {
      try {
        const resp = await fetch(`/api/ai/wbs/expand`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, artifactId: effectiveArtifactId, row: { id: base.id, level: base.level, deliverable: base.deliverable, description: base.description, acceptance_criteria: base.acceptance_criteria, owner: base.owner, due_date: base.due_date, predecessor: base.predecessor, tags: base.tags ?? [] } }) });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j?.error || `AI expand failed (${resp.status})`);
        const children = Array.isArray(j?.children) ? (j.children as any[]) : [];
        if (children.length === 0) { setMsg("ℹ️ No expansion suggested"); setTimeout(() => setMsg(""), 1200); return; }
        const idx = doc.rows.findIndex(r => r.id === rowId); if (idx < 0) return;
        const baseLevel = doc.rows[idx].level;
        let insertIndex = idx + 1;
        for (let i = idx + 1; i < doc.rows.length; i++) { if (doc.rows[i].level <= baseLevel) break; insertIndex = i + 1; }
        setCollapsed(prev => { const next = new Set(prev); next.delete(rowId); return next; });
        for (let k = 0; k < children.length; k++) {
          const c = children[k] ?? {};
          insertAt(insertIndex + k, { id: uuidish(), level: clamp(baseLevel + 1, 0, 10), deliverable: safeStr(c.deliverable), description: safeStr(c.description), acceptance_criteria: safeStr(c.acceptance_criteria), owner: safeStr(c.owner), status: (((c.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus, effort: normalizeEffort(c.effort), due_date: safeStr(c.due_date), predecessor: safeStr(c.predecessor), tags: Array.isArray(c.tags) ? c.tags.map((t: any) => safeStr(t)).filter(Boolean) : [] });
        }
        setExpanded(p => { const n = new Set(p); n.add(rowId); return n; });
        setMsg("✅ AI expanded"); setTimeout(() => setMsg(""), 1200);
      } catch (e: any) { setMsg(`⛔ ${e?.message ?? "AI expand failed"}`); }
    });
  }

  async function aiValidate() {
    setMsg(""); setValidateOpen(true); setValidateSummary("Validating…");
    await requestCreateArtifactIfNeeded("focus");
    const effectiveArtifactId = safeStr(artifactIdLocal).trim();
    if (!effectiveArtifactId) { setValidateSummary("⛔ Missing artifactId"); setMsg("⛔ Missing artifactId"); setTimeout(() => setMsg(""), 1200); return; }
    startTransition(async () => {
      try {
        const resp = await fetch(`/api/ai/wbs/validate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, artifactId: effectiveArtifactId, due_date: doc.due_date ?? "", rows: computeCodes(doc.rows ?? []) }) });
        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j?.error || `AI validate failed (${resp.status})`);
        const issues = Array.isArray(j?.issues) ? j.issues : [];
        setAiIssues(issues.map((x: any) => ({ severity: (x?.severity ?? "low") as any, message: safeStr(x?.message), rowId: safeStr(x?.rowId) })));
        const summary = issues.length ? `Found ${issues.length} improvement(s)` : "Looks good — no issues found.";
        setValidateSummary(summary); setMsg(`✅ ${summary}`); setTimeout(() => setMsg(""), 1200);
      } catch (e: any) { setValidateSummary(`⛔ ${e?.message ?? "AI validate failed"}`); setMsg(`⛔ ${e?.message ?? "AI validate failed"}`); }
    });
  }

  async function generateWbs() {
    setGenOpen(true); setGenLoading(true); setGeneratedDoc(null);
    await requestCreateArtifactIfNeeded("focus");
    const effectiveArtifactId = safeStr(artifactIdLocal).trim();
    if (!effectiveArtifactId) { setMsg("⛔ Missing artifactId"); setTimeout(() => setMsg(""), 1200); setGenOpen(false); setGenLoading(false); return; }
    try {
      const resp = await fetch(`/api/ai/wbs/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, artifactId: effectiveArtifactId, due_date: doc.due_date ?? "" }) });
      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error || `Generate failed (${resp.status})`);
      setGeneratedDoc(j?.generated ?? null);
    } catch (e: any) { setMsg(`⛔ ${e?.message ?? "Generate failed"}`); setTimeout(() => setMsg(""), 1200); setGenOpen(false); } finally { setGenLoading(false); }
  }

  function getCurrentViewState(): ViewState { return { q, ownerFilter, statusFilter, tagFilter, dueFrom, dueTo, onlyOverdue, onlyBlocked, leavesOnly, onlyMissingEffort }; }
  function applyViewState(state: ViewState) { setQ(state.q ?? ""); setOwnerFilter(state.ownerFilter ?? ""); setStatusFilter((state.statusFilter ?? "") as any); setTagFilter(state.tagFilter ?? ""); setDueFrom(state.dueFrom ?? ""); setDueTo(state.dueTo ?? ""); setOnlyOverdue(!!state.onlyOverdue); setOnlyBlocked(!!state.onlyBlocked); setLeavesOnly(!!state.leavesOnly); setOnlyMissingEffort(!!state.onlyMissingEffort); }
  function clearFilters() { setActiveViewId("__all"); applyViewState(DEFAULT_VIEW_STATE); }

  function saveCurrentAsView() {
    const name = prompt("Save view as:", "My view"); if (!name) return;
    const v: SavedView = { id: uuidish(), name: name.trim().slice(0, 48), state: getCurrentViewState(), createdAt: new Date().toISOString() };
    const next = [v, ...savedViews].slice(0, 50); setSavedViews(next); persistSavedViews(next); setActiveViewId(v.id);
    setMsg("✅ View saved"); setTimeout(() => setMsg(""), 1200);
  }

  function deleteActiveView() {
    if (!activeViewId || activeViewId === "__all") return;
    const v = savedViews.find(x => x.id === activeViewId); if (!v) return;
    if (!confirm(`Delete saved view "${v.name}"?`)) return;
    const next = savedViews.filter(x => x.id !== activeViewId); setSavedViews(next); persistSavedViews(next); setActiveViewId("__all");
    setMsg("✅ View deleted"); setTimeout(() => setMsg(""), 1200);
  }

  function renameActiveView() {
    if (!activeViewId || activeViewId === "__all") return;
    const v = savedViews.find(x => x.id === activeViewId); if (!v) return;
    const name = prompt("Rename view:", v.name); if (!name) return;
    const next = savedViews.map(x => x.id === v.id ? { ...x, name: name.trim().slice(0, 48) } : x); setSavedViews(next); persistSavedViews(next);
    setMsg("✅ View renamed"); setTimeout(() => setMsg(""), 1200);
  }

  function setMyWorkFromOwner() {
    const v = prompt("Set My Work owner:", myWorkOwner || ""); if (v == null) return;
    const next = v.trim().slice(0, 80); setMyWorkOwner(next);
    try { window.localStorage.setItem(LS_KEY_MYWORK, next); } catch {}
    setMsg("✅ My Work owner set"); setTimeout(() => setMsg(""), 1200);
  }

  function applyMyWorkFilter() {
    if (!myWorkOwner.trim()) { setMsg("ℹ️ Set 'My Work owner' first"); setTimeout(() => setMsg(""), 1200); return; }
    setActiveViewId("__all"); setOwnerFilter(myWorkOwner.trim());
    setMsg("✅ My Work filter applied"); setTimeout(() => setMsg(""), 1200);
  }

  const rowMeta = useMemo(() => {
    const idToIndex = new Map<string, number>(); const idToHasChildren = new Map<string, boolean>();
    for (let i = 0; i < coded.length; i++) idToIndex.set(coded[i].id, i);
    for (let i = 0; i < coded.length; i++) idToHasChildren.set(coded[i].id, rowHasChildren(coded, i));
    return { idToIndex, idToHasChildren };
  }, [coded]);

  // ─── ROW ACTIONS MENU ─────────────────────────────────────────────────────
  function RowActions({ rowId }: { rowId: string }) {
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const open = openRowId === rowId;
    const [pos, setPos] = useState<{ top: number; left: number; placement: "bottom" | "top" }>({ top: 0, left: 0, placement: "bottom" });
    const idx = rowMeta.idToIndex.get(rowId) ?? -1;
    const hasChildren = rowMeta.idToHasChildren.get(rowId) ?? false;
    const canIndent = !readOnly && idx > 0;
    const canOutdent = !readOnly && idx >= 0 && (coded[idx]?.level ?? 0) > 0;
    const canDelete = !readOnly && !hasChildren;

    function computePosition() {
      const el = btnRef.current; if (!el || typeof window === "undefined") return;
      const r = el.getBoundingClientRect(); const menuW = 224; const pad = 12;
      const left = clamp(r.left, pad, window.innerWidth - menuW - pad);
      let top = r.bottom + 8; let placement: "bottom" | "top" = "bottom";
      const menuH = menuRef.current?.getBoundingClientRect().height ?? 320;
      if (top + menuH > window.innerHeight - pad) { const aboveTop = r.top - menuH - 8; if (aboveTop >= pad) { top = aboveTop; placement = "top"; } else { top = clamp(top, pad, window.innerHeight - menuH - pad); } }
      setPos({ top, left, placement });
    }

    useLayoutEffect(() => {
      if (!open) return;
      computePosition();
      function onScrollOrResize() { computePosition(); }
      window.addEventListener("resize", onScrollOrResize);
      window.addEventListener("scroll", onScrollOrResize, { capture: true });
      return () => { window.removeEventListener("resize", onScrollOrResize); window.removeEventListener("scroll", onScrollOrResize, { capture: true } as any); };
    }, [open, rowId, idx, coded.length]);

    const menu = open ? (
      <div
        ref={menuRef}
        data-wbs-rowmenu
        className="fixed w-52 rounded-xl border border-slate-200 bg-white shadow-xl overflow-hidden z-[9999] py-1.5"
        style={{ top: pos.top, left: pos.left }}
        onClick={e => e.stopPropagation()}
      >
        {[
          { label: "+ Add sibling", action: () => addSibling(rowId), disabled: !!readOnly, icon: "↕" },
          { label: "+ Add child", action: () => addChild(rowId), disabled: !!readOnly, icon: "↳" },
          null,
          { label: "Indent →", action: () => indent(rowId), disabled: !canIndent, icon: "→", title: !canIndent ? "Cannot indent the first row" : undefined },
          { label: "← Outdent", action: () => outdent(rowId), disabled: !canOutdent, icon: "←", title: !canOutdent ? "Already at level 0" : undefined },
          null,
          { label: "AI Expand", action: async () => { await requestCreateArtifactIfNeeded("focus"); aiExpand(rowId); }, disabled: !!readOnly, icon: "✦" },
          { label: "AI Assistant", action: () => { setSelectedRowId(rowId); setAssistantOpen(true); }, disabled: !!readOnly, icon: "◈" },
          null,
          { label: "Delete row", action: () => removeRow(rowId), disabled: !canDelete, danger: true, icon: "✕", title: !canDelete ? "Remove children first" : undefined },
        ].map((item, i) => item === null ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-slate-100 mx-3" />
        ) : (
          <button
            key={item.label}
            type="button"
            disabled={item.disabled}
            title={(item as any).title}
            className={`w-full text-left px-3.5 py-2 text-sm flex items-center gap-2.5 transition-colors disabled:opacity-35 ${(item as any).danger ? "text-rose-600 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-50"}`}
            onClick={() => { setOpenRowId(null); item.action(); }}
          >
            <span className="w-4 text-center text-xs opacity-60">{(item as any).icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    ) : null;

    return (
      <div data-wbs-rowmenu className="inline-flex" onClick={e => e.stopPropagation()}>
        <button
          ref={btnRef}
          type="button"
          disabled={!!readOnly}
          title="Row actions"
          onClick={async () => { await requestCreateArtifactIfNeeded("focus"); setOpenRowId(open ? null : rowId); }}
          className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all text-sm tracking-wider leading-none"
        >
          ···
        </button>
        {open && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
      </div>
    );
  }

  function toggleDetails(rowId: string) { setExpanded(prev => { const next = new Set(prev); if (next.has(rowId)) next.delete(rowId); else next.add(rowId); return next; }); }

  function applyGeneratedDoc() {
    if (!generatedDoc) return;
    const nextRows = Array.isArray(generatedDoc?.rows) ? generatedDoc.rows : [];
    if (!nextRows.length) { setMsg("⛔ Generated doc has no rows"); setTimeout(() => setMsg(""), 1200); return; }
    markDirty();
    setDoc(prev => ({ ...prev, title: safeStr(generatedDoc?.title) || prev.title || "Work Breakdown Structure", due_date: safeStr(generatedDoc?.due_date) || prev.due_date || "", rows: nextRows.map((r: any) => ({ id: safeStr(r?.id) || uuidish(), level: clamp(Number(r?.level ?? 0), 0, 10), deliverable: safeStr(r?.deliverable), description: safeStr(r?.description), acceptance_criteria: safeStr(r?.acceptance_criteria), owner: safeStr(r?.owner), status: (((r?.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus, effort: normalizeEffort(r?.effort), due_date: safeStr(r?.due_date), predecessor: safeStr(r?.predecessor), tags: Array.isArray(r?.tags) ? r.tags.map((t: any) => safeStr(t)).filter(Boolean) : [] })) }));
    setTitle(safeStr(generatedDoc?.title) || title); setGenOpen(false);
    setMsg("✅ Generated WBS applied"); setTimeout(() => setMsg(""), 1200);
  }

  // ─── SAVE INDICATOR ───────────────────────────────────────────────────────
  function SaveIndicator() {
    const missingId = !readOnly && !safeStr(artifactIdLocal).trim();
    if (missingId) return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-rose-50 text-rose-600 border border-rose-200 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />Missing ID
      </span>
    );
    if (saveMode === "saving") return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-slate-100 text-slate-600 border border-slate-200 font-medium animate-pulse">
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />Saving…
      </span>
    );
    if (saveMode === "dirty") return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-amber-50 text-amber-700 border border-amber-200 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />Unsaved
      </span>
    );
    if (saveMode === "saved") return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-teal-50 text-teal-700 border border-teal-200 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
        Saved {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
      </span>
    );
    if (saveMode === "error") return (
      <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-rose-50 text-rose-600 border border-rose-200 font-medium">
        <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />Save error
      </span>
    );
    return null;
  }

  // ─── OVERALL PROGRESS ─────────────────────────────────────────────────────
  const overallProgress = useMemo(() => {
    const leaves = (rolled as any[]).filter(r => !r._isParent);
    if (!leaves.length) return 0;
    let wSum = 0, pSum = 0;
    for (const x of leaves) { const w = effortWeight(normalizeEffort(x.effort)); wSum += w; pSum += w * statusScore(((x.status ?? "not_started") as WbsStatus) || "not_started"); }
    return wSum ? Math.round((pSum / wSum) * 100) : 0;
  }, [rolled]);

  const totalRows = rolled.length;
  const doneCount = (rolled as any[]).filter(r => !r._isParent && ((r.status ?? "not_started") as WbsStatus) === "done").length;
  const blockedCount = (rolled as any[]).filter(r => statusShownForRow(r, doc.auto_rollup !== false) === "blocked").length;

  const hasActiveFilters = !!(q || ownerFilter || statusFilter || tagFilter || dueFrom || dueTo || onlyOverdue || onlyBlocked || leavesOnly || onlyMissingEffort);

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f0ede8] font-[system-ui]">

      {/* ── TOP BAR ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-40 bg-white border-b border-slate-200 shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
        <div className="max-w-[1800px] mx-auto px-5 h-14 flex items-center gap-3">

          {/* Icon + Title */}
          <div className="flex items-center gap-2.5 flex-1 min-w-0">
            {/* WBS grid icon */}
            <div className="w-7 h-7 rounded-lg bg-slate-900 flex items-center justify-center shrink-0">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <rect x="1" y="1" width="3.5" height="3.5" rx="0.75" fill="white" fillOpacity="0.9"/>
                <rect x="6" y="1" width="7" height="1.5" rx="0.5" fill="white" fillOpacity="0.5"/>
                <rect x="1" y="5.75" width="3.5" height="3.5" rx="0.75" fill="white" fillOpacity="0.7"/>
                <rect x="6" y="5.75" width="7" height="1.5" rx="0.5" fill="white" fillOpacity="0.5"/>
                <rect x="1" y="10.5" width="3.5" height="2.5" rx="0.75" fill="white" fillOpacity="0.5"/>
                <rect x="6" y="10.5" width="5" height="1.5" rx="0.5" fill="white" fillOpacity="0.5"/>
              </svg>
            </div>

            <input
              value={title}
              onFocus={() => void requestCreateArtifactIfNeeded("focus")}
              onChange={e => { setTitle(e.target.value); markDirty(); setDoc(prev => ({ ...prev, title: e.target.value })); }}
              disabled={!!readOnly}
              className="text-base font-semibold text-slate-900 bg-transparent outline-none w-full placeholder:text-slate-400 min-w-0 truncate"
              placeholder="Work Breakdown Structure"
            />
          </div>

          {/* Centre stats */}
          <div className="hidden lg:flex items-center gap-1.5">
            <span className="text-xs px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-medium tabular-nums">{totalRows} items</span>
            <span className="text-xs px-2.5 py-1 rounded-full bg-teal-100 text-teal-700 font-medium tabular-nums">{doneCount} done</span>
            {blockedCount > 0 && <span className="text-xs px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 font-medium tabular-nums">{blockedCount} blocked</span>}
            {missingEffortCount > 0 && <span className="text-xs px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium tabular-nums">{missingEffortCount} unestimated</span>}
          </div>

          <div className="h-5 w-px bg-slate-200" />

          {/* Actions */}
          <div className="flex items-center gap-1.5">
            <SaveIndicator />

            <button
              onClick={exportXlsx}
              disabled={exportingXlsx}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 transition-all"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v6M3.5 5l2.5 2 2.5-2M1.5 9v.5A1 1 0 002.5 10.5h7a1 1 0 001-1V9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/></svg>
              {exportingXlsx ? "…" : "XLSX"}
            </button>

            <button
              onClick={generateWbs}
              disabled={readOnly || genLoading}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-indigo-700 rounded-lg border border-indigo-200 bg-indigo-50 hover:bg-indigo-100 disabled:opacity-40 transition-all"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M5.5 1L7 4h3.5L7.5 6l1.5 3.5L5.5 8 2.5 9.5 4 6 1 4h3.5L5.5 1z" fill="currentColor" fillOpacity="0.7"/></svg>
              {genLoading ? "Generating…" : "AI Generate"}
            </button>

            <button
              onClick={aiValidate}
              disabled={readOnly || isPending}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-all"
            >
              Validate
            </button>

            <button
              onClick={async () => { await requestCreateArtifactIfNeeded("focus"); const last = coded?.[coded.length - 1]?.id; if (last) addSibling(last); }}
              disabled={readOnly || !coded?.length}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 transition-all"
            >
              <span className="text-sm leading-none">+</span> Add item
            </button>

            <button
              onClick={save}
              disabled={readOnly || saving}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                dirty
                  ? "bg-slate-900 text-white hover:bg-slate-700 shadow-sm"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              } disabled:opacity-50`}
            >
              {saving ? "Saving…" : dirty ? "Save ●" : "Saved"}
            </button>
          </div>
        </div>

        {/* Progress track — thin, under the nav */}
        <div className="h-[3px] bg-slate-100 relative overflow-hidden">
          <div
            className="h-full bg-slate-800 transition-all duration-700 ease-out"
            style={{ width: `${overallProgress}%` }}
          />
          {overallProgress > 0 && overallProgress < 100 && (
            <div
              className="absolute top-0 h-full w-12 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-pulse"
              style={{ left: `calc(${overallProgress}% - 24px)` }}
            />
          )}
        </div>
      </header>

      <div className="max-w-[1800px] mx-auto px-5 py-5 space-y-4">

        {/* ── FILTER BAR ─────────────────────────────────────────────────── */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          {/* Primary row: search + status + quick toggles */}
          <div className="px-4 py-3 flex flex-wrap items-center gap-2">
            {/* Search */}
            <div className="relative min-w-0 w-64 shrink-0">
              <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" width="13" height="13" viewBox="0 0 13 13" fill="none">
                <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.4"/>
                <path d="M9 9l2.5 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
              <input
                value={q}
                onChange={e => setQ(e.target.value)}
                placeholder="Search…"
                className="w-full pl-8 pr-3 py-1.5 text-sm bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-slate-300 focus:border-slate-400 focus:bg-white outline-none transition-all"
              />
            </div>

            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 focus:ring-2 focus:ring-slate-300 outline-none"
            >
              <option value="">All statuses</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="done">Done</option>
              <option value="blocked">Blocked</option>
            </select>

            <input
              value={ownerFilter}
              onChange={e => setOwnerFilter(e.target.value)}
              placeholder="Owner"
              className="w-28 text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-300 outline-none"
            />

            <input
              value={tagFilter}
              onChange={e => setTagFilter(e.target.value)}
              placeholder="Tag"
              className="w-24 text-sm px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-300 outline-none"
            />

            {/* Toggle chips */}
            {[
              { label: "Overdue", active: onlyOverdue, toggle: () => setOnlyOverdue(v => !v) },
              { label: "Blocked", active: onlyBlocked, toggle: () => setOnlyBlocked(v => !v) },
              { label: "Leaves only", active: leavesOnly, toggle: () => setLeavesOnly(v => !v) },
              { label: "No effort", active: onlyMissingEffort, toggle: () => { setOnlyMissingEffort(v => !v); setLeavesOnly(true); } },
            ].map(f => (
              <button
                key={f.label}
                type="button"
                onClick={f.toggle}
                className={`text-xs px-2.5 py-1.5 rounded-lg font-medium border transition-all ${
                  f.active
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 hover:border-slate-300"
                }`}
              >
                {f.label}
              </button>
            ))}

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-rose-600 hover:bg-rose-50 hover:border-rose-200 transition-all"
              >
                Clear filters
              </button>
            )}

            {/* Right: views + date + rollup + count */}
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <select
                value={activeViewId}
                onChange={e => { const id = e.target.value; setActiveViewId(id); if (id !== "__all") { const v = savedViews.find(x => x.id === id); if (v) applyViewState(v.state); } }}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 focus:ring-2 focus:ring-slate-300 outline-none max-w-[140px]"
              >
                <option value="__all">All rows</option>
                {savedViews.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>

              <button onClick={saveCurrentAsView} disabled={!!readOnly} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-all">Save view</button>

              {activeViewId !== "__all" && (
                <>
                  <button onClick={renameActiveView} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all">Rename</button>
                  <button onClick={deleteActiveView} className="text-xs px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 transition-all">Delete</button>
                </>
              )}

              <div className="h-4 w-px bg-slate-200" />

              <button onClick={applyMyWorkFilter} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-all">My Work</button>
              <button onClick={setMyWorkFromOwner} className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 transition-all">Set owner</button>

              <div className="h-4 w-px bg-slate-200" />

              <input
                type="date"
                value={doc.due_date ?? ""}
                disabled={!!readOnly}
                onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                onChange={e => updateDoc({ due_date: e.target.value })}
                title="Project due date"
                className="text-xs px-2.5 py-1.5 rounded-lg border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-300 outline-none text-slate-600"
              />

              <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={doc.auto_rollup !== false}
                  disabled={!!readOnly}
                  onChange={e => updateDoc({ auto_rollup: e.target.checked })}
                  className="rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                />
                Roll-up
              </label>

              <span className="text-xs text-slate-500 font-medium bg-slate-100 px-2 py-1 rounded-md tabular-nums">
                {visibleRows.length}/{rolled.length}
              </span>
            </div>
          </div>

          {/* Date range row — always visible but compact */}
          <div className="px-4 pb-3 flex items-center gap-2 border-t border-slate-100 pt-2.5">
            <span className="text-xs text-slate-400 font-medium">Due between</span>
            <input type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-300 outline-none text-slate-600" />
            <span className="text-xs text-slate-300">–</span>
            <input type="date" value={dueTo} onChange={e => setDueTo(e.target.value)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 bg-slate-50 focus:ring-2 focus:ring-slate-300 outline-none text-slate-600" />
          </div>
        </div>

        {/* ── EFFORT WARNING BANNER ─────────────────────────────────────── */}
        {missingEffortCount > 0 && (
          <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200">
            <div className="flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg bg-amber-200 flex items-center justify-center text-amber-900 text-xs font-bold shrink-0 tabular-nums">
                {missingEffortCount}
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-900 leading-tight">Work packages missing effort estimate</p>
                <p className="text-xs text-amber-700 mt-0.5">Roll-ups default to Medium — may skew capacity planning</p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={() => { setOnlyMissingEffort(v => !v); setLeavesOnly(true); setActiveViewId("__all"); }}
                className={`text-xs px-3 py-1.5 rounded-lg font-medium border transition-all ${
                  onlyMissingEffort
                    ? "bg-amber-700 text-white border-amber-700"
                    : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100"
                }`}
              >
                {onlyMissingEffort ? "Showing gaps ✓" : "Filter to gaps"}
              </button>
              <button
                onClick={jumpToNextEffortGap}
                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-all"
              >
                Jump to next →
              </button>
            </div>
          </div>
        )}

        {/* ── MAIN GRID ────────────────────────────────────────────────── */}
        <div className="grid xl:grid-cols-12 gap-5">

          {/* ── ROW LIST ─────────────────────────────────────────────── */}
          <div className="xl:col-span-8 space-y-2">
            {visibleRows.length === 0 ? (
              <div className="rounded-xl border-2 border-dashed border-slate-200 bg-white p-14 text-center">
                <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center mx-auto mb-3">
                  <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                    <rect x="2" y="2" width="6" height="6" rx="1.5" stroke="#94a3b8" strokeWidth="1.5"/>
                    <rect x="12" y="2" width="6" height="6" rx="1.5" stroke="#94a3b8" strokeWidth="1.5"/>
                    <rect x="2" y="12" width="6" height="6" rx="1.5" stroke="#94a3b8" strokeWidth="1.5"/>
                    <rect x="12" y="12" width="6" height="6" rx="1.5" stroke="#94a3b8" strokeWidth="1.5"/>
                  </svg>
                </div>
                <p className="text-slate-700 font-semibold text-sm">No matching items</p>
                <p className="text-xs text-slate-400 mt-1">Adjust filters or add new entries above</p>
              </div>
            ) : (
              visibleRows.map((r: any) => {
                const isParent = !!r._isParent;
                const statusShown = statusShownForRow(r, doc?.auto_rollup !== false);
                const progressShown = progressShownForRow(r, doc?.auto_rollup !== false);
                const isSelected = selectedRowId === r.id;
                const isCollapsed = collapsed.has(r.id);
                const detailsOpen = expanded.has(r.id);
                const overdue = isOverdue(r.due_date, statusShown);
                const effortVal = normalizeEffort(r.effort);
                const effortMissing = !isParent && effortVal === "";
                const stripeClass = LEVEL_STRIPE[Math.min(r.level, LEVEL_STRIPE.length - 1)];
                const bgClass = isParent && r.level === 0 ? LEVEL_BG[0] : "bg-white";
                const cfg = STATUS_CONFIG[statusShown];

                return (
                  <div
                    key={r.id}
                    className={`group rounded-xl border-l-[3px] ${stripeClass} border-t border-r border-b transition-all duration-100 cursor-pointer ${
                      isSelected
                        ? `border-t-slate-300 border-r-slate-300 border-b-slate-300 ring-2 ring-slate-900/10 shadow-md ${bgClass}`
                        : `border-t-slate-200 border-r-slate-200 border-b-slate-200 hover:shadow-sm hover:border-t-slate-300 hover:border-r-slate-300 hover:border-b-slate-300 ${bgClass}`
                    }`}
                    onClick={() => { setSelectedRowId(r.id); setAssistantOpen(true); }}
                  >

                    {/* ── ROW HEADER ─── */}
                    <div className="flex items-center gap-2 px-3 pt-3 pb-2.5">
                      {/* Indent spacer */}
                      <div style={{ width: `${r.level * 20}px` }} className="shrink-0" />

                      {/* Collapse toggle or status dot */}
                      {isParent ? (
                        <button
                          onClick={e => { e.stopPropagation(); toggleCollapse(r.id); }}
                          className="w-6 h-6 rounded-md flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all shrink-0 text-[10px]"
                        >
                          {isCollapsed ? "▸" : "▾"}
                        </button>
                      ) : (
                        <div className="w-6 h-6 shrink-0 flex items-center justify-center">
                          <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        </div>
                      )}

                      {/* Code */}
                      <code className="text-[11px] font-mono text-slate-400 tabular-nums shrink-0 w-10 text-right">{r.code || "—"}</code>

                      {/* Deliverable name */}
                      <input
                        value={r.deliverable}
                        placeholder={isParent ? "Phase or group" : "Work package"}
                        onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                        onChange={e => updateRow(r.id, { deliverable: e.target.value })}
                        disabled={!!readOnly}
                        onClick={e => e.stopPropagation()}
                        className={`flex-1 bg-transparent outline-none placeholder:text-slate-300 min-w-0 ${
                          isParent
                            ? r.level === 0
                              ? "text-sm font-bold text-slate-900 tracking-tight"
                              : "text-sm font-semibold text-slate-800"
                            : "text-sm font-medium text-slate-700"
                        }`}
                      />

                      {/* Always-visible status badges for important states */}
                      <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                        {overdue && (
                          <span className="text-[10px] font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded-md">Overdue</span>
                        )}
                        {effortMissing && (
                          <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-md">No effort</span>
                        )}
                        {statusShown === "blocked" && !isParent && (
                          <span className="text-[10px] font-semibold text-rose-700 bg-rose-100 border border-rose-200 px-1.5 py-0.5 rounded-md">Blocked</span>
                        )}

                        {/* Hover-only controls */}
                        <button
                          onClick={e => { e.stopPropagation(); toggleDetails(r.id); }}
                          className="opacity-0 group-hover:opacity-100 text-[11px] px-2 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 hover:text-slate-700 transition-all"
                        >
                          {detailsOpen ? "↑ Hide" : "↓ Details"}
                        </button>
                        {!readOnly && <RowActions rowId={r.id} />}
                      </div>
                    </div>

                    {/* ── ROW META ─── */}
                    <div
                      className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-3 pb-3"
                      onClick={e => e.stopPropagation()}
                    >
                      {/* Status */}
                      <div>
                        <label className="block text-[9px] uppercase tracking-widest text-slate-400 mb-1 font-semibold">Status</label>
                        <select
                          value={statusShown}
                          disabled={!!readOnly || (doc?.auto_rollup !== false && isParent)}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={e => updateRow(r.id, { status: e.target.value as WbsStatus })}
                          className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border w-full disabled:opacity-60 outline-none focus:ring-1 focus:ring-slate-400 transition-all ${cfg.selectCls}`}
                        >
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                          <option value="blocked">Blocked</option>
                        </select>
                      </div>

                      {/* Effort */}
                      <div>
                        <label className="block text-[9px] uppercase tracking-widest text-slate-400 mb-1 font-semibold">Effort</label>
                        <select
                          value={effortVal}
                          disabled={!!readOnly}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={e => updateRow(r.id, { effort: normalizeEffort(e.target.value) })}
                          className={`text-xs font-semibold rounded-lg px-2.5 py-1.5 border w-full outline-none focus:ring-1 focus:ring-slate-400 transition-all ${
                            effortMissing
                              ? "bg-rose-50 border-rose-200 text-rose-700"
                              : effortVal === "S"
                              ? "bg-sky-50 border-sky-200 text-sky-800"
                              : effortVal === "M"
                              ? "bg-slate-50 border-slate-200 text-slate-700"
                              : "bg-orange-50 border-orange-200 text-orange-800"
                          }`}
                        >
                          <option value="">— not set —</option>
                          <option value="S">S – Small</option>
                          <option value="M">M – Medium</option>
                          <option value="L">L – Large</option>
                        </select>
                      </div>

                      {/* Progress */}
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <label className="text-[9px] uppercase tracking-widest text-slate-400 font-semibold">Progress</label>
                          <span className="text-[11px] font-bold text-slate-700 tabular-nums">{progressShown}%</span>
                        </div>
                        {/* Segmented progress track */}
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${cfg.trackCls}`}
                            style={{ width: `${progressShown}%` }}
                          />
                        </div>
                      </div>

                      {/* Due date */}
                      <div>
                        <label className="block text-[9px] uppercase tracking-widest text-slate-400 mb-1 font-semibold">Due</label>
                        <input
                          type="date"
                          value={r.due_date ?? ""}
                          disabled={!!readOnly}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={e => updateRow(r.id, { due_date: e.target.value })}
                          className={`text-xs w-full rounded-lg border px-2.5 py-1.5 outline-none focus:ring-1 focus:ring-slate-400 transition-all ${
                            overdue ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-slate-50 border-slate-200 text-slate-600"
                          }`}
                        />
                      </div>
                    </div>

                    {/* ── DETAILS PANEL ─── */}
                    {detailsOpen && (
                      <div
                        className="border-t border-slate-100 px-3 py-4 grid md:grid-cols-12 gap-4 bg-slate-50"
                        onClick={e => e.stopPropagation()}
                      >
                        <div className="md:col-span-4 space-y-3.5">
                          {[
                            { label: "Owner", value: r.owner ?? "", key: "owner", placeholder: "Assign owner" },
                            { label: "Predecessor", value: r.predecessor ?? "", key: "predecessor", placeholder: "e.g. 1.2" },
                            { label: "Tags", value: joinTags(r.tags), key: "tags", placeholder: "governance, risk…" },
                          ].map(field => (
                            <div key={field.key}>
                              <label className="block text-[9px] uppercase tracking-widest text-slate-400 mb-1 font-semibold">{field.label}</label>
                              <input
                                value={field.value}
                                disabled={!!readOnly}
                                placeholder={field.placeholder}
                                onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                                onChange={e => updateRow(r.id, { [field.key]: field.key === "tags" ? parseTags(e.target.value) : e.target.value } as any)}
                                className="w-full text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all placeholder:text-slate-300"
                              />
                            </div>
                          ))}
                        </div>
                        <div className="md:col-span-8 space-y-3.5">
                          <div>
                            <label className="block text-[9px] uppercase tracking-widest text-slate-400 mb-1 font-semibold">Description</label>
                            <textarea
                              value={r.description ?? ""}
                              disabled={!!readOnly}
                              rows={3}
                              placeholder="Context, notes, approach…"
                              onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                              onChange={e => updateRow(r.id, { description: e.target.value })}
                              className="w-full text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 resize-y min-h-[68px] outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all placeholder:text-slate-300"
                            />
                          </div>
                          <div>
                            <label className="block text-[9px] uppercase tracking-widest text-slate-400 mb-1 font-semibold">Acceptance Criteria</label>
                            <textarea
                              value={r.acceptance_criteria ?? ""}
                              disabled={!!readOnly}
                              rows={4}
                              placeholder={"• Must be measurable\n• Must be testable"}
                              onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                              onChange={e => updateRow(r.id, { acceptance_criteria: e.target.value })}
                              className="w-full text-sm bg-white border border-slate-200 rounded-lg px-3 py-2 resize-y min-h-[92px] outline-none focus:ring-1 focus:ring-slate-400 focus:border-slate-400 transition-all placeholder:text-slate-300"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {readOnly && (
              <p className="text-[11px] text-center text-slate-400 py-2">Read-only mode</p>
            )}
          </div>

          {/* ── RIGHT RAIL ──────────────────────────────────────────── */}
          <div className="xl:col-span-4 space-y-4">

            {/* AI ASSISTANT PANEL */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden sticky top-[68px]">
              {/* Panel header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-md bg-slate-900 flex items-center justify-center">
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M5.5 1L7 3.8h3L7.5 5.6l1.5 3.4-3.5-2-3.5 2 1.5-3.4L1 3.8h3L5.5 1z" fill="white" fillOpacity="0.85"/>
                    </svg>
                  </div>
                  <span className="text-xs font-semibold text-slate-800">AI Assistant</span>
                  {selectedRow && (
                    <span className="text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-md font-mono truncate max-w-[100px]">
                      {selectedRow.code}
                    </span>
                  )}
                </div>
                <button
                  onClick={() => setAssistantOpen(v => !v)}
                  className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-all"
                >
                  {assistantOpen ? "Collapse" : "Expand"}
                </button>
              </div>

              <div className="p-4">
                {!assistantOpen ? (
                  <div className="text-center py-5">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center mx-auto mb-2">
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="#94a3b8" strokeWidth="1.3"/><path d="M7 4.5v3M7 9v.5" stroke="#94a3b8" strokeWidth="1.3" strokeLinecap="round"/></svg>
                    </div>
                    <p className="text-xs text-slate-400">Select a row to open the assistant</p>
                  </div>
                ) : (
                  <LazyWbsAssistantRail
                    projectId={projectId}
                    readOnly={!!readOnly}
                    selectedRow={selectedRow}
                    onEnsureArtifact={async () => { await requestCreateArtifactIfNeeded("focus"); return safeStr(artifactIdLocal).trim(); }}
                    onUpdateRow={(rowId, patch) => updateRow(rowId, patch)}
                    onAppendDescription={(rowId, block) => {
                      const row = coded.find(x => x.id === rowId);
                      const existing = safeStr(row?.description);
                      updateRow(rowId, { description: existing ? `${existing}\n\n${block}` : block });
                    }}
                    onExpandChildren={rowId => aiExpand(rowId)}
                    onMessage={text => { setMsg(text); setTimeout(() => setMsg(""), 1200); }}
                  />
                )}
              </div>
            </div>

            {/* VALIDATION PANEL */}
            {validateOpen && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <span className="text-xs font-semibold text-slate-800">Validation Report</span>
                  <button onClick={() => setValidateOpen(false)} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-all">Close</button>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-slate-600">{validateSummary}</p>
                  {aiIssues.length > 0 && (
                    <div className="space-y-2">
                      {aiIssues.map((x, i) => (
                        <div key={i} className={`rounded-lg px-3 py-2.5 text-sm border ${
                          x.severity === "high"
                            ? "border-rose-200 bg-rose-50"
                            : x.severity === "medium"
                            ? "border-amber-200 bg-amber-50"
                            : "border-slate-200 bg-slate-50"
                        }`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className={`text-[9px] font-bold uppercase tracking-widest ${
                              x.severity === "high" ? "text-rose-600" : x.severity === "medium" ? "text-amber-700" : "text-slate-400"
                            }`}>{x.severity}</span>
                            {x.rowId && (
                              <button
                                onClick={() => { setSelectedRowId(x.rowId!); setAssistantOpen(true); setMsg("Jumped to row"); setTimeout(() => setMsg(""), 1000); }}
                                className="text-[10px] px-2 py-0.5 rounded-md border border-slate-200 bg-white hover:bg-slate-50 text-slate-600"
                              >
                                Jump →
                              </button>
                            )}
                          </div>
                          <p className="text-xs text-slate-700 leading-relaxed">{x.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* AI GENERATE PANEL */}
            {genOpen && (
              <div className="rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <div className="flex items-center gap-2">
                    {genLoading && <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse" />}
                    <span className="text-xs font-semibold text-slate-800">AI Generated WBS</span>
                  </div>
                  <button onClick={() => { setGenOpen(false); setGeneratedDoc(null); }} className="text-xs px-2.5 py-1 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-100 transition-all">Close</button>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-slate-600">
                    {genLoading ? "Generating your WBS…" : generatedDoc ? "Preview ready. Apply to replace current rows." : "No output yet."}
                  </p>
                  {generatedDoc && (
                    <>
                      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 max-h-[200px] overflow-auto">
                        <pre className="text-[11px] text-slate-600 whitespace-pre-wrap font-mono leading-relaxed">{JSON.stringify(generatedDoc, null, 2)}</pre>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={applyGeneratedDoc}
                          disabled={!!readOnly}
                          className="flex-1 py-2 text-sm font-semibold rounded-lg bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50 transition-all"
                        >
                          Apply WBS
                        </button>
                        <button onClick={() => generateWbs()} className="px-3 py-2 text-sm rounded-lg border border-slate-200 hover:bg-slate-50 transition-all">
                          Retry
                        </button>
                      </div>
                      <p className="text-[10px] text-slate-400 text-center">This replaces all current rows</p>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
