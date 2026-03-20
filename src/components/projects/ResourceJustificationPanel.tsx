"use client";

import React, { useState, useTransition } from "react";
import type {
  ResourceJustification,
  ResourceBudgetSummary,
  OpenCR,
} from "@/app/projects/[id]/resource-justification-actions";
import {
  saveResourceJustification,
  sendJustificationToResourceTeam,
  generateAiJustification,
} from "@/app/projects/[id]/resource-justification-actions";

/* ── Types ── */
type RoleReq = {
  id: string;
  role: string;
  required_days: number | null;
  filled_days: number | null;
};

type FundingSource = "existing_budget" | "change_request" | "contingency" | "finance_exception";

/* ── Default rate card (£/day) — PM can override per role inline ── */
const DEFAULT_RATE_CARD: Record<string, number> = {
  "Project Manager": 650, "Senior Project Manager": 750,
  "Delivery Manager": 650, "Senior Delivery Manager": 750,
  "Product Manager": 700,
  "Engineer": 600, "Senior Engineer": 750, "Lead Engineer": 850, "Principal Engineer": 950,
  "Architect": 900, "Designer": 550, "Senior Designer": 650,
  "Analyst": 500, "Data Scientist": 700,
  "QA Engineer": 550, "DevOps Engineer": 650, "Consultant": 800,
};

function getRateForRole(role: string): number {
  if (DEFAULT_RATE_CARD[role]) return DEFAULT_RATE_CARD[role];
  const key = Object.keys(DEFAULT_RATE_CARD).find(k =>
    role.toLowerCase().includes(k.toLowerCase()) || k.toLowerCase().includes(role.toLowerCase())
  );
  return key ? DEFAULT_RATE_CARD[key] : 600;
}

/* ── Icons ── */
function Icon({ d, size = 16, color = "currentColor" }: { d: string; size?: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}
const ICONS = {
  send:        "M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z",
  save:        "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8",
  wand:        "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z",
  check:       "M20 6L9 17l-5-5",
  alert:       "M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0-3.42 0zM12 9v4M12 17h.01",
  refresh:     "M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15",
  chevronDown: "M6 9l6 6 6-6",
  lock:        "M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4",
  users:       "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75M9 7a4 4 0 1 1 0-8 4 4 0 0 1 0 8z",
};

/* ── Funding sources ── */
const FUNDING_SOURCES: { key: FundingSource; label: string; desc: string; color: string; bg: string; border: string }[] = [
  { key: "existing_budget",   label: "Existing Budget",         desc: "Funded from current approved project budget",      color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
  { key: "change_request",    label: "Change Request (CR)",     desc: "Budget uplift via a formal change request",         color: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  { key: "contingency",       label: "Contingency",             desc: "Draw from the project contingency reserve",         color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
  { key: "finance_exception", label: "Finance Team Exception",  desc: "Escalate to Finance for an exceptional approval",   color: "#7c3aed", bg: "#faf5ff", border: "#e9d5ff" },
];

/* ── Status badge ── */
function StatusBadge({ status }: { status: ResourceJustification["status"] }) {
  const map: Record<string, { bg: string; text: string; label: string }> = {
    draft:        { bg: "#f1f5f9", text: "#475569",  label: "Draft" },
    sent:         { bg: "#eff6ff", text: "#1d4ed8",  label: "Sent to resource team" },
    acknowledged: { bg: "#fefce8", text: "#854d0e",  label: "Acknowledged" },
    approved:     { bg: "#f0fdf4", text: "#15803d",  label: "Approved" },
    rejected:     { bg: "#fef2f2", text: "#b91c1c",  label: "Rejected" },
  };
  const c = map[status] || map.draft;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 600, background: c.bg, color: c.text }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: c.text }} />
      {c.label}
    </span>
  );
}

