"use client";
// FILE: src/app/allocations/_components/AllocateForm.tsx

import { useState, useEffect, useTransition, useCallback } from "react";
import { createAllocation } from "../actions";

/* =========================
   Types
========================= */

export type PersonOption = {
  user_id:               string;
  full_name:              string;
  job_title:              string | null;
  employment_type:        string;
  default_capacity_days: number;
  department:             string | null;
};

export type ProjectOption = {
  id:           string;
  title:        string;
  project_code: string | null;
  colour:       string | null;
  start_date:   string | null;
  finish_date: string | null;
};

type WeekRow = {
  week_start:        string;
  existing_days:     number;
  proposed_days:     number;
  total_days:        number;
  capacity_days:     number;
  utilisation_pct:   number;
  has_conflict:      boolean;
  conflict_severity: "none" | "warning" | "critical";
};

type Alternative = {
  person_id:           string;
  full_name:           string;
  job_title:           string | null;
  employment_type:     string;
  avg_available_days:  number;
  min_available_days:  number;
  avg_utilisation_pct: number;
  can_cover_fully:     boolean;
};

type CheckResult = {
  weeks:        WeekRow[];
  alternatives: Alternative[];
};

/* =========================
   Helpers
========================= */

function utilColour(pct: number) {
  if (pct > 110) return "#7c3aed";
  if (pct > 100) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  return "#10b981";
}

function utilBg(pct: number) {
  if (pct > 110) return "rgba(124,58,237,0.08)";
  if (pct > 100) return "rgba(239,68,68,0.07)";
  if (pct >= 75) return "rgba(245,158,11,0.07)";
  return "rgba(16,185,129,0.06)";
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function weeksInRange(start: string, end: string) {
  if (!start || !end) return 0;
  const s = new Date(start), e = new Date(end);
  return Math.max(0, Math.ceil((e.getTime() - s.getTime()) / (7 * 24 * 60 * 60 * 1000)));
}

const AVATAR_COLOURS = [
  "#00b8db","#3b82f6","#8b5cf6","#ec4899",
  "#f59e0b","#10b981","#ef4444","#f97316",
];
function avatarColour(name: string) {
  return AVATAR_COLOURS[name.charCodeAt(0) % AVATAR_COLOURS.length];
}

/* =========================
   Sub-components
========================= */

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const col = avatarColour(name);
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: col, color: "#fff", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.34, fontWeight: 800,
      fontFamily: "'DM Sans', sans-serif",
    }}>
      {initials(name)}
    </div>
  );
}

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{
      display: "block", fontSize: "12px", fontWeight: 700,
      color: "#475569", letterSpacing: "0.04em",
      textTransform: "uppercase", marginBottom: "6px",
    }}>
      {children}
      {required && <span style={{ color: "#00b8db", marginLeft: 3 }}>*</span>}
    </label>
  );
}

function FieldHint({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: "11.5px", color: "#94a3b8", margin: "5px 0 0", lineHeight: 1.4 }}>
      {children}
    </p>
  );
}

function Select({
  value, onChange, children, disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={{
        width: "100%", padding: "10px 14px", borderRadius: "8px",
        border: "1.5px solid #e2e8f0", background: disabled ? "#f8fafc" : "white",
        fontSize: "14px", fontFamily: "'DM Sans', sans-serif",
        color: value ? "#0f172a" : "#94a3b8", outline: "none",
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "border-color 0.15s",
      }}
      onFocus={e => { if (!disabled) e.target.style.borderColor = "#00b8db"; }}
      onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
    >
      {children}
    </select>
  );
}

/* =========================
   Conflict Preview Table
========================= */

