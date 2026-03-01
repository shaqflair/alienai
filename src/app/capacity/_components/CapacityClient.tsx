"use client";
// FILE: src/app/capacity/_components/CapacityClient.tsx

import { useState, useTransition } from "react";
import { upsertExceptionRange, deleteException } from "../actions";

/* =============================================================================
   TYPES
============================================================================= */

export type ExceptionRow = {
  id:             string;
  personId:       string;
  fullName:       string;
  weekStartDate: string;
  availableDays: number;
  reason:         string;
  notes:          string | null;
  defaultCap:     number;
};

export type PersonOption = {
  id:         string;
  fullName:   string;
  department: string | null;
  defaultCap: number;
};

export type WeekCol = {
  key:        string;   // ISO Monday
  label:      string;   // "3 Mar"
  shortLabel: string;   // "W9"
  isToday:    boolean;
  isPast:     boolean;
};

/* =============================================================================
   CONSTANTS
============================================================================= */

const REASON_META: Record<string, { label: string; colour: string; bg: string; emoji: string }> = {
  annual_leave:   { label: "Annual leave",   colour: "#3b82f6", bg: "rgba(59,130,246,0.1)",  emoji: "🏖" },
  public_holiday: { label: "Public holiday", colour: "#8b5cf6", bg: "rgba(139,92,246,0.1)",  emoji: "🎉" },
  training:       { label: "Training",       colour: "#f59e0b", bg: "rgba(245,158,11,0.1)",  emoji: "📚" },
  sick_leave:     { label: "Sick leave",     colour: "#ef4444", bg: "rgba(239,68,68,0.1)",   emoji: "🤒" },
  parental_leave: { label: "Parental leave", colour: "#ec4899", bg: "rgba(236,72,153,0.1)",  emoji: "👶" },
  other:          { label: "Other",          colour: "#64748b", bg: "rgba(100,116,139,0.1)", emoji: "📋" },
};

const AVAILABLE_DAYS_OPTIONS = [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

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

function getMondayOf(dateStr: string): string {
  const d   = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d.toISOString().split("T")[0];
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().split("T")[0];
}

function formatDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-GB", {
    day: "numeric", month: "short",
  });
}

function isoWeekNum(iso: string): number {
  const d = new Date(iso + "T00:00:00");
  const d2 = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = d2.getUTCDay() || 7;
  d2.setUTCDate(d2.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d2.getUTCFullYear(), 0, 1));
  return Math.ceil((((d2.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

function generateWeeks(from: string, to: string): WeekCol[] {
  const today   = new Date().toISOString().split("T")[0];
  const todayMon = getMondayOf(today);
  const cols: WeekCol[] = [];
  let cur = getMondayOf(from);
  const end = to;

  while (cur <= end && cols.length < 52) {
    const nextMon = addDays(cur, 7);
    cols.push({
      key:        cur,
      label:      formatDate(cur),
      shortLabel: `W${isoWeekNum(cur)}`,
      isToday:    cur === todayMon,
      isPast:     cur < todayMon,
    });
    cur = nextMon;
  }
  return cols;
}

/* =============================================================================
   SHARED UI
============================================================================= */

function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: avatarCol(name), color: "#fff", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.34, fontWeight: 800,
    }}>
      {initials(name)}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: "8px",
  border: "1.5px solid #e2e8f0", background: "white",
  fontSize: "13px", color: "#0f172a", outline: "none",
  boxSizing: "border-box", fontFamily: "inherit",
};

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label style={{
      display: "block", fontSize: "11px", fontWeight: 700,
      color: "#475569", textTransform: "uppercase",
      letterSpacing: "0.04em", marginBottom: "5px",
    }}>
      {children}
    </label>
  );
}

/* =============================================================================
   ADD EXCEPTION MODAL
============================================================================= */

