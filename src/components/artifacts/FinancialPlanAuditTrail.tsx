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
  changed_columns?: string[] | null;
  before?: any;
  after?: any;
};

type AuditGroup = {
  group_key: string;
  created_at: string;
  actor_email?: string | null;
  title: string;
  section: string;
  summaries: string[];
  items: AuditItem[];
  item_count: number;
};

type FilterType = "all" | "changes" | "approval";

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
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return fmtDateTime(iso);
  } catch { return iso; }
}

function shortVal(val: any): string {
  if (val === null || val === undefined || val === "") return "(empty)";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  if (typeof val === "number") return String(val);
  if (typeof val === "object") {
    try {
      const s = JSON.stringify(val);
      return s.length > 80 ? s.slice(0, 80) + "..." : s;
    } catch { return "[object]"; }
  }
  const s = String(val).trim();
  return s.length > 80 ? s.slice(0, 80) + "..." : s || "(empty)";
}

function humanField(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/\b\w/g, c => c.toUpperCase());
}

function FieldDiff({ before, after }: { before: any; after: any }) {
  if (before === undefined && after === undefined) return null;

  if (before && after && typeof before === "object" && typeof after === "object" && !Array.isArray(before)) {
    const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
    const changed = keys.filter(k => JSON.stringify((before as any)[k]) !== JSON.stringify((after as any)[k]));
    if (!changed.length) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 6 }}>
        {changed.map(k => (
          <div key={k} style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11 }}>
            <span style={{ fontWeight: 600, color: "#475569", minWidth: 140, fontFamily: "monospace", flexShrink: 0 }}>
              {humanField(k)}
            </span>
            <span style={{ color: "#dc2626", background: "#fff1f2", padding: "1px 6px", borderRadius: 3, textDecoration: "line-through", fontFamily: "monospace", wordBreak: "break-all" }}>
              {shortVal((before as any)[k])}
            </span>
            <span style={{ color: "#64748b", flexShrink: 0 }}>{"\u2192"}</span>
            <span style={{ color: "#059669", background: "#f0fdf4", padding: "1px 6px", borderRadius: 3, fontFamily: "monospace", wordBreak: "break-all" }}>
              {shortVal((after as any)[k])}
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, fontSize: 11, marginTop: 6 }}>
      {before !== undefined && (
        <span style={{ color: "#dc2626", background: "#fff1f2", padding: "1px 6px", borderRadius: 3, fontFamily: "monospace", textDecoration: "line-through", wordBreak: "break-all" }}>
          {shortVal(before)}
        </span>
      )}
      {before !== undefined && after !== undefined && (
        <span style={{ color: "#64748b", flexShrink: 0 }}>{"\u2192"}</span>
      )}
      {after !== undefined && (
        <span style={{ color: "#059669", background: "#f0fdf4", padding: "1px 6px", borderRadius: 3, fontFamily: "monospace", wordBreak: "break-all" }}>
          {shortVal(after)}
        </span>
      )}
    </div>
  );
}

function buildInlineSummary(group: AuditGroup): string {
  // Try to extract meaningful field names from items
  const fields: string[] = [];
  for (const item of group.items) {
    if (item.changed_columns && Array.isArray(item.changed_columns)) {
      fields.push(...item.changed_columns.map(humanField));
    } else if (item.before && item.after && typeof item.before === "object") {
      const keys = Object.keys(item.before).filter(k =>
        JSON.stringify((item.before as any)[k]) !== JSON.stringify((item.after as any)[k])
      );
      fields.push(...keys.map(humanField));
    } else if (item.summary) {
      fields.push(item.summary);
    }
  }
  const unique = Array.from(new Set(fields)).slice(0, 4);
  if (unique.length) return unique.join(", ");
  if (group.summaries.length) return group.summaries.slice(0, 2).join(" \u00b7 ");
  return "";
}

