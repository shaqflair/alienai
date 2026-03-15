// src/components/artifacts/FinancialPlanAuditTrail.tsx
"use client";

import React, { useEffect, useState, useCallback } from "react";

/* ?????????????????????????????????????????????????????????????
   TYPES
????????????????????????????????????????????????????????????? */
type AuditEntry = {
  id:          string;
  action:      string;           // derived from section/items
  actor_id:    string | null;
  actor_name?: string | null;    // actor_email from route
  before:      any;
  after:       any;
  summaries:   string[];         // grouped summaries from route
  item_count:  number;
  items:       any[];            // raw items in the group
  created_at:  string;
};

// Infer a financial_plan.* action from a content event group
function inferAction(ev: any): string {
  const items: any[] = ev.items ?? [];
  const summaries: string[] = ev.summaries ?? [];
  const all = [...summaries, ev.title ?? ""].join(" ").toLowerCase();
  if (all.includes("line added")   || all.includes("added"))   return "financial_plan.line_added";
  if (all.includes("line removed") || all.includes("deleted")) return "financial_plan.line_deleted";
  if (all.includes("budget"))                                  return "financial_plan.budget_changed";
  if (all.includes("line updated") || all.includes("edited"))  return "financial_plan.line_edited";
  if (all.includes("export"))                                  return "financial_plan.exported";
  return "financial_plan.saved";
}

/* ?????????????????????????????????????????????????????????????
   ACTION CONFIG
????????????????????????????????????????????????????????????? */
const ACTION_CFG: Record<string, { label: string; icon: string; color: string; bg: string; border: string }> = {
  "financial_plan.saved":           { label: "Saved",           icon: "??", color: "#475569", bg: "#f8fafc", border: "#e2e8f0" },
  "financial_plan.line_added":      { label: "Line added",      icon: "?", color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "financial_plan.line_edited":     { label: "Line edited",     icon: "??", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  "financial_plan.line_deleted":    { label: "Line removed",    icon: "??", color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
  "financial_plan.budget_changed":  { label: "Budget changed",  icon: "??", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  "financial_plan.category_changed":{ label: "Category changed",icon: "??", color: "#0891b2", bg: "#ecfeff", border: "#a5f3fc" },
  "financial_plan.exported":        { label: "Exported",        icon: "??", color: "#0e7490", bg: "#ecfeff", border: "#a5f3fc" },
  "financial_plan.version_locked":  { label: "Version locked",  icon: "??", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  "submit":                         { label: "Submitted",       icon: "??", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  "resubmit":                       { label: "Resubmitted",     icon: "??", color: "#2563eb", bg: "#eff6ff", border: "#bfdbfe" },
  "approve":                        { label: "Approved",        icon: "?", color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "approve_step":                   { label: "Step approved",   icon: "?",  color: "#059669", bg: "#f0fdf4", border: "#bbf7d0" },
  "request_changes":                { label: "Changes requested",icon: "?", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  "reject_final":                   { label: "Rejected",        icon: "?", color: "#dc2626", bg: "#fff5f5", border: "#fecaca" },
  "baseline_promoted":              { label: "Baseline created", icon: "??", color: "#7c3aed", bg: "#f5f3ff", border: "#ddd6fe" },
  "rename_title":                   { label: "Renamed",         icon: "??", color: "#475569", bg: "#f8fafc", border: "#e2e8f0" },
};

function cfgFor(action: string) {
  return ACTION_CFG[action] ?? {
    label: action.replace(/[._]/g, " ").replace(/\b\w/g, c => c.toUpperCase()),
    icon: "??", color: "#475569", bg: "#f8fafc", border: "#e2e8f0",
  };
}

/* ?????????????????????????????????????????????????????????????
   FORMATTERS
????????????????????????????????????????????????????????????? */
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
    if (mins < 1)   return "just now";
    if (mins < 60)  return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)   return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7)   return `${days}d ago`;
    return fmtDateTime(iso);
  } catch { return iso; }
}

function fmtCurrency(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
}

/* ?????????????????????????????????????????????????????????????
   DIFF DETAIL PANEL
????????????????????????????????????????????????????????????? */
function DiffDetail({ entry }: { entry: AuditEntry }) {
  // Summaries come from the grouped event; items hold individual diffs
  const summaries = entry.summaries ?? [];
  const items     = entry.items     ?? [];

  // Pull financial plan diff from first content item's after field
  const firstItem  = items.find((i: any) => i.kind === "content") ?? items[0];
  const after      = firstItem?.after  ?? entry.after  ?? null;
  const before     = firstItem?.before ?? entry.before ?? null;

  const linesAdded  = Array.isArray(after?.linesAdded)  ? after.linesAdded  : [];
  const linesEdited = Array.isArray(after?.linesEdited) ? after.linesEdited : [];
  const budgetBefore = before?.budget ?? null;
  const budgetAfter  = after?.budget  ?? null;
  const budgetChanged = budgetBefore !== budgetAfter && (budgetBefore != null || budgetAfter != null);

  // Approval items
  const approvalItems = items.filter((i: any) => i.kind === "approval");
  const reason = after?.reason ?? before?.rejection_reason ?? null;

  const hasContent = summaries.length > 0 || linesAdded.length > 0 || linesEdited.length > 0 || budgetChanged || approvalItems.length > 0;
  if (!hasContent) return null;

  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      {/* Summaries from grouped events */}
      {summaries.map((s, i) => (
        <div key={i} style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>{s}</div>
      ))}

      {/* Budget change */}
      {budgetChanged && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
          <span style={{ color: "#dc2626", textDecoration: "line-through" }}>{fmtCurrency(budgetBefore)}</span>
          <span style={{ color: "#94a3b8" }}>?</span>
          <span style={{ color: "#059669", fontWeight: 700 }}>{fmtCurrency(budgetAfter)}</span>
        </div>
      )}

      {/* Lines added */}
      {linesAdded.slice(0, 5).map((l: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ color: "#059669", fontWeight: 700 }}>+</span>
          <span style={{ color: "#0f172a" }}>{l?.label ?? l?.name ?? "New line"}</span>
          {l?.amount != null && <span style={{ marginLeft: "auto", color: "#059669", fontWeight: 700 }}>{fmtCurrency(l.amount)}</span>}
        </div>
      ))}

      {/* Lines edited */}
      {linesEdited.slice(0, 5).map((e: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11 }}>
          <span style={{ color: "#d97706", fontWeight: 700 }}>~</span>
          <span style={{ color: "#0f172a" }}>{e?.after?.label ?? e?.before?.label ?? "Line"}</span>
          {e?.before?.amount != null && e?.after?.amount != null && (
            <span style={{ marginLeft: "auto", color: "#94a3b8" }}>
              {fmtCurrency(e.before.amount)} ? <span style={{ color: "#d97706", fontWeight: 700 }}>{fmtCurrency(e.after.amount)}</span>
            </span>
          )}
        </div>
      ))}

      {/* Approval steps */}
      {approvalItems.map((ai: any, i: number) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
          <span style={{ color: "#94a3b8" }}>{ai.action_label ?? ai.action}</span>
          {ai.step_name && <span style={{ color: "#64748b" }}>· {ai.step_name}</span>}
        </div>
      ))}

      {reason && (
        <div style={{ fontSize: 11, color: "#dc2626", fontStyle: "italic" }}>Reason: {reason}</div>
      )}
    </div>
  );
}

