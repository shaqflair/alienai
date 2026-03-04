"use client";

// src/app/milestones/page.tsx — Intelligence Dossier aesthetic

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

/* ─── Fonts ─────────────────────────────────────────────────────────────────── */
const FONT_URL = "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@300;400;500;600&family=Source+Serif+4:opsz,wght@8..60,300;400;600&display=swap";

/* ─── Types ─────────────────────────────────────────────────────────────────── */
type WindowDays = 7 | 14 | 30 | 60;
type Scope = "window" | "overdue" | "all";
type StatusFilter = "" | "planned" | "in_progress" | "at_risk" | "completed" | "overdue";
type Rag = "R" | "A" | "G" | "N";

type Milestone = {
  id: string; project_id: string; project_title: string;
  milestone_name: string;
  due_date: string | null; due_date_uk: string | null;
  start_date: string | null; end_date: string | null;
  baseline_end: string | null;
  status: string; risk_score: number; ai_delay_prob: number;
  last_risk_reason: string;
  slip_days: number; slip_known: boolean; slip_label: string;
  is_done: boolean; open_href: string;
};

type ApiResp = {
  ok: boolean; days: number; scope: string; status: string;
  count: number;
  chips: { planned: number; at_risk: number; overdue: number };
  kpis: { planned: number; at_risk: number; overdue: number; ai_high_risk: number; slip_avg_days: number; slip_max_days: number };
  items: Milestone[];
  error?: string;
};

/* ─── Design Tokens ─────────────────────────────────────────────────────────── */
const T = {
  bg: "#f9f7f4", surface: "#ffffff", hr: "#e7e5e4",
  ink: "#1c1917", ink2: "#44403c", ink3: "#78716c", ink4: "#a8a29e", ink5: "#d6d3d1",
  mono: "'IBM Plex Mono','Menlo',monospace",
  serif: "'Playfair Display','Georgia',serif",
  body: "'Source Serif 4','Georgia',serif",
};

