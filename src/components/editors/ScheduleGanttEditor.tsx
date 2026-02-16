// src/components/editors/ScheduleGanttEditor.tsx
"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

type ItemType = "milestone" | "task" | "deliverable";
type ItemStatus = "on_track" | "at_risk" | "delayed" | "done";

export type ScheduleItem = {
  id: string;
  phaseId: string;
  type: ItemType;
  name: string;
  start: string; // ISO YYYY-MM-DD
  end?: string;
  status: ItemStatus;
  notes?: string;
  dependencies?: string[];
};

export type SchedulePhase = {
  id: string;
  name: string;
};

export type ScheduleDocV1 = {
  version: 1;
  type: "schedule";
  anchor_date?: string;
  phases: SchedulePhase[];
  items: ScheduleItem[];
};

type WbsStatus = "not_started" | "in_progress" | "done" | "blocked";
type ViewMode = 1 | 4 | 12 | 36 | 52;
type DragMode = "move" | "resize_end";
type PanelMode = "closed" | "add" | "edit";

type DragState = {
  mode: DragMode;
  itemId: string;
  pointerId: number;
  startClientX: number;
  moved: boolean;
  origStartDay: number;
  origEndDay: number;
};

type Anchor = { x1: number; y1: number; x2: number; y2: number };
type DepPath = { predId: string; succId: string; a: Anchor };

/* ────────────────────────────────────────────────
   Pure helpers
──────────────────────────────────────────────── */

function uuidish() {
  return crypto?.randomUUID?.() ?? `s_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const out = new Date(d);
  out.setDate(d.getDate() + diff);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function parseISODate(s: string): Date | null {
  const x = safeStr(s).trim();
  if (!x) return null;
  const d = new Date(`${x}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function parseDeps(x: unknown): string[] {
  if (Array.isArray(x)) return x.map(safeStr).filter(Boolean).slice(0, 50);
  if (typeof x === "string") {
    return x
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
  }
  return [];
}

function fmtWeekHeader(weekStart: Date): string {
  const s = weekStart.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  const e = addDays(weekStart, 6).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
  return `${s} – ${e}`;
}

function normalizeInitial(initialJson: any): ScheduleDocV1 {
  let obj: any = initialJson;
  if (typeof initialJson === "string") {
    try {
      obj = JSON.parse(initialJson);
    } catch {
      obj = null;
    }
  }

  if (obj && typeof obj === "object" && obj.type === "schedule" && Number(obj.version) === 1) {
    const phases = Array.isArray(obj.phases) ? obj.phases : [];
    const items = Array.isArray(obj.items) ? obj.items : [];
    return {
      version: 1,
      type: "schedule",
      anchor_date: safeStr(obj.anchor_date),
      phases: phases
        .map((p: any) => ({
          id: safeStr(p?.id) || uuidish(),
          name: safeStr(p?.name) || "Phase",
        }))
        .slice(0, 200),
      items: items
        .map((it: any) => ({
          id: safeStr(it?.id) || uuidish(),
          phaseId: safeStr(it?.phaseId),
          type: (safeStr(it?.type) as ItemType) || "task",
          name: safeStr(it?.name) || "(untitled)",
          start: safeStr(it?.start),
          end: safeStr(it?.end),
          status: (safeStr(it?.status) as ItemStatus) || "on_track",
          notes: safeStr(it?.notes),
          dependencies: parseDeps(it?.dependencies ?? it?.dependsOn ?? it?.predecessors),
        }))
        .slice(0, 4000),
    };
  }

  const anchor = startOfWeekMonday(new Date());
  const p1 = uuidish();
  const p2 = uuidish();
  const p3 = uuidish();
  const kickoffId = uuidish();
  const scopeId = uuidish();

  return {
    version: 1,
    type: "schedule",
    anchor_date: iso(anchor),
    phases: [
      { id: p1, name: "Preparation" },
      { id: p2, name: "Deployment" },
      { id: p3, name: "Configuration" },
    ],
    items: [
      {
        id: kickoffId,
        phaseId: p1,
        type: "milestone",
        name: "Kickoff",
        start: iso(addDays(anchor, 2)),
        end: "",
        status: "on_track",
        dependencies: [],
      },
      {
        id: scopeId,
        phaseId: p1,
        type: "task",
        name: "Scoping Documentation",
        start: iso(addDays(anchor, 7)),
        end: iso(addDays(anchor, 20)),
        status: "at_risk",
        dependencies: [kickoffId],
      },
    ],
  };
}

function serialize(doc: ScheduleDocV1) {
  return {
    version: 1,
    type: "schedule",
    anchor_date: safeStr(doc.anchor_date).trim(),
    phases: (doc.phases ?? []).map((p) => ({ id: p.id, name: safeStr(p.name) })),
    items: (doc.items ?? []).map((it) => ({
      id: it.id,
      phaseId: it.phaseId,
      type: it.type,
      name: safeStr(it.name),
      start: safeStr(it.start),
      end: safeStr(it.end),
      status: it.status,
      notes: safeStr(it.notes),
      dependencies: Array.isArray(it.dependencies) ? it.dependencies.map(safeStr).filter(Boolean) : [],
    })),
  };
}

function statusColor(status: ItemStatus) {
  switch (status) {
    case "done":
      return {
        bg: "bg-blue-500",
        border: "border-blue-500",
        text: "text-blue-700",
        light: "bg-blue-50",
        ring: "ring-blue-200",
      };
    case "delayed":
      return {
        bg: "bg-red-500",
        border: "border-red-500",
        text: "text-red-700",
        light: "bg-red-50",
        ring: "ring-red-200",
      };
    case "at_risk":
      return {
        bg: "bg-amber-500",
        border: "border-amber-500",
        text: "text-amber-700",
        light: "bg-amber-50",
        ring: "ring-amber-200",
      };
    default:
      return {
        bg: "bg-emerald-500",
        border: "border-emerald-500",
        text: "text-emerald-700",
        light: "bg-emerald-50",
        ring: "ring-emerald-200",
      };
  }
}

function viewLabel(v: ViewMode) {
  return v === 1 ? "1 week" : v === 4 ? "4 weeks" : v === 12 ? "12 weeks" : v === 36 ? "36 weeks" : "52 weeks";
}

function compactPct(items: ScheduleItem[]) {
  if (!items.length) return 0;
  const done = items.filter((x) => x.status === "done").length;
  return Math.round((done / items.length) * 100);
}

function itemIntervalMs(it: ScheduleItem): { startMs: number; endMs: number } | null {
  const s = parseISODate(it.start);
  if (!s) return null;
  const eISO = it.type === "milestone" ? it.start : safeStr(it.end) || it.start;
  const e = parseISODate(eISO) ?? s;
  return { startMs: s.getTime(), endMs: e.getTime() + 86400000 - 1 };
}

function dayIndex(anchorMonday: Date, dateISO: string): number | null {
  const d = parseISODate(dateISO);
  if (!d) return null;
  return Math.floor((d.getTime() - anchorMonday.getTime()) / 86400000);
}

function weekIndexFromISO(anchorMonday: Date, dateISO: string): number | null {
  const d = dayIndex(anchorMonday, dateISO);
  return d === null ? null : Math.floor(d / 7);
}

function normalizeWbs(wbs: any): { rows: any[] } {
  let obj: any = wbs;
  if (typeof wbs === "string") {
    try {
      obj = JSON.parse(wbs);
    } catch {
      obj = null;
    }
  }
  const rows = Array.isArray(obj?.rows) ? obj.rows : Array.isArray(obj?.items) ? obj.items : [];
  return {
    rows: (rows ?? [])
      .map((r: any) => ({
        id: safeStr(r?.id) || uuidish(),
        level: Number(r?.level ?? 0) || 0,
        deliverable: safeStr(r?.deliverable) || safeStr(r?.name) || "(untitled)",
        description: safeStr(r?.description),
        acceptance_criteria: safeStr(r?.acceptance_criteria),
        owner: safeStr(r?.owner),
        status: (safeStr(r?.status) as WbsStatus) || "not_started",
        effort: (safeStr(r?.effort) as any) || undefined,
        due_date: safeStr(r?.due_date),
        predecessor: safeStr(r?.predecessor),
        tags: Array.isArray(r?.tags) ? r.tags.map((x: any) => safeStr(x)).filter(Boolean) : [],
      }))
      .slice(0, 5000),
  };
}

function wbsStatusToSchedule(status?: WbsStatus): ItemStatus {
  const s = safeStr(status).toLowerCase();
  if (s === "done") return "done";
  if (s === "blocked") return "at_risk";
  if (s === "in_progress") return "on_track";
  return "on_track";
}

function buildScheduleFromWbs(args: {
  wbs: any;
  projectStartDate?: string | null;
  projectFinishDate?: string | null;
}): ScheduleDocV1 | null {
  const { rows } = normalizeWbs(args.wbs);
  if (!rows.length) return null;

  const projStart = parseISODate(args.projectStartDate || "") ?? parseISODate(todayISO())!;
  const anchor = iso(startOfWeekMonday(projStart));

  const stack: any[] = [];
  const rootPhaseByRow = new Map<string, string>();
  const phaseNames: string[] = [];

  for (const r of rows) {
    while (stack.length && r.level <= (stack[stack.length - 1]?.level ?? 0)) stack.pop();
    stack.push(r);
    const top = stack.find((x) => x.level === 0) ?? stack[0];
    const phaseName = safeStr(top?.deliverable) || "Work";
    rootPhaseByRow.set(r.id, phaseName);
    if (!phaseNames.includes(phaseName)) phaseNames.push(phaseName);
  }

  const phases: SchedulePhase[] = phaseNames.map((name) => ({ id: uuidish(), name }));
  const phaseIdByName = new Map(phases.map((p) => [p.name, p.id]));

  const childrenCount = new Map<string, number>();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const next = rows[i + 1];
    if (next && next.level > r.level) childrenCount.set(r.id, (childrenCount.get(r.id) ?? 0) + 1);
  }

  const rowIdSet = new Set(rows.map((r) => r.id));
  const items: ScheduleItem[] = [];

  for (const r of rows) {
    const hasChildren = (childrenCount.get(r.id) ?? 0) > 0;
    if (hasChildren) continue;

    const phaseName = rootPhaseByRow.get(r.id) ?? "Work";
    const phaseId = phaseIdByName.get(phaseName) ?? phases[0]?.id ?? uuidish();

    const endISO = parseISODate(r.due_date || "") ? safeStr(r.due_date) : "";
    const startISO = iso(projStart);

    const deps: string[] = [];
    const pred = safeStr(r.predecessor).trim();
    if (pred && rowIdSet.has(pred)) deps.push(pred);

    items.push({
      id: r.id,
      phaseId,
      type: "task",
      name: safeStr(r.deliverable) || "(untitled)",
      start: startISO,
      end: endISO || startISO,
      status: wbsStatusToSchedule(r.status),
      notes: [safeStr(r.description), safeStr(r.acceptance_criteria)].filter(Boolean).join("\n").trim(),
      dependencies: deps,
    });
  }

  const projFinish = parseISODate(args.projectFinishDate || "");
  if (projFinish) {
    const pf = projFinish.getTime();
    for (const it of items) {
      const e = parseISODate(it.end || "") ?? parseISODate(it.start) ?? null;
      if (e && e.getTime() > pf) it.end = iso(projFinish);
    }
  }

  if (!items.length) {
    for (const pName of phaseNames) {
      const phaseId = phaseIdByName.get(pName)!;
      items.push({
        id: uuidish(),
        phaseId,
        type: "milestone",
        name: pName,
        start: iso(projStart),
        end: "",
        status: "on_track",
        notes: "",
        dependencies: [],
      });
    }
  }

  return { version: 1, type: "schedule", anchor_date: anchor, phases, items };
}

