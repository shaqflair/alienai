"use client";
// FILE: src/app/timeline/_components/GanttClient.tsx
//
// Gantt chart with:
// - Week / Month toggle
// - Project bars with drag-to-shift and edge-drag-to-resize
// - Person swimlanes per project (expandable)
// - Milestones as diamond markers
// - Dependency arrows between projects
// - Capacity utilisation overlay at the bottom
//
// Build fixes applied:
// ✅ UTF-8 safe (no weird bytes / placeholder tokens)
// ✅ JSX-safe arrows (no raw `->` that can trip parsing)
// ✅ Removed unused imports
// ✅ Fixed month weekPositions calc to avoid O(n^2) indexOf in loop
// ✅ Tooltip type uses React.ReactNode safely

import React, { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { shiftProjectDates, resizeProjectDates } from "../actions";
import type { TimelineBundle, TimelineProject, CapacityPoint } from "../_lib/timeline-data";

/* =============================================================================
   CONSTANTS & HELPERS
============================================================================= */

const ROW_H = 44; // project row height px
const SWIM_H = 28; // person swimlane height
const HEADER_H = 52; // column header height
const LABEL_W = 220; // left label column width
const OVERLAY_H = 64; // capacity overlay height
const CELL_W_WK = 48; // week cell width
const CELL_W_MO = 120; // month cell width

type Granularity = "week" | "month";

function getMondayOf(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function addWeeks(iso: string, n: number): string {
  return addDays(iso, n * 7);
}

function weeksInRange(start: string, end: string): string[] {
  const weeks: string[] = [];
  let cur = getMondayOf(start);
  const endMon = getMondayOf(end);
  while (cur <= endMon && weeks.length < 104) {
    weeks.push(cur);
    cur = addWeeks(cur, 1);
  }
  return weeks;
}

function monthsInRange(
  start: string,
  end: string
): Array<{ key: string; label: string; weeks: string[] }> {
  const allWeeks = weeksInRange(start, end);
  const byMonth = new Map<string, string[]>();
  for (const w of allWeeks) {
    const d = new Date(w + "T00:00:00");
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(w);
  }
  return Array.from(byMonth.entries()).map(([key, weeks]) => ({
    key,
    weeks,
    label: new Date(weeks[0] + "T00:00:00").toLocaleDateString("en-GB", {
      month: "short",
      year: "2-digit",
    }),
  }));
}

function fmtShort(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
}

function isoWeekNum(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime()) / 86400000
  );
}

function utilColour(pct: number): string {
  if (pct > 100) return "#ef4444";
  if (pct >= 80) return "#f59e0b";
  if (pct > 0) return "#10b981";
  return "#e2e8f0";
}

const MILESTONE_ICONS: Record<string, string> = {
  kickoff: "🚀",
  delivery: "🏁",
  review: "🔎",
  other: "📍",
};

/* =============================================================================
   TOOLTIP
============================================================================= */

function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        position: "fixed",
        left: x + 12,
        top: y - 8,
        background: "rgba(15,23,42,0.95)",
        color: "#f1f5f9",
        padding: "8px 12px",
        borderRadius: "8px",
        fontSize: "12px",
        fontWeight: 500,
        lineHeight: 1.5,
        pointerEvents: "none",
        zIndex: 9999,
        boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
        maxWidth: "240px",
        backdropFilter: "blur(8px)",
      }}
    >
      {children}
    </div>
  );
}

/* =============================================================================
   PROJECT DETAIL PANEL (slide-in)
============================================================================= */

