"use client";

// src/app/insights/InsightsClient.tsx — Executive Intelligence Dossier v2
// Data sources:
//   /api/portfolio/raid-exec-summary  — RAID portfolio executive brief
//   /api/portfolio/raid-list          — full RAID item list + financials
//   /api/portfolio/health             — portfolio health score + drivers
//   /api/ai/briefing                  — AI insights feed (changes, finance, resources)

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

/* ─── Google Fonts ──────────────────────────────────────────────────────────── */
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,600;0,700;1,400&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap";

/* ─── Types ─────────────────────────────────────────────────────────────────── */

type WindowDays = 7 | 14 | 30 | 60;
type Rag = "R" | "A" | "G" | "N";

type ExecSummary = {
  ok: true;
  org_name?: string | null;
  client_name?: string | null;
  scope: string;
  days: number;
  summary: { headline: string; generated_at: string };
  kpis: {
    total_items: number;
    overdue_open: number;
    high_score: number;
    sla_hot: number;
    exposure_total: number;
    exposure_total_fmt?: string;
  };
  sections: {
    key: string;
    title: string;
    items: ExecItem[];
  }[];
  meta?: any;
};

type ExecItem = {
  id: string;
  project_id?: string | null;
  project_title?: string | null;
  project_code_label?: string | null;
  type?: string | null;
  title?: string | null;
  score?: number | null;
  due_date?: string | null;
  owner_label?: string | null;
  sla_breach_probability?: number | null;
  sla_days_to_breach?: number | null;
  exposure_total?: number | null;
  exposure_total_fmt?: string | null;
  overdue?: boolean | null;
  note?: string | null;
  prompt?: string | null;
  href?: string | null;
};

type HealthApi = {
  ok: true;
  portfolio_health: number;
  projectCount: number;
  days: number;
  parts: { schedule: number; raid: number; flow: number; approvals: number; activity: number };
  drivers?: any[];
};

type BriefingInsight = {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  body: string;
  href?: string | null;
};

type FinanceItem = {
  id: string;
  project_id: string;
  project_title: string;
  project_code: string | null;
  type: string;
  title: string;
  status: string;
  currency_symbol: string;
  est_cost_impact: number | null;
  est_revenue_at_risk: number | null;
  est_penalties: number | null;
  total_exposure: number;
  score: number | null;
  due_date: string | null;
  due_date_uk: string | null;
};

/* ─── Design Tokens ─────────────────────────────────────────────────────────── */

const T = {
  bg:      "#f9f7f4",
  surface: "#ffffff",
  hr:      "#e7e5e4",
  ink:     "#1c1917",
  ink2:    "#44403c",
  ink3:    "#78716c",
  ink4:    "#a8a29e",
  ink5:    "#d6d3d1",
  mono:    "'IBM Plex Mono', 'Menlo', monospace",
  serif:   "'Playfair Display', 'Georgia', serif",
  body:    "'Source Serif 4', 'Georgia', serif",
};

const RAG: Record<Rag, { fg: string; bg: string; border: string; label: string }> = {
  R: { fg: "#7f1d1d", bg: "#fef2f2", border: "#fca5a5", label: "CRITICAL" },
  A: { fg: "#78350f", bg: "#fffbeb", border: "#fcd34d", label: "ADVISORY" },
  G: { fg: "#14532d", bg: "#f0fdf4", border: "#86efac", label: "CLEAR"    },
  N: { fg: "#57534e", bg: "#fafaf9", border: "#e7e5e4", label: "—"        },
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function num(x: any, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }
function clamp(x: any) { const n = Number(x); return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0; }

function nowUK() {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  }).replace(",", "");
}

function fmtUkDate(x: any) {
  if (!x) return "—";
  const s = String(x).slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

function scoreRag(score: number | null): Rag {
  if (score == null) return "N";
  if (score >= 70) return "R";
  if (score >= 40) return "A";
  return "G";
}

function healthRag(score: number): Rag {
  if (score >= 85) return "G";
  if (score >= 70) return "A";
  return "R";
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const r = await fetch(url, init);
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch { return null; }
}

/* ─── Atoms ─────────────────────────────────────────────────────────────────── */

function Mono({ children, size = 11, color, weight = 400, upper = false }: {
  children: React.ReactNode; size?: number; color?: string; weight?: number; upper?: boolean;
}) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: size, color: color ?? T.ink3,
      fontWeight: weight, letterSpacing: upper ? "0.08em" : undefined,
      textTransform: upper ? "uppercase" : undefined,
    }}>{children}</span>
  );
}

function Cap({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 9, fontWeight: 600,
      letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4,
    }}>{children}</span>
  );
}

function Pip({ rag, pulse }: { rag: Rag; pulse?: boolean }) {
  const color = rag === "N" ? T.ink5 : RAG[rag].fg;
  return (
    <span style={{ position: "relative", display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10 }}>
      {pulse && rag === "R" && (
        <span style={{ position: "absolute", inset: -3, borderRadius: "50%", background: color, opacity: 0.2, animation: "ragPulse 2.2s ease-in-out infinite" }} />
      )}
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: color, display: "inline-block" }} />
    </span>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 5, padding: "4px 12px",
      fontFamily: T.mono, fontSize: 10, fontWeight: active ? 600 : 400,
      letterSpacing: "0.07em", textTransform: "uppercase",
      background: active ? T.ink : "transparent",
      color: active ? "#fff" : T.ink3,
      border: `1px solid ${active ? T.ink : T.hr}`,
      borderRadius: 2, cursor: "pointer", transition: "all 0.13s ease",
    }}>{label}</button>
  );
}