function sectionColors(section: string, kind: string) {
  if (kind === "approval") return { color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe", icon: "\u2713" };
  switch (section) {
    case "budget": case "financial": return { color: "#059669", bg: "#f0fdf4", border: "#bbf7d0", icon: "\u00a3" };
    case "schedule": return { color: "#d97706", bg: "#fffbeb", border: "#fde68a", icon: "\ud83d\uddd3" };
    case "risks": case "raid": return { color: "#dc2626", bg: "#fff5f5", border: "#fecaca", icon: "\u26a0" };
    default: return { color: "#475569", bg: "#f8fafc", border: "#e2e8f0", icon: "\ud83d\udcdd" };
  }
}

function GroupRow({ group, expanded, onToggle }: {
  group: AuditGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  const kind = group.items[0]?.kind ?? "content";
  const c = sectionColors(group.section, kind);
  const inlineSummary = buildInlineSummary(group);
  const hasDetail = group.items.some(i =>
    i.before !== undefined || i.after !== undefined || i.summary || i.step_name
  );

  return (
    <div style={{ borderRadius: 8, border: `1px solid ${expanded ? c.border : "#e2e8f0"}`, background: expanded ? c.bg : "#fff", overflow: "hidden", transition: "border-color 0.15s, background 0.15s" }}>
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        style={{ width: "100%", textAlign: "left", background: "none", border: "none", padding: "10px 14px", cursor: hasDetail ? "pointer" : "default", display: "flex", alignItems: "flex-start", gap: 10, fontFamily: "inherit" }}
      >
        {/* Icon badge */}
        <span style={{ width: 26, height: 26, borderRadius: 6, background: c.bg, border: `1px solid ${c.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0, marginTop: 2 }}>
          {c.icon}
        </span>

        {/* Main */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>
              {group.title}
            </span>
            {kind === "approval" && group.items[0]?.decision && (
              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 7px", borderRadius: 4, background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
                {String(group.items[0].decision).toUpperCase()}
              </span>
            )}
            {group.item_count > 1 && (
              <span style={{ fontSize: 10, color: "#94a3b8", background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>
                {group.item_count} changes
              </span>
            )}
          </div>
          {/* Field summary shown inline even when collapsed */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
            {group.actor_email && (
              <span style={{ fontSize: 11, color: "#64748b" }}>by {group.actor_email}</span>
            )}
            {inlineSummary && (
              <span style={{ fontSize: 11, color: c.color, fontWeight: 500 }}>
                {"\u2022"} {inlineSummary}
              </span>
            )}
          </div>
        </div>

        {/* Time */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#64748b" }}>{fmtRelative(group.created_at)}</div>
          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{fmtDateTime(group.created_at)}</div>
        </div>

        {/* Chevron */}
        {hasDetail && (
          <span style={{ fontSize: 10, color: "#94a3b8", flexShrink: 0, marginTop: 6, display: "inline-block", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}>
            {"v"}
          </span>
        )}
      </button>

      {expanded && hasDetail && (
        <div style={{ padding: "0 14px 14px 50px", borderTop: `1px solid ${c.border}` }}>
          {group.items.map((item, i) => (
            <div key={i} style={{ marginTop: 10, paddingTop: i > 0 ? 10 : 0, borderTop: i > 0 ? "1px dashed #e2e8f0" : "none" }}>
              {item.action_label && item.action_label !== "Document updated" && (
                <div style={{ fontSize: 11, fontWeight: 600, color: c.color, marginBottom: 4 }}>
                  {item.action_label}
                </div>
              )}
              {item.step_name && (
                <div style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>
                  Step: {item.step_name}
                  {item.decision && <span style={{ marginLeft: 8, fontWeight: 600, color: c.color }}>{item.decision}</span>}
                </div>
              )}
              {item.summary && (
                <div style={{ fontSize: 11, color: "#475569", fontStyle: "italic", marginBottom: 4 }}>
                  {item.summary}
                </div>
              )}
              {(item.before !== undefined || item.after !== undefined) && (
                <FieldDiff before={item.before} after={item.after} />
              )}
              {(!item.before && !item.after && item.changed_columns && item.changed_columns.length > 0) && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                  Fields: {item.changed_columns.map(humanField).join(", ")}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

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
  // null = nothing shown until user clicks a filter tab
  const [filter,   setFilter]   = useState<FilterType | null>(null);
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
      setError(e?.message ?? "Could not load");
    } finally {
      setLoading(false);
    }
  }, [artifactId]);

  useEffect(() => { void load(); }, [load]);

  const filtered = filter === null
    ? []
    : filter === "all"
      ? groups
      : groups.filter(g => filter === "approval"
          ? g.section === "approval"
          : g.section !== "approval"
        );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function toggleExpanded(key: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  const btn = (active: boolean, muted?: boolean): React.CSSProperties => ({
    padding: "4px 12px", borderRadius: 6, border: "1px solid",
    borderColor: active ? "#0e7490" : "#e2e8f0",
    background: active ? "#ecfeff" : "#fff",
    color: active ? "#0e7490" : "#64748b",
    fontSize: 11, fontWeight: active ? 700 : 500,
    cursor: "pointer", fontFamily: "inherit",
  });

  return (
    <div style={{ fontFamily: "system-ui, sans-serif" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10, flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>Audit trail</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {filter !== null && expanded.size > 0 && (
            <button type="button" onClick={() => setExpanded(new Set())} style={btn(false)}>Collapse all</button>
          )}
          {filter !== null && filtered.length > 0 && expanded.size === 0 && (
            <button type="button" onClick={() => setExpanded(new Set(filtered.map(g => g.group_key)))} style={btn(false)}>Expand all</button>
          )}
          <button type="button" onClick={load} style={{ ...btn(false), padding: "4px 8px" }} title="Refresh">{"\u21bb"}</button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>{groups.length} event{groups.length !== 1 ? "s" : ""}</span>
        </div>
      </div>

      {/* Filter tabs - click to reveal events */}
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "#94a3b8", marginRight: 4 }}>Click to view:</span>
        {(["all", "changes", "approval"] as FilterType[]).map(f => (
          <button key={f} type="button"
            onClick={() => { setFilter(prev => prev === f ? null : f); setPage(1); setExpanded(new Set()); }}
            style={btn(filter === f)}>
            {f === "all"
              ? `All (${groups.length})`
              : f === "changes"
                ? `Changes (${groups.filter(g => g.section !== "approval").length})`
                : `Approval (${groups.filter(g => g.section === "approval").length})`}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>Loading...</div>
      )}
      {error && !loading && (
        <div style={{ padding: "10px 14px", borderRadius: 8, background: "#fff5f5", border: "1px solid #fecaca", fontSize: 12, color: "#dc2626" }}>{error}</div>
      )}
      {!loading && filter === null && (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          Select a filter above to view audit events.
        </div>
      )}
      {!loading && !error && filter !== null && filtered.length === 0 && (
        <div style={{ padding: "16px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>No events found.</div>
      )}

      {!loading && !error && paged.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
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

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 12 }}>
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} style={{ ...btn(false), opacity: page === 1 ? 0.4 : 1 }}>{"\u2190"} Prev</button>
          <span style={{ fontSize: 11, color: "#64748b" }}>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} style={{ ...btn(false), opacity: page === totalPages ? 0.4 : 1 }}>Next {"\u2192"}</button>
        </div>
      )}
    </div>
  );
}