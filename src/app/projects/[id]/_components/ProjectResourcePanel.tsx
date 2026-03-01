"use client";

import { useState } from "react";
import type {
  ProjectResourceData, TeamMember, AllocationRow,
  RoleRequirement, BudgetSummary, WeekPeriod,
} from "../_lib/resource-data";
import { insertRoleRequirements } from "../../actions";

/* =============================================================================
   HELPERS + CONSTANTS
============================================================================= */

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

const ROLES = [
  "Designer","Senior Designer","Lead Designer",
  "Engineer","Senior Engineer","Lead Engineer","Principal Engineer",
  "Product Manager","Delivery Manager","Analyst","Data Scientist",
  "QA Engineer","DevOps Engineer","Architect","Consultant",
];

const SENIORITY = ["Junior","Mid","Senior","Lead","Principal","Director"];

const inputStyle: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: "7px",
  border: "1.5px solid #e2e8f0", background: "white",
  fontSize: "13px", fontFamily: "'DM Sans', sans-serif",
  color: "#0f172a", outline: "none", boxSizing: "border-box",
};

const labelStyle: React.CSSProperties = {
  display: "block", fontSize: "10px", fontWeight: 700,
  color: "#94a3b8", textTransform: "uppercase",
  letterSpacing: "0.05em", marginBottom: "4px",
};

/* =============================================================================
   SMALL SHARED COMPONENTS
============================================================================= */

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
  icon: string; title: string; subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center",
      justifyContent: "space-between", marginBottom: "16px",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span style={{ fontSize: "18px" }}>{icon}</span>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a" }}>{title}</div>
          {subtitle && (
            <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "1px" }}>{subtitle}</div>
          )}
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

function StatPill({
  label, value, colour,
}: {
  label: string; value: string | number; colour?: string;
}) {
  return (
    <div style={{
      background: "#f8fafc", borderRadius: "9px",
      border: "1px solid #e2e8f0", padding: "10px 14px",
    }}>
      <div style={{
        fontSize: "10px", color: "#94a3b8", fontWeight: 700,
        textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "3px",
      }}>{label}</div>
      <div style={{
        fontSize: "18px", fontWeight: 800,
        color: colour || "#0f172a",
        fontFamily: "'DM Mono', monospace",
      }}>{value}</div>
    </div>
  );
}

/* =============================================================================
   1. TEAM MEMBERS WITH UTILISATION
============================================================================= */

function TeamMemberCard({
  member, projectId,
}: {
  member: TeamMember; projectColour: string; projectId: string;
}) {
  const tier = utilTier(member.avgUtilisationPct);
  const col  = UTIL_COLOURS[tier];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      padding: "12px 0",
      borderBottom: "1px solid #f1f5f9",
    }}>
      <Avatar name={member.fullName} size={36} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
          {member.fullName}
          {member.allocationType === "soft" && (
            <span style={{
              marginLeft: "6px", fontSize: "10px", color: "#64748b",
              background: "#f1f5f9", borderRadius: "4px", padding: "1px 5px",
              fontWeight: 600,
            }}>Soft</span>
          )}
        </div>
        <div style={{ fontSize: "12px", color: "#94a3b8", marginTop: "1px" }}>
          {member.roleOnProject || member.jobTitle || "—"}
          {" · "}{member.weekCount}w · {member.totalDaysAllocated}d total
        </div>
        <div style={{ marginTop: "6px" }}>
          <div style={{ height: "5px", background: "#f1f5f9", borderRadius: "3px", overflow: "hidden" }}>
            <div style={{
              height: "100%", width: `${Math.min(member.avgUtilisationPct, 100)}%`,
              background: utilColour(member.avgUtilisationPct), transition: "width 0.4s",
            }} />
          </div>
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{
          fontSize: "14px", fontWeight: 800, fontFamily: "'DM Mono', monospace",
          color: utilColour(member.avgUtilisationPct), background: col.bg,
          border: `1px solid ${col.border}`, borderRadius: "6px", padding: "3px 8px",
        }}>{member.avgUtilisationPct}%</div>
      </div>
      <a href={`/allocations/new?person_id=${member.personId}&project_id=${projectId}`}
         style={{ fontSize: "11px", color: "#00b8db", textDecoration: "none", padding: "5px 10px", border: "1px solid #bae6f0", borderRadius: "6px" }}>
         Edit
      </a>
    </div>
  );
}

function TeamSection({ members, projectColour, projectId }: { members: TeamMember[]; projectColour: string; projectId: string; }) {
  return (
    <Card>
      <SectionHeader icon="??" title="Team" subtitle={`${members.length} people allocated`}
        action={<a href={`/allocations/new?project_id=${projectId}`} style={{ padding: "6px 14px", borderRadius: "7px", background: "#00b8db", color: "white", fontSize: "12px", fontWeight: 700, textDecoration: "none" }}>+ Allocate</a>} />
      {members.map(m => <TeamMemberCard key={m.personId} member={m} projectColour={projectColour} projectId={projectId} />)}
    </Card>
  );
}

/* =============================================================================
   2. BUDGET VS ACTUAL
============================================================================= */