function ConflictTable({ weeks }: { weeks: WeekRow[] }) {
  const conflictCount = weeks.filter(w => w.has_conflict).length;
  const maxUtil = Math.max(...weeks.map(w => w.utilisation_pct));

  return (
    <div style={{
      background: "#f8fafc", borderRadius: "10px",
      border: "1.5px solid #e2e8f0", overflow: "hidden",
    }}>
      {/* Summary strip */}
      <div style={{
        padding: "10px 14px",
        background: conflictCount > 0
          ? "rgba(239,68,68,0.05)"
          : "rgba(16,185,129,0.05)",
        borderBottom: "1px solid #e2e8f0",
        display: "flex", gap: "20px", alignItems: "center",
      }}>
        {[
          { l: "Weeks",       v: weeks.length,    c: "#475569" },
          { l: "Total days",  v: `${weeks.reduce((s, w) => s + w.proposed_days, 0)}d`, c: "#00b8db" },
          { l: "Peak util",   v: `${maxUtil}%`,    c: utilColour(maxUtil) },
          { l: "Conflicts",   v: conflictCount,   c: conflictCount > 0 ? "#ef4444" : "#10b981" },
        ].map(s => (
          <div key={s.l}>
            <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase",
                          letterSpacing: "0.06em", marginBottom: "2px" }}>{s.l}</div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: s.c,
                          fontFamily: "'DM Mono', monospace" }}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Week rows */}
      <div style={{ maxHeight: "200px", overflowY: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#f1f5f9" }}>
              {["Week of", "Existing", "+ New", "Total", "Capacity", "Util %"].map(h => (
                <th key={h} style={{
                  padding: "7px 10px", fontSize: "10px", fontWeight: 700,
                  color: "#64748b", textAlign: h === "Week of" ? "left" : "center",
                  letterSpacing: "0.04em", textTransform: "uppercase",
                  borderBottom: "1px solid #e2e8f0",
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((row, i) => (
              <tr key={row.week_start} style={{
                background: row.has_conflict ? utilBg(row.utilisation_pct) : "transparent",
                borderBottom: i < weeks.length - 1 ? "1px solid #f1f5f9" : "none",
              }}>
                <td style={{ padding: "7px 10px", fontSize: "12px", color: "#334155",
                             fontFamily: "'DM Mono', monospace" }}>
                  {new Date(row.week_start).toLocaleDateString("en-GB", {
                    day: "2-digit", month: "short",
                  })}
                </td>
                {[row.existing_days+"d", row.proposed_days+"d",
                  row.total_days+"d", row.capacity_days+"d"].map((v, j) => (
                  <td key={j} style={{
                    padding: "7px 10px", textAlign: "center",
                    fontSize: "12px", color: "#475569",
                    fontFamily: "'DM Mono', monospace",
                    fontWeight: j === 2 ? 700 : 400,
                  }}>{v}</td>
                ))}
                <td style={{ padding: "7px 10px", textAlign: "center" }}>
                  <span style={{
                    fontSize: "12px", fontWeight: 700,
                    fontFamily: "'DM Mono', monospace",
                    color: utilColour(row.utilisation_pct),
                    background: utilBg(row.utilisation_pct),
                    borderRadius: "5px", padding: "2px 7px",
                  }}>
                    {row.utilisation_pct}%
                    {row.has_conflict && " ⚠"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* =========================
   Alternatives Panel
========================= */

function AlternativesPanel({
  alternatives,
  onSelect,
}: {
  alternatives: Alternative[];
  onSelect: (personId: string) => void;
}) {
  if (!alternatives.length) return null;

  const canCover  = alternatives.filter(a => a.can_cover_fully);
  const partial   = alternatives.filter(a => !a.can_cover_fully);

  return (
    <div style={{
      border: "1.5px solid #bae6f0", borderRadius: "12px",
      background: "#f0fdff", overflow: "hidden",
    }}>
      <div style={{
        padding: "12px 16px", borderBottom: "1px solid #bae6f0",
        display: "flex", alignItems: "center", gap: "8px",
      }}>
        <span style={{ fontSize: "16px" }}>💡</span>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#0e7490" }}>
            Alternative people with capacity
          </div>
          <div style={{ fontSize: "11.5px", color: "#64748b" }}>
            {canCover.length} can cover fully · {partial.length} partial coverage
          </div>
        </div>
      </div>

      <div style={{ padding: "12px 16px", display: "flex", flexDirection: "column", gap: "8px" }}>
        {alternatives.map(alt => (
          <div key={alt.person_id} style={{
            background: "white", border: "1.5px solid",
            borderColor: alt.can_cover_fully ? "#86efac" : "#e2e8f0",
            borderRadius: "10px", padding: "10px 12px",
            display: "flex", alignItems: "center", gap: "10px",
            transition: "all 0.15s",
          }}>
            <Avatar name={alt.full_name} size={32} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {alt.full_name}
              </div>
              <div style={{ fontSize: "11px", color: "#64748b",
                            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {alt.job_title || "—"} ·{" "}
                <span style={{ color: utilColour(alt.avg_utilisation_pct), fontWeight: 600 }}>
                  {alt.avg_utilisation_pct}% avg util
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{
                fontSize: "12px", fontWeight: 700,
                color: alt.can_cover_fully ? "#10b981" : "#f59e0b",
                fontFamily: "'DM Mono', monospace",
              }}>
                {alt.min_available_days}d min free
              </div>
              {alt.can_cover_fully && (
                <div style={{ fontSize: "10px", color: "#10b981", fontWeight: 600 }}>
                  ✓ Can cover fully
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => onSelect(alt.person_id)}
              style={{
                background: alt.can_cover_fully ? "#00b8db" : "white",
                border: `1.5px solid ${alt.can_cover_fully ? "#00b8db" : "#e2e8f0"}`,
                borderRadius: "7px", padding: "6px 12px",
                fontSize: "12px", fontWeight: 700, cursor: "pointer",
                color: alt.can_cover_fully ? "white" : "#475569",
                fontFamily: "'DM Sans', sans-serif",
                transition: "all 0.15s", whiteSpace: "nowrap",
              }}
            >
              Use instead
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* =========================
   Main AllocateForm
========================= */

export default function AllocateForm({
  people,
  projects,
  defaultPersonId   = "",
  defaultProjectId  = "",
  returnTo          = "/allocations",
  organisationId,
}: {
  people:            PersonOption[];
  projects:          ProjectOption[];
  defaultPersonId?: string;
  defaultProjectId?: string;
  returnTo?:         string;
  organisationId:   string;
}) {
  const [personId,      setPersonId]      = useState(defaultPersonId);
  const [projectId,     setProjectId]     = useState(defaultProjectId);
  const [startDate,     setStartDate]     = useState("");
  const [endDate,       setEndDate]       = useState("");
  const [daysPerWeek,   setDaysPerWeek]   = useState(3);
  const [roleOnProject, setRoleOnProject] = useState("");
  const [notes,         setNotes]         = useState("");
  const [allocType,     setAllocType]     = useState<"confirmed"|"soft">("confirmed");

  const [checkResult,   setCheckResult]   = useState<CheckResult | null>(null);
  const [checking,      setChecking]      = useState(false);
  const [isPending,     startTransition]  = useTransition();

  const selectedPerson  = people.find(p => p.user_id === personId);
  const selectedProject = projects.find(p => p.id === projectId);

  // Auto-fill dates from selected project
  useEffect(() => {
    if (selectedProject) {
      if (selectedProject.start_date) setStartDate(selectedProject.start_date);
      if (selectedProject.finish_date) setEndDate(selectedProject.finish_date);
    }
  }, [projectId]);

  // Run capacity check whenever key fields change
  const runCheck = useCallback(async () => {
    if (!personId || !projectId || !startDate || !endDate || daysPerWeek <= 0) {
      setCheckResult(null);
      return;
    }

    setChecking(true);
    try {
      const res = await fetch("/api/capacity/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          person_id:      personId,
          project_id:      projectId,
          start_date:      startDate,
          end_date:        endDate,
          days_per_week:  daysPerWeek,
          organisation_id: organisationId,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setCheckResult(data);
      }
    } catch {
      // fail silently
    } finally {
      setChecking(false);
    }
  }, [personId, projectId, startDate, endDate, daysPerWeek, organisationId]);

  useEffect(() => {
    const t = setTimeout(runCheck, 400); // debounce
    return () => clearTimeout(t);
  }, [runCheck]);

  const conflictCount  = checkResult?.weeks.filter(w => w.has_conflict).length ?? 0;
  const weekCount      = checkResult?.weeks.length ?? weeksInRange(startDate, endDate);
  const totalDays      = daysPerWeek * weekCount;
  const formValid      = !!personId && !!projectId && !!startDate && !!endDate && daysPerWeek > 0;

  const capacity = selectedPerson?.default_capacity_days ?? 5;

  return (
    <form action={createAllocation} style={{ display: "flex", flexDirection: "column", gap: "22px" }}>
      <input type="hidden" name="return_to"        value={returnTo} />
      <input type="hidden" name="allocation_type"  value={allocType} />

      {/* ── Person + Project ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        <div>
          <FieldLabel required>Person</FieldLabel>
          <Select value={personId} onChange={setPersonId}>
            <option value="">Select person…</option>
            {people.map(p => (
              <option key={p.user_id} value={p.user_id}>
                {p.full_name}
                {p.employment_type === "part_time" ? " (PT)" : ""}
                {" — "}{p.default_capacity_days}d/wk
              </option>
            ))}
          </Select>
          <input type="hidden" name="person_id" value={personId} />

          {selectedPerson && (
            <div style={{
              marginTop: "8px", padding: "8px 12px", borderRadius: "8px",
              background: "#f8fafc", border: "1px solid #e2e8f0",
              display: "flex", gap: "10px", alignItems: "center",
            }}>
              <Avatar name={selectedPerson.full_name} size={28} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                  {selectedPerson.full_name}
                </div>
                <div style={{ fontSize: "11px", color: "#64748b" }}>
                  {selectedPerson.job_title} ·{" "}
                  <span style={{
                    fontWeight: 600,
                    color: selectedPerson.employment_type === "part_time" ? "#f59e0b" : "#10b981",
                  }}>
                    {selectedPerson.employment_type === "part_time" ? "Part-time" : "Full-time"}
                  </span>
                  {" · "}{selectedPerson.default_capacity_days}d/wk
                </div>
              </div>
            </div>
          )}
        </div>

        <div>
          <FieldLabel required>Project</FieldLabel>
          <Select value={projectId} onChange={setProjectId}>
            <option value="">Select project…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>
                {p.project_code ? `${p.project_code} — ` : ""}{p.title}
              </option>
            ))}
          </Select>
          <input type="hidden" name="project_id" value={projectId} />

          {selectedProject && (
            <div style={{
              marginTop: "8px", padding: "8px 12px", borderRadius: "8px",
              background: "#f8fafc", border: "1px solid #e2e8f0",
              display: "flex", gap: "10px", alignItems: "center",
            }}>
              <div style={{
                width: 4, height: 32, borderRadius: 2,
                background: selectedProject.colour || "#00b8db", flexShrink: 0,
              }} />
              <div>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a" }}>
                  {selectedProject.title}
                </div>
                <div style={{ fontSize: "11px", color: "#64748b", fontFamily: "'DM Mono', monospace" }}>
                  {selectedProject.project_code || "—"} ·{" "}
                  {selectedProject.start_date || "?"} → {selectedProject.finish_date || "?"}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Dates ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        <div>
          <FieldLabel required>Start date</FieldLabel>
          <input
            type="date"
            name="start_date"
            value={startDate}
            onChange={e => setStartDate(e.target.value)}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", background: "white",
              fontSize: "14px", fontFamily: "'DM Sans', sans-serif",
              color: "#0f172a", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
        <div>
          <FieldLabel required>End date</FieldLabel>
          <input
            type="date"
            name="end_date"
            value={endDate}
            onChange={e => setEndDate(e.target.value)}
            style={{
              width: "100%", padding: "10px 14px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", background: "white",
              fontSize: "14px", fontFamily: "'DM Sans', sans-serif",
              color: "#0f172a", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
      </div>

      {/* ── Days per week ── */}
      <div>
        <FieldLabel required>
          Days per week —{" "}
          <span style={{ color: "#00b8db", fontFamily: "'DM Mono', monospace" }}>
            {daysPerWeek}d
          </span>
          {totalDays > 0 && (
            <span style={{ color: "#94a3b8", fontWeight: 400, marginLeft: "8px" }}>
              ({totalDays} days total over {weekCount} weeks)
            </span>
          )}
        </FieldLabel>

        <div style={{ display: "flex", gap: "6px", alignItems: "center" }}>
          {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].filter(d => d <= capacity).map(d => (
            <button
              key={d}
              type="button"
              onClick={() => setDaysPerWeek(d)}
              style={{
                width: d % 1 === 0 ? "38px" : "30px",
                height: "38px",
                borderRadius: "8px",
                cursor: "pointer",
                fontWeight: 700,
                fontSize: d % 1 === 0 ? "14px" : "10px",
                fontFamily: "'DM Mono', monospace",
                background: daysPerWeek === d ? "#00b8db" : "#f8fafc",
                border: `1.5px solid ${daysPerWeek === d ? "#00b8db" : "#e2e8f0"}`,
                color: daysPerWeek === d ? "white" : "#64748b",
                transition: "all 0.1s",
              }}
            >
              {d % 1 === 0 ? d : `${d}`}
            </button>
          ))}
          <input type="hidden" name="days_per_week" value={daysPerWeek} />

          {selectedPerson && (
            <div style={{ marginLeft: "10px", flex: 1 }}>
              <div style={{ fontSize: "10px", color: "#94a3b8", marginBottom: "4px" }}>
                {Math.round((daysPerWeek / capacity) * 100)}% of capacity
              </div>
              <div style={{ height: "6px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: "4px", transition: "width 0.3s",
                  width: `${Math.min((daysPerWeek / capacity) * 100, 100)}%`,
                  background: utilColour(Math.round((daysPerWeek / capacity) * 100)),
                }} />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Role + Allocation type ── */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "14px" }}>
        <div>
          <FieldLabel>Role on this project</FieldLabel>
          <input
            type="text"
            name="role_on_project"
            value={roleOnProject}
            onChange={e => setRoleOnProject(e.target.value)}
            placeholder="e.g. Lead Designer"
            style={{
              width: "100%", padding: "10px 14px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", background: "white",
              fontSize: "14px", fontFamily: "'DM Sans', sans-serif",
              color: "#0f172a", outline: "none", boxSizing: "border-box",
            }}
          />
        </div>
        <div>
          <FieldLabel>Allocation type</FieldLabel>
          <div style={{ display: "flex", gap: "6px" }}>
            {([
              { v: "confirmed", l: "Confirmed" },
              { v: "soft",      l: "Soft" },
            ] as const).map(opt => (
              <button
                key={opt.v}
                type="button"
                onClick={() => setAllocType(opt.v)}
                style={{
                  flex: 1, padding: "9px 8px", borderRadius: "8px",
                  cursor: "pointer", fontSize: "13px", fontWeight: 600,
                  fontFamily: "'DM Sans', sans-serif", transition: "all 0.15s",
                  background: allocType === opt.v
                    ? (opt.v === "confirmed" ? "#00b8db" : "#f8fafc")
                    : "white",
                  border: `1.5px solid ${allocType === opt.v
                    ? (opt.v === "confirmed" ? "#00b8db" : "#64748b")
                    : "#e2e8f0"}`,
                  color: allocType === opt.v
                    ? (opt.v === "confirmed" ? "white" : "#475569")
                    : "#94a3b8",
                }}
              >
                {opt.v === "confirmed" ? "◼ " : "◻ "}{opt.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Notes ── */}
      <div>
        <FieldLabel>Notes</FieldLabel>
        <textarea
          name="notes"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Sprint focus, specific responsibilities..."
          rows={2}
          style={{
            width: "100%", padding: "10px 14px", borderRadius: "8px",
            border: "1.5px solid #e2e8f0", background: "white",
            fontSize: "14px", fontFamily: "'DM Sans', sans-serif",
            color: "#0f172a", outline: "none", resize: "vertical",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* ── Capacity check preview ── */}
      {(checking || checkResult) && (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{
              fontSize: "11px", fontWeight: 800, color: "#475569",
              letterSpacing: "0.08em", textTransform: "uppercase",
            }}>
              Capacity preview
            </div>
            {checking && <div className="spinner" />}
          </div>

          {checkResult && !checking && (
            <>
              <ConflictTable weeks={checkResult.weeks} />
              {conflictCount > 0 && (
                <div style={{
                  padding: "12px 16px", borderRadius: "10px",
                  background: "rgba(239,68,68,0.05)",
                  border: "1.5px solid rgba(239,68,68,0.2)",
                }}>
                  <div style={{ fontSize: "13px", fontWeight: 700, color: "#dc2626" }}>
                    ⚠ {conflictCount} week{conflictCount > 1 ? "s" : ""} over capacity
                  </div>
                </div>
              )}
              {conflictCount > 0 && checkResult.alternatives.length > 0 && (
                <AlternativesPanel
                  alternatives={checkResult.alternatives}
                  onSelect={id => {
                    setPersonId(id);
                    setCheckResult(null);
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* ── Submit ── */}
      <div style={{
        paddingTop: "16px", borderTop: "1.5px solid #f1f5f9",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: "12px",
      }}>
        <div style={{ fontSize: "12px", color: "#94a3b8" }}>
          {formValid && weekCount > 0
            ? `Will generate ${weekCount} allocation row${weekCount !== 1 ? "s" : ""} → Supabase`
            : "Fill in all required fields"}
        </div>

        <div style={{ display: "flex", gap: "10px" }}>
          <a href={returnTo} style={{ padding: "9px 18px", color: "#64748b", textDecoration: "none" }}>Cancel</a>
          <button
            type="submit"
            disabled={!formValid || isPending}
            style={{
              padding: "9px 24px", borderRadius: "8px", border: "none",
              background: !formValid || isPending ? "#94a3b8" : (conflictCount > 0 ? "#f59e0b" : "#00b8db"),
              color: "white", fontSize: "13px", fontWeight: 700, cursor: "pointer",
            }}
          >
            {isPending ? "Saving..." : conflictCount > 0 ? "Save with conflicts" : "Allocate"}
          </button>
        </div>
      </div>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        .spinner {
          width: 14px; height: 14px; border-radius: 50%;
          border: 2px solid #e2e8f0; border-top-color: #00b8db;
          animation: spin 0.6s linear infinite;
        }
      `}</style>
    </form>
  );
}
