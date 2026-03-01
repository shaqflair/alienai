"use client";

import { useState, useMemo, useTransition, useCallback } from "react";
import {
  applyChanges, computeState, computeDiff, autoSuggest, weeksInRange,
  type LivePerson, type LiveProject, type LiveAllocation, type LiveException,
  type Scenario, type ScenarioChange, type PersonDiff, type ComputedState,
  type SuggestedPerson,
} from "../_lib/scenario-engine";
import { saveScenario, deleteScenario } from "../actions";

/* =============================================================================
   HELPERS
============================================================================= */

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLS = ["#00b8db","#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981"];
function avatarCol(name: string) {
  return AVATAR_COLS[name.charCodeAt(0) % AVATAR_COLS.length];
}

function utilColour(pct: number) {
  if (pct > 110) return "#7c3aed";
  if (pct > 100) return "#ef4444";
  if (pct >= 75)  return "#f59e0b";
  if (pct > 0)    return "#10b981";
  return "#94a3b8";
}

function deltaColour(delta: number) {
  if (delta > 20)  return "#ef4444";
  if (delta > 5)   return "#f59e0b";
  if (delta < -5)  return "#10b981";
  return "#94a3b8";
}

function formatDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
  });
}

function getMondayOf(iso: string): string {
  const d   = new Date(iso + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function isoWeekNum(iso: string): number {
  const d2 = new Date(Date.UTC(...(iso.split("-").map(Number) as [number, number, number])));
  const dayNum = d2.getUTCDay() || 7;
  d2.setUTCDate(d2.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
  return Math.ceil((((d2.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

const CHANGE_LABELS: Record<string, string> = {
  add_allocation:  "➕ Add allocation",
  remove_allocation: "➖ Remove allocation",
  swap_allocation: "🔄 Swap person",
  change_capacity: "⚡ Change capacity",
  shift_project:   "📅 Shift project",
  add_project:     "🆕 Add project",
};

const PROJECT_COLOURS = [
  "#00b8db","#3b82f6","#8b5cf6","#10b981","#f59e0b","#ec4899","#ef4444","#f97316",
];

/* =============================================================================
   SHARED UI
============================================================================= */

function Avatar({ name, size = 26 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: avatarCol(name), color: "#fff", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.34, fontWeight: 800,
    }}>{initials(name)}</div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: "7px",
  border: "1.5px solid #e2e8f0", background: "white",
  fontSize: "13px", color: "#0f172a", outline: "none",
  boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "10px", fontWeight: 700,
  color: "#64748b", textTransform: "uppercase",
  letterSpacing: "0.05em", marginBottom: "4px",
};

/* =============================================================================
   CONFLICT SCORE RING
============================================================================= */

function ConflictRing({ score, delta }: { score: number; delta: number }) {
  const r         = 28;
  const circ      = 2 * Math.PI * r;
  const filled    = circ * (score / 100);
  const colour    = score > 60 ? "#ef4444" : score > 30 ? "#f59e0b" : "#10b981";
  const label     = score > 60 ? "High" : score > 30 ? "Med" : "Low";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{ position: "relative", width: 68, height: 68, flexShrink: 0 }}>
        <svg width="68" height="68" viewBox="0 0 68 68">
          <circle cx="34" cy="34" r={r} fill="none" stroke="#f1f5f9" strokeWidth="6" />
          <circle
            cx="34" cy="34" r={r} fill="none"
            stroke={colour} strokeWidth="6"
            strokeDasharray={`${filled} ${circ}`}
            strokeLinecap="round"
            transform="rotate(-90 34 34)"
            style={{ transition: "stroke-dasharray 0.5s ease" }}
          />
        </svg>
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center",
        }}>
          <span style={{
            fontSize: "15px", fontWeight: 900, color: colour,
            fontFamily: "monospace", lineHeight: 1,
          }}>{score}</span>
          <span style={{ fontSize: "8px", color: "#94a3b8", fontWeight: 700 }}>{label}</span>
        </div>
      </div>
      <div>
        <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>
          Conflict score
        </div>
        <div style={{ fontSize: "11px", color: deltaColour(delta), fontWeight: 600, marginTop: "2px" }}>
          {delta > 0 ? `+${delta}` : delta < 0 ? `${delta}` : "No change"} vs live
        </div>
        <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "1px" }}>
          Lower is better · 0–100
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   DIFF HEATMAP (side-by-side)
============================================================================= */

const CELL_W = 44;

function DiffHeatmap({
  diffs, weeks,
}: {
  diffs:  PersonDiff[];
  weeks:  string[];
}) {
  const today    = new Date().toISOString().split("T")[0];
  const todayMon = getMondayOf(today);
  const visWeeks = weeks.slice(0, 20);   // cap at 20 for readability

  if (!diffs.length) {
    return (
      <div style={{ padding: "24px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
        Add changes to see the impact diff.
      </div>
    );
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: "max-content" }}>

        {/* Week headers */}
        <div style={{ display: "flex", marginBottom: "4px" }}>
          <div style={{ width: "160px", minWidth: "160px", flexShrink: 0 }} />
          <div style={{ display: "flex" }}>
            {/* Live label */}
            <div style={{ width: visWeeks.length * CELL_W, textAlign: "center",
                          fontSize: "10px", fontWeight: 800, color: "#64748b",
                          letterSpacing: "0.05em", textTransform: "uppercase",
                          borderRight: "2px dashed #e2e8f0", paddingBottom: "4px" }}>
              Live
            </div>
            {/* Scenario label */}
            <div style={{ width: visWeeks.length * CELL_W, textAlign: "center",
                          fontSize: "10px", fontWeight: 800, color: "#00b8db",
                          letterSpacing: "0.05em", textTransform: "uppercase",
                          paddingBottom: "4px" }}>
              Scenario
            </div>
          </div>
        </div>

        {/* Week sub-headers */}
        <div style={{ display: "flex", marginBottom: "6px" }}>
          <div style={{ width: "160px", minWidth: "160px", flexShrink: 0 }} />
          {/* Live weeks */}
          {visWeeks.map(w => (
            <div key={`live-${w}`} style={{
              width: CELL_W, minWidth: CELL_W, textAlign: "center",
              fontSize: "9px", color: w === todayMon ? "#00b8db" : "#94a3b8",
              fontWeight: w === todayMon ? 800 : 500,
            }}>
              W{isoWeekNum(w)}
            </div>
          ))}
          <div style={{ width: 2, background: "#e2e8f0", margin: "0 4px" }} />
          {/* Scenario weeks */}
          {visWeeks.map(w => (
            <div key={`sc-${w}`} style={{
              width: CELL_W, minWidth: CELL_W, textAlign: "center",
              fontSize: "9px", color: w === todayMon ? "#00b8db" : "#94a3b8",
              fontWeight: w === todayMon ? 800 : 500,
            }}>
              W{isoWeekNum(w)}
            </div>
          ))}
          <div style={{ width: "60px", textAlign: "center", fontSize: "9px", color: "#94a3b8" }}>
            Δ avg
          </div>
        </div>

        {/* Person rows */}
        {diffs.map(diff => (
          <div key={diff.personId} style={{
            display: "flex", alignItems: "center",
            marginBottom: "4px",
          }}>
            {/* Name */}
            <div style={{
              width: "160px", minWidth: "160px", flexShrink: 0,
              display: "flex", alignItems: "center", gap: "6px",
              paddingRight: "8px",
            }}>
              <Avatar name={diff.fullName} size={22} />
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontSize: "11px", fontWeight: 700, color: "#334155",
                  overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {diff.fullName.split(" ")[0]}
                </div>
                {diff.scenarioCap !== diff.capacityDays && (
                  <div style={{ fontSize: "9px", color: "#f59e0b", fontWeight: 700 }}>
                    {diff.capacityDays}d → {diff.scenarioCap}d
                  </div>
                )}
              </div>
            </div>

            {/* Live cells */}
            {visWeeks.map(w => {
              const cell = diff.cells.find(c => c.weekStart === w);
              const pct  = cell?.livePct ?? 0;
              return (
                <Cell key={`live-${w}`} pct={pct} highlight={false} isToday={w === todayMon} />
              );
            })}

            {/* Divider */}
            <div style={{ width: 2, alignSelf: "stretch", background: "#e2e8f0", margin: "0 4px" }} />

            {/* Scenario cells */}
            {visWeeks.map(w => {
              const cell   = diff.cells.find(c => c.weekStart === w);
              const pct    = cell?.scenarioPct ?? 0;
              const changed = cell?.changed ?? false;
              return (
                <Cell key={`sc-${w}`} pct={pct} highlight={changed} delta={cell?.delta} isToday={w === todayMon} />
              );
            })}

            {/* Delta avg */}
            <div style={{
              width: "60px", textAlign: "center", flexShrink: 0,
              fontSize: "12px", fontWeight: 800,
              fontFamily: "monospace",
              color: deltaColour(diff.deltaAvg),
            }}>
              {diff.deltaAvg > 0 ? `+${diff.deltaAvg}` : diff.deltaAvg}%
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div style={{
        display: "flex", gap: "16px", marginTop: "12px",
        paddingTop: "10px", borderTop: "1px solid #f1f5f9",
        flexWrap: "wrap",
      }}>
        {[
          { col: "#10b981", label: "< 75%" },
          { col: "#f59e0b", label: "75–95%" },
          { col: "#ef4444", label: "> 100%" },
          { col: "#7c3aed", label: "> 110%" },
        ].map(l => (
          <div key={l.label} style={{ display: "flex", alignItems: "center", gap: "5px",
                                      fontSize: "11px", color: "#64748b" }}>
            <div style={{ width: 10, height: 10, borderRadius: 2, background: `${l.col}25`,
                          border: `1.5px solid ${l.col}60` }} />
            {l.label}
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", gap: "5px",
                      fontSize: "11px", color: "#64748b" }}>
          <div style={{ width: 10, height: 10, borderRadius: 2,
                        background: "rgba(0,184,219,0.15)",
                        border: "1.5px solid rgba(0,184,219,0.5)" }} />
          Changed in scenario
        </div>
      </div>
    </div>
  );
}

function Cell({ pct, highlight, delta, isToday }: {
  pct: number; highlight: boolean; delta?: number; isToday?: boolean;
}) {
  const col = utilColour(pct);
  return (
    <div style={{
      width: CELL_W - 2, minWidth: CELL_W - 2, height: "32px",
      borderRadius: "5px", flexShrink: 0, marginRight: "2px",
      background: pct === 0
        ? (isToday ? "rgba(0,184,219,0.04)" : "#f8fafc")
        : `${col}18`,
      border: `1.5px solid ${
        highlight
          ? "rgba(0,184,219,0.5)"
          : pct === 0
            ? (isToday ? "rgba(0,184,219,0.15)" : "#f1f5f9")
            : `${col}35`
      }`,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: "10px", fontWeight: 700,
      fontFamily: "monospace",
      color: pct === 0 ? "#e2e8f0" : col,
      position: "relative",
      boxShadow: highlight ? "0 0 0 1px rgba(0,184,219,0.3)" : "none",
      transition: "all 0.2s",
    }}
      title={pct > 0 ? `${pct}%${delta !== undefined ? ` (${delta > 0 ? "+" : ""}${delta}%)` : ""}` : "—"}
    >
      {pct > 0 ? `${pct}%` : ""}
      {highlight && pct > 0 && (
        <div style={{
          position: "absolute", bottom: 0, left: 0,
          height: "2px", width: "100%", borderRadius: "0 0 4px 4px",
          background: "rgba(0,184,219,0.6)",
        }} />
      )}
    </div>
  );
}

/* =============================================================================
   CHANGE FORMS
============================================================================= */

function AddAllocationForm({
  people, projects, onAdd, onCancel,
}: {
  people: LivePerson[]; projects: LiveProject[];
  onAdd: (c: ScenarioChange) => void; onCancel: () => void;
}) {
  const [personId,    setPersonId]    = useState(people[0]?.personId ?? "");
  const [projectId,   setProjectId]   = useState(projects[0]?.projectId ?? "");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [daysPerWeek, setDaysPerWeek] = useState(3);

  return (
    <FormShell title="Add allocation" onCancel={onCancel} onSubmit={() => {
      if (!personId || !projectId || !startDate || !endDate) return;
      onAdd({ type: "add_allocation", personId, projectId, startDate, endDate, daysPerWeek });
    }}>
      <Row label="Person">
        <select value={personId} onChange={e => setPersonId(e.target.value)} style={inputStyle}>
          {people.map(p => <option key={p.personId} value={p.personId}>{p.fullName}</option>)}
        </select>
      </Row>
      <Row label="Project">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
          {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.title}</option>)}
        </select>
      </Row>
      <TwoCol>
        <Row label="Start"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} /></Row>
        <Row label="End"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} /></Row>
      </TwoCol>
      <Row label={`Days/week — ${daysPerWeek}d`}>
        <DaysPicker value={daysPerWeek} onChange={setDaysPerWeek} max={5} />
      </Row>
    </FormShell>
  );
}

function SwapForm({
  people, projects, onAdd, onCancel,
}: {
  people: LivePerson[]; projects: LiveProject[];
  onAdd: (c: ScenarioChange) => void; onCancel: () => void;
}) {
  const [fromPerson, setFromPerson] = useState(people[0]?.personId ?? "");
  const [toPerson,   setToPerson]   = useState(people[1]?.personId ?? "");
  const [projectId,  setProjectId]  = useState(projects[0]?.projectId ?? "");
  const [startDate,  setStartDate]  = useState("");
  const [endDate,    setEndDate]    = useState("");

  return (
    <FormShell title="Swap person" onCancel={onCancel} onSubmit={() => {
      if (!fromPerson || !toPerson || !projectId || !startDate || !endDate) return;
      onAdd({ type: "swap_allocation", fromPersonId: fromPerson, toPersonId: toPerson, projectId, startDate, endDate });
    }}>
      <TwoCol>
        <Row label="From">
          <select value={fromPerson} onChange={e => setFromPerson(e.target.value)} style={inputStyle}>
            {people.map(p => <option key={p.personId} value={p.personId}>{p.fullName}</option>)}
          </select>
        </Row>
        <Row label="To">
          <select value={toPerson} onChange={e => setToPerson(e.target.value)} style={inputStyle}>
            {people.filter(p => p.personId !== fromPerson).map(p =>
              <option key={p.personId} value={p.personId}>{p.fullName}</option>)}
          </select>
        </Row>
      </TwoCol>
      <Row label="Project">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
          {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.title}</option>)}
        </select>
      </Row>
      <TwoCol>
        <Row label="From week"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} /></Row>
        <Row label="To week"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} /></Row>
      </TwoCol>
    </FormShell>
  );
}

