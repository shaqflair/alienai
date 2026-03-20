"use client";
import React from "react";
// FILE: src/app/projects/[id]/_components/ProjectResourcePanel.tsx

import { useState, useTransition } from "react";
import type {
  ProjectResourceData, TeamMember, AllocationRow,
  RoleRequirement, BudgetSummary, WeekPeriod,
} from "../_lib/resource-data";
import { insertRoleRequirements, deleteRoleRequirement, updateRoleRequirement } from "../../actions";
import { updateAllocation, deleteAllocationDirect } from "../../../allocations/actions";
import ResourceJustificationPanel from "@/components/projects/ResourceJustificationPanel";
import type { ResourceJustification, OpenCR } from "@/app/projects/[id]/resource-justification-actions";

const UTIL_COLOURS = {
  empty:    { bg: "#f8fafc", text: "#cbd5e1", border: "#f1f5f9" },
  low:      { bg: "rgba(16,185,129,0.09)",  text: "#059669", border: "rgba(16,185,129,0.2)" },
  mid:      { bg: "rgba(245,158,11,0.09)",  text: "#d97706", border: "rgba(245,158,11,0.2)" },
  high:     { bg: "rgba(239,68,68,0.09)",   text: "#dc2626", border: "rgba(239,68,68,0.2)" },
  critical: { bg: "rgba(124,58,237,0.09)",  text: "#7c3aed", border: "rgba(124,58,237,0.2)" },
};

function utilTier(pct: number) {
  if (pct === 0)  return "empty";
  if (pct < 75)   return "low";
  if (pct < 95)   return "mid";
  if (pct <= 110) return "high";
  return "critical";
}

function utilColour(pct: number) {
  if (pct > 110) return "#7c3aed";
  if (pct > 100) return "#ef4444";
  if (pct >= 75) return "#f59e0b";
  if (pct > 0)   return "#10b981";
  return "#cbd5e1";
}

function initials(name: string) {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

const AVATAR_COLS = [
  "#00b8db","#3b82f6","#8b5cf6","#ec4899",
  "#f59e0b","#10b981","#ef4444","#f97316",
];
function avatarCol(name: string) {
  return AVATAR_COLS[name.charCodeAt(0) % AVATAR_COLS.length];
}

function derivePeriodsFromAllocations(allocations: AllocationRow[]): WeekPeriod[] {
  const weekKeys = Array.from(new Set(allocations.map(a => a.weekStartDate)))
    .filter(Boolean)
    .sort();
  return weekKeys.map(key => {
    const d = new Date(key + "T00:00:00");
    return {
      key,
      label: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
    };
  });
}

const ROLES = [
  "Designer","Senior Designer","Lead Designer",
  "Engineer","Senior Engineer","Lead Engineer","Principal Engineer",
  "Product Manager","Delivery Manager","Senior Delivery Manager","Analyst","Data Scientist",
  "QA Engineer","DevOps Engineer","Architect","Consultant",
];

const SENIORITY = ["Junior","Mid","Senior","Lead","Principal","Director"];

function toUKDate(iso: string): string {
  if (!iso) return "";
  try {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  } catch { return iso; }
}

function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: avatarCol(name), color: "#fff", flexShrink: 0,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontSize: size * 0.33, fontWeight: 800,
    }}>
      {initials(name)}
    </div>
  );
}

function SectionHeader({
  icon, title, subtitle, action,
}: {
  icon: React.ReactNode; title: string; subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "16px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ display: "flex", alignItems: "center", flexShrink: 0 }}>{icon}</span>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>{title}</div>
          {subtitle && <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "1px" }}>{subtitle}</div>}
        </div>
      </div>
      {action}
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: "white", borderRadius: "14px",
      border: "1.5px solid #e2e8f0",
      boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
      padding: "20px 22px",
      ...style,
    }}>
      {children}
    </div>
  );
}

function StatPill({ label, value, colour }: { label: string; value: string | number; colour?: string }) {
  return (
    <div style={{ background: "#f8fafc", borderRadius: "9px", border: "1px solid #e2e8f0", padding: "10px 14px" }}>
      <div style={{ fontSize: "10px", color: "#94a3b8", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "3px" }}>{label}</div>
      <div style={{ fontSize: "18px", fontWeight: 800, color: colour || "#0f172a", fontFamily: "'DM Mono', monospace" }}>{value}</div>
    </div>
  );
}

const IconBudget = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="6" width="20" height="13" rx="2" stroke="#64748b" strokeWidth="1.8"/>
    <path d="M2 10h20" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"/>
    <path d="M6 15h2M10 15h2" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

const IconClipboard = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"/>
    <rect x="8" y="2" width="8" height="4" rx="1" stroke="#64748b" strokeWidth="1.8"/>
    <path d="M9 12h6M9 16h4" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

const IconGrid = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"/>
  </svg>
);

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "10px", fontWeight: 800,
  color: "#94a3b8", textTransform: "uppercase",
  letterSpacing: "0.06em", marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%", boxSizing: "border-box",
  padding: "8px 10px", borderRadius: "8px",
  border: "1.5px solid #e2e8f0",
  fontSize: "13px", color: "#0f172a",
  fontFamily: "inherit", outline: "none",
};