const RAG: Record<Rag, { fg: string; bg: string; border: string; label: string }> = {
  R: { fg: "#7f1d1d", bg: "#fef2f2", border: "#fca5a5", label: "CRITICAL" },
  A: { fg: "#78350f", bg: "#fffbeb", border: "#fcd34d", label: "ADVISORY" },
  G: { fg: "#14532d", bg: "#f0fdf4", border: "#86efac", label: "CLEAR"    },
  N: { fg: "#57534e", bg: "#fafaf9", border: "#e7e5e4", label: "—"        },
};

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function num(x: any) { const n = Number(x); return Number.isFinite(n) ? n : 0; }
function nowUK() {
  return new Date().toLocaleString("en-GB", { day:"2-digit",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit" }).replace(",","");
}
function isOverdue(iso: string | null) {
  if (!iso) return false;
  return iso < new Date().toISOString().slice(0, 10);
}
function statusRag(status: string, due: string | null): Rag {
  const s = status.toLowerCase().replace(/\s+/g, "_");
  if (["done","completed","closed"].some(x => s.includes(x))) return "G";
  if (due && isOverdue(due)) return "R";
  if (s.includes("at_risk") || s.includes("at risk")) return "A";
  return "N";
}
function riskRag(score: number): Rag {
  if (score >= 70) return "R";
  if (score >= 40) return "A";
  if (score > 0)   return "G";
  return "N";
}

/* ─── Atoms ─────────────────────────────────────────────────────────────────── */
function Mono({ children, size=11, color, weight=400, upper=false }: {
  children: React.ReactNode; size?: number; color?: string; weight?: number; upper?: boolean;
}) {
  return <span style={{ fontFamily: T.mono, fontSize: size, color: color ?? T.ink3, fontWeight: weight, letterSpacing: upper ? "0.08em" : undefined, textTransform: upper ? "uppercase" : undefined }}>{children}</span>;
}
function Cap({ children }: { children: React.ReactNode }) {
  return <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.13em", textTransform: "uppercase", color: T.ink4 }}>{children}</span>;
}
function Pip({ rag, pulse }: { rag: Rag; pulse?: boolean }) {
  const color = rag === "N" ? T.ink5 : RAG[rag].fg;
  return (
    <span style={{ position:"relative", display:"inline-flex", alignItems:"center", justifyContent:"center", width:10, height:10 }}>
      {pulse && rag === "R" && <span style={{ position:"absolute", inset:-3, borderRadius:"50%", background:color, opacity:0.2, animation:"ragPulse 2.2s ease-in-out infinite" }} />}
      <span style={{ width:7, height:7, borderRadius:"50%", background:color, display:"inline-block" }} />
    </span>
  );
}
function Pill({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count?: number }) {
  return (
    <button onClick={onClick} style={{
      display:"inline-flex", alignItems:"center", gap:6, padding:"4px 12px",
      fontFamily:T.mono, fontSize:10, fontWeight: active ? 600 : 400,
      letterSpacing:"0.07em", textTransform:"uppercase",
      background: active ? T.ink : "transparent", color: active ? "#fff" : T.ink3,
      border:`1px solid ${active ? T.ink : T.hr}`, borderRadius:2, cursor:"pointer", transition:"all 0.13s ease",
    }}>
      {label}
      {count !== undefined && <span style={{ fontFamily:T.mono, fontSize:9, opacity:0.7 }}>{count}</span>}
    </button>
  );
}

/* ─── KPI Cell ──────────────────────────────────────────────────────────────── */
function KpiCell({ label, value, alert, sub }: { label: string; value: string | number; alert?: boolean; sub?: string }) {
  return (
    <div style={{ padding:"20px 24px", borderRight:`1px solid ${T.hr}` }}>
      <Cap>{label}</Cap>
      <div style={{ fontFamily:T.serif, fontSize:40, fontWeight:700, lineHeight:1, marginTop:8, marginBottom:4, color: alert ? RAG.R.fg : T.ink }}>{value}</div>
      {sub && <Cap>{sub}</Cap>}
    </div>
  );
}

/* ─── Slip Meter ────────────────────────────────────────────────────────────── */
function SlipMeter({ days, known }: { days: number; known: boolean }) {
  if (!known) return <Mono color={T.ink5}>—</Mono>;
  const color = days > 14 ? RAG.R.fg : days > 0 ? RAG.A.fg : RAG.G.fg;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:6 }}>
      <Mono size={12} color={color} weight={600}>{days > 0 ? `+${days}d` : days < 0 ? `${days}d` : "0d"}</Mono>
    </div>
  );
}

