"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";

/* ═══════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════ */

type CheckStatus = "pass" | "fail" | "warn" | "missing" | "na";
type Rag         = "green" | "amber" | "red";

type ComplianceCheck = {
  id:       string;
  label:    string;
  status:   CheckStatus;
  detail:   string;
  severity: "critical" | "high" | "medium" | "low";
};

type ProjectCompliance = {
  projectId:     string;
  projectName:   string;
  projectCode:   string | null;
  projectStatus: string;
  overallRag:    Rag;
  failCount:     number;
  warnCount:     number;
  passCount:     number;
  checks:        ComplianceCheck[];
  lastActivity:  string | null;
  finishDate:    string | null;
};

type Summary = {
  total:        number;
  compliant:    number;
  warnings:     number;
  critical:     number;
  checksTotal: number;
  checksFail:  number;
  checksWarn:  number;
  checksPass:  number;
};

type Org = { id: string; name: string };

/* ═══════════════════════════════════════════════════════════════
   TOKENS
═══════════════════════════════════════════════════════════════ */

const T = {
  bg:        "#0B0D11",
  surface:   "#111318",
  card:      "#181B22",
  border:    "#232630",
  borderLt: "#2C3040",
  text:      "#EEF0F4",
  textMd:    "#8B92A5",
  textSm:    "#565D72",
  red:       "#F04D4D",
  redSoft:   "#291414",
  redBorder:"#4A1F1F",
  amber:     "#F5A623",
  amberSoft:"#261E0C",
  ambrBorder:"#4A380F",
  green:     "#22C55E",
  greenSoft:"#0B2318",
  greenBord:"#1A4A2E",
  blue:      "#4F8EF7",
  blueSoft: "#101C36",
  purple:    "#A78BFA",
  mono:      "'JetBrains Mono', 'Fira Code', monospace",
  sans:      "'DM Sans', system-ui, -apple-system, sans-serif",
};

/* ═══════════════════════════════════════════════════════════════
   CHECK COLUMNS — order determines grid column order
═══════════════════════════════════════════════════════════════ */

export const CHECK_COLUMNS = [
  { id: "g1_charter",   label: "G1 — Project Charter",        short: "G1",   group: "gates"      },
  { id: "gate5",        label: "Gate 5 — Closure Report",        short: "G5",   group: "gates"      },
  { id: "weekly",       label: "Weekly Report",                 short: "WR",   group: "reporting"  },
  { id: "budget",       label: "Budget vs Approved",             short: "£",    group: "finance"    },
  { id: "raid",         label: "RAID Items",                     short: "RAID", group: "risk"       },
  { id: "changes",      label: "Change Requests",                short: "CR",   group: "governance" },
  { id: "artifacts",    label: "Required Artifacts",             short: "ART",  group: "governance" },
  { id: "schedule",     label: "Schedule Milestones",            short: "SCH",  group: "delivery"   },
  { id: "wbs",          label: "WBS Work Packages",              short: "WBS",  group: "delivery"   },
  { id: "deadline",     label: "Delivery Deadline",              short: "DL",   group: "delivery"   },
  { id: "approvals",    label: "Pending Approvals",              short: "APP",  group: "governance" },
  { id: "lessons",      label: "Lessons Learned",                short: "LL",   group: "knowledge"  },
  { id: "stakeholders", label: "Stakeholder Register",           short: "STK",  group: "governance" },
];

const GROUP_COLORS: Record<string, string> = {
  gates:      "#F04D4D",
  reporting:  "#4F8EF7",
  finance:    "#22C55E",
  risk:       "#F5A623",
  governance: "#A78BFA",
  delivery:   "#06B6D4",
  knowledge:  "#F97316",
};

/* ═══════════════════════════════════════════════════════════════
   STATUS CONFIG
═══════════════════════════════════════════════════════════════ */

const STATUS: Record<CheckStatus, { bg: string; border: string; text: string; icon: string; label: string }> = {
  pass:    { bg: T.greenSoft, border: T.greenBord,  text: T.green,  icon: "✓", label: "Pass"    },
  warn:    { bg: T.amberSoft, border: T.ambrBorder, text: T.amber,  icon: "!",  label: "Warning" },
  fail:    { bg: T.redSoft,   border: T.redBorder,  text: T.red,    icon: "✗", label: "Fail"    },
  missing: { bg: "#1A1020",   border: "#3D1A3A",    text: "#C084FC",icon: "?",  label: "Missing" },
  na:      { bg: T.card,      border: T.border,     text: T.textSm, icon: "–", label: "N/A"     },
};