function EditAllocationModal({ member, projectId, isPipeline, onClose }: {
  member: TeamMember; projectId: string; isPipeline?: boolean; onClose: () => void;
}) {
  const CAPACITY_OPTIONS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];
  const [startDate,   setStartDate]   = useState((member as any).firstWeek ?? "");
  const [endDate,     setEndDate]     = useState((member as any).lastWeek  ?? "");
  const [daysPerWeek, setDaysPerWeek] = useState((member as any).avgDaysPerWeek || 5);
  const [allocType,   setAllocType]   = useState(isPipeline ? "soft" : (member.allocationType || "confirmed"));
  const [error,       setError]       = useState<string | null>(null);
  const [isPending,   startTransition] = useTransition();
  const [showDelete,  setShowDelete]  = useState(false);

  const weekCount = (() => {
    if (!startDate || !endDate || startDate > endDate) return 0;
    return Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (7 * 86400000)) + 1;
  })();

  function handleSave() {
    setError(null);
    const fd = new FormData();
    fd.set("person_id", member.personId); fd.set("project_id", projectId);
    fd.set("start_date", startDate); fd.set("end_date", endDate);
    fd.set("days_per_week", String(daysPerWeek)); fd.set("allocation_type", allocType);
    fd.set("return_to", `/projects/${projectId}`);
    startTransition(async () => {
      try { await updateAllocation(fd); onClose(); }
      catch (e: any) { setError(e.message || "Failed to update allocation"); }
    });
  }

  function handleDelete() {
    const fd = new FormData();
    fd.set("person_id", member.personId); fd.set("project_id", projectId);
    fd.set("return_to", `/projects/${projectId}`);
    startTransition(async () => {
      try { await deleteAllocationDirect(fd); onClose(); }
      catch (e: any) { setError(e.message || "Failed to remove allocation"); }
    });
  }

  return (
    <div onClick={e => { if (e.target === e.currentTarget) onClose(); }} style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(3px)", display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
      <div style={{ background: "white", borderRadius: "16px", border: "1.5px solid #e2e8f0", width: "100%", maxWidth: "420px", boxShadow: "0 20px 60px rgba(0,0,0,0.15)", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ padding: "18px 20px 14px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>Edit allocation</div>
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "2px" }}>{member.fullName} - {member.weekCount}w - {member.totalDaysAllocated}d total</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "18px", lineHeight: 1, padding: "4px" }}>x</button>
        </div>

        <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: "14px" }}>
          {error && <div style={{ padding: "8px 12px", borderRadius: "8px", background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", color: "#dc2626", fontSize: "12px" }}>{error}</div>}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <div>
              <label style={labelStyle}>Start date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ ...inputStyle, color: "#0f172a", colorScheme: "light" }} />
            </div>
            <div>
              <label style={labelStyle}>End date</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ ...inputStyle, color: "#0f172a", colorScheme: "light" }} />
            </div>
          </div>
          {weekCount > 0 && <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "-8px" }}>{weekCount} week{weekCount !== 1 ? "s" : ""} - {Math.round(weekCount * daysPerWeek * 10) / 10}d total</div>}

          <div>
            <label style={labelStyle}>Days / week</label>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {CAPACITY_OPTIONS.map(d => (
                <button key={d} type="button" onClick={() => setDaysPerWeek(d)} style={{ padding: "6px 10px", borderRadius: "7px", border: `1.5px solid ${daysPerWeek === d ? "#00b8db" : "#e2e8f0"}`, background: daysPerWeek === d ? "rgba(0,184,219,0.1)" : "white", color: daysPerWeek === d ? "#0e7490" : "#475569", fontSize: "12px", fontWeight: daysPerWeek === d ? 800 : 500, cursor: "pointer" }}>{d}</button>
              ))}
            </div>
          </div>

          <div>
            <label style={labelStyle}>Type</label>
            {isPipeline ? (
              <div style={{ padding: "8px 12px", borderRadius: "7px", border: "1.5px solid #e8ecf0", background: "#f8fafc", fontSize: "12px", fontWeight: 700, color: "#475569", textAlign: "center" }}>
                Soft only (pipeline project)
              </div>
            ) : (
              <div style={{ display: "flex", gap: "8px" }}>
                {(["confirmed", "soft"] as const).map(t => (
                  <button key={t} type="button" onClick={() => setAllocType(t)} style={{ flex: 1, padding: "7px", borderRadius: "7px", border: `1.5px solid ${allocType === t ? "#00b8db" : "#e2e8f0"}`, background: allocType === t ? "rgba(0,184,219,0.08)" : "white", color: allocType === t ? "#0e7490" : "#64748b", fontSize: "12px", fontWeight: 700, cursor: "pointer", textTransform: "capitalize" }}>
                    {t === "confirmed" ? "Confirmed" : "Soft"}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "12px 20px 16px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {!showDelete ? (
            <button onClick={() => setShowDelete(true)} style={{ background: "none", border: "none", color: "#ef4444", fontSize: "12px", fontWeight: 600, cursor: "pointer", padding: 0 }}>Remove allocation</button>
          ) : (
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "#ef4444", fontWeight: 600 }}>Sure?</span>
              <button onClick={handleDelete} disabled={isPending} style={{ padding: "5px 12px", borderRadius: "6px", border: "none", background: "#ef4444", color: "white", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Yes, remove</button>
              <button onClick={() => setShowDelete(false)} style={{ padding: "5px 12px", borderRadius: "6px", border: "1px solid #e2e8f0", background: "white", fontSize: "12px", color: "#64748b", cursor: "pointer" }}>Cancel</button>
            </div>
          )}
          <div style={{ display: "flex", gap: "8px" }}>
            <button onClick={onClose} style={{ padding: "8px 16px", borderRadius: "8px", border: "1.5px solid #e2e8f0", background: "white", fontSize: "12px", fontWeight: 600, color: "#475569", cursor: "pointer" }}>Cancel</button>
            <button onClick={handleSave} disabled={isPending || !startDate || !endDate} style={{ padding: "8px 18px", borderRadius: "8px", border: "none", background: isPending || !startDate || !endDate ? "#e2e8f0" : "#00b8db", color: isPending || !startDate || !endDate ? "#94a3b8" : "white", fontSize: "12px", fontWeight: 800, cursor: isPending || !startDate || !endDate ? "not-allowed" : "pointer", boxShadow: "0 2px 8px rgba(0,184,219,0.2)" }}>{isPending ? "Saving..." : "Save changes"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamMemberCard({ member, projectColour, projectId, isPipeline }: {
  member: TeamMember; projectColour: string; projectId: string; isPipeline?: boolean;
}) {
  const tier = utilTier(member.avgUtilisationPct);
  const col  = UTIL_COLOURS[tier];
  const [showEdit, setShowEdit] = useState(false);

  return (
    <>
      {showEdit && (
        <EditAllocationModal
          member={member}
          projectId={projectId}
          isPipeline={isPipeline}
          onClose={() => setShowEdit(false)}
        />
      )}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "12px 0", borderBottom: "1px solid #f1f5f9" }}>
        <Avatar name={member.fullName} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
            {member.fullName}
            {member.allocationType === "soft" && <span style={{ marginLeft: "6px", fontSize: "10px", color: "#64748b", background: "#f1f5f9", borderRadius: "4px", padding: "1px 5px", fontWeight: 600 }}>Soft</span>}
          </div>
          <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "1px" }}>
            {member.roleOnProject || member.jobTitle || "--"} - {member.weekCount}w - {member.totalDaysAllocated}d total
            {(member as any).avgDaysPerWeek > 0 && <span style={{ color: "#64748b" }}> - {(member as any).avgDaysPerWeek}d/wk</span>}
            {member.employmentType === "part_time" && <span style={{ color: "#f59e0b", marginLeft: "4px", fontWeight: 600 }}>PT</span>}
          </div>
          <div style={{ marginTop: "6px" }}>
            <div style={{ height: "5px", background: "#f1f5f9", borderRadius: "3px", overflow: "hidden" }}>
              <div style={{ height: "100%", borderRadius: "3px", width: `${Math.min(member.avgUtilisationPct, 100)}%`, background: utilColour(member.avgUtilisationPct), transition: "width 0.4s" }} />
            </div>
          </div>
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 800, fontFamily: "'DM Mono', monospace", color: utilColour(member.avgUtilisationPct), background: col.bg, border: `1px solid ${col.border}`, borderRadius: "6px", padding: "3px 8px" }}>{member.avgUtilisationPct}%</div>
          <div style={{ fontSize: "10px", color: "#94a3b8", marginTop: "3px" }}>avg util</div>
        </div>
        <button type="button" onClick={() => setShowEdit(true)} style={{ fontSize: "11px", color: "#00b8db", fontWeight: 600, padding: "5px 10px", border: "1px solid #bae6f0", borderRadius: "6px", whiteSpace: "nowrap", flexShrink: 0, background: "white", cursor: "pointer" }}>Edit</button>
      </div>
    </>
  );
}