/* ─── Milestone Row ─────────────────────────────────────────────────────────── */
function MilestoneRow({ m, expanded, onToggle }: { m: Milestone; expanded: boolean; onToggle: () => void }) {
  const rag  = statusRag(m.status, m.due_date);
  const rrag = riskRag(m.risk_score);
  const over = !m.is_done && isOverdue(m.due_date);
  const rc   = RAG[rag];

  const TDbase: React.CSSProperties = { padding:"13px 16px", verticalAlign:"middle", borderBottom:`1px solid ${T.hr}` };

  return (
    <>
      <tr onClick={onToggle} className="ms-row" style={{ cursor:"pointer", background: expanded ? "#faf9f7" : T.surface }}>
        {/* RAG strip */}
        <td style={{ width:3, padding:0, borderBottom:`1px solid ${T.hr}` }}>
          <div style={{ width:3, minHeight:52, background: rag==="N" ? "transparent" : rc.fg, opacity: rag==="G" ? 0.4 : 1 }} />
        </td>
        {/* Milestone */}
        <td style={{ ...TDbase, minWidth:280 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <div style={{ display:"flex", alignItems:"center", gap:8 }}>
              {over && <Mono size={9} color={RAG.R.fg} weight={600} upper>Overdue</Mono>}
              {m.is_done && <Mono size={9} color={RAG.G.fg} weight={600} upper>Done</Mono>}
            </div>
            <div style={{ fontFamily:T.body, fontSize:13.5, color:T.ink2, fontWeight:400, lineHeight:1.3 }}>{m.milestone_name}</div>
            <Mono size={10} color={T.ink4}>{m.project_title}</Mono>
          </div>
        </td>
        {/* Status */}
        <td style={{ ...TDbase, width:110 }}>
          <span style={{
            fontFamily:T.mono, fontSize:9, fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase",
            padding:"2px 7px", borderRadius:2,
            background: rc.bg, color: rc.fg, border:`1px solid ${rc.border}`,
          }}>{m.status}</span>
        </td>
        {/* Due */}
        <td style={{ ...TDbase, width:110 }}>
          <Mono size={12} color={over ? RAG.R.fg : T.ink3} weight={over ? 600 : 400}>{m.due_date_uk || "—"}</Mono>
        </td>
        {/* Slip */}
        <td style={{ ...TDbase, width:80 }}>
          <SlipMeter days={m.slip_days} known={m.slip_known} />
        </td>
        {/* Risk */}
        <td style={{ ...TDbase, width:90 }}>
          {m.risk_score > 0 ? (
            <div style={{ display:"flex", alignItems:"center", gap:7 }}>
              <Pip rag={rrag} pulse={rrag==="R"} />
              <Mono size={12} color={RAG[rrag].fg} weight={600}>{m.risk_score}</Mono>
            </div>
          ) : <Mono color={T.ink5}>—</Mono>}
        </td>
        {/* AI Delay */}
        <td style={{ ...TDbase, width:90 }}>
          {m.ai_delay_prob > 0 ? (
            <Mono size={12} color={m.ai_delay_prob >= 70 ? RAG.R.fg : m.ai_delay_prob >= 40 ? RAG.A.fg : T.ink3} weight={600}>
              {m.ai_delay_prob}%
            </Mono>
          ) : <Mono color={T.ink5}>—</Mono>}
        </td>
        {/* Toggle */}
        <td style={{ ...TDbase, width:28, textAlign:"center", paddingLeft:6, paddingRight:12 }}>
          <span style={{ fontFamily:T.mono, fontSize:11, color:T.ink4, display:"inline-block", transition:"transform 0.2s", transform: expanded ? "rotate(180deg)" : "none" }}>▾</span>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={8} style={{ padding:0, borderBottom:`1px solid ${T.hr}` }}>
            <div style={{ background: rc.bg, borderTop:`1px solid ${rc.border}`, padding:"20px 32px 24px", animation:"drawerOpen 0.18s ease-out both" }}>
              <div style={{ display:"grid", gridTemplateColumns:"2fr 1fr", gap:40 }}>
                <div>
                  {m.last_risk_reason && (
                    <>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                        <Cap>AI Risk Assessment</Cap>
                        <div style={{ flex:1, height:"1px", background:T.hr }} />
                      </div>
                      <p style={{ fontFamily:T.body, fontSize:13, color:T.ink2, lineHeight:1.75, margin:0, fontWeight:300 }}>{m.last_risk_reason}</p>
                    </>
                  )}
                  {!m.last_risk_reason && (
                    <p style={{ fontFamily:T.body, fontSize:13, color:T.ink4, margin:0 }}>No AI assessment available for this milestone.</p>
                  )}
                </div>
                <div>
                  <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:14 }}>
                    <Cap>Schedule Detail</Cap>
                    <div style={{ flex:1, height:"1px", background:T.hr }} />
                  </div>
                  <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
                    {[
                      ["Due Date",    m.due_date_uk],
                      ["Slip",        m.slip_known ? m.slip_label : null],
                      ["Baseline End",m.baseline_end ? m.baseline_end.split("-").reverse().join("/") : null],
                      ["Risk Score",  m.risk_score > 0 ? String(m.risk_score) : null],
                      ["AI Delay",    m.ai_delay_prob > 0 ? `${m.ai_delay_prob}%` : null],
                      ["Status",      m.status],
                    ].filter(([,v]) => v).map(([k, v]) => (
                      <div key={k as string} style={{ display:"flex", justifyContent:"space-between", alignItems:"baseline", gap:12 }}>
                        <Mono size={10} color={T.ink4}>{k}</Mono>
                        <Mono size={11} color={T.ink2} weight={500}>{v}</Mono>
                      </div>
                    ))}
                  </div>
                  <div style={{ marginTop:16 }}>
                    <Link href={m.open_href} onClick={e => e.stopPropagation()} style={{
                      fontFamily:T.mono, fontSize:10, fontWeight:600, letterSpacing:"0.1em",
                      color:"#1d4ed8", textDecoration:"none", borderBottom:"1px solid #bfdbfe", paddingBottom:1,
                    }}>OPEN IN SCHEDULE →</Link>
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

/* ─── Main ──────────────────────────────────────────────────────────────────── */
export default function MilestonesPage() {
  const router = useRouter();
  const sp     = useSearchParams();

  const [mounted,    setMounted]    = useState(false);
  const [data,       setData]       = useState<ApiResp | null>(null);
  const [loading,    setLoading]    = useState(true);
  const [days,       setDays]       = useState<WindowDays>(() => {
    const d = Number(sp?.get("days")); return ([7,14,30,60] as WindowDays[]).includes(d as any) ? d as WindowDays : 30;
  });
  const [scope,      setScope]      = useState<Scope>(() => {
    const s = safeStr(sp?.get("scope")); return (["window","overdue","all"] as Scope[]).includes(s as any) ? s as Scope : "window";
  });
  const [statusF,    setStatusF]    = useState<StatusFilter>(() => {
    const s = safeStr(sp?.get("status")); return (["","planned","in_progress","at_risk","completed","overdue"] as StatusFilter[]).includes(s as any) ? s as StatusFilter : "";
  });
  const [search,     setSearch]     = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let c = false;
    setLoading(true);
    const p = new URLSearchParams({ days: String(days), scope });
    if (statusF) p.set("status", statusF);
    fetch(`/api/milestones/list?${p}`, { cache:"no-store" })
      .then(r => r.json()).then(j => { if (!c) setData(j); })
      .catch(() => { if (!c) setData({ ok:false, days, scope, status:statusF, count:0, chips:{planned:0,at_risk:0,overdue:0}, kpis:{planned:0,at_risk:0,overdue:0,ai_high_risk:0,slip_avg_days:0,slip_max_days:0}, items:[], error:"Failed to load" }); })
      .finally(() => { if (!c) setLoading(false); });
    return () => { c = true; };
  }, [days, scope, statusF]);

  const items = useMemo(() => {
    if (!data?.items) return [];
    let list = data.items;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter(m => `${m.milestone_name} ${m.project_title}`.toLowerCase().includes(q));
    }
    return list;
  }, [data, search]);

  const SCOPES: {v:Scope; l:string}[] = [{v:"window",l:"In Window"},{v:"overdue",l:"Overdue"},{v:"all",l:"All"}];
  const STATUSES: {v:StatusFilter; l:string; count?: number}[] = [
    {v:"",l:"All"},
    {v:"planned",   l:"Planned",    count: data?.chips.planned},
    {v:"at_risk",   l:"At Risk",    count: data?.chips.at_risk},
    {v:"overdue",   l:"Overdue",    count: data?.chips.overdue},
    {v:"completed", l:"Completed"},
  ];

  const TH: React.CSSProperties = {
    padding:"9px 16px", fontFamily:T.mono, fontSize:9, fontWeight:600,
    letterSpacing:"0.12em", textTransform:"uppercase", color:T.ink4,
    textAlign:"left", borderBottom:`1px solid ${T.hr}`, background:"#f5f3f0", whiteSpace:"nowrap",
  };

  return (
    <>
      <style>{`
        @import url("${FONT_URL}");
        @keyframes ragPulse { 0%,100%{transform:scale(1);opacity:0.2} 50%{transform:scale(2.4);opacity:0.08} }
        @keyframes fadeUp { from{opacity:0;transform:translateY(8px)} to{opacity:1;transform:translateY(0)} }
        @keyframes drawerOpen { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        .ms-row { transition: background 0.1s; }
        .ms-row:hover { background: #f9f7f4 !important; }
        input::placeholder { color: #a8a29e; }
        input:focus { outline: none; border-color: #a8a29e !important; }
        ::-webkit-scrollbar { width:4px; height:4px; }
        ::-webkit-scrollbar-thumb { background:#d6d3d1; border-radius:2px; }
      `}</style>

      <div style={{ minHeight:"100vh", background:T.bg, fontFamily:T.mono, opacity: mounted ? 1 : 0, transition:"opacity 0.35s ease" }}>
        <div style={{ maxWidth:1320, margin:"0 auto", padding:"40px 40px 100px" }}>

          {/* ── Masthead ── */}
          <div style={{ borderBottom:`2px solid ${T.ink}`, paddingBottom:22, marginBottom:30, animation:"fadeUp 0.4s ease both" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:18 }}>
              <div style={{ display:"flex", alignItems:"center", gap:10 }}>
                <Link href="/" style={{ fontFamily:T.mono, fontSize:10, color:T.ink4, textDecoration:"none", letterSpacing:"0.08em" }}>← PORTFOLIO INTELLIGENCE</Link>
                <span style={{ color:T.ink5 }}>·</span>
                <Cap>MILESTONES</Cap>
              </div>
              <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
            </div>
            <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:32 }}>
              <div>
                <h1 style={{ fontFamily:T.serif, fontSize:48, fontWeight:700, margin:0, letterSpacing:"-0.02em", lineHeight:1, color:T.ink }}>
                  Milestone Register
                </h1>
                <p style={{ fontFamily:T.body, fontSize:14, color:T.ink3, marginTop:10, fontWeight:300, lineHeight:1.5, maxWidth:520 }}>
                  Schedule delivery intelligence — due dates, slippage, AI delay probability and risk scoring across all active projects.
                </p>
              </div>
              {data?.ok && (
                <div style={{ textAlign:"right", flexShrink:0 }}>
                  <Mono size={10} color={T.ink4} upper>{items.length} milestones</Mono>
                  <div style={{ marginTop:4 }}><Mono size={10} color={T.ink5} upper>Org scope · {days}d window</Mono></div>
                </div>
              )}
            </div>
          </div>

          {/* ── KPI Strip ── */}
          {data?.ok && (
            <div style={{ display:"grid", gridTemplateColumns:"repeat(5, 1fr)", border:`1px solid ${T.hr}`, background:T.surface, marginBottom:24, animation:"fadeUp 0.4s 0.06s ease both" }}>
              <KpiCell label="In Window"   value={data.count}           />
              <KpiCell label="Planned"     value={data.kpis.planned}    />
              <KpiCell label="At Risk"     value={data.kpis.at_risk}    alert={data.kpis.at_risk > 0}  sub="needs attention" />
              <KpiCell label="Overdue"     value={data.kpis.overdue}    alert={data.kpis.overdue > 0}  sub="past due date" />
              <div style={{ padding:"20px 24px" }}>
                <Cap>Avg Slip</Cap>
                <div style={{ fontFamily:T.serif, fontSize:40, fontWeight:700, lineHeight:1, marginTop:8, marginBottom:4, color: data.kpis.slip_avg_days > 0 ? RAG.A.fg : T.ink4 }}>
                  {data.kpis.slip_avg_days > 0 ? `+${Math.round(data.kpis.slip_avg_days)}d` : "—"}
                </div>
                <Cap>max {data.kpis.slip_max_days > 0 ? `+${Math.round(data.kpis.slip_max_days)}d` : "—"}</Cap>
              </div>
            </div>
          )}

          {/* ── Controls ── */}
          <div style={{ background:T.surface, border:`1px solid ${T.hr}`, padding:"12px 18px", marginBottom:12, display:"flex", flexWrap:"wrap", gap:14, alignItems:"center", animation:"fadeUp 0.4s 0.1s ease both" }}>
            <div style={{ display:"flex", gap:3 }}>
              {SCOPES.map(s => <Pill key={s.v} label={s.l} active={scope===s.v} onClick={() => setScope(s.v)} />)}
            </div>
            <div style={{ width:1, height:20, background:T.hr }} />
            <div style={{ display:"flex", gap:3, flexWrap:"wrap" }}>
              {STATUSES.map(s => <Pill key={s.v} label={s.l} active={statusF===s.v} onClick={() => setStatusF(s.v)} count={s.count} />)}
            </div>
            <div style={{ width:1, height:20, background:T.hr }} />
            <div style={{ display:"flex", gap:3 }}>
              {([7,14,30,60] as WindowDays[]).map(d => <Pill key={d} label={`${d}D`} active={days===d} onClick={() => setDays(d)} />)}
            </div>
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search milestone, project…"
              style={{ marginLeft:"auto", padding:"6px 12px", fontFamily:T.mono, fontSize:11, background:T.bg, border:`1px solid ${T.hr}`, borderRadius:2, color:T.ink, width:220, transition:"border-color 0.15s" }}
            />
          </div>

          {/* ── Count bar ── */}
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:10, animation:"fadeUp 0.4s 0.12s ease both" }}>
            {loading ? <Mono size={10} color={T.ink5}>LOADING…</Mono> : <Mono size={10} color={T.ink4}>{items.length} ITEMS</Mono>}
          </div>

          {/* ── Loading ── */}
          {loading && (
            <div style={{ background:T.surface, border:`1px solid ${T.hr}`, padding:"80px", textAlign:"center" }}>
              <Mono size={11} color={T.ink5}>RETRIEVING MILESTONE DATA…</Mono>
            </div>
          )}

          {/* ── Error ── */}
          {!loading && data && !data.ok && (
            <div style={{ background:RAG.R.bg, border:`1px solid ${RAG.R.border}`, borderLeft:`3px solid ${RAG.R.fg}`, padding:"18px 24px" }}>
              <Cap>Data Error</Cap>
              <p style={{ fontFamily:T.body, fontSize:13, color:RAG.R.fg, margin:"8px 0 0" }}>{data.error}</p>
            </div>
          )}

          {/* ── Table ── */}
          {!loading && data?.ok && (
            <div style={{ background:T.surface, border:`1px solid ${T.hr}`, overflow:"hidden", animation:"fadeUp 0.4s 0.14s ease both" }}>
              {items.length === 0 ? (
                <div style={{ padding:"80px", textAlign:"center" }}>
                  <Mono size={12} color={T.ink5}>No milestones match the current filters.</Mono>
                </div>
              ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%", borderCollapse:"collapse", minWidth:900 }}>
                    <thead>
                      <tr>
                        <th style={{ ...TH, width:3, padding:0 }} />
                        <th style={{ ...TH, minWidth:280 }}>Milestone</th>
                        <th style={{ ...TH, width:110 }}>Status</th>
                        <th style={{ ...TH, width:110 }}>Due Date</th>
                        <th style={{ ...TH, width:80  }}>Slip</th>
                        <th style={{ ...TH, width:90  }}>Risk Score</th>
                        <th style={{ ...TH, width:90  }}>AI Delay</th>
                        <th style={{ ...TH, width:28  }} />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map(m => (
                        <React.Fragment key={m.id}>
                          <MilestoneRow m={m} expanded={expandedId===m.id} onToggle={() => setExpandedId(expandedId===m.id ? null : m.id)} />
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ── Footer ── */}
          {!loading && data?.ok && (
            <div style={{ marginTop:24, display:"flex", justifyContent:"space-between", alignItems:"center", paddingTop:16, borderTop:`1px solid ${T.hr}` }}>
              <Mono size={10} color={T.ink5} upper>Org scope · active projects only · {days}d window · {items.length} items</Mono>
              <Mono size={10} color={T.ink5}>{nowUK()}</Mono>
            </div>
          )}

        </div>
      </div>
    </>
  );
}
