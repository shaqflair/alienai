"use client";

import React, { useState, useTransition } from "react";
import type {
  ResourceJustification,
  ResourceBudgetSummary,
  OpenCR,
} from "@/app/projects/[id]/resources/resource-actions";
import {
  saveResourceJustification,
  sendJustificationToResourceTeam,
  generateAiJustification,
} from "@/app/projects/[id]/resources/resource-actions";

/* ── Icons (inline SVG) ── */
function Icon({ d, size = 16, color = "currentColor" }: { d: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  sparkles: "M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18",
  send: "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  wand: "M15 4V2m0 2a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h12zM15 12V10m-3 2v-2m-3 2v-2M3 10h18M5 20l7-7 7 7",
  check: "M20 6L9 17l-5-5",
  alert: "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01",
  refresh: "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 7a4 4 0 1 1 0-8 4 4 0 0 1 0 8z",
  chevronDown: "M6 9l6 6 6-6",
  lock: "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4",
};

/* ── UI Components ── */
function BudgetBar({ pct, overBudget }: { pct: number; overBudget: boolean }) {
  const clamped = Math.min(pct, 100);
  const color = overBudget ? "#ef4444" : pct > 85 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ height: 6, background: "#e2e8f0", borderRadius: 99, overflow: "hidden" }}>
      <div style={{ height: "100%", width: `${clamped}%`, background: color, borderRadius: 99, transition: "width 0.6s ease" }} />
    </div>
  );
}

function StatPill({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 110 }}>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", color: "#94a3b8", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent || "#0f172a", fontFamily: "'Geist Mono', monospace", lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 3 }}>{sub}</div>}
    </div>
  );
}

function CRChip({ cr, selected, onToggle }: { cr: OpenCR; selected: boolean; onToggle: (id: string) => void }) {
  const statusColor: Record<string, string> = { approved: "#16a34a", open: "#d97706", pending: "#d97706", submitted: "#2563eb" };
  const dot = statusColor[cr.status.toLowerCase()] || "#94a3b8";
  return (
    <button type="button" onClick={() => onToggle(cr.id)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "6px 12px", borderRadius: 8, fontSize: 12, fontWeight: 500, border: selected ? "1.5px solid #2563eb" : "1px solid #e2e8f0", background: selected ? "#eff6ff" : "#fff", color: selected ? "#1d4ed8" : "#374151", cursor: "pointer", transition: "all 0.15s", textAlign: "left" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: dot, flexShrink: 0 }} />
      {cr.title}
    </button>
  );
}

function StatusBadge({ status }: { status: ResourceJustification["status"] }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    draft: { bg: "#f1f5f9", text: "#475569", label: "Draft" },
    sent: { bg: "#eff6ff", text: "#1d4ed8", label: "Sent" },
    approved: { bg: "#f0fdf4", text: "#15803d", label: "Approved" },
  };
  const c = map[status] || map.draft;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>
      {c.label}
    </span>
  );
}

export default function ResourceJustificationPanel({
  projectId,
  projectTitle,
  initialJustification,
  budgetSummary,
  openCRs,
  roleRequirements,
  allocatedDays,
  budgetDays,
  weeklyBurnRate,
  canEdit,
}: any) {
  const [justification, setJustification] = useState<ResourceJustification | null>(initialJustification);
  const [justText, setJustText] = useState(initialJustification?.justification_text || "");
  const [contingency, setContingency] = useState(initialJustification?.contingency_notes || "");
  const [uplift, setUplift] = useState(initialJustification?.requested_budget_uplift?.toString() || "");
  const [selectedCRs, setSelectedCRs] = useState<Set<string>>(new Set(initialJustification?.linked_cr_ids || []));
  const [expanded, setExpanded] = useState(!initialJustification || initialJustification.status === "draft");
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [isPending, startTransition] = useTransition();

  const unfilledCount = roleRequirements.filter((r: any) => (r.required_days ?? 0) > (r.filled_days ?? 0)).length;
  const dayShortfall = budgetDays > 0 ? budgetDays - allocatedDays : null;
  const overBudget = dayShortfall !== null && dayShortfall < 0;

  function toggleCR(id: string) {
    setSelectedCRs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function handleAIDraft() {
    setAiLoading(true);
    const result = await generateAiJustification(projectId, {
      roleRequirements, allocatedDays, budgetDays,
      remainingBudgetGbp: budgetSummary?.remainingGbp ?? null,
      budgetGbp: budgetSummary?.budgetGbp ?? null,
      openCRs: openCRs.filter((cr: any) => selectedCRs.has(cr.id)),
      projectTitle, weeklyBurnRate
    });
    if (result.ok && result.text) setJustText(result.text);
    setAiLoading(false);
  }

  function handleSave() {
    startTransition(async () => {
      const fd = new FormData();
      fd.set("project_id", projectId);
      fd.set("justification_text", justText);
      fd.set("contingency_notes", contingency);
      fd.set("requested_budget_uplift", uplift);
      fd.set("linked_cr_ids", Array.from(selectedCRs).join(","));
      const result = await saveResourceJustification(fd);
      if (result.ok) {
        setSaveMsg("Saved");
        setTimeout(() => setSaveMsg(null), 2500);
      }
    });
  }

  const alreadySent = justification?.status === "sent" || justification?.status === "approved";

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", fontFamily: "sans-serif" }}>
      <button type="button" onClick={() => setExpanded(!expanded)} style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", background: "transparent", border: "none", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Icon d={ICONS.users} color="#2563eb" />
          <div style={{ textAlign: "left" }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Resource Justification</div>
            <div style={{ fontSize: 12, color: "#64748b" }}>{unfilledCount} unfilled roles</div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {justification && <StatusBadge status={justification.status} />}
          <Icon d={ICONS.chevronDown} />
        </div>
      </button>

      {expanded && (
        <div style={{ padding: "20px", borderTop: "1px solid #f1f5f9" }}>
          <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
            <StatPill label="Allocated" value={`${allocatedDays}d`} accent={overBudget ? "#dc2626" : ""} />
            <StatPill label="Shortfall" value={`${Math.abs(dayShortfall || 0)}d`} sub={overBudget ? "over budget" : "remaining"} />
          </div>

          <div style={{ marginBottom: 20 }}>
             <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 8 }}>RESOURCES JUSTIFICATION</label>
             <textarea 
               style={{ width: "100%", padding: "12px", borderRadius: 8, border: "1px solid #e2e8f0", minHeight: "120px" }}
               value={justText}
               onChange={(e) => setJustText(e.target.value)}
               disabled={alreadySent}
             />
             <button onClick={handleAIDraft} disabled={aiLoading || alreadySent} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, background: "#7c3aed", color: "#fff", border: "none", cursor: "pointer" }}>
               {aiLoading ? "Generating..." : "AI Draft"}
             </button>
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={handleSave} disabled={isPending || alreadySent} style={{ padding: "8px 16px", borderRadius: 8, background: "#0f172a", color: "#fff", border: "none", cursor: "pointer" }}>
              {isPending ? "Saving..." : "Save Draft"}
            </button>
            {saveMsg && <span style={{ color: "#16a34a", fontSize: 13 }}>{saveMsg}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
