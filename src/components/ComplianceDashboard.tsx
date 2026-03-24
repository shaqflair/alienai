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
  total: number; compliant: number; warnings: number; critical: number;
  checksTotal: number; checksFail: number; checksWarn: number; checksPass: number;
};

type Org = { id: string; name: string };

/* ═══════════════════════════════════════════════════════════════
   LIGHT THEME TOKENS
═══════════════════════════════════════════════════════════════ */

const T = {
  bg:         "#F8F9FB",
  surface:    "#FFFFFF",
  card:       "#FFFFFF",
  border:     "#E4E7EC",
  borderMd:   "#D0D5DD",
  text:       "#101828",
  textMd:     "#475467",
  textSm:     "#98A2B3",
  red:        "#D92D20",
  redBg:      "#FEF3F2",
  redBorder:  "#FECDCA",
  amber:      "#B54708",
  amberBg:    "#FFFAEB",
  amberBorder:"#FEDF89",
  green:      "#067647",
  greenBg:    "#ECFDF3",
  greenBorder:"#A9EFC5",
  blue:       "#1570EF",
  blueBg:     "#EFF8FF",
  blueBorder: "#B2DDFF",
  purple:     "#6941C6",
  purpleBg:   "#F4F3FF",
  purpleBorder:"#D9D6FE",
  navy:       "#1D2939",
  mono:       "'JetBrains Mono', 'Fira Code', monospace",
  sans:       "'DM Sans', system-ui, -apple-system, sans-serif",
};

/* ═══════════════════════════════════════════════════════════════
   CHECK COLUMNS
═══════════════════════════════════════════════════════════════ */

const CHECK_COLUMNS = [
  { id: "g1_charter",   label: "G1 — Project Charter",    short: "G1",   group: "gates"      },
  { id: "gate5",        label: "Gate 5 — Closure Report",  short: "G5",   group: "gates"      },
  { id: "weekly",       label: "Weekly Report",            short: "WR",   group: "reporting"  },
  { id: "budget",       label: "Budget vs Approved",       short: "£",    group: "finance"    },
  { id: "raid",         label: "RAID Items",               short: "RAID", group: "risk"       },
  { id: "changes",      label: "Change Requests",          short: "CR",   group: "governance" },
  { id: "artifacts",    label: "Required Artifacts",       short: "ART",  group: "governance" },
  { id: "schedule",     label: "Schedule Milestones",      short: "SCH",  group: "delivery"   },
  { id: "wbs",          label: "WBS Work Packages",        short: "WBS",  group: "delivery"   },
  { id: "deadline",     label: "Delivery Deadline",        short: "DL",   group: "delivery"   },
  { id: "approvals",    label: "Pending Approvals",        short: "APP",  group: "governance" },
  { id: "lessons",      label: "Lessons Learned",          short: "LL",   group: "knowledge"  },
  { id: "stakeholders", label: "Stakeholder Register",     short: "STK",  group: "governance" },
];

const GROUP_COLORS: Record<string, { text: string; bg: string }> = {
  gates:      { text: "#C01048", bg: "#FFF1F3" },
  reporting:  { text: "#1570EF", bg: "#EFF8FF" },
  finance:    { text: "#067647", bg: "#ECFDF3" },
  risk:       { text: "#B54708", bg: "#FFFAEB" },
  governance: { text: "#6941C6", bg: "#F4F3FF" },
  delivery:   { text: "#0E7490", bg: "#ECFEFF" },
  knowledge:  { text: "#C4320A", bg: "#FFF6EE" },
};

/* ═══════════════════════════════════════════════════════════════
   STATUS CONFIG
═══════════════════════════════════════════════════════════════ */

