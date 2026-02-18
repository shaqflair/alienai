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

// Modal expects these statuses (ChangeCreateModal)
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

  impact_analysis?: any; // expects { days, cost, risk }
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
   Helpers
========================= */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeNum(x: any, fb = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}

function laneLabel(l: DeliveryLane) {
  if (l === "intake") return "Intake";
  if (l === "in_progress") return "Implementation";
  return l.replaceAll("_", " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

function laneBorder(l: DeliveryLane) {
  if (l === "intake") return "border-sky-200";
  if (l === "analysis") return "border-indigo-200";
  if (l === "review") return "border-amber-200";
  if (l === "in_progress") return "border-violet-200";
  if (l === "implemented") return "border-emerald-200";
  return "border-blue-200";
}

function laneHeaderTone(l: DeliveryLane) {
  if (l === "intake") return "bg-sky-50 text-sky-900";
  if (l === "analysis") return "bg-indigo-50 text-indigo-900";
  if (l === "review") return "bg-amber-50 text-amber-900";
  if (l === "in_progress") return "bg-violet-50 text-violet-900";
  if (l === "implemented") return "bg-emerald-50 text-emerald-900";
  return "bg-blue-50 text-blue-900";
}

function priorityTone(p: unknown) {
  const v = safeStr(p).trim().toLowerCase();
  if (v === "critical") return "bg-rose-50 text-rose-800 border-rose-200";
  if (v === "high") return "bg-amber-50 text-amber-800 border-amber-200";
  if (v === "medium") return "bg-indigo-50 text-indigo-800 border-indigo-200";
  if (v === "low") return "bg-emerald-50 text-emerald-800 border-emerald-200";
  return "bg-gray-50 text-gray-700 border-gray-200";
}

function isLocked(item: ChangeItem) {
  const d = safeStr(item.decision_status).trim().toLowerCase();
  return d === "submitted";
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

function riskLabelFromImpact(impact: any) {
  const raw =
    safeStr(impact?.risk_level).trim() ||
    safeStr(impact?.risk_rating).trim() ||
    safeStr(impact?.risk).trim();

  if (!raw) return "";
  const v = raw.toLowerCase();
  if (v.includes("critical")) return "Critical";
  if (v.includes("high")) return "High";
  if (v.includes("medium") || v.includes("med")) return "Medium";
  if (v.includes("low")) return "Low";
  return raw.slice(0, 18);
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

    implementationPlan:
      safeStr((it as any)?.implementationPlan) || safeStr((it as any)?.implementation_plan) || "",
    rollbackPlan: safeStr((it as any)?.rollbackPlan) || safeStr((it as any)?.rollback_plan) || "",

    aiImpact: impact
      ? {
          days: safeNum(impact?.days, 0),
          cost: safeNum(impact?.cost, 0),
          risk: safeStr(impact?.risk ?? "None identified") || "None identified",
        }
      : undefined,
  };
}

/**
 * ? Canonical dedupe:
 * keeps the newest row if the same id appears multiple times.
 */
function dedupeKeepLatest(rows: ChangeItem[]) {
  const byId = new Map<string, ChangeItem>();

  for (const r of Array.isArray(rows) ? rows : []) {
    const id = safeStr((r as any)?.id).trim();
    if (!id) continue;

    const prev = byId.get(id);
    if (!prev) {
      byId.set(id, { ...(r as any), id });
      continue;
    }

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
  if (!res.ok || (json as any)?.ok === false) {
    throw new Error(safeStr((json as any)?.error) || `HTTP ${res.status}`);
  }
  return json;
}

/* =========================
   Droppable lane list wrapper
========================= */

function LaneList({
  lane,
  children,
}: {
  lane: DeliveryLane;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: lane, // ? THIS is how resolveDropLane can detect lane drops
    data: { type: "Lane", lane },
  });

  return (
    <div
      ref={setNodeRef}
      className={`p-3 space-y-3 min-h-[60vh] transition-colors ${
        isOver ? "bg-indigo-50/40" : ""
      }`}
    >
      {children}
    </div>
  );
}

/* =========================
   Card
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
  // ? dnd-kit MUST have globally unique draggable ids
  const sortableId = `card:${item.id}`;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: sortableId,
    data: { type: "Card", id: item.id, lane },
    disabled: saving || isLocked(item),
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };

  const locked = isLocked(item);
  const impactDays = safeNum(item.impact_analysis?.days, 0);
  const impactCost = safeNum(item.impact_analysis?.cost, 0);
  const riskLabel = riskLabelFromImpact(item.impact_analysis);
  const score = safeNum(item.ai_score, 0);

  return (
    <div ref={setNodeRef} style={style} {...attributes}>
      <div
        className={`rounded-xl border bg-white shadow-sm hover:shadow-md transition-all p-3 ${
          locked ? "border-gray-300 opacity-90" : "border-gray-200"
        } ${saving ? "ring-1 ring-indigo-200" : ""}`}
      >
        <div className="flex items-start justify-between gap-2">
          <button
            type="button"
            onClick={() => onClick(item)}
            className="text-left min-w-0 flex-1"
            disabled={saving}
            title="Open"
          >
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-xs font-semibold text-gray-500">{changeDisplay(item)}</span>

              {item.priority ? (
                <span
                  className={`px-2 py-0.5 rounded-full text-[11px] font-medium border ${priorityTone(
                    item.priority
                  )}`}
                >
                  {safeStr(item.priority)}
                </span>
              ) : null}

              {riskLabel ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-gray-50 text-gray-700 border-gray-200">
                  Risk: {riskLabel}
                </span>
              ) : null}

              {locked ? (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium border bg-gray-100 text-gray-700 border-gray-200">
                  Locked
                </span>
              ) : null}
            </div>

            <div className="mt-1 font-semibold text-gray-900 leading-snug line-clamp-2">
              {safeStr(item.title) || "Untitled"}
            </div>

            <div className="mt-2 flex items-center gap-2 flex-wrap text-[11px]">
              <span className="bg-gray-50 border border-gray-200 px-1.5 rounded">
                AI {Math.round(score)}
              </span>
              <span className="bg-gray-50 border border-gray-200 px-1.5 rounded">? {impactDays}d</span>
              <span className="bg-gray-50 border border-gray-200 px-1.5 rounded">
                £ {impactCost.toLocaleString("en-GB", { maximumFractionDigits: 0 })}
              </span>
            </div>
          </button>

          <button
            type="button"
            className={`shrink-0 p-2 rounded-lg border transition-colors ${
              locked || saving
                ? "bg-gray-50 border-gray-200 text-gray-300 cursor-not-allowed"
                : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
            }`}
            title={locked ? "Locked during approval" : "Drag"}
            disabled={locked || saving}
            {...(!locked && !saving ? listeners : {})}
          >
            <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M7 4a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0zm10-12a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0zm0 6a1 1 0 11-2 0 1 1 0 012 0z" />
            </svg>
          </button>
        </div>

        <div className="mt-3 flex items-center justify-end gap-1.5">
          <button
            type="button"
            onClick={() => onTimeline(item)}
            disabled={saving}
            className="px-2 py-1 rounded-md text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Timeline"
          >
            ??
          </button>

          <button
            type="button"
            onClick={() => onAttachments(item)}
            disabled={saving}
            className="px-2 py-1 rounded-md text-xs font-medium bg-white border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            title="Attachments"
          >
            ??
          </button>

          <button
            type="button"
            onClick={() => onAi(item)}
            disabled={saving}
            className="px-2 py-1 rounded-md text-xs font-medium bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
            title="AI"
          >
            ?
          </button>

          {showSubmit ? (
            <button
              type="button"
              onClick={() => onSubmit(item)}
              disabled={saving}
              className="px-2 py-1 rounded-md text-xs font-semibold bg-amber-50 border border-amber-200 text-amber-800 hover:bg-amber-100 disabled:opacity-50"
              title="Submit for approval"
            >
              Submit
            </button>
          ) : null}
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
}: {
  projectUuid: string;
  artifactId?: string | null;
  projectHumanId?: string | null;
  projectLabel?: string | null;
}) {
  const [items, setItems] = useState<ChangeItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  // per-card saving
  const [savingIds, setSavingIds] = useState<Record<string, true>>({});
  const savingSeqRef = useRef<Record<string, number>>({});

  // DnD active (stores sortable id: "card:<uuid>")
  const [activeSortableId, setActiveSortableId] = useState<string | null>(null);

  // Create/Edit
  const [createOpen, setCreateOpen] = useState(false);
  const [createLane, setCreateLane] = useState<DeliveryLane>("intake");

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editInitialValue, setEditInitialValue] = useState<any | null>(null);

  // drawers
  const [aiOpen, setAiOpen] = useState(false);
  const [aiChangeId, setAiChangeId] = useState<string | null>(null);

  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timelineChangeId, setTimelineChangeId] = useState<string | null>(null);

  const [attOpen, setAttOpen] = useState(false);
  const [attChangeId, setAttChangeId] = useState<string | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const fetchData = useCallback(async () => {
    if (!projectUuid) return;
    setLoading(true);
    setErr("");
    try {
      // ? consume server lanes (deduped + grouped + sorted if you used my API update)
      const j = await apiJson(
        `/api/change?projectId=${encodeURIComponent(projectUuid)}&shape=lanes`,
        { cache: "no-store" }
      );

      const lanes = (j as any)?.lanes as LanesResponse | undefined;

      // fallback if server returns items for any reason
      const list = Array.isArray((j as any)?.items) ? ((j as any).items as ChangeItem[]) : [];

      const flattened =
        lanes && typeof lanes === "object"
          ? LANES.flatMap((l) => (Array.isArray((lanes as any)[l]) ? (lanes as any)[l] : []))
          : list;

      // ? canonical dedupe keeps latest row only
      const deduped = dedupeKeepLatest(flattened).sort(sortForBoard);

      setItems(deduped);
    } catch (e: any) {
      setItems([]);
      setErr(safeStr(e?.message) || "Failed to load changes");
    } finally {
      setLoading(false);
    }
  }, [projectUuid]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const laneMap = useMemo(() => {
    const canonical = dedupeKeepLatest(items);

    const map: Record<DeliveryLane, ChangeItem[]> = {
      intake: [],
      analysis: [],
      review: [],
      in_progress: [],
      implemented: [],
      closed: [],
    };

    for (const raw of canonical) {
      const id = safeStr((raw as any)?.id).trim();
      if (!id) continue;

      const it = { ...(raw as any), id } as ChangeItem;

      const l = (safeStr(it.delivery_status).trim() as DeliveryLane) || "intake";
      if (LANES.includes(l)) map[l].push(it);
      else map.intake.push(it);
    }

    for (const l of LANES) {
      map[l] = dedupeKeepLatest(map[l]).sort(sortForBoard);
    }

    return map;
  }, [items]);

  const activeItem = useMemo(() => {
    if (!activeSortableId) return null;
    if (!activeSortableId.startsWith("card:")) return null;
    const id = activeSortableId.slice("card:".length);
    return items.find((x) => safeStr(x.id).trim() === id) || null;
  }, [activeSortableId, items]);

  const wipWarning = useMemo(() => {
    const over = LANES.filter((l) => (laneMap[l]?.length ?? 0) > (WIP_LIMITS[l] ?? 99));
    if (!over.length) return "";
    return `WIP limit exceeded: ${over
      .map((l) => `${laneLabel(l)} (${laneMap[l].length}/${WIP_LIMITS[l] ?? 99})`)
      .join(", ")}`;
  }, [laneMap]);

  const openCreate = useCallback((lane: DeliveryLane) => {
    setCreateLane(lane);
    setCreateOpen(true);
  }, []);

  const openEdit = useCallback((it: ChangeItem) => {
    setEditId(it.id);
    setEditInitialValue(mapRowToModalInitialValue(it));
    setEditOpen(true);
  }, []);

  const openAi = useCallback((it: ChangeItem) => {
    setAiChangeId(it.id);
    setAiOpen(true);
  }, []);

  const openTimeline = useCallback((it: ChangeItem) => {
    setTimelineChangeId(it.id);
    setTimelineOpen(true);
  }, []);

  const openAttachments = useCallback((it: ChangeItem) => {
    setAttChangeId(it.id);
    setAttOpen(true);
  }, []);

  // ? move delivery lane (drag)
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

    // ? lane droppable id is the lane string (because we added useDroppable)
    if (LANES.includes(overId as DeliveryLane)) return overId as DeliveryLane;

    // card droppable id is "card:<uuid>"
    if (overId.startsWith("card:")) {
      const id = overId.slice("card:".length);
      const overItem = items.find((x) => safeStr(x.id).trim() === id);
      const lane = safeStr(overItem?.delivery_status).trim() as DeliveryLane;
      if (lane && LANES.includes(lane)) return lane;
    }

    return null;
  }

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveSortableId(String(e.active.id));
  }, []);

  const onDragEnd = useCallback(
    async (e: DragEndEvent) => {
      setActiveSortableId(null);

      const activeSortable = String(e.active?.id || "");
      if (!activeSortable || !activeSortable.startsWith("card:")) return;

      const activeId = activeSortable.slice("card:".length);
      if (!activeId) return;

      if (savingIds[activeId]) return;

      const it = items.find((x) => safeStr(x.id).trim() === activeId);
      if (!it) return;

      const targetLane = resolveDropLane(e.over);
      if (!targetLane) return;

      const fromLane = (safeStr(it.delivery_status).trim() as DeliveryLane) || "intake";
      if (fromLane === targetLane) return;

      if (isLocked(it)) {
        setErr("This change is locked during approval (submitted).");
        return;
      }

      const snapshot = items;

      const nextToken = (savingSeqRef.current[activeId] || 0) + 1;
      savingSeqRef.current[activeId] = nextToken;

      setErr("");
      setSavingIds((p) => ({ ...p, [activeId]: true }));

      // optimistic move (dedupe keeps uniqueness)
      setItems((prev) =>
        dedupeKeepLatest(
          prev.map((x) =>
            safeStr(x.id).trim() === activeId
              ? { ...x, delivery_status: targetLane, updated_at: new Date().toISOString() }
              : x
          )
        )
      );

      try {
        await patchDeliveryStatus(activeId, targetLane);
        if (savingSeqRef.current[activeId] !== nextToken) return;

        setSavingIds((p) => {
          const n = { ...p };
          delete n[activeId];
          return n;
        });
      } catch (ex: any) {
        if (savingSeqRef.current[activeId] !== nextToken) return;

        setItems(snapshot);
        setSavingIds((p) => {
          const n = { ...p };
          delete n[activeId];
          return n;
        });
        setErr(safeStr(ex?.message) || "Move failed");
      }
    },
    [items, savingIds, patchDeliveryStatus]
  );

  const submitForApproval = useCallback(
    async (it: ChangeItem) => {
      try {
        setErr("");

        const lane = safeStr(it.delivery_status).trim();
        if (lane !== "analysis") {
          setErr("Only changes in Analysis can be submitted for approval.");
          return;
        }
        if (isLocked(it)) {
          setErr("Already submitted.");
          return;
        }
        if (isDecided(it)) {
          setErr("Already decided.");
          return;
        }

        await apiJson(`/api/change/${encodeURIComponent(it.id)}/submit`, { method: "POST" });
        await fetchData();
      } catch (e: any) {
        setErr(safeStr(e?.message) || "Submit failed");
      }
    },
    [fetchData]
  );

  const canEdit = true;

  return (
    <div className="w-full">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-6 pt-6">
        <div className="min-w-0">
          <div className="text-lg font-semibold text-gray-900">
            Change Board{projectLabel ? <span className="text-gray-400"> • {projectLabel}</span> : null}
          </div>
          <div className="text-sm text-gray-500">Drag items between lanes to update delivery status.</div>
          {wipWarning ? <div className="mt-1 text-xs text-rose-700">{wipWarning}</div> : null}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openCreate("intake")}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold hover:bg-indigo-700"
            disabled={!projectUuid}
          >
            + New Change
          </button>

          <button
            type="button"
            onClick={fetchData}
            disabled={loading || !projectUuid}
            className="px-3 py-2 rounded-lg bg-white border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {err ? (
        <div className="mx-6 mt-4 p-3 rounded-lg border border-rose-200 bg-rose-50 text-rose-700 text-sm">
          {err}
        </div>
      ) : null}

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      >
        <div className="flex gap-4 p-6 overflow-x-auto min-h-[80vh] items-start">
          {LANES.map((lane) => {
            const laneItems = laneMap[lane] || [];
            const limit = WIP_LIMITS[lane] ?? 99;
            const over = laneItems.length > limit;

            const sortableIds = laneItems.map((i) => `card:${i.id}`);

            return (
              <div key={lane} className="w-80 shrink-0">
                <div className={`rounded-xl border-2 ${laneBorder(lane)} bg-white overflow-hidden`}>
                  <div className={`p-3 border-b border-gray-200 ${laneHeaderTone(lane)}`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-bold truncate">{laneLabel(lane)}</div>
                        <div className="text-xs opacity-80">
                          {laneItems.length}/{limit} {over ? "• WIP limit exceeded" : ""}
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => openCreate(lane)}
                        className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border border-gray-200 hover:bg-gray-50"
                      >
                        + New
                      </button>
                    </div>
                  </div>

                  <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                    <LaneList lane={lane}>
                      {laneItems.map((item) => {
                        const saving = !!savingIds[item.id];

                        const showSubmit =
                          canEdit &&
                          safeStr(item.delivery_status).trim() === "analysis" &&
                          !isLocked(item) &&
                          !isDecided(item);

                        return (
                          <SortableCard
                            key={item.id}
                            lane={lane}
                            item={item}
                            saving={saving}
                            onClick={openEdit}
                            onAi={openAi}
                            onTimeline={openTimeline}
                            onAttachments={openAttachments}
                            onSubmit={submitForApproval}
                            showSubmit={showSubmit}
                          />
                        );
                      })}

                      {laneItems.length === 0 ? (
                        <div className="p-3 rounded-xl border border-dashed border-gray-200 text-sm text-gray-500 bg-gray-50">
                          No items
                        </div>
                      ) : null}
                    </LaneList>
                  </SortableContext>
                </div>
              </div>
            );
          })}
        </div>

        {/* Drag overlay */}
        <DragOverlay dropAnimation={dropAnimation}>
          {activeItem ? (
            <div className="w-[300px]">
              <div className="rounded-xl border border-gray-200 bg-white shadow-lg p-3">
                <div className="text-xs font-semibold text-gray-500">{changeDisplay(activeItem)}</div>
                <div className="mt-1 font-semibold text-gray-900 line-clamp-2">
                  {safeStr(activeItem.title) || "Untitled change"}
                </div>
              </div>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Create modal */}
      <ChangeCreateModal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          fetchData();
        }}
        projectId={projectUuid}
        artifactId={artifactId ?? null}
        initialStatus={createLane === "intake" ? "new" : (createLane as any)}
      />

      {/* Edit modal */}
      <ChangeCreateModal
        open={editOpen}
        onClose={() => {
          setEditOpen(false);
          setEditId(null);
          setEditInitialValue(null);
          fetchData();
        }}
        projectId={projectUuid}
        artifactId={artifactId ?? null}
        mode="edit"
        changeId={editId}
        initialValue={editInitialValue ?? undefined}
        titleOverride="Edit Change Request"
      />

      {/* AI drawer */}
      <ChangeAiDrawer
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        projectId={projectUuid}
        artifactId={artifactId ?? null}
        changeId={aiChangeId}
      />

      {/* Timeline drawer - FIX: Only render when changeId is not null */}
      {timelineChangeId ? (
        <ChangeTimeline
          open={timelineOpen}
          onClose={() => setTimelineOpen(false)}
          projectId={projectUuid}
          projectCode={projectHumanId ?? undefined}
          changeId={timelineChangeId}
        />
      ) : null}

      {/* Attachments drawer - FIX: Only render when changeId is not null */}
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