/* ── Role budget row with inline rate editing ── */
function RoleBudgetRow({ role, rateOverrides, onRateChange, canEdit }: {
  role: RoleReq;
  rateOverrides: Record<string, number>;
  onRateChange: (id: string, rate: number) => void;
  canEdit: boolean;
}) {
  const [editingRate, setEditingRate] = useState(false);
  const [draftRate, setDraftRate] = useState("");
  const unfilled = Math.max(0, (role.required_days ?? 0) - (role.filled_days ?? 0));
  const rate = rateOverrides[role.id] ?? getRateForRole(role.role);
  const totalCost = unfilled * rate;
  const isFilled = unfilled === 0;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "10px 14px", borderRadius: 8, marginBottom: 6,
      background: isFilled ? "#f8fafc" : "#fffbeb",
      border: `1px solid ${isFilled ? "#e2e8f0" : "#fde68a"}`,
    }}>
      <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: isFilled ? "#22c55e" : "#f59e0b" }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "#0f172a" }}>{role.role}</div>
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1 }}>
          {role.required_days ?? 0}d required · {role.filled_days ?? 0}d filled
          {unfilled > 0 && <span style={{ color: "#d97706", fontWeight: 600 }}> · {unfilled}d unfilled</span>}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        {editingRate && canEdit ? (
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>£</span>
            <input
              type="number"
              value={draftRate}
              autoFocus
              onChange={e => setDraftRate(e.target.value)}
              onBlur={() => {
                const v = Number(draftRate);
                if (v > 0) onRateChange(role.id, v);
                setEditingRate(false);
              }}
              onKeyDown={e => {
                if (e.key === "Enter") { const v = Number(draftRate); if (v > 0) onRateChange(role.id, v); setEditingRate(false); }
                if (e.key === "Escape") setEditingRate(false);
              }}
              style={{ width: 70, padding: "3px 6px", borderRadius: 6, border: "1.5px solid #2563eb", fontSize: 12, fontFamily: "monospace", outline: "none" }}
            />
            <span style={{ fontSize: 11, color: "#94a3b8" }}>/d</span>
          </div>
        ) : (
          <div
            onClick={() => { if (canEdit && !isFilled) { setDraftRate(String(rate)); setEditingRate(true); } }}
            style={{ cursor: canEdit && !isFilled ? "pointer" : "default" }}
            title={canEdit && !isFilled ? "Click to edit day rate" : ""}
          >
            <div style={{ fontSize: 12, fontWeight: 500, color: "#64748b", fontFamily: "monospace" }}>
              £{rate.toLocaleString("en-GB")}/d
              {canEdit && !isFilled && <span style={{ marginLeft: 4, fontSize: 10, color: "#94a3b8" }}>✎</span>}
            </div>
            {!isFilled && (
              <div style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", fontFamily: "monospace" }}>
                £{totalCost.toLocaleString("en-GB")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Main component ── */
export default function ResourceJustificationPanel({
  projectId, projectTitle, initialJustification, budgetSummary,
  openCRs, roleRequirements, allocatedDays, budgetDays, weeklyBurnRate, canEdit,
}: {
  projectId: string;
  projectTitle: string;
  initialJustification: ResourceJustification | null;
  budgetSummary: ResourceBudgetSummary | null;
  openCRs: OpenCR[];
  roleRequirements: RoleReq[];
  allocatedDays: number;
  budgetDays: number;
  weeklyBurnRate: number;
  canEdit: boolean;
}) {
  const [justification, setJustification] = useState(initialJustification);
  const [justText, setJustText]             = useState(initialJustification?.justification_text || "");
  const [contingency, setContingency]       = useState(initialJustification?.contingency_notes || "");
  const [uplift, setUplift]                 = useState(initialJustification?.requested_budget_uplift?.toString() || "");
  const [selectedCRs, setSelectedCRs]       = useState<Set<string>>(new Set(initialJustification?.linked_cr_ids || []));
  const [fundingSource, setFundingSource]   = useState<FundingSource>("existing_budget");
  const [notifyEmails, setNotifyEmails]     = useState<string[]>([""]);
  const [rateOverrides, setRateOverrides]   = useState<Record<string, number>>({});
  const [expanded, setExpanded]             = useState(!initialJustification || initialJustification.status === "draft");
  const [saveMsg, setSaveMsg]               = useState<string | null>(null);
  const [sendMsg, setSendMsg]               = useState<string | null>(null);
  const [aiLoading, setAiLoading]           = useState(false);
  const [isPending, startTransition]        = useTransition();

  const unfilledRoles     = roleRequirements.filter(r => (r.required_days ?? 0) > (r.filled_days ?? 0));
  const totalUnfilledDays = unfilledRoles.reduce((s, r) => s + Math.max(0, (r.required_days ?? 0) - (r.filled_days ?? 0)), 0);
  const totalUnfilledCost = unfilledRoles.reduce((s, r) => {
    const unfilled = Math.max(0, (r.required_days ?? 0) - (r.filled_days ?? 0));
    return s + unfilled * (rateOverrides[r.id] ?? getRateForRole(r.role));
  }, 0);
  const remainingBudgetGbp  = budgetSummary?.remainingGbp ?? null;
  const canFundFromBudget   = remainingBudgetGbp !== null && remainingBudgetGbp >= totalUnfilledCost && totalUnfilledCost > 0;
  const alreadySent         = ["sent","acknowledged","approved"].includes(justification?.status ?? "");
  const selectedFunding     = FUNDING_SOURCES.find(f => f.key === fundingSource)!;

  function toggleCR(id: string) {
    setSelectedCRs(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }

  async function handleAIDraft() {
    setAiLoading(true);
    try {
      const result = await generateAiJustification(projectId, {
        roleRequirements, allocatedDays, budgetDays,
        remainingBudgetGbp,
        budgetGbp: budgetSummary?.budgetGbp ?? null,
        openCRs: openCRs.filter(cr => selectedCRs.has(cr.id)),
        projectTitle, weeklyBurnRate,
      });
      if (result.ok && result.text) setJustText(result.text);
    } catch {}
    setAiLoading(false);
  }

  function buildPayload() {
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("justification_text", justText);
    fd.set("contingency_notes", contingency);
    fd.set("requested_budget_uplift", uplift || String(fundingSource !== "existing_budget" ? totalUnfilledCost : 0));
    fd.set("linked_cr_ids", Array.from(selectedCRs).join(","));
    fd.set("currency", "GBP");
    fd.set("notify_emails", notifyEmails.filter(e => e.trim()).join(","));
    return fd;
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveResourceJustification(buildPayload());
      if (result.ok) { setSaveMsg("Saved"); setTimeout(() => setSaveMsg(null), 2500); }
    });
  }

  function handleSend() {
    if (!justText.trim()) return;
    startTransition(async () => {
      // Save first — this returns the record id even on first save
      const saved = await saveResourceJustification(buildPayload());
      if (!saved.ok) { setSendMsg(`Save failed: ${saved.error}`); return; }

      // Use returned id, or fall back to existing justification id
      const recordId = saved.id ?? justification?.id ?? null;
      if (!recordId) {
        setSendMsg("Could not determine record ID — please reload and try again.");
        return;
      }

      const validEmails = notifyEmails.filter(e => e.trim().includes("@"));
      const result = await sendJustificationToResourceTeam(projectId, recordId, validEmails);
      if (result.ok) {
        setJustification(prev =>
          prev ? { ...prev, status: "sent", sent_at: new Date().toISOString() } :
          { id: recordId, project_id: projectId, justification_text: justText, contingency_notes: contingency, requested_budget_uplift: uplift ? Number(uplift) : null, currency: "GBP", linked_cr_ids: Array.from(selectedCRs), status: "sent", sent_at: new Date().toISOString(), sent_by: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        );
        const notified = (result as any).notifiedCount ?? 0;
        const emailed  = (result as any).emailsSent ?? 0;
        const parts = [];
        if (notified > 0) parts.push(`${notified} in-app notification${notified > 1 ? "s" : ""}`);
        if (emailed > 0)  parts.push(`${emailed} email${emailed > 1 ? "s" : ""} sent`);
        setSendMsg(parts.length > 0 ? `Sent ✓ — ${parts.join(" · ")}` : "Sent to resource team ✓");
        setTimeout(() => setSendMsg(null), 7000);
      } else {
        setSendMsg(`Failed: ${result.error}`);
      }
    });
  }

  return (
    <div style={{ background: "#fff", border: "1px solid #e2e8f0", borderRadius: 12, overflow: "hidden", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <style>{`
        .rj-textarea { width:100%;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;font-size:13px;font-family:inherit;color:#0f172a;line-height:1.7;resize:vertical;background:#f8fafc;outline:none;transition:border-color 0.15s,box-shadow 0.15s;box-sizing:border-box; }
        .rj-textarea:focus { border-color:#2563eb;box-shadow:0 0 0 3px rgba(37,99,235,0.08);background:#fff; }
        .rj-textarea:disabled { opacity:0.6;cursor:not-allowed; }
        .rj-input { border:1px solid #e2e8f0;border-radius:8px;padding:8px 12px;font-size:13px;font-family:inherit;color:#0f172a;background:#f8fafc;outline:none;transition:border-color 0.15s;box-sizing:border-box; }
        .rj-input:focus { border-color:#2563eb;background:#fff; }
        .rj-btn { display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;border:1px solid #e2e8f0;background:#fff;color:#374151;cursor:pointer;transition:all 0.15s;white-space:nowrap;font-family:inherit; }
        .rj-btn:hover:not(:disabled) { border-color:#cbd5e1;background:#f8fafc; }
        .rj-btn:disabled { opacity:0.45;cursor:not-allowed; }
        .rj-btn-dark { background:#0f172a;border-color:#0f172a;color:#fff; }
        .rj-btn-dark:hover:not(:disabled) { background:#1e293b; }
        .rj-btn-send { background:linear-gradient(135deg,#2563eb,#1d4ed8);border-color:#2563eb;color:#fff; }
        .rj-btn-send:hover:not(:disabled) { opacity:0.92;transform:translateY(-1px);box-shadow:0 4px 14px rgba(37,99,235,0.3); }
        .rj-btn-ai { background:linear-gradient(135deg,#7c3aed,#6d28d9);border-color:#7c3aed;color:#fff; }
        .rj-btn-ai:hover:not(:disabled) { opacity:0.92; }
        @keyframes rj-spin { to { transform:rotate(360deg); } }
        .rj-spin { animation:rj-spin 1s linear infinite;display:inline-block; }
      `}</style>

      {/* Header */}
      <button type="button" onClick={() => setExpanded(v => !v)}
        style={{ width:"100%",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 20px",background:"transparent",border:"none",cursor:"pointer",borderBottom: expanded ? "1px solid #f1f5f9" : "none" }}>
        <div style={{ display:"flex",alignItems:"center",gap:12 }}>
          <div style={{ width:36,height:36,borderRadius:8,background:"linear-gradient(135deg,#eff6ff,#dbeafe)",border:"1px solid #bfdbfe",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
            <Icon d={ICONS.users} size={16} color="#2563eb" />
          </div>
          <div style={{ textAlign:"left" }}>
            <div style={{ fontSize:14,fontWeight:700,color:"#0f172a" }}>Resource Justification Request</div>
            <div style={{ fontSize:12,color:"#64748b",marginTop:2 }}>
              {unfilledRoles.length > 0
                ? `${unfilledRoles.length} unfilled role${unfilledRoles.length > 1 ? "s" : ""} · £${totalUnfilledCost.toLocaleString("en-GB")} at rate card`
                : "Document resource needs and request budget approval"}
            </div>
          </div>
        </div>
        <div style={{ display:"flex",alignItems:"center",gap:10 }}>
          {justification && <StatusBadge status={justification.status} />}
          <div style={{ transform: expanded ? "rotate(180deg)" : "rotate(0deg)",transition:"transform 0.2s" }}>
            <Icon d={ICONS.chevronDown} size={16} color="#94a3b8" />
          </div>
        </div>
      </button>

      {expanded && (
        <div style={{ padding:"20px" }}>

          {/* ── Role budget breakdown ── */}
          {roleRequirements.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10 }}>
                <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"#94a3b8" }}>
                  Role requirements · rate card
                </div>
                {canEdit && !alreadySent && (
                  <span style={{ fontSize:11,color:"#94a3b8" }}>Click a rate to edit</span>
                )}
              </div>
              {roleRequirements.map(r => (
                <RoleBudgetRow
                  key={r.id} role={r} rateOverrides={rateOverrides}
                  onRateChange={(id, rate) => setRateOverrides(prev => ({ ...prev, [id]: rate }))}
                  canEdit={canEdit && !alreadySent}
                />
              ))}
              {unfilledRoles.length > 0 && (
                <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 14px",borderRadius:8,background:"#0f172a",marginTop:4 }}>
                  <span style={{ fontSize:13,fontWeight:600,color:"#94a3b8" }}>Total unfilled cost at rate card</span>
                  <div>
                    <span style={{ fontSize:16,fontWeight:800,color:"#fff",fontFamily:"monospace" }}>
                      £{totalUnfilledCost.toLocaleString("en-GB")}
                    </span>
                    <span style={{ fontSize:11,color:"#64748b",marginLeft:8 }}>{totalUnfilledDays}d</span>
                  </div>
                </div>
              )}
            </div>
          )}

          <div style={{ height:1,background:"#f1f5f9",margin:"0 0 20px" }} />

          {/* ── Funding source ── */}
          <div style={{ marginBottom:20 }}>
            <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"#94a3b8",marginBottom:10 }}>
              Funding route
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:8 }}>
              {FUNDING_SOURCES.map(fs => {
                const sel = fundingSource === fs.key;
                return (
                  <button key={fs.key} type="button" disabled={alreadySent}
                    onClick={() => !alreadySent && setFundingSource(fs.key)}
                    style={{ padding:"12px 14px",borderRadius:9,border:`2px solid ${sel ? fs.color : "#e2e8f0"}`,background: sel ? fs.bg : "#fff",cursor: alreadySent ? "default" : "pointer",opacity: alreadySent ? 0.7 : 1,textAlign:"left",transition:"all 0.15s" }}>
                    <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:3 }}>
                      <span style={{ fontSize:13,fontWeight:700,color: sel ? fs.color : "#374151" }}>{fs.label}</span>
                      {sel && (
                        <span style={{ width:18,height:18,borderRadius:"50%",background:fs.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>
                          <Icon d={ICONS.check} size={10} color="#fff" />
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize:11,color:"#64748b" }}>{fs.desc}</div>
                  </button>
                );
              })}
            </div>

            {/* Feasibility indicator */}
            {fundingSource === "existing_budget" && unfilledRoles.length > 0 && (
              <div style={{ marginTop:10,padding:"10px 14px",borderRadius:8,background: canFundFromBudget ? "#f0fdf4" : "#fef2f2",border:`1px solid ${canFundFromBudget ? "#bbf7d0" : "#fecaca"}` }}>
                <span style={{ fontSize:12,fontWeight:600,color: canFundFromBudget ? "#15803d" : "#b91c1c" }}>
                  {remainingBudgetGbp !== null
                    ? canFundFromBudget
                      ? `✓ Existing budget can cover this — £${remainingBudgetGbp.toLocaleString("en-GB")} remaining vs £${totalUnfilledCost.toLocaleString("en-GB")} required`
                      : `✗ Insufficient budget — £${remainingBudgetGbp.toLocaleString("en-GB")} remaining, need £${totalUnfilledCost.toLocaleString("en-GB")}`
                    : "Set a budget on this project to see feasibility"
                  }
                </span>
              </div>
            )}
            {fundingSource === "change_request" && openCRs.length === 0 && (
              <div style={{ marginTop:10,padding:"10px 14px",borderRadius:8,background:"#fefce8",border:"1px solid #fde68a" }}>
                <span style={{ fontSize:12,color:"#92400e" }}>No open CRs found. Raise a Change Request first to link it as evidence.</span>
              </div>
            )}
          </div>

          {/* ── Link CRs (CR route) ── */}
          {fundingSource === "change_request" && openCRs.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"#94a3b8",marginBottom:8 }}>
                Link supporting change requests
              </div>
              <div style={{ display:"flex",gap:8,flexWrap:"wrap" }}>
                {openCRs.map(cr => {
                  const selected = selectedCRs.has(cr.id);
                  const dot = ({ approved:"#16a34a",open:"#d97706",pending:"#d97706",submitted:"#2563eb",draft:"#94a3b8" } as any)[cr.status.toLowerCase()] || "#94a3b8";
                  return (
                    <button key={cr.id} type="button"
                      onClick={() => canEdit && !alreadySent && toggleCR(cr.id)}
                      style={{ display:"inline-flex",alignItems:"center",gap:7,padding:"6px 12px",borderRadius:8,fontSize:12,fontWeight:500,border: selected ? "1.5px solid #2563eb" : "1px solid #e2e8f0",background: selected ? "#eff6ff" : "#fff",color: selected ? "#1d4ed8" : "#374151",cursor:"pointer" }}>
                      <span style={{ width:7,height:7,borderRadius:"50%",background:dot,flexShrink:0 }} />
                      <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:220 }}>{cr.title}</span>
                      {cr.estimated_cost && <span style={{ fontSize:11,color:"#94a3b8",flexShrink:0 }}>£{Number(cr.estimated_cost).toLocaleString("en-GB")}</span>}
                      {selected && <span style={{ fontSize:11,background:"#2563eb",color:"#fff",borderRadius:4,padding:"1px 5px",flexShrink:0 }}>✓</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div style={{ height:1,background:"#f1f5f9",margin:"0 0 20px" }} />

          {/* ── Justification text ── */}
          <div style={{ marginBottom:16 }}>
            <div style={{ display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:8 }}>
              <label style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"#94a3b8" }}>Justification</label>
              {canEdit && (
                <button type="button" className="rj-btn rj-btn-ai" disabled={aiLoading || alreadySent} onClick={handleAIDraft} style={{ padding:"5px 12px",fontSize:12 }}>
                  {aiLoading ? <span className="rj-spin"><Icon d={ICONS.refresh} size={13} color="#fff" /></span> : <Icon d={ICONS.wand} size={13} color="#fff" />}
                  {aiLoading ? "Drafting..." : "AI draft"}
                </button>
              )}
            </div>
            <textarea className="rj-textarea" rows={5} disabled={!canEdit || alreadySent} value={justText} onChange={e => setJustText(e.target.value)}
              placeholder={`Explain why the ${unfilledRoles.length} unfilled role${unfilledRoles.length !== 1 ? "s" : ""} are needed. Reference the current plan, burn rate, delivery impact, and why the ${selectedFunding.label.toLowerCase()} route is the right approach.`} />
            <p style={{ margin:"4px 0 0",fontSize:11,color:"#94a3b8" }}>Be specific — name milestones at risk, reference the rate card cost above, and state the consequence of not approving.</p>
          </div>

          {/* ── Contingency ── */}
          <div style={{ marginBottom:16 }}>
            <label style={{ display:"block",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"#94a3b8",marginBottom:8 }}>
              Contingency & risk if not approved
            </label>
            <textarea className="rj-textarea" rows={3} disabled={!canEdit || alreadySent} value={contingency} onChange={e => setContingency(e.target.value)}
              placeholder="What is the fallback plan? What delivery or commercial risk does this create if resource is not approved?" />
          </div>

          {/* ── Uplift amount (CR / Finance routes) ── */}
          {(fundingSource === "change_request" || fundingSource === "finance_exception") && (
            <div style={{ marginBottom:20 }}>
              <label style={{ display:"block",fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"#94a3b8",marginBottom:8 }}>Budget uplift requested (£)</label>
              <div style={{ display:"flex",alignItems:"center",gap:10 }}>
                <div style={{ position:"relative" }}>
                  <span style={{ position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",fontSize:13,color:"#94a3b8",fontWeight:500 }}>£</span>
                  <input type="number" className="rj-input" disabled={!canEdit || alreadySent} value={uplift} onChange={e => setUplift(e.target.value)}
                    placeholder={String(totalUnfilledCost || 0)} style={{ paddingLeft:28,width:160 }} />
                </div>
                {totalUnfilledCost > 0 && (
                  <button type="button" className="rj-btn" style={{ fontSize:12 }} onClick={() => setUplift(String(totalUnfilledCost))}>
                    Use rate card total · £{totalUnfilledCost.toLocaleString("en-GB")}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* ── Pre-send summary ── */}
          {!alreadySent && justText.trim() && (
            <div style={{ marginBottom:20,padding:"14px 16px",borderRadius:10,background:"#f8fafc",border:"1px solid #e2e8f0" }}>
              <div style={{ fontSize:11,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.07em",color:"#94a3b8",marginBottom:10 }}>Request summary</div>
              <div style={{ display:"flex",gap:12,flexWrap:"wrap" }}>
                {totalUnfilledDays > 0 && (
                  <div>
                    <div style={{ fontSize:10,color:"#94a3b8",marginBottom:2 }}>Days requested</div>
                    <div style={{ fontSize:18,fontWeight:800,color:"#0f172a",fontFamily:"monospace" }}>{totalUnfilledDays}d</div>
                  </div>
                )}
                {totalUnfilledCost > 0 && (
                  <div>
                    <div style={{ fontSize:10,color:"#94a3b8",marginBottom:2 }}>Rate card cost</div>
                    <div style={{ fontSize:18,fontWeight:800,color:"#0f172a",fontFamily:"monospace" }}>£{totalUnfilledCost.toLocaleString("en-GB")}</div>
                  </div>
                )}
                <div>
                  <div style={{ fontSize:10,color:"#94a3b8",marginBottom:2 }}>Funding route</div>
                  <div style={{ fontSize:13,fontWeight:700,color:selectedFunding.color,background:selectedFunding.bg,border:`1px solid ${selectedFunding.border}`,borderRadius:6,padding:"2px 8px",display:"inline-block" }}>{selectedFunding.label}</div>
                </div>
                {selectedCRs.size > 0 && (
                  <div>
                    <div style={{ fontSize:10,color:"#94a3b8",marginBottom:2 }}>CRs linked</div>
                    <div style={{ fontSize:18,fontWeight:800,color:"#0f172a",fontFamily:"monospace" }}>{selectedCRs.size}</div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Notify by email ── */}
          {!alreadySent && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8", marginBottom: 8 }}>
                Also notify by email (optional)
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {notifyEmails.map((email, i) => (
                  <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type="email"
                      className="rj-input"
                      value={email}
                      onChange={e => {
                        const next = [...notifyEmails];
                        next[i] = e.target.value;
                        setNotifyEmails(next);
                      }}
                      placeholder="name@company.com"
                      style={{ flex: 1 }}
                    />
                    {notifyEmails.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setNotifyEmails(prev => prev.filter((_, j) => j !== i))}
                        style={{ fontSize: 12, color: "#94a3b8", background: "none", border: "1px solid #e2e8f0", borderRadius: 6, padding: "6px 10px", cursor: "pointer" }}
                      >✕</button>
                    )}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setNotifyEmails(prev => [...prev, ""])}
                  style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "#2563eb", background: "none", border: "1.5px dashed #bfdbfe", borderRadius: 7, padding: "6px 14px", cursor: "pointer", width: "fit-content" }}
                >
                  + Add another email
                </button>
              </div>
              <p style={{ margin: "5px 0 0", fontSize: 11, color: "#94a3b8" }}>
                These recipients will receive an email copy of the justification in addition to in-app notifications.
              </p>
            </div>
          )}

          {/* ── Actions ── */}
          {canEdit && (
            <div style={{ display:"flex",alignItems:"center",gap:10,flexWrap:"wrap" }}>
              {!alreadySent && (
                <button type="button" className="rj-btn rj-btn-dark" disabled={isPending || !justText.trim()} onClick={handleSave}>
                  <Icon d={ICONS.save} size={14} color="#fff" />
                  {isPending ? "Saving..." : "Save draft"}
                </button>
              )}
              <button type="button" className="rj-btn rj-btn-send" disabled={isPending || !justText.trim() || alreadySent} onClick={handleSend}>
                {alreadySent ? <Icon d={ICONS.lock} size={14} color="#fff" /> : <Icon d={ICONS.send} size={14} color="#fff" />}
                {alreadySent ? "Sent to resource team" : "Send to resource team →"}
              </button>
              {saveMsg && (
                <span style={{ fontSize:13,color:"#16a34a",fontWeight:600,display:"flex",alignItems:"center",gap:5 }}>
                  <Icon d={ICONS.check} size={14} color="#16a34a" />{saveMsg}
                </span>
              )}
              {sendMsg && (
                <span style={{ fontSize:13,fontWeight:600,color: sendMsg.startsWith("Failed") || sendMsg.startsWith("Save") ? "#dc2626" : "#2563eb",display:"flex",alignItems:"center",gap:5 }}>
                  {sendMsg}
                </span>
              )}
            </div>
          )}

          {alreadySent && justification?.sent_at && (
            <div style={{ marginTop:16,padding:"10px 14px",borderRadius:8,background:"#eff6ff",border:"1px solid #bfdbfe",fontSize:12,color:"#1d4ed8" }}>
              <strong>Submitted</strong> to resource team on {new Date(justification.sent_at).toLocaleDateString("en-GB", { day:"numeric",month:"long",year:"numeric" })}.
              Funding route: <strong>{selectedFunding.label}</strong>.
            </div>
          )}

        </div>
      )}
    </div>
  );
}