function TeamSection({ members, projectColour, projectId, isPipeline }: {
  members: TeamMember[]; projectColour: string; projectId: string; isPipeline?: boolean;
}) {
  return (
    <Card>
      <SectionHeader
        icon={<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="4" stroke="#64748b" strokeWidth="1.8"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"/><path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85" stroke="#64748b" strokeWidth="1.8" strokeLinecap="round"/></svg>}
        title="Team"
        subtitle={`${members.length} people allocated`}
        action={<a href={`/allocations/new?project_id=${projectId}&return_to=/projects/${projectId}`} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "6px 14px", borderRadius: "7px", background: "#00b8db", border: "none", color: "white", fontSize: "12px", fontWeight: 700, textDecoration: "none" }}>+ Allocate</a>}
      />
      {members.length === 0 ? (
        <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>No one allocated yet. <a href={`/allocations/new?project_id=${projectId}&return_to=/projects/${projectId}`} style={{ color: "#00b8db", fontWeight: 600 }}>Add a person</a></div>
      ) : (
        members.map(m => (
          <TeamMemberCard
            key={m.personId}
            member={m}
            projectColour={projectColour}
            projectId={projectId}
            isPipeline={isPipeline}
          />
        ))
      )}
    </Card>
  );
}

function BudgetSection({ budget, colour }: { budget: BudgetSummary; colour: string }) {
  const pct        = budget.utilisationPct ?? 0;
  const overBudget = budget.remainingDays != null && budget.remainingDays < 0;
  return (
    <Card>
      <SectionHeader icon={<IconBudget />} title="Budget" subtitle="Days allocated vs budget" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "16px" }}>
        <StatPill label="Budget days" value={budget.budgetDays != null ? `${budget.budgetDays}d` : "--"} />
        <StatPill label="Allocated"   value={`${budget.allocatedDays}d`} colour="#00b8db" />
        <StatPill label="Remaining"   value={budget.remainingDays != null ? `${budget.remainingDays}d` : "--"} colour={overBudget ? "#ef4444" : "#10b981"} />
      </div>
      {budget.budgetDays != null && (
        <div style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", color: "#94a3b8", marginBottom: "5px" }}>
            <span>Budget utilisation</span><span style={{ color: utilColour(pct), fontWeight: 700 }}>{pct}%</span>
          </div>
          <div style={{ height: "8px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: "4px", width: `${Math.min(pct, 100)}%`, background: utilColour(pct), transition: "width 0.4s" }} />
          </div>
          {overBudget && <p style={{ fontSize: "11px", color: "#ef4444", marginTop: "5px", fontWeight: 600 }}>{Math.abs(budget.remainingDays!)}d over budget</p>}
        </div>
      )}
      <div style={{ display: "flex", gap: "16px", padding: "10px 12px", background: "#f8fafc", borderRadius: "8px", border: "1px solid #e2e8f0" }}>
        <div>
          <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>Weekly burn rate</div>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", fontFamily: "'DM Mono', monospace" }}>{budget.weeklyBurnRate}d/wk</div>
        </div>
        {budget.budgetAmount != null && (
          <div>
            <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>Budget</div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", fontFamily: "'DM Mono', monospace" }}>GBP{budget.budgetAmount.toLocaleString()}</div>
          </div>
        )}
      </div>
    </Card>
  );
}

