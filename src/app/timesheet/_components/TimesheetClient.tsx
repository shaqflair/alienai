"use client";
// FILE: src/app/timesheet/_components/TimesheetClient.tsx

import { useState, useTransition } from "react";
import type { TimesheetProject, TimesheetEntry, TimesheetData } from "../page";
import {
  saveTimesheetEntriesAction,
  submitTimesheetAction,
  recallTimesheetAction,
  reworkTimesheetAction,
} from "../actions";

/* =============================================================================
   CONSTANTS
============================================================================= */
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export const NON_PROJECT_CATEGORIES: {
  id: string; label: string; colour: string; icon: string;
}[] = [
  { id: "annual_leave",   label: "Annual Leave",   colour: "#3b82f6", icon: "🏖️" },
  { id: "public_holiday", label: "Public Holiday",  colour: "#8b5cf6", icon: "🎉" },
  { id: "sick_leave",     label: "Sick Leave",      colour: "#f59e0b", icon: "🤒" },
  { id: "training",       label: "Training",        colour: "#10b981", icon: "📚" },
  { id: "other_admin",    label: "Other / Admin",   colour: "#64748b", icon: "📋" },
];

const STATUS_META: Record<string, {
  label: string; colour: string; bg: string; border: string; icon: string;
}> = {
  draft:     { label: "Draft",              colour: "#64748b", bg: "#f1f5f9",              border: "#e2e8f0",              icon: "✏️"  },
  submitted: { label: "Pending Approval",   colour: "#d97706", bg: "rgba(245,158,11,0.1)", border: "rgba(245,158,11,0.3)", icon: "⏳"  },
  approved:  { label: "Approved",           colour: "#059669", bg: "rgba(16,185,129,0.1)", border: "rgba(16,185,129,0.3)", icon: "✅"  },
  rejected:  { label: "Rejected — Rework",  colour: "#dc2626", bg: "rgba(239,68,68,0.1)",  border: "rgba(239,68,68,0.3)",  icon: "❌"  },
};

/* =============================================================================
   HELPERS
============================================================================= */
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
  return `${fmtDate(iso)} – ${fmtDate(addDays(iso, 6))}`;
}

function prevMonday(d: string) { return addDays(d, -7); }
function nextMonday(d: string) { return addDays(d, 7);  }

/* =============================================================================
   GRID STATE
============================================================================= */
type GridState = Record<string, Record<number, number>>;

function buildInitialGrid(entries: TimesheetEntry[], weekStart: string): GridState {
  const grid: GridState = {};
  for (const e of entries) {
    const rowKey = e.projectId ?? e.nonProjectCategory ?? null;
    if (!rowKey) continue;
    const dayIdx = Math.round(
      (new Date(e.workDate).getTime() - new Date(weekStart).getTime()) / 86400000
    );
    if (dayIdx < 0 || dayIdx > 6) continue;
    if (!grid[rowKey]) grid[rowKey] = {};
    grid[rowKey][dayIdx] = e.hours;
  }
  return grid;
}

function gridToFormData(
  grid: GridState,
  projectRows: TimesheetProject[],
  categoryRows: string[],
  timesheetId: string,
  weekStart: string
): FormData {
  const fd = new FormData();
  fd.set("timesheet_id", timesheetId);
  const allRowKeys = [
    ...projectRows.map(p => p.id),
    ...categoryRows,
  ];
  for (const rowKey of allRowKeys) {
    const days = grid[rowKey] ?? {};
    for (const [dayIdx, hours] of Object.entries(days)) {
      const date = addDays(weekStart, Number(dayIdx));
      fd.set(`entry_${rowKey}_${date}`, String(hours));
    }
  }
  return fd;
}

/* =============================================================================
   STATUS BADGE
============================================================================= */
function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span style={{
      fontSize: "10px", fontWeight: 800, padding: "3px 8px",
      borderRadius: "5px", background: meta.bg, color: meta.colour,
      border: `1px solid ${meta.border}`, whiteSpace: "nowrap",
    }}>
      {meta.icon} {meta.label}
    </span>
  );
}