/* ────────────────────────────────────────────────
   Main Component (OLD STYLE, with lazy WBS fetch on click)
──────────────────────────────────────────────── */

export default function ScheduleGanttEditor({
  projectId,
  artifactId,
  initialJson,
  readOnly = false,
  projectTitle,
  projectStartDate,
  projectFinishDate,
  latestWbsJson,
  wbsArtifactId,
}: {
  projectId: string;
  artifactId: string;
  initialJson: any;
  readOnly?: boolean;
  projectTitle?: string | null;
  projectStartDate?: string | null;
  projectFinishDate?: string | null;
  latestWbsJson?: any | null;
  wbsArtifactId?: string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState("");
  const [dirty, setDirty] = useState(false);

  // ✅ store server updated_at here for If-Match
  const etagRef = useRef<string | null>(null);
  const hydratedOnceRef = useRef(false);
  const lastHydratedFingerprintRef = useRef<string>("");

  const [doc, setDoc] = useState<ScheduleDocV1>(() => normalizeInitial(initialJson));
  const [panelMode, setPanelMode] = useState<PanelMode>("closed");
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  // ✅ WBS state (do NOT fetch on mount)
  const [wbsJson, setWbsJson] = useState<any | null>(latestWbsJson ?? null);
  const [wbsLoading, setWbsLoading] = useState(false);

  useEffect(() => {
    setWbsJson(latestWbsJson ?? null);
  }, [latestWbsJson]);

  async function fetchLatestWbsJson(): Promise<any | null> {
    try {
      setWbsLoading(true);
      if (!wbsArtifactId) throw new Error("No WBS artifact found for this project.");

      const url = `/api/artifacts/${encodeURIComponent(
        wbsArtifactId
      )}/content-json?projectId=${encodeURIComponent(projectId)}`;

      const res = await fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
        credentials: "include",
      });

      const j = await res.json().catch(() => ({}));
      if (!res.ok || j?.ok === false) throw new Error(j?.error || `WBS fetch failed (${res.status})`);
      return j?.content_json ?? null;
    } catch (e: any) {
      setMsg(`⛔ ${e?.message ?? "Could not load WBS"}`);
      return null;
    } finally {
      setWbsLoading(false);
    }
  }

  async function ensureWbsLoaded(): Promise<any | null> {
    if (wbsJson) return wbsJson;
    const next = await fetchLatestWbsJson();
    if (next) setWbsJson(next);
    return next;
  }

  const updateDoc = useCallback((updater: (prev: ScheduleDocV1) => ScheduleDocV1) => {
    setDoc((prev) => updater(prev));
    setDirty(true);
  }, []);

  useLayoutEffect(() => {
    const nextDoc = normalizeInitial(initialJson);
    let nextFp = "";
    try {
      nextFp = JSON.stringify(serialize(nextDoc));
    } catch {}
    if (!hydratedOnceRef.current || !dirty) {
      hydratedOnceRef.current = true;
      lastHydratedFingerprintRef.current = nextFp;
      setDoc(nextDoc);
      setDirty(false);
      return;
    }
    if (nextFp && nextFp === lastHydratedFingerprintRef.current) return;
    setMsg("⚠️ A newer server version is available. Save your changes or reload.");
  }, [initialJson, dirty]);

  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  // View state
  const [view, setView] = useState<ViewMode>(12);
  const [pageStartWeek, setPageStartWeek] = useState<number>(0);
  const [useCustomRange, setUseCustomRange] = useState(false);
  const [rangeFrom, setRangeFrom] = useState<string>("");
  const [rangeTo, setRangeTo] = useState<string>("");
  const [search, setSearch] = useState("");
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showMilestones, setShowMilestones] = useState(true);
  const [showTasks, setShowTasks] = useState(true);
  const [showDeliverables, setShowDeliverables] = useState(true);
  const [depQuery, setDepQuery] = useState("");

  const anchorMonday = useMemo(() => {
    const rawAnchor = parseISODate(doc.anchor_date || "");
    if (rawAnchor) return startOfWeekMonday(rawAnchor);
    const projStart = parseISODate(projectStartDate || "");
    if (projStart) return startOfWeekMonday(projStart);
    return startOfWeekMonday(new Date());
  }, [doc.anchor_date, projectStartDate]);

  const seededRangeRef = useRef(false);
  useEffect(() => {
    if (seededRangeRef.current) return;
    const s = parseISODate(projectStartDate || "");
    const e = parseISODate(projectFinishDate || "");
    if (!s || !e) return;
    seededRangeRef.current = true;
    setUseCustomRange(true);
    setRangeFrom(iso(s));
    setRangeTo(iso(e));
    setPageStartWeek(0);
    setDoc((p) => (safeStr(p.anchor_date).trim() ? p : { ...p, anchor_date: iso(startOfWeekMonday(s)) }));
  }, [projectStartDate, projectFinishDate]);

  const weeks = useMemo(() => {
    const arr: { idx: number; start: Date; label: string }[] = [];
    for (let i = 0; i < 52; i++) {
      const start = addDays(anchorMonday, i * 7);
      arr.push({ idx: i, start, label: fmtWeekHeader(start) });
    }
    return arr;
  }, [anchorMonday]);

  const rangeError = useMemo(() => {
    if (!useCustomRange) return "";
    if (!rangeFrom || !rangeTo) return "";
    const a = parseISODate(rangeFrom);
    const b = parseISODate(rangeTo);
    if (!a || !b) return "Invalid date(s)";
    if (a.getTime() > b.getTime()) return "Start after end";
    return "";
  }, [useCustomRange, rangeFrom, rangeTo]);

  const pageWeeks = useMemo(() => {
    if (useCustomRange) {
      const fromW = rangeFrom ? weekIndexFromISO(anchorMonday, rangeFrom) : null;
      const toW = rangeTo ? weekIndexFromISO(anchorMonday, rangeTo) : null;
      const start = clamp(fromW ?? pageStartWeek ?? 0, 0, 51);
      const end = clamp(toW ?? (start + view - 1), 0, 51);
      const s = Math.min(start, end);
      const e = Math.max(start, end);
      return weeks.slice(s, e + 1);
    }
    if (view === 52) return weeks;
    const start = clamp(pageStartWeek, 0, 51);
    const end = clamp(start + view, 0, 52);
    return weeks.slice(start, end);
  }, [weeks, view, pageStartWeek, useCustomRange, rangeFrom, rangeTo, anchorMonday]);

  /* ---------------- Actions ---------------- */

  function setAnchorDate(nextISO: string) {
    if (readOnly) return;
    const d = parseISODate(nextISO);
    updateDoc((p) => ({ ...p, anchor_date: d ? iso(startOfWeekMonday(d)) : "" }));
    setPageStartWeek(0);
  }

  function updatePhase(phaseId: string, patch: Partial<SchedulePhase>) {
    if (readOnly) return;
    updateDoc((p) => ({
      ...p,
      phases: (p.phases ?? []).map((ph) => (ph.id === phaseId ? { ...ph, ...patch } : ph)),
    }));
  }

  function normalizeItemPatch(prev: ScheduleItem, patch: Partial<ScheduleItem>): ScheduleItem {
    const next: ScheduleItem = { ...prev, ...patch };

    if (next.type === "milestone") {
      next.end = "";
    } else {
      const end = safeStr(next.end);
      next.end = end || safeStr(next.start);
    }

    next.start = safeStr(next.start);
    next.dependencies = Array.isArray(next.dependencies) ? next.dependencies.map((x) => safeStr(x)).filter(Boolean) : [];

    if (next.type !== "milestone") {
      const s = parseISODate(next.start);
      const e = parseISODate(safeStr(next.end) || next.start);
      if (s && e && e.getTime() < s.getTime()) next.end = next.start;
    }

    return next;
  }

  function updateItem(itemId: string, patch: Partial<ScheduleItem>) {
    if (readOnly) return;
    updateDoc((p) => ({
      ...p,
      items: (p.items ?? []).map((it) => (it.id === itemId ? normalizeItemPatch(it, patch) : it)),
    }));
  }

  function addPhase() {
    if (readOnly) return;
    const id = uuidish();
    updateDoc((p) => ({ ...p, phases: [...(p.phases ?? []), { id, name: "New phase" }] }));
  }

  function deletePhase(phaseId: string) {
    if (readOnly) return;
    updateDoc((p) => ({
      ...p,
      phases: (p.phases ?? []).filter((x) => x.id !== phaseId),
      items: (p.items ?? []).filter((x) => x.phaseId !== phaseId),
    }));

    if (selectedItemId) {
      const it = doc.items.find((x) => x.id === selectedItemId);
      if (it?.phaseId === phaseId) {
        setSelectedItemId(null);
        setPanelMode("closed");
      }
    }
  }

  function addItem(phaseId: string, type: ItemType) {
    if (readOnly) return;
    const start = pageWeeks[0]?.start ? iso(pageWeeks[0].start) : todayISO();
    const end = pageWeeks[Math.min(pageWeeks.length - 1, 1)]?.start
      ? iso(addDays(pageWeeks[1].start, 3))
      : start;

    const item: ScheduleItem = {
      id: uuidish(),
      phaseId,
      type,
      name: type === "milestone" ? "New milestone" : type === "task" ? "New task" : "New deliverable",
      start,
      end: type === "milestone" ? "" : end,
      status: "on_track",
      notes: "",
      dependencies: [],
    };

    updateDoc((p) => ({ ...p, items: [...(p.items ?? []), item] }));
    setSelectedItemId(item.id);
    setPanelMode("edit");
  }

  function deleteItem(itemId: string) {
    if (readOnly) return;
    updateDoc((p) => ({
      ...p,
      items: (p.items ?? [])
        .filter((x) => x.id !== itemId)
        .map((x) => ({
          ...x,
          dependencies: (x.dependencies ?? []).filter((d) => d !== itemId),
        })),
    }));
    if (selectedItemId === itemId) {
      setSelectedItemId(null);
      setPanelMode("closed");
    }
  }

  function shiftItemByWeeks(itemId: string, weeksDelta: number) {
    if (readOnly) return;
    const deltaDays = weeksDelta * 7;
    updateDoc((p) => ({
      ...p,
      items: (p.items ?? []).map((it) => {
        if (it.id !== itemId) return it;
        const s = parseISODate(it.start);
        if (!s) return it;
        const nextStart = iso(addDays(s, deltaDays));
        if (it.type === "milestone") return { ...it, start: nextStart, end: "" };
        const eISO = safeStr(it.end) || it.start;
        const e = parseISODate(eISO) ?? s;
        const nextEnd = iso(addDays(e, deltaDays));
        return { ...it, start: nextStart, end: nextEnd };
      }),
    }));
  }

  function duplicateItem(itemId: string) {
    if (readOnly) return;
    updateDoc((p) => {
      const it = (p.items ?? []).find((x) => x.id === itemId);
      if (!it) return p;
      const copy: ScheduleItem = { ...it, id: uuidish(), name: `${safeStr(it.name) || "(untitled)"} (copy)` };
      return { ...p, items: [...(p.items ?? []), copy] };
    });
  }

  const savingRef = useRef(false);
  async function save(showToast = true) {
    if (readOnly) return;
    if (savingRef.current) return;

    if (!dirty) {
      if (showToast) {
        setMsg("Nothing to save");
        setTimeout(() => setMsg(""), 900);
      }
      return;
    }

    if (showToast) setMsg("");

    const projStart = parseISODate(projectStartDate || "");
    const projFinish = parseISODate(projectFinishDate || "");

    if (projStart && projFinish) {
      for (const it of doc.items ?? []) {
        const s = parseISODate(it.start);
        const e =
          parseISODate(it.type === "milestone" ? it.start : safeStr(it.end) || it.start) ?? s;

        if (s && s.getTime() < projStart.getTime()) {
          setMsg(`⛔ "${it.name}" starts before project start date.`);
          return;
        }
        if (e && e.getTime() > projFinish.getTime()) {
          setMsg(`⛔ "${it.name}" ends after project finish date.`);
          return;
        }
      }
    }

    const payload = {
      projectId,
      title: "Schedule / Roadmap",
      content_json: serialize(doc),
    };

    savingRef.current = true;

    startTransition(async () => {
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
        };

        // ✅ Optimistic concurrency (your API checks If-Match against artifacts.updated_at)
        const ifMatch = safeStr(etagRef.current).trim();
        if (ifMatch) headers["If-Match"] = ifMatch;

        const res = await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/content-json`, {
          method: "POST",
          headers,
          body: JSON.stringify(payload),
          // ✅ Same-origin normally includes cookies automatically; this makes it explicit
          credentials: "include",
        });

        const j = await res.json().catch(() => ({}));

        if (!res.ok) {
          // ✅ Your route returns 409 for conflict
          if (res.status === 409) {
            throw new Error(
              j?.error ||
                "Conflict: someone else updated this schedule. Refresh to get the latest version."
            );
          }
          throw new Error(j?.error || `Save failed (${res.status})`);
        }

        // ✅ Prefer updated_at from returned artifact for the next If-Match
        const nextUpdatedAt =
          safeStr(j?.artifact?.updated_at) ||
          safeStr(j?.artifact?.updatedAt) ||
          safeStr(res.headers.get("ETag") || res.headers.get("etag"));

        if (nextUpdatedAt) etagRef.current = nextUpdatedAt;

        try {
          lastHydratedFingerprintRef.current = JSON.stringify(serialize(doc));
        } catch {}

        setDirty(false);
        router.refresh();

        setMsg(showToast ? "✅ Saved" : "Saved");
        setTimeout(() => setMsg(""), showToast ? 1200 : 800);
      } catch (e: any) {
        if (showToast) setMsg(`⛔ ${e?.message ?? "Save failed"}`);
      } finally {
        savingRef.current = false;
      }
    });
  }

  /* ---------------- Derived data ---------------- */

  const itemsVisible = useMemo(() => {
    const q = safeStr(search).trim().toLowerCase();
    return (doc.items ?? []).filter((it) => {
      if (it.type === "milestone" && !showMilestones) return false;
      if (it.type === "task" && !showTasks) return false;
      if (it.type === "deliverable" && !showDeliverables) return false;
      if (q) {
        const hay = `${safeStr(it.name)}\n${safeStr(it.notes)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [doc.items, showMilestones, showTasks, showDeliverables, search]);

  const itemsByPhase = useMemo(() => {
    const m = new Map<string, ScheduleItem[]>();
    for (const it of itemsVisible) {
      const arr = m.get(it.phaseId) ?? [];
      arr.push(it);
      m.set(it.phaseId, arr);
    }
    for (const [k, arr] of m.entries()) {
      arr.sort((a, b) => {
        const ia = itemIntervalMs(a);
        const ib = itemIntervalMs(b);
        const sa = ia?.startMs ?? 0;
        const sb = ib?.startMs ?? 0;
        if (sa !== sb) return sa - sb;
        const da = (ia?.endMs ?? sa) - sa;
        const db = (ib?.endMs ?? sb) - sb;
        if (da !== db) return db - da;
        return safeStr(a.name).localeCompare(safeStr(b.name));
      });
      m.set(k, arr);
    }
    return m;
  }, [itemsVisible]);

  const overallProgress = useMemo(() => {
    const all = itemsVisible.filter((x) => x.type !== "milestone");
    return compactPct(all);
  }, [itemsVisible]);

  const packed = useMemo(() => {
    const laneOf = new Map<string, number>();
    const laneCountByPhase = new Map<string, number>();

    for (const ph of doc.phases ?? []) {
      const arr = itemsByPhase.get(ph.id) ?? [];
      const laneEnd: number[] = [];

      for (const it of arr) {
        const interval = itemIntervalMs(it);
        if (!interval) {
          laneOf.set(it.id, 0);
          continue;
        }
        let placed = false;
        for (let lane = 0; lane < laneEnd.length; lane++) {
          if (interval.startMs >= laneEnd[lane]) {
            laneOf.set(it.id, lane);
            laneEnd[lane] = interval.endMs;
            placed = true;
            break;
          }
        }
        if (!placed) {
          const lane = laneEnd.length;
          laneOf.set(it.id, lane);
          laneEnd.push(interval.endMs);
        }
      }
      laneCountByPhase.set(ph.id, Math.max(1, laneEnd.length));
    }

    return { laneOf, laneCountByPhase };
  }, [doc.phases, itemsByPhase]);

  /* ---------------- Layout constants ---------------- */

  const PHASE_COL_W = 260;
  const WEEK_COL_W = 160;
  const CELL_H = 36;
  const BAR_H = 32;
  const LANE_GAP = 6;
  const TOP_PAD = 64; // header clearance inside row
  const DAY_W = WEEK_COL_W / 7;
  const MAX_DAY = 51 * 7 + 6;

  function canPrev() {
    if (useCustomRange) return false;
    if (view === 52) return false;
    return pageStartWeek > 0;
  }
  function canNext() {
    if (useCustomRange) return false;
    if (view === 52) return false;
    return pageStartWeek + view < 52;
  }
  function prevPage() {
    if (!canPrev()) return;
    setPageStartWeek((p) => clamp(p - view, 0, 52));
  }
  function nextPage() {
    if (!canNext()) return;
    setPageStartWeek((p) => clamp(p + view, 0, 52));
  }

  const selectedItem = useMemo(() => {
    if (!selectedItemId) return null;
    return doc.items.find((x) => x.id === selectedItemId) ?? null;
  }, [selectedItemId, doc.items]);

  const itemById = useMemo(() => {
    const m = new Map<string, ScheduleItem>();
    for (const it of doc.items ?? []) m.set(it.id, it);
    return m;
  }, [doc.items]);

  function computeBarGeometry(it: ScheduleItem) {
    const startDay = dayIndex(anchorMonday, it.start);
    if (startDay === null) return null;

    const endISO = it.type === "milestone" ? it.start : safeStr(it.end) || it.start;
    const endDay = dayIndex(anchorMonday, endISO) ?? startDay;

    const sDay = clamp(Math.min(startDay, endDay), 0, MAX_DAY);
    const eDay = clamp(Math.max(startDay, endDay), 0, MAX_DAY);

    const pageStart = pageWeeks[0]?.idx ?? 0;
    const pageEnd = pageWeeks[pageWeeks.length - 1]?.idx ?? pageStart;
    const pageStartDay = pageStart * 7;
    const pageEndDay = pageEnd * 7 + 6;

    if (eDay < pageStartDay || sDay > pageEndDay) return null;

    const startIn = Math.max(sDay, pageStartDay);
    const endIn = Math.min(eDay, pageEndDay);

    const left = (startIn - pageStartDay) * DAY_W + 8;

    let width: number;
    if (it.type === "milestone") {
      width = Math.min(36, Math.max(24, DAY_W * 1.4));
    } else {
      width = Math.max(16, (endIn - startIn + 1) * DAY_W - 16);
    }

    return { left, width, startIn, endIn };
  }

  const todayLineX = useMemo(() => {
    const t = iso(new Date());
    const day = dayIndex(anchorMonday, t);
    if (day === null) return null;
    const pageStart = pageWeeks[0]?.idx ?? 0;
    const pageEnd = pageWeeks[pageWeeks.length - 1]?.idx ?? pageStart;
    const pageStartDay = pageStart * 7;
    const pageEndDay = pageEnd * 7 + 6;
    if (day < pageStartDay || day > pageEndDay) return null;
    return (day - pageStartDay) * DAY_W;
  }, [anchorMonday, pageWeeks, DAY_W]);

  function togglePhaseCollapse(phaseId: string) {
    setCollapsed((p) => ({ ...p, [phaseId]: !p[phaseId] }));
  }

  /* ---------------- Drag handling ---------------- */

  const dragRef = useRef<DragState | null>(null);
  const rafRef = useRef<number | null>(null);

  function dayToISO(day: number) {
    return iso(addDays(anchorMonday, clamp(day, 0, MAX_DAY)));
  }

  function getItemById(id: string) {
    return doc.items.find((x) => x.id === id) ?? null;
  }

  function beginDrag(e: React.PointerEvent, itemId: string, mode: DragMode) {
    if (readOnly) return;
    const it = getItemById(itemId);
    if (!it) return;

    const s0 = dayIndex(anchorMonday, it.start);
    if (s0 === null) return;

    const endISO = it.type === "milestone" ? it.start : safeStr(it.end) || it.start;
    const e0 = dayIndex(anchorMonday, endISO);
    const endDay = e0 === null ? s0 : e0;

    const origStartDay = clamp(Math.min(s0, endDay), 0, MAX_DAY);
    const origEndDay = clamp(Math.max(s0, endDay), 0, MAX_DAY);

    dragRef.current = {
      mode,
      itemId,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      moved: false,
      origStartDay,
      origEndDay,
    };

    try {
      (e.currentTarget as any)?.setPointerCapture?.(e.pointerId);
    } catch {}

    e.preventDefault();
    e.stopPropagation();
  }

  function applyDragDelta(deltaDays: number) {
    const st = dragRef.current;
    if (!st) return;

    updateDoc((prev) => {
      const nextItems = (prev.items ?? []).map((x) => {
        if (x.id !== st.itemId) return x;

        const ds = clamp(deltaDays, -MAX_DAY, MAX_DAY);

        if (st.mode === "move") {
          if (x.type === "milestone") {
            const ns = clamp(st.origStartDay + ds, 0, MAX_DAY);
            return normalizeItemPatch(x, { start: dayToISO(ns), end: "" });
          }
          const dur = Math.max(0, st.origEndDay - st.origStartDay);
          const ns = clamp(st.origStartDay + ds, 0, MAX_DAY);
          const ne = clamp(ns + dur, ns, MAX_DAY);
          return normalizeItemPatch(x, { start: dayToISO(ns), end: dayToISO(ne) });
        }

        if (x.type === "milestone") return x;

        const ne = clamp(st.origEndDay + ds, st.origStartDay, MAX_DAY);
        return normalizeItemPatch(x, { end: dayToISO(ne) });
      });

      return { ...prev, items: nextItems };
    });
  }

  useEffect(() => {
    function onMove(ev: PointerEvent) {
      const st = dragRef.current;
      if (!st) return;
      if (ev.pointerId !== st.pointerId) return;

      const dx = ev.clientX - st.startClientX;
      const deltaDays = Math.round(dx / DAY_W);

      if (Math.abs(deltaDays) >= 1) st.moved = true;

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => applyDragDelta(deltaDays));

      ev.preventDefault();
    }

    function onUp(ev: PointerEvent) {
      const st = dragRef.current;
      if (!st) return;
      if (ev.pointerId !== st.pointerId) return;

      dragRef.current = null;

      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    }

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { passive: false });
    window.addEventListener("pointercancel", onUp, { passive: false });

    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [DAY_W, updateDoc]);

  /* ---------------- Dependencies overlay ---------------- */

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bodyScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineContentRef = useRef<HTMLDivElement | null>(null);
  const depsCanvasRef = useRef<HTMLDivElement | null>(null);
  const barNodeRef = useRef<Map<string, HTMLElement>>(new Map());
  const [depPaths, setDepPaths] = useState<DepPath[]>([]);

  const registerBarNode = useCallback((id: string, el: HTMLElement | null) => {
    if (!el) {
      barNodeRef.current.delete(id);
      return;
    }
    barNodeRef.current.set(id, el);
  }, []);

  const getPhaseHeight = (ph: SchedulePhase) => {
    const isCollapsed = !!collapsed[ph.id];
    if (isCollapsed) return 72;
    const lanes = packed.laneCountByPhase.get(ph.id) ?? 1;
    return Math.max(120, 64 + lanes * (BAR_H + LANE_GAP) + 24);
  };

  const phaseMetrics = useMemo(() => {
    const metrics = new Map<string, { height: number; offset: number }>();
    let currentOffset = 0;

    for (const ph of doc.phases ?? []) {
      const height = getPhaseHeight(ph);
      metrics.set(ph.id, { height, offset: currentOffset });
      currentOffset += height;
    }

    return { metrics, totalHeight: currentOffset };
  }, [doc.phases, collapsed, packed.laneCountByPhase]);

  const depsForVisible = useMemo(() => {
    const visibleIds = new Set<string>();
    for (const ph of doc.phases ?? []) {
      if (collapsed[ph.id]) continue;
      for (const it of itemsByPhase.get(ph.id) ?? []) visibleIds.add(it.id);
    }

    const pairs: Array<{ predId: string; succId: string }> = [];
    for (const it of doc.items ?? []) {
      if (!visibleIds.has(it.id)) continue;
      const deps = it.dependencies ?? [];
      for (const predId of deps) {
        if (!visibleIds.has(predId)) continue;
        if (predId === it.id) continue;
        pairs.push({ predId, succId: it.id });
      }
    }

    return pairs.slice(0, 2500);
  }, [doc.items, doc.phases, itemsByPhase, collapsed]);

  function recomputeDependencyPaths() {
    const canvas = depsCanvasRef.current;
    const content = timelineContentRef.current;
    if (!canvas || !content) {
      setDepPaths([]);
      return;
    }

    const contentRect = content.getBoundingClientRect();
    const scrollLeft = bodyScrollRef.current?.scrollLeft || 0;
    const scrollTop = bodyScrollRef.current?.scrollTop || 0;

    const next: DepPath[] = [];

    for (const p of depsForVisible) {
      const predEl = barNodeRef.current.get(p.predId);
      const succEl = barNodeRef.current.get(p.succId);
      if (!predEl || !succEl) continue;

      const pr = predEl.getBoundingClientRect();
      const sr = succEl.getBoundingClientRect();

      const x1 = pr.right - contentRect.left + scrollLeft;
      const y1 = pr.top - contentRect.top + scrollTop + pr.height / 2;
      const x2 = sr.left - contentRect.left + scrollLeft;
      const y2 = sr.top - contentRect.top + scrollTop + sr.height / 2;

      if (x1 < 0 && x2 < 0) continue;
      if (x1 > contentRect.width + scrollLeft && x2 > contentRect.width + scrollLeft) continue;

      next.push({ predId: p.predId, succId: p.succId, a: { x1, y1, x2, y2 } });
    }

    setDepPaths(next.slice(0, 2500));
  }

  useEffect(() => {
    if (!timelineContentRef.current) return;

    const observer = new ResizeObserver(() => {
      recomputeDependencyPaths();
    });

    observer.observe(timelineContentRef.current);

    barNodeRef.current.forEach((el) => {
      observer.observe(el);
    });

    return () => observer.disconnect();
  }, [depsForVisible]);

  useLayoutEffect(() => {
    const timer = setTimeout(() => {
      recomputeDependencyPaths();
    }, 0);
    return () => clearTimeout(timer);
  }, [depsForVisible, pageWeeks, view, pageStartWeek, collapsed, packed.laneOf]);

  useEffect(() => {
    const onAny = () => recomputeDependencyPaths();
    window.addEventListener("resize", onAny);
    const el = bodyScrollRef.current;
    if (el) el.addEventListener("scroll", onAny, { passive: true });
    return () => {
      window.removeEventListener("resize", onAny);
      if (el) el.removeEventListener("scroll", onAny);
    };
  }, []);

  function depPathD(a: Anchor) {
    const stub = 16;
    const xMid = a.x1 + stub;
    return `M ${a.x1} ${a.y1} L ${xMid} ${a.y1} L ${xMid} ${a.y2} L ${a.x2} ${a.y2}`;
  }

  function arrowForEnd(a: Anchor) {
    const size = 5;
    const dir = a.x2 >= a.x1 ? 1 : -1;
    const ax = a.x2;
    const ay = a.y2;
    const x0 = ax - dir * size;
    return `M ${x0} ${ay - 3} L ${ax} ${ay} L ${x0} ${ay + 3}`;
  }

  /* ---------------- WBS Import (lazy fetch) ---------------- */

  async function appendFromWbs() {
    if (readOnly) return;

    const loaded = await ensureWbsLoaded();
    if (!loaded) return;

    const rows = normalizeWbs(loaded).rows;
    if (!rows.length) {
      setMsg("⛔ No WBS found for this project.");
      return;
    }

    const imported = buildScheduleFromWbs({
      wbs: loaded,
      projectStartDate,
      projectFinishDate,
    });

    if (!imported) {
      setMsg("⛔ WBS format not recognised (no rows).");
      return;
    }

    const ok = window.confirm("Append from WBS will ADD tasks into this schedule.\n\nContinue?");
    if (!ok) return;

    updateDoc((prev) => {
      const existingIds = new Set((prev.items ?? []).map((x) => x.id));

      const phaseIdByName = new Map<string, string>();
      for (const p of prev.phases ?? []) phaseIdByName.set(safeStr(p.name).trim().toLowerCase(), p.id);

      const newPhases: SchedulePhase[] = [...(prev.phases ?? [])];
      const importedPhaseIdMap = new Map<string, string>();

      for (const p of imported.phases ?? []) {
        const key = safeStr(p.name).trim().toLowerCase() || "phase";
        const existing = phaseIdByName.get(key);
        if (existing) {
          importedPhaseIdMap.set(p.id, existing);
          continue;
        }
        const id = uuidish();
        newPhases.push({ id, name: safeStr(p.name) || "Phase" });
        phaseIdByName.set(key, id);
        importedPhaseIdMap.set(p.id, id);
      }

      const idMap = new Map<string, string>();
      for (const it of imported.items ?? []) {
        const oldId = it.id;
        const nextId = existingIds.has(oldId) ? uuidish() : oldId;
        idMap.set(oldId, nextId);
      }

      const appendedItems: ScheduleItem[] = (imported.items ?? []).map((it) => {
        const newId = idMap.get(it.id) ?? uuidish();
        const mappedPhaseId = importedPhaseIdMap.get(it.phaseId) ?? it.phaseId;
        const deps = (it.dependencies ?? []).map((d) => idMap.get(d) ?? "").filter(Boolean);

        return normalizeItemPatch(
          {
            ...it,
            id: newId,
            phaseId: mappedPhaseId,
            dependencies: deps,
          },
          {}
        );
      });

      const mergedItems = [...(prev.items ?? [])];
      for (const it of appendedItems) {
        if (existingIds.has(it.id)) continue;
        mergedItems.push(it);
        existingIds.add(it.id);
      }

      return { ...prev, phases: newPhases, items: mergedItems };
    });

    setSelectedItemId(null);
    setPanelMode("closed");
    setMsg("✅ Appended from WBS (remember to Save schedule)");
    setTimeout(() => setMsg(""), 1400);
    setTimeout(() => recomputeDependencyPaths(), 0);
  }

  /* ---------------- Dependencies editor ---------------- */

  const titleText = safeStr(projectTitle).trim() || "Schedule / Roadmap";

  const depCandidates = useMemo(() => {
    if (!selectedItem) return [];
    const q = safeStr(depQuery).trim().toLowerCase();
    const existing = new Set(selectedItem.dependencies ?? []);
    return (doc.items ?? [])
      .filter((x) => x.id !== selectedItem.id)
      .filter((x) => !existing.has(x.id))
      .filter((x) => (q ? safeStr(x.name).toLowerCase().includes(q) : true))
      .sort((a, b) => safeStr(a.name).localeCompare(safeStr(b.name)))
      .slice(0, 20);
  }, [depQuery, doc.items, selectedItem]);

  function addDependencyById(depId: string) {
    if (!selectedItem) return;
    if (depId === selectedItem.id) return;
    const next = Array.from(new Set([...(selectedItem.dependencies ?? []), depId]));
    updateItem(selectedItem.id, { dependencies: next });
    setDepQuery("");
    setTimeout(() => recomputeDependencyPaths(), 0);
  }

  /* ---------------- Exports ---------------- */

  function triggerExcelDownload() {
    const safeTitle = titleText.replace(/[^a-z0-9]/gi, "_") || "schedule";
    window.location.href = `/api/export/excel?artifactId=${artifactId}&title=${encodeURIComponent(safeTitle)}`;
  }

  function triggerPptxDownload() {
    const safeTitle = titleText.replace(/[^a-z0-9]/gi, "_") || "roadmap";
    window.location.href = `/api/export/pptx?artifactId=${artifactId}&title=${encodeURIComponent(safeTitle)}`;
  }

  /* ---------------- UI helpers ---------------- */

  const StatusDot = ({ status, size = "sm" }: { status: ItemStatus; size?: "sm" | "md" }) => {
    const colors = statusColor(status);
    const sizeClass = size === "md" ? "w-2.5 h-2.5" : "w-2 h-2";
    return <div className={`${sizeClass} rounded-full ${colors.bg}`} />;
  };

  const TypeIcon = ({ type }: { type: ItemType }) => {
    if (type === "milestone") return <div className="w-3 h-3 rotate-45 bg-orange-500 rounded-[2px]" />;
    if (type === "deliverable") return <div className="w-2.5 h-2.5 rounded-sm bg-purple-500" />;
    return <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />;
  };

  /* ────────────────────────────────────────────────
     Render
  ───────────────────────────────────────────────── */

  return (
    <div className="h-screen flex flex-col bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="flex-none bg-white border-b border-slate-200 px-6 py-4">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-900 truncate">{titleText}</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              {projectStartDate && projectFinishDate
                ? `${projectStartDate} → ${projectFinishDate}`
                : "Schedule / Roadmap"}
            </p>
          </div>

          <div className="flex items-center gap-2">
            {msg && (
              <span
                className={`text-sm px-3 py-1.5 rounded-lg ${
                  msg.includes("✅")
                    ? "bg-emerald-50 text-emerald-700"
                    : msg.includes("⛔")
                      ? "bg-red-50 text-red-700"
                      : msg.includes("⚠️")
                        ? "bg-amber-50 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                }`}
              >
                {msg}
              </span>
            )}

            {!readOnly && (
              <button
                onClick={appendFromWbs}
                disabled={wbsLoading}
                className="px-3 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title={wbsJson ? "Append tasks from WBS" : "Load WBS and append tasks"}
              >
                {wbsLoading ? "Loading WBS…" : "Import WBS"}
              </button>
            )}

            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
              <button
                onClick={triggerExcelDownload}
                disabled={isPending || !doc.items?.length}
                className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white rounded-md shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Excel
              </button>
              <button
                onClick={triggerPptxDownload}
                disabled={isPending || !doc.items?.length}
                className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white rounded-md shadow-sm hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                PPT
              </button>
            </div>

            {!readOnly && (
              <button
                onClick={() => save(true)}
                disabled={isPending || !dirty}
                className="px-4 py-2 text-sm font-medium text-white bg-slate-900 rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2"
              >
                {isPending ? (
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : null}
                Save
                {dirty && <span className="w-2 h-2 bg-amber-400 rounded-full" />}
              </button>
            )}
          </div>
        </div>

        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-4">
          {/* View Controls */}
          <div className="flex items-center gap-2 bg-slate-100 rounded-lg p-1">
            {[1, 4, 12, 36, 52].map((v) => (
              <button
                key={v}
                onClick={() => {
                  setView(v as ViewMode);
                  setPageStartWeek(0);
                }}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  view === v ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {viewLabel(v as ViewMode)}
              </button>
            ))}
          </div>

          {/* Navigation */}
          {!useCustomRange && view !== 52 && (
            <div className="flex items-center gap-1">
              <button
                onClick={prevPage}
                disabled={!canPrev()}
                className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition-colors"
              >
                ←
              </button>
              <span className="text-sm text-slate-600 min-w-[80px] text-center">
                Week {pageStartWeek + 1}-{Math.min(pageStartWeek + view, 52)}
              </span>
              <button
                onClick={nextPage}
                disabled={!canNext()}
                className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg disabled:opacity-40 transition-colors"
              >
                →
              </button>
            </div>
          )}

          <div className="h-6 w-px bg-slate-200" />

          {/* Filters */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search items..."
                className="w-48 pl-9 pr-3 py-1.5 text-sm bg-white border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
              />
              <svg
                className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  ×
                </button>
              )}
            </div>

            <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-lg p-1">
              {[
                { key: "milestone", label: "M", state: showMilestones, set: setShowMilestones, color: "text-orange-600" },
                { key: "task", label: "T", state: showTasks, set: setShowTasks, color: "text-blue-600" },
                { key: "deliverable", label: "D", state: showDeliverables, set: setShowDeliverables, color: "text-purple-600" },
              ].map(({ key, label, state, set, color }) => (
                <button
                  key={key}
                  onClick={() => set(!state)}
                  disabled={readOnly}
                  className={`px-2.5 py-1 text-sm font-medium rounded transition-colors ${
                    state ? `bg-slate-100 ${color}` : "text-slate-400 hover:text-slate-600"
                  } disabled:opacity-50`}
                  title={`Toggle ${key}s`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-6 w-px bg-slate-200" />

          {/* Date Controls */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input
                type="checkbox"
                checked={useCustomRange}
                onChange={(e) => setUseCustomRange(e.target.checked)}
                className="rounded border-slate-300"
              />
              Range
            </label>

            {useCustomRange ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={rangeFrom}
                  onChange={(e) => setRangeFrom(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                <span className="text-slate-400">→</span>
                <input
                  type="date"
                  value={rangeTo}
                  onChange={(e) => setRangeTo(e.target.value)}
                  className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400"
                />
                {rangeError && <span className="text-xs text-red-600">{rangeError}</span>}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={safeStr(doc.anchor_date) || ""}
                  onChange={(e) => setAnchorDate(e.target.value)}
                  disabled={readOnly}
                  className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50"
                />
                <button
                  onClick={() => setAnchorDate(projectStartDate || todayISO())}
                  disabled={readOnly}
                  className="text-sm text-slate-600 hover:text-slate-900 disabled:opacity-50"
                >
                  Reset
                </button>
              </div>
            )}
          </div>

          <div className="flex-1" />

          {!readOnly && (
            <button
              onClick={addPhase}
              className="px-3 py-1.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              + Phase
            </button>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
          <div className="flex items-center gap-1.5">
            <StatusDot status="on_track" />
            <span>On Track</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusDot status="at_risk" />
            <span>At Risk</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusDot status="delayed" />
            <span>Delayed</span>
          </div>
          <div className="flex items-center gap-1.5">
            <StatusDot status="done" />
            <span>Done</span>
          </div>
          <div className="h-3 w-px bg-slate-300 mx-1" />
          <span>Drag to move • Drag right edge to resize</span>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Gantt Area */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Timeline Header */}
          <div className="flex-none bg-white border-b border-slate-200 overflow-hidden">
            <div className="flex">
              <div
                className="flex-none px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider border-r border-slate-200 bg-white z-20"
                style={{ width: PHASE_COL_W }}
              >
                Phase
              </div>

              <div ref={scrollRef} className="flex-1 overflow-x-auto scrollbar-hide">
                <div style={{ width: pageWeeks.length * WEEK_COL_W, minWidth: "100%" }}>
                  <div className="flex relative">
                    {todayLineX !== null && (
                      <div
                        className="absolute top-0 bottom-0 z-0 pointer-events-none"
                        style={{
                          left: todayLineX,
                          borderLeft: "2px dashed rgba(34, 197, 94, 0.8)",
                          filter: "drop-shadow(0 0 6px rgba(34, 197, 94, 0.8))",
                        }}
                      >
                        <div className="absolute -top-1 -translate-x-1/2 px-1.5 py-0.5 bg-emerald-500 text-white text-[10px] font-medium rounded whitespace-nowrap z-10">
                          Today
                        </div>
                      </div>
                    )}

                    {pageWeeks.map((w) => (
                      <div
                        key={w.idx}
                        className="flex-none px-3 py-3 border-r border-slate-200 text-center"
                        style={{ width: WEEK_COL_W }}
                      >
                        <div className="text-xs font-semibold text-slate-700">W{w.idx + 1}</div>
                        <div className="text-[10px] text-slate-400 mt-0.5">{w.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Timeline Body */}
          <div className="flex-1 overflow-hidden flex">
            {/* Sticky Phase Column */}
            <div
              className="flex-none overflow-y-auto bg-white border-r border-slate-200 z-10 scrollbar-hide"
              style={{ width: PHASE_COL_W }}
            >
              <div className="divide-y divide-slate-200">
                {(doc.phases ?? []).map((ph) => {
                  const isCollapsed = !!collapsed[ph.id];
                  const items = isCollapsed ? [] : itemsByPhase.get(ph.id) ?? [];
                  const pct = compactPct(items.filter((x) => x.type !== "milestone"));
                  const rowH = getPhaseHeight(ph);

                  return (
                    <div
                      key={ph.id}
                      className="p-4 hover:bg-slate-50/50 transition-colors group box-border overflow-hidden"
                      style={{ height: rowH, minHeight: rowH }}
                    >
                      <div className="flex items-start gap-2">
                        <button
                          onClick={() => togglePhaseCollapse(ph.id)}
                          className="mt-1 p-1 hover:bg-slate-100 rounded transition-colors text-slate-400 hover:text-slate-600 flex-shrink-0"
                        >
                          {isCollapsed ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          )}
                        </button>

                        <div className="flex-1 min-w-0 overflow-hidden">
                          <input
                            value={ph.name}
                            onChange={(e) => updatePhase(ph.id, { name: e.target.value })}
                            disabled={readOnly}
                            className="w-full font-semibold text-slate-900 bg-transparent border-0 p-0 focus:ring-0 placeholder:text-slate-400 disabled:opacity-60 truncate"
                            placeholder="Phase name"
                            style={{ textOverflow: "ellipsis" }}
                          />
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-xs text-slate-500">{items.length} items</span>
                            {!isCollapsed && <span className="text-xs font-medium text-emerald-600">{pct}%</span>}
                          </div>
                        </div>

                        {!readOnly && (
                          <button
                            onClick={() => deletePhase(ph.id)}
                            className="p-1.5 hover:bg-red-50 text-slate-400 hover:text-red-600 rounded-lg transition-colors opacity-0 group-hover:opacity-100 flex-shrink-0"
                            title="Delete phase"
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
                        )}
                      </div>

                      {!isCollapsed && !readOnly && (
                        <div className="flex items-center gap-1 mt-3">
                          <button
                            onClick={() => addItem(ph.id, "milestone")}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-orange-700 bg-orange-50 hover:bg-orange-100 rounded transition-colors"
                          >
                            <div className="w-2 h-2 rotate-45 bg-orange-500 rounded-[1px]" />
                            Milestone
                          </button>
                          <button
                            onClick={() => addItem(ph.id, "task")}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded transition-colors"
                          >
                            <div className="w-2 h-2 rounded-full bg-blue-500" />
                            Task
                          </button>
                          <button
                            onClick={() => addItem(ph.id, "deliverable")}
                            className="flex items-center gap-1 px-2 py-1 text-xs font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 rounded transition-colors"
                          >
                            <div className="w-2 h-2 rounded-sm bg-purple-500" />
                            Deliverable
                          </button>
                        </div>
                      )}

                      {!isCollapsed && (
                        <div className="mt-3">
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-emerald-500 rounded-full transition-all"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Overall Progress */}
              <div className="p-4 border-t border-slate-200 bg-slate-50 sticky bottom-0">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-slate-700">Overall</span>
                  <span className="text-sm font-semibold text-slate-900">{overallProgress}%</span>
                </div>
                <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </div>
            </div>

            {/* Scrollable Timeline Area */}
            <div
              ref={bodyScrollRef}
              className="flex-1 overflow-auto relative"
              onScroll={(e) => {
                if (scrollRef.current) scrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
              }}
            >
              {todayLineX !== null && (
                <div
                  className="absolute top-0 z-0 pointer-events-none"
                  style={{
                    left: todayLineX,
                    height: phaseMetrics.totalHeight,
                    borderLeft: "2px dashed rgba(34, 197, 94, 0.6)",
                    filter: "drop-shadow(0 0 8px rgba(34, 197, 94, 0.6))",
                  }}
                />
              )}

              {/* Dependencies canvas */}
              <div
                ref={depsCanvasRef}
                className="absolute pointer-events-none z-20"
                style={{
                  left: 0,
                  top: 0,
                  width: pageWeeks.length * WEEK_COL_W,
                  height: phaseMetrics.totalHeight,
                  minWidth: "100%",
                  minHeight: "100%",
                  overflow: "visible",
                }}
              >
                {depPaths.length > 0 && (
                  <svg
                    className="absolute inset-0"
                    width={pageWeeks.length * WEEK_COL_W}
                    height={phaseMetrics.totalHeight}
                    aria-hidden="true"
                  >
                    {depPaths.map((p, i) => {
                      const stroke = "rgba(100, 116, 139, 0.4)";
                      return (
                        <g key={`${p.predId}_${p.succId}_${i}`}>
                          <path
                            d={depPathD(p.a)}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                            strokeDasharray="4 2"
                          />
                          <path
                            d={arrowForEnd(p.a)}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={1.5}
                            strokeLinejoin="round"
                            strokeLinecap="round"
                          />
                        </g>
                      );
                    })}
                  </svg>
                )}
              </div>

              {/* Timeline content */}
              <div
                ref={timelineContentRef}
                className="relative divide-y divide-slate-200"
                style={{ width: pageWeeks.length * WEEK_COL_W, minWidth: "100%" }}
              >
                {(doc.phases ?? []).map((ph) => {
                  const isCollapsed = !!collapsed[ph.id];
                  const items = isCollapsed ? [] : itemsByPhase.get(ph.id) ?? [];
                  const rowH = getPhaseHeight(ph);

                  return (
                    <div
                      key={ph.id}
                      className="relative bg-white hover:bg-slate-50/30 transition-colors overflow-hidden"
                      style={{ height: rowH, minHeight: rowH }}
                    >
                      {/* Week grid */}
                      <div className="absolute inset-0 flex">
                        {pageWeeks.map((w, idx) => (
                          <div
                            key={w.idx}
                            className="flex-none border-r border-slate-200/60 h-full"
                            style={{
                              width: WEEK_COL_W,
                              backgroundColor: idx % 2 === 0 ? "transparent" : "rgba(248, 250, 252, 0.5)",
                            }}
                          />
                        ))}
                      </div>

                      {/* Bars */}
                      {!isCollapsed &&
                        items.map((it) => {
                          const geom = computeBarGeometry(it);
                          if (!geom || geom.width <= 0) return null;

                          const lane = packed.laneOf.get(it.id) ?? 0;
                          const top = TOP_PAD + lane * (BAR_H + LANE_GAP);
                          const colors = statusColor(it.status);
                          const isMilestone = it.type === "milestone";
                          const isSelected = selectedItemId === it.id;

                          return (
                            <div
                              key={it.id}
                              ref={(el) => registerBarNode(it.id, el)}
                              className={`
                                absolute rounded-lg border-2 shadow-sm transition-all
                                ${isSelected ? `ring-2 ${colors.ring} ring-offset-2` : ""}
                                ${colors.border} bg-white hover:shadow-md
                              `}
                              style={{
                                left: geom.left,
                                width: geom.width,
                                top,
                                height: BAR_H,
                                cursor: readOnly ? "pointer" : "grab",
                                zIndex: isSelected ? 15 : 5,
                              }}
                              onPointerDown={(e) => beginDrag(e, it.id, "move")}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (dragRef.current?.moved) return;
                                setSelectedItemId(it.id);
                                setPanelMode("edit");
                              }}
                            >
                              <div className="h-full flex items-center px-2 gap-2 overflow-hidden">
                                <TypeIcon type={it.type} />
                                <span className="text-xs font-medium truncate text-slate-500">
                                  {it.name || "(untitled)"}
                                </span>

                                {!readOnly && !isMilestone && (
                                  <div
                                    className="ml-auto w-3 h-full cursor-ew-resize hover:bg-slate-100 rounded-r flex items-center justify-center"
                                    onPointerDown={(e) => {
                                      e.stopPropagation();
                                      beginDrag(e, it.id, "resize_end");
                                    }}
                                  >
                                    <div className="w-0.5 h-3 bg-slate-300 rounded-full" />
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Side Panel */}
        {panelMode !== "closed" && selectedItem && (
          <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl flex-shrink-0">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <div className="flex items-center gap-2">
                <TypeIcon type={selectedItem.type} />
                <span className="font-semibold text-slate-900">Edit Item</span>
              </div>
              <button
                onClick={() => {
                  setPanelMode("closed");
                  setSelectedItemId(null);
                }}
                className="p-1 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-slate-600 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-4">
              {!readOnly && (
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => updateItem(selectedItem.id, { status: "done" })}
                    className="px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg transition-colors"
                  >
                    Mark Done
                  </button>
                  <button
                    onClick={() => shiftItemByWeeks(selectedItem.id, -1)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    ← 1 Week
                  </button>
                  <button
                    onClick={() => shiftItemByWeeks(selectedItem.id, 1)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    1 Week →
                  </button>
                  <button
                    onClick={() => duplicateItem(selectedItem.id)}
                    className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                  >
                    Duplicate
                  </button>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    Name
                  </label>
                  <input
                    value={selectedItem.name}
                    onChange={(e) => updateItem(selectedItem.id, { name: e.target.value })}
                    disabled={readOnly}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                      Start
                    </label>
                    <input
                      type="date"
                      value={selectedItem.start || ""}
                      onChange={(e) => updateItem(selectedItem.id, { start: e.target.value })}
                      disabled={readOnly}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                      End
                    </label>
                    <input
                      type="date"
                      value={selectedItem.type === "milestone" ? "" : selectedItem.end || ""}
                      onChange={(e) => updateItem(selectedItem.id, { end: e.target.value })}
                      disabled={readOnly || selectedItem.type === "milestone"}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                      Type
                    </label>
                    <select
                      value={selectedItem.type}
                      onChange={(e) => updateItem(selectedItem.id, { type: e.target.value as ItemType })}
                      disabled={readOnly}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 bg-white"
                    >
                      <option value="milestone">Milestone</option>
                      <option value="task">Task</option>
                      <option value="deliverable">Deliverable</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                      Status
                    </label>
                    <select
                      value={selectedItem.status}
                      onChange={(e) => updateItem(selectedItem.id, { status: e.target.value as ItemStatus })}
                      disabled={readOnly}
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 bg-white"
                    >
                      <option value="on_track">On Track</option>
                      <option value="at_risk">At Risk</option>
                      <option value="delayed">Delayed</option>
                      <option value="done">Done</option>
                    </select>
                  </div>
                </div>

                {/* Dependencies */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    Dependencies
                  </label>

                  <div className="relative">
                    <input
                      value={depQuery}
                      onChange={(e) => setDepQuery(e.target.value)}
                      disabled={readOnly}
                      placeholder="Search to add..."
                      className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60"
                    />
                    {depQuery && !readOnly && (
                      <div className="absolute z-10 mt-1 w-full bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                        {depCandidates.length === 0 ? (
                          <div className="px-3 py-2 text-sm text-slate-500">No matches</div>
                        ) : (
                          depCandidates.map((it) => (
                            <button
                              key={it.id}
                              onClick={() => addDependencyById(it.id)}
                              className="w-full px-3 py-2 text-left text-sm hover:bg-slate-50 transition-colors border-b border-slate-100 last:border-0"
                            >
                              <div className="font-medium text-slate-900">{it.name || "(untitled)"}</div>
                              <div className="text-xs text-slate-500">
                                {it.type} • {it.start}
                                {it.type !== "milestone" && it.end ? ` → ${it.end}` : ""}
                              </div>
                            </button>
                          ))
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2 mt-2">
                    {(selectedItem.dependencies ?? []).map((id) => {
                      const it = itemById.get(id);
                      const label = it ? it.name || "(untitled)" : `Unknown (${id.slice(0, 6)}...)`;
                      return (
                        <div
                          key={id}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-100 text-slate-700 rounded-full"
                        >
                          <span className="truncate max-w-[120px]">{label}</span>
                          {!readOnly && (
                            <button
                              onClick={() => {
                                const next = (selectedItem.dependencies ?? []).filter((x) => x !== id);
                                updateItem(selectedItem.id, { dependencies: next });
                                setTimeout(() => recomputeDependencyPaths(), 0);
                              }}
                              className="hover:text-red-600"
                            >
                              ×
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 uppercase tracking-wider mb-1.5">
                    Notes
                  </label>
                  <textarea
                    value={selectedItem.notes || ""}
                    onChange={(e) => updateItem(selectedItem.id, { notes: e.target.value })}
                    disabled={readOnly}
                    rows={4}
                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-60 resize-none"
                  />
                </div>
              </div>
            </div>

            {!readOnly && (
              <div className="p-4 border-t border-slate-200 bg-slate-50">
                <button
                  onClick={() => deleteItem(selectedItem.id)}
                  className="w-full px-4 py-2 text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                  Delete Item
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
