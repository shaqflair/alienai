"use client";
// FILE: src/app/timesheet/review/_components/ReviewClient.tsx

import { useState, useTransition } from "react";
import type { ReviewTimesheetRow, ReviewEntryRow } from "../page";
import { reviewTimesheetAction } from "../../actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "2-digit",
  });
}

function fmtWeek(iso: string): string {
  const end = new Date(iso);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${fmtDate(iso)} \u2013 ${fmtDate(end.toISOString().slice(0, 10))}`;
}

function fmtDay(iso: string): string {
  if (!iso) return "--";
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

const STATUS_META: Record<string, { label: string; colour: string; bg: string }> = {
  draft:     { label: "Draft",     colour: "#64748b", bg: "rgba(100,116,139,0.1)" },
  submitted: { label: "Submitted", colour: "#d97706", bg: "rgba(245,158,11,0.1)"  },
  approved:  { label: "Approved",  colour: "#059669", bg: "rgba(16,185,129,0.1)"  },
  rejected:  { label: "Rejected",  colour: "#dc2626", bg: "rgba(239,68,68,0.1)"   },
};

const NON_PROJECT_LABELS: Record<string, string> = {
  annual_leave:    "Annual Leave",
  sick_leave:      "Sick Leave",
  public_holiday:  "Public Holiday",
  training:        "Training",
  internal:        "Internal / Admin",
  other:           "Other",
};

function Badge({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.draft;
  return (
    <span style={{
      fontSize: "9px", fontWeight: 800, padding: "2px 7px",
      borderRadius: "4px", background: m.bg, color: m.colour,
      textTransform: "uppercase", letterSpacing: "0.05em",
    }}>{m.label}</span>
  );
}

function EntryTable({ entries }: { entries: ReviewEntryRow[] }) {
  if (entries.length === 0) {
    return (
      <p style={{ fontSize: "12px", color: "#94a3b8", fontStyle: "italic", margin: "8px 0" }}>
        No entries recorded this week.
      </p>
    );
  }

  // Group by project/category
  const grouped = new Map<string, { label: string; code: string | null; entries: ReviewEntryRow[] }>();
  for (const e of entries) {
    const key = e.projectId ?? e.nonProjectCategory ?? "other";
    if (!grouped.has(key)) {
      grouped.set(key, {
        label: e.projectTitle ?? NON_PROJECT_LABELS[e.nonProjectCategory ?? ""] ?? e.nonProjectCategory ?? "Other",
        code:  e.projectCode ?? null,
        entries: [],
      });
    }
    grouped.get(key)!.entries.push(e);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "12px" }}>
      {[...grouped.values()].map((group, gi) => {
        const groupTotal = group.entries.reduce((s, e) => s + e.hours, 0);
        return (
          <div key={gi} style={{
            border: "1px solid #e2e8f0", borderRadius: "8px", overflow: "hidden",
          }}>
            {/* Project header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", background: "#f8fafc",
              borderBottom: "1px solid #e2e8f0",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: group.code ? "#0e7490" : "#94a3b8",
                }} />
                <span style={{ fontSize: "12px", fontWeight: 700, color: "#0f172a" }}>
                  {group.label}
                </span>
                {group.code && (
                  <span style={{
                    fontSize: "9px", fontWeight: 700, color: "#0e7490",
                    background: "rgba(14,116,144,0.08)", padding: "1px 6px",
                    borderRadius: "4px", border: "1px solid rgba(14,116,144,0.2)",
                    fontFamily: "monospace",
                  }}>{group.code}</span>
                )}
              </div>
              <span style={{ fontSize: "12px", fontWeight: 800, color: "#0f172a" }}>
                {groupTotal}h
              </span>
            </div>

            {/* Day rows */}
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ padding: "5px 12px", textAlign: "left", fontSize: "9px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f1f5f9" }}>Date</th>
                  <th style={{ padding: "5px 8px",  textAlign: "right", fontSize: "9px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f1f5f9", width: "50px" }}>Hours</th>
                  <th style={{ padding: "5px 12px", textAlign: "left",  fontSize: "9px", fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: "1px solid #f1f5f9" }}>Description</th>
                </tr>
              </thead>
              <tbody>
                {group.entries.map((e, ei) => (
                  <tr key={e.id} style={{ borderBottom: ei < group.entries.length - 1 ? "1px solid #f1f5f9" : "none" }}>
                    <td style={{ padding: "7px 12px", fontSize: "11px", color: "#475569", whiteSpace: "nowrap" }}>
                      {fmtDay(e.workDate)}
                    </td>
                    <td style={{ padding: "7px 8px", fontSize: "12px", fontWeight: 700, color: "#0f172a", textAlign: "right" }}>
                      {e.hours}h
                    </td>
                    <td style={{ padding: "7px 12px", fontSize: "11px", color: e.description ? "#475569" : "#cbd5e1", fontStyle: e.description ? "normal" : "italic" }}>
                      {e.description ?? "No description"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function ReviewRow({ row, onDone }: { row: ReviewTimesheetRow; onDone: (id: string, status: string) => void }) {
  const [note,    setNote]    = useState(row.reviewerNote ?? "");
  const [open,    setOpen]    = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function doAction(action: "approve" | "reject") {
    setError(null);
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("timesheet_id", row.id);
        fd.set("action", action);
        fd.set("reviewer_note", note);
        const res = await reviewTimesheetAction(fd) as any;
        onDone(row.id, res.status);
      } catch (e: any) {
        setError(e?.message ?? "Failed");
      }
    });
  }

  const canReview = row.status === "submitted";

  return (
    <div style={{
      background: "white", borderRadius: "12px",
      border: "1.5px solid #e2e8f0", padding: "0",
      overflow: "hidden", marginBottom: "10px",
    }}>
      {/* Row header */}
      <div style={{
        display: "flex", alignItems: "center", gap: "12px",
        padding: "14px 16px", flexWrap: "wrap",
        cursor: "pointer",
      }} onClick={() => setOpen(o => !o)}>
        <div style={{
          width: 32, height: 32, borderRadius: "50%",
          background: "rgba(14,116,144,0.12)", color: "#0e7490",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: "12px", fontWeight: 800, flexShrink: 0,
        }}>
          {row.personName[0]?.toUpperCase() ?? "?"}
        </div>

        <div style={{ flex: 1, minWidth: "140px" }}>
          <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>
            {row.personName}
          </div>
          <div style={{ fontSize: "11px", color: "#94a3b8" }}>
            {fmtWeek(row.weekStart)}
          </div>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: "13px", fontWeight: 800, color: "#0f172a" }}>
            {row.totalHours}h
          </span>
          <Badge status={row.status} />
          {row.submittedAt && (
            <span style={{ fontSize: "10px", color: "#94a3b8" }}>
              Submitted {fmtDate(row.submittedAt)}
            </span>
          )}
          <a
            href={`/api/timesheet/export?user_id=${row.userId}&from=${row.weekStart}&to=${row.weekStart}`}
            onClick={e => e.stopPropagation()}
            style={{
              fontSize: "10px", color: "#0e7490", fontWeight: 700,
              textDecoration: "none", padding: "3px 8px",
              border: "1.5px solid rgba(14,116,144,0.25)", borderRadius: "5px",
            }}
          >
            CSV
          </a>
          <span style={{ fontSize: "14px", color: "#94a3b8", transform: open ? "rotate(90deg)" : "none", display: "inline-block", transition: "transform 0.15s" }}>&#8250;</span>
        </div>
      </div>

      {/* Expanded panel */}
      {open && (
        <div style={{
          borderTop: "1px solid #f1f5f9",
          padding: "16px",
          background: "#fafafa",
        }}>
          {error && (
            <div style={{
              padding: "8px 12px", borderRadius: "7px", marginBottom: "12px",
              background: "rgba(239,68,68,0.08)", border: "1.5px solid rgba(239,68,68,0.2)",
              color: "#dc2626", fontSize: "12px",
            }}>{error}</div>
          )}

          {row.reviewerNote && row.status !== "submitted" && (
            <div style={{
              padding: "8px 12px", borderRadius: "7px", marginBottom: "12px",
              background: "rgba(100,116,139,0.06)", border: "1.5px solid #f1f5f9",
              fontSize: "12px", color: "#475569",
            }}>
              <strong>Reviewer note:</strong> {row.reviewerNote}
            </div>
          )}

          {/* Entry breakdown */}
          <div style={{ marginBottom: "16px" }}>
            <div style={{
              fontSize: "10px", fontWeight: 800, color: "#94a3b8",
              textTransform: "uppercase", letterSpacing: "0.06em",
              marginBottom: "10px",
            }}>
              Time breakdown — {row.entries.length} entr{row.entries.length !== 1 ? "ies" : "y"}
            </div>
            <EntryTable entries={row.entries} />
          </div>

          {canReview && (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px", borderTop: "1px solid #e2e8f0", paddingTop: "14px" }}>
              <div>
                <label style={{
                  fontSize: "10px", fontWeight: 800, color: "#94a3b8",
                  textTransform: "uppercase", letterSpacing: "0.06em",
                  display: "block", marginBottom: "5px",
                }}>Note (optional)</label>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  placeholder="Add a note for the submitter..."
                  rows={2}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    padding: "8px 12px", borderRadius: "8px",
                    border: "1.5px solid #e2e8f0", fontSize: "12px",
                    fontFamily: "inherit", resize: "vertical",
                    outline: "none", color: "#0f172a",
                  }}
                />
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                <button type="button"
                  onClick={() => doAction("approve")}
                  disabled={pending}
                  style={{
                    padding: "8px 18px", borderRadius: "8px", border: "none",
                    background: pending ? "#e2e8f0" : "#059669",
                    color: pending ? "#94a3b8" : "white",
                    fontSize: "12px", fontWeight: 800, cursor: pending ? "not-allowed" : "pointer",
                    boxShadow: pending ? "none" : "0 2px 8px rgba(5,150,105,0.25)",
                  }}>
                  {pending ? "..." : "Approve"}
                </button>
                <button type="button"
                  onClick={() => doAction("reject")}
                  disabled={pending}
                  style={{
                    padding: "8px 18px", borderRadius: "8px",
                    border: "1.5px solid #fecaca", background: "white",
                    color: "#dc2626", fontSize: "12px", fontWeight: 700,
                    cursor: pending ? "not-allowed" : "pointer",
                  }}>
                  Reject
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ReviewClient({
  rows: initial, statusFilter, exportAllUrl, isAdmin, reviewerName,
}: {
  rows:         ReviewTimesheetRow[];
  statusFilter: string;
  exportAllUrl: string;
  isAdmin:      boolean;
  reviewerName: string;
}) {
  const [rows, setRows] = useState<ReviewTimesheetRow[]>(initial);

  function handleDone(id: string, newStatus: string) {
    setRows(rs => rs.map(r => r.id === id ? { ...r, status: newStatus } : r));
  }

  const filters = ["submitted", "approved", "rejected", "all"];
  const pendingCount = rows.filter(r => r.status === "submitted").length;

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800;900&display=swap');`}</style>

      <div style={{ padding: "24px 28px", fontFamily: "'DM Sans', sans-serif",
                    maxWidth: "860px", minHeight: "100vh", background: "#f8fafc" }}>

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: "20px", flexWrap: "wrap", gap: "12px",
        }}>
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 900, color: "#0f172a",
                         margin: "0 0 4px", letterSpacing: "-0.2px" }}>
              Review Timesheets
            </h1>
            <p style={{ fontSize: "12px", color: "#94a3b8", margin: 0 }}>
              {pendingCount > 0
                ? `${pendingCount} timesheet${pendingCount !== 1 ? "s" : ""} awaiting review`
                : "No timesheets pending review"}
            </p>
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            <a href="/timesheet" style={{
              fontSize: "12px", color: "#64748b", textDecoration: "none",
              padding: "7px 14px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", background: "white",
            }}>My timesheet</a>
            <a href={exportAllUrl} style={{
              fontSize: "12px", color: "#0e7490", fontWeight: 700,
              textDecoration: "none", padding: "7px 14px",
              border: "1.5px solid rgba(14,116,144,0.3)",
              borderRadius: "8px", background: "rgba(14,116,144,0.05)",
            }}>Export all CSV</a>
          </div>
        </div>

        {/* Filter tabs */}
        <div style={{ display: "flex", gap: "4px", marginBottom: "16px" }}>
          {filters.map(f => {
            const count = f === "all" ? rows.length : rows.filter(r => r.status === f).length;
            const active = f === statusFilter;
            return (
              <a key={f} href={`/timesheet/review?status=${f}`} style={{
                padding: "6px 12px", borderRadius: "7px",
                border: "1.5px solid",
                borderColor: active ? "#0e7490" : "#e2e8f0",
                background: active ? "rgba(14,116,144,0.08)" : "white",
                color: active ? "#0e7490" : "#64748b",
                fontSize: "11px", fontWeight: active ? 800 : 600,
                textDecoration: "none", display: "inline-flex", gap: "5px",
                alignItems: "center", textTransform: "capitalize",
              }}>
                {f}
                <span style={{
                  fontSize: "9px", fontWeight: 800,
                  background: active ? "rgba(14,116,144,0.15)" : "#f1f5f9",
                  color: active ? "#0e7490" : "#94a3b8",
                  padding: "1px 5px", borderRadius: "4px",
                }}>{count}</span>
              </a>
            );
          })}
        </div>

        {rows.length === 0 ? (
          <div style={{
            padding: "48px 0", textAlign: "center",
            background: "white", borderRadius: "12px",
            border: "1.5px solid #e2e8f0",
            fontSize: "13px", color: "#94a3b8",
          }}>
            No timesheets {statusFilter !== "all" ? `with status "${statusFilter}"` : ""}
          </div>
        ) : (
          rows.map(row => (
            <ReviewRow key={row.id} row={row} onDone={handleDone} />
          ))
        )}
      </div>
    </>
  );
}
