"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type {
  HeatmapData, PersonRow, AllocationCell,
  Granularity, PeriodHeader, PipelineGapRow,
} from "../_lib/heatmap-query";

/* =============================================================================
   CONSTANTS + HELPERS
============================================================================= */

const UTIL_COLOURS = {
  empty:    { bg: "#f8fafc",            text: "#cbd5e1",   border: "#f1f5f9"   },
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

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLS = ["#00b8db","#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981","#ef4444","#f97316"];
function avatarCol(name: string) {
  return AVATAR_COLS[name.charCodeAt(0) % AVATAR_COLS.length];
}

const GRAN_LABELS: Record<Granularity, string> = {
  weekly: "Weekly", sprint: "Sprint", monthly: "Monthly", quarterly: "Quarterly",
};

const CELL_W: Record<Granularity, number> = {
  weekly: 64, sprint: 80, monthly: 90, quarterly: 110,
};

/* =============================================================================
   FILTER TYPES
============================================================================= */

export type PersonOption = { id: string; name: string; department: string | null };

type Filters = {
  granularity:  Granularity;
  dateFrom:      string;
  dateTo:        string;
  departments:  string[];
  statuses:      string[];
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

function GranularityToggle({ value, onChange }: { value: Granularity; onChange: (g: Granularity) => void }) {
  return (
    <div style={{ display: "flex", background: "#f1f5f9", borderRadius: "8px", padding: "3px", gap: "2px" }}>
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

function HeatmapCell({ cell, cellWidth, isCurrentPeriod }: { cell: AllocationCell | null; cellWidth: number; isCurrentPeriod: boolean }) {
  const pct  = cell?.utilisationPct ?? 0;
  const tier = utilTier(pct);
  const col  = UTIL_COLOURS[tier];

  return (
    <div style={{
      width: cellWidth - 2, minWidth: cellWidth - 2, height: "34px", borderRadius: "5px",
      background: isCurrentPeriod && pct === 0 ? "rgba(0,184,219,0.04)" : col.bg,
      border: `1px solid ${isCurrentPeriod ? "rgba(0,184,219,0.2)" : col.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "11px", fontWeight: 700, fontFamily: "'DM Mono', monospace",
      color: pct === 0 ? "#e2e8f0" : col.text, flexShrink: 0, position: "relative",
    }} title={cell ? `${cell.daysAllocated}d / ${cell.capacityDays}d` : "No allocation"}>
      {pct > 0 ? `${pct}%` : "—"}
      {pct > 0 && (
        <div style={{
          position: "absolute", bottom: 0, left: 0, height: "3px", borderRadius: "0 0 4px 4px",
          width: `${Math.min(pct, 100)}%`, background: col.text, opacity: 0.4,
        }} />
      )}
    </div>
  );
}

function PeriodHeaders({ periods, cellWidth }: { periods: PeriodHeader[]; cellWidth: number }) {
  return (
    <div style={{ display: "flex", gap: "2px" }}>
      {periods.map(p => (
        <div key={p.key} style={{ width: cellWidth, minWidth: cellWidth, flexShrink: 0, textAlign: "center", padding: "0 2px" }}>
          {p.subLabel && <div style={{ fontSize: "9px", fontWeight: 700, color: "#94a3b8", fontFamily: "'DM Mono', monospace" }}>{p.subLabel}</div>}
          <div style={{
            fontSize: "11px", fontWeight: p.isCurrentPeriod ? 800 : 500,
            color: p.isCurrentPeriod ? "#00b8db" : "#475569",
            background: p.isCurrentPeriod ? "rgba(0,184,219,0.08)" : "transparent",
            borderRadius: "5px", padding: "2px 0",
          }}>{p.label}</div>
        </div>
      ))}
    </div>
  );
}

function PersonHeatmapRow({ person, periods, cellWidth, expanded, onToggle }: { person: PersonRow; periods: PeriodHeader[]; cellWidth: number; expanded: boolean; onToggle: () => void }) {
  return (
    <div style={{ borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ display: "flex", alignItems: "center", padding: "6px 0", cursor: "pointer", background: expanded ? "rgba(0,184,219,0.02)" : "transparent" }} onClick={onToggle}>
        <div style={{ width: "220px", minWidth: "220px", flexShrink: 0, display: "flex", alignItems: "center", gap: "8px", paddingRight: "12px" }}>
          <span style={{ fontSize: "12px", color: "#94a3b8", transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform 0.2s", width: "14px" }}>›</span>
          <Avatar name={person.fullName} size={28} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{person.fullName}</div>
            <div style={{ fontSize: "10px", color: "#94a3b8" }}>{person.jobTitle || person.department || "—"}</div>
          </div>
          <div style={{ marginLeft: "auto" }}><UtilBadge pct={person.avgUtilisationPct} /></div>
        </div>
        <div style={{ display: "flex", gap: "2px" }}>
          {periods.map(period => (
            <HeatmapCell key={period.key} cell={person.summaryCells.find(c => c.periodKey === period.key) ?? null} cellWidth={cellWidth} isCurrentPeriod={period.isCurrentPeriod} />
          ))}
        </div>
      </div>
      {expanded && (
        <div style={{ paddingLeft: "222px", paddingBottom: "8px" }}>
          {person.projects.map(proj => (
            <div key={proj.projectId} style={{ display: "flex", alignItems: "center", padding: "3px 0" }}>
              <div style={{ width: "120px", fontSize: "11px", fontWeight: 600, color: proj.colour, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.projectCode || proj.projectTitle}</div>
              <div style={{ display: "flex", gap: "2px" }}>
                {periods.map(period => {
                  const cell = proj.cells.find(c => c.periodKey === period.key);
                  return <div key={period.key} style={{ width: cellWidth - 2, height: "26px", borderRadius: "4px", background: cell?.daysAllocated ? `${proj.colour}15` : "transparent", border: cell?.daysAllocated ? `1px solid ${proj.colour}30` : "none", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", color: proj.colour }}>{cell?.daysAllocated ? `${cell.daysAllocated}d` : ""}</div>
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* =============================================================================
   MAIN COMPONENT
============================================================================= */

export default function HeatmapClient({ initialData, allPeople, allDepartments, initialFilters }: { initialData: HeatmapData; allPeople: PersonOption[]; allDepartments: string[]; initialFilters: Filters }) {
  const [data, setData] = useState<HeatmapData>(initialData);
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const fetchData = useCallback(async (f: Filters) => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    try {
      const params = new URLSearchParams({ granularity: f.granularity, dateFrom: f.dateFrom, dateTo: f.dateTo });
      f.departments.forEach(d => params.append("dept", d));
      const res = await fetch(`/api/heatmap/data?${params}`, { signal: abortRef.current.signal });
      if (res.ok) setData(await res.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(filters); }, [filters, fetchData]);

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", padding: "32px", background: "#f8fafc" }}>
       <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "24px" }}>
          <div>
            <h1 style={{ fontSize: "24px", fontWeight: 800, margin: 0 }}>Resource Heatmap</h1>
            <p style={{ color: "#94a3b8", fontSize: "14px" }}>{data.people.length} active resources</p>
          </div>
          <GranularityToggle value={filters.granularity} onChange={(g) => setFilters(f => ({ ...f, granularity: g }))} />
       </div>

       <div style={{ background: "white", borderRadius: "12px", border: "1.5px solid #e2e8f0", overflowX: "auto", padding: "16px" }}>
          <div style={{ display: "flex", marginBottom: "12px" }}>
            <div style={{ width: "220px" }} />
            <PeriodHeaders periods={data.periods} cellWidth={CELL_W[filters.granularity]} />
          </div>
          {data.people.map(p => (
            <PersonHeatmapRow 
              key={p.personId} 
              person={p} 
              periods={data.periods} 
              cellWidth={CELL_W[filters.granularity]} 
              expanded={expandedIds.has(p.personId)}
              onToggle={() => setExpandedIds(prev => {
                const n = new Set(prev);
                n.has(p.personId) ? n.delete(p.personId) : n.add(p.personId);
                return n;
              })}
            />
          ))}
       </div>
    </div>
  );
}