function CapacityChangeForm({
  people, onAdd, onCancel,
}: {
  people: LivePerson[];
  onAdd: (c: ScenarioChange) => void; onCancel: () => void;
}) {
  const [personId,   setPersonId]   = useState(people[0]?.personId ?? "");
  const [newCap,     setNewCap]     = useState(3);
  const [startDate,  setStartDate]  = useState("");
  const [endDate,    setEndDate]    = useState("");
  const person = people.find(p => p.personId === personId);

  return (
    <FormShell title="Change capacity" onCancel={onCancel} onSubmit={() => {
      if (!personId || !startDate || !endDate) return;
      onAdd({ type: "change_capacity", personId, newCapacity: newCap, startDate, endDate });
    }}>
      <Row label="Person">
        <select value={personId} onChange={e => { setPersonId(e.target.value); }} style={inputStyle}>
          {people.map(p => <option key={p.personId} value={p.personId}>{p.fullName}</option>)}
        </select>
        {person && <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: 3 }}>Current: {person.capacityDays}d/wk</p>}
      </Row>
      <Row label={`New capacity — ${newCap}d/wk`}>
        <DaysPicker value={newCap} onChange={setNewCap} max={7} />
      </Row>
      <TwoCol>
        <Row label="From"><input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={inputStyle} /></Row>
        <Row label="To"><input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={inputStyle} /></Row>
      </TwoCol>
    </FormShell>
  );
}

