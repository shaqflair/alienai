"use client";

import React, { useState, useTransition, useRef } from "react";
import type { RateCardEntry } from "./rate-card-actions";
import {
  upsertRateCardEntry,
  deleteRateCardEntry,
  toggleRateCardEntry,
  seedDefaultRateCard,
} from "./rate-card-actions";

const ROLES = [
  "Project Manager", "Delivery Manager", "Programme Manager",
  "Product Manager", "Business Analyst", "Analyst",
  "Engineer", "Senior Engineer", "Lead Engineer", "Principal Engineer",
  "Architect", "Solutions Architect",
  "Designer", "UX Designer", "Lead Designer",
  "Data Scientist", "Data Engineer",
  "QA Engineer", "DevOps Engineer", "Site Reliability Engineer",
  "Consultant", "Scrum Master", "Agile Coach",
  "Change Manager", "PMO Analyst",
];

const SENIORITY = ["Junior", "Mid", "Senior", "Lead", "Principal", "Director"];

const CURRENCY_SYMBOLS: Record<string, string> = {
  GBP: "£", USD: "$", EUR: "€",
};

function safeFormat(n: number, currency = "GBP") {
  const sym = CURRENCY_SYMBOLS[currency] ?? currency;
  return `${sym}${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function groupByRole(entries: RateCardEntry[]): Record<string, RateCardEntry[]> {
  return entries.reduce((acc, e) => {
    if (!acc[e.role_title]) acc[e.role_title] = [];
    acc[e.role_title].push(e);
    return acc;
  }, {} as Record<string, RateCardEntry[]>);
}

const SENIORITY_ORDER = ["Junior", "Mid", "Senior", "Lead", "Principal", "Director"];
function sortBySeniority(entries: RateCardEntry[]) {
  return [...entries].sort((a, b) =>
    SENIORITY_ORDER.indexOf(a.seniority_level) - SENIORITY_ORDER.indexOf(b.seniority_level)
  );
}

function seniorityColor(s: string): { bg: string; text: string } {
  const map: Record<string, { bg: string; text: string }> = {
    Junior:    { bg: "#f0fdf4", text: "#15803d" },
    Mid:       { bg: "#eff6ff", text: "#1d4ed8" },
    Senior:    { bg: "#faf5ff", text: "#7c3aed" },
    Lead:      { bg: "#fff7ed", text: "#c2410c" },
    Principal: { bg: "#fef2f2", text: "#b91c1c" },
    Director:  { bg: "#0f172a", text: "#f8fafc" },
  };
  return map[s] || { bg: "#f1f5f9", text: "#475569" };
}

// ── Add/Edit form ──
function EntryForm({
  orgId,
  entry,
  onSaved,
  onCancel,
}: {
  orgId: string;
  entry?: RateCardEntry;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [roleTitle, setRoleTitle] = useState(entry?.role_title ?? "");
  const [seniority, setSeniority] = useState(entry?.seniority_level ?? "Senior");
  const [dayRate, setDayRate]     = useState(entry?.day_rate?.toString() ?? "");
  const [currency, setCurrency]   = useState(entry?.currency ?? "GBP");
  const [notes, setNotes]          = useState(entry?.notes ?? "");
  const [error, setError]          = useState<string | null>(null);
  const [isPending, start]         = useTransition();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!roleTitle.trim()) { setError("Role title is required."); return; }
    if (!dayRate || Number(dayRate) <= 0) { setError("Day rate must be greater than zero."); return; }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("organisation_id", orgId);
      fd.set("role_title", roleTitle.trim());
      fd.set("seniority_level", seniority);
      fd.set("day_rate", dayRate);
      fd.set("currency", currency);
      fd.set("notes", notes);
      if (entry?.id) fd.set("entry_id", entry.id);
      const result = await upsertRateCardEntry(fd);
      if (result.ok) onSaved();
      else setError(result.error ?? "Save failed");
    });
  }

  const inputStyle: React.CSSProperties = {
    width: "100%", boxSizing: "border-box", padding: "9px 12px",
    border: "1.5px solid #e2e8f0", borderRadius: 8, fontSize: 13,
    color: "#0f172a", fontFamily: "inherit", outline: "none",
    background: "#f8fafc", transition: "border-color 0.15s",
  };

  return (
    <form onSubmit={handleSubmit} style={{ background: "#f8fafc", border: "1.5px solid #e2e8f0", borderRadius: 10, padding: 18, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
        {entry ? "Edit rate" : "Add new rate"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 160px", gap: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 5 }}>Role title</label>
          <div style={{ position: "relative" }}>
            <input
              list="rate-role-list"
              value={roleTitle}
              onChange={e => setRoleTitle(e.target.value)}
              placeholder="e.g. Project Manager"
              style={inputStyle}
            />
            <datalist id="rate-role-list">
              {ROLES.map(r => <option key={r} value={r} />)}
            </datalist>
          </div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 5 }}>Seniority</label>
          <select value={seniority} onChange={e => setSeniority(e.target.value)} style={inputStyle}>
            {SENIORITY.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 10 }}>
        <div>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 5 }}>Day rate</label>
          <div style={{ position: "relative" }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", fontSize: 13, color: "#94a3b8", fontWeight: 600 }}>
              {CURRENCY_SYMBOLS[currency] ?? currency}
            </span>
            <input
              type="number"
              value={dayRate}
              onChange={e => setDayRate(e.target.value)}
              placeholder="0"
              min="1"
              style={{ ...inputStyle, paddingLeft: 28 }}
            />
          </div>
        </div>
        <div>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 5 }}>Currency</label>
          <select value={currency} onChange={e => setCurrency(e.target.value)} style={inputStyle}>
            <option value="GBP">GBP</option>
            <option value="USD">USD</option>
            <option value="EUR">EUR</option>
          </select>
        </div>
      </div>

      <div>
        <label style={{ display: "block", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 5 }}>Notes (optional)</label>
        <input
          type="text"
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="e.g. Contractor rate, includes expenses"
          style={inputStyle}
        />
      </div>

      {error && (
        <div style={{ fontSize: 12, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "8px 12px" }}>{error}</div>
      )}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={{ padding: "7px 16px", borderRadius: 7, border: "1.5px solid #e2e8f0", background: "white", fontSize: 12, fontWeight: 600, color: "#64748b", cursor: "pointer" }}>Cancel</button>
        <button type="submit" disabled={isPending} style={{ padding: "7px 20px", borderRadius: 7, border: "none", background: isPending ? "#94a3b8" : "#0f172a", color: "white", fontSize: 12, fontWeight: 700, cursor: isPending ? "not-allowed" : "pointer" }}>
          {isPending ? "Saving..." : entry ? "Save changes" : "Add rate"}
        </button>
      </div>
    </form>
  );
}

// ── Rate row ──
function RateRow({
  entry, orgId, isAdmin, onEdit, onRefresh,
}: {
  entry: RateCardEntry;
  orgId: string;
  isAdmin: boolean;
  onEdit: () => void;
  onRefresh: () => void;
}) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [isPending, start]           = useTransition();
  const sc = seniorityColor(entry.seniority_level);

  function handleDelete() {
    start(async () => {
      await deleteRateCardEntry(entry.id, orgId);
      onRefresh();
    });
  }

  function handleToggle() {
    start(async () => {
      await toggleRateCardEntry(entry.id, orgId, !entry.is_active);
      onRefresh();
    });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", borderBottom: "1px solid #f1f5f9", opacity: entry.is_active ? 1 : 0.45 }}>
      <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 9px", borderRadius: 20, background: sc.bg, color: sc.text, flexShrink: 0, minWidth: 64, textAlign: "center" }}>
        {entry.seniority_level}
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{entry.role_title}</div>
        {entry.notes && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>{entry.notes}</div>}
      </div>

      <div style={{ fontFamily: "monospace", fontSize: 15, fontWeight: 700, color: "#0f172a", flexShrink: 0 }}>
        {safeFormat(entry.day_rate, entry.currency)}<span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 400 }}>/d</span>
      </div>

      {isAdmin && (
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <button
            type="button"
            onClick={handleToggle}
            disabled={isPending}
            title={entry.is_active ? "Deactivate" : "Activate"}
            style={{ fontSize: 11, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 6, background: "white", color: "#64748b", cursor: "pointer" }}
          >
            {entry.is_active ? "⏸" : "▶"}
          </button>
          <button
            type="button"
            onClick={onEdit}
            style={{ fontSize: 11, color: "#00b8db", fontWeight: 600, padding: "4px 9px", border: "1px solid #bae6f0", borderRadius: 6, background: "white", cursor: "pointer" }}
          >Edit</button>
          {!confirmDel ? (
            <button type="button" onClick={() => setConfirmDel(true)} style={{ fontSize: 11, color: "#94a3b8", padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 6, background: "white", cursor: "pointer" }}>✕</button>
          ) : (
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 11, color: "#ef4444", fontWeight: 600 }}>Sure?</span>
              <button type="button" onClick={handleDelete} disabled={isPending} style={{ fontSize: 11, color: "white", fontWeight: 700, padding: "4px 8px", border: "none", borderRadius: 5, background: "#ef4444", cursor: "pointer" }}>Yes</button>
              <button type="button" onClick={() => setConfirmDel(false)} style={{ fontSize: 11, color: "#64748b", padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: 5, background: "white", cursor: "pointer" }}>No</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main component ──
export default function RateCardManager({
  orgId, orgName, initialEntries, isAdmin,
}: {
  orgId: string;
  orgName: string;
  initialEntries: RateCardEntry[];
  isAdmin: boolean;
}) {
  const [entries, setEntries]       = useState<RateCardEntry[]>(initialEntries);
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [seedMsg, setSeedMsg]       = useState<string | null>(null);
  const [isPending, start]          = useTransition();
  const [showInactive, setShowInactive] = useState(false);

  const filtered = entries.filter(e => {
    if (!showInactive && !e.is_active) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return e.role_title.toLowerCase().includes(q) || e.seniority_level.toLowerCase().includes(q);
  });

  const grouped = groupByRole(filtered);
  const roleGroups = Object.keys(grouped).sort();

  function handleRefresh() {
    window.location.reload();
  }

  function handleSeed() {
    start(async () => {
      const result = await seedDefaultRateCard(orgId);
      if (result.ok) {
        setSeedMsg(`${result.inserted} default rates added`);
        setTimeout(() => setSeedMsg(null), 3000);
        window.location.reload();
      }
    });
  }

  const totalActive   = entries.filter(e => e.is_active).length;
  const totalInactive = entries.filter(e => !e.is_active).length;
  const avgRate       = entries.filter(e => e.is_active).length > 0
    ? Math.round(entries.filter(e => e.is_active).reduce((s, e) => s + e.day_rate, 0) / entries.filter(e => e.is_active).length)
    : 0;

  return (
    <div style={{ fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=DM+Mono:wght@400;500&display=swap');
        .rc-search { width:100%; padding:9px 14px 9px 38px; border:1.5px solid #e2e8f0; border-radius:9px; font-size:13px; font-family:inherit; color:#0f172a; background:#f8fafc; outline:none; box-sizing:border-box; }
        .rc-search:focus { border-color:#00b8db; background:#fff; }
      `}</style>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#0f172a" }}>Rate Card</h1>
            <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
              Day rates for {orgName} · used in resource justification cost calculations
            </p>
          </div>
          {isAdmin && (
            <div style={{ display: "flex", gap: 8 }}>
              {entries.length === 0 && (
                <button
                  type="button"
                  onClick={handleSeed}
                  disabled={isPending}
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 8, border: "1.5px dashed #e2e8f0", background: "white", fontSize: 13, fontWeight: 600, color: "#64748b", cursor: isPending ? "not-allowed" : "pointer" }}
                >
                  ⚡ Load defaults
                </button>
              )}
              <button
                type="button"
                onClick={() => { setShowAddForm(s => !s); setEditingId(null); }}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 18px", borderRadius: 8, border: "none", background: showAddForm ? "#f1f5f9" : "#0f172a", color: showAddForm ? "#64748b" : "white", fontSize: 13, fontWeight: 700, cursor: "pointer" }}
              >
                {showAddForm ? "✕ Cancel" : "+ Add rate"}
              </button>
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
          {[
            { label: "Active rates", value: totalActive, color: "#0f172a" },
            { label: "Avg day rate", value: avgRate ? `£${avgRate.toLocaleString()}` : "—", color: "#00b8db" },
            { label: "Role types", value: new Set(entries.filter(e => e.is_active).map(e => e.role_title)).size, color: "#7c3aed" },
          ].map(stat => (
            <div key={stat.label} style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 9, padding: "10px 16px" }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 2 }}>{stat.label}</div>
              <div style={{ fontSize: 18, fontWeight: 800, color: stat.color, fontFamily: "'DM Mono', monospace" }}>{stat.value}</div>
            </div>
          ))}
        </div>
      </div>

      {seedMsg && (
        <div style={{ marginBottom: 16, padding: "10px 14px", borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", fontSize: 13, color: "#15803d", fontWeight: 500 }}>
          ✓ {seedMsg}
        </div>
      )}

      {showAddForm && isAdmin && (
        <div style={{ marginBottom: 20 }}>
          <EntryForm
            orgId={orgId}
            onSaved={() => { setShowAddForm(false); handleRefresh(); }}
            onCancel={() => setShowAddForm(false)}
          />
        </div>
      )}

      {entries.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center" }}>
          <div style={{ position: "relative", flex: 1 }}>
            <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 14 }}>⌕</span>
            <input
              className="rc-search"
              placeholder="Search roles..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
          </div>
          {totalInactive > 0 && (
            <button
              type="button"
              onClick={() => setShowInactive(s => !s)}
              style={{ padding: "8px 14px", borderRadius: 8, border: "1.5px solid #e2e8f0", background: showInactive ? "#0f172a" : "white", color: showInactive ? "white" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
            >
              {showInactive ? "Hide" : "Show"} inactive ({totalInactive})
            </button>
          )}
        </div>
      )}

      {entries.length === 0 ? (
        <div style={{ textAlign: "center", padding: "48px 24px", background: "#f8fafc", borderRadius: 12, border: "1.5px dashed #e2e8f0" }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", marginBottom: 6 }}>No rate card configured yet</div>
          <p style={{ fontSize: 13, color: "#64748b", margin: "0 0 20px" }}>
            Add day rates for each role and seniority level. These will be used automatically in resource justification calculations.
          </p>
          {isAdmin && (
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button type="button" onClick={handleSeed} disabled={isPending} style={{ padding: "9px 20px", borderRadius: 8, border: "1.5px dashed #e2e8f0", background: "white", fontSize: 13, fontWeight: 600, color: "#64748b", cursor: "pointer" }}>
                ⚡ Load default rates
              </button>
              <button type="button" onClick={() => setShowAddForm(true)} style={{ padding: "9px 20px", borderRadius: 8, border: "none", background: "#0f172a", color: "white", fontSize: 13, fontWeight: 700, cursor: "pointer" }}>
                + Add first rate
              </button>
            </div>
          )}
        </div>
      ) : roleGroups.length === 0 ? (
        <div style={{ textAlign: "center", padding: "32px", color: "#94a3b8", fontSize: 13 }}>
          No rates match your search.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {roleGroups.map(roleTitle => (
            <div key={roleTitle} style={{ background: "white", border: "1.5px solid #e2e8f0", borderRadius: 12, overflow: "hidden" }}>
              <div style={{ padding: "12px 14px", background: "#f8fafc", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{roleTitle}</span>
                <span style={{ fontSize: 11, color: "#94a3b8" }}>
                  {grouped[roleTitle].length} rate{grouped[roleTitle].length !== 1 ? "s" : ""}
                </span>
              </div>

              {sortBySeniority(grouped[roleTitle]).map(entry => (
                editingId === entry.id ? (
                  <div key={entry.id} style={{ padding: 14 }}>
                    <EntryForm
                      orgId={orgId}
                      entry={entry}
                      onSaved={() => { setEditingId(null); handleRefresh(); }}
                      onCancel={() => setEditingId(null)}
                    />
                  </div>
                ) : (
                  <RateRow
                    key={entry.id}
                    entry={entry}
                    orgId={orgId}
                    isAdmin={isAdmin}
                    onEdit={() => setEditingId(entry.id)}
                    onRefresh={handleRefresh}
                  />
                )
              ))}
            </div>
          ))}
        </div>
      )}

      {!isAdmin && entries.length > 0 && (
        <p style={{ marginTop: 20, fontSize: 12, color: "#94a3b8", textAlign: "center" }}>
          Rate card is read-only. Contact your organisation admin to make changes.
        </p>
      )}
    </div>
  );
}
