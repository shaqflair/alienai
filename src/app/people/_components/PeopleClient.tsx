"use client";
// FILE: src/app/people/_components/PeopleClient.tsx

import { useState, useTransition } from "react";
import { upsertPerson, togglePersonActive, upsertRateCard, deleteRateCard } from "../actions";

/* =============================================================================
   TYPES
============================================================================= */

export type PersonRow = {
  personId:            string;
  fullName:            string;
  jobTitle:            string | null;
  department:          string | null;
  employmentType:      string;
  defaultCapacityDays: number;
  isActive:            boolean;
  availableFrom:       string | null;
  rateCardId:          string | null;
  rateCardLabel:       string | null;
  ratePerDay:          number | null;
  avgUtilisationPct:   number;
  totalAllocatedDays:  number;
  activeProjectCount:  number;
};

export type RateCard = {
  id:         string;
  label:      string;
  ratePerDay: number;
  currency:   string;
  notes:      string | null;
  isActive:   boolean;
};

/* =============================================================================
   CONSTANTS
============================================================================= */

const DEPARTMENTS = [
  "Design","Engineering","Analytics","Delivery",
  "Product","Marketing","Operations","Finance",
];

const EMPLOYMENT_TYPES = [
  { value: "full_time",   label: "Full-time"   },
  { value: "part_time",   label: "Part-time"   },
  { value: "contractor",  label: "Contractor"  },
];

const CAPACITY_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

/* =============================================================================
   HELPERS
============================================================================= */

function cx(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
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

function utilColour(pct: number) {
  if (pct > 100) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  if (pct > 0)   return "#10b981";
  return "#94a3b8";
}

function empLabel(type: string) {
  return EMPLOYMENT_TYPES.find(e => e.value === type)?.label ?? type;
}

/* =============================================================================
   SHARED UI
============================================================================= */

function Avatar({ name, size = 36 }: { name: string; size?: number }) {
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

function FieldLabel({ children, required }: { children: React.ReactNode; required?: boolean }) {
  return (
    <label style={{
      display: "block", fontSize: "11px", fontWeight: 700,
      color: "#475569", letterSpacing: "0.04em",
      textTransform: "uppercase", marginBottom: "5px",
    }}>
      {children}
      {required && <span style={{ color: "#00b8db", marginLeft: 3 }}>*</span>}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "9px 12px", borderRadius: "8px",
  border: "1.5px solid #e2e8f0", background: "white",
  fontSize: "13px", fontFamily: "'DM Sans', sans-serif",
  color: "#0f172a", outline: "none", boxSizing: "border-box",
  transition: "border-color 0.15s",
};

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      style={inputStyle}
      onFocus={e => { e.target.style.borderColor = "#00b8db"; props.onFocus?.(e); }}
      onBlur={e  => { e.target.style.borderColor = "#e2e8f0"; props.onBlur?.(e);  }}
    />
  );
}

function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={inputStyle}
      onFocus={e => { e.target.style.borderColor = "#00b8db"; }}
      onBlur={e  => { e.target.style.borderColor = "#e2e8f0"; }}
    />
  );
}

/* =============================================================================
   EDIT/ADD PERSON MODAL
============================================================================= */

