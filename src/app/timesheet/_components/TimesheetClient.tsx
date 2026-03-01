"use client";
// FILE: src/app/timesheet/_components/TimesheetClient.tsx

import { useState, useTransition, useCallback } from "react";
import type { TimesheetProject, TimesheetEntry, TimesheetData } from "../page";
import {
  saveTimesheetEntriesAction,
  submitTimesheetAction,
  recallTimesheetAction,
} from "../actions";

/* =============================================================================
   HELPERS
============================================================================= */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", timeZone: "UTC",
  });
}

function fmtWeek(iso: string): string {
  const end = addDays(iso, 6);
  return `${fmtDate(iso)} - ${fmtDate(end)}`;
}

function prevMonday(dateStr: string): string { return addDays(dateStr, -7); }
function nextMonday(dateStr: string): string { return addDays(dateStr, 7); }

const STATUS_META: Record<string, { label: string; colour: string; bg: string }> = {
  draft:     { label: "Draft",     colour: "#64748b", bg: "rgba(100,116,139,0.1)" },
  submitted: { label: "Submitted", colour: "#d97706", bg: "rgba(245,158,11,0.1)"  },
  approved:  { label: "Approved",  colour: "#059669", bg: "rgba(16,185,129,0.1)"  },
  rejected:  { label: "Rejected",  colour: "#dc2626", bg: "rgba(239,68,68,0.1)"   },
};

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span style={{
      fontSize: "10px", fontWeight: 800, padding: "3px 8px",
      borderRadius: "5px", background: meta.bg, color: meta.colour,
    }}>{meta.label}</span>
  );
}

/* =============================================================================
   GRID STATE: hours[projectId][dayIndex] = number
============================================================================= */
type GridState = Record<string, Record<number, number>>;

function buildInitialGrid(entries: TimesheetEntry[], weekStart: string): GridState {
  const grid: GridState = {};
  for (const e of entries) {
    if (!e.projectId) continue;
    const dayIdx = Math.round(
      (new Date(e.workDate).getTime() - new Date(weekStart).getTime()) / 86400000
    );
    if (dayIdx < 0 || dayIdx > 6) continue;
    if (!grid[e.projectId]) grid[e.projectId] = {};
    grid[e.projectId][dayIdx] = e.hours;
  }
  return grid;
}

function gridToFormData(
  grid: GridState,
  timesheetId: string,
  weekStart: string
): FormData {
  const fd = new FormData();
  fd.set("timesheet_id", timesheetId);
  for (const [projectId, days] of Object.entries(grid)) {
    for (const [dayIdx, hours] of Object.entries(days)) {
      const date = addDays(weekStart, Number(dayIdx));
      fd.set(`entry_${projectId}_${date}`, String(hours));
    }
  }
  return fd;
}

/* =============================================================================
   CELL INPUT
============================================================================= */
function HoursCell({
  value, onChange, disabled,
}: {
  value: number; onChange: (v: number) => void; disabled: boolean;
}) {
  const [focused, setFocused] = useState(false);

  return (
    <input
      type="number"
      min={0} max={24} step={0.5}
      value={value === 0 && !focused ? "" : value}
      placeholder="0"
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => {
        const v = Math.max(0, Math.min(24, Number(e.target.value) || 0));
        onChange(v);
      }}
      style={{
        width: "100%", boxSizing: "border-box",
        padding: "6px 4px", textAlign: "center",
        border: "1.5px solid",
        borderColor: focused ? "#0e7490" : value > 0 ? "#bae6fd" : "#f1f5f9",
        borderRadius: "6px",
        background: value > 8 ? "rgba(239,68,68,0.06)" :
                    value > 0 ? "rgba(14,116,144,0.05)" : "white",
        fontSize: "12px", fontWeight: value > 0 ? 700 : 400,
        color: value > 8 ? "#dc2626" : "#0f172a",
        outline: "none",
        appearance: "textfield",
        MozAppearance: "textfield",
        cursor: disabled ? "not-allowed" : "text",
        opacity: disabled ? 0.6 : 1,
      } as React.CSSProperties}
    />
  );
}