function ShiftProjectForm({
  projects, onAdd, onCancel,
}: {
  projects: LiveProject[];
  onAdd: (c: ScenarioChange) => void; onCancel: () => void;
}) {
  const [projectId,  setProjectId]  = useState(projects[0]?.projectId ?? "");
  const [shiftWeeks, setShiftWeeks] = useState(2);
  const [direction,  setDirection]  = useState<1 | -1>(1);

  return (
    <FormShell title="Shift project" onCancel={onCancel} onSubmit={() => {
      if (!projectId) return;
      onAdd({ type: "shift_project", projectId, shiftWeeks: shiftWeeks * direction });
    }}>
      <Row label="Project">
        <select value={projectId} onChange={e => setProjectId(e.target.value)} style={inputStyle}>
          {projects.map(p => <option key={p.projectId} value={p.projectId}>{p.title}</option>)}
        </select>
      </Row>
      <TwoCol>
        <Row label="Direction">
          <div style={{ display: "flex", gap: "6px" }}>
            {([1, -1] as const).map(d => (
              <button key={d} type="button" onClick={() => setDirection(d)} style={{
                flex: 1, padding: "8px", borderRadius: "7px",
                border: "1.5px solid",
                borderColor: direction === d ? "#00b8db" : "#e2e8f0",
                background: direction === d ? "rgba(0,184,219,0.1)" : "white",
                color: direction === d ? "#00b8db" : "#475569",
                fontSize: "12px", fontWeight: 700, cursor: "pointer",
              }}>{d === 1 ? "⏩ Push out" : "⏪ Pull in"}</button>
            ))}
          </div>
        </Row>
        <Row label={`Weeks — ${shiftWeeks}w`}>
          <input type="range" min={1} max={12} value={shiftWeeks}
            onChange={e => setShiftWeeks(Number(e.target.value))}
            style={{ width: "100%", accentColor: "#00b8db" }} />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "10px", color: "#94a3b8" }}>
            <span>1w</span><span>12w</span>
          </div>
        </Row>
      </TwoCol>
    </FormShell>
  );
}

