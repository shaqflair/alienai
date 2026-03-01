"use client";
// FILE: src/app/heatmap/_components/HeatmapClient.tsx

import { useState, useCallback, useTransition, useRef, useEffect } from "react";
import type {
  HeatmapData, PersonRow, AllocationCell,
  Granularity, PeriodHeader, PipelineGapRow,
} from "../_lib/heatmap-query";

/* =============================================================================
   CONSTANTS + HELPERS
============================================================================= */

const UTIL_COLOURS = {
  empty:    { bg: "#f8fafc",              text: "#cbd5e1",   border: "#f1f5f9"   },
  low:      { bg: "rgba(16,185,129,0.1)", text: "#059669",   border: "rgba(16,185,129,0.2)" },
  mid:      { bg: "rgba(245,158,11,0.1)", text: "#d97706",   border: "rgba(245,158,11,0.2)" },
  high:     { bg: "rgba(239,68,68,0.1)",  text: "#dc2626",   border: "rgba(239,68,68,0.2)"  },
  critical: { bg: "rgba(124,58,237,0.1)", text: "#7c3aed",   border: "rgba(124,58,237,0.2)" },
};

function utilTier(pct: number): keyof typeof UTIL_COLOURS {
  if (pct === 0)   return "empty";
  if (pct < 75)    return "low";
  if (pct < 95)    return "mid";
  if (pct <= 110)  return "high";
  return "critical";
}

function utilLabel(pct: number) {
  if (pct === 0) return "";
  return `${pct}%`;
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLS = [
  "#00b8db","#3b82f6","#8b5cf6","#ec4899",
  "#f59e0b","#10b981","#ef4444","#f97316",
];
function avatarCol(name: string) {
  return AVATAR_COLS[name.charCodeAt(0) % AVATAR_COLS.length];
}

const GRAN_LABELS: Record<Granularity, string> = {
  weekly:    "Weekly",
  sprint:    "Sprint",
  monthly:   "Monthly",
  quarterly: "Quarterly",
};

const CELL_W: Record<Granularity, number> = {
  weekly:    64,
  sprint:    80,
  monthly:   90,
  quarterly: 110,
};

/* =============================================================================
   FILTER TYPES
============================================================================= */

export type PersonOption = { id: string; name: string; department: string | null };

type Filters = {
  granularity:  Granularity;
  dateFrom:     string;
  dateTo:       string;
  departments:  string[];
  statuses:     string[];
  personIds:    string[];
};

/* =============================================================================
   SUB-COMPONENTS
============================================================================= */

function Avatar({ name, size = 30 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: avatarCol(name), color: "#fff", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.33, fontWeight: 800, fontFamily: "'DM Sans', sans-serif",
    }}>
      {initials(name)}
    </div>
  );
}

function UtilBadge({ pct }: { pct: number }) {
  const tier = utilTier(pct);
  const col  = UTIL_COLOURS[tier];
  if (pct === 0) return null;
  return (
    <span style={{
      fontSize: "10px", fontWeight: 700, fontFamily: "'DM Mono', monospace",
      background: col.bg, color: col.text, border: `1px solid ${col.border}`,
      borderRadius: "4px", padding: "1px 5px",
    }}>{pct}%</span>
  );
}

/* -- Granularity Toggle -- */
function GranularityToggle({
  value, onChange,
}: {
  value: Granularity;
  onChange: (g: Granularity) => void;
}) {
  return (
    <div style={{
      display: "flex", background: "#f1f5f9",
      borderRadius: "8px", padding: "3px", gap: "2px",
    }}>
      {(["weekly","sprint","monthly","quarterly"] as Granularity[]).map(g => (
        <button key={g} type="button" onClick={() => onChange(g)} style={{
          padding: "5px 12px", borderRadius: "6px", border: "none",
          fontSize: "12px", fontWeight: 600, cursor: "pointer",
          fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
          background: value === g ? "white" : "transparent",
          color: value === g ? "#0f172a" : "#64748b",
          boxShadow: value === g ? "0 1px 4px rgba(0,0,0,0.08)" : "none",
        }}>{GRAN_LABELS[g]}</button>
      ))}
    </div>
  );
}

