// src/components/heatmap/AllocationAuditTrail.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";

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

const ACTION_CFG: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  "allocation.created":      { label: "Allocated",    icon: "+", color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "allocation.updated":      { label: "Updated",      icon: "~", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  "allocation.deleted":      { label: "Removed",      icon: "-", color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
  "allocation.week_updated": { label: "Week edited",  icon: "~", color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  "allocation.week_deleted": { label: "Week removed", icon: "-", color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
};

function cfgFor(action: string) {
  return ACTION_CFG[action] ?? {
    label: action.replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    icon: ".", color: "#475569", bg: "#f8fafc", border: "#e2e8f0",
  };
}

function toUkDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = iso.split("T")[0];
  const parts = s.split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

function fixArrows(s: string): string {
  return s.replace(/ \? /g, " -> ");
}

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

function DiffDetail({ entry }: { entry: AuditEntry }) {
  const after  = entry.after  as any;
  const before = entry.before as any;
  if (!after && !before) return null;

  const renderField = (label: string, val: any) => {
    if (val == null || val === "") return null;
    return (
      <div key={label} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 3 }}>
        <span style={{ color: "#94a3b8" }}>{label}</span>
        <span style={{ fontWeight: 600, color: "#0f172a", fontFamily: "monospace" }}>{String(val)}</span>
      </div>
    );
  };

  const fmt = (d: string | null | undefined) => {
    if (!d) return "";
    if (/^\d{2}\/\d{2}\/\d{4}$/.test(d)) return d;
    return toUkDate(d);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
      {entry.action === "allocation.created" && after && (
        <>
          {renderField("Person",     after.person_name)}
          {renderField("Project",    after.project_title ?? after.project_code)}
          {renderField("Start",      fmt(after.start_date))}
          {renderField("End",        fmt(after.end_date))}
          {renderField("Days/wk",    after.days_per_week)}
          {renderField("Total days", after.total_days)}
          {after.conflict_count > 0 && (
            <div style={{ fontSize: 11, color: "#dc2626", fontWeight: 600 }}>
              {after.conflict_count} conflict week{after.conflict_count !== 1 ? "s" : ""}
            </div>
          )}
        </>
      )}
      {entry.action === "allocation.updated" && before && after && (
        <>
          {before.start_date !== after.start_date &&
            renderField("Start", `${fmt(before.start_date)} -> ${fmt(after.start_date)}`)}
          {before.end_date !== after.end_date &&
            renderField("End", `${fmt(before.end_date)} -> ${fmt(after.end_date)}`)}
          {before.days_per_week !== after.days_per_week &&
            renderField("Days/wk", `${before.days_per_week} -> ${after.days_per_week}`)}
          {after.weeks_updated && renderField("Weeks updated", after.weeks_updated)}
        </>
      )}
      {entry.action === "allocation.deleted" && before && (
        <>
          {renderField("Person",        before.person_name)}
          {renderField("Weeks removed", before.weeks_removed)}
          {renderField("Total days",    before.total_days)}
          {renderField("Period",
            before.first_week && before.last_week
              ? `${fmt(before.first_week)} to ${fmt(before.last_week)}`
              : null
          )}
        </>
      )}
      {(entry.action === "allocation.week_updated" || entry.action === "allocation.week_deleted") && (
        <>
          {renderField("Week", fmt(after?.week ?? before?.week))}
          {before?.days_allocated != null && after?.days_allocated != null &&
            before.days_allocated !== after.days_allocated &&
            renderField("Days", `${before.days_allocated}d -> ${after.days_allocated}d`)}
        </>
      )}
    </div>
  );
}

function EntryRow({ entry, expanded, onToggle }: {
  entry: AuditEntry; expanded: boolean; onToggle: () => void;
}) {
  const cfg       = cfgFor(entry.action);
  const hasDetail = !!(entry.after || entry.before);
  const rawSummary = (entry.after as any)?.summary ?? (entry.before as any)?.summary ?? null;
  const summary    = rawSummary ? fixArrows(rawSummary) : null;

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${expanded ? cfg.border : "#e2e8f0"}`, background: expanded ? cfg.bg : "#fff", overflow: "hidden", transition: "border-color 0.15s" }}>
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 14px", cursor: hasDetail ? "pointer" : "default", display: "flex", alignItems: "flex-start", gap: 10, fontFamily: "inherit" }}
      >
        <span style={{ width: 26, height: 26, borderRadius: 6, background: cfg.bg, border: `1px solid ${cfg.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 700, flexShrink: 0, marginTop: 1, color: cfg.color }}>
          {cfg.icon}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{cfg.label}</span>
            {entry.person_name && (
              <span style={{ fontSize: 11, fontWeight: 600, color: "#475569" }}>{entry.person_name}</span>
            )}
            {entry.actor_name && entry.actor_name !== entry.person_name && (
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
          <div style={{ fontSize: 11, color: "#64748b" }}>{fmtRelative(entry.created_at)}</div>
          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{fmtDateTime(entry.created_at)}</div>
        </div>
        {hasDetail && (
          <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0, marginTop: 5, display: "inline-block", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            {"v"}
          </span>
        )}
      </button>
      {expanded && hasDetail && (
        <div style={{ padding: "0 14px 12px 50px", borderTop: `1px solid ${cfg.border}` }}>
          <DiffDetail entry={entry} />
        </div>
      )}
    </div>
  );
}

type FilterType = "all" | "created" | "updated" | "deleted" | "weekly";

const FILTER_GROUPS: Record<FilterType, string[]> = {
  all:     [],
  created: ["allocation.created"],
  updated: ["allocation.updated"],
  deleted: ["allocation.deleted"],
  weekly:  ["allocation.week_updated", "allocation.week_deleted"],
};

export default function AllocationAuditTrail({
  projectId,
  personId,
  organisationId,
  includeActed = true,
  title = "Allocation audit trail",
}: {
  projectId?:      string;
  personId?:       string;
  organisationId?: string;
  includeActed?:   boolean;
  title?:          string;
}) {
  const [entries,  setEntries]  = useState<AuditEntry[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  // Default to "all" so data loads immediately and counts are visible
  const [filter,   setFilter]   = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    if (!projectId && !personId && !organisationId) return;
    setLoading(true); setError(null);
    try {
      const params = new URLSearchParams({ limit: "200" });
      if (projectId)      params.set("projectId",      projectId);
      if (personId)       params.set("personId",       personId);
      if (organisationId) params.set("organisationId", organisationId);
      if (personId && includeActed) params.set("includeActed", "true");

      const res  = await fetch(`/api/allocations/audit?${params}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load");
      setEntries(Array.isArray(json.entries) ? json.entries : []);
    } catch (e: any) {
      setError(e?.message ?? "Could not load audit trail");
    } finally {
      setLoading(false);
    }
  }, [projectId, personId, organisationId, includeActed]);

  // Load immediately on mount — no click required
  useEffect(() => {
    void load();
  }, [load]);

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  const counts = {
    all:     entries.length,
    created: entries.filter(e => FILTER_GROUPS.created.includes(e.action)).length,
    updated: entries.filter(e => FILTER_GROUPS.updated.includes(e.action)).length,
    deleted: entries.filter(e => FILTER_GROUPS.deleted.includes(e.action)).length,
    weekly:  entries.filter(e => FILTER_GROUPS.weekly.includes(e.action)).length,
  };

  const filtered = filter === "all"
    ? entries
    : entries.filter(e => FILTER_GROUPS[filter].includes(e.action));

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged      = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const btn = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px", borderRadius: 6, border: "1px solid",
    borderColor: active ? "#00b8db" : "#e2e8f0",
    background:  active ? "#ecfeff" : "#fff",
    color:       active ? "#0e7490" : "#64748b",
    fontSize: 11, fontWeight: active ? 700 : 500,
    cursor: "pointer", fontFamily: "inherit",
  });

  return (
    <div style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{title}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {expanded.size > 0 && (
            <button type="button" onClick={() => setExpanded(new Set())} style={btn(false)}>Collapse all</button>
          )}
          {filtered.length > 0 && expanded.size === 0 && (
            <button type="button" onClick={() => setExpanded(new Set(filtered.map(e => e.id)))} style={btn(false)}>Expand all</button>
          )}
          <button type="button" onClick={load} title="Refresh" style={{ ...btn(false), padding: "4px 8px" }}>?</button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {loading ? "Loading…" : `${entries.length} event${entries.length !== 1 ? "s" : ""}`}
          </span>
        </div>
      </div>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#94a3b8", marginRight: 4 }}>Filter:</span>
        {(["all", "created", "updated", "deleted", "weekly"] as FilterType[]).map(f => (
          <button key={f} type="button"
            onClick={() => { setFilter(f); setPage(1); setExpanded(new Set()); }}
            style={btn(filter === f)}>
            {f === "all"     ? `All (${counts.all})`
              : f === "created" ? `New (${counts.created})`
              : f === "updated" ? `Updated (${counts.updated})`
              : f === "deleted" ? `Removed (${counts.deleted})`
              : `Weekly (${counts.weekly})`}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>Loading…</div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 12, color: "#dc2626", marginBottom: 8 }}>
          {error}
          <button type="button" onClick={load} style={{ marginLeft: 10, fontSize: 11, color: "#dc2626", fontWeight: 700, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            Retry
          </button>
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          No {filter !== "all" ? filter : ""} events found.
        </div>
      )}

      {/* Entries */}
      {!loading && !error && paged.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {paged.map(entry => (
            <EntryRow key={entry.id} entry={entry} expanded={expanded.has(entry.id)} onToggle={() => toggleExpanded(entry.id)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...btn(false), opacity: page === 1 ? 0.4 : 1 }}>? Prev</button>
          <span style={{ fontSize: 11, color: "#64748b" }}>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...btn(false), opacity: page === totalPages ? 0.4 : 1 }}>Next ?</button>
        </div>
      )}
    </div>
  );
}