/* =============================================================================
   STATUS BANNER
============================================================================= */
function StatusBanner({
  status, reviewerNote, onRework, reworking,
}: {
  status: string; reviewerNote: string | null; onRework: () => void; reworking: boolean;
}) {
  if (status === "draft") return null;
  const meta = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <div style={{
      padding: "14px 18px", borderRadius: "12px", marginBottom: "16px",
      background: meta.bg, border: `1.5px solid ${meta.border}`,
      display: "flex", alignItems: "flex-start",
      justifyContent: "space-between", gap: "12px", flexWrap: "wrap",
    }}>
      <div>
        <div style={{ fontSize: "14px", fontWeight: 800, color: meta.colour, marginBottom: "4px" }}>
          {meta.icon} {meta.label}
        </div>
        {status === "submitted" && (
          <div style={{ fontSize: "12px", color: "#64748b" }}>
            Awaiting approval from your line manager. You can recall and edit until it's reviewed.
          </div>
        )}
        {status === "approved" && (
          <div style={{ fontSize: "12px", color: "#059669" }}>
            This timesheet has been approved. No further changes can be made.
          </div>
        )}
        {status === "rejected" && (
          <div style={{ fontSize: "12px", color: "#dc2626" }}>
            {reviewerNote
              ? <><strong>Reason:</strong> {reviewerNote}</>
              : "Your timesheet was rejected. Please rework and resubmit."}
          </div>
        )}
      </div>
      {status === "rejected" && (
        <button type="button" onClick={onRework} disabled={reworking} style={{
          padding: "8px 16px", borderRadius: "8px", border: "none",
          background: "#dc2626", color: "white",
          fontSize: "12px", fontWeight: 800, cursor: reworking ? "not-allowed" : "pointer",
          whiteSpace: "nowrap", opacity: reworking ? 0.7 : 1,
        }}>
          {reworking ? "Opening..." : "✏️ Rework & resubmit"}
        </button>
      )}
    </div>
  );
}

/* =============================================================================
   LOCKED BANNER
============================================================================= */
function LockedBanner({ cutoffWeeks }: { cutoffWeeks: number }) {
  return (
    <div style={{
      padding: "14px 18px", borderRadius: "12px", marginBottom: "16px",
      background: "rgba(100,116,139,0.08)", border: "1.5px solid #e2e8f0",
      display: "flex", alignItems: "center", gap: "12px",
    }}>
      <span style={{ fontSize: "20px" }}>🔒</span>
      <div>
        <div style={{ fontSize: "13px", fontWeight: 800, color: "#475569", marginBottom: "2px" }}>
          This week is locked
        </div>
        <div style={{ fontSize: "12px", color: "#94a3b8" }}>
          Timesheets can only be submitted within {cutoffWeeks} weeks. Contact your manager to unlock.
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   HOURS CELL
============================================================================= */
function HoursCell({ value, onChange, disabled, isCategoryRow }: {
  value: number; onChange: (v: number) => void; disabled: boolean; isCategoryRow?: boolean;
}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="number" min={0} max={24} step={0.5}
      value={value === 0 && !focused ? "" : value}
      placeholder="0"
      disabled={disabled}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(Math.max(0, Math.min(24, Number(e.target.value) || 0)))}
      style={{
        width: "100%", boxSizing: "border-box",
        padding: "6px 4px", textAlign: "center",
        border: "1.5px solid",
        borderColor: focused ? "#0e7490"
          : value > 0 ? (isCategoryRow ? "#c4b5fd" : "#bae6fd")
          : "#f1f5f9",
        borderRadius: "6px",
        background: value > 8 ? "rgba(239,68,68,0.06)"
          : value > 0 ? (isCategoryRow ? "rgba(139,92,246,0.05)" : "rgba(14,116,144,0.05)")
          : "white",
        fontSize: "12px", fontWeight: value > 0 ? 700 : 400,
        color: value > 8 ? "#dc2626" : "#0f172a",
        outline: "none", appearance: "textfield",
        MozAppearance: "textfield",
        cursor: disabled ? "not-allowed" : "text",
        opacity: disabled ? 0.6 : 1,
      } as React.CSSProperties}
    />
  );
}