function AddProjectForm({
  people, allocations, exceptions, onAdd, onCancel,
}: {
  people: LivePerson[]; allocations: LiveAllocation[]; exceptions: LiveException[];
  onAdd: (c: ScenarioChange) => void; onCancel: () => void;
}) {
  const [title,       setTitle]      = useState("");
  const [personId,    setPersonId]    = useState(people[0]?.personId ?? "");
  const [startDate,   setStartDate]   = useState("");
  const [endDate,     setEndDate]     = useState("");
  const [daysPerWk,   setDaysPerWk]   = useState(3);
  const [colour,      setColour]      = useState(PROJECT_COLOURS[4]);
  const [suggestions, setSuggestions] = useState<SuggestedPerson[]>([]);

  function runSuggest() {
    if (!startDate || !endDate) return;
    const s = autoSuggest(people, allocations, exceptions, startDate, endDate, daysPerWk);
    setSuggestions(s);
    if (s[0]) setPersonId(s[0].personId);
  }

  return (
    <FormShell title="Add pipeline project" onCancel={onCancel} onSubmit={() => {
      if (!title || !personId || !startDate || !endDate) return;
      onAdd({
        type:         "add_project",
        projectId:    crypto.randomUUID(),
        title, colour, startDate, endDate,
        daysPerWeek: daysPerWk,
        personId,
      });
    }}>
      <TwoCol>
        <Row label="Project title">
          <input type="text" value={title} onChange={e => setTitle(e.target.value)}
            placeholder="New project…" style={inputStyle} />
        </Row>
        <Row label="Colour">
          <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
            {PROJECT_COLOURS.map(c => (
              <button key={c} type="button" onClick={() => setColour(c)} style={{
                width: 22, height: 22, borderRadius: "50%", border: "2.5px solid",
                borderColor: colour === c ? "#0f172a" : "transparent",
                background: c, cursor: "pointer",
              }} />
            ))}
          </div>
        </Row>
      </TwoCol>
      <TwoCol>
        <Row label="Start"><input type="date" value={startDate} onChange={e => { setStartDate(e.target.value); setSuggestions([]); }} style={inputStyle} /></Row>
        <Row label="End"><input type="date" value={endDate} onChange={e => { setEndDate(e.target.value); setSuggestions([]); }} style={inputStyle} /></Row>
      </TwoCol>
      <Row label={`Days/week — ${daysPerWk}d`}>
        <DaysPicker value={daysPerWk} onChange={v => { setDaysPerWk(v); setSuggestions([]); }} max={5} />
      </Row>

      {/* Auto-suggest */}
      {startDate && endDate && (
        <div>
          <button type="button" onClick={runSuggest} style={{
            padding: "6px 14px", borderRadius: "7px",
            border: "1.5px solid #00b8db", background: "rgba(0,184,219,0.08)",
            color: "#00b8db", fontSize: "12px", fontWeight: 700, cursor: "pointer",
            marginBottom: "8px",
          }}>✨ Auto-suggest best fit</button>

          {suggestions.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "5px" }}>
              {suggestions.map(s => (
                <button key={s.personId} type="button" onClick={() => setPersonId(s.personId)} style={{
                  display: "flex", alignItems: "center", gap: "8px",
                  padding: "8px 10px", borderRadius: "8px",
                  border: "1.5px solid",
                  borderColor: personId === s.personId ? "#00b8db" : "#e2e8f0",
                  background: personId === s.personId ? "rgba(0,184,219,0.08)" : "white",
                  cursor: "pointer", textAlign: "left",
                }}>
                  <Avatar name={s.fullName} size={22} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>
                      {s.fullName}
                      {s.canFullyCover && (
                        <span style={{ marginLeft: 6, fontSize: "10px", color: "#10b981",
                                       fontWeight: 700 }}>✓ Full cover</span>
                      )}
                    </div>
                    <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                      {s.avgAvailDays}d/wk available · {s.conflictWeeks} conflict wks
                    </div>
                  </div>
                  <div style={{
                    fontSize: "12px", fontWeight: 800, color: "#00b8db",
                    fontFamily: "monospace",
                  }}>{s.score}</div>
                </button>
              ))}
            </div>
          )}

          {suggestions.length === 0 && (
            <Row label="Assign to">
              <select value={personId} onChange={e => setPersonId(e.target.value)} style={inputStyle}>
                {people.map(p => <option key={p.personId} value={p.personId}>{p.fullName}</option>)}
              </select>
            </Row>
          )}
        </div>
      )}
    </FormShell>
  );
}

