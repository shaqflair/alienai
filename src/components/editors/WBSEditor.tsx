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

/**
 * ✅ Lazy-load the right-rail AI assistant.
 * - not in initial bundle
 * - only loaded/mounted when panel is visible (assistantOpen === true)
 */
const LazyWbsAssistantRail = dynamic(() => import("./wbs/WbsAssistantRail"), {
  ssr: false,
  loading: () => null,
});

function uuidish() {
  return crypto?.randomUUID?.() ?? `r_${Math.random().toString(16).slice(2)}_${Date.now()}`;
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

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  const arr = safeParseJson<SavedView[]>(window.localStorage.getItem(LS_KEY_VIEWS));
  if (!Array.isArray(arr)) return [];
  return arr
    .filter(
      (v) =>
        v &&
        typeof v === "object" &&
        typeof (v as any).id === "string" &&
        typeof (v as any).name === "string" &&
        (v as any).state &&
        typeof (v as any).createdAt === "string"
    )
    .slice(0, 50);
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

function isEffortMissing(e: any) {
  return !normalizeEffort(e);
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
      { id: uuidish(), level: 0, deliverable: "Project Governance & Management", status: "in_progress", effort: "M" },
      { id: uuidish(), level: 1, deliverable: "Project Charter", status: "done", effort: "S" },
      { id: uuidish(), level: 1, deliverable: "Stakeholder Register", status: "in_progress", effort: "S" },
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
    const code = parts.join(".");
    return { ...r, level: lvl, code };
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

function StatusPill({ s }: { s: WbsStatus }) {
  const map: Record<WbsStatus, string> = {
    not_started: "bg-slate-500/10 text-slate-700 ring-1 ring-slate-600/20",
    in_progress: "bg-indigo-500/12 text-indigo-700 ring-1 ring-indigo-600/20",
    done: "bg-emerald-500/15 text-emerald-700 ring-1 ring-emerald-600/20",
    blocked: "bg-rose-500/15 text-rose-700 ring-1 ring-rose-600/20",
  };
  const label: Record<WbsStatus, string> = {
    not_started: "Not started",
    in_progress: "In progress",
    done: "Done",
    blocked: "Blocked",
  };
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${map[s]}`}>
      {label[s]}
    </span>
  );
}

function effortWeight(e: Effort | undefined) {
  if (e === "S") return 1;
  if (e === "L") return 3;
  return 2;
}

function statusScore(s: WbsStatus | undefined) {
  if (s === "done") return 1;
  if (s === "in_progress") return 0.5;
  if (s === "blocked") return 0;
  return 0;
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
      out[i]._derivedStatus = ((out[i].status ?? "not_started") as WbsStatus) || "not_started";
      out[i]._derivedProgress = Math.round(statusScore(out[i]._derivedStatus) * 100);
      continue;
    }

    const { start, end } = subtreeRange(out, i);
    const leafs: any[] = [];
    for (let j = start + 1; j < end; j++) {
      const childIsParent = rowHasChildren(out, j);
      if (!childIsParent) leafs.push(out[j]);
    }

    if (leafs.length === 0) {
      out[i]._derivedStatus = ((out[i].status ?? "not_started") as WbsStatus) || "not_started";
      out[i]._derivedProgress = Math.round(statusScore(out[i]._derivedStatus) * 100);
      continue;
    }

    const anyBlocked = leafs.some((x) => ((x.status ?? "not_started") as WbsStatus) === "blocked");
    const allDone = leafs.every((x) => ((x.status ?? "not_started") as WbsStatus) === "done");
    const anyStarted = leafs.some((x) => {
      const s = ((x.status ?? "not_started") as WbsStatus) || "not_started";
      return s === "in_progress" || s === "done";
    });

    const derivedStatus: WbsStatus =
      anyBlocked ? "blocked" : allDone ? "done" : anyStarted ? "in_progress" : "not_started";

    let wSum = 0;
    let pSum = 0;
    for (const x of leafs) {
      const w = effortWeight(normalizeEffort(x.effort));
      wSum += w;
      pSum += w * statusScore(((x.status ?? "not_started") as WbsStatus) || "not_started");
    }
    const pct = wSum ? Math.round((pSum / wSum) * 100) : 0;

    out[i]._derivedStatus = derivedStatus;
    out[i]._derivedProgress = Math.max(0, Math.min(100, pct));
  }

  return out;
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

// ✅ FIXED: Added status parameter - completed tasks are never overdue
function isOverdue(rowDue: string | undefined, status?: WbsStatus) {
  if (status === "done") return false;
  const d = safeStr(rowDue);
  if (!d) return false;
  return d < todayISO();
}

async function safeJson(res: Response) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

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
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}

const DEFAULT_VIEW_STATE: ViewState = {
  q: "",
  ownerFilter: "",
  statusFilter: "",
  tagFilter: "",
  dueFrom: "",
  dueTo: "",
  onlyOverdue: false,
  onlyBlocked: false,
  leavesOnly: false,
  onlyMissingEffort: false,
};

type SaveMode = "idle" | "dirty" | "saving" | "saved" | "error";

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
  const [title, setTitle] = useState<string>(
    () => normalizeInitial(initialJson)?.title || "Work Breakdown Structure"
  );

  const [msg, setMsg] = useState<string>("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMode, setSaveMode] = useState<SaveMode>("idle");
  const [lastSavedAt, setLastSavedAt] = useState<string>("");

  const lastHydratedRef = useRef<string>("");
  const initialFingerprint = useMemo(() => {
    try {
      return typeof initialJson === "string" ? initialJson : JSON.stringify(initialJson ?? {});
    } catch {
      return String(initialJson ?? "");
    }
  }, [initialJson]);

  // local id that can be created on first save / first edit
  const [artifactIdLocal, setArtifactIdLocal] = useState<string>(() => safeStr(artifactId).trim());

  // keep in sync if parent passes a real id later
  useEffect(() => {
    const v = safeStr(artifactId).trim();
    if (v && v !== artifactIdLocal) setArtifactIdLocal(v);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifactId]);

  const [exportingXlsx, setExportingXlsx] = useState(false);

  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  // Filters / views
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

  // AI validate
  const [aiIssues, setAiIssues] = useState<
    Array<{ severity: "high" | "medium" | "low"; message: string; rowId?: string }>
  >([]);
  const [validateOpen, setValidateOpen] = useState(false);
  const [validateSummary, setValidateSummary] = useState<string>("");

  // ✅ AI assistant rail now becomes lazy
  // default to true if you want the rail visible at start, but still lazy-loaded.
  const [assistantOpen, setAssistantOpen] = useState(false);

  // AI generate
  const [genOpen, setGenOpen] = useState(false);
  const [genLoading, setGenLoading] = useState(false);
  const [generatedDoc, setGeneratedDoc] = useState<any | null>(null);

  // autosave timers
  const autosaveTimerRef = useRef<any>(null);
  const autosaveInFlightRef = useRef(false);

  // auto-create guard
  const createInFlightRef = useRef(false);

  // Hydrate on initialJson changes (only when not dirty)
  useEffect(() => {
    if (dirty) return;
    if (initialFingerprint && initialFingerprint !== lastHydratedRef.current) {
      lastHydratedRef.current = initialFingerprint;
      const next = normalizeInitial(initialJson);
      setDoc(next);
      setTitle(next.title || "Work Breakdown Structure");
      setSaveMode("idle");
    }
  }, [initialFingerprint, artifactId, dirty, initialJson]);

  useEffect(() => {
    setSavedViews(loadSavedViews());
    if (typeof window !== "undefined") {
      setMyWorkOwner(safeStr(window.localStorage.getItem(LS_KEY_MYWORK)));
    }
  }, []);

  const coded = useMemo(() => computeCodes(doc.rows ?? []), [doc.rows]);
  const rolled = useMemo(() => deriveRollups(coded, doc.auto_rollup !== false), [coded, doc.auto_rollup]);

  const selectedRow = useMemo(() => coded.find((r) => r.id === selectedRowId) ?? null, [coded, selectedRowId]);

  // Auto-create artifact ASAP (so toolbar doesn't show "Missing artifactId")
  useEffect(() => {
    if (readOnly) return;
    if (artifactIdLocal) return;

    const t = setTimeout(() => {
      void requestCreateArtifactIfNeeded("focus");
    }, 50);

    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, artifactIdLocal]);

  // close row menu on escape / outside click
  useEffect(() => {
    if (!openRowId) return;

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenRowId(null);
    }

    function onPointerDown(e: PointerEvent) {
      const el = e.target as HTMLElement | null;
      if (!el) return;
      if (el.closest?.("[data-wbs-rowmenu]")) return;
      setOpenRowId(null);
    }

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, { capture: true });

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, { capture: true } as any);
    };
  }, [openRowId]);

  function markDirty() {
    if (!dirty) setDirty(true);
    setSaveMode("dirty");
    // fire-and-forget create on first edit (so UI never shows "missing artifact")
    void requestCreateArtifactIfNeeded("edit");
  }

  async function requestCreateArtifactIfNeeded(_reason: "edit" | "focus" | "autosave") {
    if (readOnly) return;
    if (artifactIdLocal) return;
    if (createInFlightRef.current) return;

    const safeProjectId = safeStr(projectId).trim();
    if (!safeProjectId) return;

    createInFlightRef.current = true;
    try {
      const content = serialize({
        ...doc,
        title: title.trim() || "Work Breakdown Structure",
        rows: computeCodes(doc.rows ?? []),
      });
      const id = await ensureArtifactIdOrCreate(content);
      if (id) {
        // best-effort refresh so any server-rendered header that depends on artifactId updates
        try {
          router.refresh();
        } catch {}
      }
    } catch (e) {
      console.warn("WBS auto-create failed:", e);
    } finally {
      createInFlightRef.current = false;
    }
  }

  function updateRow(id: string, patch: Partial<WbsRow>) {
    markDirty();
    setDoc((prev) => ({
      ...prev,
      rows: (prev.rows ?? []).map((r) => (r.id === id ? { ...r, ...patch } : r)),
    }));
  }

  function updateDoc(patch: Partial<WbsDocV1>) {
    markDirty();
    setDoc((prev) => ({ ...prev, ...patch }));
  }

  function insertAt(index: number, row: WbsRow) {
    markDirty();
    setDoc((prev) => {
      const out = [...prev.rows];
      out.splice(index, 0, row);
      return { ...prev, rows: out };
    });
  }

  function addSibling(afterId: string) {
    markDirty();
    setDoc((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === afterId);
      if (idx < 0) return prev;
      const base = prev.rows[idx];
      const next: WbsRow = {
        id: uuidish(),
        level: base.level,
        deliverable: "",
        description: "",
        acceptance_criteria: "",
        owner: "",
        status: "not_started",
        effort: "",
        due_date: "",
        predecessor: "",
        tags: [],
      };
      const out = [...prev.rows];
      out.splice(idx + 1, 0, next);
      return { ...prev, rows: out };
    });
    setExpanded((p) => {
      const n = new Set(p);
      n.add(afterId);
      return n;
    });
  }

  function addChild(parentId: string) {
    markDirty();
    setDoc((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === parentId);
      if (idx < 0) return prev;
      const parent = prev.rows[idx];
      let insertIndex = idx + 1;
      for (let i = idx + 1; i < prev.rows.length; i++) {
        if (prev.rows[i].level <= parent.level) break;
        insertIndex = i + 1;
      }
      const next: WbsRow = {
        id: uuidish(),
        level: clamp(parent.level + 1, 0, 10),
        deliverable: "",
        description: "",
        acceptance_criteria: "",
        owner: "",
        status: "not_started",
        effort: "",
        due_date: "",
        predecessor: "",
        tags: [],
      };
      const out = [...prev.rows];
      out.splice(insertIndex, 0, next);
      return { ...prev, rows: out };
    });

    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(parentId);
      return next;
    });

    setExpanded((p) => {
      const n = new Set(p);
      n.add(parentId);
      return n;
    });
  }

  function indent(id: string) {
    markDirty();
    setDoc((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === id);
      if (idx <= 0) return prev;
      const prevRow = prev.rows[idx - 1];
      const cur = prev.rows[idx];
      const nextLevel = clamp(cur.level + 1, 0, (prevRow.level ?? 0) + 1);
      const out = [...prev.rows];
      out[idx] = { ...cur, level: nextLevel };
      return { ...prev, rows: out };
    });
  }

  function outdent(id: string) {
    markDirty();
    setDoc((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === id);
      if (idx < 0) return prev;
      const cur = prev.rows[idx];
      const out = [...prev.rows];
      out[idx] = { ...cur, level: clamp(cur.level - 1, 0, 10) };
      return { ...prev, rows: out };
    });
  }

  function removeRow(id: string) {
    markDirty();
    setDoc((prev) => {
      const idx = prev.rows.findIndex((r) => r.id === id);
      if (idx < 0) return prev;
      const target = prev.rows[idx];
      let end = idx + 1;
      for (let i = idx + 1; i < prev.rows.length; i++) {
        if (prev.rows[i].level <= target.level) break;
        end = i + 1;
      }
      const out = [...prev.rows];
      out.splice(idx, end - idx);
      const nextRows = out.length ? out : [{ id: uuidish(), level: 0, deliverable: "", effort: "", status: "not_started" }];
      return { ...prev, rows: nextRows };
    });

    setCollapsed((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setExpanded((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (selectedRowId === id) {
      setSelectedRowId(null);
    }
  }

  function toggleCollapse(rowId: string) {
    setCollapsed((prev) => {
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

  function statusShownForRow(r: any, autoRollup: boolean) {
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
    for (const r of rolled as any[]) {
      const isParent = !!r._isParent;
      if (isParent) continue;
      if (isEffortMissing(r.effort)) ids.push(r.id);
    }
    return ids;
  }, [rolled]);

  const missingEffortCount = missingEffortLeafIds.length;

  function jumpToNextEffortGap() {
    if (!missingEffortLeafIds.length) return;
    const curIdx = selectedRowId ? missingEffortLeafIds.indexOf(selectedRowId) : -1;
    const nextId = missingEffortLeafIds[(curIdx + 1 + missingEffortLeafIds.length) % missingEffortLeafIds.length];
    setSelectedRowId(nextId);
    setAssistantOpen(true);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add(nextId);
      return next;
    });
    setMsg("⚠️ Next effort gap selected");
    setTimeout(() => setMsg(""), 1200);
  }

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

    if (ownerF) {
      if (!owner.includes(ownerF)) return false;
    }

    if (statusFilter) {
      const shown = statusShownForRow(r, doc.auto_rollup !== false);
      if (shown !== statusFilter) return false;
    }

    if (tagF) {
      const hit = tags.some((t: string) => t.includes(tagF)) || deliverable.includes(tagF) || pred.includes(tagF);
      if (!hit) return false;
    }

    if (onlyOverdue) {
      const rowStatus = statusShownForRow(r, doc.auto_rollup !== false);
      if (!isOverdue(r.due_date, rowStatus)) return false;
    }

    if (onlyBlocked) {
      const shown = statusShownForRow(r, doc.auto_rollup !== false);
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

    if (leavesOnly) {
      if ((r as any)._isParent) return false;
    }

    if (onlyMissingEffort) {
      if ((r as any)._isParent) return false;
      if (!isEffortMissing(r.effort)) return false;
    }

    return true;
  }

  const filtered = useMemo(
    () => rolled.filter(rowMatchesSlicers),
    [rolled, q, ownerFilter, statusFilter, tagFilter, dueFrom, dueTo, onlyOverdue, onlyBlocked, leavesOnly, onlyMissingEffort, doc.auto_rollup]
  );

  const visibleRows = useMemo(() => applyCollapseStateToVisible(filtered), [filtered, collapsed]);

  // IMPORTANT: this function MUST NOT leak variables like "res" out of scope.
  async function ensureArtifactIdOrCreate(content: any): Promise<string> {
    const existing = safeStr(artifactIdLocal).trim();
    if (existing) return existing;

    const safeProjectId = safeStr(projectId).trim();
    if (!safeProjectId) throw new Error("Missing projectId (cannot create artifact)");

    const body = {
      projectId: safeProjectId,
      project_id: safeProjectId,
      title: (safeStr(title).trim() || "Work Breakdown Structure").trim(),
      type: "wbs",
      artifact_type: "wbs",
      content_json: content,
      contentJson: content,
      // optional legacy strings (safe)
      content: JSON.stringify(content),
      content_json_string: JSON.stringify(content),
    };

    const resp = await fetch(`/api/artifacts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const j = await safeJson(resp);
    if (!resp.ok) {
      throw new Error(safeStr(j?.error) || safeStr(j?.message) || safeStr(j?.details) || `Create failed (${resp.status})`);
    }

    const newId =
      safeStr(j?.id) ||
      safeStr(j?.artifact?.id) ||
      safeStr(j?.data?.id) ||
      safeStr(j?.data?.artifact?.id);

    if (!newId) throw new Error("Create succeeded but no artifact id returned");

    // set local immediately so UI stops saying "Missing artifactId"
    setArtifactIdLocal(newId);

    // notify anything above us that listens for artifact id changes
    try {
      window.dispatchEvent(
        new CustomEvent("artifact-created", { detail: { artifactId: newId, projectId: safeProjectId } })
      );
    } catch {}

    // update URL if needed (best-effort)
    try {
      const u = new URL(window.location.href);
      if (!u.searchParams.get("artifactId")) {
        u.searchParams.set("artifactId", newId);
        router.replace(u.pathname + "?" + u.searchParams.toString());
      }
    } catch {}

    // refresh server components that may read artifactId from params/data
    try {
      router.refresh();
    } catch {}

    return newId;
  }

  async function saveInternal(opts?: { silent?: boolean }) {
    if (saving || readOnly) return;

    const silent = !!opts?.silent;
    setMsg("");

    const safeProjectId = safeStr(projectId).trim();
    const safeArtifactId = safeStr(artifactIdLocal).trim();

    if (!safeProjectId || !safeArtifactId) {
      if (!silent) setMsg("⛔ Missing project or artifact id");
      setSaveMode("error");
      return;
    }

    setSaving(true);
    setSaveMode("saving");

    try {
      const content = serialize({
        ...doc,
        title: title.trim() || "Work Breakdown Structure",
        rows: computeCodes(doc.rows ?? []),
      });

      const payload = {
        projectId: safeProjectId,
        title: title.trim() || "Work Breakdown Structure",
        content_json: content,
      };

      const resp = await fetch(`/api/artifacts/${safeArtifactId}/content-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await resp.json().catch(() => null);

      if (!resp.ok || json?.ok === false) {
        throw new Error(json?.error || json?.message || `Save failed (${resp.status})`);
      }

      setDirty(false);
      setSaveMode("saved");
      setLastSavedAt(new Date().toISOString());

      if (!silent) {
        setMsg("✅ Saved");
        setTimeout(() => setMsg(""), 1200);
      }
    } catch (e: any) {
      setSaveMode("error");
      if (!silent) setMsg(`⛔ ${e?.message || "Save failed"}`);
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    await saveInternal({ silent: false });
  }

  // AUTOSAVE: debounce after last change
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, doc, title, readOnly]);

  // flush autosave on unload (best-effort)
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onBeforeUnload() {
      try {
        if (!dirty) return;
        const aid = safeStr(artifactIdLocal).trim();
        if (!aid) return;
        const safeProjectId = safeStr(projectId).trim();
        if (!safeProjectId) return;

        const content = serialize({
          ...doc,
          title: title.trim() || "Work Breakdown Structure",
          rows: computeCodes(doc.rows ?? []),
        });

        const payload = JSON.stringify({
          artifactId: aid,
          artifact_id: aid,
          projectId: safeProjectId,
          project_id: safeProjectId,
          title: title.trim() || "Work Breakdown Structure",
          content_json: content,
          contentJson: content,
          content: JSON.stringify(content),
          content_json_string: JSON.stringify(content),
        });

        const url = `/api/artifacts/${aid}/content-json`;
        const blob = new Blob([payload], { type: "application/json" });
        (navigator as any).sendBeacon?.(url, blob);
      } catch {}
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, artifactIdLocal, projectId, doc, title]);

  async function exportXlsx() {
    if (exportingXlsx) return;
    setMsg("");
    setExportingXlsx(true);
    try {
      await requestCreateArtifactIfNeeded("focus");

      const effectiveArtifactId = safeStr(artifactIdLocal).trim();
      if (!effectiveArtifactId) throw new Error("Missing artifactId");

      const base = `WBS_${effectiveArtifactId.slice(0, 8)}_${todayISO()}`;
      const qs = new URLSearchParams();
      qs.set("projectId", projectId);
      qs.set("artifactId", effectiveArtifactId);
      qs.set("filename", base);

      const resp = await fetch(`/api/artifacts/wbs/export/xlsx?${qs.toString()}`, { method: "GET" });
      if (!resp.ok) {
        const j = await safeJson(resp);
        throw new Error(safeStr(j?.error) || `Export failed (${resp.status})`);
      }

      const blob = await resp.blob();
      const fn = pickFilenameFromDisposition(resp.headers.get("content-disposition"), `${base}.xlsx`);
      downloadBlob(blob, fn);

      setMsg("✅ XLSX downloaded");
      setTimeout(() => setMsg(""), 1200);
    } catch (e: any) {
      setMsg(`⛔ ${e?.message ?? "Export failed"}`);
    } finally {
      setExportingXlsx(false);
    }
  }

  // ✅ Keep aiExpand + aiValidate in parent (used by row menu + validate panel)
  async function aiExpand(rowId: string) {
    const base = coded.find((r) => r.id === rowId);
    if (!base) return;
    setMsg("");
    await requestCreateArtifactIfNeeded("focus");
    const effectiveArtifactId = safeStr(artifactIdLocal).trim();
    if (!effectiveArtifactId) {
      setMsg("⛔ Missing artifactId");
      setTimeout(() => setMsg(""), 1200);
      return;
    }

    startTransition(async () => {
      try {
        const resp = await fetch(`/api/ai/wbs/expand`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            artifactId: effectiveArtifactId,
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
        if (!resp.ok) throw new Error(j?.error || `AI expand failed (${resp.status})`);
        const children = Array.isArray(j?.children) ? (j.children as any[]) : [];
        if (children.length === 0) {
          setMsg("ℹ️ No expansion suggested");
          setTimeout(() => setMsg(""), 1200);
          return;
        }

        const idx = doc.rows.findIndex((r) => r.id === rowId);
        if (idx < 0) return;

        const baseLevel = doc.rows[idx].level;
        let insertIndex = idx + 1;
        for (let i = idx + 1; i < doc.rows.length; i++) {
          if (doc.rows[i].level <= baseLevel) break;
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
            deliverable: safeStr(c.deliverable),
            description: safeStr(c.description),
            acceptance_criteria: safeStr(c.acceptance_criteria),
            owner: safeStr(c.owner),
            status: (((c.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus,
            effort: normalizeEffort(c.effort),
            due_date: safeStr(c.due_date),
            predecessor: safeStr(c.predecessor),
            tags: Array.isArray(c.tags) ? c.tags.map((t: any) => safeStr(t)).filter(Boolean) : [],
          });
        }

        setExpanded((p) => {
          const n = new Set(p);
          n.add(rowId);
          return n;
        });

        setMsg("✅ AI expanded");
        setTimeout(() => setMsg(""), 1200);
      } catch (e: any) {
        setMsg(`⛔ ${e?.message ?? "AI expand failed"}`);
      }
    });
  }

  async function aiValidate() {
    setMsg("");
    setValidateOpen(true);
    setValidateSummary("Validating…");
    await requestCreateArtifactIfNeeded("focus");
    const effectiveArtifactId = safeStr(artifactIdLocal).trim();
    if (!effectiveArtifactId) {
      setValidateSummary("⛔ Missing artifactId");
      setMsg("⛔ Missing artifactId");
      setTimeout(() => setMsg(""), 1200);
      return;
    }

    startTransition(async () => {
      try {
        const resp = await fetch(`/api/ai/wbs/validate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            projectId,
            artifactId: effectiveArtifactId,
            due_date: doc.due_date ?? "",
            rows: computeCodes(doc.rows ?? []),
          }),
        });

        const j = await resp.json().catch(() => ({}));
        if (!resp.ok) throw new Error(j?.error || `AI validate failed (${resp.status})`);

        const issues = Array.isArray(j?.issues) ? j.issues : [];
        setAiIssues(
          issues.map((x: any) => ({
            severity: (x?.severity ?? "low") as any,
            message: safeStr(x?.message),
            rowId: safeStr(x?.rowId),
          }))
        );

        const summary = issues.length ? `Found ${issues.length} improvement(s)` : "Looks good — no issues found.";
        setValidateSummary(summary);
        setMsg(`✅ ${summary}`);
        setTimeout(() => setMsg(""), 1200);
      } catch (e: any) {
        setValidateSummary(`⛔ ${e?.message ?? "AI validate failed"}`);
        setMsg(`⛔ ${e?.message ?? "AI validate failed"}`);
      }
    });
  }

  async function generateWbs() {
    setGenOpen(true);
    setGenLoading(true);
    setGeneratedDoc(null);

    await requestCreateArtifactIfNeeded("focus");
    const effectiveArtifactId = safeStr(artifactIdLocal).trim();
    if (!effectiveArtifactId) {
      setMsg("⛔ Missing artifactId");
      setTimeout(() => setMsg(""), 1200);
      setGenOpen(false);
      setGenLoading(false);
      return;
    }

    try {
      const resp = await fetch(`/api/ai/wbs/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          artifactId: effectiveArtifactId,
          due_date: doc.due_date ?? "",
        }),
      });

      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error || `Generate failed (${resp.status})`);
      setGeneratedDoc(j?.generated ?? null);
    } catch (e: any) {
      setMsg(`⛔ ${e?.message ?? "Generate failed"}`);
      setTimeout(() => setMsg(""), 1200);
      setGenOpen(false);
    } finally {
      setGenLoading(false);
    }
  }

  // Saved views helpers
  function getCurrentViewState(): ViewState {
    return { q, ownerFilter, statusFilter, tagFilter, dueFrom, dueTo, onlyOverdue, onlyBlocked, leavesOnly, onlyMissingEffort };
  }

  function applyViewState(state: ViewState) {
    setQ(state.q ?? "");
    setOwnerFilter(state.ownerFilter ?? "");
    setStatusFilter((state.statusFilter ?? "") as any);
    setTagFilter(state.tagFilter ?? "");
    setDueFrom(state.dueFrom ?? "");
    setDueTo(state.dueTo ?? "");
    setOnlyOverdue(!!state.onlyOverdue);
    setOnlyBlocked(!!state.onlyBlocked);
    setLeavesOnly(!!state.leavesOnly);
    setOnlyMissingEffort(!!state.onlyMissingEffort);
  }

  function clearFilters() {
    setActiveViewId("__all");
    applyViewState(DEFAULT_VIEW_STATE);
  }

  function saveCurrentAsView() {
    const name = prompt("Save view as:", "My view");
    if (!name) return;

    const v: SavedView = {
      id: uuidish(),
      name: name.trim().slice(0, 48),
      state: getCurrentViewState(),
      createdAt: new Date().toISOString(),
    };

    const next = [v, ...savedViews].slice(0, 50);
    setSavedViews(next);
    persistSavedViews(next);

    setActiveViewId(v.id);
    setMsg("✅ View saved");
    setTimeout(() => setMsg(""), 1200);
  }

  function deleteActiveView() {
    if (!activeViewId || activeViewId === "__all") return;
    const v = savedViews.find((x) => x.id === activeViewId);
    if (!v) return;
    const ok = confirm(`Delete saved view "${v.name}"?`);
    if (!ok) return;

    const next = savedViews.filter((x) => x.id !== activeViewId);
    setSavedViews(next);
    persistSavedViews(next);

    setActiveViewId("__all");
    setMsg("✅ View deleted");
    setTimeout(() => setMsg(""), 1200);
  }

  function renameActiveView() {
    if (!activeViewId || activeViewId === "__all") return;
    const v = savedViews.find((x) => x.id === activeViewId);
    if (!v) return;

    const name = prompt("Rename view:", v.name);
    if (!name) return;

    const next = savedViews.map((x) => (x.id === v.id ? { ...x, name: name.trim().slice(0, 48) } : x));
    setSavedViews(next);
    persistSavedViews(next);

    setMsg("✅ View renamed");
    setTimeout(() => setMsg(""), 1200);
  }

  function setMyWorkFromOwner() {
    const v = prompt("Set My Work owner (used for quick filtering):", myWorkOwner || "");
    if (v == null) return;
    const next = v.trim().slice(0, 80);
    setMyWorkOwner(next);
    try {
      window.localStorage.setItem(LS_KEY_MYWORK, next);
    } catch {}
    setMsg("✅ My Work owner set");
    setTimeout(() => setMsg(""), 1200);
  }

  function applyMyWorkFilter() {
    if (!myWorkOwner.trim()) {
      setMsg("ℹ️ Set 'My Work owner' first");
      setTimeout(() => setMsg(""), 1200);
      return;
    }
    setActiveViewId("__all");
    setOwnerFilter(myWorkOwner.trim());
    setMsg("✅ My Work filter applied");
    setTimeout(() => setMsg(""), 1200);
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

    const [pos, setPos] = useState<{ top: number; left: number; placement: "bottom" | "top" }>({
      top: 0,
      left: 0,
      placement: "bottom",
    });

    const idx = rowMeta.idToIndex.get(rowId) ?? -1;
    const hasChildren = rowMeta.idToHasChildren.get(rowId) ?? false;

    const canIndent = !readOnly && idx > 0;
    const canOutdent = !readOnly && idx >= 0 && (coded[idx]?.level ?? 0) > 0;
    const canDelete = !readOnly && !hasChildren;

    function computePosition() {
      const el = btnRef.current;
      if (!el || typeof window === "undefined") return;
      const r = el.getBoundingClientRect();
      const menuW = 224;
      const pad = 12;
      const left = clamp(r.left, pad, window.innerWidth - menuW - pad);
      let top = r.bottom + 8;
      let placement: "bottom" | "top" = "bottom";
      const menuH = menuRef.current?.getBoundingClientRect().height ?? 320;

      if (top + menuH > window.innerHeight - pad) {
        const aboveTop = r.top - menuH - 8;
        if (aboveTop >= pad) {
          top = aboveTop;
          placement = "top";
        } else {
          top = clamp(top, pad, window.innerHeight - menuH - pad);
        }
      }

      setPos({ top, left, placement });
    }

    useLayoutEffect(() => {
      if (!open) return;
      computePosition();
      function onScrollOrResize() {
        computePosition();
      }
      window.addEventListener("resize", onScrollOrResize);
      window.addEventListener("scroll", onScrollOrResize, { capture: true });
      return () => {
        window.removeEventListener("resize", onScrollOrResize);
        window.removeEventListener("scroll", onScrollOrResize, { capture: true } as any);
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, rowId, idx, coded.length]);

    const menu = open ? (
      <div
        ref={menuRef}
        data-wbs-rowmenu
        className="fixed w-56 rounded-xl border bg-white shadow-lg overflow-hidden z-[9999]"
        style={{ top: pos.top, left: pos.left }}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          disabled={!!readOnly}
          onClick={() => {
            setOpenRowId(null);
            addSibling(rowId);
          }}
        >
          + Add sibling
        </button>
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          disabled={!!readOnly}
          onClick={() => {
            setOpenRowId(null);
            addChild(rowId);
          }}
        >
          + Add child
        </button>
        <div className="h-px bg-gray-100" />
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          disabled={!canIndent}
          title={!canIndent ? "Cannot indent the first row" : "Indent"}
          onClick={() => {
            setOpenRowId(null);
            indent(rowId);
          }}
        >
          Indent →
        </button>
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          disabled={!canOutdent}
          title={!canOutdent ? "Already at level 0" : "Outdent"}
          onClick={() => {
            setOpenRowId(null);
            outdent(rowId);
          }}
        >
          ← Outdent
        </button>
        <div className="h-px bg-gray-100" />
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          disabled={!!readOnly}
          onClick={async () => {
            setOpenRowId(null);
            await requestCreateArtifactIfNeeded("focus");
            aiExpand(rowId);
          }}
        >
          ✨ AI Expand
        </button>
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-50"
          disabled={!!readOnly}
          onClick={async () => {
            setOpenRowId(null);
            setSelectedRowId(rowId);
            setAssistantOpen(true);
          }}
        >
          🤖 AI Assistant
        </button>
        <div className="h-px bg-gray-100" />
        <button
          type="button"
          className="w-full text-left px-3 py-2 text-sm hover:bg-rose-50 text-rose-700 disabled:opacity-50"
          disabled={!canDelete}
          title={!canDelete ? "Delete is disabled for parent rows (remove children first)" : "Delete"}
          onClick={() => {
            setOpenRowId(null);
            removeRow(rowId);
          }}
        >
          Delete
        </button>
      </div>
    ) : null;

    return (
      <div data-wbs-rowmenu className="inline-flex" onClick={(e) => e.stopPropagation()}>
        <button
          ref={btnRef}
          type="button"
          onClick={async () => {
            await requestCreateArtifactIfNeeded("focus");
            setOpenRowId(open ? null : rowId);
          }}
          className="px-2 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 text-xs"
          disabled={!!readOnly}
          title="Row actions"
        >
          ⋯
        </button>
        {open && typeof document !== "undefined" ? createPortal(menu, document.body) : null}
      </div>
    );
  }

  function toggleDetails(rowId: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  function applyGeneratedDoc() {
    if (!generatedDoc) return;

    const nextRows = Array.isArray(generatedDoc?.rows) ? generatedDoc.rows : [];
    if (!Array.isArray(nextRows) || nextRows.length === 0) {
      setMsg("⛔ Generated doc has no rows");
      setTimeout(() => setMsg(""), 1200);
      return;
    }

    markDirty();
    setDoc((prev) => ({
      ...prev,
      title: safeStr(generatedDoc?.title) || prev.title || "Work Breakdown Structure",
      due_date: safeStr(generatedDoc?.due_date) || prev.due_date || "",
      rows: nextRows.map((r: any) => ({
        id: safeStr(r?.id) || uuidish(),
        level: clamp(Number(r?.level ?? 0), 0, 10),
        deliverable: safeStr(r?.deliverable),
        description: safeStr(r?.description),
        acceptance_criteria: safeStr(r?.acceptance_criteria),
        owner: safeStr(r?.owner),
        status: (((r?.status ?? "not_started") as WbsStatus) || "not_started") as WbsStatus,
        effort: normalizeEffort(r?.effort),
        due_date: safeStr(r?.due_date),
        predecessor: safeStr(r?.predecessor),
        tags: Array.isArray(r?.tags) ? r.tags.map((t: any) => safeStr(t)).filter(Boolean) : [],
      })),
    }));

    setTitle(safeStr(generatedDoc?.title) || title);
    setGenOpen(false);
    setMsg("✅ Generated WBS applied");
    setTimeout(() => setMsg(""), 1200);
  }

  function SaveIndicator() {
    // if we STILL don't have an id, show it explicitly (so you can see creation didn't happen)
    const missingId = !readOnly && !safeStr(artifactIdLocal).trim();

    const label =
      missingId
        ? "Missing artifactId"
        : saveMode === "saving"
        ? "Saving…"
        : saveMode === "dirty"
        ? "Unsaved changes"
        : saveMode === "saved"
        ? "All changes saved"
        : saveMode === "error"
        ? "Save failed"
        : "";

    if (!label) return null;

    const cls = missingId
      ? "bg-rose-50 text-rose-800 border-rose-200"
      : saveMode === "saving"
      ? "bg-indigo-50 text-indigo-800 border-indigo-200"
      : saveMode === "dirty"
      ? "bg-amber-50 text-amber-900 border-amber-200"
      : saveMode === "saved"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : "bg-rose-50 text-rose-800 border-rose-200";

    return (
      <div className={`text-xs px-3 py-1.5 rounded-full border ${cls} whitespace-nowrap`}>
        {label}
        {!missingId && saveMode === "saved" && lastSavedAt ? (
          <span className="ml-2 text-[11px] opacity-70">{new Date(lastSavedAt).toLocaleTimeString()}</span>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-16 max-w-[1680px] mx-auto px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="min-w-0">
          <input
            value={title}
            onFocus={() => void requestCreateArtifactIfNeeded("focus")}
            onChange={(e) => {
              setTitle(e.target.value);
              markDirty();
              setDoc((prev) => ({ ...prev, title: e.target.value }));
            }}
            disabled={!!readOnly}
            className="text-2xl font-semibold text-gray-900 tracking-tight w-full bg-transparent outline-none placeholder:text-gray-400"
            placeholder="Work Breakdown Structure"
          />
          <p className="mt-1 text-sm text-gray-600">
            Deliverable hierarchy • PMI aligned • auto-rollup {doc?.auto_rollup !== false ? "enabled" : "disabled"}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <SaveIndicator />
          {msg && <div className="text-sm text-gray-700 bg-gray-100 px-3.5 py-1.5 rounded-lg self-center">{msg}</div>}

          <button
            onClick={exportXlsx}
            disabled={exportingXlsx}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
            title="Download as Excel (.xlsx)"
          >
            {exportingXlsx ? "Exporting…" : "Export XLSX"}
          </button>

          <button
            onClick={generateWbs}
            disabled={readOnly || genLoading}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            {genLoading ? "Generating…" : "AI Generate WBS"}
          </button>

          <button
            onClick={aiValidate}
            disabled={readOnly || isPending}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            Validate
          </button>

          <button
            onClick={async () => {
              await requestCreateArtifactIfNeeded("focus");
              const last = coded?.[coded.length - 1]?.id;
              if (last) addSibling(last);
            }}
            disabled={readOnly || !coded?.length}
            className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          >
            + Add top item
          </button>

          <button
            onClick={save}
            disabled={readOnly || saving}
            className={`min-w-[110px] px-5 py-2 text-sm font-semibold rounded-lg transition-colors ${
              dirty ? "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm" : "bg-gray-800 text-white hover:bg-gray-900"
            } disabled:opacity-60`}
          >
            {saving ? "Saving…" : dirty ? "Save *" : "Save"}
          </button>
        </div>
      </div>

      {/* Controls / Filters / Views */}
      <div className="rounded-xl border bg-white shadow-sm p-5 space-y-4">
        {/* ...UNCHANGED FILTERS/VIEW UI... */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-sm font-semibold text-gray-900">Filters</div>

            <button type="button" onClick={clearFilters} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
              Clear
            </button>

            <button
              type="button"
              onClick={saveCurrentAsView}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
              disabled={!!readOnly}
              title={readOnly ? "Read-only mode" : "Save current filter set"}
            >
              Save view
            </button>

            <select
              value={activeViewId}
              onChange={(e) => {
                const id = e.target.value;
                setActiveViewId(id);
                if (id === "__all") return;
                const v = savedViews.find((x) => x.id === id);
                if (v) applyViewState(v.state);
              }}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 bg-white"
              title="Load a saved view"
            >
              <option value="__all">All (no saved view)</option>
              {savedViews.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={renameActiveView}
              disabled={activeViewId === "__all"}
              className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-50"
            >
              Rename
            </button>

            <button
              type="button"
              onClick={deleteActiveView}
              disabled={activeViewId === "__all"}
              className="px-3 py-1.5 text-sm rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50 disabled:opacity-50"
            >
              Delete
            </button>

            <div className="h-5 w-px bg-gray-200 mx-1 hidden sm:block" />

            <button type="button" onClick={applyMyWorkFilter} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
              My work
            </button>

            <button type="button" onClick={setMyWorkFromOwner} className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">
              Set My Work
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500 font-semibold uppercase tracking-wide">WBS due</label>
              <input
                type="date"
                value={doc.due_date ?? ""}
                onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                onChange={(e) => updateDoc({ due_date: e.target.value })}
                disabled={!!readOnly}
                className="text-sm border-gray-300 rounded-lg py-1.5 px-3 bg-white"
              />
            </div>

            <label className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 text-sm">
              <input
                type="checkbox"
                checked={doc.auto_rollup !== false}
                onChange={(e) => updateDoc({ auto_rollup: e.target.checked })}
                disabled={!!readOnly}
              />
              Auto roll-up
            </label>

            <div className="text-sm text-gray-600">
              Showing <span className="font-semibold text-gray-900">{visibleRows.length}</span> / {rolled.length}
            </div>
          </div>
        </div>

        {/* ...rest of filter controls unchanged... */}
        {/* (Keeping it as-is; no logic change required for lazy AI) */}
      </div>

      {/* Effort warning */}
      {missingEffortCount > 0 && (
        <div className="rounded-xl border border-amber-300/60 bg-amber-50/50 p-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="inline-flex px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-200 shrink-0">
                {missingEffortCount >= 5 ? "CRITICAL" : "WARNING"}
              </span>
              <div>
                <p className="font-medium text-gray-900">
                  {missingEffortCount} work package{missingEffortCount !== 1 ? "s" : ""} missing effort
                </p>
                <p className="text-sm text-gray-600 mt-0.5">
                  Roll-ups assume Medium when unset — affects capacity & schedule reliability
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <button
                onClick={() => {
                  setOnlyMissingEffort((v) => !v);
                  setLeavesOnly(true);
                  setActiveViewId("__all");
                }}
                className={`px-4 py-1.5 text-sm rounded-lg border transition-colors ${
                  onlyMissingEffort
                    ? "bg-amber-600 text-white border-amber-600 hover:bg-amber-700"
                    : "border-amber-300 hover:bg-amber-100"
                }`}
              >
                {onlyMissingEffort ? "Showing gaps" : "Show gaps"}
              </button>
              <button
                onClick={jumpToNextEffortGap}
                className="px-4 py-1.5 text-sm rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
              >
                Jump to next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="grid xl:grid-cols-12 gap-6">
        <div className="xl:col-span-8 space-y-4">
          {visibleRows.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/60 p-12 text-center">
              <p className="text-gray-600 text-lg font-medium">No matching items</p>
              <p className="mt-2 text-sm text-gray-500">Try adjusting filters or adding new entries</p>
            </div>
          ) : (
            visibleRows.map((r: any) => {
              const isParent = !!r._isParent;
              const statusShown = statusShownForRow(r, doc?.auto_rollup !== false);
              const progressShown = progressShownForRow(r, doc?.auto_rollup !== false);

              const isSelected = selectedRowId === r.id;
              const isCollapsed = collapsed.has(r.id);
              const detailsOpen = expanded.has(r.id);

              // ✅ FIXED: Pass statusShown to isOverdue so completed tasks don't show as overdue
              const overdue = isOverdue(r.due_date, statusShown);
              const effortVal = normalizeEffort(r.effort);
              const effortMissing = !isParent && effortVal === "";

              return (
                <div
                  key={r.id}
                  className={`rounded-xl border bg-white shadow-sm overflow-hidden transition-all duration-150 ${
                    isSelected
                      ? "border-indigo-400 ring-1 ring-indigo-200/40 shadow-md"
                      : "border-gray-200 hover:border-gray-300 hover:shadow"
                  }`}
                  onClick={() => {
                    setSelectedRowId(r.id);
                    setAssistantOpen(true);
                  }}
                >
                  <div className="flex items-center gap-4 px-5 pt-4 pb-3 border-b border-gray-100">
                    <div style={{ width: `${r.level * 28}px` }} className="shrink-0 flex justify-end">
                      {isParent ? (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleCollapse(r.id);
                          }}
                          className="w-8 h-8 rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-600 hover:text-gray-900 flex items-center justify-center text-xl transition-colors"
                          title={isCollapsed ? "Expand subtree" : "Collapse subtree"}
                        >
                          {isCollapsed ? "▸" : "▾"}
                        </button>
                      ) : (
                        <div className="w-8" />
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-3">
                        <code className="text-sm font-medium text-gray-500 tabular-nums tracking-tight min-w-[60px]">
                          {r.code || "—"}
                        </code>
                        <input
                          value={r.deliverable}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={(e) => updateRow(r.id, { deliverable: e.target.value })}
                          disabled={!!readOnly}
                          placeholder="Deliverable / Work Package"
                          className="text-[17px] font-medium flex-1 bg-transparent outline-none placeholder:text-gray-400 focus:placeholder:text-gray-300"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>

                      <div className="mt-1.5 flex flex-wrap gap-x-5 gap-y-1 text-xs text-gray-600">
                        <span>Level {r.level}</span>
                        {overdue && <span className="text-rose-600 font-medium">Overdue</span>}
                        {effortMissing && <span className="text-amber-700 font-medium">Effort missing</span>}
                        {isParent && doc?.auto_rollup !== false && <span>Roll-up</span>}
                      </div>
                    </div>

                    <div className="flex items-center gap-2.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleDetails(r.id)}
                        className="px-3.5 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                      >
                        {detailsOpen ? "Hide details" : "Details"}
                      </button>
                      {!readOnly && <RowActions rowId={r.id} />}
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-5 px-5 py-5 bg-gray-50/50 border-b border-gray-100">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Status</label>
                      <div className="flex items-center gap-3">
                        <select
                          value={statusShown}
                          onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                          onChange={(e) => updateRow(r.id, { status: e.target.value as WbsStatus })}
                          disabled={!!readOnly || (doc?.auto_rollup !== false && isParent)}
                          className={`text-sm rounded-lg py-1.5 px-3 min-w-[140px] disabled:opacity-60 focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 border ${
                            statusShown === "done"
                              ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                              : statusShown === "in_progress"
                              ? "bg-indigo-50 border-indigo-300 text-indigo-800"
                              : statusShown === "blocked"
                              ? "bg-rose-50 border-rose-300 text-rose-800"
                              : "bg-slate-50 border-slate-300 text-slate-700"
                          }`}
                        >
                          <option value="not_started">Not started</option>
                          <option value="in_progress">In progress</option>
                          <option value="done">Done</option>
                          <option value="blocked">Blocked</option>
                        </select>
                        <StatusPill s={statusShown} />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Effort</label>
                      <select
                        value={effortVal}
                        onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                        onChange={(e) => updateRow(r.id, { effort: normalizeEffort(e.target.value) })}
                        disabled={!!readOnly}
                        className={`text-sm rounded-lg py-1.5 px-3 min-w-[120px] focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300 border ${
                          effortMissing
                            ? "bg-rose-50 border-rose-400 text-rose-800"
                            : effortVal === "S"
                            ? "bg-emerald-50 border-emerald-300 text-emerald-800"
                            : effortVal === "M"
                            ? "bg-amber-50 border-amber-300 text-amber-800"
                            : effortVal === "L"
                            ? "bg-orange-50 border-orange-300 text-orange-800"
                            : "bg-white border-gray-300"
                        }`}
                      >
                        <option value="">— not set —</option>
                        <option value="S">S – Small</option>
                        <option value="M">M – Medium</option>
                        <option value="L">L – Large</option>
                      </select>
                    </div>

                    <div>
                      <div className="flex justify-between text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">
                        <span>Progress</span>
                        <span className="text-gray-900 font-semibold">{progressShown}%</span>
                      </div>
                      <div className="h-2.5 bg-indigo-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-indigo-500 to-indigo-700 transition-all duration-500"
                          style={{ width: `${progressShown}%` }}
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs text-gray-500 mb-1.5 font-medium uppercase tracking-wide">Due date</label>
                      <input
                        type="date"
                        value={r.due_date ?? ""}
                        onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                        onChange={(e) => updateRow(r.id, { due_date: e.target.value })}
                        disabled={!!readOnly}
                        className="text-sm border-gray-300 rounded-lg py-1.5 px-3 w-full bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                      />
                    </div>
                  </div>

                  {detailsOpen && (
                    <div className="px-5 py-6 grid md:grid-cols-12 gap-6 border-t border-gray-100">
                      <div className="md:col-span-5 space-y-5">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1.5 font-medium">Owner</label>
                          <input
                            value={r.owner ?? ""}
                            onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                            onChange={(e) => updateRow(r.id, { owner: e.target.value })}
                            disabled={!!readOnly}
                            className="w-full rounded-lg border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                            placeholder="—"
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-gray-600 mb-1.5 font-medium">Predecessor</label>
                          <input
                            value={r.predecessor ?? ""}
                            onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                            onChange={(e) => updateRow(r.id, { predecessor: e.target.value })}
                            disabled={!!readOnly}
                            className="w-full rounded-lg border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                            placeholder="e.g. 1.2 or Charter approval"
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-gray-600 mb-1.5 font-medium">Tags (comma separated)</label>
                          <input
                            value={joinTags(r.tags)}
                            onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                            onChange={(e) => updateRow(r.id, { tags: parseTags(e.target.value) })}
                            disabled={!!readOnly}
                            className="w-full rounded-lg border-gray-300 px-4 py-2 text-sm focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                            placeholder="governance, risk, stakeholder, ..."
                          />
                        </div>
                      </div>

                      <div className="md:col-span-7 space-y-5">
                        <div>
                          <label className="block text-xs text-gray-600 mb-1.5 font-medium">Description</label>
                          <textarea
                            value={r.description ?? ""}
                            onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                            onChange={(e) => updateRow(r.id, { description: e.target.value })}
                            disabled={!!readOnly}
                            rows={3}
                            className="w-full rounded-lg border-gray-300 px-4 py-2 text-sm resize-y min-h-[80px] focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                            placeholder="Context, notes, approach..."
                          />
                        </div>

                        <div>
                          <label className="block text-xs text-gray-600 mb-1.5 font-medium">Acceptance Criteria</label>
                          <textarea
                            value={r.acceptance_criteria ?? ""}
                            onFocus={() => void requestCreateArtifactIfNeeded("focus")}
                            onChange={(e) => updateRow(r.id, { acceptance_criteria: e.target.value })}
                            disabled={!!readOnly}
                            rows={5}
                            className="w-full rounded-lg border-gray-300 px-4 py-2 text-sm resize-y min-h-[110px] focus:ring-2 focus:ring-indigo-200 focus:border-indigo-300"
                            placeholder="• Must be measurable\n• Must be testable\n..."
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}

          {readOnly && <div className="text-xs text-gray-500 mt-2">Read-only mode (artifact locked or no edit rights).</div>}
        </div>

        {/* Right rail */}
        <div className="xl:col-span-4 space-y-6">
          {/* ✅ Lazy AI Assistant rail wrapper */}
          <div className="rounded-xl border bg-white shadow-sm p-5 space-y-4 sticky top-6">
            <div className="flex items-center justify-between gap-3">
              <div className="font-medium text-gray-900">AI Work Package Assistant</div>
              <button
                type="button"
                className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                onClick={() => setAssistantOpen((v) => !v)}
              >
                {assistantOpen ? "Hide" : "Show"}
              </button>
            </div>

            {!assistantOpen ? (
              <div className="text-sm text-gray-600">Assistant panel hidden.</div>
            ) : (
              <LazyWbsAssistantRail
                projectId={projectId}
                readOnly={!!readOnly}
                selectedRow={selectedRow}
                onEnsureArtifact={async () => {
                  await requestCreateArtifactIfNeeded("focus");
                  return safeStr(artifactIdLocal).trim();
                }}
                onUpdateRow={(rowId, patch) => updateRow(rowId, patch)}
                onAppendDescription={(rowId, block) => {
                  const row = coded.find((x) => x.id === rowId);
                  const existing = safeStr(row?.description);
                  const next = existing ? `${existing}\n\n${block}` : block;
                  updateRow(rowId, { description: next });
                }}
                onExpandChildren={(rowId) => aiExpand(rowId)}
                onMessage={(text) => {
                  setMsg(text);
                  setTimeout(() => setMsg(""), 1200);
                }}
              />
            )}
          </div>

          {/* Validate panel (unchanged) */}
          {validateOpen && (
            <div className="rounded-xl border bg-white shadow-sm p-5">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-900">Validation results</div>
                <button
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                  onClick={() => setValidateOpen(false)}
                >
                  Close
                </button>
              </div>
              <div className="mt-2 text-sm text-gray-600">{validateSummary}</div>

              {aiIssues.length > 0 && (
                <div className="mt-4 space-y-2">
                  {aiIssues.map((x, i) => (
                    <div
                      key={i}
                      className={`rounded-lg border px-3 py-2 text-sm ${
                        x.severity === "high"
                          ? "border-rose-200 bg-rose-50"
                          : x.severity === "medium"
                          ? "border-amber-200 bg-amber-50"
                          : "border-slate-200 bg-slate-50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-gray-900">{x.severity.toUpperCase()}</div>
                        {x.rowId && (
                          <button
                            className="px-2.5 py-1 text-xs rounded-md border border-gray-200 hover:bg-white"
                            onClick={() => {
                              setSelectedRowId(x.rowId!);
                              setAssistantOpen(true);
                              setMsg("✅ Jumped to row");
                              setTimeout(() => setMsg(""), 1000);
                            }}
                          >
                            Jump
                          </button>
                        )}
                      </div>
                      <div className="text-gray-700 mt-1">{x.message}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Generate panel (unchanged) */}
          {genOpen && (
            <div className="rounded-xl border bg-white shadow-sm p-5">
              <div className="flex items-center justify-between">
                <div className="font-medium text-gray-900">AI Generated WBS</div>
                <button
                  className="px-3 py-1.5 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                  onClick={() => {
                    setGenOpen(false);
                    setGeneratedDoc(null);
                  }}
                >
                  Close
                </button>
              </div>

              <div className="mt-3 text-sm text-gray-600">
                {genLoading ? "Generating…" : generatedDoc ? "Preview created. Apply to replace current rows." : "No output yet."}
              </div>

              {generatedDoc && (
                <div className="mt-4 space-y-3">
                  <div className="rounded-lg border bg-gray-50 p-3 text-xs text-gray-700 overflow-auto max-h-[240px]">
                    <pre className="whitespace-pre-wrap">{JSON.stringify(generatedDoc, null, 2)}</pre>
                  </div>

                  <div className="flex gap-2">
                    <button
                      className="px-4 py-2 text-sm font-semibold rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-60"
                      onClick={applyGeneratedDoc}
                      disabled={!!readOnly}
                    >
                      Apply generated WBS
                    </button>
                    <button
                      className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50"
                      onClick={() => generateWbs()}
                    >
                      Regenerate
                    </button>
                  </div>

                  <div className="text-xs text-gray-500">Applying will replace your current rows.</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