/* =============================================================================
   ADD ROW SELECTORS
============================================================================= */
function AddProjectRow({ projects, usedIds, onAdd }: {
  projects: TimesheetProject[]; usedIds: string[]; onAdd: (p: TimesheetProject) => void;
}) {
  const available = projects.filter(p => !usedIds.includes(p.id));
  if (available.length === 0) return null;
  return (
    <select
      onChange={e => {
        const p = projects.find(p => p.id === e.target.value);
        if (p) { onAdd(p); (e.target as HTMLSelectElement).value = ""; }
      }}
      style={addRowSelectStyle}
    >
      <option value="">+ Add project row...</option>
      {available.map(p => (
        <option key={p.id} value={p.id}>{p.title}{p.code ? ` (${p.code})` : ""}</option>
      ))}
    </select>
  );
}

function AddCategoryRow({ usedCategories, onAdd }: {
  usedCategories: string[]; onAdd: (id: string) => void;
}) {
  const available = NON_PROJECT_CATEGORIES.filter(c => !usedCategories.includes(c.id));
  if (available.length === 0) return null;
  return (
    <select
      onChange={e => {
        if (e.target.value) { onAdd(e.target.value); (e.target as HTMLSelectElement).value = ""; }
      }}
      style={addRowSelectStyle}
    >
      <option value="">+ Add leave / time off row...</option>
      {available.map(c => (
        <option key={c.id} value={c.id}>{c.icon} {c.label}</option>
      ))}
    </select>
  );
}

