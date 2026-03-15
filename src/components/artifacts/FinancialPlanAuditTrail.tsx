// src/components/artifacts/FinancialPlanAuditTrail.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// ACTION CONFIG
// ---------------------------------------------------------------------------

const ACTION_CFG: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  "financial_plan.saved":            { label: "Saved",            icon: "\uD83D\uDCBE", color: "#475569", bg: "#f8fafc", border: "#e2e8f0" },
  "financial_plan.line_added":       { label: "Line added",       icon: "\u2795",       color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "financial_plan.line_edited":      { label: "Line edited",      icon: "\u270f\ufe0f", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  "financial_plan.line_deleted":     { label: "Line removed",     icon: "\uD83D\uDDD1", color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
  "financial_plan.budget_changed":   { label: "Budget changed",   icon: "\uD83D\uDCB0", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  "financial_plan.category_changed": { label: "Category changed", icon: "\uD83D\uDCC2", color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  "financial_plan.exported":         { label: "Exported",         icon: "\uD83D\uDCE4", color: "#0e7490", bg: "#ecfeff", border: "#a5f3fc" },
  "submit":                          { label: "Submitted",        icon: "\uD83D\uDCEC", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  "resubmit":                        { label: "Resubmitted",      icon: "\uD83D\uDD04", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  "approve":                         { label: "Approved",         icon: "\u2705",       color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "approve_step":                    { label: "Step approved",    icon: "\u2714",       color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "request_changes":                 { label: "Changes requested",icon: "\u21a9",       color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  "reject_final":                    { label: "Rejected",         icon: "\u274c",       color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
  "baseline_promoted":               { label: "Baseline created", icon: "\uD83C\uDFC1", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
};

function cfgFor(action: string) {
  return ACTION_CFG[action] ?? {
    label: action.replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    icon: "\uD83D\uDCCB", color: "#475569", bg: "#f8fafc", border: "#e2e8f0",
  };
}

// ---------------------------------------------------------------------------
// FORMATTERS
// ---------------------------------------------------------------------------

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

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "--";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

// ---------------------------------------------------------------------------
// GROUP ROW
// ---------------------------------------------------------------------------

function GroupRow({ group, expanded, onToggle }: {
  group: AuditGroup;
  expanded: boolean;
  onToggle: () => void;
}) {
  // Pick best action string for styling
  const primaryItem = group.items[0];
  const actionKey = primaryItem?.action ?? primaryItem?.section ?? "general";
  const cfg = group.section === "approval"
    ? (cfgFor(primaryItem?.decision ?? primaryItem?.action ?? "approve"))
    : cfgFor(actionKey);

  const hasDetail = group.items.length > 0;

  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${cfg.border}`,
      background: cfg.bg, overflow: "hidden",
    }}>
      <button
        type="button"
        onClick={hasDetail ? onToggle : undefined}
        style={{
          width: "100%", textAlign: "left",
          background: "none", border: "none",
          padding: "10px 14px", cursor: hasDetail ? "pointer" : "default",
          display: "flex", alignItems: "center", gap: 10,
          fontFamily: "inherit",
        }}
      >
        <span style={{ fontSize: 14, flexShrink: 0 }}>{cfg.icon}</span>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>
              {group.title}
            </span>
            {group.actor_email && (
              <span style={{ fontSize: 11, color: "#64748b" }}>by {group.actor_email}</span>
            )}
            {group.item_count > 1 && (
              <span style={{ fontSize: 10, color: "#94a3b8", background: "#f1f5f9", padding: "1px 6px", borderRadius: 4 }}>
                {group.item_count} changes
              </span>
            )}
          </div>
          {group.summaries.length > 0 && !expanded && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {group.summaries[0]}
            </div>
          )}
        </div>

        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtRelative(group.created_at)}</div>
          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{fmtDateTime(group.created_at)}</div>
        </div>

        {hasDetail && (
          <span style={{ color: "#94a3b8", fontSize: 10, flexShrink: 0 }}>
            {expanded ? "\u25b2" : "\u25bc"}
          </span>
        )}
      </button>

      {expanded && hasDetail && (
        <div style={{ padding: "0 14px 12px", borderTop: `1px solid ${cfg.border}` }}>
          {group.summaries.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 11, color: "#64748b", fontStyle: "italic" }}>
              {group.summaries.join(" \u00b7 ")}
            </div>
          )}
          {group.items.map((item, i) => (
            <div key={i} style={{ marginTop: 6, fontSize: 11, color: "#475569", display: "flex", gap: 6 }}>
              <span style={{ color: cfg.color, fontWeight: 700 }}>
                {item.kind === "approval" ? "\u2713" : "-"}
              </span>
              <span>{item.action_label ?? item.section ?? "Change"}</span>
              {item.summary && (
                <span style={{ color: "#94a3b8" }}>{item.summary}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FILTER BAR
// ---------------------------------------------------------------------------

type FilterType = "all" | "changes" | "approval";

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

export default function FinancialPlanAuditTrail({
  projectId,
  artifactId,
}: {
  projectId:  string;
  artifactId: string;
}) {
  const [groups,   setGroups]   = useState<AuditGroup[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);
  const [filter,   setFilter]   = useState<FilterType>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [page,     setPage]     = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    if (!artifactId) return;
    setLoading(true);
    setError(null);
    try {
      // Uses existing route: /api/artifacts/audit?artifact_id=...
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

  const filtered = filter === "all"
    ? groups
    : groups.filter(g =>
        filter === "approval" ? g.section === "approval" : g.section !== "approval"
      );

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const S = {
    header:    { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap" as const, gap: 8 },
    title:     { fontSize: 14, fontWeight: 700, color: "#0d1117", margin: 0 },
    filterRow: { display: "flex", gap: 6, flexWrap: "wrap" as const },
    filterBtn: (active: boolean): React.CSSProperties => ({
      padding: "4px 10px", borderRadius: 6, border: "1px solid",
      borderColor: active ? "#0e7490" : "#e2e8f0",
      background:  active ? "#ecfeff" : "#ffffff",
      color:       active ? "#0e7490" : "#64748b",
      fontSize: 11, fontWeight: active ? 700 : 500,
      cursor: "pointer", fontFamily: "inherit",
    }),
  };

  return (
    <div style={{ fontFamily: "inherit" }}>
      <div style={S.header}>
        <p style={S.title}>Audit trail</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={load} title="Refresh" style={{ ...S.filterBtn(false), padding: "4px 8px" }}>
            {"\u21bb"}
          </button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {filtered.length} event{filtered.length !== 1 ? "s" : ""}
          </span>
        </div>
      </div>

      <div style={{ ...S.filterRow, marginBottom: 14 }}>
        {(["all", "changes", "approval"] as FilterType[]).map(f => (
          <button key={f} type="button" onClick={() => { setFilter(f); setPage(1); }} style={S.filterBtn(filter === f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {loading && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          Loading audit trail...
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

      {totalPages > 1 && (
        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            style={{ ...S.filterBtn(false), opacity: page === 1 ? 0.4 : 1 }}>{"\u2190"} Prev</button>
          <span style={{ fontSize: 11, color: "#64748b" }}>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ ...S.filterBtn(false), opacity: page === totalPages ? 0.4 : 1 }}>Next {"\u2192"}</button>
        </div>
      )}
    </div>
  );
}