/* =============================================================================
   PROJECT ROW SELECTOR
============================================================================= */
function AddProjectRow({
  projects, usedIds, onAdd,
}: {
  projects: TimesheetProject[];
  usedIds: string[];
  onAdd: (p: TimesheetProject) => void;
}) {
  const available = projects.filter(p => !usedIds.includes(p.id));
  if (available.length === 0) return null;

  return (
    <div style={{ padding: "8px 0" }}>
      <select
        onChange={e => {
          const p = projects.find(p => p.id === e.target.value);
          if (p) { onAdd(p); e.target.value = ""; }
        }}
        style={{
          padding: "6px 10px", borderRadius: "7px",
          border: "1.5px solid #e2e8f0", fontSize: "12px",
          color: "#64748b", background: "white", cursor: "pointer",
          fontFamily: "inherit", outline: "none",
        }}
      >
        <option value="">+ Add project row...</option>
        {available.map(p => (
          <option key={p.id} value={p.id}>
            {p.title}{p.code ? ` (${p.code})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

/* =============================================================================
   MAIN CLIENT
============================================================================= */
export default function TimesheetClient({
  weekStart: initialWeekStart,
  projects,
  allocatedProjectIds,
  timesheetData,
  recentTimesheets,
  isAdmin,
  organisationId,
  userId,
  userName,
}: {
  weekStart:           string;
  projects:            TimesheetProject[];
  allocatedProjectIds: string[];
  timesheetData:       TimesheetData;
  recentTimesheets:    { id: string; weekStart: string; status: string }[];
  isAdmin:             boolean;
  organisationId:      string;
  userId:              string;
  userName:            string;
}) {
  const [weekStart,   setWeekStart]   = useState(initialWeekStart);
  const [tsData,      setTsData]      = useState<TimesheetData>(timesheetData);
  const [grid,        setGrid]        = useState<GridState>(() =>
    buildInitialGrid(timesheetData.entries, initialWeekStart)
  );
  const [rowProjects, setRowProjects] = useState<TimesheetProject[]>(() => {
    // Start with allocated projects + any already-logged projects
    const usedIds = new Set([
      ...allocatedProjectIds,
      ...timesheetData.entries.map(e => e.projectId).filter(Boolean) as string[],
    ]);
    return projects.filter(p => usedIds.has(p.id));
  });
  const [error,   setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving,  startSave]  = useTransition();
  const [submitting, startSubmit] = useTransition();

  const isReadOnly = tsData.status !== "draft";

  // Days of this week
  const days = Array.from({ length: 7 }, (_, i) => ({
    label: DAYS[i],
    date:  addDays(weekStart, i),
    isWeekend: i >= 5,
  }));

  function setHours(projectId: string, dayIdx: number, hours: number) {
    setGrid(g => ({
      ...g,
      [projectId]: { ...(g[projectId] ?? {}), [dayIdx]: hours },
    }));
  }

  function projectTotal(projectId: string): number {
    return Object.values(grid[projectId] ?? {}).reduce((a, b) => a + b, 0);
  }

  function dayTotal(dayIdx: number): number {
    return rowProjects.reduce((sum, p) => sum + (grid[p.id]?.[dayIdx] ?? 0), 0);
  }

  function weekTotal(): number {
    return rowProjects.reduce((sum, p) => sum + projectTotal(p.id), 0);
  }

  function navigate(newWeek: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("week", newWeek);
    window.location.href = url.toString();
  }

  async function handleSave() {
    setError(null); setSuccess(null);
    let id = tsData.id;

    // Create timesheet if needed
    if (!id) {
      const fd = new FormData();
      fd.set("week_start_date", weekStart);
      try {
        const res = await fetch("/api/timesheet/create", {
          method: "POST",
          body: JSON.stringify({ week_start_date: weekStart }),
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
        });
        const j = await res.json();
        if (!j.ok) throw new Error(j.error);
        id = j.timesheetId;
        setTsData(d => ({ ...d, id, status: "draft" }));
      } catch (e: any) {
        setError(e?.message ?? "Failed to create timesheet");
        return;
      }
    }

    startSave(async () => {
      try {
        const fd = gridToFormData(grid, id!, weekStart);
        const res = await saveTimesheetEntriesAction(fd) as any;
        setSuccess(`Saved ${res.saved} entr${res.saved !== 1 ? "ies" : "y"}`);
      } catch (e: any) {
        setError(e?.message ?? "Failed to save");
      }
    });
  }

  async function handleSubmit() {
    if (!tsData.id) { await handleSave(); }
    setError(null); setSuccess(null);
    startSubmit(async () => {
      try {
        const fd = new FormData();
        fd.set("timesheet_id", tsData.id!);
        await submitTimesheetAction(fd);
        setTsData(d => ({ ...d, status: "submitted" }));
        setSuccess("Timesheet submitted for approval");
      } catch (e: any) {
        setError(e?.message ?? "Failed to submit");
      }
    });
  }

  async function handleRecall() {
    setError(null); setSuccess(null);
    startSubmit(async () => {
      try {
        const fd = new FormData();
        fd.set("timesheet_id", tsData.id!);
        await recallTimesheetAction(fd);
        setTsData(d => ({ ...d, status: "draft" }));
        setSuccess("Timesheet recalled to draft");
      } catch (e: any) {
        setError(e?.message ?? "Failed to recall");
      }
    });
  }

  const exportUrl = `/api/timesheet/export?user_id=${userId}&from=${weekStart}&to=${weekStart}`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');
        input[type=number]::-webkit-inner-spin-button,
        input[type=number]::-webkit-outer-spin-button { -webkit-appearance: none; }
      `}</style>

      <div style={{ padding: "24px 28px", fontFamily: "'DM Sans', sans-serif",
                    maxWidth: "1100px", background: "#f8fafc", minHeight: "100vh" }}>

        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center",
          justifyContent: "space-between", marginBottom: "20px",
          flexWrap: "wrap", gap: "12px",
        }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a",
                         margin: "0 0 4px", letterSpacing: "-0.2px" }}>
              Timesheet
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: "#94a3b8" }}>
                {fmtWeek(weekStart)}
              </span>
              <StatusBadge status={tsData.status} />
            </div>
          </div>

          {/* Week nav */}
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button type="button" onClick={() => navigate(prevMonday(weekStart))} style={navBtnStyle}>
              &larr;
            </button>
            <button type="button"
              onClick={() => navigate(new Date().toISOString().slice(0, 10))}
              style={{ ...navBtnStyle, padding: "6px 12px", fontSize: "11px" }}
            >
              This week
            </button>
            <button type="button" onClick={() => navigate(nextMonday(weekStart))} style={navBtnStyle}>
              &rarr;
            </button>
          </div>
        </div>

        {/* Flash messages */}
        {error && <div style={errorStyle}>{error}</div>}
        {success && <div style={successStyle}>{success}</div>}

        {/* Main grid card */}
        <div style={{
          background: "white", borderRadius: "14px",
          border: "1.5px solid #e2e8f0", overflow: "hidden",
          marginBottom: "16px",
        }}>
          {/* Grid table */}
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid #f1f5f9" }}>
                  <th style={{ ...thStyle, width: "200px", textAlign: "left",
                                padding: "12px 16px" }}>Project</th>
                  {days.map((d, i) => (
                    <th key={i} style={{
                      ...thStyle,
                      background: d.isWeekend ? "#f8fafc" : "white",
                      minWidth: "72px",
                    }}>
                      <div style={{ fontSize: "11px", fontWeight: 800, color: "#0f172a" }}>
                        {d.label}
                      </div>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 500 }}>
                        {fmtDate(d.date)}
                      </div>
                    </th>
                  ))}
                  <th style={{ ...thStyle, minWidth: "60px" }}>Total</th>
                </tr>
              </thead>
              <tbody>
                {rowProjects.map(project => (
                  <tr key={project.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                    {/* Project label */}
                    <td style={{ padding: "8px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{
                          width: 8, height: 8, borderRadius: "50%",
                          background: project.colour, flexShrink: 0,
                        }} />
                        <div>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a",
                                        lineHeight: 1.2 }}>{project.title}</div>
                          {project.code && (
                            <div style={{ fontSize: "10px", color: "#94a3b8" }}>{project.code}</div>
                          )}
                        </div>
                        {allocatedProjectIds.includes(project.id) && (
                          <span style={{
                            fontSize: "8px", fontWeight: 800,
                            background: "rgba(14,116,144,0.1)", color: "#0e7490",
                            padding: "1px 4px", borderRadius: "3px",
                          }}>ALLOC</span>
                        )}
                      </div>
                    </td>

                    {/* Day cells */}
                    {days.map((d, i) => (
                      <td key={i} style={{
                        padding: "6px",
                        background: d.isWeekend ? "#f8fafc" : "transparent",
                      }}>
                        <HoursCell
                          value={grid[project.id]?.[i] ?? 0}
                          onChange={v => setHours(project.id, i, v)}
                          disabled={isReadOnly}
                        />
                      </td>
                    ))}

                    {/* Row total */}
                    <td style={{ padding: "6px 12px", textAlign: "center" }}>
                      <span style={{
                        fontSize: "12px", fontWeight: 800,
                        color: projectTotal(project.id) > 0 ? "#0e7490" : "#cbd5e1",
                      }}>
                        {projectTotal(project.id) || "--"}
                      </span>
                    </td>
                  </tr>
                ))}

                {/* Add row */}
                {!isReadOnly && (
                  <tr>
                    <td colSpan={9} style={{ padding: "4px 12px" }}>
                      <AddProjectRow
                        projects={projects}
                        usedIds={rowProjects.map(p => p.id)}
                        onAdd={p => setRowProjects(rp => [...rp, p])}
                      />
                    </td>
                  </tr>
                )}

                {/* Day totals row */}
                <tr style={{ borderTop: "1.5px solid #f1f5f9", background: "#f8fafc" }}>
                  <td style={{ padding: "8px 16px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                                   textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      Daily total
                    </span>
                  </td>
                  {days.map((d, i) => (
                    <td key={i} style={{
                      padding: "8px 6px", textAlign: "center",
                      background: d.isWeekend ? "#f1f5f9" : "#f8fafc",
                    }}>
                      <span style={{
                        fontSize: "12px", fontWeight: 800,
                        color: dayTotal(i) > 8 ? "#dc2626" :
                               dayTotal(i) > 0 ? "#0f172a" : "#e2e8f0",
                      }}>
                        {dayTotal(i) || "--"}
                      </span>
                    </td>
                  ))}
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <span style={{
                      fontSize: "13px", fontWeight: 900,
                      color: weekTotal() > 0 ? "#0e7490" : "#e2e8f0",
                    }}>
                      {weekTotal() || "--"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer actions */}
          <div style={{
            padding: "12px 16px", borderTop: "1.5px solid #f1f5f9",
            display: "flex", justifyContent: "space-between",
            alignItems: "center", gap: "10px", flexWrap: "wrap",
            background: "#fafafa",
          }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                Week total: <strong style={{ color: "#0f172a" }}>{weekTotal()}h</strong>
              </span>
              <a href={exportUrl} style={{
                fontSize: "11px", color: "#0e7490", fontWeight: 700,
                textDecoration: "none", padding: "4px 10px",
                border: "1.5px solid rgba(14,116,144,0.3)",
                borderRadius: "6px", background: "rgba(14,116,144,0.05)",
              }}>
                Export CSV
              </a>
            </div>

            <div style={{ display: "flex", gap: "8px" }}>
              {tsData.status === "draft" && (
                <>
                  <button type="button" onClick={handleSave} disabled={saving}
                    style={secondaryBtnStyle(saving)}>
                    {saving ? "Saving..." : "Save draft"}
                  </button>
                  <button type="button" onClick={handleSubmit} disabled={saving || submitting}
                    style={primaryBtnStyle(saving || submitting)}>
                    {submitting ? "Submitting..." : "Submit for approval"}
                  </button>
                </>
              )}
              {tsData.status === "submitted" && (
                <button type="button" onClick={handleRecall} disabled={submitting}
                  style={secondaryBtnStyle(submitting)}>
                  {submitting ? "..." : "Recall to draft"}
                </button>
              )}
              {isAdmin && tsData.id && (
                <a href="/timesheet/review" style={{
                  ...secondaryBtnStyle(false) as any,
                  textDecoration: "none", display: "inline-flex",
                }}>
                  Review team
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Recent weeks */}
        {recentTimesheets.length > 0 && (
          <div style={{
            background: "white", borderRadius: "12px",
            border: "1.5px solid #e2e8f0", padding: "16px",
          }}>
            <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                          textTransform: "uppercase", letterSpacing: "0.06em",
                          marginBottom: "10px" }}>
              Recent weeks
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {recentTimesheets.map(t => (
                <button key={t.id} type="button"
                  onClick={() => navigate(t.weekStart)}
                  style={{
                    padding: "5px 10px", borderRadius: "7px",
                    border: `1.5px solid ${t.weekStart === weekStart ? "#0e7490" : "#e2e8f0"}`,
                    background: t.weekStart === weekStart ? "rgba(14,116,144,0.08)" : "white",
                    cursor: "pointer", fontSize: "11px", fontWeight: 600,
                    color: t.weekStart === weekStart ? "#0e7490" : "#475569",
                    display: "flex", gap: "6px", alignItems: "center",
                  }}>
                  <span>{fmtDate(t.weekStart)}</span>
                  <StatusBadge status={t.status} />
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

/* =============================================================================
   STYLES
============================================================================= */
const thStyle: React.CSSProperties = {
  padding: "10px 6px",
  textAlign: "center",
  fontWeight: 700,
  fontSize: "11px",
  color: "#94a3b8",
  background: "white",
};

const navBtnStyle: React.CSSProperties = {
  padding: "6px 10px", borderRadius: "7px",
  border: "1.5px solid #e2e8f0", background: "white",
  cursor: "pointer", fontSize: "13px", color: "#64748b",
};

const errorStyle: React.CSSProperties = {
  padding: "10px 14px", borderRadius: "8px", marginBottom: "12px",
  background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.2)",
  color: "#dc2626", fontSize: "12px", fontWeight: 600,
};

const successStyle: React.CSSProperties = {
  padding: "10px 14px", borderRadius: "8px", marginBottom: "12px",
  background: "rgba(16,185,129,0.08)", border: "1.5px solid rgba(16,185,129,0.2)",
  color: "#059669", fontSize: "12px", fontWeight: 600,
};

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px", borderRadius: "9px", border: "none",
    background: disabled ? "#e2e8f0" : "#0e7490",
    color: disabled ? "#94a3b8" : "white",
    fontSize: "12px", fontWeight: 800,
    cursor: disabled ? "not-allowed" : "pointer",
    boxShadow: disabled ? "none" : "0 2px 10px rgba(14,116,144,0.25)",
  };
}

function secondaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "9px 18px", borderRadius: "9px",
    border: "1.5px solid #e2e8f0", background: "white",
    color: disabled ? "#94a3b8" : "#475569",
    fontSize: "12px", fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
