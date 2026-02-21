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
      { id: uuidish(), level: 0, deliverable: "Project Governance & Management", status: "in_progress", effort: "M" },
      { id: uuidish(), level: 1, deliverable: "Project Charter", status: "done", effort: "S" },
      { id: uuidish(), level: 1, deliverable: "Stakeholder Register", status: "in_progress", effort: "S" },
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
const STATUS_CONFIG: Record<WbsStatus, { label: string; dot: string; badge: string; ring: string; selectCls: string }> = {
  not_started: { label: "Not started", dot: "bg-slate-400", badge: "bg-slate-100 text-slate-600 ring-slate-200", ring: "ring-slate-200", selectCls: "bg-slate-50 border-slate-200 text-slate-700" },
  in_progress:  { label: "In progress", dot: "bg-amber-400 animate-pulse", badge: "bg-amber-50 text-amber-700 ring-amber-200", ring: "ring-amber-200", selectCls: "bg-amber-50 border-amber-200 text-amber-800" },
  done:         { label: "Done", dot: "bg-emerald-500", badge: "bg-emerald-50 text-emerald-700 ring-emerald-200", ring: "ring-emerald-200", selectCls: "bg-emerald-50 border-emerald-200 text-emerald-800" },
  blocked:      { label: "Blocked", dot: "bg-rose-500", badge: "bg-rose-50 text-rose-700 ring-rose-200", ring: "ring-rose-200", selectCls: "bg-rose-50 border-rose-200 text-rose-800" },
};

function StatusBadge({ s }: { s: WbsStatus }) {
  const cfg = STATUS_CONFIG[s];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ring-1 ${cfg.badge}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      {cfg.label}
    </span>
  );
}

function EffortPip({ effort }: { effort: Effort }) {
  if (!effort) return <span className="text-xs text-rose-500 font-semibold tracking-wide uppercase">Missing</span>;
  const map: Record<string, string> = { S: "bg-sky-100 text-sky-700 border border-sky-200", M: "bg-violet-100 text-violet-700 border border-violet-200", L: "bg-orange-100 text-orange-700 border border-orange-200" };
  const label: Record<string, string> = { S: "S – Small", M: "M – Med", L: "L – Large" };
  return <span className={`text-xs font-semibold px-2.5 py-1 rounded-md ${map[effort]}`}>{label[effort]}</span>;
}