/* -- Filter Chip -- */
function FilterChip({
  label, active, count, colour, onClick,
}: {
  label: string; active: boolean; count?: number;
  colour?: string; onClick: () => void;
}) {
  const col = colour || "#00b8db";
  return (
    <button type="button" onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: "5px",
      padding: "4px 10px", borderRadius: "20px", border: "1.5px solid",
      borderColor: active ? col : "#e2e8f0",
      background: active ? `${col}15` : "white",
      color: active ? col : "#64748b",
      fontSize: "12px", fontWeight: 600,
      fontFamily: "'DM Sans', sans-serif", cursor: "pointer",
      transition: "all 0.15s",
    }}>
      {label}
      {count !== undefined && (
        <span style={{
          background: active ? col : "#e2e8f0",
          color: active ? "white" : "#64748b",
          borderRadius: "10px", padding: "0 5px",
          fontSize: "10px", fontWeight: 700,
        }}>{count}</span>
      )}
    </button>
  );
}

/* -- Heatmap Cell -- */
function HeatmapCell({
  cell, cellWidth, isCurrentPeriod,
}: {
  cell: AllocationCell | null;
  cellWidth: number;
  isCurrentPeriod: boolean;
}) {
  const pct  = cell?.utilisationPct ?? 0;
  const tier = utilTier(pct);
  const col  = UTIL_COLOURS[tier];

  return (
    <div style={{
      width: cellWidth - 2, minWidth: cellWidth - 2,
      height: "34px", borderRadius: "5px",
      background: isCurrentPeriod && pct === 0
        ? "rgba(0,184,219,0.04)"
        : col.bg,
      border: `1px solid ${isCurrentPeriod ? "rgba(0,184,219,0.2)" : col.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "11px", fontWeight: 700, fontFamily: "'DM Mono', monospace",
      color: pct === 0 ? "#e2e8f0" : col.text,
      cursor: cell && cell.allocationIds.length > 0 ? "pointer" : "default",
      transition: "all 0.1s",
      position: "relative",
      flexShrink: 0,
    }}
      title={cell ? `${cell.daysAllocated}d / ${cell.capacityDays}d capacity` : "No allocation"}
    >
      {pct > 0 ? `${pct}%` : "--"}
      {/* Util bar at bottom */}
      {pct > 0 && (
        <div style={{
          position: "absolute", bottom: 0, left: 0,
          height: "3px", borderRadius: "0 0 4px 4px",
          width: `${Math.min(pct, 100)}%`,
          background: col.text, opacity: 0.4,
          transition: "width 0.3s",
        }} />
      )}
    </div>
  );
}

/* -- Pipeline Cell -- */
function PipelineCell({
  cell, cellWidth, isCurrentPeriod,
}: {
  cell: PipelineGapRow["cells"][number] | null;
  cellWidth: number;
  isCurrentPeriod: boolean;
}) {
  const hasGap  = cell && cell.gapDays > 0;
  const hasDemand = cell && cell.demandDays > 0;

  return (
    <div style={{
      width: cellWidth - 2, minWidth: cellWidth - 2,
      height: "34px", borderRadius: "5px",
      background: hasGap
        ? "rgba(239,68,68,0.06)"
        : hasDemand ? "rgba(124,58,237,0.07)" : "#f8fafc",
      border: `1.5px dashed ${
        hasGap ? "rgba(239,68,68,0.3)"
               : hasDemand ? "rgba(124,58,237,0.3)" : "#e2e8f0"
      }`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "10px", fontWeight: 700, fontFamily: "'DM Mono', monospace",
      color: hasGap ? "#dc2626" : hasDemand ? "#7c3aed" : "#cbd5e1",
      flexShrink: 0,
    }}
      title={cell ? `Demand: ${cell.demandDays}d . Gap: ${cell.gapDays}d` : "No demand"}
    >
      {hasDemand ? (hasGap ? `-${cell!.gapDays}d` : "[check]") : "--"}
    </div>
  );
}

/* -- Period Header -- */
function PeriodHeaders({
  periods, cellWidth,
}: {
  periods: PeriodHeader[];
  cellWidth: number;
}) {
  return (
    <div style={{ display: "flex", gap: "2px" }}>
      {periods.map(p => (
        <div key={p.key} style={{
          width: cellWidth, minWidth: cellWidth, flexShrink: 0,
          textAlign: "center", padding: "0 2px",
        }}>
          {p.subLabel && (
            <div style={{
              fontSize: "9px", fontWeight: 700, color: "#94a3b8",
              fontFamily: "'DM Mono', monospace", marginBottom: "1px",
              letterSpacing: "0.04em",
            }}>{p.subLabel}</div>
          )}
          <div style={{
            fontSize: "11px", fontWeight: p.isCurrentPeriod ? 800 : 500,
            color: p.isCurrentPeriod ? "#00b8db" : "#475569",
            fontFamily: "'DM Sans', sans-serif",
            background: p.isCurrentPeriod ? "rgba(0,184,219,0.08)" : "transparent",
            borderRadius: "5px", padding: "2px 0",
          }}>{p.label}</div>
        </div>
      ))}
    </div>
  );
}

/* -- Person Row (collapsed + expanded) -- */
function PersonHeatmapRow({
  person, periods, cellWidth, expanded, onToggle,
}: {
  person: PersonRow;
  periods: PeriodHeader[];
  cellWidth: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  const peakTier = utilTier(person.peakUtilisationPct);

  return (
    <div style={{ borderBottom: "1px solid #f1f5f9" }}>
      {/* -- Collapsed summary row -- */}
      <div style={{
        display: "flex", alignItems: "center",
        padding: "6px 0", cursor: "pointer",
        background: expanded ? "rgba(0,184,219,0.02)" : "transparent",
        transition: "background 0.15s",
      }} onClick={onToggle}>

        {/* Person info -- fixed left column */}
        <div style={{
          width: "220px", minWidth: "220px", flexShrink: 0,
          display: "flex", alignItems: "center", gap: "8px",
          paddingRight: "12px",
        }}>
          <span style={{
            fontSize: "12px", color: "#94a3b8",
            transform: expanded ? "rotate(90deg)" : "rotate(0deg)",
            transition: "transform 0.2s", display: "inline-block",
            width: "14px", flexShrink: 0,
          }}>></span>
          <Avatar name={person.fullName} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontSize: "13px", fontWeight: 600, color: "#0f172a",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>{person.fullName}</div>
            <div style={{
              fontSize: "10px", color: "#94a3b8",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {person.jobTitle || person.department || "--"}
              {person.employmentType === "part_time" && (
                <span style={{ color: "#f59e0b", marginLeft: "4px", fontWeight: 600 }}>PT</span>
              )}
            </div>
          </div>
          <div style={{ marginLeft: "auto", flexShrink: 0 }}>
            <UtilBadge pct={person.avgUtilisationPct} />
          </div>
        </div>

        {/* Summary cells */}
        <div style={{ display: "flex", gap: "2px", overflowX: "visible" }}>
          {periods.map(period => {
            const cell = person.summaryCells.find(c => c.periodKey === period.key) ?? null;
            return (
              <HeatmapCell
                key={period.key}
                cell={cell}
                cellWidth={cellWidth}
                isCurrentPeriod={period.isCurrentPeriod}
              />
            );
          })}
        </div>
      </div>

      {/* -- Expanded project swimlanes -- */}
      {expanded && (
        <div style={{ paddingLeft: "222px", paddingBottom: "4px" }}>
          {person.projects.length === 0 ? (
            <div style={{
              padding: "8px 0", fontSize: "12px", color: "#94a3b8",
              fontStyle: "italic",
            }}>
              No allocations in this period
            </div>
          ) : (
            person.projects.map(proj => (
              <div key={proj.projectId} style={{
                display: "flex", alignItems: "center",
                padding: "3px 0", gap: "0",
              }}>
                {/* Project label */}
                <div style={{
                  display: "flex", alignItems: "center", gap: "6px",
                  paddingRight: "12px",
                }}>
                  <div style={{
                    width: "3px", height: "24px", borderRadius: "2px",
                    background: proj.colour, flexShrink: 0,
                  }} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{
                      fontSize: "11px", fontWeight: 600,
                      color: proj.colour,
                      fontFamily: "'DM Mono', monospace",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                      maxWidth: "120px",
                    }}>
                      {proj.projectCode || proj.projectTitle.slice(0, 8)}
                    </div>
                    {proj.roleOnProject && (
                      <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                        {proj.roleOnProject}
                      </div>
                    )}
                  </div>
                </div>

                {/* Project cells */}
                <div style={{ display: "flex", gap: "2px" }}>
                  {periods.map(period => {
                    const cell = proj.cells.find(c => c.periodKey === period.key);
                    if (!cell || cell.daysAllocated === 0) {
                      return (
                        <div key={period.key} style={{
                          width: cellWidth - 2, minWidth: cellWidth - 2,
                          height: "26px", flexShrink: 0,
                        }} />
                      );
                    }
                    return (
                      <div key={period.key} style={{
                        width: cellWidth - 2, minWidth: cellWidth - 2,
                        height: "26px", borderRadius: "4px", flexShrink: 0,
                        background: `${proj.colour}15`,
                        border: `1px solid ${proj.colour}30`,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: "10px", fontWeight: 700,
                        fontFamily: "'DM Mono', monospace",
                        color: proj.colour,
                      }}>
                        {cell.daysAllocated}d
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}

          {/* Add allocation link */}
          <div style={{ padding: "4px 0 6px" }}>
            <a href={`/allocations/new?person_id=${person.personId}&return_to=/heatmap`}
              style={{
                fontSize: "11px", color: "#00b8db", fontWeight: 600,
                textDecoration: "none", display: "inline-flex",
                alignItems: "center", gap: "4px",
              }}>
              + Allocate to project
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

/* -- Pipeline Section -- */
function PipelineSection({
  pipelineGaps, periods, cellWidth,
}: {
  pipelineGaps: PipelineGapRow[];
  periods: PeriodHeader[];
  cellWidth: number;
}) {
  const [open, setOpen] = useState(false);
  if (!pipelineGaps.length) return null;

  return (
    <div style={{
      marginTop: "16px", border: "1.5px dashed #c4b5fd",
      borderRadius: "12px", overflow: "hidden",
    }}>
      {/* Header */}
      <div
        style={{
          padding: "10px 16px", background: "rgba(124,58,237,0.04)",
          display: "flex", alignItems: "center", gap: "10px",
          cursor: "pointer",
        }}
        onClick={() => setOpen(o => !o)}
      >
        <span style={{ fontSize: "14px" }}>o</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#7c3aed" }}>
            Pipeline projects -- capacity gap analysis
          </div>
          <div style={{ fontSize: "11px", color: "#94a3b8" }}>
            {pipelineGaps.length} project{pipelineGaps.length > 1 ? "s" : ""} .
            {" "}Dashed cells show demand vs available capacity
          </div>
        </div>
        <span style={{
          fontSize: "14px", color: "#94a3b8",
          transform: open ? "rotate(180deg)" : "rotate(0deg)",
          transition: "transform 0.2s", display: "inline-block",
        }}>v</span>
      </div>

      {open && (
        <div style={{ padding: "12px 16px" }}>
          {/* Period headers (aligned with main heatmap) */}
          <div style={{ display: "flex", marginBottom: "8px" }}>
            <div style={{ width: "220px", minWidth: "220px", flexShrink: 0 }} />
            <PeriodHeaders periods={periods} cellWidth={cellWidth} />
          </div>

          {pipelineGaps.map(proj => (
            <div key={proj.projectId} style={{
              display: "flex", alignItems: "center",
              padding: "4px 0", borderTop: "1px solid #f5f0ff",
            }}>
              <div style={{
                width: "220px", minWidth: "220px", flexShrink: 0,
                display: "flex", alignItems: "center", gap: "8px",
                paddingRight: "12px",
              }}>
                <div style={{
                  width: "3px", height: "32px", borderRadius: "2px",
                  background: proj.colour, flexShrink: 0,
                }} />
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: "12px", fontWeight: 700,
                    color: "#0f172a",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  }}>{proj.projectTitle}</div>
                  <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
                    {proj.projectCode && (
                      <span style={{
                        fontSize: "10px", fontFamily: "'DM Mono', monospace",
                        color: proj.colour, fontWeight: 700,
                      }}>{proj.projectCode}</span>
                    )}
                    <span style={{
                      fontSize: "10px", color: "#94a3b8",
                    }}>{proj.winProbability}% win</span>
                  </div>
                </div>
              </div>

              <div style={{ display: "flex", gap: "2px" }}>
                {periods.map(period => {
                  const cell = proj.cells.find(c => c.periodKey === period.key) ?? null;
                  return (
                    <PipelineCell
                      key={period.key}
                      cell={cell}
                      cellWidth={cellWidth}
                      isCurrentPeriod={period.isCurrentPeriod}
                    />
                  );
                })}
              </div>
            </div>
          ))}

          {/* Legend */}
          <div style={{
            marginTop: "12px", display: "flex", gap: "16px",
            fontSize: "11px", color: "#94a3b8",
          }}>
            {[
              { col: "rgba(124,58,237,0.3)", label: "Demand (capacity available)" },
              { col: "rgba(239,68,68,0.3)",  label: "Gap (insufficient capacity)" },
            ].map(l => (
              <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "5px" }}>
                <div style={{
                  width: "12px", height: "12px", borderRadius: "3px",
                  border: `1.5px dashed ${l.col}`,
                }} />
                {l.label}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   MAIN COMPONENT
============================================================================= */

export default function HeatmapClient({
  initialData,
  allPeople,
  allDepartments,
  initialFilters,
}: {
  initialData:      HeatmapData;
  allPeople:        PersonOption[];
  allDepartments:   string[];
  initialFilters:   Filters;
}) {
  const [data,        setData]        = useState<HeatmapData>(initialData);
  const [filters,     setFilters]     = useState<Filters>(initialFilters);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef  = useRef<AbortController | null>(null);

  const cellWidth = CELL_W[filters.granularity];

  // -- Fetch updated data when filters change --------------------------------
  const fetchData = useCallback(async (f: Filters) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      params.set("granularity", f.granularity);
      params.set("dateFrom",    f.dateFrom);
      params.set("dateTo",      f.dateTo);
      f.departments.forEach(d => params.append("dept",   d));
      f.statuses.forEach(s    => params.append("status", s));
      f.personIds.forEach(p   => params.append("person", p));

      const res = await fetch(`/api/heatmap/data?${params}`, {
        signal: abortRef.current.signal,
      });

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(filters);
  }, [filters, fetchData]);

  // -- Filter helpers --------------------------------------------------------
  const setGranularity = (g: Granularity) =>
    setFilters(f => ({ ...f, granularity: g }));

  const toggleDept = (dept: string) =>
    setFilters(f => ({
      ...f,
      departments: f.departments.includes(dept)
        ? f.departments.filter(d => d !== dept)
        : [...f.departments, dept],
    }));

  const toggleStatus = (status: string) =>
    setFilters(f => ({
      ...f,
      statuses: f.statuses.includes(status)
        ? f.statuses.filter(s => s !== status)
        : [...f.statuses, status],
    }));

  const togglePerson = (id: string) =>
    setFilters(f => ({
      ...f,
      personIds: f.personIds.includes(id)
        ? f.personIds.filter(p => p !== id)
        : [...f.personIds, id],
    }));

  const clearFilters = () =>
    setFilters(f => ({ ...f, departments: [], statuses: [], personIds: [] }));

  const activeFilterCount =
    filters.departments.length +
    filters.statuses.length +
    filters.personIds.length;

  const toggleExpand = (id: string) =>
    setExpandedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const expandAll  = () => setExpandedIds(new Set(data.people.map(p => p.personId)));
  const collapseAll = () => setExpandedIds(new Set());

  // -- Stats strip ----------------------------------------------------------
  const avgUtil = data.people.length
    ? Math.round(
        data.people.reduce((s, p) => s + p.avgUtilisationPct, 0) / data.people.length
      )
    : 0;
  const overAllocCount = data.people.filter(p => p.peakUtilisationPct > 100).length;
  const totalAllocDays = data.people.reduce((s, p) =>
    s + p.summaryCells.reduce((ss, c) => ss + c.daysAllocated, 0), 0
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

        .hm-root {
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh;
          background: #f8fafc;
          color: #0f172a;
        }
        .hm-inner {
          max-width: 1400px;
          margin: 0 auto;
          padding: 32px 28px;
        }
        .hm-toolbar {
          display: flex;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
          margin-bottom: 20px;
        }
        .hm-card {
          background: white;
          border-radius: 14px;
          border: 1.5px solid #e2e8f0;
          overflow: hidden;
          box-shadow: 0 1px 8px rgba(0,0,0,0.04);
        }
        .hm-table-wrap {
          overflow-x: auto;
          overflow-y: visible;
        }
        .hm-table-inner {
          min-width: max-content;
          padding: 0 16px 16px;
        }
        .hm-filter-panel {
          background: white;
          border: 1.5px solid #e2e8f0;
          border-radius: 12px;
          padding: 16px;
          margin-bottom: 16px;
          display: flex;
          flex-direction: column;
          gap: 14px;
          animation: slideDown 0.2s ease;
        }
        .hm-filter-group-label {
          font-size: 10px;
          font-weight: 800;
          color: #94a3b8;
          letter-spacing: 0.08em;
          text-transform: uppercase;
          margin-bottom: 6px;
        }
        .hm-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .hm-legend {
          display: flex;
          gap: 16px;
          flex-wrap: wrap;
          padding: 10px 16px;
          border-top: 1px solid #f1f5f9;
          background: #fafafa;
        }
        .hm-legend-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 11px;
          color: #64748b;
        }
        @keyframes slideDown {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="hm-root">
        <div className="hm-inner">

          {/* -- Page header -- */}
          <div style={{
            display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", marginBottom: "24px",
            flexWrap: "wrap", gap: "12px",
          }}>
            <div>
              <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a",
                           margin: 0, marginBottom: "4px" }}>
                Resource Heatmap
              </h1>
              <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
                {data.dateFrom} -> {data.dateTo} .{" "}
                {data.people.length} people .{" "}
                <span style={{ color: "#00b8db" }}>{GRAN_LABELS[data.granularity]} view</span>
                {loading && (
                  <span style={{ marginLeft: "10px" }}>
                    <span style={{
                      display: "inline-block", width: "12px", height: "12px",
                      borderRadius: "50%", border: "2px solid #e2e8f0",
                      borderTopColor: "#00b8db",
                      animation: "spin 0.6s linear infinite",
                      verticalAlign: "middle",
                    }} />
                  </span>
                )}
              </p>
            </div>

            <a href="/allocations/new" style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "8px 16px", borderRadius: "8px",
              background: "#00b8db", border: "none", color: "white",
              fontSize: "13px", fontWeight: 700, textDecoration: "none",
              boxShadow: "0 2px 10px rgba(0,184,219,0.3)",
            }}>
              + Allocate resource
            </a>
          </div>

          {/* -- Stats strip -- */}
          <div style={{
            display: "grid", gridTemplateColumns: "repeat(4, 1fr)",
            gap: "12px", marginBottom: "20px",
          }}>
            {[
              { l: "People",       v: data.people.length,                      c: "#0f172a" },
              { l: "Avg util",     v: `${avgUtil}%`,                           c: avgUtil > 90 ? "#ef4444" : avgUtil > 70 ? "#f59e0b" : "#10b981" },
              { l: "Over-alloc",   v: overAllocCount,                          c: overAllocCount > 0 ? "#ef4444" : "#10b981" },
              { l: "Total days",   v: `${Math.round(totalAllocDays)}d`,        c: "#0f172a" },
            ].map(s => (
              <div key={s.l} style={{
                background: "white", borderRadius: "10px",
                border: "1.5px solid #e2e8f0",
                padding: "12px 16px",
              }}>
                <div style={{ fontSize: "10px", color: "#94a3b8",
                              textTransform: "uppercase", letterSpacing: "0.06em",
                              marginBottom: "4px" }}>{s.l}</div>
                <div style={{ fontSize: "20px", fontWeight: 800,
                              color: s.c, fontFamily: "'DM Mono', monospace" }}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* -- Toolbar -- */}
          <div className="hm-toolbar">
            <GranularityToggle value={filters.granularity} onChange={setGranularity} />

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <input
                type="date" value={filters.dateFrom}
                onChange={e => setFilters(f => ({ ...f, dateFrom: e.target.value }))}
                style={{
                  padding: "6px 10px", borderRadius: "7px",
                  border: "1.5px solid #e2e8f0", fontSize: "12px",
                  fontFamily: "'DM Sans', sans-serif", color: "#0f172a",
                  outline: "none",
                }}
              />
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>-></span>
              <input
                type="date" value={filters.dateTo}
                onChange={e => setFilters(f => ({ ...f, dateTo: e.target.value }))}
                style={{
                  padding: "6px 10px", borderRadius: "7px",
                  border: "1.5px solid #e2e8f0", fontSize: "12px",
                  fontFamily: "'DM Sans', sans-serif", color: "#0f172a",
                  outline: "none",
                }}
              />
            </div>

            <button type="button" onClick={() => setShowFilters(s => !s)} style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              padding: "7px 14px", borderRadius: "8px",
              border: `1.5px solid ${showFilters || activeFilterCount > 0 ? "#00b8db" : "#e2e8f0"}`,
              background: showFilters || activeFilterCount > 0 ? "rgba(0,184,219,0.08)" : "white",
              color: activeFilterCount > 0 ? "#00b8db" : "#475569",
              fontSize: "12px", fontWeight: 600, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/>
              </svg>
              Filters
              {activeFilterCount > 0 && (
                <span style={{
                  background: "#00b8db", color: "white",
                  borderRadius: "10px", padding: "0 5px",
                  fontSize: "10px", fontWeight: 700,
                }}>{activeFilterCount}</span>
              )}
            </button>

            <div style={{ marginLeft: "auto", display: "flex", gap: "8px" }}>
              <button type="button" onClick={expandAll} style={{
                padding: "6px 12px", borderRadius: "7px", border: "1.5px solid #e2e8f0",
                background: "white", color: "#64748b", fontSize: "11px",
                fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}>Expand all</button>
              <button type="button" onClick={collapseAll} style={{
                padding: "6px 12px", borderRadius: "7px", border: "1.5px solid #e2e8f0",
                background: "white", color: "#64748b", fontSize: "11px",
                fontWeight: 600, cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}>Collapse all</button>
            </div>
          </div>

          {/* -- Filter panel -- */}
          {showFilters && (
            <div className="hm-filter-panel">
              <div style={{ display: "flex", gap: "32px", flexWrap: "wrap" }}>
                {/* Department */}
                <div>
                  <div className="hm-filter-group-label">Department</div>
                  <div className="hm-chips">
                    {allDepartments.map(dept => (
                      <FilterChip
                        key={dept}
                        label={dept}
                        active={filters.departments.includes(dept)}
                        onClick={() => toggleDept(dept)}
                      />
                    ))}
                  </div>
                </div>

                {/* Status */}
                <div>
                  <div className="hm-filter-group-label">Project status</div>
                  <div className="hm-chips">
                    <FilterChip
                      label="* Confirmed"
                      active={filters.statuses.includes("confirmed")}
                      colour="#00b8db"
                      onClick={() => toggleStatus("confirmed")}
                    />
                    <FilterChip
                      label="o Pipeline"
                      active={filters.statuses.includes("pipeline")}
                      colour="#7c3aed"
                      onClick={() => toggleStatus("pipeline")}
                    />
                  </div>
                </div>

                {/* People */}
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <div className="hm-filter-group-label">People</div>
                  <div className="hm-chips" style={{ maxHeight: "80px", overflowY: "auto" }}>
                    {allPeople.map(p => (
                      <FilterChip
                        key={p.id}
                        label={p.name.split(" ")[0]}
                        active={filters.personIds.includes(p.id)}
                        onClick={() => togglePerson(p.id)}
                      />
                    ))}
                  </div>
                </div>
              </div>

              {activeFilterCount > 0 && (
                <div>
                  <button type="button" onClick={clearFilters} style={{
                    background: "none", border: "none", color: "#ef4444",
                    fontSize: "12px", fontWeight: 600, cursor: "pointer",
                    fontFamily: "'DM Sans', sans-serif", padding: 0,
                  }}>
                    x Clear all filters
                  </button>
                </div>
              )}
            </div>
          )}

          {/* -- Error -- */}
          {error && (
            <div style={{
              padding: "12px 16px", borderRadius: "9px",
              background: "#fef2f2", border: "1px solid #fecaca",
              color: "#dc2626", fontSize: "13px", marginBottom: "16px",
            }}>
              Failed to load heatmap data: {error}
            </div>
          )}

          {/* -- Main heatmap card -- */}
          <div className="hm-card" style={{ opacity: loading ? 0.7 : 1, transition: "opacity 0.2s" }}>

            {/* Period header row */}
            <div style={{
              padding: "12px 16px 8px",
              borderBottom: "1px solid #f1f5f9",
              display: "flex", alignItems: "flex-end",
              position: "sticky", top: 0, background: "white", zIndex: 10,
            }}>
              <div style={{ width: "220px", minWidth: "220px", flexShrink: 0,
                            fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                            letterSpacing: "0.08em", textTransform: "uppercase" }}>
                PERSON
              </div>
              <div ref={scrollRef} style={{ overflowX: "auto", flex: 1 }}>
                <PeriodHeaders periods={data.periods} cellWidth={cellWidth} />
              </div>
            </div>

            {/* People rows */}
            <div className="hm-table-wrap">
              <div className="hm-table-inner">
                {data.people.length === 0 ? (
                  <div style={{
                    padding: "48px 0", textAlign: "center",
                    color: "#94a3b8", fontSize: "14px",
                  }}>
                    {loading ? "Loading..." : "No people match the current filters."}
                  </div>
                ) : (
                  data.people.map(person => (
                    <PersonHeatmapRow
                      key={person.personId}
                      person={person}
                      periods={data.periods}
                      cellWidth={cellWidth}
                      expanded={expandedIds.has(person.personId)}
                      onToggle={() => toggleExpand(person.personId)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Legend */}
            <div className="hm-legend">
              {[
                { tier: "low",      label: "< 75% -- available" },
                { tier: "mid",      label: "75-95% -- busy"     },
                { tier: "high",     label: "95-110% -- at limit" },
                { tier: "critical", label: "> 110% -- over-allocated" },
              ].map(l => {
                const col = UTIL_COLOURS[l.tier as keyof typeof UTIL_COLOURS];
                return (
                  <div key={l.tier} className="hm-legend-item">
                    <div style={{
                      width: "12px", height: "12px", borderRadius: "3px",
                      background: col.bg, border: `1px solid ${col.border}`,
                    }} />
                    {l.label}
                  </div>
                );
              })}
            </div>
          </div>

          {/* -- Pipeline gap section -- */}
          <PipelineSection
            pipelineGaps={data.pipelineGaps}
            periods={data.periods}
            cellWidth={cellWidth}
          />

        </div>
      </div>
    </>
  );
}