/* =============================================================================
   EMPTY STATE — shown when no project rows and no saved entries
============================================================================= */
function NoProjectsHint({ hasProjects }: { hasProjects: boolean }) {
  if (hasProjects) return null;
  return (
    <tr>
      <td colSpan={9} style={{ padding: "24px 16px" }}>
        <div style={{
          display: "flex", alignItems: "center", gap: "12px",
          padding: "14px 18px", borderRadius: "10px",
          background: "rgba(14,116,144,0.04)",
          border: "1.5px dashed rgba(14,116,144,0.2)",
        }}>
          <span style={{ fontSize: "20px" }}>📋</span>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 700, color: "#0e7490", marginBottom: "3px" }}>
              No projects allocated for this week
            </div>
            <div style={{ fontSize: "12px", color: "#64748b" }}>
              You don't have any active allocations covering this week.
              Use the <strong>"+ Add project row"</strong> dropdown below to manually add a project,
              or ask your manager to allocate you to a project via the{" "}
              <a href="/allocations/new" style={{ color: "#0e7490", fontWeight: 700 }}>
                Allocate resource
              </a>{" "}
              page.
            </div>
          </div>
        </div>
      </td>
    </tr>
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
  isLocked,
  cutoffWeeks,
  organisationId,
  userId,
  userName,
}: {
  weekStart:           string;
  projects:            TimesheetProject[];
  allocatedProjectIds: string[];
  timesheetData:       TimesheetData;
  recentTimesheets:    { id: string | null; weekStart: string; status: string }[];
  isAdmin:             boolean;
  isLocked:            boolean;
  cutoffWeeks:         number;
  organisationId:      string;
  userId:              string;
  userName:            string;
}) {
  const [weekStart,     setWeekStart]    = useState(initialWeekStart);
  const [tsData,        setTsData]       = useState<TimesheetData>(timesheetData);
  const [grid,          setGrid]         = useState<GridState>(() =>
    buildInitialGrid(timesheetData.entries, initialWeekStart)
  );

  // ─── FIX: initialise rowProjects from allocatedProjectIds (this week's allocs)
  // PLUS any projects that already have saved entries for this week.
  // If neither exist, the grid starts empty but projects are available in the
  // "Add project row" dropdown — so the user can always add them manually.
  const [rowProjects, setRowProjects] = useState<TimesheetProject[]>(() => {
    // Projects with saved entries this week
    const entryProjectIds = new Set(
      timesheetData.entries.map(e => e.projectId).filter(Boolean) as string[]
    );

    // Prefer to show: this-week allocations first, then any with saved entries
    const thisWeekProjects = projects.filter(p => allocatedProjectIds.includes(p.id));
    const entryOnlyProjects = projects.filter(
      p => entryProjectIds.has(p.id) && !allocatedProjectIds.includes(p.id)
    );

    return [...thisWeekProjects, ...entryOnlyProjects];
  });

  const [rowCategories, setRowCategories] = useState<string[]>(() =>
    [...new Set(timesheetData.entries.map(e => e.nonProjectCategory).filter(Boolean) as string[])]
  );

  const [error,      setError]     = useState<string | null>(null);
  const [success,    setSuccess]   = useState<string | null>(null);
  const [saving,     startSave]    = useTransition();
  const [submitting, startSubmit]  = useTransition();
  const [reworking,  startRework]  = useTransition();

  const isReadOnly = tsData.status !== "draft" || isLocked;

  const days = Array.from({ length: 7 }, (_, i) => ({
    label: DAYS[i], date: addDays(weekStart, i), isWeekend: i >= 5,
  }));

  function setHours(rowKey: string, dayIdx: number, hours: number) {
    setGrid(g => ({ ...g, [rowKey]: { ...(g[rowKey] ?? {}), [dayIdx]: hours } }));
  }

  function rowTotal(rowKey: string): number {
    return Object.values(grid[rowKey] ?? {}).reduce((a, b) => a + b, 0);
  }

  function dayTotal(dayIdx: number): number {
    const projTotal = rowProjects.reduce((s, p) => s + (grid[p.id]?.[dayIdx] ?? 0), 0);
    const catTotal  = rowCategories.reduce((s, c) => s + (grid[c]?.[dayIdx] ?? 0), 0);
    return projTotal + catTotal;
  }

  function weekTotal(): number {
    const projTotal = rowProjects.reduce((s, p) => s + rowTotal(p.id), 0);
    const catTotal  = rowCategories.reduce((s, c) => s + rowTotal(c), 0);
    return projTotal + catTotal;
  }

  function navigate(newWeek: string) {
    const url = new URL(window.location.href);
    url.searchParams.set("week", newWeek);
    window.location.href = url.toString();
  }

  async function ensureTimesheetId(): Promise<string | null> {
    if (tsData.id) return tsData.id;
    try {
      const res = await fetch("/api/timesheet/create", {
        method: "POST",
        body: JSON.stringify({ week_start_date: weekStart }),
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
      });
      const j = await res.json();
      if (!j.ok) throw new Error(j.error);
      setTsData(d => ({ ...d, id: j.timesheetId, status: "draft" }));
      return j.timesheetId;
    } catch (e: any) {
      setError(e?.message ?? "Failed to create timesheet");
      return null;
    }
  }

  async function handleSave() {
    setError(null); setSuccess(null);
    const id = await ensureTimesheetId();
    if (!id) return;
    startSave(async () => {
      try {
        const fd = gridToFormData(grid, rowProjects, rowCategories, id, weekStart);
        const res = await saveTimesheetEntriesAction(fd) as any;
        setSuccess(`Saved ${res.saved} entr${res.saved !== 1 ? "ies" : "y"}`);
      } catch (e: any) { setError(e?.message ?? "Failed to save"); }
    });
  }

  async function handleSubmit() {
    setError(null); setSuccess(null);
    const id = await ensureTimesheetId();
    if (!id) return;
    startSubmit(async () => {
      try {
        const fd = gridToFormData(grid, rowProjects, rowCategories, id, weekStart);
        await saveTimesheetEntriesAction(fd);
        const submitFd = new FormData();
        submitFd.set("timesheet_id", id);
        await submitTimesheetAction(submitFd);
        setTsData(d => ({ ...d, status: "submitted" }));
        setSuccess("✅ Timesheet submitted — your line manager has been notified");
      } catch (e: any) { setError(e?.message ?? "Failed to submit"); }
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
        setSuccess("Timesheet recalled — you can now edit and resubmit");
      } catch (e: any) { setError(e?.message ?? "Failed to recall"); }
    });
  }

  async function handleRework() {
    setError(null); setSuccess(null);
    startRework(async () => {
      try {
        const fd = new FormData();
        fd.set("timesheet_id", tsData.id!);
        await reworkTimesheetAction(fd);
        setTsData(d => ({ ...d, status: "draft", reviewerNote: null }));
        setSuccess("Timesheet opened for rework — make your changes and resubmit");
      } catch (e: any) { setError(e?.message ?? "Failed to open for rework"); }
    });
  }

  const exportUrl  = `/api/timesheet/export?user_id=${userId}&from=${weekStart}&to=${weekStart}`;
  const futureWeek = weekStart > new Date().toISOString().slice(0, 10);

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
        <div style={{ display: "flex", alignItems: "flex-start",
                      justifyContent: "space-between", marginBottom: "20px",
                      flexWrap: "wrap", gap: "12px" }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a",
                         margin: "0 0 6px", letterSpacing: "-0.2px" }}>
              Timesheet
            </h1>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              <span style={{ fontSize: "13px", color: "#94a3b8" }}>{fmtWeek(weekStart)}</span>
              <StatusBadge status={tsData.status} />
              {isLocked && (
                <span style={{
                  fontSize: "10px", fontWeight: 800, padding: "3px 8px",
                  borderRadius: "5px", background: "#f1f5f9", color: "#64748b",
                  border: "1px solid #e2e8f0",
                }}>🔒 Locked</span>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
            <button type="button" onClick={() => navigate(prevMonday(weekStart))} style={navBtnStyle}>&larr;</button>
            <button type="button" onClick={() => navigate(new Date().toISOString().slice(0, 10))} style={{ ...navBtnStyle, padding: "6px 12px", fontSize: "11px" }}>This week</button>
            <button type="button" onClick={() => navigate(nextMonday(weekStart))} style={navBtnStyle}>&rarr;</button>
          </div>
        </div>

        {/* Flash messages */}
        {error   && <div style={errorStyle}>{error}</div>}
        {success && <div style={successStyle}>{success}</div>}

        {isLocked && <LockedBanner cutoffWeeks={cutoffWeeks} />}

        {!isLocked && (
          <StatusBanner
            status={tsData.status}
            reviewerNote={tsData.reviewerNote}
            onRework={handleRework}
            reworking={reworking}
          />
        )}

        {/* Grid card */}
        <div style={{
          background: "white", borderRadius: "14px",
          border: "1.5px solid #e2e8f0", overflow: "hidden", marginBottom: "16px",
        }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: "700px" }}>
              <thead>
                <tr style={{ borderBottom: "1.5px solid #f1f5f9" }}>
                  <th style={{ ...thStyle, width: "210px", textAlign: "left", padding: "12px 16px" }}>
                    Project / Activity
                  </th>
                  {days.map((d, i) => (
                    <th key={i} style={{ ...thStyle, background: d.isWeekend ? "#f8fafc" : "white", minWidth: "72px" }}>
                      <div style={{ fontSize: "11px", fontWeight: 800, color: "#0f172a" }}>{d.label}</div>
                      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 500 }}>{fmtDate(d.date)}</div>
                    </th>
                  ))}
                  <th style={{ ...thStyle, minWidth: "60px" }}>Total</th>
                </tr>
              </thead>
              <tbody>

                {/* Empty state when no project rows at all */}
                <NoProjectsHint hasProjects={rowProjects.length > 0} />

                {/* PROJECT ROWS */}
                {rowProjects.map(project => (
                  <tr key={project.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                    <td style={{ padding: "8px 16px" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%",
                                      background: project.colour, flexShrink: 0 }} />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a",
                                        lineHeight: 1.2, whiteSpace: "nowrap",
                                        overflow: "hidden", textOverflow: "ellipsis" }}>
                            {project.title}
                          </div>
                          {project.code && (
                            <div style={{ fontSize: "10px", color: "#94a3b8" }}>{project.code}</div>
                          )}
                        </div>
                        {allocatedProjectIds.includes(project.id) && (
                          <span style={{ fontSize: "8px", fontWeight: 800,
                                         background: "rgba(14,116,144,0.1)", color: "#0e7490",
                                         padding: "1px 4px", borderRadius: "3px", flexShrink: 0 }}>
                            ALLOC
                          </span>
                        )}
                        {/* Allow removing manually-added rows (not this-week alloc rows) */}
                        {!isReadOnly && !allocatedProjectIds.includes(project.id) && (
                          <button
                            type="button"
                            onClick={() => {
                              setRowProjects(r => r.filter(p => p.id !== project.id));
                              setGrid(g => { const next = { ...g }; delete next[project.id]; return next; });
                            }}
                            style={{ marginLeft: "auto", background: "none", border: "none",
                                     color: "#cbd5e1", cursor: "pointer", fontSize: "14px",
                                     padding: "0", lineHeight: 1 }}
                            title="Remove row"
                          >×</button>
                        )}
                      </div>
                    </td>
                    {days.map((d, i) => (
                      <td key={i} style={{ padding: "6px", background: d.isWeekend ? "#f8fafc" : "transparent" }}>
                        <HoursCell
                          value={grid[project.id]?.[i] ?? 0}
                          onChange={v => setHours(project.id, i, v)}
                          disabled={isReadOnly}
                        />
                      </td>
                    ))}
                    <td style={{ padding: "6px 12px", textAlign: "center" }}>
                      <span style={{ fontSize: "12px", fontWeight: 800,
                                     color: rowTotal(project.id) > 0 ? "#0e7490" : "#cbd5e1" }}>
                        {rowTotal(project.id) || "–"}
                      </span>
                    </td>
                  </tr>
                ))}

                {/* NON-PROJECT CATEGORY ROWS */}
                {rowCategories.map(catId => {
                  const cat = NON_PROJECT_CATEGORIES.find(c => c.id === catId);
                  if (!cat) return null;
                  return (
                    <tr key={catId} style={{ borderBottom: "1px solid #f8fafc", background: "rgba(139,92,246,0.02)" }}>
                      <td style={{ padding: "8px 16px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <div style={{ width: 8, height: 8, borderRadius: "50%", background: cat.colour, flexShrink: 0 }} />
                          <div>
                            <div style={{ fontSize: "12px", fontWeight: 700, color: "#475569" }}>{cat.icon} {cat.label}</div>
                            <div style={{ fontSize: "10px", color: "#94a3b8" }}>Non-project time</div>
                          </div>
                          {!isReadOnly && (
                            <button type="button" onClick={() => {
                              setRowCategories(r => r.filter(c => c !== catId));
                              setGrid(g => { const next = { ...g }; delete next[catId]; return next; });
                            }} style={{ marginLeft: "auto", background: "none", border: "none", color: "#cbd5e1", cursor: "pointer", fontSize: "14px", padding: "0", lineHeight: 1 }} title="Remove row">×</button>
                          )}
                        </div>
                      </td>
                      {days.map((d, i) => (
                        <td key={i} style={{ padding: "6px", background: d.isWeekend ? "#f8fafc" : "transparent" }}>
                          <HoursCell value={grid[catId]?.[i] ?? 0} onChange={v => setHours(catId, i, v)} disabled={isReadOnly} isCategoryRow />
                        </td>
                      ))}
                      <td style={{ padding: "6px 12px", textAlign: "center" }}>
                        <span style={{ fontSize: "12px", fontWeight: 800, color: rowTotal(catId) > 0 ? "#8b5cf6" : "#cbd5e1" }}>
                          {rowTotal(catId) || "–"}
                        </span>
                      </td>
                    </tr>
                  );
                })}

                {/* ADD ROW CONTROLS */}
                {!isReadOnly && (
                  <tr>
                    <td colSpan={9} style={{ padding: "8px 12px" }}>
                      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                        <AddProjectRow
                          projects={projects}
                          usedIds={rowProjects.map(p => p.id)}
                          onAdd={p => setRowProjects(rp => [...rp, p])}
                        />
                        <AddCategoryRow
                          usedCategories={rowCategories}
                          onAdd={id => setRowCategories(c => [...c, id])}
                        />
                      </div>
                    </td>
                  </tr>
                )}

                {/* DAY TOTALS ROW */}
                <tr style={{ borderTop: "1.5px solid #f1f5f9", background: "#f8fafc" }}>
                  <td style={{ padding: "8px 16px" }}>
                    <span style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.05em" }}>Daily total</span>
                  </td>
                  {days.map((d, i) => (
                    <td key={i} style={{ padding: "8px 6px", textAlign: "center", background: d.isWeekend ? "#f1f5f9" : "#f8fafc" }}>
                      <span style={{ fontSize: "12px", fontWeight: 800, color: dayTotal(i) > 8 ? "#dc2626" : dayTotal(i) > 0 ? "#0f172a" : "#e2e8f0" }}>
                        {dayTotal(i) || "–"}
                      </span>
                    </td>
                  ))}
                  <td style={{ padding: "8px 12px", textAlign: "center" }}>
                    <span style={{ fontSize: "13px", fontWeight: 900, color: weekTotal() > 0 ? "#0e7490" : "#e2e8f0" }}>
                      {weekTotal() || "–"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer actions */}
          <div style={{ padding: "12px 16px", borderTop: "1.5px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px", flexWrap: "wrap", background: "#fafafa" }}>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "#94a3b8" }}>
                Week total: <strong style={{ color: "#0f172a" }}>{weekTotal()}h</strong>
              </span>
              <a href={exportUrl} style={{ fontSize: "11px", color: "#0e7490", fontWeight: 700, textDecoration: "none", padding: "4px 10px", border: "1.5px solid rgba(14,116,144,0.3)", borderRadius: "6px", background: "rgba(14,116,144,0.05)" }}>Export CSV</a>
            </div>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {tsData.status === "draft" && !isLocked && !futureWeek && (
                <>
                  <button type="button" onClick={handleSave} disabled={saving} style={secondaryBtnStyle(saving)}>
                    {saving ? "Saving..." : "Save draft"}
                  </button>
                  <button type="button" onClick={handleSubmit} disabled={saving || submitting} style={primaryBtnStyle(saving || submitting)}>
                    {submitting ? "Submitting..." : "Submit for approval"}
                  </button>
                </>
              )}
              {tsData.status === "submitted" && (
                <button type="button" onClick={handleRecall} disabled={submitting} style={secondaryBtnStyle(submitting)}>
                  {submitting ? "..." : "↩ Recall to draft"}
                </button>
              )}
              {isAdmin && tsData.id && (
                <a href="/timesheet/review" style={{ ...secondaryBtnStyle(false) as any, textDecoration: "none", display: "inline-flex" }}>
                  Review team timesheets
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Recent weeks */}
        <div style={{ background: "white", borderRadius: "12px", border: "1.5px solid #e2e8f0", padding: "16px" }}>
          <div style={{ fontSize: "10px", fontWeight: 800, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "10px" }}>Recent weeks</div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {recentTimesheets.map((t, idx) => {
              const isCurrentWeek = t.weekStart === weekStart;
              const withinCutoff  = new Date(t.weekStart).getTime() >= Date.now() - cutoffWeeks * 7 * 86400000;
              return (
                <button key={t.weekStart + idx} type="button" onClick={() => navigate(t.weekStart)} style={{ padding: "5px 10px", borderRadius: "7px", border: `1.5px solid ${isCurrentWeek ? "#0e7490" : "#e2e8f0"}`, background: isCurrentWeek ? "rgba(14,116,144,0.08)" : "white", cursor: "pointer", fontSize: "11px", fontWeight: 600, color: isCurrentWeek ? "#0e7490" : "#475569", display: "flex", gap: "6px", alignItems: "center", opacity: withinCutoff ? 1 : 0.5 }}>
                  <span>{fmtDate(t.weekStart)}</span>
                  {t.status !== "draft" && <StatusBadge status={t.status} />}
                  {!withinCutoff && <span title="Locked" style={{ fontSize: "10px" }}>🔒</span>}
                </button>
              );
            })}
          </div>
          <div style={{ marginTop: "10px", fontSize: "11px", color: "#cbd5e1" }}>
            Timesheets editable up to {cutoffWeeks} weeks back. Older weeks are read-only.
          </div>
        </div>
      </div>
    </>
  );
}

/* =============================================================================
   STYLES
============================================================================= */
const addRowSelectStyle: React.CSSProperties = {
  padding: "6px 10px", borderRadius: "7px",
  border: "1.5px solid #e2e8f0", fontSize: "12px",
  color: "#64748b", background: "white", cursor: "pointer",
  fontFamily: "inherit", outline: "none",
};

const thStyle: React.CSSProperties = {
  padding: "10px 6px", textAlign: "center",
  fontWeight: 700, fontSize: "11px",
  color: "#94a3b8", background: "white",
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