const STATUS: Record<CheckStatus, { bg: string; border: string; text: string; icon: string; label: string }> = {
  pass:    { bg: T.greenBg,    border: T.greenBorder,  text: T.green,  icon: "✓", label: "Pass"    },
  warn:    { bg: T.amberBg,    border: T.amberBorder,  text: T.amber,  icon: "!",  label: "Warning" },
  fail:    { bg: T.redBg,      border: T.redBorder,    text: T.red,    icon: "✗", label: "Fail"    },
  missing: { bg: T.purpleBg,   border: T.purpleBorder, text: T.purple, icon: "?",  label: "Missing" },
  na:      { bg: T.bg,         border: T.border,       text: T.textSm, icon: "–", label: "N/A"     },
};

const RAG_CFG: Record<Rag, { color: string; bg: string; border: string; label: string; dot: string }> = {
  green: { color: T.green,  bg: T.greenBg,  border: T.greenBorder,  label: "Compliant",      dot: "#12B76A" },
  amber: { color: T.amber,  bg: T.amberBg,  border: T.amberBorder,  label: "Warnings",       dot: "#F79009" },
  red:   { color: T.red,    bg: T.redBg,    border: T.redBorder,    label: "Non-Compliant",  dot: "#F04438" },
};

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */

function relTime(iso: string | null | undefined) {
  if (!iso) return "—";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d === 0) return "today"; if (d === 1) return "yesterday";
  if (d < 7)  return `${d}d ago`; if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

/* ═══════════════════════════════════════════════════════════════
   CHECK CELL
═══════════════════════════════════════════════════════════════ */