function AddExceptionModal({
  people,
  organisationId,
  currentUserId,
  isAdmin,
  defaultPersonId,
  defaultWeek,
  onClose,
}: {
  people:          PersonOption[];
  organisationId:  string;
  currentUserId:   string;
  isAdmin:         boolean;
  defaultPersonId: string;
  defaultWeek:     string;
  onClose:         () => void;
}) {
  const [personId,     setPersonId]     = useState(defaultPersonId);
  const [startDate,    setStartDate]    = useState(defaultWeek);
  const [endDate,      setEndDate]      = useState(defaultWeek);
  const [availDays,    setAvailDays]    = useState(0);
  const [reason,       setReason]       = useState("annual_leave");
  const [notes,        setNotes]        = useState("");
  const [error,        setError]        = useState<string | null>(null);
  const [isPending,    startTransition] = useTransition();

  const person   = people.find(p => p.id === personId);
  const meta     = REASON_META[reason];
  const isRange  = startDate !== endDate;

  // Compute weeks in range
  const weekCount = (() => {
    if (!startDate || !endDate || endDate < startDate) return 0;
    let c = 0, cur = getMondayOf(startDate);
    while (cur <= endDate && c < 52) { c++; cur = addDays(cur, 7); }
    return c;
  })();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("person_id",       personId);
    fd.set("organisation_id", organisationId);
    fd.set("start_date",      startDate);
    fd.set("end_date",        endDate);
    fd.set("available_days",  String(availDays));
    fd.set("reason",          reason);
    fd.set("notes",           notes);

    startTransition(async () => {
      try {
        await upsertExceptionRange(fd);
        onClose();
      } catch (err: any) {
        setError(err.message || "Save failed.");
      }
    });
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(15,23,42,0.55)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: "20px",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "white", borderRadius: "18px",
        border: "1.5px solid #e2e8f0",
        width: "100%", maxWidth: "500px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.14)",
        overflow: "hidden",
        animation: "slideUp 0.2s ease",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid #f1f5f9",
          background: `linear-gradient(135deg, ${meta.bg} 0%, transparent 60%)`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
              {meta.emoji} Log capacity exception
            </div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>
              Overrides default capacity for selected week(s)
            </div>
          </div>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", color: "#94a3b8",
            cursor: "pointer", fontSize: "18px", lineHeight: 1,
          }}>✕</button>
        </div>

        <form onSubmit={handleSubmit} style={{
          padding: "20px 24px 24px",
          display: "flex", flexDirection: "column", gap: "16px",
        }}>
          {/* Person picker */}
          {(isAdmin || people.length > 1) && (
            <div>
              <FieldLabel>Person</FieldLabel>
              <select
                value={personId}
                onChange={e => setPersonId(e.target.value)}
                style={inputStyle}
              >
                {people.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.fullName}{p.id === currentUserId ? " (me)" : ""}
                    {p.department ? ` — ${p.department}` : ""}
                  </option>
                ))}
              </select>
              {person && (
                <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
                  Default capacity: <strong style={{ color: "#00b8db" }}>{person.defaultCap}d/wk</strong>
                </p>
              )}
            </div>
          )}

          {/* Reason */}
          <div>
            <FieldLabel>Reason</FieldLabel>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {Object.entries(REASON_META).map(([key, m]) => (
                <button key={key} type="button" onClick={() => setReason(key)} style={{
                  padding: "6px 12px", borderRadius: "20px",
                  border: "1.5px solid",
                  borderColor: reason === key ? m.colour : "#e2e8f0",
                  background: reason === key ? m.bg : "white",
                  color: reason === key ? m.colour : "#64748b",
                  fontSize: "12px", fontWeight: 600, cursor: "pointer",
                  transition: "all 0.12s", display: "flex", alignItems: "center", gap: "5px",
                }}>
                  <span>{m.emoji}</span> {m.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date range */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <FieldLabel>From</FieldLabel>
              <input type="date" value={startDate}
                onChange={e => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                style={inputStyle} required />
            </div>
            <div>
              <FieldLabel>To</FieldLabel>
              <input type="date" value={endDate} min={startDate}
                onChange={e => setEndDate(e.target.value)}
                style={inputStyle} required />
            </div>
          </div>

          {weekCount > 0 && (
            <div style={{
              padding: "8px 12px", borderRadius: "8px",
              background: `${meta.bg}`,
              border: `1px solid ${meta.colour}30`,
              fontSize: "12px", color: meta.colour, fontWeight: 600,
            }}>
              {weekCount} week{weekCount !== 1 ? "s" : ""}
              {isRange ? ` (${formatDate(startDate)} → ${formatDate(endDate)})` : ` (${formatDate(startDate)})`}
            </div>
          )}

          {/* Available days */}
          <div>
            <FieldLabel>
              Available days that week —{" "}
              <span style={{ color: meta.colour, fontFamily: "monospace" }}>
                {availDays}d
              </span>
            </FieldLabel>
            <div style={{ display: "flex", gap: "5px", flexWrap: "wrap" }}>
              {AVAILABLE_DAYS_OPTIONS.filter(d => !person || d <= person.defaultCap + 0.1).map(d => (
                <button key={d} type="button" onClick={() => setAvailDays(d)} style={{
                  minWidth: "40px", height: "36px", borderRadius: "8px",
                  border: "1.5px solid",
                  borderColor: availDays === d ? meta.colour : "#e2e8f0",
                  background: availDays === d ? meta.bg : "white",
                  color: availDays === d ? meta.colour : "#475569",
                  fontSize: "12px", fontWeight: 700, cursor: "pointer",
                  fontFamily: "monospace", padding: "0 6px",
                  transition: "all 0.1s",
                }}>
                  {d === 0 ? "Off" : `${d}d`}
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <FieldLabel>Notes (optional)</FieldLabel>
            <input
              type="text" value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. School holidays..."
              style={inputStyle}
            />
          </div>

          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: "8px",
              background: "#fef2f2", border: "1px solid #fecaca",
              color: "#dc2626", fontSize: "12px",
            }}>{error}</div>
          )}

          <div style={{
            display: "flex", gap: "10px", justifyContent: "flex-end",
            paddingTop: "8px", borderTop: "1px solid #f1f5f9",
          }}>
            <button type="button" onClick={onClose} style={{
              padding: "9px 18px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", background: "white",
              color: "#64748b", fontSize: "13px", fontWeight: 600,
              cursor: "pointer",
            }}>Cancel</button>
            <button type="submit" disabled={isPending || weekCount === 0} style={{
              padding: "9px 22px", borderRadius: "8px", border: "none",
              background: isPending || weekCount === 0 ? "#94a3b8" : meta.colour,
              color: "white", fontSize: "13px", fontWeight: 700,
              cursor: isPending || weekCount === 0 ? "not-allowed" : "pointer",
              boxShadow: `0 2px 10px ${meta.colour}40`,
            }}>
              {isPending ? "Saving..." : `Log ${weekCount > 1 ? `${weekCount} weeks` : "exception"}`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* =============================================================================
   CALENDAR GRID VIEW
============================================================================= */

function CalendarGrid({
  exceptions,
  people,
  weeks,
  organisationId,
  onAddClick,
}: {
  exceptions:      ExceptionRow[];
  people:          PersonOption[];
  weeks:           WeekCol[];
  organisationId: string;
  onAddClick:      (personId: string, week: string) => void;
}) {
  const [deleting, startTransition] = useTransition();

  const lookup = new Map<string, Map<string, ExceptionRow>>();
  for (const ex of exceptions) {
    if (!lookup.has(ex.personId)) lookup.set(ex.personId, new Map());
    lookup.get(ex.personId)!.set(ex.weekStartDate, ex);
  }

  function handleDelete(ex: ExceptionRow) {
    if (!confirm(`Remove exception for ${ex.fullName} on ${ex.weekStartDate}?`)) return;
    const fd = new FormData();
    fd.set("exception_id",    ex.id);
    fd.set("person_id",       ex.personId);
    fd.set("organisation_id", organisationId);
    startTransition(async () => {
      await deleteException(fd);
    });
  }

  const CELL_W = 52;

  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: "max-content" }}>

        {/* Week headers */}
        <div style={{ display: "flex", marginBottom: "6px" }}>
          <div style={{ width: "180px", minWidth: "180px", flexShrink: 0 }} />
          {weeks.map(w => (
            <div key={w.key} style={{
              width: CELL_W, minWidth: CELL_W, flexShrink: 0,
              textAlign: "center", padding: "0 1px",
            }}>
              <div style={{
                fontSize: "9px", fontWeight: 700, color: w.isToday ? "#00b8db" : "#94a3b8",
                fontFamily: "monospace", marginBottom: "1px",
              }}>{w.shortLabel}</div>
              <div style={{
                fontSize: "10px", fontWeight: w.isToday ? 800 : 500,
                color: w.isToday ? "#00b8db" : w.isPast ? "#cbd5e1" : "#64748b",
                background: w.isToday ? "rgba(0,184,219,0.08)" : "transparent",
                borderRadius: "4px", padding: "1px 0",
                lineHeight: 1.3,
              }}>
                {w.label.split(" ")[0]}
                <br />
                <span style={{ fontSize: "9px" }}>{w.label.split(" ")[1] || ""}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Person rows */}
        {people.map(person => {
          const personExceptions = lookup.get(person.id) ?? new Map();
          return (
            <div key={person.id} style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
              <div style={{
                width: "180px", minWidth: "180px", flexShrink: 0,
                display: "flex", alignItems: "center", gap: "8px", paddingRight: "10px",
              }}>
                <Avatar name={person.fullName} size={26} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {person.fullName.split(" ")[0]}
                  </div>
                  <div style={{ fontSize: "10px", color: "#94a3b8" }}>{person.defaultCap}d default</div>
                </div>
              </div>

              {weeks.map(w => {
                const ex = personExceptions.get(w.key);
                const meta = ex ? REASON_META[ex.reason] ?? REASON_META.other : null;

                if (ex && meta) {
                  return (
                    <div key={w.key} style={{
                      width: CELL_W - 2, minWidth: CELL_W - 2,
                      height: "40px", borderRadius: "6px", flexShrink: 0,
                      marginRight: "2px", background: meta.bg,
                      border: `1.5px solid ${meta.colour}35`,
                      display: "flex", flexDirection: "column",
                      alignItems: "center", justifyContent: "center",
                      cursor: "pointer", position: "relative",
                    }} onClick={() => handleDelete(ex)}>
                      <span style={{ fontSize: "12px" }}>{meta.emoji}</span>
                      <span style={{ fontSize: "9px", fontWeight: 700, color: meta.colour, fontFamily: "monospace" }}>
                        {ex.availableDays === 0 ? "Off" : `${ex.availableDays}d`}
                      </span>
                    </div>
                  );
                }

                return (
                  <div key={w.key} style={{
                    width: CELL_W - 2, minWidth: CELL_W - 2,
                    height: "40px", borderRadius: "6px", flexShrink: 0,
                    marginRight: "2px",
                    background: w.isToday ? "rgba(0,184,219,0.04)" : "transparent",
                    border: `1px solid ${w.isToday ? "rgba(0,184,219,0.15)" : "#f1f5f9"}`,
                    cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                  }} onClick={() => onAddClick(person.id, w.key)}>
                    <span style={{ fontSize: "14px", color: "#e2e8f0", opacity: 0.5 }}>+</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN
============================================================================= */

export default function CapacityClient({
  exceptions,
  people,
  organisationId,
  currentUserId,
  isAdmin,
  dateFrom,
  dateTo,
}: {
  exceptions:      ExceptionRow[];
  people:          PersonOption[];
  organisationId: string;
  currentUserId:  string;
  isAdmin:         boolean;
  dateFrom:        string;
  dateTo:          string;
}) {
  const [view, setView] = useState<"calendar" | "list">("calendar");
  const [showModal, setShowModal] = useState(false);
  const [modalPerson, setModalPerson] = useState(currentUserId);
  const [modalWeek, setModalWeek] = useState(() => getMondayOf(new Date().toISOString().split("T")[0]));

  function openAdd(personId: string, week: string) {
    setModalPerson(personId);
    setModalWeek(week);
    setShowModal(true);
  }

  return (
    <div style={{ padding: "32px", background: "#f8fafc", minHeight: "100vh", fontFamily: "sans-serif" }}>
      <div style={{ maxWidth: "1200px", margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 800 }}>Leave & Capacity</h1>
          <button onClick={() => setShowModal(true)} style={{ background: "#00b8db", color: "white", padding: "10px 20px", borderRadius: "8px", border: "none", fontWeight: 700, cursor: "pointer" }}>
            + Log Exception
          </button>
        </div>

        <CalendarGrid 
          exceptions={exceptions} 
          people={people} 
          weeks={generateWeeks(dateFrom, dateTo)} 
          organisationId={organisationId}
          onAddClick={openAdd}
        />

        {showModal && (
          <AddExceptionModal 
            people={people}
            organisationId={organisationId}
            currentUserId={currentUserId}
            isAdmin={isAdmin}
            defaultPersonId={modalPerson}
            defaultWeek={modalWeek}
            onClose={() => setShowModal(false)}
          />
        )}
      </div>
    </div>
  );
}
