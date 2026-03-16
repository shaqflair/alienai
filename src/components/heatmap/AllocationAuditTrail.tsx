// src/components/heatmap/AllocationAuditTrail.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";

/* -------------------------------------------------------------
   TYPES
------------------------------------------------------------- */
type AuditEntry = {
  id:          string;
  action:      string;
  actor_id:    string | null;
  actor_name:  string | null;
  person_id:   string | null;
  person_name: string | null;
  project_id:  string | null;
  before:      any;
  after:       any;
  created_at:  string;
};

/* -------------------------------------------------------------
   ACTION CONFIG
------------------------------------------------------------- */
const ACTION_CFG: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  "allocation.created":      { label: "Allocated",    icon: "."+"?", color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "allocation.updated":      { label: "Updated",          icon: "."~", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  "allocation.deleted":      { label: "Removed",      icon: "."-"?",  color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
  "allocation.week_updated": { label: "Week edited",   icon: "."~"?", color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  "allocation.week_deleted": { label: "Week removed",     icon: "."~", color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
};

function cfgFor(action: string) {
  return ACTION_CFG[action] ?? {
    label: action.replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    icon: "."?", color: "#475569", bg: "#f8fafc", border: "#e2e8f0",
  };
}

/* -------------------------------------------------------------
   FORMATTERS
------------------------------------------------------------- */
function fmtDateTime(iso: string) {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit", month: "short", year: "numeric",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).format(new Date(iso));
  } catch { return iso; }
}

function fmtRelative(iso: string): string {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1)  return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)  return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)  return `${days}d ago`;
    return fmtDateTime(iso);
  } catch { return iso; }
}

