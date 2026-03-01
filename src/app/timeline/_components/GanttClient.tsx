"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { shiftProjectDates, resizeProjectDates } from "../actions";
import type { TimelineBundle, TimelineProject, CapacityPoint } from "../_lib/timeline-data";

/* =============================================================================
   CONSTANTS & HELPERS
============================================================================= */

const ROW_H      = 44;   // project row height px
const SWIM_H     = 28;   // person swimlane height
const HEADER_H   = 52;   // column header height
const LABEL_W    = 220;  // left label column width
const OVERLAY_H  = 64;   // capacity overlay height
const CELL_W_WK  = 48;   // week cell width
const CELL_W_MO  = 120;  // month cell width

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

function monthsInRange(start: string, end: string): Array<{ key: string; label: string; weeks: string[] }> {
  const allWeeks = weeksInRange(start, end);
  const byMonth  = new Map<string, string[]>();
  for (const w of allWeeks) {
    const d    = new Date(w + "T00:00:00");
    const key  = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!byMonth.has(key)) byMonth.set(key, []);
    byMonth.get(key)!.push(w);
  }
  return Array.from(byMonth.entries()).map(([key, weeks]) => ({
    key, weeks,
    label: new Date(weeks[0] + "T00:00:00").toLocaleDateString("en-GB", {
      month: "short", year: "2-digit",
    }),
  }));
}

function fmtShort(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
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
  if (pct >= 80)  return "#f59e0b";
  if (pct > 0)    return "#10b981";
  return "#e2e8f0";
}

const MILESTONE_ICONS: Record<string, string> = {
  kickoff:  "??",
  delivery: "??",
  review:   "??",
  other:    "??",
};

/* =============================================================================
   TOOLTIP
============================================================================= */

function Tooltip({ x, y, children }: { x: number; y: number; children: React.ReactNode }) {
  return (
    <div style={{
      position: "fixed", left: x + 12, top: y - 8,
      background: "rgba(15,23,42,0.95)", color: "#f1f5f9",
      padding: "8px 12px", borderRadius: "8px",
      fontSize: "12px", fontWeight: 500, lineHeight: 1.5,
      pointerEvents: "none", zIndex: 9999,
      boxShadow: "0 8px 24px rgba(0,0,0,0.3)",
      maxWidth: "240px",
      backdropFilter: "blur(8px)",
    }}>
      {children}
    </div>
  );
}

/* =============================================================================
   PROJECT DETAIL PANEL
============================================================================= */