function BudgetSection({ budget }: { budget: BudgetSummary; colour: string }) {
  const pct = budget.utilisationPct ?? 0;
  return (
    <Card>
      <SectionHeader icon="??" title="Budget" subtitle="Days allocated vs budget" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "10px", marginBottom: "16px" }}>
        <StatPill label="Budget days" value={budget.budgetDays ?? "—"} />
        <StatPill label="Allocated" value={`${budget.allocatedDays}d`} colour="#00b8db" />
        <StatPill label="Remaining" value={budget.remainingDays ?? "—"} colour={budget.remainingDays && budget.remainingDays < 0 ? "#ef4444" : "#10b981"} />
      </div>
      <div style={{ height: "8px", background: "#f1f5f9", borderRadius: "4px", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.min(pct, 100)}%`, background: utilColour(pct) }} />
      </div>
    </Card>
  );
}

/* =============================================================================
   3. MINI HEATMAP
============================================================================= */

function MiniHeatmap({ allocations, members, periods }: { allocations: AllocationRow[]; members: TeamMember[]; periods: WeekPeriod[]; colour: string; }) {
  const visiblePeriods = periods.slice(0, 16);
  return (
    <Card style={{ overflowX: "auto" }}>
      <SectionHeader icon="?" title="Weekly allocation" subtitle={`${visiblePeriods.length} weeks shown`} />
      <div style={{ minWidth: "max-content" }}>
        <div style={{ display: "flex", marginBottom: "6px" }}>
          <div style={{ width: "140px" }} />
          {visiblePeriods.map(p => <div key={p.key} style={{ width: "36px", textAlign: "center", fontSize: "9px", color: "#94a3b8" }}>{p.label.split(" ")[0]}</div>)}
        </div>
        {members.map(m => (
          <div key={m.personId} style={{ display: "flex", alignItems: "center", marginBottom: "4px" }}>
            <div style={{ width: "140px", fontSize: "11px", fontWeight: 600 }}>{m.fullName}</div>
            {visiblePeriods.map(p => {
               const alloc = allocations.find(a => a.personId === m.personId && a.weekStartDate === p.key);
               return <div key={p.key} style={{ width: "34px", height: "28px", margin: "1px", background: alloc ? "#e2e8f0" : "#f8fafc", borderRadius: "4px" }} />;
            })}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* =============================================================================
   4. ROLE REQUIREMENTS
============================================================================= */

type NewRole = {
  role_title:             string;
  seniority_level:        string;
  required_days_per_week: number;
  start_date:             string;
  end_date:               string;
};

function RoleRequirementRow({ role }: { role: RoleRequirement }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "11px 0", borderBottom: "1px solid #f1f5f9" }}>
      <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: role.isFilled ? "#10b981" : "#f59e0b" }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "13px", fontWeight: 700 }}>{role.seniorityLevel} {role.roleTitle}</div>
        <div style={{ fontSize: "11px", color: "#94a3b8" }}>{role.startDate} ? {role.endDate}</div>
      </div>
      <div style={{ fontSize: "13px", fontWeight: 700 }}>{role.totalDemandDays}d</div>
    </div>
  );
}

function AddRoleForm({ projectId, startDate, endDate, onSaved }: { projectId: string; startDate: string | null; endDate: string | null; onSaved: () => void; }) {
  const [roles, setRoles] = useState<NewRole[]>([{
    role_title: "", seniority_level: "Senior", required_days_per_week: 3,
    start_date: startDate || "", end_date: endDate || "",
  }]);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData();
    fd.set("project_id", projectId);
    fd.set("roles_json", JSON.stringify(roles));
    await insertRoleRequirements(fd);
    onSaved();
  }

  return (
    <form onSubmit={handleSubmit} style={{ background: "#f8fafc", padding: "16px", borderRadius: "10px", marginTop: "16px" }}>
      <button type="submit" disabled={saving} style={{ background: "#00b8db", color: "white", padding: "8px 16px", borderRadius: "6px", border: "none", fontWeight: 700 }}>
        {saving ? "Saving..." : "Save Requirements"}
      </button>
    </form>
  );
}

function RoleRequirementsSection({ roles, projectId, startDate, endDate }: { roles: RoleRequirement[]; projectId: string; startDate: string | null; endDate: string | null; }) {
  const [showForm, setShowForm] = useState(false);
  return (
    <Card>
      <SectionHeader icon="??" title="Role requirements" action={<button onClick={() => setShowForm(!showForm)} style={{ background: "#00b8db", color: "white", border: "none", padding: "6px 12px", borderRadius: "6px" }}>{showForm ? "Cancel" : "Add Roles"}</button>} />
      {roles.map(r => <RoleRequirementRow key={r.id} role={r} />)}
      {showForm && <AddRoleForm projectId={projectId} startDate={startDate} endDate={endDate} onSaved={() => window.location.reload()} />}
    </Card>
  );
}

export default function ProjectResourcePanel({ data, periods }: { data: ProjectResourceData; periods: WeekPeriod[]; }) {
  const { project, teamMembers, allocations, roleRequirements, budgetSummary } = data;
  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", display: "flex", flexDirection: "column", gap: "16px" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "14px" }}>
        <TeamSection members={teamMembers} projectColour={project.colour} projectId={project.id} />
        <BudgetSection budget={budgetSummary} colour={project.colour} />
      </div>
      <MiniHeatmap allocations={allocations} members={teamMembers} periods={periods} colour={project.colour} />
      <RoleRequirementsSection roles={roleRequirements} projectId={project.id} startDate={project.start_date || ""} endDate={project.finish_date || ""} />
    </div>
  );
}