function CheckCell({ check, onClick }: { check: ComplianceCheck; onClick: () => void }) {
  const s = STATUS[check.status];
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${check.label}: ${check.detail}`}
      style={{
        width: 32, height: 32, borderRadius: 6,
        border: `1.5px solid ${s.border}`,
        background: s.bg, color: s.text,
        fontSize: 11, fontWeight: 700,
        fontFamily: T.mono, cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        transition: "transform 0.1s, box-shadow 0.1s",
      }}
      onMouseEnter={e => { e.currentTarget.style.transform = "scale(1.15)"; e.currentTarget.style.boxShadow = `0 2px 8px ${s.border}`; e.currentTarget.style.zIndex = "20"; }}
      onMouseLeave={e => { e.currentTarget.style.transform = "scale(1)";    e.currentTarget.style.boxShadow = "none";                  e.currentTarget.style.zIndex = "1"; }}
    >
      {s.icon}
    </button>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MODAL
═══════════════════════════════════════════════════════════════ */

function Modal({ project, check, onClose }: { project: ProjectCompliance; check: ComplianceCheck; onClose: () => void }) {
  const s   = STATUS[check.status];
  const col = CHECK_COLUMNS.find(c => c.id === check.id);
  const grp = col ? GROUP_COLORS[col.group] : { text: T.blue, bg: T.blueBg };

  const GUIDANCE: Record<string, string> = {
    g1_charter:   "Ensure the project charter is submitted and approved before proceeding with any significant project spend or delivery.",
    gate5:        "The project closure report must be completed and formally approved before the project can be closed in the system.",
    weekly:       "Assign the PM to submit a weekly status update immediately. Reports must be updated at least every 7 days.",
    budget:       "The financial plan must be formally approved by the appropriate governance authority before the budget is considered sanctioned. Submit the financial plan for approval through the governance workflow.",
    raid:         "Review all overdue RAID items with the project team. Escalate high-risk items to the steering committee this week.",
    changes:      "Change requests must not remain pending for more than 14 days. Schedule a change board review.",
    artifacts:    "All governance artefacts must be created and maintained. Missing artefacts indicate an incomplete governance framework.",
    schedule:     "Review overdue milestones with the PM and update the schedule baseline. Escalate critical path delays immediately.",
    wbs:          "Update the WBS to reflect current delivery status. Blocked work packages must be escalated and a resolution plan agreed.",
    deadline:     "Review the delivery forecast with the steering committee. If the deadline cannot be met, a formal change request is required.",
    approvals:    "Submitted artefacts must be reviewed and actioned within 5 working days. Assign approvers immediately.",
    lessons:      "The lessons learned log should be actively maintained throughout the project. Schedule a retrospective session.",
    stakeholders: "The stakeholder register must be reviewed at least every 90 days. Assign the PM to complete a stakeholder review.",
  };

  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(16,24,40,0.4)", zIndex: 200, backdropFilter: "blur(4px)" }} />
      <div style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 201, width: "min(500px, 94vw)", background: T.surface, border: `1px solid ${T.border}`, borderRadius: 16, overflow: "hidden", boxShadow: "0 20px 60px rgba(16,24,40,0.18)" }}>

        {/* Colour bar */}
        <div style={{ height: 4, background: grp.text }} />

        <div style={{ padding: "22px 24px" }}>
          {/* Header */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
            <div style={{ width: 46, height: 46, borderRadius: 10, background: s.bg, border: `1.5px solid ${s.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 800, color: s.text, fontFamily: T.mono, flexShrink: 0 }}>{s.icon}</div>
            <div style={{ flex: 1 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 8px", borderRadius: 4, background: grp.bg, marginBottom: 6 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: grp.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>{col?.group ?? "check"}</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{check.label}</div>
              <div style={{ fontSize: 12, color: T.textMd, marginTop: 2 }}>
                {project.projectCode ? `${project.projectCode} · ` : ""}{project.projectName}
              </div>
            </div>
            <button onClick={onClose} style={{ background: "none", border: "none", color: T.textSm, cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "2px 6px", borderRadius: 6 }}>×</button>
          </div>

          {/* Finding */}
          <div style={{ padding: "12px 14px", borderRadius: 10, background: s.bg, border: `1.5px solid ${s.border}`, marginBottom: 14 }}>
            <div style={{ fontSize: 13, color: s.text, fontWeight: 600 }}>{check.detail}</div>
            <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
              <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textSm, textTransform: "uppercase" }}>Status: <strong style={{ color: T.textMd }}>{s.label}</strong></span>
              <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textSm, textTransform: "uppercase" }}>Severity: <strong style={{ color: T.textMd }}>{check.severity}</strong></span>
            </div>
          </div>

          {/* Guidance */}
          {check.status !== "pass" && check.status !== "na" && GUIDANCE[check.id] && (
            <div style={{ padding: "12px 14px", borderRadius: 10, background: T.bg, border: `1px solid ${T.border}`, marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: T.textMd, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Recommended Action</div>
              <div style={{ fontSize: 13, color: T.textMd, lineHeight: 1.6 }}>{GUIDANCE[check.id]}</div>
            </div>
          )}

          {/* Actions */}
          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/projects/${project.projectId}`}
              style={{ flex: 1, padding: "10px", borderRadius: 8, background: T.blue, color: "#fff", textDecoration: "none", fontSize: 13, fontWeight: 600, textAlign: "center", display: "block" }}>
              Open Project →
            </Link>
            <button onClick={onClose}
              style={{ padding: "10px 18px", borderRadius: 8, background: T.bg, border: `1px solid ${T.border}`, color: T.textMd, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: T.sans }}>
              Close
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════════════════════════
   PROJECT ROW
═══════════════════════════════════════════════════════════════ */

function ProjectRow({ project, onCheckClick, idx }: {
  project: ProjectCompliance;
  onCheckClick: (check: ComplianceCheck) => void;
  idx: number;
}) {
  const rag = RAG_CFG[project.overallRag];
  const rowBg = idx % 2 === 0 ? T.surface : T.bg;

  return (
    <div style={{ display: "contents" }}>
      {/* Project info */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: `1px solid ${T.border}`, background: rowBg }}>
        <div style={{ width: 10, height: 10, borderRadius: "50%", background: rag.dot, flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <Link href={`/projects/${project.projectId}`}
            style={{ fontSize: 13, fontWeight: 600, color: T.text, textDecoration: "none", display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = T.blue; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = T.text; }}>
            {project.projectName}
          </Link>
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            {project.projectCode && (
              <span style={{ fontSize: 10, fontFamily: T.mono, color: T.textSm, background: T.bg, border: `1px solid ${T.border}`, padding: "1px 5px", borderRadius: 4 }}>
                {project.projectCode}
              </span>
            )}
            <span style={{ fontSize: 10, color: T.textSm }}>{relTime(project.lastActivity)}</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {project.failCount > 0 && (
            <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.red, background: T.redBg, border: `1px solid ${T.redBorder}`, padding: "2px 6px", borderRadius: 4 }}>
              {project.failCount}✗
            </span>
          )}
          {project.warnCount > 0 && (
            <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.amber, background: T.amberBg, border: `1px solid ${T.amberBorder}`, padding: "2px 6px", borderRadius: 4 }}>
              {project.warnCount}!
            </span>
          )}
          {project.failCount === 0 && project.warnCount === 0 && (
            <span style={{ fontSize: 10, fontFamily: T.mono, fontWeight: 700, color: T.green, background: T.greenBg, border: `1px solid ${T.greenBorder}`, padding: "2px 6px", borderRadius: 4 }}>
              ✓
            </span>
          )}
        </div>
      </div>

      {/* Check cells */}
      {CHECK_COLUMNS.map(col => {
        const check = project.checks.find(c => c.id === col.id);
        return (
          <div key={col.id} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "10px 4px", borderBottom: `1px solid ${T.border}`, borderLeft: `1px solid ${T.border}`, background: rowBg }}>
            {check
              ? <CheckCell check={check} onClick={() => onCheckClick(check)} />
              : <div style={{ width: 32, height: 32, borderRadius: 6, background: T.bg, border: `1px solid ${T.border}` }} />
            }
          </div>
        );
      })}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MAIN
═══════════════════════════════════════════════════════════════ */

export default function ComplianceDashboard({ orgId, orgs }: { orgId: string; orgs: Org[] }) {
  const [data,        setData]        = useState<{ projects: ProjectCompliance[]; summary: Summary } | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [err,         setErr]         = useState<string | null>(null);
  const [selectedOrg, setSelectedOrg] = useState(orgId);
  const [ragFilter,   setRagFilter]   = useState<"all" | Rag>("all");
  const [search,      setSearch]      = useState("");
  const [modal,       setModal]       = useState<{ project: ProjectCompliance; check: ComplianceCheck } | null>(null);
  const [refreshedAt, setRefreshedAt] = useState<Date>(new Date());

  const load = useCallback(async (org: string) => {
    setLoading(true); setErr(null);
    try {
      const res  = await fetch(`/api/governance/compliance?orgId=${encodeURIComponent(org)}`, { cache: "no-store" });
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
  const rate = S.total > 0 ? Math.round((S.compliant / S.total) * 100) : 0;
  const gridCols = `minmax(240px, 320px) ${CHECK_COLUMNS.map(() => "46px").join(" ")}`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; }
        .compliance-grid { display: grid; grid-template-columns: ${gridCols}; }
        @keyframes spin    { to { transform: rotate(360deg); } }
        @keyframes fadeUp  { from { opacity:0;transform:translateY(8px) } to { opacity:1;transform:translateY(0) } }
        @keyframes shimmer { 0%,100%{opacity:0.5} 50%{opacity:1} }
        .fade-up  { animation: fadeUp 0.3s ease both; }
        .skeleton { animation: shimmer 1.4s ease infinite; background: #F2F4F7; border-radius: 8px; }
      `}</style>

      <div style={{ minHeight: "100vh", background: T.bg, fontFamily: T.sans, color: T.text }}>

        {/* ── HEADER ── */}
        <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "0 32px", position: "sticky", top: 0, zIndex: 30, boxShadow: "0 1px 3px rgba(16,24,40,0.06)" }}>
          <div style={{ maxWidth: 1600, margin: "0 auto" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, padding: "16px 0 14px" }}>

              {/* Title */}
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: "#1D2939", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                    <polyline points="9 12 11 14 15 10" />
                  </svg>
                </div>
                <div>
                  <h1 style={{ fontSize: 18, fontWeight: 700, color: T.text, letterSpacing: "-0.2px" }}>Governance Compliance</h1>
                  <div style={{ fontSize: 11, color: T.textSm, marginTop: 1, fontFamily: T.mono }}>
                    {orgs.find(o => o.id === selectedOrg)?.name ?? "Organisation"} · Admin view · Refreshed {relTime(refreshedAt.toISOString())}
                  </div>
                </div>
              </div>

              {/* Controls */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {orgs.length > 1 && (
                  <select value={selectedOrg} onChange={e => setSelectedOrg(e.target.value)}
                    style={{ background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontFamily: T.sans, outline: "none", cursor: "pointer", boxShadow: "0 1px 2px rgba(16,24,40,0.05)" }}>
                    {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                  </select>
                )}
                <button onClick={() => load(selectedOrg)} disabled={loading}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 14px", borderRadius: 8, border: `1px solid ${T.border}`, background: T.surface, color: T.textMd, fontSize: 13, fontWeight: 600, cursor: loading ? "not-allowed" : "pointer", fontFamily: T.sans, boxShadow: "0 1px 2px rgba(16,24,40,0.05)", opacity: loading ? 0.6 : 1 }}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round"
                    style={{ animation: loading ? "spin 0.9s linear infinite" : "none" }}>
                    <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                  </svg>
                  Refresh
                </button>
              </div>
            </div>

            {/* KPI strip */}
            {data && (
              <div style={{ display: "flex", gap: 10, paddingBottom: 16 }}>
                {/* Rate bar */}
                <div style={{ flex: "0 0 200px", padding: "12px 14px", borderRadius: 10, background: T.bg, border: `1px solid ${T.border}` }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
                    <span style={{ fontSize: 10, color: T.textSm, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>Compliance</span>
                    <span style={{ fontSize: 20, fontWeight: 800, color: rate >= 80 ? T.green : rate >= 60 ? T.amber : T.red, fontFamily: T.mono }}>{rate}%</span>
                  </div>
                  <div style={{ height: 6, borderRadius: 3, background: T.border, overflow: "hidden", display: "flex" }}>
                    <div style={{ width: `${S.total ? (S.compliant / S.total)*100 : 0}%`, background: "#12B76A", transition: "width 0.6s" }} />
                    <div style={{ width: `${S.total ? (S.warnings / S.total)*100 : 0}%`, background: "#F79009", transition: "width 0.6s" }} />
                    <div style={{ width: `${S.total ? (S.critical / S.total)*100 : 0}%`, background: "#F04438", transition: "width 0.6s" }} />
                  </div>
                  <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                    {[["#12B76A","Pass"],["#F79009","Warn"],["#F04438","Fail"]].map(([c,l]) => (
                      <div key={l} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: c }} />
                        <span style={{ fontSize: 9, color: T.textSm }}>{l}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Counts */}
                {[
                  { label: "Projects",      value: S.total,     bg: T.bg,       border: T.border,       color: T.textMd },
                  { label: "Non-Compliant", value: S.critical,  bg: T.redBg,    border: T.redBorder,    color: T.red    },
                  { label: "Warnings",      value: S.warnings,  bg: T.amberBg,  border: T.amberBorder,  color: T.amber  },
                  { label: "Compliant",     value: S.compliant, bg: T.greenBg,  border: T.greenBorder,  color: T.green  },
                ].map(k => (
                  <div key={k.label} style={{ flex: 1, padding: "12px 14px", borderRadius: 10, background: k.bg, border: `1px solid ${k.border}` }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: k.color, fontFamily: T.mono, lineHeight: 1 }}>{k.value}</div>
                    <div style={{ fontSize: 10, color: T.textSm, marginTop: 5, textTransform: "uppercase", letterSpacing: "0.07em", fontWeight: 600 }}>{k.label}</div>
                  </div>
                ))}

                {/* Check breakdown */}
                <div style={{ flex: "0 0 190px", padding: "12px 14px", borderRadius: 10, background: T.bg, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: T.textSm, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>Check Results</div>
                  {[
                    { label: "Fail / Missing", value: S.checksFail, color: T.red   },
                    { label: "Warnings",        value: S.checksWarn, color: T.amber },
                    { label: "Passed",          value: S.checksPass, color: T.green },
                  ].map(r => (
                    <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                      <div style={{ width: `${S.checksTotal ? Math.max((r.value/S.checksTotal)*80,2) : 2}%`, height: 3, borderRadius: 2, background: r.color, minWidth: 4, transition: "width 0.6s" }} />
                      <span style={{ fontSize: 11, fontFamily: T.mono, color: r.color, fontWeight: 700, flexShrink: 0 }}>{r.value}</span>
                      <span style={{ fontSize: 10, color: T.textSm, flexShrink: 0 }}>{r.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── FILTERS ── */}
        <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`, padding: "10px 32px" }}>
          <div style={{ maxWidth: 1600, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search projects…"
              style={{ width: 220, background: T.surface, border: `1px solid ${T.border}`, color: T.text, borderRadius: 8, padding: "7px 12px", fontSize: 13, fontFamily: T.sans, outline: "none", boxShadow: "0 1px 2px rgba(16,24,40,0.05)" }} />
            <div style={{ display: "flex", gap: 4 }}>
              {([["all","All",T.textMd,T.border],["red","Non-Compliant",T.red,T.redBorder],["amber","Warnings",T.amber,T.amberBorder],["green","Compliant",T.green,T.greenBorder]] as const).map(([v,l,c,b]) => (
                <button key={v} onClick={() => setRagFilter(v as any)}
                  style={{ padding: "6px 12px", borderRadius: 7, border: `1px solid ${ragFilter===v ? b : T.border}`, background: ragFilter===v ? `${c}18` : T.surface, color: ragFilter===v ? c : T.textSm, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: T.sans, transition: "all 0.12s" }}>
                  {l}
                </button>
              ))}
            </div>
            {data && <span style={{ marginLeft: "auto", fontSize: 11, fontFamily: T.mono, color: T.textSm }}>{filtered.length} / {data.projects.length} projects</span>}
          </div>
        </div>

        {/* ── CONTENT ── */}
        <div style={{ maxWidth: 1600, margin: "0 auto", padding: "24px 32px" }}>

          {err && (
            <div style={{ padding: "12px 16px", borderRadius: 10, background: T.redBg, border: `1px solid ${T.redBorder}`, color: T.red, fontSize: 13, marginBottom: 20 }}>
              ⚠ {err}
            </div>
          )}

          {loading && !data && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {[...Array(5)].map((_, i) => (
                <div key={i} className="skeleton" style={{ height: 52, animationDelay: `${i * 0.08}s` }} />
              ))}
            </div>
          )}

          {!loading && data && data.projects.length === 0 && (
            <div style={{ textAlign: "center", padding: "80px 0" }}>
              <div style={{ width: 56, height: 56, borderRadius: 14, background: T.bg, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", fontSize: 24 }}>📋</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: T.text, marginBottom: 6 }}>No projects found</div>
              <div style={{ fontSize: 13, color: T.textMd, maxWidth: 400, margin: "0 auto" }}>
                No active projects were found for this organisation. Projects may need to be created or their status updated.
              </div>
            </div>
          )}

          {!loading && data && data.projects.length > 0 && filtered.length === 0 && (
            <div style={{ textAlign: "center", padding: "60px 0", color: T.textSm, fontSize: 13 }}>
              No projects match the current filter.
            </div>
          )}

          {!loading && data && filtered.length > 0 && (
            <div className="fade-up">
              <div style={{ borderRadius: 12, border: `1px solid ${T.border}`, overflow: "hidden", overflowX: "auto", boxShadow: "0 1px 3px rgba(16,24,40,0.06)" }}>

                {/* Group dots row */}
                <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "#F9FAFB", borderBottom: `1px solid ${T.border}` }}>
                  <div style={{ padding: "6px 16px" }} />
                  {CHECK_COLUMNS.map(col => {
                    const g = GROUP_COLORS[col.group];
                    return (
                      <div key={col.id} style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "5px 0", borderLeft: `1px solid ${T.border}` }}>
                        <div style={{ width: 6, height: 6, borderRadius: "50%", background: g.text }} title={col.group} />
                      </div>
                    );
                  })}
                </div>

                {/* Column headers */}
                <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "#F9FAFB", borderBottom: `1px solid ${T.borderMd}` }}>
                  <div style={{ padding: "9px 16px", fontSize: 11, fontWeight: 700, color: T.textMd, textTransform: "uppercase", letterSpacing: "0.07em" }}>
                    Project
                  </div>
                  {CHECK_COLUMNS.map(col => {
                    const g = GROUP_COLORS[col.group];
                    return (
                      <div key={col.id} title={col.label}
                        style={{ padding: "9px 4px", borderLeft: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                        <span style={{ fontSize: 9, fontFamily: T.mono, fontWeight: 700, color: g.text, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: "center", lineHeight: 1.2 }}>
                          {col.short}
                        </span>
                      </div>
                    );
                  })}
                </div>

                {/* Rows */}
                <div className="compliance-grid">
                  {filtered.map((project, idx) => (
                    <ProjectRow
                      key={project.projectId}
                      project={project}
                      idx={idx}
                      onCheckClick={check => setModal({ project, check })}
                    />
                  ))}
                </div>
              </div>

              {/* Legend */}
              <div style={{ marginTop: 16, display: "flex", flexWrap: "wrap", gap: 16, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: T.textSm, textTransform: "uppercase", letterSpacing: "0.07em" }}>Status:</span>
                  {(["pass","warn","fail","missing","na"] as CheckStatus[]).map(s => {
                    const cfg = STATUS[s];
                    return (
                      <div key={s} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <div style={{ width: 20, height: 20, borderRadius: 4, background: cfg.bg, border: `1.5px solid ${cfg.border}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 800, color: cfg.text, fontFamily: T.mono }}>{cfg.icon}</div>
                        <span style={{ fontSize: 10, color: T.textSm }}>{cfg.label}</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: T.textSm, textTransform: "uppercase", letterSpacing: "0.07em" }}>Groups:</span>
                  {Object.entries(GROUP_COLORS).map(([g, cfg]) => (
                    <div key={g} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: cfg.text }} />
                      <span style={{ fontSize: 10, color: T.textSm, textTransform: "capitalize" }}>{g}</span>
                    </div>
                  ))}
                </div>
                <span style={{ marginLeft: "auto", fontSize: 11, color: T.textSm }}>Click any cell for detail and recommended action</span>
              </div>

              {/* Glossary */}
              <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 5 }}>
                {CHECK_COLUMNS.map(col => {
                  const g = GROUP_COLORS[col.group];
                  return (
                    <div key={col.id} style={{ fontSize: 10, fontFamily: T.mono, color: T.textSm, background: T.surface, border: `1px solid ${T.border}`, padding: "2px 8px", borderRadius: 4 }}>
                      <strong style={{ color: g.text }}>{col.short}</strong> — {col.label}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {modal && <Modal project={modal.project} check={modal.check} onClose={() => setModal(null)} />}
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </>
  );
}