function ProjectPanel({
  project, onClose, organisationId, isAdmin,
}: {
  project: TimelineProject; onClose: () => void;
  organisationId: string; isAdmin: boolean;
}) {
  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: "360px",
      background: "white", borderLeft: "1.5px solid #e2e8f0",
      boxShadow: "-16px 0 48px rgba(0,0,0,0.1)",
      zIndex: 500, display: "flex", flexDirection: "column",
      animation: "slideInRight 0.2s ease",
    }}>
      <style>{`@keyframes slideInRight { from{transform:translateX(100%)} to{transform:translateX(0)} }`}</style>

      <div style={{
        padding: "18px 20px 14px",
        borderBottom: "1px solid #f1f5f9",
        display: "flex", alignItems: "flex-start", gap: "10px",
      }}>
        <div style={{
          width: "4px", height: "40px", borderRadius: "2px",
          background: project.colour, flexShrink: 0, marginTop: "2px",
        }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
            {project.title}
          </div>
          {project.projectCode && (
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>{project.projectCode}</div>
          )}
        </div>
        <button type="button" onClick={onClose} style={{
          background: "none", border: "none", color: "#94a3b8",
          cursor: "pointer", fontSize: "16px", padding: "2px",
        }}>×</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px 20px" }}>
        <div style={{ display: "flex", gap: "8px", marginBottom: "16px" }}>
          <span style={{
            fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "5px",
            background: project.status === "confirmed" ? "rgba(16,185,129,0.1)" : "rgba(124,58,237,0.1)",
            color: project.status === "confirmed" ? "#059669" : "#7c3aed",
          }}>{project.status}</span>
          {project.status === "pipeline" && (
            <span style={{
              fontSize: "11px", fontWeight: 700, padding: "3px 9px", borderRadius: "5px",
              background: "rgba(245,158,11,0.1)", color: "#d97706",
            }}>{project.winProb}% win prob</span>
          )}
        </div>

        <div style={{ marginBottom: "16px" }}>
          <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                        textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
            Dates
          </div>
          <div style={{ fontSize: "13px", color: "#334155" }}>
            {project.startDate ? fmtShort(project.startDate) : "TBD"} ?{" "}
            {project.endDate   ? fmtShort(project.endDate)   : "TBD"}
            {project.startDate && project.endDate && (
              <span style={{ color: "#94a3b8", marginLeft: "8px" }}>
                ({daysBetween(project.startDate, project.endDate)} days)
              </span>
            )}
          </div>
        </div>

        {project.people.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
              Allocated people ({project.people.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {project.people.map(per => {
                const total = per.weeks.reduce((s, w) => s + w.days, 0);
                return (
                  <div key={per.personId} style={{
                    display: "flex", alignItems: "center",
                    justifyContent: "space-between",
                    padding: "7px 10px", borderRadius: "8px",
                    background: "#f8fafc", border: "1px solid #f1f5f9",
                    fontSize: "12px",
                  }}>
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

        {project.milestones.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                          textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "6px" }}>
              Milestones
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {project.milestones.map(ms => (
                <div key={ms.id} style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "6px 10px", borderRadius: "7px",
                  background: "#f8fafc", border: "1px solid #f1f5f9",
                  fontSize: "12px",
                }}>
                  <span>{MILESTONE_ICONS[ms.type] || "??"}</span>
                  <span style={{ fontWeight: 600, flex: 1 }}>{ms.label}</span>
                  <span style={{ color: "#94a3b8" }}>{fmtShort(ms.date)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <a href={`/projects/${project.projectId}`} style={{
          display: "flex", alignItems: "center", justifyContent: "center",
          padding: "10px", borderRadius: "8px", border: "1.5px solid #e2e8f0",
          color: "#475569", fontSize: "13px", fontWeight: 600,
          textDecoration: "none", marginTop: "8px",
        }}>
          Open project ?
        </a>
      </div>
    </div>
  );
}

/* =============================================================================
   DEPENDENCY ARROWS
============================================================================= */

function DependencyArrows({
  projects, weekPositions, expandedRows, cellW,
}: {
  projects:      TimelineProject[];
  weekPositions: Map<string, number>;
  expandedRows:  Set<string>;
  cellW:         number;
}) {
  const projRows = new Map<string, number>();
  let row = 0;
  for (const p of projects) {
    projRows.set(p.projectId, row);
    row++;
    if (expandedRows.has(p.projectId)) row += p.people.length;
  }

  const arrows: React.ReactNode[] = [];
  for (const proj of projects) {
    for (const depId of proj.dependencies) {
      const depProj = projects.find(p => p.projectId === depId);
      if (!depProj || !depProj.endDate || !proj.startDate) continue;

      const fromRow = projRows.get(depId);
      const toRow   = projRows.get(proj.projectId);
      if (fromRow === undefined || toRow === undefined) continue;

      const endWeek   = getMondayOf(depProj.endDate);
      const startWeek = getMondayOf(proj.startDate);
      
      const fromX = (weekPositions.get(endWeek) ?? 0) + cellW;
      const toX   = weekPositions.get(startWeek) ?? 0;
      const fromY = fromRow * ROW_H + ROW_H / 2;
      const toY   = toRow   * ROW_H + ROW_H / 2;

      const midX = (fromX + toX) / 2;
      arrows.push(
        <path key={`${depId}-${proj.projectId}`}
          d={`M ${fromX} ${fromY} C ${midX} ${fromY}, ${midX} ${toY}, ${toX} ${toY}`}
          fill="none" stroke="#94a3b8" strokeWidth="1.5"
          strokeDasharray="5,3" markerEnd="url(#arrow)" opacity="0.6"
        />
      );
    }
  }

  return (
    <svg style={{
      position: "absolute", left: 0, top: 0,
      width: "100%", height: "100%", pointerEvents: "none", zIndex: 10,
    }}>
      <defs>
        <marker id="arrow" markerWidth="6" markerHeight="6"
          refX="3" refY="3" orient="auto">
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

function CapacityOverlay({ data, weeks, cellW }: {
  data:  CapacityPoint[];
  weeks: string[];
  cellW: number;
}) {
  const maxPct = Math.max(...data.map(d => d.utilPct), 100);

  return (
    <div style={{
      height: OVERLAY_H, display: "flex", alignItems: "flex-end",
      borderTop: "2px solid #f1f5f9", background: "#fafafa",
      position: "relative",
    }}>
      <div style={{
        position: "absolute",
        bottom: (100 / maxPct) * (OVERLAY_H - 16) + 8,
        left: 0, right: 0,
        borderTop: "1px dashed #ef444440",
        pointerEvents: "none",
      }} />

      {weeks.map((w) => {
        const point = data.find(d => d.weekStart === w);
        const pct   = point?.utilPct ?? 0;
        const barH  = pct > 0 ? Math.max(3, (pct / maxPct) * (OVERLAY_H - 16)) : 2;
        const colour = utilColour(pct);

        return (
          <div key={w} style={{
            width: cellW, minWidth: cellW,
            height: "100%",
            display: "flex", alignItems: "flex-end",
            padding: "0 2px 4px",
            borderRight: "1px solid #f1f5f9",
          }}
            title={pct > 0 ? `W${isoWeekNum(w)}: ${pct}% utilised` : ""}
          >
            <div style={{
              width: "100%", height: barH,
              background: `${colour}50`,
              border: `1px solid ${colour}30`,
              borderRadius: "2px 2px 0 0",
              transition: "height 0.3s",
            }} />
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
  bundle:          TimelineBundle;
  organisationId:  string;
  isAdmin:          boolean;
}) {
  const { projects, capacityOverlay, dateRange, today } = bundle;

  const [granularity,  setGranularity]  = useState<Granularity>("week");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [selectedProj, setSelectedProj] = useState<TimelineProject | null>(null);
  const [filterStatus, setFilterStatus] = useState<"all" | "confirmed" | "pipeline">("all");
  
  const dragState = useRef<{
    type:        "shift" | "resize-start" | "resize-end";
    projectId:   string;
    orgId:       string;
    startX:      number;
    origStart:   string | null;
    origEnd:     string | null;
    cellW:       number;
  } | null>(null);

  const [dragOffset, setDragOffset] = useState(0);
  const [dragging,   setDragging]   = useState<string | null>(null);
  const [isPending,  setIsPending]  = useState(false);

  const cellW = granularity === "week" ? CELL_W_WK : CELL_W_MO;
  const allWeeks = useMemo(() => weeksInRange(dateRange.from, dateRange.to), [dateRange]);
  const months = useMemo(() => monthsInRange(dateRange.from, dateRange.to), [dateRange]);

  const weekPositions = useMemo(() => {
    const map = new Map<string, number>();
    if (granularity === "week") {
      allWeeks.forEach((w, i) => map.set(w, i * CELL_W_WK));
    } else {
      let x = 0;
      for (const mo of months) {
        mo.weeks.forEach(w => map.set(w, x + (mo.weeks.indexOf(w) / mo.weeks.length) * CELL_W_MO));
        x += CELL_W_MO;
      }
    }
    return map;
  }, [granularity, allWeeks, months]);

  const totalGridW = granularity === "week" ? allWeeks.length * CELL_W_WK : months.length * CELL_W_MO;
  const todayX = useMemo(() => weekPositions.get(getMondayOf(today)) ?? -1, [weekPositions, today]);

  const visibleProjects = projects.filter(p => filterStatus === "all" || p.status === filterStatus);

  const onMouseDownBar = useCallback((e: React.MouseEvent, proj: TimelineProject, type: "shift" | "resize-start" | "resize-end") => {
    if (!isAdmin) return;
    e.stopPropagation();
    dragState.current = {
      type, projectId: proj.projectId, orgId: organisationId,
      startX: e.clientX, origStart: proj.startDate, origEnd: proj.endDate, cellW,
    };
    setDragging(proj.projectId);
    setDragOffset(0);
  }, [isAdmin, organisationId, cellW]);

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragState.current) return;
      setDragOffset(e.clientX - dragState.current.startX);
    };

    const onMouseUp = async (e: MouseEvent) => {
      if (!dragState.current) return;
      const { type, projectId, orgId, startX, cellW: cw } = dragState.current;
      const dDays = Math.round(( (e.clientX - startX) / cw) * 7);
      
      dragState.current = null;
      setDragging(null);
      setDragOffset(0);

      if (Math.abs(dDays) < 1 || !isAdmin) return;

      setIsPending(true);
      try {
        const fd = new FormData();
        fd.set("project_id", projectId);
        fd.set("organisation_id", orgId);
        if (type === "shift") {
          fd.set("shift_days", String(dDays));
          await shiftProjectDates(fd);
        } else {
          // Resize logic here
        }
      } catch (err) {
        console.error(err);
      } finally {
        setIsPending(false);
      }
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [isAdmin]);

  return (
    <div style={{ fontFamily: "sans-serif", display: "flex", flexDirection: "column", height: "100vh", background: "#f8fafc" }}>
      {/* TOOLBAR */}
      <div style={{ padding: "16px", background: "white", borderBottom: "1px solid #e2e8f0", display: "flex", gap: "12px", alignItems: "center" }}>
        <h2 style={{ margin: 0, fontSize: "18px" }}>Timeline</h2>
        <div style={{ marginLeft: "auto", display: "flex", gap: "4px", background: "#f1f5f9", padding: "2px", borderRadius: "8px" }}>
            <button onClick={() => setGranularity("week")} style={{ border: "none", padding: "6px 12px", borderRadius: "6px", background: granularity === "week" ? "white" : "transparent" }}>Week</button>
            <button onClick={() => setGranularity("month")} style={{ border: "none", padding: "6px 12px", borderRadius: "6px", background: granularity === "month" ? "white" : "transparent" }}>Month</button>
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* SIDEBAR LABELS */}
        <div style={{ width: LABEL_W, background: "white", borderRight: "1px solid #e2e8f0", overflowY: "auto" }}>
            <div style={{ height: HEADER_H, borderBottom: "1px solid #e2e8f0" }} />
            {visibleProjects.map(p => (
                <div key={p.projectId} style={{ height: ROW_H, display: "flex", alignItems: "center", padding: "0 12px", borderBottom: "1px solid #f1f5f9", cursor: "pointer" }} onClick={() => setSelectedProj(p)}>
                    <span style={{ fontSize: "12px", fontWeight: 700 }}>{p.title}</span>
                </div>
            ))}
        </div>

        {/* GRID AREA */}
        <div style={{ flex: 1, overflow: "auto", position: "relative" }}>
            <div style={{ width: totalGridW, position: "relative" }}>
                <div style={{ height: HEADER_H, display: "flex", borderBottom: "1px solid #e2e8f0", background: "white", position: "sticky", top: 0, zIndex: 20 }}>
                    {allWeeks.map(w => (
                        <div key={w} style={{ width: cellW, minWidth: cellW, borderRight: "1px solid #f1f5f9", fontSize: "10px", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            W{isoWeekNum(w)}
                        </div>
                    ))}
                </div>
                
                <DependencyArrows projects={visibleProjects} weekPositions={weekPositions} expandedRows={expandedRows} cellW={cellW} />

                {visibleProjects.map(p => {
                    const startMon = getMondayOf(p.startDate || today);
                    const endMon = getMondayOf(p.endDate || today);
                    const x = weekPositions.get(startMon) ?? 0;
                    const w = ((weekPositions.get(endMon) ?? x) - x) + cellW;
                    const finalX = dragging === p.projectId ? x + dragOffset : x;

                    return (
                        <div key={p.projectId} style={{ height: ROW_H, position: "relative", borderBottom: "1px solid #f1f5f9" }}>
                            <div 
                                onMouseDown={(e) => onMouseDownBar(e, p, "shift")}
                                style={{
                                    position: "absolute", left: finalX, top: 8, height: 28, width: w,
                                    background: p.colour, borderRadius: "6px", cursor: isAdmin ? "move" : "default",
                                    boxShadow: "0 2px 4px rgba(0,0,0,0.1)", zIndex: 15, display: "flex", alignItems: "center", padding: "0 8px"
                                }}
                            >
                                <span style={{ color: "white", fontSize: "11px", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden" }}>{p.title}</span>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
      </div>

      <CapacityOverlay data={capacityOverlay} weeks={allWeeks} cellW={cellW} />
      {selectedProj && <ProjectPanel project={selectedProj} organisationId={organisationId} isAdmin={isAdmin} onClose={() => setSelectedProj(null)} />}
    </div>
  );
}