const RAG: Record<Rag, { color: string; bg: string; border: string; label: string }> = {
  green: { color: T.green, bg: T.greenSoft, border: T.greenBord, label: "Compliant"      },
  amber: { color: T.amber, bg: T.amberSoft, border: T.ambrBorder,label: "Warnings"       },
  red:   { color: T.red,   bg: T.redSoft,   border: T.redBorder,  label: "Non-Compliant" },
};

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */

function relTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today"; if (d === 1) return "yesterday";
  if (d < 7) return `${d}d ago`; if (d < 30) return `${Math.floor(d/7)}w ago`;
  return `${Math.floor(d/30)}mo ago`;
}

/* ═══════════════════════════════════════════════════════════════
   COMPONENTS
═══════════════════════════════════════════════════════════════ */

function CheckCell({ check, onClick }: { check: ComplianceCheck; onClick: () => void }) {
  const s = STATUS[check.status];
  return (
    <button type="button" onClick={onClick} title={`${check.label}: ${check.detail}`}
      style={{ width: 34, height: 34, borderRadius: 7, border: `1px solid ${s.border}`, background: s.bg, color: s.text, fontSize: 11, fontWeight: 800, fontFamily: T.mono, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", transition: "transform 0.12s, box-shadow 0.12s", position: "relative" }}
      onMouseEnter={e => { const el = e.currentTarget; el.style.transform = "scale(1.18)"; el.style.zIndex = "20"; el.style.boxShadow = `0 0 12px ${s.text}50`; }}
      onMouseLeave={e => { const el = e.currentTarget; el.style.transform = "scale(1)";    el.style.zIndex = "1";  el.style.boxShadow = "none"; }}>
      {s.icon}
    </button>
  );
}

function Modal({ project, check, onClose }: { project: ProjectCompliance; check: ComplianceCheck; onClose: () => void }) {
  const s   = STATUS[check.status];
  const col = CHECK_COLUMNS.find(c => c.id === check.id);
  const grpColor = col ? GROUP_COLORS[col.group] : T.blue;

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", zIndex: 200, backdropFilter: "blur(6px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 201, width: "min(480px, 92vw)", background: T.card, border: `1px solid ${T.borderLt}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,0.8)" }}>
        <div style={{ height: 4, background: grpColor }} />
        <div style={{ padding: "22px 24px" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
            <div style={{ width: 46, height: 46, borderRadius: 11, background: s.bg, border: `1px solid ${s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: s.text, fontFamily: T.mono, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontFamily: T.mono, color: T.textSm, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
                {col?.group ?? "check"} · {s.label}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text, lineHeight: 1.3 }}>{check.label}</div>
              <div style={{ fontSize: 12, color: T.textMd, marginTop: 2 }}>{project.projectCode ? `${project.projectCode} · ` : ""}{project.projectName}</div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: T.textSm, cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "2px 6px", borderRadius: 6 }}>×</button>
          </div>
          <div style={{ padding: "13px 15px", borderRadius: 10, background: s.bg, border: `1px solid ${s.border}`, marginBottom: 16 }}>
            <div style={{ fontSize: 14, color: s.text, fontWeight: 600, marginBottom: 4 }}>{check.detail}</div>
            <div style={{ display: "flex", gap: 10 }}>
              <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textSm, textTransform: "uppercase" }}>Severity: <strong style={{ color: T.textMd }}>{check.severity}</strong></span>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/projects/${project.projectId}`} style={{ flex: 1, padding: "10px", borderRadius: 9, background: T.blue, color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 600, textAlign: "center" }}>Open Project →</Link>
            <button onClick={onClose} style={{ padding: "10px 18px", borderRadius: 9, background: T.border, border: "none", color: T.textMd, cursor: "pointer", fontSize: 13, fontWeight: 600 }}>Close</button>
          </div>
        </div>
      </div>
    </>
  );
}

function ProjectRow({ project, onCheckClick }: { project: ProjectCompliance; onCheckClick: (check: ComplianceCheck) => void }) {
  const rag = RAG[project.overallRag];
  return (
    <div style={{ display: "contents" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 16px", borderBottom: `1px solid ${T.border}`, background: T.surface, minWidth: 0, position: "sticky", left: 0, zIndex: 5 }}>
        <div style={{ width: 9, height: 9, borderRadius: "50%", background: rag.color, flexShrink: 0, boxShadow: `0 0 7px ${rag.color}80` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/projects/${project.projectId}`} style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{project.projectName}</Link>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 1 }}>
            {project.projectCode && <span style={{ fontSize: 9, fontFamily: T.mono, color: T.textSm, background: T.border, padding: "1px 5px", borderRadius: 3 }}>{project.projectCode}</span>}
            <span style={{ fontSize: 10, color: T.textSm }}>{relTime(project.lastActivity)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
          {project.failCount > 0 && <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: T.red, background: T.redSoft, padding: "2px 6px", borderRadius: 4 }}>{project.failCount}✗</span>}
          {project.warnCount > 0 && <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: T.amber, background: T.amberSoft, padding: "2px 6px", borderRadius: 4 }}>{project.warnCount}!</span>}
        </div>
      </div>
      {CHECK_COLUMNS.map(col => {
        const check = project.checks.find(c => c.id === col.id);
        return (
          <div key={col.id} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "9px 4px", borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, background: T.surface }}>
            {check ? <CheckCell check={check} onClick={() => onCheckClick(check)} /> : <div style={{ width: 34, height: 34, borderRadius: 7, background: T.card, border: `1px solid ${T.border}` }} />}
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN DASHBOARD
═══════════════════════════════════════════════════════════════ */

export default function ComplianceDashboard({ orgId, orgs }: { orgId: string; orgs: Org[] }) {
  const [data, setData] = useState<{ projects: ProjectCompliance[]; summary: Summary } | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState(orgId);
  const [ragFilter, setRagFilter] = useState<"all" | Rag>("all");
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<{ project: ProjectCompliance; check: ComplianceCheck } | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  const load = useCallback(async (org: string) => {
    setLoading(true); setErr(null);
    try {
      const res = await fetch(`/api/governance/compliance?orgId=${encodeURIComponent(org)}`, { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) throw new Error(json?.error ?? "Failed to load");
      setData({ projects: json.projects, summary: json.summary });
      setRefreshedAt(new Date());
    } catch (e: any) {
      setErr(e?.message ?? "Failed to load compliance data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(selectedOrg); }, [selectedOrg, load]);

  const filtered = (data?.projects ?? []).filter(p => {
    if (ragFilter !== "all" && p.overallRag !== ragFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.projectName.toLowerCase().includes(q) || (p.projectCode ?? "").toLowerCase().includes(q);
    }
    return true;
  });

  const S = data?.summary ?? { total: 0, compliant: 0, warnings: 0, critical: 0, checksTotal: 0, checksFail: 0, checksWarn: 0, checksPass: 0 };
  const complianceRate = S.total > 0 ? Math.round((S.compliant / S.total) * 100) : 0;
  const gridCols = `minmax(240px,1fr) ${CHECK_COLUMNS.map(() => "44px").join(" ")}`;

  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.sans, color: T.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;700&family=JetBrains+Mono:wght@400;700&display=swap');
        .compliance-grid { display: grid; grid-template-columns: ${gridCols}; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .skeleton { animation: shimmer 1.5s ease infinite; background: ${T.card}; border-radius: 8px; }
        @keyframes shimmer { 0%,100%{opacity:0.4} 50%{opacity:0.7} }
      `}</style>

      {/* Header & KPI Summary would go here */}
      <div style={{ padding: "32px" }}>
        <h1 style={{ fontSize: 24, marginBottom: 8 }}>Governance Dashboard</h1>
        {loading ? <div className="skeleton" style={{ height: 200 }} /> : (
           <div className="compliance-grid" style={{ border: `1px solid ${T.border}`, borderRadius: 12, overflow: "hidden" }}>
             {/* Header Row */}
             <div style={{ display: "contents", background: T.card }}>
                <div style={{ padding: "12px 16px", fontWeight: "bold", borderBottom: `1px solid ${T.border}` }}>Project</div>
                {CHECK_COLUMNS.map(c => (
                  <div key={c.id} style={{ borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 900 }}>{c.short}</div>
                ))}
             </div>
             {/* Project Rows */}
             {filtered.map(p => <ProjectRow key={p.projectId} project={p} onCheckClick={c => setModal({ project: p, check: c })} />)}
           </div>
        )}
      </div>

      {modal && <Modal project={modal.project} check={modal.check} onClose={() => setModal(null)} />}
    </div>
  );
}
