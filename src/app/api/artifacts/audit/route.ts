// src/components/artifacts/FinancialPlanAuditTrail.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";

type AuditItem = {
  id: string | number;
  created_at: string;
  section: string;
  action_label?: string | null;
  summary?: string | null;
  kind: "content" | "approval";
  action?: string | null;
  decision?: string | null;
  step_name?: string | null;
  before?: any;
  after?: any;
};

type AuditGroup = {
  group_key: string;
  created_at: string;
  actor_email?: string | null;
  actor_id?: string | null;
  title: string;
  section: string;
  summaries: string[];
  items: AuditItem[];
  item_count: number;
};

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

function sectionIcon(section: string, kind: string): string {
  if (kind === "approval") return "\u2713";
  switch (section) {
    case "budget": case "financial": return "\u00a3";
    case "schedule": case "timeline": return "\ud83d\uddd3";
    case "risks": case "raid": return "\u26a0";
    case "general": default: return "\ud83d\udcdd";
  }
}

function sectionColor(section: string, kind: string): { color: string; bg: string; border: string } {
  if (kind === "approval") return { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" };
  switch (section) {
    case "budget": case "financial": return { color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" };
    case "schedule": return { color: "#d97706", bg: "#fffbeb", border: "#fde68a" };
    case "risks": case "raid": return { color: "#dc2626", bg: "#fff5f5", border: "#fecaca" };
    default: return { color: "#475569", bg: "#f8fafc", border: "#e2e8f0" };
  }
}

function diffValue(val: any): string {
  if (val === null || val === undefined) return "--";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "object") {
    try { return JSON.stringify(val).slice(0, 120); } catch { return String(val); }
  }
  const s = String(val);
  return s.length > 120 ? s.slice(0, 120) + "..." : s;
}

function DiffView({ before, after }: { before: any; after: any }) {
  if (!before && !after) return null;

  // If both are objects, show field-by-field diff
  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before)) {
    const keys = Array.from(new Set([...Object.keys(before || {}), ...Object.keys(after || {})]));
    const changed = keys.filter(k => JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (!changed.length) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
        {changed.map(k => (
          <div key={k} style={{ display: "grid", gridTemplateColumns: "120px 1fr 1fr", gap: 8, fontSize: 11, fontFamily: "monospace", alignItems: "start" }}>
            <span style={{ color: "#64748b", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k}</span>
            <span style={{ color: "#dc2626", background: "#fff5f5", padding: "2px 6px", borderRadius: 4, wordBreak: "break-all" }}>
              {diffValue(before[k])}
            </span>
            <span style={{ color: "#059669", background: "#f0fdf4", padding: "2px 6px", borderRadius: 4, wordBreak: "break-all" }}>
              {diffValue(after[k])}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Simple before/after
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 8, fontSize: 11, fontFamily: "monospace" }}>
      {before !== undefined && (
        <span style={{ color: "#dc2626", background: "#fff5f5", padding: "3px 8px", borderRadius: 4, flex: 1, wordBreak: "break-all" }}>
          - {diffValue(before)}
        </span>
      )}
      {after !== undefined && (
        <span style={{ color: "#059669", background: "#f0fdf4", padding: "3px 8px", borderRadius: 4, flex: 1, wordBreak: "break-all" }}>
          + {diffValue(after)}
        </span>
      )}
    </div>
  );
}

function GroupRow({ group, expanded, onToggle }: {
  group: AuditGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const primaryItem = group.items[0];
  const cfg = sectionColor(group.section, primaryItem?.kind ?? "content");
  const icon = sectionIcon(group.section, primaryItem?.kind ?? "content");

  const hasDetail = group.items.length > 0 &&
    group.items.some(i => i.summary || i.before || i.after || i.decision || i.step_name);

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${expanded ? cfg.border : "#e2e8f0"}`, background: expanded ? cfg.bg : "#ffffff", overflow: "hidden", transition: "all 0.15s" }}>
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        style={{
          width: "100%", textAlign: "left", background: "none", border: "none",
          padding: "10px 14px", cursor: hasDetail ? "pointer" : "default",
          display: "flex", alignItems: "flex-start", gap: 10, fontFamily: "inherit",
        }}
      >
        {/* Icon */}
        <span style={{
          width: 28, height: 28, borderRadius: 6, background: cfg.bg,
          border: `1px solid ${cfg.border}`, display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 13, flexShrink: 0, marginTop: 1,
        }}>{icon}</span>

        {/* Main content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{group.title}</span>
            {group.section === "approval" && primaryItem?.decision && (
              <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
                {primaryItem.decision}
              </span>
            )}
            {group.item_count > 1 && (
              <span style={{ fontSize: 10, color: "#94a3b8", background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>
                {group.item_count} changes
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 3, flexWrap: "wrap" }}>
            {group.actor_email && (
              <span style={{ fontSize: 11, color: "#64748b" }}>by {group.actor_email}</span>
            )}
            {group.summaries.length > 0 && !expanded && (
              <span style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 300 }}>
                {group.summaries[0]}
              </span>
            )}
          </div>
        </div>

        {/* Right side */}
        <div style={{ flexShrink: 0, textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
          <span style={{ fontSize: 11, color: "#64748b" }}>{fmtRelative(group.created_at)}</span>
          <span style={{ fontSize: 10, color: "#cbd5e1" }}>{fmtDateTime(group.created_at)}</span>
        </div>

        {/* Chevron */}
        {hasDetail && (
          <span style={{ color: "#94a3b8", fontSize: 11, flexShrink: 0, marginTop: 4, transform: expanded ? "rotate(180deg)" : "none", display: "inline-block", transition: "transform 0.15s" }}>
            {"v"}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div style={{ padding: "0 14px 14px 52px", borderTop: `1px solid ${cfg.border}` }}>
          {group.summaries.length > 0 && (
            <p style={{ fontSize: 12, color: "#475569", fontStyle: "italic", margin: "10px 0 8px" }}>
              {group.summaries.join(" \u00b7 ")}
            </p>
          )}
          {group.items.map((item, i) => (
            <div key={i} style={{ marginTop: i > 0 ? 12 : 8, paddingTop: i > 0 ? 12 : 0, borderTop: i > 0 ? "1px dashed #e2e8f0" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: cfg.color }}>
                  {item.action_label ?? item.section ?? "Change"}
                </span>
                {item.kind === "approval" && item.step_name && (
                  <span style={{ fontSize: 10, color: "#64748b" }}>Step: {item.step_name}</span>
                )}
              </div>
              {item.summary && (
                <p style={{ fontSize: 11, color: "#64748b", margin: "4px 0 0" }}>{item.summary}</p>
              )}
              {(item.before !== undefined || item.after !== undefined) && (
                <DiffView before={item.before} after={item.after} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

type FilterType = "all" | "changes" | "approval";

export default function FinancialPlanAuditTrail({
  projectId,
  artifactId,
}: {
  projectId: string;
  artifactId: string;
}) {
  const [groups,   setGroups]   = useState<AuditGroup[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 25;

  const load = useCallback(async () => {
    if (!artifactId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/artifacts/audit?artifact_id=${encodeURIComponent(artifactId)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load audit trail");
      setGroups(Array.isArray(json.events) ? json.events : []);
    } catch (e: any) {
      setError(e?.message ?? "Could not load audit trail");
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => { void load(); }, [load]);

  function toggleExpanded(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setExpanded(new Set(filtered.map(g => g.group_key)));
  }
  function collapseAll() {
    setExpanded(new Set());
  }

  const filtered = filter === "all"
    ? groups
    : groups.filter(g => filter === "approval" ? g.section === "approval" : g.section !== "approval");

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const anyExpanded = expanded.size > 0;

  const btnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 10px", borderRadius: 6, border: "1px solid",
    borderColor: active ? "#0e7490" : "#e2e8f0",
    background:  active ? "#ecfeff" : "#ffffff",
    color:       active ? "#0e7490" : "#64748b",
    fontSize: 11, fontWeight: active ? 700 : 500,
    cursor: "pointer", fontFamily: "inherit",
  });

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "#0d1117", margin: 0 }}>Audit trail</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {filtered.length > 0 && (
            <button type="button" onClick={anyExpanded ? collapseAll : expandAll} style={btnStyle(false)}>
              {anyExpanded ? "Collapse all" : "Expand all"}
            </button>
          )}
          <button type="button" onClick={load} title="Refresh" style={{ ...btnStyle(false), padding: "4px 8px" }}>
            {"\u21bb"}
          </button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
        {(["all", "changes", "approval"] as FilterType[]).map(f => (
          <button key={f} type="button" onClick={() => { setFilter(f); setPage(1); }} style={btnStyle(filter === f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          Loading audit trail...
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div style={{ padding: "12px 14px", borderRadius: 8, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 12, color: "#dc2626" }}>
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && filtered.length === 0 && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          No events found{filter !== "all" ? ` for "${filter}"` : ""}.
        </div>
      )}

      {/* Events */}
      {!loading && !error && paged.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {paged.map(group => (
            <GroupRow
              key={group.group_key}
              group={group}
              expanded={expanded.has(group.group_key)}
              onToggle={() => toggleExpanded(group.group_key)}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ ...btnStyle(false), opacity: page === 1 ? 0.4 : 1 }}>
            {"\u2190"} Prev
          </button>
          <span style={{ fontSize: 11, color: "#64748b" }}>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ ...btnStyle(false), opacity: page === totalPages ? 0.4 : 1 }}>
            Next {"\u2192"}
          </button>
        </div>
      )}
    </div>
  );
}