function MiniHeatmap({ allocations, members, periods, colour }: { allocations: AllocationRow[]; members: TeamMember[]; periods: WeekPeriod[]; colour: string }) {
  const today = new Date().toISOString().split("T")[0];

  const resolvedPeriods = periods.length > 0
    ? periods
    : derivePeriodsFromAllocations(allocations);

  const lookup = new Map<string, Map<string, AllocationRow>>();
  for (const a of allocations) {
    if (!lookup.has(a.personId)) lookup.set(a.personId, new Map());
    lookup.get(a.personId)!.set(a.weekStartDate, a);
  }

  const visiblePeriods = resolvedPeriods.slice(0, 20);
  const cellW = 36;

  return (
    <Card style={{ overflowX: "auto" }}>
      <SectionHeader
        icon={<IconGrid />}
        title="Weekly allocation"
        subtitle={visiblePeriods.length > 0 ? `${visiblePeriods.length} weeks shown` : "No weeks to display"}
      />
      {members.length === 0 ? (
        <div style={{ padding: "16px 0", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>No allocations to display.</div>
      ) : visiblePeriods.length === 0 ? (
        <div style={{ padding: "16px 0", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
          No weekly data found. Set a project start date or add allocations with week dates to populate this view.
        </div>
      ) : (
        <div style={{ minWidth: "max-content" }}>
          <div style={{ display: "flex", marginBottom: "6px" }}>
            <div style={{ width: "140px", minWidth: "140px", flexShrink: 0 }} />
            {visiblePeriods.map(p => {
              const isCurrent = p.key <= today && new Date(p.key).getTime() + 7 * 86400000 > new Date(today).getTime();
              return (
                <div key={p.key} style={{ width: cellW, minWidth: cellW, flexShrink: 0, textAlign: "center", fontSize: "9px", fontWeight: isCurrent ? 800 : 500, color: isCurrent ? "#00b8db" : "#94a3b8", fontFamily: "'DM Sans', sans-serif" }}>
                  {p.label.split(" ")[0]}<br />{p.label.split(" ")[1] || ""}
                </div>
              );
            })}
          </div>
          {members.map(member => (
            <div key={member.personId} style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
              <div style={{ width: "140px", minWidth: "140px", flexShrink: 0, display: "flex", alignItems: "center", gap: "6px", paddingRight: "8px" }}>
                <Avatar name={member.fullName} size={22} />
                <div style={{ fontSize: "11px", fontWeight: 600, color: "#334155", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {member.fullName.split(" ")[0]}
                </div>
              </div>
              {visiblePeriods.map(p => {
                const alloc = lookup.get(member.personId)?.get(p.key);
                const pct   = alloc?.utilisationPct ?? 0;
                const tier  = utilTier(pct);
                const col   = UTIL_COLOURS[tier];
                const isCurrent = p.key <= today && new Date(p.key).getTime() + 7 * 86400000 > new Date(today).getTime();
                return (
                  <div key={p.key}
                    style={{ width: cellW - 2, minWidth: cellW - 2, height: "28px", borderRadius: "4px", flexShrink: 0, marginRight: "2px", background: alloc ? col.bg : (isCurrent ? "rgba(0,184,219,0.04)" : "#f8fafc"), border: `1px solid ${alloc ? col.border : (isCurrent ? "rgba(0,184,219,0.15)" : "#f1f5f9")}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "9px", fontWeight: 700, fontFamily: "'DM Mono', monospace", color: alloc ? col.text : "#e2e8f0", position: "relative" }}
                    title={alloc ? `${alloc.daysAllocated}d - ${pct}% util` : "Not allocated"}
                  >
                    {alloc ? `${alloc.daysAllocated}d` : ""}
                    {alloc && <div style={{ position: "absolute", bottom: 0, left: 0, height: "2px", borderRadius: "0 0 3px 3px", width: `${Math.min(pct, 100)}%`, background: col.text, opacity: 0.5 }} />}
                  </div>
                );
              })}
            </div>
          ))}
          <div style={{ display: "flex", gap: "12px", marginTop: "12px", paddingTop: "10px", borderTop: "1px solid #f1f5f9" }}>
            {[{ tier: "low", label: "< 75%" }, { tier: "mid", label: "75-95%" }, { tier: "high", label: "95-110%" }, { tier: "critical", label: "> 110%" }].map(l => {
              const col = UTIL_COLOURS[l.tier as keyof typeof UTIL_COLOURS];
              return (
                <div key={l.tier} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "10px", color: "#64748b" }}>
                  <div style={{ width: "10px", height: "10px", borderRadius: "2px", background: col.bg, border: `1px solid ${col.border}` }} />
                  {l.label}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </Card>
  );
}

type NewRole = { role_title: string; seniority_level: string; required_days_per_week: number; start_date: string; end_date: string };

function RoleRequirementRow({ role, onEdit, onDelete }: { role: RoleRequirement; onEdit: () => void; onDelete: () => void }) {
  const weeks = Math.round((new Date(role.endDate).getTime() - new Date(role.startDate).getTime()) / (7 * 86400000));
  const [confirmDel, setConfirmDel] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0, background: role.isFilled ? "#10b981" : "#f59e0b", boxShadow: `0 0 0 3px ${role.isFilled ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)"}` }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>{role.seniorityLevel} {role.roleTitle}</div>
        <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
          {toUKDate(role.startDate)} – {toUKDate(role.endDate)} · {weeks}w · {role.requiredDaysPerWeek}d/wk
        </div>
        {role.notes && <div style={{ fontSize: "11px", color: "#64748b", marginTop: "2px", fontStyle: "italic" }}>{role.notes}</div>}
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{ fontSize: "13px", fontWeight: 700, fontFamily: "'DM Mono', monospace", color: role.isFilled ? "#10b981" : "#f59e0b" }}>{role.totalDemandDays}d</div>
        {role.isFilled ? (
          <div style={{ fontSize: "10px", color: "#10b981", marginTop: "2px", fontWeight: 600 }}>{role.filledByName || "Filled"}</div>
        ) : (
          <div style={{ fontSize: "10px", color: "#f59e0b", marginTop: "2px", fontWeight: 600, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.2)", borderRadius: "4px", padding: "1px 6px" }}>Unfilled</div>
        )}
      </div>
      <div style={{ display: "flex", gap: "5px", flexShrink: 0 }}>
        <button type="button" onClick={onEdit} style={{ fontSize: "11px", color: "#00b8db", fontWeight: 600, padding: "4px 9px", border: "1px solid #bae6f0", borderRadius: "6px", background: "white", cursor: "pointer" }}>Edit</button>
        {!confirmDel ? (
          <button type="button" onClick={() => setConfirmDel(true)} style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600, padding: "4px 9px", border: "1px solid #e2e8f0", borderRadius: "6px", background: "white", cursor: "pointer" }}>✕</button>
        ) : (
          <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            <span style={{ fontSize: "11px", color: "#ef4444", fontWeight: 600 }}>Sure?</span>
            <button type="button" onClick={() => { onDelete(); setConfirmDel(false); }} style={{ fontSize: "11px", color: "white", fontWeight: 600, padding: "4px 8px", border: "none", borderRadius: "5px", background: "#ef4444", cursor: "pointer" }}>Yes</button>
            <button type="button" onClick={() => setConfirmDel(false)} style={{ fontSize: "11px", color: "#64748b", fontWeight: 600, padding: "4px 8px", border: "1px solid #e2e8f0", borderRadius: "5px", background: "white", cursor: "pointer" }}>No</button>
          </div>
        )}
      </div>
    </div>
  );
}

function EditRoleForm({ role, projectId, onSaved, onCancel }: { role: RoleRequirement; projectId: string; onSaved: () => void; onCancel: () => void }) {
  // Parse role string into seniority + title when extended columns aren't populated
  function parseRoleString(roleStr: string): { seniority: string; title: string } {
    const seniorityPrefixes = ["Junior", "Mid", "Senior", "Lead", "Principal", "Director"];
    const trimmed = (roleStr || "").trim();
    for (const s of seniorityPrefixes) {
      if (trimmed.startsWith(s + " ")) {
        return { seniority: s, title: trimmed.slice(s.length + 1).trim() };
      }
    }
    return { seniority: "Senior", title: trimmed };
  }

  // Prefer explicit fields, fall back to parsing the combined role string
  const roleStr = (role as any).role || role.roleTitle || "";
  const parsed = parseRoleString(roleStr);
  const initialTitle    = role.roleTitle    || parsed.title    || roleStr;
  const initialSeniority = role.seniorityLevel || parsed.seniority || "Senior";
  const initialStart    = role.startDate    || (role as any).start_date  || "";
  const initialEnd      = role.endDate      || (role as any).end_date    || "";
  const initialDays     = role.requiredDaysPerWeek || (role as any).required_days_per_week || 3;

  const [roleTitle, setRoleTitle]     = useState(initialTitle);
  const [seniority, setSeniority]     = useState(initialSeniority);
  const [startDate, setStartDate]     = useState(initialStart);
  const [endDate, setEndDate]         = useState(initialEnd);
  const [daysPerWeek, setDaysPerWeek] = useState(initialDays);
  const [saving, setSaving]           = useState(false);
  const [error, setError]             = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!roleTitle.trim()) { setError("Role title is required."); return; }
    setSaving(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("role_id", role.id);
      fd.set("project_id", projectId);
      fd.set("role_title", roleTitle.trim());
      fd.set("seniority_level", seniority);
      fd.set("start_date", startDate);
      fd.set("end_date", endDate);
      fd.set("required_days_per_week", String(daysPerWeek));
      await updateRoleRequirement(fd);
      onSaved();
    } catch (err: any) {
      console.error("[EditRoleForm] save error:", err);
      setError(err.message || "Save failed — check browser console for details.");
    }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSave} style={{ background: "#eff6ff", borderRadius: "10px", border: "1.5px solid #bfdbfe", padding: "16px", marginTop: "12px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#1d4ed8", marginBottom: "12px" }}>Edit role requirement</div>
      <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "8px", marginBottom: "10px" }}>
        <select value={seniority} onChange={e => setSeniority(e.target.value)} style={inputStyle}>
          {SENIORITY.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <div style={{ position: "relative" }}>
          <input list="edit-role-list" value={roleTitle} onChange={e => setRoleTitle(e.target.value)} placeholder="Role title..." style={{ ...inputStyle, width: "100%" }} />
          <datalist id="edit-role-list">{ROLES.map(r => <option key={r} value={r} />)}</datalist>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: "8px", marginBottom: "10px" }}>
        <div>
          <label style={labelStyle}>Start</label>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} style={{ ...inputStyle, color: "#0f172a", colorScheme: "light" }} />
        </div>
        <div>
          <label style={labelStyle}>End</label>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} style={{ ...inputStyle, color: "#0f172a", colorScheme: "light" }} />
        </div>
        <div>
          <label style={labelStyle}>Days/week</label>
          <div style={{ display: "flex", gap: "4px" }}>
            {[1,2,3,4,5].map(d => (
              <button key={d} type="button" onClick={() => setDaysPerWeek(d)} style={{ width: "32px", height: "32px", borderRadius: "6px", border: "1.5px solid", borderColor: daysPerWeek === d ? "#2563eb" : "#e2e8f0", background: daysPerWeek === d ? "#2563eb" : "white", color: daysPerWeek === d ? "white" : "#475569", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>{d}</button>
            ))}
          </div>
        </div>
      </div>
      {error && <div style={{ fontSize: "12px", color: "#dc2626", background: "#fef2f2", borderRadius: "6px", padding: "8px 12px", border: "1px solid #fecaca", marginBottom: "8px" }}>{error}</div>}
      <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
        <button type="button" onClick={onCancel} style={{ background: "none", border: "1px solid #bfdbfe", borderRadius: "7px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, color: "#1d4ed8", cursor: "pointer" }}>Cancel</button>
        <button type="submit" disabled={saving} style={{ background: saving ? "#94a3b8" : "#2563eb", border: "none", borderRadius: "7px", padding: "7px 18px", fontSize: "13px", fontWeight: 700, color: "white", cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Saving..." : "Save changes"}</button>
      </div>
    </form>
  );
}

function AddRoleForm({ projectId, startDate, endDate, onSaved, orgRoles = [] }: { projectId: string; startDate: string | null; endDate: string | null; onSaved: () => void; orgRoles?: string[] }) {
  const [roles, setRoles] = useState<NewRole[]>([{ role_title: "", seniority_level: "Senior", required_days_per_week: 3, start_date: startDate || "", end_date: endDate || "" }]);
  const [saving, setSaving] = useState(false);
  const [error, setError]  = useState<string | null>(null);

  function addRole() { setRoles(r => [...r, { role_title: "", seniority_level: "Senior", required_days_per_week: 3, start_date: startDate || "", end_date: endDate || "" }]); }
  function removeRole(i: number) { setRoles(r => r.filter((_, j) => j !== i)); }
  function updateRole(i: number, field: keyof NewRole, value: string | number) { setRoles(r => r.map((role, j) => j === i ? { ...role, [field]: value } : role)); }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const valid = roles.filter(r => r.role_title && r.start_date && r.end_date);
    if (!valid.length) { setError("Add at least one complete role."); return; }
    setSaving(true); setError(null);
    try {
      const fd = new FormData();
      fd.set("project_id", projectId); fd.set("roles_json", JSON.stringify(valid));
      await insertRoleRequirements(fd); onSaved();
    } catch (err: any) { setError(err.message || "Save failed."); }
    finally { setSaving(false); }
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "#f8fafc", borderRadius: "10px", border: "1.5px solid #e2e8f0", padding: "16px", marginTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
      <div style={{ fontSize: "13px", fontWeight: 700, color: "#0f172a" }}>Add role requirements</div>
      {roles.map((role, i) => (
        <div key={i} style={{ background: "white", borderRadius: "9px", border: "1.5px solid #e2e8f0", padding: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "140px 1fr auto", gap: "8px" }}>
            <select value={role.seniority_level} onChange={e => updateRole(i, "seniority_level", e.target.value)} style={inputStyle}>{SENIORITY.map(s => <option key={s} value={s}>{s}</option>)}</select>
            <div style={{ position: "relative", flex: 1 }}>
              <input
                list={`role-list-${i}`}
                value={role.role_title}
                onChange={e => updateRole(i, "role_title", e.target.value)}
                placeholder="Type or select a role..."
                style={{ ...inputStyle, width: "100%" }}
              />
              <datalist id={`role-list-${i}`}>
                {(orgRoles.length > 0 ? orgRoles : ROLES).map(r => <option key={r} value={r} />)}
              </datalist>
            </div>
            {roles.length > 1 && <button type="button" onClick={() => removeRole(i)} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "16px", lineHeight: 1, padding: "0 4px" }}>x</button>}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 120px", gap: "8px" }}>
            <div><label style={labelStyle}>Start</label><input type="date" value={role.start_date} onChange={e => updateRole(i, "start_date", e.target.value)} style={{ ...inputStyle, color: "#0f172a", colorScheme: "light" }} /></div>
            <div><label style={labelStyle}>End</label><input type="date" value={role.end_date} onChange={e => updateRole(i, "end_date", e.target.value)} style={{ ...inputStyle, color: "#0f172a", colorScheme: "light" }} /></div>
            <div>
              <label style={labelStyle}>Days/week</label>
              <div style={{ display: "flex", gap: "4px" }}>
                {[1,2,3,4,5].map(d => <button key={d} type="button" onClick={() => updateRole(i, "required_days_per_week", d)} style={{ width: "32px", height: "32px", borderRadius: "6px", border: "1.5px solid", borderColor: role.required_days_per_week === d ? "#00b8db" : "#e2e8f0", background: role.required_days_per_week === d ? "#00b8db" : "white", color: role.required_days_per_week === d ? "white" : "#475569", fontSize: "12px", fontWeight: 700, cursor: "pointer", fontFamily: "'DM Mono', monospace" }}>{d}</button>)}
              </div>
            </div>
          </div>
        </div>
      ))}
      {error && <div style={{ fontSize: "12px", color: "#dc2626", background: "#fef2f2", borderRadius: "6px", padding: "8px 12px", border: "1px solid #fecaca" }}>{error}</div>}
      <div style={{ display: "flex", gap: "8px", justifyContent: "space-between" }}>
        <button type="button" onClick={addRole} style={{ background: "none", border: "1.5px dashed #e2e8f0", borderRadius: "7px", padding: "6px 14px", fontSize: "12px", fontWeight: 600, color: "#64748b", cursor: "pointer" }}>+ Add another role</button>
        <button type="submit" disabled={saving} style={{ background: saving ? "#94a3b8" : "#00b8db", border: "none", borderRadius: "7px", padding: "7px 20px", fontSize: "13px", fontWeight: 700, color: "white", cursor: saving ? "not-allowed" : "pointer" }}>{saving ? "Saving..." : `Save ${roles.length} role${roles.length > 1 ? "s" : ""}`}</button>
      </div>
    </form>
  );
}

function RoleRequirementsSection({ roles, projectId, startDate, endDate, orgRoles = [] }: { roles: RoleRequirement[]; projectId: string; startDate: string | null; endDate: string | null; orgRoles?: string[] }) {
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<RoleRequirement | null>(null);
  const [isPending, startTransition] = useTransition();
  const unfilled = roles.filter(r => !r.isFilled).length;
  const filled   = roles.filter(r =>  r.isFilled).length;

  function handleDelete(roleId: string) {
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("role_id", roleId);
        fd.set("project_id", projectId);
        await deleteRoleRequirement(fd);
        window.location.reload();
      } catch (e: any) { alert(e.message || "Delete failed"); }
    });
  }

  return (
    <Card>
      <SectionHeader icon={<IconClipboard />} title="Role requirements" subtitle={`${roles.length} roles · ${unfilled} unfilled · ${filled} filled`}
        action={<button type="button" onClick={() => { setShowForm(s => !s); setEditingRole(null); }} style={{ display: "inline-flex", alignItems: "center", gap: "5px", padding: "6px 14px", borderRadius: "7px", background: showForm ? "#f1f5f9" : "#00b8db", border: "none", color: showForm ? "#64748b" : "white", fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>{showForm ? "✕ Cancel" : "+ Add roles"}</button>}
      />
      {roles.length === 0 && !showForm ? (
        <div style={{ padding: "20px 0", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>No role requirements defined yet.</div>
      ) : (
        roles.map(r => (
          <React.Fragment key={r.id}>
            {editingRole?.id === r.id ? (
              <EditRoleForm
                key={r.id}
                role={r}
                projectId={projectId}
                onSaved={() => { setEditingRole(null); window.location.reload(); }}
                onCancel={() => setEditingRole(null)}
              />
            ) : (
              <RoleRequirementRow
                role={r}
                onEdit={() => { setEditingRole(r); setShowForm(false); }}
                onDelete={() => handleDelete(r.id)}
              />
            )}
          </React.Fragment>
        ))
      )}
      {roles.length > 0 && !editingRole && (
        <div style={{ display: "flex", gap: "16px", padding: "10px 0 0", borderTop: "1px solid #f1f5f9", marginTop: "4px" }}>
          <div style={{ fontSize: "11px", color: "#94a3b8" }}>Total demand: <strong style={{ color: "#0f172a", fontFamily: "'DM Mono', monospace" }}>{roles.reduce((s, r) => s + r.totalDemandDays, 0).toFixed(0)}d</strong></div>
          <div style={{ fontSize: "11px", color: "#94a3b8" }}>Unfilled: <strong style={{ color: "#f59e0b", fontFamily: "'DM Mono', monospace" }}>{roles.filter(r => !r.isFilled).reduce((s, r) => s + r.totalDemandDays, 0).toFixed(0)}d</strong></div>
        </div>
      )}
      {showForm && !editingRole && (
        <AddRoleForm projectId={projectId} startDate={startDate} endDate={endDate} onSaved={() => { setShowForm(false); window.location.reload(); }} orgRoles={orgRoles} />
      )}
    </Card>
  );
}

// ── NEW: prop types for justification data passed from the server page ────────

export type ResourceJustificationProps = {
  initialJustification: ResourceJustification | null;
  openCRs: OpenCR[];
  roleRequirementsForJustification: Array<{
    id: string;
    role: string;
    required_days: number | null;
    filled_days: number | null;
  }>;
  projectTitle: string;
  canEdit: boolean;
};

// ── Main export ───────────────────────────────────────────────────────────────

export default function ProjectResourcePanel({
  data,
  periods,
  justificationProps,
}: {
  data: ProjectResourceData;
  periods: WeekPeriod[];
  justificationProps?: ResourceJustificationProps;
}) {
  const { project, teamMembers, allocations, roleRequirements, budgetSummary } = data;
  const isPipeline = String(project.resource_status || "").toLowerCase() === "pipeline";

  return (
    <>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');`}</style>
      <div style={{ fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column", gap: "16px", marginTop: "24px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <div style={{ height: "1.5px", flex: 1, background: "linear-gradient(90deg, #e2e8f0, transparent)" }} />
          <div style={{ fontSize: "11px", fontWeight: 800, color: "#00b8db", letterSpacing: "0.1em", textTransform: "uppercase", display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: "6px", height: "6px", borderRadius: "50%", background: project.colour }} />
            Resource Planning
          </div>
          <div style={{ height: "1.5px", flex: 1, background: "linear-gradient(90deg, transparent, #e2e8f0)" }} />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "14px" }}>
          <TeamSection
            members={teamMembers}
            projectColour={project.colour}
            projectId={project.id}
            isPipeline={isPipeline}
          />
          <BudgetSection budget={budgetSummary} colour={project.colour} />
        </div>

        <MiniHeatmap allocations={allocations} members={teamMembers} periods={periods} colour={project.colour} />

        <RoleRequirementsSection
          roles={roleRequirements}
          projectId={project.id}
          startDate={project.start_date}
          endDate={project.finish_date}
          orgRoles={[...new Set(Object.keys(justificationProps?.rateCard ?? {}))].sort()}
        />

        {/* ── Resource Justification Panel ── */}
        {justificationProps && (
          <ResourceJustificationPanel
            projectId={project.id}
            projectTitle={justificationProps.projectTitle}
            initialJustification={justificationProps.initialJustification}
            budgetSummary={{
              totalBudgetDays: budgetSummary.budgetDays ?? 0,
              allocatedDays: budgetSummary.allocatedDays,
              remainingDays: budgetSummary.remainingDays ?? 0,
              overBudget: (budgetSummary.remainingDays ?? 0) < 0,
              weeklyBurnRate: budgetSummary.weeklyBurnRate,
              budgetGbp: budgetSummary.budgetAmount ?? null,
              spentGbp: null,
              remainingGbp: null,
              utilisationPct: budgetSummary.utilisationPct ?? 0,
            }}
            openCRs={justificationProps.openCRs}
            roleRequirements={justificationProps.roleRequirementsForJustification}
            allocatedDays={budgetSummary.allocatedDays}
            budgetDays={budgetSummary.budgetDays ?? 0}
            weeklyBurnRate={budgetSummary.weeklyBurnRate}
            canEdit={justificationProps.canEdit}
          />
        )}
      </div>
    </>
  );
}