function PersonModal({
  person,
  rateCards,
  organisationId,
  onClose,
}: {
  person:         PersonRow | null; // null = add new
  rateCards:      RateCard[];
  organisationId: string;
  onClose:        () => void;
}) {
  const isNew = !person;

  const [fullName,      setFullName]      = useState(person?.fullName ?? "");
  const [jobTitle,      setJobTitle]      = useState(person?.jobTitle ?? "");
  const [department,    setDepartment]    = useState(person?.department ?? "");
  const [empType,       setEmpType]       = useState(person?.employmentType ?? "full_time");
  const [capacity,      setCapacity]      = useState(person?.defaultCapacityDays ?? 5);
  const [rateCardId,    setRateCardId]    = useState(person?.rateCardId ?? "");
  const [availableFrom, setAvailableFrom] = useState(person?.availableFrom ?? "");
  const [isActive,      setIsActive]      = useState(person?.isActive ?? true);
  const [error,         setError]         = useState<string | null>(null);
  const [isPending,     startTransition]  = useTransition();

  const selectedRateCard = rateCards.find(r => r.id === rateCardId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const fd = new FormData();
    fd.set("organisation_id",       organisationId);
    if (person?.personId) fd.set("person_id", person.personId);
    fd.set("full_name",             fullName);
    fd.set("job_title",             jobTitle);
    fd.set("department",            department);
    fd.set("employment_type",       empType);
    fd.set("default_capacity_days", String(capacity));
    fd.set("rate_card_id",          rateCardId);
    fd.set("available_from",        availableFrom);
    fd.set("is_active",             String(isActive));

    startTransition(async () => {
      try {
        await upsertPerson(fd);
        onClose();
      } catch (err: any) {
        setError(err.message || "Save failed.");
      }
    });
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(15,23,42,0.6)",
      backdropFilter: "blur(4px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 1000, padding: "20px",
      animation: "fadeIn 0.15s ease",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        background: "white", borderRadius: "18px",
        border: "1.5px solid #e2e8f0",
        width: "100%", maxWidth: "560px",
        boxShadow: "0 24px 64px rgba(0,0,0,0.16)",
        animation: "slideUp 0.2s ease",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          padding: "20px 24px 16px",
          borderBottom: "1px solid #f1f5f9",
          background: "linear-gradient(135deg, rgba(0,184,219,0.04) 0%, transparent 60%)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {person && <Avatar name={person.fullName} size={36} />}
            <div>
              <div style={{ fontSize: "16px", fontWeight: 800, color: "#0f172a" }}>
                {isNew ? "Add person" : `Edit ${person!.fullName.split(" ")[0]}`}
              </div>
              <div style={{ fontSize: "12px", color: "#94a3b8" }}>
                {isNew ? "Set capacity and rate card" : "Update profile and capacity"}
              </div>
            </div>
          </div>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", color: "#94a3b8",
            cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "4px",
          }}>✕</button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={{
          padding: "20px 24px 24px",
          display: "flex", flexDirection: "column", gap: "16px",
          maxHeight: "70vh", overflowY: "auto",
        }}>

          {/* Name + Job title */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <FieldLabel required>Full name</FieldLabel>
              <Input
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Jane Smith"
                required
              />
            </div>
            <div>
              <FieldLabel>Job title</FieldLabel>
              <Input
                value={jobTitle}
                onChange={e => setJobTitle(e.target.value)}
                placeholder="Senior Designer"
              />
            </div>
          </div>

          {/* Department + Employment type */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px" }}>
            <div>
              <FieldLabel>Department</FieldLabel>
              <Select value={department} onChange={e => setDepartment(e.target.value)}>
                <option value="">Select…</option>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </Select>
            </div>
            <div>
              <FieldLabel>Employment type</FieldLabel>
              <Select value={empType} onChange={e => setEmpType(e.target.value)}>
                {EMPLOYMENT_TYPES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </Select>
            </div>
          </div>

          {/* Capacity */}
          <div>
            <FieldLabel required>
              Default capacity —{" "}
              <span style={{ color: "#00b8db", fontFamily: "'DM Mono', monospace" }}>
                {capacity}d/week
              </span>
            </FieldLabel>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {CAPACITY_OPTIONS.map(d => (
                <button
                  key={d} type="button"
                  onClick={() => setCapacity(d)}
                  style={{
                    width: d % 1 === 0 ? "40px" : "36px",
                    height: "36px", borderRadius: "8px",
                    border: "1.5px solid",
                    borderColor: capacity === d ? "#00b8db" : "#e2e8f0",
                    background: capacity === d ? "#00b8db" : "white",
                    color: capacity === d ? "white" : "#475569",
                    fontSize: "12px", fontWeight: 700, cursor: "pointer",
                    fontFamily: "'DM Mono', monospace", transition: "all 0.1s",
                  }}
                >
                  {d % 1 === 0 ? d : d.toFixed(1)}
                </button>
              ))}
            </div>
            <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "5px" }}>
              Used as the baseline in the capacity heatmap. Override per-week with leave/exceptions.
            </p>
          </div>

          {/* Rate card */}
          <div>
            <FieldLabel>Rate card</FieldLabel>
            <Select value={rateCardId} onChange={e => setRateCardId(e.target.value)}>
              <option value="">No rate card</option>
              {rateCards.filter(r => r.isActive).map(r => (
                <option key={r.id} value={r.id}>
                  {r.label} — {r.currency} {r.ratePerDay.toLocaleString()}/day
                </option>
              ))}
            </Select>
            {selectedRateCard && (
              <div style={{
                marginTop: "6px", padding: "8px 12px", borderRadius: "8px",
                background: "rgba(0,184,219,0.06)", border: "1px solid rgba(0,184,219,0.15)",
                display: "flex", justifyContent: "space-between", alignItems: "center",
              }}>
                <span style={{ fontSize: "12px", color: "#0e7490", fontWeight: 600 }}>
                  {selectedRateCard.label}
                </span>
                <span style={{
                  fontSize: "13px", fontWeight: 800, color: "#00b8db",
                  fontFamily: "'DM Mono', monospace",
                }}>
                  {selectedRateCard.currency} {selectedRateCard.ratePerDay.toLocaleString()}/day
                </span>
              </div>
            )}
            {rateCards.length === 0 && (
              <p style={{ fontSize: "11px", color: "#f59e0b", marginTop: "4px" }}>
                No rate cards set up yet. Ask an org admin to create them.
              </p>
            )}
          </div>

          {/* Availability date */}
          <div>
            <FieldLabel>Available from</FieldLabel>
            <Input
              type="date"
              value={availableFrom}
              onChange={e => setAvailableFrom(e.target.value)}
            />
            <p style={{ fontSize: "11px", color: "#94a3b8", marginTop: "4px" }}>
              Leave blank if available immediately.
            </p>
          </div>

          {/* Active toggle */}
          <div style={{
            display: "flex", alignItems: "center", gap: "12px",
            padding: "12px 14px", borderRadius: "10px",
            background: isActive ? "rgba(16,185,129,0.05)" : "rgba(239,68,68,0.05)",
            border: `1.5px solid ${isActive ? "rgba(16,185,129,0.2)" : "rgba(239,68,68,0.2)"}`,
          }}>
            <button
              type="button"
              onClick={() => setIsActive(a => !a)}
              style={{
                width: "44px", height: "24px", borderRadius: "12px",
                background: isActive ? "#10b981" : "#e2e8f0",
                border: "none", cursor: "pointer",
                position: "relative", transition: "background 0.2s", flexShrink: 0,
              }}
            >
              <div style={{
                position: "absolute", top: "3px",
                left: isActive ? "23px" : "3px",
                width: "18px", height: "18px", borderRadius: "50%",
                background: "white",
                boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
                transition: "left 0.2s",
              }} />
            </button>
            <div>
              <div style={{ fontSize: "13px", fontWeight: 600, color: "#0f172a" }}>
                {isActive ? "Active" : "Inactive"}
              </div>
              <div style={{ fontSize: "11px", color: "#94a3b8" }}>
                {isActive
                  ? "Appears in heatmap and allocation flows"
                  : "Hidden from heatmap and allocation picker"}
              </div>
            </div>
          </div>

          {error && (
            <div style={{
              padding: "10px 14px", borderRadius: "8px",
              background: "#fef2f2", border: "1px solid #fecaca",
              color: "#dc2626", fontSize: "12px", fontWeight: 500,
            }}>{error}</div>
          )}

          {/* Actions */}
          <div style={{
            display: "flex", gap: "10px", justifyContent: "flex-end",
            paddingTop: "8px", borderTop: "1px solid #f1f5f9",
          }}>
            <button type="button" onClick={onClose} style={{
              padding: "9px 18px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", background: "white",
              color: "#64748b", fontSize: "13px", fontWeight: 600,
              cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
            }}>Cancel</button>
            <button type="submit" disabled={isPending || !fullName} style={{
              padding: "9px 22px", borderRadius: "8px", border: "none",
              background: isPending || !fullName ? "#94a3b8" : "#00b8db",
              color: "white", fontSize: "13px", fontWeight: 700,
              cursor: isPending || !fullName ? "not-allowed" : "pointer",
              fontFamily: "'DM Sans', sans-serif",
              boxShadow: "0 2px 10px rgba(0,184,219,0.25)",
            }}>
              {isPending ? "Saving…" : isNew ? "Add person" : "Save changes"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* =============================================================================
   RATE CARD MANAGER (slide-in panel)
============================================================================= */

function RateCardPanel({
  rateCards, organisationId, onClose,
}: {
  rateCards:      RateCard[];
  organisationId: string;
  onClose:        () => void;
}) {
  const [adding,   setAdding]   = useState(false);
  const [label,    setLabel]    = useState("");
  const [rate,     setRate]     = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [notes,    setNotes]    = useState("");
  const [error,    setError]    = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData();
    fd.set("organisation_id", organisationId);
    fd.set("label",           label);
    fd.set("rate_per_day",    rate);
    fd.set("currency",        currency);
    fd.set("notes",           notes);

    startTransition(async () => {
      try {
        await upsertRateCard(fd);
        setLabel(""); setRate(""); setNotes("");
        setAdding(false);
      } catch (err: any) {
        setError(err.message);
      }
    });
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this rate card?")) return;
    const fd = new FormData();
    fd.set("rate_card_id",    id);
    fd.set("organisation_id", organisationId);
    startTransition(async () => {
      try { await deleteRateCard(fd); }
      catch (err: any) { setError(err.message); }
    });
  }

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(15,23,42,0.5)",
      backdropFilter: "blur(3px)",
      display: "flex", justifyContent: "flex-end",
      zIndex: 1000,
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: "100%", maxWidth: "400px", height: "100%",
        background: "white", borderLeft: "1.5px solid #e2e8f0",
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.1)",
        animation: "slideRight 0.2s ease",
      }}>
        <div style={{
          padding: "20px 22px 16px",
          borderBottom: "1px solid #f1f5f9",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>Rate cards</div>
            <div style={{ fontSize: "12px", color: "#94a3b8" }}>
              Shared across your organisation
            </div>
          </div>
          <button type="button" onClick={onClose} style={{
            background: "none", border: "none", color: "#94a3b8",
            cursor: "pointer", fontSize: "18px",
          }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "16px 22px" }}>
          {rateCards.length === 0 && !adding && (
            <div style={{ textAlign: "center", color: "#94a3b8", fontSize: "13px", padding: "24px 0" }}>
              No rate cards yet.
            </div>
          )}

          {rateCards.map(rc => (
            <div key={rc.id} style={{
              display: "flex", alignItems: "center", gap: "10px",
              padding: "10px 12px", borderRadius: "9px",
              border: "1.5px solid #e2e8f0", marginBottom: "8px",
              background: rc.isActive ? "white" : "#f8fafc",
              opacity: rc.isActive ? 1 : 0.6,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{rc.label}</div>
                {rc.notes && (
                  <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "1px" }}>{rc.notes}</div>
                )}
              </div>
              <div style={{
                fontSize: "13px", fontWeight: 800, color: "#00b8db",
                fontFamily: "'DM Mono', monospace", whiteSpace: "nowrap",
              }}>
                {rc.currency} {rc.ratePerDay.toLocaleString()}/d
              </div>
              <button type="button" onClick={() => handleDelete(rc.id)} style={{
                background: "none", border: "none", color: "#cbd5e1",
                cursor: "pointer", fontSize: "14px",
              }}>✕</button>
            </div>
          ))}

          {adding ? (
            <form onSubmit={handleAdd} style={{
              background: "#f8fafc", borderRadius: "10px",
              border: "1.5px solid #e2e8f0", padding: "14px",
              display: "flex", flexDirection: "column", gap: "10px",
              marginTop: "8px",
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 80px", gap: "8px" }}>
                <div>
                  <FieldLabel required>Label</FieldLabel>
                  <Input value={label} onChange={e => setLabel(e.target.value)}
                    placeholder="Senior Designer" required />
                </div>
                <div>
                  <FieldLabel>CCY</FieldLabel>
                  <Select value={currency} onChange={e => setCurrency(e.target.value)}>
                    {["GBP","EUR","USD"].map(c => <option key={c} value={c}>{c}</option>)}
                  </Select>
                </div>
              </div>
              <div>
                <FieldLabel required>Rate per day</FieldLabel>
                <Input type="number" min="0" step="50"
                  value={rate} onChange={e => setRate(e.target.value)}
                  placeholder="650" required />
              </div>
              <div>
                <FieldLabel>Notes</FieldLabel>
                <Input value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Optional description" />
              </div>
              {error && (
                <div style={{ fontSize: "12px", color: "#dc2626" }}>{error}</div>
              )}
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button" onClick={() => setAdding(false)} style={{
                  flex: 1, padding: "8px", borderRadius: "7px",
                  border: "1.5px solid #e2e8f0", background: "white",
                  fontSize: "12px", fontWeight: 600, color: "#64748b", cursor: "pointer",
                  fontFamily: "'DM Sans', sans-serif",
                }}>Cancel</button>
                <button type="submit" disabled={isPending} style={{
                  flex: 1, padding: "8px", borderRadius: "7px",
                  border: "none", background: "#00b8db",
                  fontSize: "12px", fontWeight: 700, color: "white",
                  cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
                }}>
                  {isPending ? "Saving…" : "Add"}
                </button>
              </div>
            </form>
          ) : (
            <button type="button" onClick={() => setAdding(true)} style={{
              width: "100%", marginTop: "8px",
              padding: "9px", borderRadius: "9px",
              border: "1.5px dashed #e2e8f0", background: "white",
              fontSize: "12px", fontWeight: 600, color: "#64748b", cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              + Add rate card
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* =============================================================================
   PERSON CARD (list row)
============================================================================= */

function PersonCard({
  person, organisationId, onEdit,
}: {
  person:         PersonRow;
  organisationId: string;
  onEdit:         (p: PersonRow) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleToggle() {
    const fd = new FormData();
    fd.set("person_id",       person.personId);
    fd.set("organisation_id", organisationId);
    fd.set("is_active",       String(!person.isActive));
    startTransition(async () => { await togglePersonActive(fd); });
  }

  return (
    <div style={{
      background: "white", borderRadius: "12px",
      border: "1.5px solid #e2e8f0",
      padding: "16px 18px",
      display: "flex", alignItems: "center", gap: "14px",
      opacity: person.isActive ? 1 : 0.55,
      transition: "opacity 0.2s, box-shadow 0.15s",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}
      onMouseEnter={e => (e.currentTarget.style.boxShadow = "0 4px 16px rgba(0,0,0,0.08)")}
      onMouseLeave={e => (e.currentTarget.style.boxShadow = "0 1px 4px rgba(0,0,0,0.04)")}
    >
      <Avatar name={person.fullName} size={40} />

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>
            {person.fullName}
          </span>
          {!person.isActive && (
            <span style={{
              fontSize: "10px", color: "#94a3b8",
              background: "#f1f5f9", borderRadius: "4px",
              padding: "1px 6px", fontWeight: 700,
            }}>Inactive</span>
          )}
          {person.employmentType === "part_time" && (
            <span style={{
              fontSize: "10px", color: "#d97706",
              background: "rgba(245,158,11,0.1)", borderRadius: "4px",
              padding: "1px 6px", fontWeight: 700,
            }}>PT</span>
          )}
          {person.employmentType === "contractor" && (
            <span style={{
              fontSize: "10px", color: "#7c3aed",
              background: "rgba(124,58,237,0.08)", borderRadius: "4px",
              padding: "1px 6px", fontWeight: 700,
            }}>Contractor</span>
          )}
        </div>
        <div style={{ fontSize: "12px", color: "#64748b", marginTop: "2px" }}>
          {[person.jobTitle, person.department].filter(Boolean).join(" · ") || "—"}
        </div>
        <div style={{
          display: "flex", gap: "12px", marginTop: "6px",
          fontSize: "11px", color: "#94a3b8",
        }}>
          <span>
            <strong style={{ color: "#00b8db", fontFamily: "'DM Mono', monospace" }}>
              {person.defaultCapacityDays}d
            </strong>
            /wk capacity
          </span>
          {person.activeProjectCount > 0 && (
            <span>
              <strong style={{ color: "#0f172a" }}>{person.activeProjectCount}</strong>
              {" "}project{person.activeProjectCount !== 1 ? "s" : ""}
            </span>
          )}
          {person.totalAllocatedDays > 0 && (
            <span>
              <strong style={{ color: "#0f172a" }}>{person.totalAllocatedDays}d</strong>
              {" "}allocated
            </span>
          )}
          {person.rateCardLabel && (
            <span style={{ color: "#10b981", fontWeight: 600 }}>
              {person.rateCardLabel}
            </span>
          )}
          {person.availableFrom && new Date(person.availableFrom) > new Date() && (
            <span style={{ color: "#f59e0b", fontWeight: 600 }}>
              Available {new Date(person.availableFrom).toLocaleDateString("en-GB", {
                day: "numeric", month: "short",
              })}
            </span>
          )}
        </div>
      </div>

      {/* Utilisation pill */}
      {person.avgUtilisationPct > 0 && (
        <div style={{
          textAlign: "center", flexShrink: 0,
          padding: "6px 10px", borderRadius: "8px",
          background: `${utilColour(person.avgUtilisationPct)}15`,
          border: `1px solid ${utilColour(person.avgUtilisationPct)}30`,
        }}>
          <div style={{
            fontSize: "15px", fontWeight: 800,
            fontFamily: "'DM Mono', monospace",
            color: utilColour(person.avgUtilisationPct),
          }}>
            {person.avgUtilisationPct}%
          </div>
          <div style={{ fontSize: "9px", color: "#94a3b8", textTransform: "uppercase",
                        letterSpacing: "0.05em" }}>util</div>
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: "6px", flexShrink: 0 }}>
        <button type="button" onClick={() => onEdit(person)} style={{
          padding: "7px 14px", borderRadius: "7px",
          border: "1.5px solid #e2e8f0", background: "white",
          color: "#475569", fontSize: "12px", fontWeight: 600,
          cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
          transition: "all 0.15s",
        }}>Edit</button>

        <button type="button" onClick={handleToggle} disabled={isPending} style={{
          padding: "7px 10px", borderRadius: "7px",
          border: "1.5px solid",
          borderColor: person.isActive ? "#fecaca" : "#bbf7d0",
          background: "white",
          color: person.isActive ? "#dc2626" : "#059669",
          fontSize: "11px", fontWeight: 700,
          cursor: isPending ? "not-allowed" : "pointer",
          fontFamily: "'DM Sans', sans-serif",
        }}>
          {isPending ? "…" : person.isActive ? "Deactivate" : "Activate"}
        </button>
      </div>
    </div>
  );
}

/* =============================================================================
   MAIN
============================================================================= */

export default function PeopleClient({
  people,
  rateCards,
  organisationId,
  isAdmin,
}: {
  people:         PersonRow[];
  rateCards:      RateCard[];
  organisationId: string;
  isAdmin:        boolean;
}) {
  const [editPerson,    setEditPerson]    = useState<PersonRow | null | "new">(null);
  const [showRateCards, setShowRateCards] = useState(false);
  const [search,        setSearch]        = useState("");
  const [deptFilter,    setDeptFilter]    = useState("");
  const [showInactive,  setShowInactive]  = useState(false);

  const departments = Array.from(
    new Set(people.map(p => p.department).filter(Boolean))
  ).sort() as string[];

  const filtered = people.filter(p => {
    if (!showInactive && !p.isActive) return false;
    if (deptFilter && p.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const hay = `${p.fullName} ${p.jobTitle ?? ""} ${p.department ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  const activeCount   = people.filter(p => p.isActive).length;
  const inactiveCount = people.filter(p => !p.isActive).length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');

        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes slideUp {
          from { opacity: 0; transform: translateY(16px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes slideRight {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      <div style={{
        fontFamily: "'DM Sans', sans-serif",
        minHeight: "100vh", background: "#f8fafc",
        padding: "36px 28px", maxWidth: "900px", margin: "0 auto",
      }}>

        {/* ── Header ── */}
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", marginBottom: "24px",
          flexWrap: "wrap", gap: "12px",
        }}>
          <div>
            <h1 style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a",
                         margin: 0, marginBottom: "4px" }}>People</h1>
            <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
              {activeCount} active · {inactiveCount} inactive
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            {isAdmin && (
              <button type="button" onClick={() => setShowRateCards(true)} style={{
                padding: "8px 16px", borderRadius: "8px",
                border: "1.5px solid #e2e8f0", background: "white",
                color: "#475569", fontSize: "13px", fontWeight: 600,
                cursor: "pointer", fontFamily: "'DM Sans', sans-serif",
              }}>
                💷 Rate cards
              </button>
            )}
            <button type="button" onClick={() => setEditPerson("new")} style={{
              padding: "8px 18px", borderRadius: "8px",
              border: "none", background: "#00b8db", color: "white",
              fontSize: "13px", fontWeight: 700, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
              boxShadow: "0 2px 10px rgba(0,184,219,0.3)",
            }}>
              + Add person
            </button>
          </div>
        </div>

        {/* ── Filters ── */}
        <div style={{
          display: "flex", gap: "10px", marginBottom: "20px",
          flexWrap: "wrap", alignItems: "center",
        }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search people…"
            style={{
              ...inputStyle, width: "220px",
              backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'%3E%3Ccircle cx='11' cy='11' r='8'/%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'/%3E%3C/svg%3E\")",
              backgroundRepeat: "no-repeat",
              backgroundPosition: "10px center",
              paddingLeft: "32px",
            }}
          />

          <select
            value={deptFilter}
            onChange={e => setDeptFilter(e.target.value)}
            style={{ ...inputStyle, width: "160px" }}
          >
            <option value="">All departments</option>
            {departments.map(d => <option key={d} value={d}>{d}</option>)}
          </select>

          <label style={{
            display: "flex", alignItems: "center", gap: "6px",
            fontSize: "12px", color: "#64748b", fontWeight: 600, cursor: "pointer",
          }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              style={{ accentColor: "#00b8db" }}
            />
            Show inactive
          </label>

          {(search || deptFilter) && (
            <button type="button" onClick={() => { setSearch(""); setDeptFilter(""); }} style={{
              background: "none", border: "none", color: "#94a3b8",
              fontSize: "12px", fontWeight: 600, cursor: "pointer",
              fontFamily: "'DM Sans', sans-serif",
            }}>
              ✕ Clear
            </button>
          )}

          <span style={{ marginLeft: "auto", fontSize: "12px", color: "#94a3b8" }}>
            {filtered.length} of {people.length}
          </span>
        </div>

        {/* ── List ── */}
        {filtered.length === 0 ? (
          <div style={{
            padding: "48px 0", textAlign: "center",
            color: "#94a3b8", fontSize: "14px",
          }}>
            {people.length === 0
              ? "No people yet. Add your first team member."
              : "No people match the current filters."}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {filtered.map(p => (
              <PersonCard
                key={p.personId}
                person={p}
                organisationId={organisationId}
                onEdit={setEditPerson}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {editPerson !== null && (
        <PersonModal
          person={editPerson === "new" ? null : editPerson}
          rateCards={rateCards}
          organisationId={organisationId}
          onClose={() => { setEditPerson(null); window.location.reload(); }}
        />
      )}

      {showRateCards && (
        <RateCardPanel
          rateCards={rateCards}
          organisationId={organisationId}
          onClose={() => { setShowRateCards(false); window.location.reload(); }}
        />
      )}
    </>
  );
}