/* ?????????????????????????????????????????????????????????????
   ENTRY ROW
????????????????????????????????????????????????????????????? */
function EntryRow({ entry, expanded, onToggle }: {
  entry: AuditEntry;
  expanded: boolean;
  onToggle: () => void;
}) {
  const cfg  = cfgFor(entry.action);
  const hasDetail = entry.item_count > 0 || entry.summaries?.length > 0;

  return (
    <div style={{
      borderRadius: 10, border: `1px solid ${cfg.border}`,
      background: cfg.bg, overflow: "hidden",
      transition: "box-shadow 0.1s",
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
        {/* Icon */}
        <span style={{ fontSize: 14, flexShrink: 0 }}>{cfg.icon}</span>

        {/* Label + actor */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: cfg.color }}>{cfg.label}</span>
            {entry.actor_name && (
              <span style={{ fontSize: 11, color: "#64748b" }}>by {entry.actor_name}</span>
            )}
          </div>
          {/* Summary line */}
          {entry.summaries?.length > 0 && !expanded && (
            <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {entry.summaries[0]}
            </div>
          )}
        </div>

        {/* Timestamp */}
        <div style={{ flexShrink: 0, textAlign: "right" }}>
          <div style={{ fontSize: 11, color: "#94a3b8" }}>{fmtRelative(entry.created_at)}</div>
          <div style={{ fontSize: 10, color: "#cbd5e1" }}>{fmtDateTime(entry.created_at)}</div>
        </div>

        {/* Expand chevron */}
        {hasDetail && (
          <span style={{ color: "#94a3b8", fontSize: 10, flexShrink: 0 }}>
            {expanded ? "?" : "?"}
          </span>
        )}
      </button>

      {/* Expanded detail */}
      {expanded && hasDetail && (
        <div style={{ padding: "0 14px 12px", borderTop: `1px solid ${cfg.border}` }}>
          <DiffDetail entry={entry} />
        </div>
      )}
    </div>
  );
}

/* ?????????????????????????????????????????????????????????????
   FILTER BAR
????????????????????????????????????????????????????????????? */
type FilterType = "all" | "changes" | "approval" | "exports";

const FILTER_GROUPS: Record<FilterType, string[]> = {
  all:      [],
  changes:  ["financial_plan.line_added","financial_plan.line_edited","financial_plan.line_deleted","financial_plan.budget_changed","financial_plan.category_changed","financial_plan.saved"],
  approval: ["submit","resubmit","approve","approve_step","request_changes","reject_final","baseline_promoted"],
  exports:  ["financial_plan.exported"],
};

/* ?????????????????????????????????????????????????????????????
   MAIN COMPONENT
????????????????????????????????????????????????????????????? */
export default function FinancialPlanAuditTrail({
  projectId,
  artifactId,
}: {
  projectId:  string;
  artifactId: string;
}) {
  const [entries,    setEntries]    = useState<AuditEntry[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState<string | null>(null);
  const [filter,     setFilter]     = useState<FilterType>("all");
  const [expanded,   setExpanded]   = useState<Set<string>>(new Set());
  const [page,       setPage]       = useState(1);
  const PAGE_SIZE = 20;

  const load = useCallback(async () => {
    if (!projectId || !artifactId) return;
    setLoading(true);
    setError(null);
    try {
      // Existing route: src/app/api/artifacts/audit/route.ts
      // Uses artifact_id query param; returns { ok, events[] } grouped by request_id / minute
      const res = await fetch(
        `/api/artifacts/audit?artifact_id=${encodeURIComponent(artifactId)}`,
        { cache: "no-store" }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json?.ok) throw new Error(json?.error ?? "Failed to load audit trail");
      // Flatten grouped events into individual items for our timeline
      const rawEvents: any[] = Array.isArray(json.events) ? json.events : [];
      const flat: AuditEntry[] = rawEvents.map((ev: any) => ({
        id:          String(ev.group_key ?? ev.created_at),
        action:      ev.section === "approval"
                       ? (ev.items?.[0]?.action ?? ev.title ?? "approval")
                       : inferAction(ev),
        actor_id:    ev.actor_id   ?? null,
        actor_name:  ev.actor_email ?? null,
        before:      ev.items?.[0]?.before  ?? null,
        after:       ev.items?.[0]?.after   ?? null,
        summaries:   ev.summaries ?? [],
        item_count:  ev.item_count ?? 1,
        items:       ev.items ?? [],
        created_at:  ev.created_at,
      }));
      setEntries(flat);
    } catch (e: any) {
      setError(e?.message ?? "Could not load audit trail");
    } finally {
      setLoading(false);
    }
  }, [projectId, artifactId]);

  useEffect(() => { void load(); }, [load]);

  function toggleExpanded(id: string) {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Filter
  const filtered = filter === "all"
    ? entries
    : entries.filter(e => FILTER_GROUPS[filter].includes(e.action));

  // Paginate
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const S = {
    wrap:   { fontFamily: "inherit" } as React.CSSProperties,
    header: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap" as const, gap: 8 },
    title:  { fontSize: 14, fontWeight: 700, color: "#0d1117", margin: 0 },
    filterRow: { display: "flex", gap: 6, flexWrap: "wrap" as const },
    filterBtn: (active: boolean): React.CSSProperties => ({
      padding: "4px 10px", borderRadius: 6, border: "1px solid",
      borderColor: active ? "#0e7490" : "#e2e8f0",
      background:  active ? "#ecfeff" : "#ffffff",
      color:        active ? "#0e7490" : "#64748b",
      fontSize: 11, fontWeight: active ? 700 : 500,
      cursor: "pointer", fontFamily: "inherit",
    }),
  };

  return (
    <div style={S.wrap}>
      {/* Header */}
      <div style={S.header}>
        <p style={S.title}>Audit trail</p>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" onClick={load} title="Refresh" style={{ ...S.filterBtn(false), padding: "4px 8px" }}>?</button>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>
            {filtered.length} event{filtered.length !== 1 ? "s" : ""}
            {filtered.reduce((s, e) => s + (e.item_count ?? 1), 0) > filtered.length
              ? ` (${filtered.reduce((s, e) => s + (e.item_count ?? 1), 0)} actions)`
              : ""}
          </span>
        </div>
      </div>

      {/* Filters */}
      <div style={{ ...S.filterRow, marginBottom: 14 }}>
        {(["all","changes","approval","exports"] as FilterType[]).map(f => (
          <button key={f} type="button" onClick={() => { setFilter(f); setPage(1); }} style={S.filterBtn(filter === f)}>
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      {/* States */}
      {loading && (
        <div style={{ padding: "32px 0", textAlign: "center", fontSize: 13, color: "#94a3b8" }}>
          Loading audit trail…
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
            style={{ ...S.filterBtn(false), opacity: page === 1 ? 0.4 : 1 }}>? Prev</button>
          <span style={{ fontSize: 11, color: "#64748b" }}>Page {page} of {totalPages}</span>
          <button type="button" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            style={{ ...S.filterBtn(false), opacity: page === totalPages ? 0.4 : 1 }}>Next ?</button>
        </div>
      )}
    </div>
  );
}