function ProjectPanel({
  project,
  onClose,
  organisationId,
  isAdmin,
}: {
  project: TimelineProject;
  onClose: () => void;
  organisationId: string;
  isAdmin: boolean;
}) {
  return (
    <div
      style={{
        position: "fixed",
        right: 0,
        top: 0,
        bottom: 0,
        width: "360px",
        background: "white",
        borderLeft: "1.5px solid #e2e8f0",
        boxShadow: "-16px 0 48px rgba(0,0,0,0.1)",
        zIndex: 500,
        display: "flex",
        flexDirection: "column",
        animation: "slideInRight 0.2s ease",
      }}
    >
      <style>{`@keyframes slideInRight { from{transform:translateX(100%)} to{transform:translateX(0)} }`}</style>

      {/* Header */}
      <div
        style={{
          padding: "18px 20px 14px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex",
          alignItems: "flex-start",
          gap: "10px",
        }}
      >
        <div
          style={{
            width: "4px",
            height: "40px",
            borderRadius: "2px",
            background: project.colour,
            flexShrink: 0,
            marginTop: "2px",
          }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>{project.title}</div>
          {project.projectCode && <div style={{ fontSize: "12px", color: "#94a3b8" }}>{project.projectCode}</div>}
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            background: "none",
            border: "none",
            color: "#94a3b8",
            cursor: "pointer",
            fontSize: "16px",
            padding: "2px",
          }}
          aria-label="Close"
          title="Close"
        >
          ×
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        {/* Status + win prob */}
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              padding: "3px 9px",
              borderRadius: "5px",
              background: project.status === "confirmed" ? "rgba(16,185,129,0.1)" : "rgba(124,58,237,0.1)",
              color: project.status === "confirmed" ? "#059669" : "#7c3aed",
            }}
          >
            {project.status}
          </span>
          {project.status === "pipeline" && (
            <span
              style={{
                fontSize: "11px",
                fontWeight: 700,
                padding: "3px 9px",
                borderRadius: "5px",
                background: "rgba(245,158,11,0.1)",
                color: "#d97706",
              }}
            >
              {project.winProb}% win prob
            </span>
          )}
        </div>

        {/* Dates */}
        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              fontSize: "10px",
              fontWeight: 800,
              color: "#94a3b8",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: "6px",
            }}
          >
            Dates
          </div>
          <div style={{ fontSize: "13px", color: "#334155" }}>
            {project.startDate ? fmtShort(project.startDate) : "TBD"} {"→"}{" "}
            {project.endDate ? fmtShort(project.endDate) : "TBD"}
            {project.startDate && project.endDate && (
              <span style={{ color: "#94a3b8", marginLeft: "8px" }}>
                ({daysBetween(project.startDate, project.endDate)} days)
              </span>
            )}
          </div>
        </div>

        {/* People */}
        {project.people.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 800,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "6px",
              }}
            >
              Allocated people ({project.people.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {project.people.map((per) => {
                const total = per.weeks.reduce((s, w) => s + w.days, 0);
                return (
                  <div
                    key={per.personId}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "7px 10px",
                      borderRadius: "8px",
                      background: "#f8fafc",
                      border: "1px solid #f1f5f9",
                      fontSize: "12px",
                    }}
                  >
                    <span style={{ fontWeight: 600, color: "#334155" }}>{per.fullName}</span>
                    <span style={{ color: "#94a3b8", fontFamily: "monospace" }}>
                      {Math.round(total * 10) / 10}d total
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Milestones */}
        {project.milestones.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 800,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                marginBottom: "6px",
              }}
            >
              Milestones
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {project.milestones.map((ms) => (
                <div
                  key={ms.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                    padding: "6px 10px",
                    borderRadius: "7px",
                    background: "#f8fafc",
                    border: "1px solid #f1f5f9",
                    fontSize: "12px",
                  }}
                >
                  <span>{MILESTONE_ICONS[ms.type] || MILESTONE_ICONS.other}</span>
                  <span style={{ fontWeight: 600, flex: 1 }}>{ms.label}</span>
                  <span style={{ color: "#94a3b8" }}>{fmtShort(ms.date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Link to project */}
        <a
          href={`/projects/${project.projectId}`}
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "10px",
            borderRadius: "8px",
            border: "1.5px solid #e2e8f0",
            color: "#475569",
            fontSize: "13px",
            fontWeight: 600,
            textDecoration: "none",
            marginTop: "8px",
          }}
        >
          Open project {"→"}
        </a>

        {/* Optional admin hint (kept silent if not admin) */}
        {isAdmin && (
          <div style={{ marginTop: "10px", fontSize: "11px", color: "#94a3b8" }}>
            Tip: drag bars to shift dates, drag edges to resize.
          </div>
        )}
      </div>
    </div>
  );
}

/* =============================================================================
   DEPENDENCY ARROW SVG
============================================================================= */

function DependencyArrows({
  projects,
  weekPositions,
  expandedRows,
  cellW,
}: {
  projects: TimelineProject[];
  weekPositions: Map<string, number>;
  expandedRows: Set<string>;
  granularity: Granularity;
  cellW: number;
}) {
  const projRows = new Map<string, number>();
  let row = 0;
  for (const p of projects) {
    projRows.set(p.projectId, row);
    row++;
    if (expandedRows.has(p.projectId)) row += p.people.length;
  }

  const totalH = row * ROW_H;

  const arrows: React.ReactNode[] = [];
  for (const proj of projects) {
    for (const depId of proj.dependencies) {
      const depProj = projects.find((p) => p.projectId === depId);
      if (!depProj || !depProj.endDate || !proj.startDate) continue;

      const fromRow = projRows.get(depId) ?? 0;
      const toRow = projRows.get(proj.projectId) ?? 0;

      const endWeek = getMondayOf(depProj.endDate);
      const startWeek = getMondayOf(proj.startDate);

      const fromX = (weekPositions.get(endWeek) ?? 0) + cellW;
      const toX = weekPositions.get(startWeek) ?? 0;

      const fromY = fromRow * ROW_H + ROW_H / 2;
      const toY = toRow * ROW_H + ROW_H / 2;

      const midX = (fromX + toX) / 2;

      arrows.push(
        <path
          key={`${depId}-${proj.projectId}`}
          d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
          fill="none"
          stroke="#94a3b8"
          strokeWidth="1.5"
          strokeDasharray="5,3"
          markerEnd="url(#arrow)"
          opacity="0.6"
        />
      );
    }
  }

  if (!arrows.length) return null;

  return (
    <svg
      style={{
        position: "absolute",
        left: 0,
        top: HEADER_H,
        width: "100%",
        height: totalH,
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 z" fill="#94a3b8" />
        </marker>
      </defs>
      {arrows}
    </svg>
  );
}

/* =============================================================================
   CAPACITY OVERLAY
============================================================================= */

function CapacityOverlay({ data, weeks, cellW }: { data: CapacityPoint[]; weeks: string[]; cellW: number }) {
  const maxPct = Math.max(...data.map((d) => d.utilPct), 50);

  return (
    <div
      style={{
        height: OVERLAY_H,
        display: "flex",
        alignItems: "flex-end",
        borderTop: "2px solid #f1f5f9",
        background: "#fafafa",
        position: "relative",
      }}
    >
      {/* 100% line */}
      <div
        style={{
          position: "absolute",
          bottom: (100 / Math.max(maxPct, 100)) * (OVERLAY_H - 16) + 8,
          left: 0,
          right: 0,
          borderTop: "1px dashed rgba(239, 68, 68, 0.25)",
          pointerEvents: "none",
        }}
      />

      {weeks.map((w) => {
        const point = data.find((d) => d.weekStart === w);
        const pct = point?.utilPct ?? 0;
        const barH = pct > 0 ? Math.max(3, (pct / Math.max(maxPct, 100)) * (OVERLAY_H - 16)) : 2;
        const colour = utilColour(pct);

        return (
          <div
            key={w}
            style={{
              width: cellW,
              minWidth: cellW,
              height: "100%",
              display: "flex",
              alignItems: "flex-end",
              padding: "0 2px 4px",
              borderRight: "1px solid #f1f5f9",
            }}
            title={
              pct > 0
                ? `W${isoWeekNum(w)}: ${pct}% utilised • ${point?.totalAlloc ?? 0}d / ${point?.totalCap ?? 0}d`
                : ""
            }
          >
            <div
              style={{
                width: "100%",
                height: barH,
                background: `${colour}50`,
                border: `1px solid ${colour}30`,
                borderRadius: "2px 2px 0 0",
                transition: "height 0.3s",
              }}
            />
          </div>
        );
      })}
    </div>
  );
}

/* =============================================================================
   MAIN GANTT CLIENT
============================================================================= */

export default function GanttClient({
  bundle,
  organisationId,
  isAdmin,
}: {
  bundle: TimelineBundle;
  organisationId: string;
  isAdmin: boolean;
}) {
  const { projects, capacityOverlay, dateRange, today } = bundle;

  // State
  const [granularity, setGranularity] = useState<Granularity>("week");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedProj, setSelectedProj] = useState<TimelineProject | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "confirmed" | "pipeline">("all");
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: React.ReactNode } | null>(null);

  // Drag state
  const dragState = useRef<{
    type: "shift" | "resize-start" | "resize-end";
    projectId: string;
    orgId: string;
    startX: number;
    origStart: string | null;
    origEnd: string | null;
    cellW: number;
  } | null>(null);

  const [dragOffset, setDragOffset] = useState(0);
  const [dragging, setDragging] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const gridRef = useRef<HTMLDivElement>(null);

  // Derived
  const cellW = granularity === "week" ? CELL_W_WK : CELL_W_MO;

  const allWeeks = useMemo(() => weeksInRange(dateRange.from, dateRange.to), [dateRange]);
  const months = useMemo(() => monthsInRange(dateRange.from, dateRange.to), [dateRange]);

  // Map each week to its x-offset (px)
  const weekPositions = useMemo(() => {
    const map = new Map<string, number>();

    if (granularity === "week") {
      allWeeks.forEach((w, i) => map.set(w, i * CELL_W_WK));
      return map;
    }

    // month view: distribute weeks across the month bucket without indexOf O(n^2)
    let x = 0;
    for (const mo of months) {
      const denom = Math.max(mo.weeks.length, 1);
      mo.weeks.forEach((w, idx) => {
        map.set(w, x + (idx / denom) * CELL_W_MO);
      });
      x += CELL_W_MO;
    }
    return map;
  }, [granularity, allWeeks, months]);

  const totalGridW = granularity === "week" ? allWeeks.length * CELL_W_WK : months.length * CELL_W_MO;

  const todayX = useMemo(() => {
    const todayMon = getMondayOf(today);
    return weekPositions.get(todayMon) ?? -1;
  }, [weekPositions, today]);

  const visibleProjects = useMemo(
    () => projects.filter((p) => filterStatus === "all" || p.status === filterStatus),
    [projects, filterStatus]
  );

  // Bar geometry
  function barGeometry(proj: TimelineProject, dxPx = 0) {
    if (!proj.startDate || !proj.endDate) return null;
    const startMon = getMondayOf(proj.startDate);
    const endMon = getMondayOf(proj.endDate);
    const x1 = weekPositions.get(startMon) ?? 0;
    const x2 = (weekPositions.get(endMon) ?? x1) + cellW;
    return { x: x1 + dxPx, w: Math.max(x2 - x1, cellW) };
  }

  function milestoneX(date: string): number {
    const mon = getMondayOf(date);
    return (weekPositions.get(mon) ?? 0) + cellW / 2;
  }

  // Drag handlers
  const onMouseDownBar = useCallback(
    (e: React.MouseEvent, proj: TimelineProject, type: "shift" | "resize-start" | "resize-end") => {
      if (!isAdmin) return;
      e.stopPropagation();
      dragState.current = {
        type,
        projectId: proj.projectId,
        orgId: organisationId,
        startX: e.clientX,
        origStart: proj.startDate,
        origEnd: proj.endDate,
        cellW,
      };
      setDragging(proj.projectId);
      setDragOffset(0);
    },
    [isAdmin, organisationId, cellW]
  );

  useEffect(() => {
    function onMouseMove(e: MouseEvent) {
      if (!dragState.current) return;
      setDragOffset(e.clientX - dragState.current.startX);
    }

    async function onMouseUp(e: MouseEvent) {
      if (!dragState.current) return;
      const { type, projectId, orgId, startX, origStart, origEnd, cellW: cw } = dragState.current;
      const dx = e.clientX - startX;
      const dDays = Math.round((dx / cw) * 7);

      dragState.current = null;
      setDragging(null);
      setDragOffset(0);

      if (Math.abs(dDays) < 1) return;
      if (!isAdmin) return;

      setIsPending(true);
      try {
        const fd = new FormData();
        fd.set("project_id", projectId);
        fd.set("organisation_id", orgId);

        if (type === "shift") {
          fd.set("shift_days", String(dDays));
          await shiftProjectDates(fd);
        } else {
          const edge = type === "resize-start" ? "start" : "end";
          const base = edge === "start" ? origStart : origEnd;
          if (!base) return;
          const newDate = addDays(base, dDays);
          fd.set("edge", edge);
          fd.set("new_date", newDate);
          await resizeProjectDates(fd);
        }
      } catch (err: any) {
        console.error(err);
      } finally {
        setIsPending(false);
      }
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isAdmin]);

  // Render
  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&family=DM+Mono:wght@400;500&display=swap');
        .gantt-row:hover { background: rgba(0,184,219,0.03) !important; }
        .proj-bar { transition: filter 0.15s; }
        .proj-bar:hover { filter: brightness(1.08); }
        @keyframes ganttIn { from{opacity:0} to{opacity:1} }
      `}</style>

      <div
        style={{
          fontFamily: "'DM Sans', sans-serif",
          minHeight: "100vh",
          background: "#f8fafc",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            padding: "16px 24px 12px",
            borderBottom: "1px solid #e2e8f0",
            background: "white",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            flexWrap: "wrap",
            position: "sticky",
            top: 0,
            zIndex: 200,
          }}
        >
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 800, color: "#0f172a", margin: "0 0 2px" }}>Timeline</h1>
            <p style={{ fontSize: "11px", color: "#94a3b8", margin: 0 }}>
              {visibleProjects.length} project{visibleProjects.length !== 1 ? "s" : ""}
              {isAdmin ? " • Drag bars to reschedule" : ""}
            </p>
          </div>

          {/* Granularity toggle */}
          <div
            style={{
              display: "flex",
              background: "#f1f5f9",
              borderRadius: "8px",
              padding: "2px",
              marginLeft: "auto",
            }}
          >
            {(["week", "month"] as Granularity[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                style={{
                  padding: "5px 14px",
                  borderRadius: "6px",
                  border: "none",
                  background: granularity === g ? "white" : "transparent",
                  color: granularity === g ? "#0f172a" : "#64748b",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                  boxShadow: granularity === g ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
                  transition: "all 0.15s",
                  textTransform: "capitalize",
                }}
              >
                {g}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div style={{ display: "flex", gap: "4px" }}>
            {(["all", "confirmed", "pipeline"] as const).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setFilterStatus(s)}
                style={{
                  padding: "5px 12px",
                  borderRadius: "6px",
                  border: "1.5px solid",
                  borderColor: filterStatus === s ? "#00b8db" : "#e2e8f0",
                  background: filterStatus === s ? "rgba(0,184,219,0.08)" : "white",
                  color: filterStatus === s ? "#0e7490" : "#64748b",
                  fontSize: "12px",
                  fontWeight: 600,
                  cursor: "pointer",
                }}
              >
                {s === "all" ? "All" : s === "confirmed" ? "✓ Confirmed" : "○ Pipeline"}
              </button>
            ))}
          </div>

          {/* Expand / collapse all */}
          <button
            type="button"
            onClick={() => {
              if (expandedRows.size > 0) setExpandedRows(new Set());
              else setExpandedRows(new Set(visibleProjects.filter((p) => p.people.length > 0).map((p) => p.projectId)));
            }}
            style={{
              padding: "5px 12px",
              borderRadius: "6px",
              border: "1.5px solid #e2e8f0",
              background: "white",
              color: "#64748b",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {expandedRows.size > 0 ? "Collapse all" : "Expand all"}
          </button>

          {isPending && <div style={{ fontSize: "12px", color: "#00b8db", fontWeight: 600 }}>Saving…</div>}
        </div>

        {/* Main area */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
          {/* Label column */}
          <div
            style={{
              width: LABEL_W,
              minWidth: LABEL_W,
              flexShrink: 0,
              background: "white",
              borderRight: "1.5px solid #e2e8f0",
              display: "flex",
              flexDirection: "column",
              position: "sticky",
              left: 0,
              zIndex: 100,
            }}
          >
            {/* Header spacer */}
            <div
              style={{
                height: HEADER_H,
                borderBottom: "2px solid #e2e8f0",
                padding: "0 16px",
                display: "flex",
                alignItems: "center",
                fontSize: "11px",
                fontWeight: 800,
                color: "#94a3b8",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Project
            </div>

            {/* Labels */}
            <div style={{ overflowY: "hidden", flex: 1 }}>
              {visibleProjects.map((proj) => (
                <div key={proj.projectId}>
                  {/* Project label row */}
                  <div
                    className="gantt-row"
                    style={{
                      height: ROW_H,
                      display: "flex",
                      alignItems: "center",
                      padding: "0 8px 0 12px",
                      gap: "6px",
                      borderBottom: "1px solid #f1f5f9",
                      cursor: "pointer",
                      background: "white",
                    }}
                    onClick={() => setSelectedProj(proj)}
                  >
                    {/* Expand toggle */}
                    {proj.people.length > 0 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setExpandedRows((prev) => {
                            const next = new Set(prev);
                            next.has(proj.projectId) ? next.delete(proj.projectId) : next.add(proj.projectId);
                            return next;
                          });
                        }}
                        style={{
                          width: 16,
                          height: 16,
                          borderRadius: "4px",
                          border: "1.5px solid #e2e8f0",
                          background: "white",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          cursor: "pointer",
                          fontSize: "10px",
                          color: "#64748b",
                          flexShrink: 0,
                          padding: 0,
                          lineHeight: 1,
                        }}
                        aria-label={expandedRows.has(proj.projectId) ? "Collapse" : "Expand"}
                        title={expandedRows.has(proj.projectId) ? "Collapse" : "Expand"}
                      >
                        {expandedRows.has(proj.projectId) ? "▾" : "▸"}
                      </button>
                    )}

                    {/* Colour dot */}
                    <div
                      style={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        background: proj.colour,
                        flexShrink: 0,
                      }}
                    />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "12px",
                          fontWeight: 700,
                          color: "#0f172a",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {proj.title}
                      </div>
                      {proj.projectCode && <div style={{ fontSize: "10px", color: "#94a3b8" }}>{proj.projectCode}</div>}
                    </div>

                    {proj.status === "pipeline" && (
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 700,
                          color: "#7c3aed",
                          background: "rgba(124,58,237,0.1)",
                          padding: "1px 4px",
                          borderRadius: "3px",
                          flexShrink: 0,
                        }}
                      >
                        {proj.winProb}%
                      </span>
                    )}
                  </div>

                  {/* Swimlane labels */}
                  {expandedRows.has(proj.projectId) &&
                    proj.people.map((per) => (
                      <div
                        key={per.personId}
                        style={{
                          height: SWIM_H,
                          display: "flex",
                          alignItems: "center",
                          padding: "0 10px 0 32px",
                          borderBottom: "1px solid #f8fafc",
                          fontSize: "11px",
                          color: "#64748b",
                          fontWeight: 500,
                          background: "#fafafa",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {per.fullName.split(" ")[0]}
                      </div>
                    ))}
                </div>
              ))}

              {/* Capacity overlay label */}
              <div
                style={{
                  height: OVERLAY_H,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  borderTop: "2px solid #f1f5f9",
                  fontSize: "10px",
                  fontWeight: 800,
                  color: "#94a3b8",
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  background: "#fafafa",
                }}
              >
                Team utilisation
              </div>
            </div>
          </div>

          {/* Scrollable grid */}
          <div
            ref={gridRef}
            style={{
              flex: 1,
              overflowX: "auto",
              overflowY: "auto",
              position: "relative",
            }}
          >
            <div style={{ minWidth: totalGridW, position: "relative" }}>
              {/* Column headers */}
              <div
                style={{
                  height: HEADER_H,
                  display: "flex",
                  borderBottom: "2px solid #e2e8f0",
                  background: "white",
                  position: "sticky",
                  top: 0,
                  zIndex: 50,
                }}
              >
                {granularity === "week"
                  ? allWeeks.map((w) => {
                      const isToday = w === getMondayOf(today);
                      return (
                        <div
                          key={w}
                          style={{
                            width: CELL_W_WK,
                            minWidth: CELL_W_WK,
                            borderRight: "1px solid #f1f5f9",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            justifyContent: "center",
                            background: isToday ? "rgba(0,184,219,0.05)" : "transparent",
                          }}
                        >
                          <div
                            style={{
                              fontSize: "9px",
                              fontWeight: 700,
                              color: isToday ? "#00b8db" : "#94a3b8",
                              textTransform: "uppercase",
                            }}
                          >
                            W{isoWeekNum(w)}
                          </div>
                          <div style={{ fontSize: "9px", color: "#94a3b8" }}>
                            {new Date(w + "T00:00:00").toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                            })}
                          </div>
                        </div>
                      );
                    })
                  : months.map((mo) => (
                      <div
                        key={mo.key}
                        style={{
                          width: CELL_W_MO,
                          minWidth: CELL_W_MO,
                          borderRight: "1px solid #e2e8f0",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <div
                          style={{
                            fontSize: "11px",
                            fontWeight: 700,
                            color: "#475569",
                            textTransform: "uppercase",
                            letterSpacing: "0.04em",
                          }}
                        >
                          {mo.label}
                        </div>
                      </div>
                    ))}
              </div>

              {/* Today line */}
              {todayX >= 0 && (
                <div
                  style={{
                    position: "absolute",
                    left: todayX + cellW / 2,
                    top: HEADER_H,
                    bottom: 0,
                    width: "2px",
                    background: "rgba(0,184,219,0.4)",
                    pointerEvents: "none",
                    zIndex: 30,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "#00b8db",
                      color: "white",
                      fontSize: "9px",
                      fontWeight: 800,
                      padding: "2px 5px",
                      borderRadius: "3px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    Today
                  </div>
                </div>
              )}

              {/* Dependency arrows */}
              <DependencyArrows
                projects={visibleProjects}
                weekPositions={weekPositions}
                expandedRows={expandedRows}
                granularity={granularity}
                cellW={cellW}
              />

              {/* Project rows */}
              {visibleProjects.map((proj) => {
                const geo = barGeometry(proj, dragging === proj.projectId ? dragOffset : 0);
                const isDragging = dragging === proj.projectId;

                const gridWeeks =
                  granularity === "week"
                    ? allWeeks
                    : months.reduce<string[]>((acc, m) => {
                        acc.push(...m.weeks);
                        return acc;
                      }, []);

                return (
                  <div key={proj.projectId}>
                    {/* Project bar row */}
                    <div
                      className="gantt-row"
                      style={{
                        height: ROW_H,
                        position: "relative",
                        borderBottom: "1px solid #f1f5f9",
                        display: "flex",
                      }}
                    >
                      {/* Grid columns bg */}
                      {gridWeeks.map((w) => (
                        <div
                          key={w}
                          style={{
                            width: cellW,
                            minWidth: cellW,
                            height: "100%",
                            borderRight: "1px solid #f8fafc",
                            background: w === getMondayOf(today) ? "rgba(0,184,219,0.04)" : "transparent",
                          }}
                        />
                      ))}

                      {/* Project bar */}
                      {geo && (
                        <div
                          className="proj-bar"
                          style={{
                            position: "absolute",
                            left: geo.x,
                            width: geo.w,
                            top: "50%",
                            transform: "translateY(-50%)",
                            height: 28,
                            borderRadius: "7px",
                            background:
                              proj.status === "pipeline"
                                ? `repeating-linear-gradient(45deg, ${proj.colour}cc, ${proj.colour}cc 6px, ${proj.colour}88 6px, ${proj.colour}88 12px)`
                                : proj.colour,
                            boxShadow: isDragging ? `0 8px 24px ${proj.colour}60` : `0 2px 8px ${proj.colour}30`,
                            display: "flex",
                            alignItems: "center",
                            cursor: isAdmin ? (isDragging ? "grabbing" : "grab") : "pointer",
                            userSelect: "none",
                            zIndex: isDragging ? 40 : 20,
                            opacity: isDragging ? 0.85 : 1,
                            transition: isDragging ? "none" : "box-shadow 0.2s",
                          }}
                          onMouseDown={(e) => onMouseDownBar(e, proj, "shift")}
                          onClick={() => !isDragging && setSelectedProj(proj)}
                        >
                          {/* Resize handle start */}
                          {isAdmin && (
                            <div
                              style={{
                                position: "absolute",
                                left: 0,
                                top: 0,
                                bottom: 0,
                                width: "8px",
                                cursor: "ew-resize",
                                borderRadius: "7px 0 0 7px",
                                background: "rgba(0,0,0,0.15)",
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                onMouseDownBar(e, proj, "resize-start");
                              }}
                              aria-label="Resize start"
                              title="Resize start"
                            />
                          )}

                          {/* Label */}
                          <div
                            style={{
                              padding: "0 10px",
                              fontSize: "11px",
                              fontWeight: 700,
                              color: "white",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                              flex: 1,
                              textShadow: "0 1px 2px rgba(0,0,0,0.2)",
                            }}
                          >
                            {proj.title}
                          </div>

                          {/* Resize handle end */}
                          {isAdmin && (
                            <div
                              style={{
                                position: "absolute",
                                right: 0,
                                top: 0,
                                bottom: 0,
                                width: "8px",
                                cursor: "ew-resize",
                                borderRadius: "0 7px 7px 0",
                                background: "rgba(0,0,0,0.15)",
                              }}
                              onMouseDown={(e) => {
                                e.stopPropagation();
                                onMouseDownBar(e, proj, "resize-end");
                              }}
                              aria-label="Resize end"
                              title="Resize end"
                            />
                          )}
                        </div>
                      )}

                      {/* Milestones */}
                      {proj.milestones.map((ms) => {
                        const x = milestoneX(ms.date);
                        const icon = MILESTONE_ICONS[ms.type] || MILESTONE_ICONS.other;
                        return (
                          <div
                            key={ms.id}
                            style={{
                              position: "absolute",
                              left: x - 8,
                              top: "50%",
                              transform: "translateY(-50%) rotate(45deg)",
                              width: 14,
                              height: 14,
                              background: "white",
                              border: `2px solid ${proj.colour}`,
                              zIndex: 25,
                              cursor: "default",
                            }}
                            title={`${icon} ${ms.label} • ${fmtShort(ms.date)}`}
                            onMouseEnter={(e) =>
                              setTooltip({
                                x: e.clientX,
                                y: e.clientY,
                                content: (
                                  <>
                                    {icon} <strong>{ms.label}</strong>
                                    <br />
                                    {fmtShort(ms.date)}
                                  </>
                                ),
                              })
                            }
                            onMouseLeave={() => setTooltip(null)}
                          />
                        );
                      })}
                    </div>

                    {/* Swimlanes */}
                    {expandedRows.has(proj.projectId) &&
                      proj.people.map((per) => (
                        <div
                          key={per.personId}
                          style={{
                            height: SWIM_H,
                            position: "relative",
                            borderBottom: "1px solid #f8fafc",
                            background: "#fafafa",
                            display: "flex",
                          }}
                        >
                          {per.weeks.map((wk) => {
                            const x = weekPositions.get(wk.weekStart) ?? 0;
                            return (
                              <div
                                key={wk.weekStart}
                                style={{
                                  position: "absolute",
                                  left: x + 2,
                                  width: cellW - 4,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  height: SWIM_H - 8,
                                  borderRadius: "4px",
                                  background: `${proj.colour}30`,
                                  border: `1px solid ${proj.colour}50`,
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontSize: "9px",
                                  fontWeight: 700,
                                  color: proj.colour,
                                  fontFamily: "monospace",
                                }}
                                title={`${per.fullName} • ${wk.days}d`}
                              >
                                {wk.days}d
                              </div>
                            );
                          })}
                        </div>
                      ))}
                  </div>
                );
              })}

              {/* Capacity overlay */}
              <CapacityOverlay data={capacityOverlay} weeks={allWeeks} cellW={cellW} />
            </div>
          </div>
        </div>

        {/* Tooltip */}
        {tooltip && <Tooltip x={tooltip.x} y={tooltip.y}>{tooltip.content}</Tooltip>}

        {/* Project panel */}
        {selectedProj && (
          <>
            <div
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 499,
                background: "rgba(0,0,0,0.2)",
              }}
              onClick={() => setSelectedProj(null)}
            />
            <ProjectPanel
              project={selectedProj}
              onClose={() => setSelectedProj(null)}
              organisationId={organisationId}
              isAdmin={isAdmin}
            />
          </>
        )}
      </div>
    </>
  );
}