/* -------------------------------------------------------------
   DIFF DETAIL
------------------------------------------------------------- */
function DiffDetail({ entry }: { entry: AuditEntry }) {
  const after  = entry.after  as any;
  const before = entry.before as any;
  if (!after && !before) return null;

  const summary = after?.summary ?? before?.summary ?? null;

  const renderField = (label: string, val: any) => {
    if (val == null || val === "") return null;
    return (
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: "#94a3b8" }}>{label}</span>
        <span style={{ fontWeight: 600, color: "#0f172a", fontFamily: "'DM Mono', monospace" }}>{String(val)}</span>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      {summary && (
        <div style={{ fontSize: 11, color: "#64748b", fontStyle: "italic", marginBottom: 2 }}>{summary}</div>
      )}

      {/* Created / deleted - show key fields */}
      {entry.action === "allocation.created" && after && (
        <>
          {renderField("Person",     after.person_name)}
          {renderField("Project",    after.project_title ?? (after.project_code ? `${after.project_code}` : null))}
          {renderField("Dates",      after.start_date && after.end_date ? `${after.start_date} to ${after.end_date}` : null)}
          {renderField("Days/wk",    after.days_per_week)}
          {renderField("Weeks",      after.weeks_inserted)}
          {renderField("Total days", after.total_days)}
          {renderField("Type",       after.allocation_type)}
          {after.conflict_count > 0 && (
            <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>
              ? {after.conflict_count} conflict week{after.conflict_count !== 1 ? "s" : ""}
            </div>
          )}
        </>
      )}

      {entry.action === "allocation.updated" && (
        <>
          {before && after && before.start_date !== after.start_date && (
            <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
              <span style={{ color: "#94a3b8" }}>Start</span>
              <span style={{ color: "#dc2626", textDecoration: "line-through" }}>{before.start_date}</span>
              <span style={{ color: "#94a3b8" }}>{"->"}</span>
              <span style={{ color: "#059669", fontWeight: 700 }}>{after.start_date}</span>
            </div>
          )}
          {before && after && before.end_date !== after.end_date && (
            <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
              <span style={{ color: "#94a3b8" }}>End</span>
              <span style={{ color: "#dc2626", textDecoration: "line-through" }}>{before.end_date}</span>
              <span style={{ color: "#94a3b8" }}>{"->"}</span>
              <span style={{ color: "#059669", fontWeight: 700 }}>{after.end_date}</span>
            </div>
          )}
          {before && after && before.days_per_week !== after.days_per_week && (
            <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
              <span style={{ color: "#94a3b8" }}>Days/wk</span>
              <span style={{ color: "#dc2626", textDecoration: "line-through" }}>{before.days_per_week}</span>
              <span style={{ color: "#94a3b8" }}>{"->"}</span>
              <span style={{ color: "#059669", fontWeight: 700 }}>{after.days_per_week}</span>
            </div>
          )}
          {after?.weeks_updated && renderField("Weeks updated", after.weeks_updated)}
        </>
      )}

      {entry.action === "allocation.deleted" && before && (
        <>
          {renderField("Person",       before.person_name)}
          {renderField("Weeks removed", before.weeks_removed)}
          {renderField("Total days",   before.total_days)}
          {renderField("Period",       before.first_week && before.last_week ? `${before.first_week} to ${before.last_week}` : null)}
        </>
      )}

      {(entry.action === "allocation.week_updated" || entry.action === "allocation.week_deleted") && (
        <>
          {renderField("Week",  after?.week ?? before?.week)}
          {before?.days_allocated != null && after?.days_allocated != null && before.days_allocated !== after.days_allocated && (
            <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
              <span style={{ color: "#94a3b8" }}>Days</span>
              <span style={{ color: "#dc2626", textDecoration: "line-through" }}>{before.days_allocated}d</span>
              <span style={{ color: "#94a3b8" }}>{"->"}</span>
              <span style={{ color: "#059669", fontWeight: 700 }}>{after.days_allocated}d</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   ENTRY ROW
------------------------------------------------------------- */
function EntryRow({ entry, expanded, onToggle }: {
  entry: AuditEntry; expanded: boolean; onToggle: () => void;
}) {
  const cfg       = cfgFor(entry.action);
  const hasDetail = !!(entry.after || entry.before);
  const summary   = entry.after?.summary ?? entry.before?.summary ?? null;

  // Show person name if querying by project (multiple people visible)
  const personLabel = entry.person_name ?? null;

  return (
    <div style={{ borderRadius: 10, border: `1px solid ${cfg.border}`, background: cfg.bg, overflow: "hidden" }}>
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none",
          padding: "10px 14px", cursor: hasDetail ? "pointer" : "default",
          display: "flex", alignItems: "center", gap: 10, fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>{cfg.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            {personLabel && (
              <span style={{ fontSize: 11, color: "#64748b", fontWeight: 600 }}>{personLabel}</span>
            )}
            {entry.actor_name && entry.actor_name !== personLabel && (
              <span style={{ fontSize: 11, color: "#94a3b8" }}>by {entry.actor_name}</span>
            )}
          </div>
          {summary && !expanded && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {summary}
            </div>
          )}
        </div>
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtRelative(entry.created_at)}</div>
          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{fmtDateTime(entry.created_at)}</div>
        </div>
        {hasDetail && (
          <span style={{ color: "#94a3b8", fontSize: 10, flexShrink: 0 }}>
            {expanded ? "^" : "v"}
          </span>
        )}
      </button>
      {expanded && hasDetail && (
        <div style={{ padding: "0 14px 12px", borderTop: `1px solid ${cfg.border}` }}>
          <DiffDetail entry={entry} />
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------
   FILTER TYPES
------------------------------------------------------------- */
type FilterType = "all" | "created" | "updated" | "deleted" | "weekly";

const FILTER_GROUPS: Record<FilterType, string[]> = {
  all:     [],
  created: ["allocation.created"],
  updated: ["allocation.updated"],
  deleted: ["allocation.deleted"],
  weekly:  ["allocation.week_updated", "allocation.week_deleted"],
};

/* -------------------------------------------------------------
   MAIN COMPONENT
------------------------------------------------------------- */
export default function AllocationAuditTrail({
  projectId,
  personId,
  title = "Allocation audit trail",
}: {
  projectId?: string;
  personId?:  string;
  title?:     string;
}) {
  const [entries,  setEntries]  = useState<AuditEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    if (!projectId && !personId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (projectId) params.set("projectId", projectId);
      if (personId)  params.set("personId",  personId);
      const res  = await fetch(`/api/allocations/audit?${params}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load");
      setEntries(Array.isArray(json.entries) ? json.entries : []);
    } catch (e: any) {
      setError(e?.message ?? "Could not load audit trail");
    } finally {
      setLoading(false);
    }
  }, [projectId, personId]);

  useEffect(() => { void load(); }, [load]);

  function toggleExpanded(id: string) {
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  const filtered = filter === "all" ? entries : entries.filter(e => FILTER_GROUPS[filter].includes(e.action));
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const S = {
    filterBtn: (active: boolean): React.CSSProperties => ({
      padding: "4px 10px", borderRadius: 6, border: "1px solid",
      borderColor: active ? "#00b8db" : "#e2e8f0",
      background:  active ? "#ecfeff" : "#ffffff",
      color:        active ? "#0e7490" : "#64748b",
      fontSize: 11, fontWeight: active ? 700 : 500,
      cursor: "pointer", fontFamily: "inherit",
    }),
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "#0d1117", margin: 0 }}>{title}</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={load} title="Refresh" style={{ ...S.filterBtn(false), padding: "4px 8px" }}>?</button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{filtered.length} event{filtered.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        {(["all", "created", "updated", "deleted", "weekly"] as FilterType[]).map(f => (
          <button key={f} type="button" onClick={() => { setFilter(f); setPage(1); }} style={S.filterBtn(filter === f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* States */}
      {loading && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          Loading...
        </div>
      )}
      {error && !loading && (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 12, color: "#dc2626" }}>
          {error}
        </div>
      )}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          No events found{filter !== "all" ? ` for "${filter}"` : ""}.
        </div>
      )}

      {/* Timeline */}
      {!loading && !error && paged.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {paged.map(entry => (
            <EntryRow
              key={entry.id}
              entry={entry}
              expanded={expanded.has(entry.id)}
              onToggle={() => toggleExpanded(entry.id)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ ...S.filterBtn(false), opacity: page === 1 ? 0.4 : 1 }}>{"<-"} Prev</button>
          <span style={{ fontSize: 11, color: "#64748b" }}>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ ...S.filterBtn(false), opacity: page === totalPages ? 0.4 : 1 }}>Next {"->"}  </button>
        </div>
      )}
    </div>
  );
}