function SectionRule({ label }: { label?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      {label && <Cap>{label}</Cap>}
      <div style={{ flex: 1, height: "1px", background: T.hr }} />
    </div>
  );
}

/* ─── Health Meter ──────────────────────────────────────────────────────────── */

function HealthMeter({ score, parts }: { score: number; parts?: HealthApi["parts"] }) {
  const rag = healthRag(score);
  const color = RAG[rag].fg;
  const partLabels = parts ? [
    { k: "Schedule", v: parts.schedule },
    { k: "RAID",     v: parts.raid },
    { k: "Flow",     v: parts.flow },
    { k: "Approvals",v: parts.approvals },
    { k: "Activity", v: parts.activity },
  ] : [];
  return (
    <div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 16 }}>
        <div style={{ fontFamily: T.serif, fontSize: 72, fontWeight: 700, lineHeight: 1, color, letterSpacing: "-0.02em" }}>
          {score}
          <span style={{ fontFamily: T.mono, fontSize: 28, color: T.ink4, fontWeight: 300 }}>%</span>
        </div>
        <div>
          <div style={{
            fontFamily: T.mono, fontSize: 10, fontWeight: 600,
            letterSpacing: "0.1em", color: RAG[rag].fg,
            background: RAG[rag].bg, border: `1px solid ${RAG[rag].border}`,
            padding: "3px 8px", borderRadius: 2, display: "inline-block",
          }}>
            {RAG[rag].label}
          </div>
          <div style={{ marginTop: 6 }}>
            <Cap>Portfolio Health Score</Cap>
          </div>
        </div>
      </div>
      <div style={{ height: 4, background: T.hr, borderRadius: 4, overflow: "hidden", marginBottom: 20 }}>
        <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 4, transition: "width 1s ease" }} />
      </div>
      {partLabels.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {partLabels.map(({ k, v }) => {
            const pr = healthRag(v);
            return (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Mono size={10} color={T.ink4} upper>{k}</Mono>
                <div style={{ flex: 1, height: 2, background: T.hr, borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${v}%`, background: RAG[pr].fg, borderRadius: 2, opacity: 0.7 }} />
                </div>
                <Mono size={11} color={RAG[pr].fg} weight={600}>{v}</Mono>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── KPI Cell ──────────────────────────────────────────────────────────────── */

function KpiCell({ label, value, alert, sub }: { label: string; value: string | number; alert?: boolean; sub?: string }) {
  return (
    <div style={{ padding: "20px 24px", borderRight: `1px solid ${T.hr}` }}>
      <Cap>{label}</Cap>
      <div style={{
        fontFamily: T.serif, fontSize: 36, fontWeight: 700, lineHeight: 1,
        marginTop: 8, marginBottom: 4, color: alert ? RAG.R.fg : T.ink,
      }}>{value}</div>
      {sub && <Cap>{sub}</Cap>}
    </div>
  );
}

/* ─── Severity Badge ────────────────────────────────────────────────────────── */

function SevBadge({ sev }: { sev: "high" | "medium" | "info" }) {
  const cfg = {
    high:   { fg: RAG.R.fg, bg: RAG.R.bg, bd: RAG.R.border, label: "HIGH"   },
    medium: { fg: RAG.A.fg, bg: RAG.A.bg, bd: RAG.A.border, label: "MEDIUM" },
    info:   { fg: "#1e40af", bg: "#eff6ff", bd: "#bfdbfe",   label: "INFO"   },
  }[sev];
  return (
    <span style={{
      fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em",
      color: cfg.fg, background: cfg.bg, border: `1px solid ${cfg.bd}`,
      padding: "2px 7px", borderRadius: 2,
    }}>{cfg.label}</span>
  );
}

/* ─── RAID Item Row ─────────────────────────────────────────────────────────── */

function RaidItemRow({ item, expanded, onToggle }: {
  item: ExecItem; expanded: boolean; onToggle: () => void;
}) {
  const rag = scoreRag(item.score ?? null);
  const rc = RAG[rag];
  const over = item.overdue;

  return (
    <>
      <tr
        onClick={onToggle}
        style={{ cursor: "pointer", background: expanded ? "#faf9f7" : T.surface, transition: "background 0.1s" }}
        className="raid-row"
      >
        {/* RAG strip */}
        <td style={{ width: 3, padding: 0 }}>
          <div style={{ width: 3, minHeight: 52, background: rag === "N" ? "transparent" : rc.fg, opacity: rag === "G" ? 0.4 : 1 }} />
        </td>
        {/* Title */}
        <td style={{ padding: "12px 16px", verticalAlign: "middle" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Mono size={9} color={T.ink4} weight={600} upper>{item.type || "RAID"}</Mono>
              {over && <Mono size={9} color={RAG.R.fg} weight={600} upper>Overdue</Mono>}
            </div>
            <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, fontWeight: 400, lineHeight: 1.3 }}>
              {item.title}
            </div>
            {item.project_title && <Mono size={10} color={T.ink4}>{item.project_title}</Mono>}
          </div>
        </td>
        {/* Score */}
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 90 }}>
          {item.score != null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 44, height: 2, background: T.ink5, borderRadius: 2, overflow: "hidden" }}>
                <div style={{ width: `${item.score}%`, height: "100%", background: rc.fg, borderRadius: 2 }} />
              </div>
              <Mono size={12} color={rc.fg} weight={600}>{item.score}</Mono>
            </div>
          ) : <Mono color={T.ink5}>—</Mono>}
        </td>
        {/* SLA */}
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 90 }}>
          {item.sla_breach_probability != null ? (
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Pip rag={num(item.sla_breach_probability) >= 70 ? "R" : num(item.sla_breach_probability) >= 40 ? "A" : "G"}
                pulse={num(item.sla_breach_probability) >= 70} />
              <Mono size={11} color={T.ink3} weight={500}>{item.sla_breach_probability}%</Mono>
            </div>
          ) : <Mono color={T.ink5}>—</Mono>}
        </td>
        {/* Exposure */}
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 110 }}>
          <Mono size={11} color={num(item.exposure_total) > 500_000 ? RAG.A.fg : num(item.exposure_total) > 0 ? T.ink3 : T.ink5}
            weight={num(item.exposure_total) > 0 ? 600 : 400}>
            {item.exposure_total_fmt || "—"}
          </Mono>
        </td>
        {/* Due */}
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 100 }}>
          <Mono size={11} color={over ? RAG.R.fg : T.ink3} weight={over ? 600 : 400}>
            {fmtUkDate(item.due_date)}
          </Mono>
        </td>
        {/* Owner */}
        <td style={{ padding: "12px 16px", verticalAlign: "middle", width: 140 }}>
          <Mono size={10} color={T.ink4}>{item.owner_label || "—"}</Mono>
        </td>
        {/* Toggle */}
        <td style={{ padding: "12px 12px 12px 6px", verticalAlign: "middle", width: 28, textAlign: "center" }}>
          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.ink4, display: "inline-block", transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ padding: 0, borderBottom: `1px solid ${T.hr}` }}>
            <div style={{ background: rc.bg, borderTop: `1px solid ${rc.border}`, padding: "20px 32px 24px", animation: "drawerOpen 0.18s ease-out both" }}>
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 40 }}>
                <div>
                  <SectionRule label="Intelligence Summary" />
                  <p style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, lineHeight: 1.75, margin: 0, fontWeight: 300 }}>
                    {item.note || item.prompt || "No summary available."}
                  </p>
                </div>
                <div>
                  <SectionRule label="Details" />
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      ["Score", item.score != null ? String(item.score) : null],
                      ["SLA Breach", item.sla_breach_probability != null ? `${item.sla_breach_probability}%` : null],
                      ["Days to Breach", item.sla_days_to_breach != null ? `~${item.sla_days_to_breach}d` : null],
                      ["Exposure", item.exposure_total_fmt || null],
                      ["Due Date", fmtUkDate(item.due_date)],
                      ["Owner", item.owner_label || null],
                    ].filter(([, v]) => v).map(([k, v]) => (
                      <div key={k as string} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
                        <Mono size={10} color={T.ink4}>{k}</Mono>
                        <Mono size={11} color={T.ink2} weight={500}>{v}</Mono>
                      </div>
                    ))}
                  </div>
                  {item.href && (
                    <div style={{ marginTop: 16 }}>
                      <Link href={item.href} onClick={(e) => e.stopPropagation()} style={{
                        fontFamily: T.mono, fontSize: 10, fontWeight: 600,
                        letterSpacing: "0.1em", color: "#1d4ed8",
                        textDecoration: "none", borderBottom: "1px solid #bfdbfe", paddingBottom: 1,
                      }}>
                        OPEN IN PROJECT REGISTER →
                      </Link>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── AI Insight Card ───────────────────────────────────────────────────────── */

function InsightCard({ insight }: { insight: BriefingInsight }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{
      background: T.surface, border: `1px solid ${T.hr}`,
      borderLeft: `3px solid ${insight.severity === "high" ? RAG.R.fg : insight.severity === "medium" ? RAG.A.fg : "#1d4ed8"}`,
      padding: "16px 20px", cursor: "pointer",
      transition: "background 0.1s",
    }} onClick={() => setExpanded(v => !v)}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
            <SevBadge sev={insight.severity} />
          </div>
          <div style={{ fontFamily: T.body, fontSize: 13.5, color: T.ink, fontWeight: 600, lineHeight: 1.3 }}>
            {insight.title}
          </div>
          {expanded && (
            <p style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, lineHeight: 1.75, margin: "10px 0 0", fontWeight: 300, animation: "drawerOpen 0.15s ease-out" }}>
              {insight.body}
            </p>
          )}
        </div>
        <span style={{ fontFamily: T.mono, fontSize: 11, color: T.ink4, flexShrink: 0, marginTop: 2, transition: "transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
      </div>
      {expanded && insight.href && (
        <div style={{ marginTop: 12 }}>
          <Link href={insight.href} onClick={(e) => e.stopPropagation()} style={{
            fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em",
            color: "#1d4ed8", textDecoration: "none", borderBottom: "1px solid #bfdbfe", paddingBottom: 1,
          }}>VIEW DETAILS →</Link>
        </div>
      )}
    </div>
  );
}

/* ─── Section Panel ─────────────────────────────────────────────────────────── */

function SectionPanel({ section }: { section: ExecSummary["sections"][0] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (!section.items.length) return null;

  const TH: React.CSSProperties = {
    padding: "8px 16px", fontFamily: T.mono, fontSize: 9, fontWeight: 600,
    letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink4,
    textAlign: "left", borderBottom: `1px solid ${T.hr}`, background: "#f5f3f0",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden", animation: "fadeUp 0.4s ease both" }}>
      <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.ink }}>{section.title}</div>
        <Mono size={10} color={T.ink5} upper>{section.items.length} items</Mono>
      </div>
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={{ ...TH, width: 3, padding: 0 }} />
              <th style={{ ...TH, minWidth: 280 }}>Item</th>
              <th style={{ ...TH, width: 90 }}>Score</th>
              <th style={{ ...TH, width: 90 }}>SLA</th>
              <th style={{ ...TH, width: 110 }}>Exposure</th>
              <th style={{ ...TH, width: 100 }}>Due</th>
              <th style={{ ...TH, width: 140 }}>Owner</th>
              <th style={{ ...TH, width: 28 }} />
            </tr>
          </thead>
          <tbody>
            {section.items.map((item) => (
              <React.Fragment key={item.id}>
                <RaidItemRow
                  item={item}
                  expanded={expandedId === item.id}
                  onToggle={() => setExpandedId(expandedId === item.id ? null : item.id)}
                />
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ─── Download Bar ──────────────────────────────────────────────────────────── */

function DownloadBar({ days, scope }: { days: WindowDays; scope: string }) {
  const [loading, setLoading] = useState<"pdf" | "pptx" | "md" | null>(null);

  async function download(format: "pdf" | "pptx" | "md") {
    setLoading(format);
    try {
      const url = `/api/portfolio/raid-exec-summary?days=${days}&scope=${scope}&download=1&format=${format}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Download failed");
      const blob = await res.blob();
      const a = document.createElement("a");
      const ext = format === "pptx" ? "pptx" : format === "md" ? "md" : "pdf";
      a.href = URL.createObjectURL(blob);
      a.download = `portfolio_raid_brief_${days}d.${ext}`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 300);
    } catch { alert("Download failed — please try again."); }
    finally { setLoading(null); }
  }

  const btn = (format: "pdf" | "pptx" | "md", label: string) => (
    <button
      onClick={() => download(format)}
      disabled={!!loading}
      style={{
        fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
        textTransform: "uppercase", padding: "8px 16px",
        background: loading === format ? T.ink : "transparent",
        color: loading === format ? "#fff" : T.ink2,
        border: `1px solid ${T.hr}`, borderRadius: 2, cursor: loading ? "default" : "pointer",
        transition: "all 0.13s ease",
      }}
    >
      {loading === format ? "GENERATING…" : label}
    </button>
  );

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {btn("pdf",  "↓ PDF")}
      {btn("pptx", "↓ PPTX")}
      {btn("md",   "↓ MD")}
    </div>
  );
}

/* ─── Main Component ────────────────────────────────────────────────────────── */

export default function InsightsClient() {
  const [mounted, setMounted]           = useState(false);
  const [windowDays, setWindowDays]     = useState<WindowDays>(30);
  const [scope, setScope]               = useState<"all" | "window" | "overdue">("all");
  const [activeTab, setActiveTab]       = useState<"overview" | "raid" | "ai" | "finance">("overview");

  const [execData,    setExecData]      = useState<ExecSummary | null>(null);
  const [execLoading, setExecLoading]   = useState(true);
  const [health,      setHealth]        = useState<HealthApi | null>(null);
  const [insights,    setInsights]      = useState<BriefingInsight[]>([]);
  const [insLoading,  setInsLoading]    = useState(true);
  const [finItems,    setFinItems]      = useState<FinanceItem[]>([]);
  const [finLoading,  setFinLoading]    = useState(false);
  const [finSort,     setFinSort]       = useState<"total" | "cost" | "revenue" | "penalties">("total");

  useEffect(() => { setMounted(true); }, []);

  /* ── Fetch exec summary ── */
  useEffect(() => {
    let c = false;
    setExecLoading(true);
    (async () => {
      const j = await fetchJson<any>(`/api/portfolio/raid-exec-summary?days=${windowDays}&scope=${scope}`);
      if (!c) { setExecData(j?.ok ? j : null); setExecLoading(false); }
    })();
    return () => { c = true; };
  }, [windowDays, scope]);

  /* ── Fetch health ── */
  useEffect(() => {
    let c = false;
    (async () => {
      const j = await fetchJson<any>(`/api/portfolio/health?days=${windowDays}`);
      if (!c && j?.ok) setHealth(j);
    })();
    return () => { c = true; };
  }, [windowDays]);

  /* ── Fetch AI briefing ── */
  useEffect(() => {
    let c = false;
    setInsLoading(true);
    (async () => {
      const j = await fetchJson<any>(`/api/ai/briefing?days=${windowDays}`);
      if (!c) {
        setInsights(j?.ok && Array.isArray(j.insights) ? j.insights : []);
        setInsLoading(false);
      }
    })();
    return () => { c = true; };
  }, [windowDays]);

  /* ── Fetch finance (raid-list with financials) ── */
  useEffect(() => {
    if (activeTab !== "finance") return;
    let c = false;
    setFinLoading(true);
    (async () => {
      const j = await fetchJson<any>(`/api/portfolio/raid-list?scope=all&window=${windowDays}`);
      if (!c) {
        if (j?.ok && Array.isArray(j.items)) {
          const withFin = j.items
            .filter((it: any) =>
              (Number(it.est_cost_impact) || 0) +
              (Number(it.est_revenue_at_risk) || 0) +
              (Number(it.est_penalties) || 0) > 0
            )
            .map((it: any): FinanceItem => ({
              id: it.id,
              project_id: it.project_id,
              project_title: it.project_title || "Project",
              project_code: it.project_code ?? null,
              type: it.type || "RAID",
              title: it.title || "Untitled",
              status: it.status || "",
              currency_symbol: it.currency_symbol || "£",
              est_cost_impact: it.est_cost_impact ?? null,
              est_revenue_at_risk: it.est_revenue_at_risk ?? null,
              est_penalties: it.est_penalties ?? null,
              total_exposure:
                (Number(it.est_cost_impact) || 0) +
                (Number(it.est_revenue_at_risk) || 0) +
                (Number(it.est_penalties) || 0),
              score: it.score ?? null,
              due_date: it.due_date ?? null,
              due_date_uk: it.due_date_uk ?? null,
            }));
          setFinItems(withFin);
        } else {
          setFinItems([]);
        }
        setFinLoading(false);
      }
    })();
    return () => { c = true; };
  }, [activeTab, windowDays]);

  const kpis = execData?.kpis;
  const sections = execData?.sections ?? [];
  const healthScore = health ? Math.max(0, Math.min(100, Math.round(num(health.portfolio_health)))) : null;

  const TABS: { k: typeof activeTab; l: string }[] = [
    { k: "overview", l: "Overview"         },
    { k: "raid",     l: "RAID Register"    },
    { k: "finance",  l: "Finance Exposure" },
    { k: "ai",       l: "AI Signals"       },
  ];

  const SCOPES: { v: typeof scope; l: string }[] = [
    { v: "all",     l: "All" },
    { v: "window",  l: "In Window" },
    { v: "overdue", l: "Overdue" },
  ];

  const WINDOWS: WindowDays[] = [7, 14, 30, 60];

  return (
    <>
      <style>{`
        @import url("${FONT_URL}");
        @keyframes ragPulse { 0%,100%{transform:scale(1);opacity:0.2} 50%{transform:scale(2.4);opacity:0.08} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes drawerOpen { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .raid-row { transition: background 0.1s; }
        .raid-row:hover { background: #f9f7f4 !important; }
        input::placeholder { color: #a8a29e; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #d6d3d1; border-radius: 2px; }
      `}</style>

      <div style={{
        minHeight: "100vh", background: T.bg, fontFamily: T.mono,
        opacity: mounted ? 1 : 0, transition: "opacity 0.35s ease",
      }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "40px 40px 100px" }}>

          {/* ── Masthead ── */}
          <div style={{ borderBottom: `2px solid ${T.ink}`, paddingBottom: 22, marginBottom: 30, animation: "fadeUp 0.4s ease both" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <Link href="/" style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, textDecoration: "none", letterSpacing: "0.08em" }}>← PORTFOLIO INTELLIGENCE</Link>
                <span style={{ color: T.ink5 }}>·</span>
                <Cap>EXECUTIVE INSIGHTS</Cap>
              </div>
              <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
            </div>
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32 }}>
              <div>
                <h1 style={{ fontFamily: T.serif, fontSize: 48, fontWeight: 700, margin: 0, letterSpacing: "-0.02em", lineHeight: 1, color: T.ink }}>
                  Decision Intelligence
                </h1>
                <p style={{ fontFamily: T.body, fontSize: 14, color: T.ink3, marginTop: 10, fontWeight: 300, lineHeight: 1.5, maxWidth: 520 }}>
                  {execData?.summary?.headline || "RAID signals, SLA threats and financial exposure across all active projects — distilled for executive action."}
                </p>
              </div>
              <div style={{ flexShrink: 0, textAlign: "right" }}>
                {execData?.meta && (
                  <>
                    <Mono size={10} color={T.ink4} upper>{execData.meta.projectCounts?.filtered ?? execData.meta.projectCounts?.active ?? "—"} projects in scope</Mono>
                    <div style={{ marginTop: 4 }}>
                      <Mono size={10} color={T.ink5} upper>Org scope · live</Mono>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* ── Controls ── */}
          <div style={{
            background: T.surface, border: `1px solid ${T.hr}`,
            padding: "12px 18px", marginBottom: 24,
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 16,
            animation: "fadeUp 0.4s 0.06s ease both",
          }}>
            {/* Tabs */}
            <div style={{ display: "flex", gap: 3 }}>
              {TABS.map((t) => <Pill key={t.k} label={t.l} active={activeTab === t.k} onClick={() => setActiveTab(t.k)} />)}
            </div>
            <div style={{ width: 1, height: 20, background: T.hr }} />
            {/* Scope */}
            <div style={{ display: "flex", gap: 3 }}>
              {SCOPES.map((s) => <Pill key={s.v} label={s.l} active={scope === s.v} onClick={() => setScope(s.v)} />)}
            </div>
            <div style={{ width: 1, height: 20, background: T.hr }} />
            {/* Window */}
            <div style={{ display: "flex", gap: 3 }}>
              {WINDOWS.map((w) => <Pill key={w} label={`${w}D`} active={windowDays === w} onClick={() => setWindowDays(w)} />)}
            </div>
            <div style={{ marginLeft: "auto" }}>
              <DownloadBar days={windowDays} scope={scope} />
            </div>
          </div>

          {/* ── KPI Strip ── */}
          {kpis && (
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(6, 1fr)",
              border: `1px solid ${T.hr}`, background: T.surface,
              marginBottom: 24, animation: "fadeUp 0.4s 0.1s ease both",
            }}>
              <KpiCell label="Total Items"   value={kpis.total_items} />
              <KpiCell label="Overdue"       value={kpis.overdue_open}  alert={kpis.overdue_open > 0}  sub="open past due" />
              <KpiCell label="High Score"    value={kpis.high_score}    alert={kpis.high_score > 0}    sub="score ≥ 70" />
              <KpiCell label="SLA Hotspots"  value={kpis.sla_hot}       alert={kpis.sla_hot > 0}       sub="breach risk ≥ 70%" />
              {healthScore != null ? (
                <KpiCell label="Portfolio Health" value={`${healthScore}%`} sub={healthScore >= 85 ? "green" : healthScore >= 70 ? "amber" : "red"} alert={healthScore < 70} />
              ) : (
                <KpiCell label="Portfolio Health" value="—" />
              )}
              <div style={{ padding: "20px 24px" }}>
                <Cap>Total Exposure</Cap>
                <div style={{ fontFamily: T.serif, fontSize: 36, fontWeight: 700, lineHeight: 1, marginTop: 8, marginBottom: 4, color: kpis.exposure_total > 0 ? RAG.A.fg : T.ink4 }}>
                  {kpis.exposure_total > 0 ? (kpis.exposure_total_fmt || "—") : "—"}
                </div>
                <Cap>cost + revenue + penalties</Cap>
              </div>
            </div>
          )}

          {/* ── Loading ── */}
          {execLoading && (
            <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}>
              <Mono size={11} color={T.ink5}>RETRIEVING INTELLIGENCE…</Mono>
            </div>
          )}

          {/* ── OVERVIEW TAB ── */}
          {!execLoading && activeTab === "overview" && (
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 20, animation: "fadeUp 0.4s 0.14s ease both" }}>
              {/* Left: headline + section summaries */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

                {/* Headline brief */}
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "28px 32px" }}>
                  <SectionRule label="Executive Headline" />
                  <p style={{ fontFamily: T.body, fontSize: 15, color: T.ink2, lineHeight: 1.8, margin: 0, fontWeight: 300 }}>
                    {execData?.summary?.headline || "No data available for the selected window."}
                  </p>
                  {execData?.summary?.generated_at && (
                    <div style={{ marginTop: 16 }}>
                      <Mono size={10} color={T.ink5}>Generated {fmtUkDate(execData.summary.generated_at)}</Mono>
                    </div>
                  )}
                </div>

                {/* Section summaries (top 3 items each) */}
                {sections.filter(s => s.items.length > 0).map((sec) => (
                  <div key={sec.key} style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                    <div style={{ padding: "16px 24px 12px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                      <div style={{ fontFamily: T.serif, fontSize: 17, fontWeight: 600, color: T.ink }}>{sec.title}</div>
                      <button
                        onClick={() => setActiveTab("raid")}
                        style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: "#1d4ed8", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase" }}
                      >
                        VIEW ALL →
                      </button>
                    </div>
                    <div>
                      {sec.items.slice(0, 3).map((item) => {
                        const rag = scoreRag(item.score ?? null);
                        const rc = RAG[rag];
                        return (
                          <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 24px", borderBottom: `1px solid ${T.hr}` }}>
                            <div style={{ width: 3, height: 36, background: rag === "N" ? T.ink5 : rc.fg, flexShrink: 0, opacity: rag === "G" ? 0.4 : 1 }} />
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
                                <Mono size={9} color={T.ink4} weight={600} upper>{item.type}</Mono>
                                {item.overdue && <Mono size={9} color={RAG.R.fg} weight={600} upper>Overdue</Mono>}
                              </div>
                              <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                {item.title}
                              </div>
                            </div>
                            <div style={{ flexShrink: 0, textAlign: "right" }}>
                              {item.score != null && <Mono size={12} color={rc.fg} weight={600}>{item.score}</Mono>}
                            </div>
                            <div style={{ flexShrink: 0, width: 90 }}>
                              <Mono size={10} color={T.ink4}>{item.project_title}</Mono>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Right: health + AI signals */}
              <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
                {/* Health */}
                {healthScore != null && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "28px 28px" }}>
                    <SectionRule label="Portfolio Health" />
                    <HealthMeter score={healthScore} parts={health?.parts} />
                    {health?.projectCount && (
                      <div style={{ marginTop: 16, borderTop: `1px solid ${T.hr}`, paddingTop: 14 }}>
                        <Mono size={10} color={T.ink5} upper>{health.projectCount} active projects · {windowDays}d window</Mono>
                      </div>
                    )}
                  </div>
                )}

                {/* AI Signals preview */}
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "20px 24px" }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
                    <SectionRule label="AI Signals" />
                    <button onClick={() => setActiveTab("ai")} style={{
                      fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.08em",
                      color: "#1d4ed8", background: "none", border: "none", cursor: "pointer", textTransform: "uppercase", marginBottom: 14,
                    }}>ALL →</button>
                  </div>
                  {insLoading ? (
                    <Mono size={10} color={T.ink5}>LOADING SIGNALS…</Mono>
                  ) : insights.length === 0 ? (
                    <Mono size={10} color={T.ink5}>No active signals.</Mono>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                      {insights.slice(0, 4).map((ins) => (
                        <InsightCard key={ins.id} insight={ins} />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── RAID TAB ── */}
          {!execLoading && activeTab === "raid" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "fadeUp 0.4s 0.1s ease both" }}>
              {sections.length === 0 || sections.every(s => s.items.length === 0) ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}>
                  <Mono size={12} color={T.ink5}>No items match the current window and scope.</Mono>
                </div>
              ) : sections.map((sec) => (
                <SectionPanel key={sec.key} section={sec} />
              ))}
              <div style={{ display: "flex", justifyContent: "flex-end", paddingTop: 8 }}>
                <Link href="/risks" style={{
                  fontFamily: T.mono, fontSize: 10, fontWeight: 600, letterSpacing: "0.1em",
                  color: "#1d4ed8", textDecoration: "none", borderBottom: "1px solid #bfdbfe", paddingBottom: 1,
                }}>
                  OPEN FULL RAID REGISTER →
                </Link>
              </div>
            </div>
          )}

          {/* ── AI SIGNALS TAB ── */}
          {activeTab === "ai" && (
            <div style={{ animation: "fadeUp 0.4s 0.1s ease both" }}>
              {insLoading ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}>
                  <Mono size={11} color={T.ink5}>RETRIEVING AI SIGNALS…</Mono>
                </div>
              ) : insights.length === 0 ? (
                <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}>
                  <Mono size={12} color={T.ink5}>No active AI signals for this window.</Mono>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
                    <Cap>{insights.length} signals</Cap>
                    <div style={{ flex: 1, height: 1, background: T.hr }} />
                  </div>
                  {insights.map((ins) => (
                    <InsightCard key={ins.id} insight={ins} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ── FINANCE EXPOSURE TAB ── */}
          {activeTab === "finance" && (() => {
            const sym = finItems[0]?.currency_symbol || "£";
            const fmt = (v: number | null) => {
              if (!v || !Number.isFinite(v)) return "—";
              if (v >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}m`;
              if (v >= 1_000) return `${sym}${Math.round(v / 1_000)}k`;
              return `${sym}${Math.round(v)}`;
            };

            const sorted = [...finItems].sort((a, b) => {
              if (finSort === "cost")      return (b.est_cost_impact || 0) - (a.est_cost_impact || 0);
              if (finSort === "revenue")   return (b.est_revenue_at_risk || 0) - (a.est_revenue_at_risk || 0);
              if (finSort === "penalties") return (b.est_penalties || 0) - (a.est_penalties || 0);
              return b.total_exposure - a.total_exposure;
            });

            const totals = finItems.reduce((acc, it) => ({
              total:    acc.total    + it.total_exposure,
              cost:     acc.cost     + (it.est_cost_impact || 0),
              revenue:  acc.revenue  + (it.est_revenue_at_risk || 0),
              penalties:acc.penalties+ (it.est_penalties || 0),
            }), { total: 0, cost: 0, revenue: 0, penalties: 0 });

            // Group by project for the summary bar
            const byProject = finItems.reduce((acc, it) => {
              const k = it.project_title;
              if (!acc[k]) acc[k] = 0;
              acc[k] += it.total_exposure;
              return acc;
            }, {} as Record<string, number>);
            const projectList = Object.entries(byProject).sort((a, b) => b[1] - a[1]).slice(0, 8);

            const TH: React.CSSProperties = {
              padding: "9px 16px", fontFamily: T.mono, fontSize: 9, fontWeight: 600,
              letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink4,
              textAlign: "left", borderBottom: `1px solid ${T.hr}`, background: "#f5f3f0",
              whiteSpace: "nowrap", cursor: "pointer", userSelect: "none",
            };

            const sortBtn = (k: typeof finSort, label: string) => (
              <th style={{ ...TH, color: finSort === k ? T.ink : T.ink4 }} onClick={() => setFinSort(k)}>
                {label}{finSort === k ? " ↓" : ""}
              </th>
            );

            return (
              <div style={{ display: "flex", flexDirection: "column", gap: 20, animation: "fadeUp 0.4s 0.1s ease both" }}>

                {/* ── KPI Strip ── */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", border: `1px solid ${T.hr}`, background: T.surface }}>
                  {[
                    { label: "Total Exposure", value: fmt(totals.total), alert: totals.total >= 500_000 },
                    { label: "Cost Impact",    value: fmt(totals.cost),     alert: false },
                    { label: "Revenue at Risk",value: fmt(totals.revenue),  alert: false },
                    { label: "Penalties",      value: fmt(totals.penalties),alert: totals.penalties > 0 },
                  ].map(({ label, value, alert }) => (
                    <div key={label} style={{ padding: "20px 24px", borderRight: `1px solid ${T.hr}` }}>
                      <Cap>{label}</Cap>
                      <div style={{ fontFamily: T.serif, fontSize: 40, fontWeight: 700, lineHeight: 1, marginTop: 8, marginBottom: 4, color: alert ? RAG.R.fg : value === "—" ? T.ink4 : T.ink }}>{value}</div>
                    </div>
                  ))}
                </div>

                {/* ── Exposure by Project bar chart ── */}
                {projectList.length > 0 && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "24px 28px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                      <Cap>Exposure by Project</Cap>
                      <div style={{ flex: 1, height: 1, background: T.hr }} />
                      <Mono size={10} color={T.ink5}>{projectList.length} projects with exposure</Mono>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {projectList.map(([proj, val]) => {
                        const share = totals.total > 0 ? val / totals.total : 0;
                        const rag: Rag = val >= 500_000 ? "R" : val >= 100_000 ? "A" : "N";
                        return (
                          <div key={proj} style={{ display: "flex", alignItems: "center", gap: 14 }}>
                            <div style={{ width: 180, flexShrink: 0 }}>
                              <Mono size={10} color={T.ink3} weight={500}>{proj}</Mono>
                            </div>
                            <div style={{ flex: 1, height: 6, background: T.hr, borderRadius: 3, overflow: "hidden" }}>
                              <div style={{ height: "100%", width: `${Math.round(share * 100)}%`, background: rag === "N" ? T.ink3 : RAG[rag].fg, borderRadius: 3, transition: "width 0.8s ease", opacity: 0.8 }} />
                            </div>
                            <div style={{ width: 80, textAlign: "right", flexShrink: 0 }}>
                              <Mono size={12} color={rag === "N" ? T.ink3 : RAG[rag].fg} weight={600}>{fmt(val)}</Mono>
                            </div>
                            <div style={{ width: 36, textAlign: "right", flexShrink: 0 }}>
                              <Mono size={10} color={T.ink5}>{Math.round(share * 100)}%</Mono>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ── Loading / Empty ── */}
                {finLoading && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}>
                    <Mono size={11} color={T.ink5}>RETRIEVING FINANCIAL EXPOSURE DATA…</Mono>
                  </div>
                )}
                {!finLoading && finItems.length === 0 && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "80px", textAlign: "center" }}>
                    <Mono size={12} color={T.ink5}>No financial exposure recorded against RAID items.</Mono>
                    <div style={{ marginTop: 12 }}><Mono size={10} color={T.ink5}>Add cost, revenue risk or penalty estimates to RAID items to see them here.</Mono></div>
                  </div>
                )}

                {/* ── Detail Table ── */}
                {!finLoading && sorted.length > 0 && (
                  <div style={{ background: T.surface, border: `1px solid ${T.hr}`, overflow: "hidden" }}>
                    <div style={{ padding: "18px 24px 14px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
                      <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 600, color: T.ink }}>Exposure Detail</div>
                      <Mono size={10} color={T.ink5} upper>{sorted.length} items · click column to sort</Mono>
                    </div>
                    <div style={{ overflowX: "auto" }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                        <thead>
                          <tr>
                            <th style={{ ...TH, width: 3, padding: 0 }} />
                            <th style={{ ...TH, minWidth: 260 }}>RAID Item</th>
                            <th style={{ ...TH, width: 90  }}>Type</th>
                            <th style={{ ...TH, width: 80  }}>Due</th>
                            {sortBtn("cost",      "Cost Impact")}
                            {sortBtn("revenue",   "Revenue Risk")}
                            {sortBtn("penalties", "Penalties")}
                            {sortBtn("total",     "Total")}
                          </tr>
                        </thead>
                        <tbody>
                          {sorted.map((it) => {
                            const rag: Rag = it.total_exposure >= 500_000 ? "R" : it.total_exposure >= 100_000 ? "A" : "N";
                            const rc = RAG[rag];
                            const TD: React.CSSProperties = { padding: "12px 16px", verticalAlign: "middle", borderBottom: `1px solid ${T.hr}` };
                            return (
                              <tr key={it.id} style={{ background: T.surface }} className="ms-row">
                                <td style={{ width: 3, padding: 0, borderBottom: `1px solid ${T.hr}` }}>
                                  <div style={{ width: 3, minHeight: 48, background: rag === "N" ? "transparent" : rc.fg, opacity: rag === "N" ? 0 : 0.8 }} />
                                </td>
                                <td style={{ ...TD, minWidth: 260 }}>
                                  <div style={{ fontFamily: T.body, fontSize: 13, color: T.ink2, fontWeight: 400, lineHeight: 1.3, marginBottom: 3 }}>{it.title}</div>
                                  <Mono size={10} color={T.ink4}>{it.project_title}{it.project_code ? ` (${it.project_code})` : ""}</Mono>
                                </td>
                                <td style={TD}>
                                  <Mono size={10} color={T.ink3} upper weight={500}>{it.type}</Mono>
                                </td>
                                <td style={TD}>
                                  <Mono size={11} color={T.ink4}>{it.due_date_uk || "—"}</Mono>
                                </td>
                                <td style={TD}>
                                  <Mono size={12} color={it.est_cost_impact ? T.ink2 : T.ink5} weight={it.est_cost_impact ? 600 : 400}>
                                    {fmt(it.est_cost_impact)}
                                  </Mono>
                                </td>
                                <td style={TD}>
                                  <Mono size={12} color={it.est_revenue_at_risk ? RAG.A.fg : T.ink5} weight={it.est_revenue_at_risk ? 600 : 400}>
                                    {fmt(it.est_revenue_at_risk)}
                                  </Mono>
                                </td>
                                <td style={TD}>
                                  <Mono size={12} color={it.est_penalties ? RAG.R.fg : T.ink5} weight={it.est_penalties ? 600 : 400}>
                                    {fmt(it.est_penalties)}
                                  </Mono>
                                </td>
                                <td style={{ ...TD, borderRight: "none" }}>
                                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                    <div style={{ width: 40, height: 2, background: T.hr, borderRadius: 2, overflow: "hidden" }}>
                                      <div style={{ height: "100%", width: `${totals.total > 0 ? Math.min(100, Math.round((it.total_exposure / totals.total) * 100)) : 0}%`, background: rag === "N" ? T.ink4 : rc.fg, borderRadius: 2 }} />
                                    </div>
                                    <Mono size={12} color={rag === "N" ? T.ink2 : rc.fg} weight={600}>{fmt(it.total_exposure)}</Mono>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                        <tfoot>
                          <tr style={{ background: "#f5f3f0" }}>
                            <td colSpan={4} style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}>
                              <Mono size={10} color={T.ink4} upper weight={600}>Portfolio Total</Mono>
                            </td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={12} color={T.ink} weight={600}>{fmt(totals.cost)}</Mono></td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={12} color={RAG.A.fg} weight={600}>{fmt(totals.revenue)}</Mono></td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={12} color={totals.penalties > 0 ? RAG.R.fg : T.ink5} weight={600}>{fmt(totals.penalties)}</Mono></td>
                            <td style={{ padding: "12px 16px", borderTop: `2px solid ${T.hr}` }}><Mono size={13} color={T.ink} weight={700}>{fmt(totals.total)}</Mono></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* ── Footer ── */}
          <div style={{ marginTop: 40, paddingTop: 20, borderTop: `1px solid ${T.hr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Mono size={10} color={T.ink5} upper>
              Decision Intelligence · Org scope · {windowDays}d window
            </Mono>
            <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
          </div>

        </div>
      </div>
    </>
  );
}