// ─── LEVEL INDENT PALETTE ─────────────────────────────────────────────────────
const LEVEL_ACCENT = ["border-l-violet-500", "border-l-sky-400", "border-l-teal-400", "border-l-amber-400", "border-l-rose-400", "border-l-pink-400"];

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

  function insertAt(index: number, row: WbsRow) { markDirty(); setDoc(prev => { const out = [...prev.rows]; out.splice(index, 0, row); return { ...prev, rows: out }; }); }

  function addSibling(afterId: string) {
    markDirty();
    setDoc(prev => {
      const idx = prev.rows.findIndex(r => r.id === afterId); if (idx < 0) return prev;
      const base = prev.rows[idx];
      const next: WbsRow = { id: uuidish(), level: base.level, deliverable: "", description: "", acceptance_criteria: "", owner: "", status: "not_started", effort: "", due_date: "", predecessor: "", tags: [] };
      const out = [...prev.rows]; out.splice(idx + 1, 0, next); return { ...prev, rows: out };
    });
    setExpanded(p => { const n = new Set(p); n.add(afterId); return n; });
  }

  function addChild(parentId: string) {
    markDirty();
    setDoc(prev => {
      const idx = prev.rows.findIndex(r => r.id === parentId); if (idx < 0) return prev;
      const parent = prev.rows[idx]; let insertIndex = idx + 1;
      for (let i = idx + 1; i < prev.rows.length; i++) { if (prev.rows[i].level <= parent.level) break; insertIndex = i + 1; }
      const next: WbsRow = { id: uuidish(), level: clamp(parent.level + 1, 0, 10), deliverable: "", description: "", acceptance_criteria: "", owner: "", status: "not_started", effort: "", due_date: "", predecessor: "", tags: [] };
      const out = [...prev.rows]; out.splice(insertIndex, 0, next); return { ...prev, rows: out };
    });
    setCollapsed(prev => { const next = new Set(prev); next.delete(parentId); return next; });
    setExpanded(p => { const n = new Set(p); n.add(parentId); return n; });
  }

  function indent(id: string) { markDirty(); setDoc(prev => { const idx = prev.rows.findIndex(r => r.id === id); if (idx <= 0) return prev; const prevRow = prev.rows[idx - 1]; const cur = prev.rows[idx]; const nextLevel = clamp(cur.level + 1, 0, (prevRow.level ?? 0) + 1); const out = [...prev.rows]; out[idx] = { ...cur, level: nextLevel }; return { ...prev, rows: out }; }); }
  function outdent(id: string) { markDirty(); setDoc(prev => { const idx = prev.rows.findIndex(r => r.id === id); if (idx < 0) return prev; const cur = prev.rows[idx]; const out = [...prev.rows]; out[idx] = { ...cur, level: clamp(cur.level - 1, 0, 10) }; return { ...prev, rows: out }; }); }

  function removeRow(id: string) {
    markDirty();
    setDoc(prev => {
      const idx = prev.rows.findIndex(r => r.id === id); if (idx < 0) return prev;
      const target = prev.rows[idx]; let end = idx + 1;
      for (let i = idx + 1; i < prev.rows.length; i++) { if (prev.rows[i].level <= target.level) break; end = i + 1; }
      const out = [...prev.rows]; out.splice(idx, end - idx);
      const nextRows = out.length ? out : [{ id: uuidish(), level: 0, deliverable: "", effort: "", status: "not_started" }];
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
      <div ref={menuRef} data-wbs-rowmenu className="fixed w-56 rounded-2xl border border-gray-100 bg-white/95 backdrop-blur-xl shadow-2xl overflow-hidden z-[9999] py-1" style={{ top: pos.top, left: pos.left }} onClick={e => e.stopPropagation()}>
        {[
          { label: "+ Add sibling", action: () => addSibling(rowId), disabled: !!readOnly },
          { label: "+ Add child", action: () => addChild(rowId), disabled: !!readOnly },
          null,
          { label: "Indent →", action: () => indent(rowId), disabled: !canIndent, title: !canIndent ? "Cannot indent the first row" : undefined },
          { label: "← Outdent", action: () => outdent(rowId), disabled: !canOutdent, title: !canOutdent ? "Already at level 0" : undefined },
          null,
          { label: "✨ AI Expand", action: async () => { await requestCreateArtifactIfNeeded("focus"); aiExpand(rowId); }, disabled: !!readOnly },
          { label: "🤖 AI Assistant", action: () => { setSelectedRowId(rowId); setAssistantOpen(true); }, disabled: !!readOnly },
          null,
          { label: "Delete", action: () => removeRow(rowId), disabled: !canDelete, danger: true, title: !canDelete ? "Remove children first" : undefined },
        ].map((item, i) => item === null ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-gray-100 mx-3" />
        ) : (
          <button key={item.label} type="button" disabled={item.disabled} title={item.title}
            className={`w-full text-left px-4 py-2 text-sm transition-colors disabled:opacity-40 ${item.danger ? "text-rose-600 hover:bg-rose-50" : "text-gray-700 hover:bg-gray-50"}`}
            onClick={() => { setOpenRowId(null); item.action(); }}>
            {item.label}
          </button>
        ))}
      </div>
    ) : null;

    return (
      <div data-wbs-rowmenu className="inline-flex" onClick={e => e.stopPropagation()}>
        <button ref={btnRef} type="button" disabled={!!readOnly} title="Row actions"
          onClick={async () => { await requestCreateArtifactIfNeeded("focus"); setOpenRowId(open ? null : rowId); }}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all text-base font-bold">
          ⋯
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
    if (missingId) return <span className="text-xs px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-medium">Missing ID</span>;
    if (saveMode === "saving") return <span className="text-xs px-3 py-1.5 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-200 font-medium animate-pulse">Saving…</span>;
    if (saveMode === "dirty") return <span className="text-xs px-3 py-1.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium">Unsaved</span>;
    if (saveMode === "saved") return <span className="text-xs px-3 py-1.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 font-medium">Saved {lastSavedAt ? new Date(lastSavedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}</span>;
    if (saveMode === "error") return <span className="text-xs px-3 py-1.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 font-medium">Save error</span>;
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

  // ─── RENDER ───────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#f4f3f0] font-[system-ui]">
      {/* ── TOP BAR ── */}
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-xl border-b border-gray-200/80 shadow-sm">
        <div className="max-w-[1800px] mx-auto px-6 py-0">
          <div className="flex items-center gap-4 h-16">
            {/* Title */}
            <div className="flex-1 min-w-0 flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-sm">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="4" height="4" rx="1" fill="white" fillOpacity="0.9"/><rect x="7" y="1" width="8" height="2" rx="1" fill="white" fillOpacity="0.6"/><rect x="1" y="6" width="4" height="4" rx="1" fill="white" fillOpacity="0.7"/><rect x="7" y="6" width="8" height="2" rx="1" fill="white" fillOpacity="0.6"/><rect x="1" y="11" width="4" height="4" rx="1" fill="white" fillOpacity="0.5"/><rect x="7" y="11" width="6" height="2" rx="1" fill="white" fillOpacity="0.6"/></svg>
              </div>
              <input
                value={title}
                onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                onChange={e => { setTitle(e.target.value); markDirty(); setDoc(prev => ({ ...prev, title: e.target.value })); }}
                disabled={!!readOnly}
                className="text-lg font-semibold text-gray-900 bg-transparent outline-none w-full placeholder:text-gray-400 min-w-0 truncate"
                placeholder="Work Breakdown Structure"
              />
            </div>

            {/* Stats pills */}
            <div className="hidden lg:flex items-center gap-2 text-xs">
              <span className="px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 font-medium">{totalRows} items</span>
              <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 font-medium">{doneCount} done</span>
              {blockedCount > 0 && <span className="px-2.5 py-1 rounded-full bg-rose-100 text-rose-700 font-medium">{blockedCount} blocked</span>}
              {missingEffortCount > 0 && <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-700 font-medium">{missingEffortCount} no effort</span>}
            </div>

            <div className="h-5 w-px bg-gray-200" />

            {/* Actions */}
            <div className="flex items-center gap-2">
              <SaveIndicator />
              {msg && <span className="text-xs text-gray-600 bg-gray-100 px-3 py-1.5 rounded-full max-w-[200px] truncate">{msg}</span>}

              <button onClick={exportXlsx} disabled={exportingXlsx}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v8M4 6l3 3 3-3M2 10v1a1 1 0 001 1h8a1 1 0 001-1v-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
                {exportingXlsx ? "…" : "XLSX"}
              </button>

              <button onClick={generateWbs} disabled={readOnly || genLoading}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-violet-700 rounded-xl border border-violet-200 bg-violet-50 hover:bg-violet-100 disabled:opacity-50 transition-all">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4H13l-3.5 2.5 1.5 4L7 9 3 11.5 4.5 7.5 1 5h4.5L7 1z" fill="currentColor" fillOpacity="0.8"/></svg>
                {genLoading ? "Generating…" : "AI Generate"}
              </button>

              <button onClick={aiValidate} disabled={readOnly || isPending}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 transition-all">
                Validate
              </button>

              <button
                onClick={async () => { await requestCreateArtifactIfNeeded("focus"); const last = coded?.[coded.length - 1]?.id; if (last) addSibling(last); }}
                disabled={readOnly || !coded?.length}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 rounded-xl border border-gray-200 hover:bg-gray-50 disabled:opacity-50 transition-all">
                + Add item
              </button>

              <button onClick={save} disabled={readOnly || saving}
                className={`px-4 py-1.5 text-sm font-semibold rounded-xl transition-all ${dirty ? "bg-violet-600 text-white hover:bg-violet-700 shadow-sm shadow-violet-200" : "bg-gray-900 text-white hover:bg-gray-800"} disabled:opacity-60`}>
                {saving ? "Saving…" : dirty ? "Save ●" : "Save"}
              </button>
            </div>
          </div>
        </div>

        {/* PROGRESS BAR */}
        <div className="h-0.5 bg-gray-100">
          <div className="h-full bg-gradient-to-r from-violet-500 via-indigo-500 to-sky-400 transition-all duration-700" style={{ width: `${overallProgress}%` }} />
        </div>
      </header>

      <div className="max-w-[1800px] mx-auto px-6 py-6 space-y-5">

        {/* ── FILTER BAR ── */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 flex flex-col lg:flex-row lg:items-center gap-4">
            {/* Search */}
            <div className="relative flex-1 min-w-0 max-w-sm">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeWidth="1.5"/><path d="M10 10l2.5 2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search deliverables, owners, tags…"
                className="w-full pl-9 pr-4 py-2 text-sm bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-violet-200 focus:border-violet-300 focus:bg-white outline-none transition-all" />
            </div>

            {/* Filter pills */}
            <div className="flex flex-wrap items-center gap-2">
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)}
                className="text-sm px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 focus:ring-2 focus:ring-violet-200 focus:border-violet-300 outline-none">
                <option value="">All statuses</option>
                <option value="not_started">Not started</option>
                <option value="in_progress">In progress</option>
                <option value="done">Done</option>
                <option value="blocked">Blocked</option>
              </select>

              <input value={ownerFilter} onChange={e => setOwnerFilter(e.target.value)} placeholder="Owner"
                className="w-28 text-sm px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-violet-200 focus:border-violet-300 outline-none" />

              <input value={tagFilter} onChange={e => setTagFilter(e.target.value)} placeholder="Tag"
                className="w-24 text-sm px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-violet-200 focus:border-violet-300 outline-none" />

              {/* Toggle filters */}
              {[
                { label: "Overdue", active: onlyOverdue, toggle: () => setOnlyOverdue(v => !v) },
                { label: "Blocked", active: onlyBlocked, toggle: () => setOnlyBlocked(v => !v) },
                { label: "Leaves", active: leavesOnly, toggle: () => setLeavesOnly(v => !v) },
                { label: "No effort", active: onlyMissingEffort, toggle: () => { setOnlyMissingEffort(v => !v); setLeavesOnly(true); } },
              ].map(f => (
                <button key={f.label} type="button" onClick={f.toggle}
                  className={`text-xs px-3 py-1.5 rounded-xl font-medium border transition-all ${f.active ? "bg-violet-600 text-white border-violet-600" : "bg-gray-50 text-gray-600 border-gray-200 hover:bg-gray-100"}`}>
                  {f.label}
                </button>
              ))}

              <button type="button" onClick={clearFilters} className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all">
                Clear
              </button>
            </div>

            {/* Right: views + meta */}
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <select value={activeViewId} onChange={e => { const id = e.target.value; setActiveViewId(id); if (id !== "__all") { const v = savedViews.find(x => x.id === id); if (v) applyViewState(v.state); } }}
                className="text-sm px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 text-gray-700 focus:ring-2 focus:ring-violet-200 outline-none max-w-[160px]">
                <option value="__all">All rows</option>
                {savedViews.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>

              <button onClick={saveCurrentAsView} disabled={!!readOnly} className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-all">Save view</button>
              <button onClick={renameActiveView} disabled={activeViewId === "__all"} className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-all">Rename</button>
              <button onClick={deleteActiveView} disabled={activeViewId === "__all"} className="text-xs px-3 py-1.5 rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-all">Delete</button>

              <div className="h-4 w-px bg-gray-200" />
              <button onClick={applyMyWorkFilter} className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all">My Work</button>
              <button onClick={setMyWorkFromOwner} className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-600 hover:bg-gray-50 transition-all">Set owner</button>

              <div className="h-4 w-px bg-gray-200" />

              {/* WBS due date */}
              <input type="date" value={doc.due_date ?? ""} disabled={!!readOnly}
                onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                onChange={e => updateDoc({ due_date: e.target.value })}
                className="text-sm px-3 py-2 rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-violet-200 outline-none" />

              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
                <input type="checkbox" checked={doc.auto_rollup !== false} disabled={!!readOnly} onChange={e => updateDoc({ auto_rollup: e.target.checked })}
                  className="rounded border-gray-300 text-violet-600 focus:ring-violet-300" />
                Roll-up
              </label>

              <span className="text-xs text-gray-500 font-medium bg-gray-100 px-2.5 py-1 rounded-full">
                {visibleRows.length} / {rolled.length}
              </span>
            </div>
          </div>

          {/* Date range */}
          <div className="px-5 pb-3 flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-500 font-medium">Due range:</span>
            <input type="date" value={dueFrom} onChange={e => setDueFrom(e.target.value)} className="text-sm px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-violet-200 outline-none" />
            <span className="text-xs text-gray-400">→</span>
            <input type="date" value={dueTo} onChange={e => setDueTo(e.target.value)} className="text-sm px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-50 focus:ring-2 focus:ring-violet-200 outline-none" />
          </div>
        </div>

        {/* ── EFFORT WARNING ── */}
        {missingEffortCount > 0 && (
          <div className="flex items-center justify-between gap-4 px-5 py-4 rounded-2xl bg-amber-50 border border-amber-200/80">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-amber-100 border border-amber-200 flex items-center justify-center text-amber-600 text-sm font-bold shrink-0">
                {missingEffortCount}
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-900">Work packages missing effort estimate</p>
                <p className="text-xs text-amber-700 mt-0.5">Roll-ups assume Medium — affects capacity reliability</p>
              </div>
            </div>
            <div className="flex gap-2 shrink-0">
              <button onClick={() => { setOnlyMissingEffort(v => !v); setLeavesOnly(true); setActiveViewId("__all"); }}
                className={`text-sm px-4 py-2 rounded-xl font-medium border transition-all ${onlyMissingEffort ? "bg-amber-600 text-white border-amber-600" : "bg-white text-amber-800 border-amber-300 hover:bg-amber-100"}`}>
                {onlyMissingEffort ? "Showing gaps ✓" : "Show gaps"}
              </button>
              <button onClick={jumpToNextEffortGap} className="text-sm px-4 py-2 rounded-xl border border-gray-200 bg-white hover:bg-gray-50 transition-all">
                Jump to next →
              </button>
            </div>
          </div>
        )}

        {/* ── MAIN GRID ── */}
        <div className="grid xl:grid-cols-12 gap-5">

          {/* ── ROWS ── */}
          <div className="xl:col-span-8 space-y-3">
            {visibleRows.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-white p-16 text-center">
                <div className="w-12 h-12 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="7" rx="1.5" stroke="#9ca3af" strokeWidth="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5" stroke="#9ca3af" strokeWidth="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5" stroke="#9ca3af" strokeWidth="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5" stroke="#9ca3af" strokeWidth="1.5"/></svg>
                </div>
                <p className="text-gray-700 font-semibold">No matching items</p>
                <p className="text-sm text-gray-400 mt-1">Adjust filters or add new entries</p>
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
                const accentClass = LEVEL_ACCENT[Math.min(r.level, LEVEL_ACCENT.length - 1)];
                const cfg = STATUS_CONFIG[statusShown];

                return (
                  <div key={r.id}
                    className={`group rounded-2xl bg-white border-l-4 ${accentClass} border-t border-r border-b transition-all duration-150 cursor-pointer ${
                      isSelected
                        ? "border-t-violet-200 border-r-violet-200 border-b-violet-200 ring-2 ring-violet-100 shadow-md"
                        : "border-t-gray-200 border-r-gray-200 border-b-gray-200 hover:shadow-md hover:border-t-gray-300 hover:border-r-gray-300 hover:border-b-gray-300"
                    }`}
                    onClick={() => { setSelectedRowId(r.id); setAssistantOpen(true); }}>

                    {/* ROW MAIN */}
                    <div className="flex items-center gap-3 px-4 pt-4 pb-3">
                      {/* Level indent + collapse btn */}
                      <div style={{ width: `${r.level * 24}px` }} className="shrink-0" />
                      {isParent ? (
                        <button onClick={e => { e.stopPropagation(); toggleCollapse(r.id); }}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all shrink-0 text-xs">
                          {isCollapsed ? "▸" : "▾"}
                        </button>
                      ) : (
                        <div className="w-7 shrink-0 flex items-center justify-center">
                          <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                        </div>
                      )}

                      {/* Code */}
                      <code className="text-xs font-mono text-gray-400 tabular-nums shrink-0 w-10 text-right">{r.code || "—"}</code>

                      {/* Deliverable */}
                      <input value={r.deliverable} placeholder={isParent ? "Phase / Group" : "Work Package"}
                        onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                        onChange={e => updateRow(r.id, { deliverable: e.target.value })}
                        disabled={!!readOnly}
                        onClick={e => e.stopPropagation()}
                        className={`flex-1 bg-transparent outline-none placeholder:text-gray-300 min-w-0 ${isParent ? "text-base font-semibold text-gray-900" : "text-sm font-medium text-gray-800"}`} />

                      {/* Badges */}
                      <div className="flex items-center gap-2 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                        {overdue && <span className="text-xs font-semibold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">Overdue</span>}
                        {effortMissing && <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">No effort</span>}
                        <button onClick={() => toggleDetails(r.id)}
                          className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-all">
                          {detailsOpen ? "Hide" : "Details"}
                        </button>
                        {!readOnly && <RowActions rowId={r.id} />}
                      </div>
                    </div>

                    {/* ROW META */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 px-4 pb-4" onClick={e => e.stopPropagation()}>
                      {/* Status */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">Status</label>
                        <select value={statusShown} disabled={!!readOnly || (doc?.auto_rollup !== false && isParent)}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={e => updateRow(r.id, { status: e.target.value as WbsStatus })}
                          className={`text-xs font-semibold rounded-xl px-3 py-1.5 border w-full disabled:opacity-60 outline-none focus:ring-2 focus:ring-violet-200 transition-all ${cfg.selectCls}`}>
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                          <option value="blocked">Blocked</option>
                        </select>
                      </div>

                      {/* Effort */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">Effort</label>
                        <select value={effortVal} disabled={!!readOnly}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={e => updateRow(r.id, { effort: normalizeEffort(e.target.value) })}
                          className={`text-xs font-semibold rounded-xl px-3 py-1.5 border w-full outline-none focus:ring-2 focus:ring-violet-200 transition-all ${effortMissing ? "bg-rose-50 border-rose-300 text-rose-700" : effortVal === "S" ? "bg-sky-50 border-sky-200 text-sky-700" : effortVal === "M" ? "bg-violet-50 border-violet-200 text-violet-700" : "bg-orange-50 border-orange-200 text-orange-700"}`}>
                          <option value="">— not set —</option>
                          <option value="S">S – Small</option>
                          <option value="M">M – Medium</option>
                          <option value="L">L – Large</option>
                        </select>
                      </div>

                      {/* Progress */}
                      <div>
                        <div className="flex justify-between items-center mb-1.5">
                          <label className="text-[10px] uppercase tracking-widest text-gray-400 font-semibold">Progress</label>
                          <span className="text-xs font-bold text-gray-700 tabular-nums">{progressShown}%</span>
                        </div>
                        <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full transition-all duration-500"
                            style={{ width: `${progressShown}%`, background: progressShown === 100 ? "#10b981" : progressShown > 50 ? "#6366f1" : "#a78bfa" }} />
                        </div>
                      </div>

                      {/* Due date */}
                      <div>
                        <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">Due date</label>
                        <input type="date" value={r.due_date ?? ""} disabled={!!readOnly}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={e => updateRow(r.id, { due_date: e.target.value })}
                          className={`text-xs w-full rounded-xl border px-3 py-1.5 outline-none focus:ring-2 focus:ring-violet-200 transition-all ${overdue ? "bg-rose-50 border-rose-300 text-rose-700" : "bg-gray-50 border-gray-200 text-gray-700"}`} />
                      </div>
                    </div>

                    {/* DETAILS PANEL */}
                    {detailsOpen && (
                      <div className="border-t border-gray-100 px-4 py-5 grid md:grid-cols-12 gap-5 bg-gray-50/50" onClick={e => e.stopPropagation()}>
                        <div className="md:col-span-4 space-y-4">
                          {[
                            { label: "Owner", value: r.owner ?? "", key: "owner", placeholder: "Assign owner" },
                            { label: "Predecessor", value: r.predecessor ?? "", key: "predecessor", placeholder: "e.g. 1.2" },
                            { label: "Tags", value: joinTags(r.tags), key: "tags", placeholder: "governance, risk…" },
                          ].map(field => (
                            <div key={field.key}>
                              <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">{field.label}</label>
                              <input value={field.value} disabled={!!readOnly} placeholder={field.placeholder}
                                onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                                onChange={e => updateRow(r.id, { [field.key]: field.key === "tags" ? parseTags(e.target.value) : e.target.value } as any)}
                                className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all" />
                            </div>
                          ))}
                        </div>
                        <div className="md:col-span-8 space-y-4">
                          <div>
                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">Description</label>
                            <textarea value={r.description ?? ""} disabled={!!readOnly} rows={3} placeholder="Context, notes, approach…"
                              onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                              onChange={e => updateRow(r.id, { description: e.target.value })}
                              className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 resize-y min-h-[72px] outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all" />
                          </div>
                          <div>
                            <label className="block text-[10px] uppercase tracking-widest text-gray-400 mb-1.5 font-semibold">Acceptance Criteria</label>
                            <textarea value={r.acceptance_criteria ?? ""} disabled={!!readOnly} rows={4} placeholder={"• Must be measurable\n• Must be testable"}
                              onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                              onChange={e => updateRow(r.id, { acceptance_criteria: e.target.value })}
                              className="w-full text-sm bg-white border border-gray-200 rounded-xl px-3 py-2 resize-y min-h-[96px] outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-300 transition-all" />
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}

            {readOnly && <p className="text-xs text-center text-gray-400 py-2">Read-only mode</p>}
          </div>

          {/* ── RIGHT RAIL ── */}
          <div className="xl:col-span-4 space-y-4">

            {/* AI ASSISTANT */}
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden sticky top-[76px]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 flex items-center justify-center">
                    <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1l1.5 4H13l-3.5 2.5 1.5 4L7 9 3 11.5 4.5 7.5 1 5h4.5L7 1z" fill="white" fillOpacity="0.9"/></svg>
                  </div>
                  <span className="text-sm font-semibold text-gray-900">AI Assistant</span>
                </div>
                <button onClick={() => setAssistantOpen(v => !v)}
                  className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 transition-all">
                  {assistantOpen ? "Hide" : "Open"}
                </button>
              </div>

              <div className="p-4">
                {!assistantOpen ? (
                  <p className="text-sm text-gray-400 text-center py-4">Click a row to open the assistant</p>
                ) : (
                  <LazyWbsAssistantRail
                    projectId={projectId} readOnly={!!readOnly} selectedRow={selectedRow}
                    onEnsureArtifact={async () => { await requestCreateArtifactIfNeeded("focus"); return safeStr(artifactIdLocal).trim(); }}
                    onUpdateRow={(rowId, patch) => updateRow(rowId, patch)}
                    onAppendDescription={(rowId, block) => { const row = coded.find(x => x.id === rowId); const existing = safeStr(row?.description); updateRow(rowId, { description: existing ? `${existing}\n\n${block}` : block }); }}
                    onExpandChildren={rowId => aiExpand(rowId)}
                    onMessage={text => { setMsg(text); setTimeout(() => setMsg(""), 1200); }}
                  />
                )}
              </div>
            </div>

            {/* VALIDATE PANEL */}
            {validateOpen && (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <span className="text-sm font-semibold text-gray-900">Validation</span>
                  <button onClick={() => setValidateOpen(false)} className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">Close</button>
                </div>
                <div className="p-4 space-y-3">
                  <p className="text-sm text-gray-600">{validateSummary}</p>
                  {aiIssues.length > 0 && (
                    <div className="space-y-2">
                      {aiIssues.map((x, i) => (
                        <div key={i} className={`rounded-xl px-4 py-3 text-sm border ${x.severity === "high" ? "border-rose-200 bg-rose-50" : x.severity === "medium" ? "border-amber-200 bg-amber-50" : "border-gray-200 bg-gray-50"}`}>
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${x.severity === "high" ? "text-rose-600" : x.severity === "medium" ? "text-amber-700" : "text-gray-500"}`}>{x.severity}</span>
                            {x.rowId && (
                              <button onClick={() => { setSelectedRowId(x.rowId!); setAssistantOpen(true); setMsg("Jumped to row"); setTimeout(() => setMsg(""), 1000); }}
                                className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600">
                                Jump →
                              </button>
                            )}
                          </div>
                          <p className="text-gray-700 text-xs leading-relaxed">{x.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* GENERATE PANEL */}
            {genOpen && (
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-violet-500 animate-pulse" />
                    <span className="text-sm font-semibold text-gray-900">AI Generated WBS</span>
                  </div>
                  <button onClick={() => { setGenOpen(false); setGeneratedDoc(null); }} className="text-xs px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50">Close</button>
                </div>
                <div className="p-4 space-y-4">
                  <p className="text-sm text-gray-600">{genLoading ? "Generating your WBS…" : generatedDoc ? "Preview ready. Apply to replace current rows." : "No output yet."}</p>
                  {generatedDoc && (
                    <>
                      <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 max-h-[200px] overflow-auto">
                        <pre className="text-xs text-gray-600 whitespace-pre-wrap">{JSON.stringify(generatedDoc, null, 2)}</pre>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={applyGeneratedDoc} disabled={!!readOnly}
                          className="flex-1 py-2 text-sm font-semibold rounded-xl bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-60 transition-all">
                          Apply WBS
                        </button>
                        <button onClick={() => generateWbs()} className="px-4 py-2 text-sm rounded-xl border border-gray-200 hover:bg-gray-50 transition-all">
                          Regenerate
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 text-center">This will replace all current rows</p>
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