/* ── Form shell + helpers ── */

function FormShell({ title, children, onSubmit, onCancel }: {
  title: string; children: React.ReactNode;
  onSubmit: () => void; onCancel: () => void;
}) {
  return (
    <div style={{
      background: "#f8fafc", borderRadius: "10px",
      border: "1.5px solid #e2e8f0", padding: "14px",
      display: "flex", flexDirection: "column", gap: "10px",
    }}>
      <div style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>{title}</div>
      {children}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", paddingTop: "4px" }}>
        <button type="button" onClick={onCancel} style={{
          padding: "7px 14px", borderRadius: "7px",
          border: "1.5px solid #e2e8f0", background: "white",
          color: "#64748b", fontSize: "12px", fontWeight: 600, cursor: "pointer",
        }}>Cancel</button>
        <button type="button" onClick={onSubmit} style={{
          padding: "7px 16px", borderRadius: "7px", border: "none",
          background: "#00b8db", color: "white",
          fontSize: "12px", fontWeight: 700, cursor: "pointer",
        }}>Add change</button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function TwoCol({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
      {children}
    </div>
  );
}

function DaysPicker({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) {
  const opts = Array.from({ length: max * 2 }, (_, i) => (i + 1) * 0.5).filter(v => v <= max);
  return (
    <div style={{ display: "flex", gap: "4px", flexWrap: "wrap" }}>
      {opts.map(d => (
        <button key={d} type="button" onClick={() => onChange(d)} style={{
          minWidth: "34px", height: "32px", borderRadius: "6px",
          border: "1.5px solid",
          borderColor: value === d ? "#00b8db" : "#e2e8f0",
          background: value === d ? "rgba(0,184,219,0.1)" : "white",
          color: value === d ? "#00b8db" : "#475569",
          fontSize: "11px", fontWeight: 700, cursor: "pointer",
          fontFamily: "monospace", padding: "0 4px",
        }}>
          {d % 1 === 0 ? `${d}d` : `${d}d`}
        </button>
      ))}
    </div>
  );
}

/* =============================================================================
   MAIN COMPONENT
============================================================================= */

const ADD_BUTTONS = [
  { type: "add_allocation",  icon: "➕", label: "Add allocation"  },
  { type: "swap_allocation", icon: "🔄", label: "Swap person"     },
  { type: "change_capacity", icon: "⚡", label: "Change capacity" },
  { type: "shift_project",   icon: "📅", label: "Shift project"   },
  { type: "add_project",     icon: "🆕", label: "New project"     },
] as const;

export default function ScenarioSimulator({
  people,
  projects,
  allocations,
  exceptions,
  organisationId,
  savedScenarios,
}: {
  people:          LivePerson[];
  projects:        LiveProject[];
  allocations:      LiveAllocation[];
  exceptions:      LiveException[];
  organisationId:  string;
  savedScenarios:  Scenario[];
}) {
  // ── Scenario state ────────────────────────────────────────────────────────
  const [scenarioId,   setScenarioId]   = useState<string | null>(null);
  const [scenarioName, setScenarioName] = useState("New scenario");
  const [changes,      setChanges]      = useState<ScenarioChange[]>([]);
  const [activeForm,   setActiveForm]   = useState<string | null>(null);
  const [saveMsg,      setSaveMsg]      = useState<string | null>(null);
  const [isPending,    startTransition] = useTransition();

  // Date range for the diff view
  const today  = new Date().toISOString().split("T")[0];
  const [from, setFrom] = useState(getMondayOf(today));
  const [to,   setTo]   = useState(() => {
    const d = new Date(today);
    d.setMonth(d.getMonth() + 3);
    return d.toISOString().split("T")[0];
  });

  const weeks = useMemo(() => weeksInRange(from, to).slice(0, 20), [from, to]);

  // ── Compute states ────────────────────────────────────────────────────────
  const liveState = useMemo(() =>
    computeState(people, projects, allocations, exceptions, weeks, new Map()),
    [people, projects, allocations, exceptions, weeks]
  );

  const { allocations: scAllocs, projects: scProjects, scenarioCap } = useMemo(() =>
    applyChanges(people, projects, allocations, exceptions, changes),
    [people, projects, allocations, exceptions, changes]
  );

  const scenarioState = useMemo(() =>
    computeState(people, scProjects, scAllocs, exceptions, weeks, scenarioCap),
    [people, scProjects, scAllocs, exceptions, weeks, scenarioCap]
  );

  const diffs = useMemo(() =>
    computeDiff(liveState, scenarioState, weeks),
    [liveState, scenarioState, weeks]
  );

  const liveScore      = liveState.conflictScore;
  const scenarioScore = scenarioState.conflictScore;
  const scoreDelta     = scenarioScore - liveScore;

  // ── Save scenario ─────────────────────────────────────────────────────────
  async function handleSave() {
    const fd = new FormData();
    if (scenarioId) fd.set("scenario_id", scenarioId);
    fd.set("organisation_id", organisationId);
    fd.set("name",            scenarioName);
    fd.set("changes_json",    JSON.stringify(changes));

    startTransition(async () => {
      try {
        const result = await saveScenario(fd) as any;
        if (result?.id) setScenarioId(result.id);
        setSaveMsg("Saved ✓");
        setTimeout(() => setSaveMsg(null), 2000);
      } catch (err: any) {
        setSaveMsg(`Error: ${err.message}`);
      }
    });
  }

  // ── Load scenario ─────────────────────────────────────────────────────────
  function loadScenario(sc: Scenario) {
    setScenarioId(sc.id);
    setScenarioName(sc.name);
    setChanges(sc.changes);
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: "24px", height: "calc(100vh - 120px)" }}>
      {/* Sidebar: Controls & Changes */}
      <div style={{ display: "flex", flexDirection: "column", gap: "20px", overflowY: "auto", paddingRight: "10px" }}>
        
        {/* Scenario Select */}
        <div style={{ background: "white", borderRadius: "12px", border: "1.5px solid #e2e8f0", padding: "16px" }}>
          <label style={labelStyle}>Saved Scenarios</label>
          <select 
            style={inputStyle} 
            onChange={(e) => {
              const sc = savedScenarios.find(s => s.id === e.target.value);
              if (sc) loadScenario(sc);
            }}
            value={scenarioId || ""}
          >
            <option value="">— Current Draft —</option>
            {savedScenarios.map(sc => (
              <option key={sc.id} value={sc.id}>{sc.name}</option>
            ))}
          </select>
          
          <div style={{ marginTop: "12px" }}>
            <label style={labelStyle}>Scenario Name</label>
            <input 
              type="text" 
              value={scenarioName} 
              onChange={(e) => setScenarioName(e.target.value)} 
              style={inputStyle} 
            />
          </div>

          <div style={{ display: "flex", gap: "8px", marginTop: "16px" }}>
            <button 
              onClick={handleSave}
              disabled={isPending}
              style={{
                flex: 1, padding: "8px", borderRadius: "8px", border: "none",
                background: "#0f172a", color: "white", fontSize: "12px", fontWeight: 700,
                cursor: "pointer", opacity: isPending ? 0.7 : 1
              }}
            >
              {isPending ? "Saving..." : saveMsg || "Save Scenario"}
            </button>
            <button 
              onClick={() => { setScenarioId(null); setChanges([]); setScenarioName("New scenario"); }}
              style={{
                padding: "8px 12px", borderRadius: "8px", border: "1.5px solid #e2e8f0",
                background: "white", color: "#64748b", fontSize: "12px", fontWeight: 600,
                cursor: "pointer"
              }}
            >
              Reset
            </button>
          </div>
        </div>

        {/* Change Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <label style={labelStyle}>Add Changes</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {ADD_BUTTONS.map(btn => (
              <button
                key={btn.type}
                onClick={() => setActiveForm(btn.type)}
                style={{
                  padding: "10px", borderRadius: "10px", border: "1.5px solid #e2e8f0",
                  background: activeForm === btn.type ? "rgba(0,184,219,0.05)" : "white",
                  borderColor: activeForm === btn.type ? "#00b8db" : "#e2e8f0",
                  color: "#334155", fontSize: "11px", fontWeight: 700, cursor: "pointer",
                  display: "flex", flexDirection: "column", alignItems: "center", gap: "4px",
                  transition: "all 0.15s"
                }}
              >
                <span style={{ fontSize: "16px" }}>{btn.icon}</span>
                {btn.label}
              </button>
            ))}
          </div>
        </div>

        {/* Active Form Area */}
        {activeForm && (
          <div style={{ borderTop: "1px solid #e2e8f0", paddingTop: "8px" }}>
            {activeForm === "add_allocation" && (
              <AddAllocationForm 
                people={people} projects={projects} 
                onAdd={(c) => { setChanges([...changes, c]); setActiveForm(null); }}
                onCancel={() => setActiveForm(null)}
              />
            )}
            {activeForm === "swap_allocation" && (
              <SwapForm 
                people={people} projects={projects}
                onAdd={(c) => { setChanges([...changes, c]); setActiveForm(null); }}
                onCancel={() => setActiveForm(null)}
              />
            )}
            {activeForm === "change_capacity" && (
              <CapacityChangeForm 
                people={people}
                onAdd={(c) => { setChanges([...changes, c]); setActiveForm(null); }}
                onCancel={() => setActiveForm(null)}
              />
            )}
            {activeForm === "shift_project" && (
              <ShiftProjectForm 
                projects={projects}
                onAdd={(c) => { setChanges([...changes, c]); setActiveForm(null); }}
                onCancel={() => setActiveForm(null)}
              />
            )}
            {activeForm === "add_project" && (
              <AddProjectForm 
                people={people} allocations={allocations} exceptions={exceptions}
                onAdd={(c) => { setChanges([...changes, c]); setActiveForm(null); }}
                onCancel={() => setActiveForm(null)}
              />
            )}
          </div>
        )}

        {/* Change List */}
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Applied Changes ({changes.length})</label>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "8px" }}>
            {changes.length === 0 && (
              <div style={{ padding: "20px", textAlign: "center", border: "1.5px dashed #e2e8f0", borderRadius: "10px", color: "#94a3b8", fontSize: "12px" }}>
                No changes yet.
              </div>
            )}
            {changes.map((change, idx) => (
              <div key={idx} style={{ 
                background: "white", padding: "10px", borderRadius: "8px", border: "1.5px solid #f1f5f9",
                display: "flex", alignItems: "center", justifyContent: "space-between"
              }}>
                <div style={{ fontSize: "11px", fontWeight: 700, color: "#475569" }}>
                  {CHANGE_LABELS[change.type]}
                </div>
                <button 
                  onClick={() => setChanges(changes.filter((_, i) => i !== idx))}
                  style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: "14px" }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Main View: Diff Heatmap */}
      <div style={{ display: "flex", flexDirection: "column", gap: "24px", minWidth: 0 }}>
        
        {/* Header: KPIs */}
        <div style={{ 
          background: "white", borderRadius: "16px", border: "1.5px solid #e2e8f0", 
          padding: "20px", display: "flex", alignItems: "center", justifyContent: "space-between" 
        }}>
          <ConflictRing score={scenarioScore} delta={scoreDelta} />
          
          <div style={{ display: "flex", gap: "32px" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Over-alloc weeks</div>
              <div style={{ fontSize: "24px", fontWeight: 900, color: "#0f172a" }}>
                {scenarioState.totalOverAlloc}
                <span style={{ fontSize: "14px", color: scenarioState.totalOverAlloc > liveState.totalOverAlloc ? "#ef4444" : "#10b981", marginLeft: "6px" }}>
                  {scenarioState.totalOverAlloc > liveState.totalOverAlloc ? "↑" : "↓"}
                </span>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "10px", fontWeight: 700, color: "#64748b", textTransform: "uppercase" }}>Date Range</div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "#334155", marginTop: "4px" }}>
                {formatDate(from)} — {formatDate(to)}
              </div>
            </div>
          </div>
        </div>

        {/* The Heatmap */}
        <div style={{ 
          flex: 1, background: "white", borderRadius: "16px", border: "1.5px solid #e2e8f0", 
          padding: "20px", overflow: "hidden", display: "flex", flexDirection: "column"
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
            <h3 style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a", margin: 0 }}>Projected Impact Diff</h3>
            <div style={{ display: "flex", gap: "8px" }}>
               <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
               <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...inputStyle, width: "auto" }} />
            </div>
          </div>
          
          <DiffHeatmap diffs={diffs} weeks={weeks} />
        </div>

      </div>
    </div>
  );
}
