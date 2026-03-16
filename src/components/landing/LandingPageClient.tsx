"use client";

import { useEffect, useRef, useState } from "react";
import {
  ArrowRight, Shield, Zap, BarChart3, Users, Brain,
  CheckCircle2, ChevronRight, Sparkles, Activity,
  Building2, FileCheck, AlertTriangle, Wallet, Cpu,
  TrendingUp,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/* Logo                                                                 */
/* ------------------------------------------------------------------ */
function Logo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const sz = { sm: 28, md: 36, lg: 52 }[size];
  const fs = { sm: 18, md: 22, lg: 32 }[size];
  const LETTERS = [
    { ch: "\u039B", accent: true },
    { ch: "L",      accent: false },
    { ch: "I",      accent: true },
    { ch: "\u039E", accent: false },
    { ch: "N",      accent: false },
    { ch: "\u039B", accent: true },
  ];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
      <img
        src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
        alt="Aliena"
        width={sz}
        height={sz}
        style={{ objectFit: "contain", borderRadius: 8 }}
      />
      <span style={{ fontFamily: "'Space Grotesk', sans-serif", letterSpacing: "0.18em", fontWeight: 700, fontSize: fs, display: "inline-flex" }}>
        {LETTERS.map((l, i) => (
          <span key={i} style={{ color: l.accent ? "#00B8DB" : "inherit" }}>{l.ch}</span>
        ))}
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Starfield - deterministic, no Math.random, hydration safe           */
/* ------------------------------------------------------------------ */
const STARS = Array.from({ length: 80 }, (_, i) => ({
  id: i,
  x:     (i * 137.508 + 13) % 100,
  y:     (i * 97.3   +  7) % 100,
  size:  i % 3 === 0 ? 2 : 1,
  delay: (i * 0.19) % 4,
  dur:   2 + (i % 3),
  op:    0.3 + ((i * 0.07) % 0.5),
}));

function Starfield({ density = 1 }: { density?: number }) {
  const stars = STARS.slice(0, Math.floor(STARS.length * density));
  return (
    <div aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
      {stars.map(s => (
        <div key={s.id} style={{
          position: "absolute",
          left:     `${s.x}%`,
          top:      `${s.y}%`,
          width:    s.size,
          height:   s.size,
          borderRadius: "50%",
          background: "white",
          opacity: s.op,
          animation: `al-twinkle ${s.dur}s ${s.delay}s ease-in-out infinite alternate`,
        }} />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Governance Graph - self-contained, no GSAP                          */
/* ------------------------------------------------------------------ */
const GN = [
  { id: "programme", x: 50, y: 13, label: "Programme",    sub: "Portfolio View",         color: "#00B8DB", health: 92,  Icon: Building2 },
  { id: "pmo",       x: 20, y: 33, label: "PMO Hub",      sub: "Governance Control",     color: "#4DE3FF", health: 88,  Icon: Users },
  { id: "finance",   x: 50, y: 33, label: "Finance",      sub: "Budget & Forecast",      color: "#22C55E", health: 95,  Icon: Wallet },
  { id: "delivery",  x: 80, y: 33, label: "Delivery",     sub: "Milestones & Resources", color: "#EAB308", health: 78,  Icon: TrendingUp },
  { id: "approvals", x: 10, y: 54, label: "Approvals",    sub: "4 Pending",              color: "#F97316", health: 65,  Icon: FileCheck },
  { id: "raid",      x: 30, y: 54, label: "RAID",         sub: "12 Active",              color: "#EF4444", health: 72,  Icon: AlertTriangle },
  { id: "variance",  x: 48, y: 54, label: "Variance",     sub: "1.2M Flagged",           color: "#F97316", health: 58,  Icon: Activity },
  { id: "milestones",x: 67, y: 54, label: "Milestones",   sub: "3 At Risk",              color: "#EAB308", health: 81,  Icon: TrendingUp },
  { id: "resources", x: 86, y: 54, label: "Resources",    sub: "Overallocated",          color: "#EF4444", health: 45,  Icon: Users },
  { id: "ai",        x: 50, y: 74, label: "AI Governance",sub: "Intelligence Layer",     color: "#A855F7", health: 99,  Icon: Cpu },
  { id: "reporting", x: 50, y: 90, label: "Exec Cockpit", sub: "Unified View",           color: "#00B8DB", health: 100, Icon: Activity },
];

const EDGES = [
  ["programme","pmo"],["programme","finance"],["programme","delivery"],
  ["pmo","approvals"],["pmo","raid"],
  ["finance","variance"],["finance","reporting"],
  ["delivery","milestones"],["delivery","resources"],
  ["approvals","ai"],["raid","ai"],["variance","ai"],["milestones","ai"],["resources","ai"],
  ["ai","reporting"],
];

function hc(h: number) {
  return h >= 80 ? "#22C55E" : h >= 60 ? "#EAB308" : "#EF4444";
}

function GovernanceGraph() {
  const [hov, setHov] = useState<string | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const nx = (x: number) => (x / 100) * 800;
  const ny = (y: number) => (y / 100) * 500;

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 460 }}>
      <div aria-hidden style={{ position: "absolute", inset: 0, opacity: 0.07, backgroundImage: "linear-gradient(rgba(0,184,219,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(0,184,219,0.5) 1px,transparent 1px)", backgroundSize: "40px 40px" }} />

      <svg viewBox="0 0 800 500" style={{ width: "100%", height: "100%", overflow: "visible" }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="lg1" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor="#00B8DB" stopOpacity="0.1" />
            <stop offset="50%"  stopColor="#00B8DB" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#00B8DB" stopOpacity="0.1" />
          </linearGradient>
          <marker id="arr" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0,6 3,0 6" fill="#00B8DB" opacity="0.5" />
          </marker>
          <filter id="gl">
            <feGaussianBlur stdDeviation="2.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {EDGES.map(([a, b]) => {
          const na = GN.find(n => n.id === a)!;
          const nb = GN.find(n => n.id === b)!;
          const hi = hov === a || hov === b;
          return (
            <line key={`${a}-${b}`}
              x1={nx(na.x)} y1={ny(na.y)} x2={nx(nb.x)} y2={ny(nb.y)}
              stroke={hi ? "#00B8DB" : "url(#lg1)"}
              strokeWidth={hi ? 1.5 : 0.8}
              strokeDasharray="4 4"
              opacity={hi ? 1 : 0.45}
              markerEnd="url(#arr)"
            />
          );
        })}

        {EDGES.map(([a, b], i) => {
          const na = GN.find(n => n.id === a)!;
          const nb = GN.find(n => n.id === b)!;
          return (
            <circle key={`pkt-${a}-${b}`} r="2.5" fill="#4DE3FF" filter="url(#gl)">
              <animateMotion dur={`${1.8 + (i % 5) * 0.3}s`} repeatCount="indefinite"
                path={`M${nx(na.x)},${ny(na.y)} L${nx(nb.x)},${ny(nb.y)}`} />
              <animate attributeName="opacity" values="0;1;1;0" dur={`${1.8 + (i % 5) * 0.3}s`} repeatCount="indefinite" />
            </circle>
          );
        })}

        {GN.map(node => {
          const x  = nx(node.x);
          const y  = ny(node.y);
          const ai = node.id === "ai";
          const hi = hov === node.id;
          const sc = sel === node.id;
          const c  = 2 * Math.PI * 22;
          return (
            <g key={node.id} transform={`translate(${x},${y})`}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => setHov(node.id)}
              onMouseLeave={() => setHov(null)}
              onClick={() => setSel(s => s === node.id ? null : node.id)}
            >
              {ai && (
                <>
                  <circle r="44" fill="none" stroke="#A855F7" strokeWidth="1.5" opacity="0.3">
                    <animate attributeName="r" values="36;52;36" dur="2.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite" />
                  </circle>
                  <circle r="30" fill="none" stroke="#A855F7" strokeWidth="1" opacity="0.5">
                    <animate attributeName="r" values="28;40;28" dur="2s" begin="0.5s" repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" begin="0.5s" repeatCount="indefinite" />
                  </circle>
                </>
              )}
              {(hi || sc) && <circle r="34" fill="none" stroke={node.color} strokeWidth="1.5" opacity="0.4" filter="url(#gl)" />}
              <circle r="22" fill="none" stroke={hc(node.health)} strokeWidth="2.5"
                strokeDasharray={`${(node.health / 100) * c} ${c}`}
                strokeLinecap="round" transform="rotate(-90)" opacity="0.85" />
              <circle r="18" fill="rgba(6,10,16,0.95)" stroke={node.color} strokeWidth="1.5" />
              <text y="-28" textAnchor="middle" fill={hc(node.health)} fontSize="9" fontWeight="600" fontFamily="'IBM Plex Mono',monospace">{node.health}%</text>
              <text y="34"  textAnchor="middle" fill="#F2F5FA"          fontSize="10" fontWeight="600" fontFamily="'Space Grotesk',sans-serif">{node.label}</text>
              <text y="45"  textAnchor="middle" fill="#5A6475"          fontSize="8"  fontFamily="'IBM Plex Mono',monospace">{node.sub}</text>
            </g>
          );
        })}
      </svg>

      {sel && (() => {
        const node = GN.find(n => n.id === sel);
        if (!node) return null;
        return (
          <div style={{ position: "absolute", top: 12, right: 12, width: 210, background: "rgba(8,12,20,0.94)", backdropFilter: "blur(20px)", border: "1px solid rgba(255,255,255,0.1)", borderRadius: 16, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", border: `2px solid ${node.color}`, background: `${node.color}18`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <node.Icon size={16} color={node.color} />
              </div>
              <div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 13, fontWeight: 600, color: "#F2F5FA" }}>{node.label}</div>
                <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#5A6475" }}>{node.sub}</div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "#5A6475", marginBottom: 5 }}>Health</div>
            <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 999, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${node.health}%`, background: hc(node.health), borderRadius: 999 }} />
            </div>
            <div style={{ textAlign: "right", fontSize: 11, color: hc(node.health), fontFamily: "'IBM Plex Mono',monospace", marginTop: 4 }}>{node.health}%</div>
          </div>
        );
      })()}

      <div style={{ position: "absolute", bottom: 12, left: 12, background: "rgba(8,12,20,0.88)", backdropFilter: "blur(16px)", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 12, padding: "10px 14px" }}>
        <div style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: 9, color: "#5A6475", marginBottom: 7, letterSpacing: "0.1em" }}>LEGEND</div>
        {[["#22C55E","Healthy (80%+)"],["#EAB308","Warning (60-79%)"],["#EF4444","Critical (<60%)"]].map(([c, l]) => (
          <div key={l} style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4, fontSize: 10, color: "#99A6B7" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: c, flexShrink: 0 }} />{l}
          </div>
        ))}
      </div>

      <div style={{ position: "absolute", top: 12, left: 12, display: "flex", alignItems: "center", gap: 7, fontFamily: "'IBM Plex Mono',monospace", fontSize: 10, color: "#22C55E" }}>
        <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", animation: "al-live 1.5s ease-in-out infinite" }} />
        LIVE DATA FLOW
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */
export default function LandingPageClient() {
  const C = {
    cyan: "#00B8DB", cyanLt: "#4DE3FF", green: "#22C55E",
    amber: "#EAB308", purple: "#A855F7",
    text: "#F2F5FA", muted: "#99A6B7", muted2: "#5A6475",
    line: "rgba(255,255,255,0.07)", line2: "rgba(0,184,219,0.18)",
  };
  const dp = "'Space Grotesk',sans-serif";
  const mn = "'IBM Plex Mono',monospace";

  const pillars = [
    { k:"01", Icon:Shield,    title:"Governance Control",    desc:"Structured approvals, traceable decisions, delegated authority.",                   bullets:["Multi-step approvals","Decision audit trail","Delegated governance"] },
    { k:"02", Icon:Zap,       title:"Delivery Intelligence", desc:"AI risk signals, milestone visibility, weekly executive summaries.",                 bullets:["AI risk signals","Milestone visibility","Weekly exec summaries"] },
    { k:"03", Icon:BarChart3, title:"Financial Oversight",   desc:"Budget vs forecast vs actual with variance detection.",                              bullets:["Budget vs forecast vs actual","Variance detection","Change impact visibility"] },
    { k:"04", Icon:Users,     title:"Resource Command",      desc:"Capacity heatmaps, allocation pressure, forward planning.",                         bullets:["Capacity heatmaps","Allocation pressure","Forward planning insight"] },
    { k:"05", Icon:Brain,     title:"AI Governance Brain",   desc:"Natural language insights, AI-generated summaries, governance prompts.",             bullets:["Natural language insights","AI-generated summaries","Due-soon prompts"] },
  ];

  const outcomes  = [{ value:"Faster", label:"approval turnaround" },{ value:"Earlier", label:"risk detection" },{ value:"Stronger", label:"auditability" },{ value:"Clearer", label:"executive reporting" }];
  const audiences = [
    { title:"Enterprise PMOs",                    desc:"Gain portfolio-level visibility, governance discipline and leadership-ready reporting across complex delivery estates." },
    { title:"Public Sector & Regulated Delivery", desc:"Support accountability, decision traceability and structured oversight without adding operational drag." },
    { title:"Transformation & Delivery Leaders",  desc:"Run programmes with one AI-powered control layer spanning risks, approvals, milestones, commercials and resourcing." },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        body{background:#05070A;color:#F2F5FA;font-family:'Inter',system-ui,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
        a{color:inherit;text-decoration:none}
        @keyframes al-twinkle{from{opacity:0.15}to{opacity:0.85}}
        @keyframes al-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes al-live{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes al-glow{0%,100%{box-shadow:0 0 24px rgba(0,184,219,0.14)}50%{box-shadow:0 0 44px rgba(0,184,219,0.32)}}
        @keyframes al-fadeup{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
        .al-f1{animation:al-fadeup 0.7s 0.05s both}
        .al-f2{animation:al-fadeup 0.7s 0.15s both}
        .al-f3{animation:al-fadeup 0.7s 0.25s both}
        .al-f4{animation:al-fadeup 0.7s 0.35s both}
        .al-f5{animation:al-fadeup 0.7s 0.45s both}
        .tg{background:linear-gradient(135deg,#00B8DB 0%,#4DE3FF 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .tg-g{background:linear-gradient(135deg,#22C55E 0%,#86EFAC 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .al-card{border-radius:20px;border:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.025);transition:border-color 0.25s,transform 0.25s}
        .al-card:hover{border-color:rgba(0,184,219,0.18);transform:translateY(-3px)}
        .al-btn{display:inline-flex;align-items:center;gap:8px;padding:12px 22px;border-radius:11px;font-size:14px;font-weight:600;cursor:pointer;transition:all 0.2s;border:none;white-space:nowrap;font-family:'Inter',system-ui,sans-serif}
        .al-btn:hover{transform:translateY(-1px)}
        .al-btn-p{background:linear-gradient(135deg,#00B8DB,#4DE3FF);color:#03080E;box-shadow:0 0 24px rgba(0,184,219,0.22)}
        .al-btn-p:hover{box-shadow:0 0 40px rgba(0,184,219,0.38)}
        .al-btn-g{background:rgba(255,255,255,0.05);color:#F2F5FA;border:1px solid rgba(255,255,255,0.09)!important}
        .al-btn-g:hover{background:rgba(255,255,255,0.09)}
        .al-btn-o{background:transparent;color:#F2F5FA;border:1px solid rgba(0,184,219,0.3)!important}
        .al-btn-o:hover{background:rgba(0,184,219,0.07);border-color:#00B8DB!important}
        .al-lg{padding:14px 28px;font-size:15px;border-radius:13px}
        .al-sh{width:100%;max-width:1280px;margin:0 auto;padding:0 28px}
        .al-kk{font-size:11px;color:#4DE3FF;font-family:'IBM Plex Mono',monospace;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:12px}
        .al-h2{font-family:'Space Grotesk',sans-serif;font-size:clamp(32px,4.5vw,56px);line-height:1.0;letter-spacing:-0.035em;font-weight:700;margin-bottom:16px}
        .al-sub{font-size:17px;line-height:1.75;color:#99A6B7;max-width:680px}
        .cockpit-card{background:rgba(8,12,20,0.88);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid rgba(255,255,255,0.1);border-radius:22px;box-shadow:0 32px 80px rgba(0,0,0,0.55);animation:al-glow 4s 2s ease-in-out infinite;overflow:hidden}
        @media(max-width:1100px){.hero-r{display:none!important}.pg2{grid-template-columns:1fr!important}.pg3{grid-template-columns:1fr!important}.og4{grid-template-columns:repeat(2,1fr)!important}.ag3{grid-template-columns:1fr!important}.cc2{grid-template-columns:1fr!important}}
        @media(max-width:768px){.nl{display:none!important}.og4{grid-template-columns:1fr 1fr!important}}
        @media(max-width:520px){.ha{display:grid!important;width:100%}.ca{display:grid!important;width:100%}.al-btn{width:100%;justify-content:center}.og4{grid-template-columns:1fr!important}}
      `}</style>

      {/* NAV */}
      <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, backdropFilter:"blur(22px)", WebkitBackdropFilter:"blur(22px)", background:"rgba(5,7,10,0.72)", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:24, padding:"14px 28px", maxWidth:1280, margin:"0 auto" }}>
          <a href="/"><Logo size="md" /></a>
          <div className="nl" style={{ display:"flex", alignItems:"center", gap:28 }}>
            {["Platform","Intelligence","Outcomes","Security"].map(l => (
              <a key={l} href={`#${l.toLowerCase()}`} style={{ fontSize:13, color:C.muted, fontWeight:500, transition:"color 0.2s" }}
                onMouseEnter={e => (e.currentTarget.style.color = C.text)}
                onMouseLeave={e => (e.currentTarget.style.color = C.muted)}>{l}</a>
            ))}
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <a href="/login" className="al-btn al-btn-g">Sign in</a>
            <a href="mailto:hello@aliena.co.uk" className="al-btn al-btn-p">Book a demo</a>
          </div>
        </div>
      </nav>

      {/* HERO */}
      <section style={{ position:"relative", minHeight:"100vh", display:"flex", alignItems:"center", paddingTop:80, overflow:"hidden", background:"radial-gradient(ellipse at 65% 50%,rgba(0,184,219,0.07) 0%,transparent 55%),radial-gradient(ellipse at 90% 15%,rgba(77,227,255,0.05) 0%,transparent 30%),linear-gradient(180deg,#03050A 0%,#060C14 100%)" }}>
        <Starfield density={1} />
        <div aria-hidden style={{ position:"absolute", borderRadius:"50%", width:700, height:700, top:"5%", right:"15%", background:"radial-gradient(circle,rgba(0,184,219,0.09) 0%,transparent 70%)", pointerEvents:"none" }} />
        <div className="al-sh" style={{ position:"relative", zIndex:2 }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:48, alignItems:"center", minHeight:"calc(100vh - 80px)", padding:"60px 0" }}>
            {/* Left */}
            <div>
              <div className="al-f1" style={{ display:"inline-flex", alignItems:"center", gap:10, padding:"7px 14px", borderRadius:999, border:`1px solid ${C.line2}`, background:"rgba(0,184,219,0.08)", color:C.cyanLt, fontSize:11, fontFamily:mn, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:24 }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:C.cyan, boxShadow:`0 0 10px ${C.cyan}`, display:"inline-block" }} />
                AI Governance Platform for Programme Delivery
              </div>
              <h1 className="al-f2" style={{ fontFamily:dp, fontSize:"clamp(46px,6vw,84px)", lineHeight:0.95, letterSpacing:"-0.04em", fontWeight:700, marginBottom:22 }}>
                Govern complex<br />delivery with an<br /><span className="tg">AI-native</span><br />control layer
              </h1>
              <p className="al-f3" style={{ fontSize:18, lineHeight:1.7, color:C.muted, maxWidth:540, marginBottom:34 }}>
                Aliena AI brings approvals, RAID, financial oversight, resource planning and executive reporting into one boardroom-grade operating system for PMOs, delivery leaders and regulated organisations.
              </p>
              <div className="al-f4 ha" style={{ display:"flex", gap:12, flexWrap:"wrap", marginBottom:28 }}>
                <a href="/login" className="al-btn al-btn-p al-lg">Start pilot <ArrowRight size={16} /></a>
                <a href="mailto:hello@aliena.co.uk" className="al-btn al-btn-o al-lg">Talk to Aliena</a>
              </div>
              <div className="al-f5" style={{ display:"flex", flexWrap:"wrap", gap:8 }}>
                {["Executive Cockpit","Governance Hub","AI Risk Signals","Audit-ready workflows"].map(p => (
                  <span key={p} style={{ padding:"7px 12px", borderRadius:999, border:`1px solid ${C.line}`, background:"rgba(255,255,255,0.03)", color:C.muted, fontSize:12 }}>{p}</span>
                ))}
              </div>
            </div>
            {/* Right: cockpit card */}
            <div className="hero-r" style={{ position:"relative", height:580 }}>
              {[300,420,540].map((r,i) => (
                <div key={r} aria-hidden style={{ position:"absolute", top:"50%", left:"50%", width:r, height:r, borderRadius:"50%", border:`1px solid rgba(0,184,219,${0.07 - i*0.02})`, transform:"translate(-50%,-50%)", animation:`al-float ${8+i*2}s ${i*1.5}s ease-in-out infinite` }} />
              ))}
              <div className="cockpit-card" style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:430, zIndex:2 }}>
                <div style={{ padding:"13px 16px", borderBottom:"1px solid rgba(255,255,255,0.07)", display:"flex", alignItems:"center", justifyContent:"space-between", background:"rgba(255,255,255,0.02)" }}>
                  <div style={{ display:"flex", gap:6 }}>{[0,1,2].map(i=><span key={i} style={{ width:9, height:9, borderRadius:"50%", background:"rgba(255,255,255,0.25)", display:"inline-block" }} />)}</div>
                  <span style={{ fontFamily:mn, fontSize:10, color:C.muted2, letterSpacing:"0.08em" }}>ALIENA EXECUTIVE COCKPIT</span>
                  <span style={{ padding:"4px 10px", borderRadius:999, border:`1px solid ${C.line2}`, color:C.cyanLt, background:"rgba(0,184,219,0.08)", fontFamily:mn, fontSize:10 }}>LIVE</span>
                </div>
                <div style={{ padding:14 }}>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:14 }}>
                    {[{v:"17",l:"active projects",c:C.cyanLt},{v:"4",l:"approvals escalated",c:C.amber},{v:"1.2m",l:"variance flagged",c:C.green}].map(m=>(
                      <div key={m.v} style={{ padding:12, borderRadius:14, background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ fontFamily:dp, fontSize:24, fontWeight:700, lineHeight:1, marginBottom:5, color:m.c }}>{m.v}</div>
                        <div style={{ fontSize:11, color:C.muted, lineHeight:1.4 }}>{m.l}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"grid", gap:9, marginBottom:14 }}>
                    {[["Budget control",86],["Milestone health",78],["Approval compliance",91],["Resource readiness",73]].map(([l,v])=>(
                      <div key={l as string} style={{ display:"grid", gridTemplateColumns:"110px 1fr 36px", gap:8, alignItems:"center" }}>
                        <span style={{ fontSize:11, color:C.muted }}>{l}</span>
                        <div style={{ height:6, borderRadius:999, background:"rgba(255,255,255,0.08)", overflow:"hidden" }}>
                          <div style={{ height:"100%", width:`${v}%`, borderRadius:999, background:"linear-gradient(90deg,#00B8DB,#4DE3FF)" }} />
                        </div>
                        <span style={{ fontSize:11, color:C.text, textAlign:"right", fontFamily:mn }}>{v}%</span>
                      </div>
                    ))}
                  </div>
                  <div style={{ display:"grid", gap:8 }}>
                    {[{t:"APPROVAL FLOW",b:"Needs review",tx:"One financial plan is 5 days outside target SLA."},{t:"BUDGET VARIANCE",b:"Emerging",tx:"Forecast overrun trend in Q3 unless scope adjusted."},{t:"RESOURCE LOAD",b:"Pressure",tx:"Delivery leadership over-allocated across two programmes."}].map(s=>(
                      <div key={s.t} style={{ padding:"9px 11px", borderRadius:12, background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.06)" }}>
                        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:5 }}>
                          <span style={{ fontSize:10, color:C.cyanLt, fontFamily:mn, letterSpacing:"0.06em" }}>{s.t}</span>
                          <span style={{ fontSize:10, color:"#FDE68A", background:"rgba(234,179,8,0.1)", border:"1px solid rgba(234,179,8,0.2)", padding:"2px 8px", borderRadius:999 }}>{s.b}</span>
                        </div>
                        <div style={{ fontSize:12, color:C.text, lineHeight:1.5 }}>{s.tx}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TRUST */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,0.05)", borderBottom:"1px solid rgba(255,255,255,0.05)", background:"rgba(255,255,255,0.015)", padding:"16px 28px" }}>
        <div style={{ display:"flex", flexWrap:"wrap", gap:10, justifyContent:"center", maxWidth:1280, margin:"0 auto" }}>
          {["Built in the UK","Row-level security","Governance-ready workflows","Audit-grade decision trails","AI-assisted oversight"].map(t=>(
            <span key={t} style={{ padding:"9px 14px", borderRadius:999, border:`1px solid ${C.line}`, background:"rgba(255,255,255,0.025)", color:C.muted, fontSize:12 }}>{t}</span>
          ))}
        </div>
      </div>

      {/* PROBLEM */}
      <section style={{ padding:"96px 0", background:"linear-gradient(180deg,#060C14 0%,#04080F 100%)", position:"relative", overflow:"hidden" }}>
        <div className="al-sh">
          <div className="al-kk">The problem</div>
          <h2 className="al-h2" style={{ maxWidth:820 }}>
            Most PMOs don&apos;t struggle from lack of effort.<br />They struggle from <span className="tg">fragmented control.</span>
          </h2>
          <p className="al-sub" style={{ marginBottom:36 }}>Delivery teams work hard, but governance breaks when planning, decisions, risks, approvals and reporting live across too many disconnected places.</p>
          <div className="pg3" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16, marginBottom:24 }}>
            {[{title:"Fragmented control",desc:"Plans, RAID, approvals and reporting sit across spreadsheets, inboxes and disconnected tools."},{title:"Reactive governance",desc:"Leaders hear about delivery risk too late, after schedule, budget or confidence has already slipped."},{title:"Weak executive visibility",desc:"Decision-makers lack one reliable operating picture across projects, portfolios and approvals."}].map(p=>(
              <div key={p.title} className="al-card" style={{ padding:28 }}>
                <h3 style={{ fontFamily:dp, fontSize:22, marginBottom:12, lineHeight:1.1 }}>{p.title}</h3>
                <p style={{ color:C.muted, fontSize:15, lineHeight:1.75 }}>{p.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ padding:"28px 32px", borderRadius:20, border:"1px solid rgba(0,184,219,0.14)", background:"linear-gradient(135deg,rgba(0,184,219,0.07) 0%,rgba(255,255,255,0.02) 100%)", display:"flex", justifyContent:"space-between", alignItems:"center", gap:20, flexWrap:"wrap" }}>
            <div style={{ maxWidth:720 }}>
              <div style={{ fontFamily:dp, fontSize:26, fontWeight:700, letterSpacing:"-0.03em", marginBottom:8 }}>Aliena turns delivery operations into a governed intelligence system.</div>
              <div style={{ color:C.muted, fontSize:15, lineHeight:1.7 }}>One control layer for programme oversight, one source of truth for governance, and one AI brain to help leaders act before issues escalate.</div>
            </div>
            <a href="#platform" className="al-btn al-btn-p al-lg">Explore the platform <ChevronRight size={16} /></a>
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section id="platform" style={{ position:"relative", padding:"100px 0", overflow:"hidden", background:"#020507" }}>
        <Starfield density={0.6} />
        <div aria-hidden style={{ position:"absolute", inset:0, zIndex:0, backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 38px,rgba(0,184,219,0.03) 38px,rgba(0,184,219,0.03) 39px),repeating-linear-gradient(60deg,transparent,transparent 38px,rgba(0,184,219,0.025) 38px,rgba(0,184,219,0.025) 39px)", maskImage:"linear-gradient(to bottom right,rgba(0,0,0,0.4) 0%,transparent 70%)", WebkitMaskImage:"linear-gradient(to bottom right,rgba(0,0,0,0.4) 0%,transparent 70%)" }} />
        <div className="al-sh" style={{ position:"relative", zIndex:1 }}>
          <div style={{ maxWidth:620, marginBottom:48 }}>
            <div className="al-kk">Platform pillars</div>
            <h2 className="al-h2">Five pillars.<br /><span className="tg">One control layer.</span></h2>
            <p className="al-sub">Built to replace fragmented tools with a governed, AI-assisted delivery system.</p>
          </div>
          <div className="pg2" style={{ display:"grid", gridTemplateColumns:"repeat(2,1fr)", gap:16 }}>
            {pillars.map(p=>(
              <div key={p.k} style={{ padding:"28px 26px", borderRadius:20, border:"1px solid rgba(255,255,255,0.07)", background:"rgba(5,9,14,0.85)", backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)", position:"relative", overflow:"hidden", transition:"border-color 0.25s,transform 0.25s" }}
                onMouseEnter={e=>{(e.currentTarget as HTMLDivElement).style.borderColor="rgba(0,184,219,0.22)";(e.currentTarget as HTMLDivElement).style.transform="translateY(-3px)"}}
                onMouseLeave={e=>{(e.currentTarget as HTMLDivElement).style.borderColor="rgba(255,255,255,0.07)";(e.currentTarget as HTMLDivElement).style.transform="translateY(0)"}}>
                <div aria-hidden style={{ position:"absolute", top:0, left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(77,227,255,0.5),transparent)" }} />
                <div style={{ fontFamily:mn, fontSize:11, color:C.cyanLt, marginBottom:12, letterSpacing:"0.1em" }}>{p.k}</div>
                <div style={{ marginBottom:14, color:C.cyan }}><p.Icon size={22} /></div>
                <div style={{ fontFamily:dp, fontSize:24, letterSpacing:"-0.03em", marginBottom:10 }}>{p.title}</div>
                <div style={{ color:C.muted, fontSize:14, lineHeight:1.7, marginBottom:16 }}>{p.desc}</div>
                <div style={{ display:"grid", gap:8 }}>
                  {p.bullets.map(b=>(
                    <div key={b} style={{ display:"flex", alignItems:"flex-start", gap:9, fontSize:13 }}>
                      <span style={{ width:18, height:18, borderRadius:"50%", background:"rgba(34,197,94,0.1)", border:"1px solid rgba(34,197,94,0.2)", display:"flex", alignItems:"center", justifyContent:"center", color:C.green, fontSize:11, flexShrink:0, marginTop:1 }}>&#10003;</span>
                      {b}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ padding:28, borderRadius:20, border:"1px solid rgba(0,184,219,0.15)", background:"linear-gradient(135deg,rgba(0,184,219,0.07) 0%,rgba(255,255,255,0.02) 100%)", display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", textAlign:"center", gap:14 }}>
              <Sparkles size={28} color={C.cyan} />
              <div style={{ fontFamily:dp, fontSize:22, fontWeight:700 }}>Ready to see it live?</div>
              <div style={{ color:C.muted, fontSize:14, lineHeight:1.6, maxWidth:220 }}>Book a leadership demo and see Aliena in your delivery context.</div>
              <a href="mailto:hello@aliena.co.uk" className="al-btn al-btn-p" style={{ marginTop:4 }}>Book demo <ArrowRight size={14} /></a>
            </div>
          </div>
        </div>
      </section>

      {/* GOVERNANCE INTELLIGENCE */}
      <section id="intelligence" style={{ position:"relative", padding:"96px 0", overflow:"hidden", background:"#020408" }}>
        <Starfield density={0.7} />
        <div aria-hidden style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:800, height:800, borderRadius:"50%", background:"radial-gradient(circle,rgba(0,184,219,0.06) 0%,transparent 65%)", pointerEvents:"none" }} />
        <div className="al-sh" style={{ position:"relative", zIndex:1 }}>
          <div style={{ textAlign:"center", maxWidth:720, margin:"0 auto 40px" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, marginBottom:12 }}>
              <Sparkles size={15} color={C.purple} />
              <span style={{ fontSize:11, color:C.purple, fontFamily:mn, letterSpacing:"0.14em", textTransform:"uppercase" }}>Governance Intelligence</span>
            </div>
            <h2 className="al-h2">The <span className="tg">Ontology</span> of Delivery</h2>
            <p className="al-sub" style={{ margin:"0 auto" }}>See how Aliena connects programmes, PMO, finance, and delivery into a unified intelligence layer. Data flows in real-time. Insights emerge automatically.</p>
          </div>
          <div style={{ position:"relative", background:"rgba(8,12,20,0.65)", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:26, padding:"54px 20px 20px", height:580, boxShadow:"0 40px 100px rgba(0,0,0,0.5)" }}>
            {[{top:0,left:0,bw:"2px 0 0 2px"},{top:0,right:0,bw:"2px 2px 0 0"},{bottom:0,left:0,bw:"0 0 2px 2px"},{bottom:0,right:0,bw:"0 2px 2px 0"}].map((s,i)=>(
              <div key={i} aria-hidden style={{ position:"absolute", width:36, height:36, borderColor:"rgba(0,184,219,0.25)", borderStyle:"solid", borderWidth:s.bw, borderRadius:26, ...(s.top!==undefined?{top:0}:{}), ...(s.bottom!==undefined?{bottom:0}:{}), ...(s.left!==undefined?{left:0}:{}), ...(s.right!==undefined?{right:0}:{}), pointerEvents:"none" }} />
            ))}
            <div style={{ position:"absolute", top:16, left:20, right:20, display:"flex", alignItems:"center", justifyContent:"space-between" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, fontFamily:mn, fontSize:10, color:"#22C55E" }}>
                <div style={{ width:6, height:6, borderRadius:"50%", background:"#22C55E", animation:"al-live 1.5s ease-in-out infinite" }} />
                LIVE GOVERNANCE ONTOLOGY
              </div>
              <div style={{ display:"flex", gap:10, fontFamily:mn, fontSize:10, color:C.muted2 }}>
                {["11 NODES","13 CONNECTIONS","84% HEALTH"].map(t=>(
                  <span key={t} style={{ background:"rgba(255,255,255,0.05)", padding:"3px 8px", borderRadius:6 }}>{t}</span>
                ))}
              </div>
            </div>
            <GovernanceGraph />
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section style={{ position:"relative", padding:"96px 0", overflow:"hidden", background:"#020507" }}>
        <Starfield density={0.4} />
        <div aria-hidden style={{ position:"absolute", right:"4%", top:"50%", transform:"translateY(-50%)", width:360, height:360, borderRadius:"50%", background:"radial-gradient(circle at 35% 35%,rgba(50,20,80,0.85) 0%,rgba(10,5,20,0.95) 60%,transparent 100%)", boxShadow:"inset -30px -20px 60px rgba(0,0,0,0.8)", pointerEvents:"none" }} />
        <div aria-hidden style={{ position:"absolute", right:"4%", top:"50%", transform:"translateY(-50%) rotateX(74deg)", width:520, height:520, borderRadius:"50%", border:"14px solid rgba(0,184,219,0.06)", pointerEvents:"none" }} />
        <div className="al-sh" style={{ position:"relative", zIndex:1 }}>
          <div style={{ maxWidth:680, background:"rgba(6,10,18,0.9)", backdropFilter:"blur(24px)", WebkitBackdropFilter:"blur(24px)", border:"1px solid rgba(255,255,255,0.09)", borderRadius:24, overflow:"hidden", boxShadow:"0 40px 100px rgba(0,0,0,0.5)" }}>
            <div style={{ padding:"22px 26px", borderBottom:"1px solid rgba(255,255,255,0.07)" }}>
              <div className="al-kk">Why Aliena wins</div>
              <div style={{ fontFamily:dp, fontSize:"clamp(28px,3.5vw,40px)", letterSpacing:"-0.04em", fontWeight:700, lineHeight:1.05 }}>
                Traditional tools <span className="tg-g">record.</span><br />Aliena <span className="tg">interprets.</span>
              </div>
              <div style={{ color:C.muted, fontSize:14, marginTop:8 }}>From system of record to system of intelligence.</div>
            </div>
            <div className="cc2" style={{ display:"grid", gridTemplateColumns:"1fr 1fr" }}>
              <div style={{ padding:"20px 24px", borderRight:"1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ fontFamily:mn, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:C.muted2, marginBottom:16 }}>Traditional PM tools</div>
                <div style={{ display:"grid", gap:12 }}>
                  {["Static reports assembled after the fact","Disconnected approvals and governance evidence","RAID logs that depend on manual interpretation","Executive visibility arrives too late"].map(t=>(
                    <div key={t} style={{ display:"flex", alignItems:"flex-start", gap:9, fontSize:14, lineHeight:1.55, color:C.muted }}>
                      <span style={{ marginTop:4, flexShrink:0, opacity:0.5 }}>-</span>{t}
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ padding:"20px 24px" }}>
                <div style={{ fontFamily:mn, fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:C.cyanLt, marginBottom:16 }}>Aliena AI</div>
                <div style={{ display:"grid", gap:12 }}>
                  {["Live delivery intelligence with AI-assisted summaries","Traceable approval flows and defendable decisions","Risk, financial and schedule signals surfaced early","One control layer for leaders, PMOs and delivery teams"].map(t=>(
                    <div key={t} style={{ display:"flex", alignItems:"flex-start", gap:9, fontSize:14, lineHeight:1.55 }}>
                      <CheckCircle2 size={14} color={C.green} style={{ flexShrink:0, marginTop:3 }} />{t}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OUTCOMES */}
      <section id="outcomes" style={{ padding:"96px 0", background:"linear-gradient(180deg,#04060C 0%,#050810 100%)", position:"relative", overflow:"hidden" }}>
        <div aria-hidden style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:800, height:400, background:"radial-gradient(ellipse,rgba(0,184,219,0.05) 0%,transparent 70%)", pointerEvents:"none" }} />
        <div className="al-sh" style={{ position:"relative", zIndex:1 }}>
          <div className="al-kk">Outcomes</div>
          <h2 className="al-h2">Better decisions.<br /><span className="tg">Earlier intervention.</span></h2>
          <p className="al-sub" style={{ marginBottom:32 }}>The goal is not more dashboards. The goal is better control, earlier intervention and more confident delivery.</p>
          <div className="og4" style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:16 }}>
            {outcomes.map(o=>(
              <div key={o.label} className="al-card" style={{ padding:"28px 20px", textAlign:"center" }}>
                <div className="tg" style={{ fontFamily:dp, fontSize:42, fontWeight:800, lineHeight:1, marginBottom:10 }}>{o.value}</div>
                <div style={{ color:C.muted, fontSize:14, lineHeight:1.6 }}>{o.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* AUDIENCE */}
      <section style={{ padding:"96px 0", background:"#04060C" }}>
        <div className="al-sh">
          <div className="al-kk">Who it serves</div>
          <h2 className="al-h2">Built for organisations where<br /><span className="tg">governance and delivery</span> both matter.</h2>
          <p className="al-sub" style={{ marginBottom:32 }}>Aliena is strongest where complexity, accountability and executive visibility are all non-negotiable.</p>
          <div className="ag3" style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:16 }}>
            {audiences.map(a=>(
              <div key={a.title} className="al-card" style={{ padding:28 }}>
                <h3 style={{ fontFamily:dp, fontSize:22, letterSpacing:"-0.03em", marginBottom:12 }}>{a.title}</h3>
                <p style={{ color:C.muted, fontSize:15, lineHeight:1.75 }}>{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding:"100px 0 110px", background:"#04060C" }}>
        <div className="al-sh">
          <div style={{ borderRadius:28, border:"1px solid rgba(0,184,219,0.15)", background:"radial-gradient(ellipse at top center,rgba(0,184,219,0.09) 0%,transparent 50%),rgba(255,255,255,0.025)", padding:"60px 32px", textAlign:"center", boxShadow:"0 0 80px rgba(0,184,219,0.05)" }}>
            <div className="al-kk" style={{ marginBottom:16 }}>Get started</div>
            <h2 style={{ fontFamily:dp, fontSize:"clamp(36px,5vw,60px)", lineHeight:1.02, letterSpacing:"-0.04em", fontWeight:700, maxWidth:860, margin:"0 auto 18px" }}>
              Bring governance, visibility and AI decision intelligence into one platform.
            </h2>
            <p style={{ maxWidth:640, margin:"0 auto 28px", color:C.muted, fontSize:17, lineHeight:1.8 }}>If you want a world-class governance system for your delivery estate, Aliena is built for exactly that.</p>
            <div className="ca" style={{ display:"flex", justifyContent:"center", gap:12, flexWrap:"wrap" }}>
              <a href="/login" className="al-btn al-btn-p al-lg">Start pilot <ArrowRight size={16} /></a>
              <a href="mailto:hello@aliena.co.uk" className="al-btn al-btn-o al-lg">Book a leadership demo</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop:"1px solid rgba(255,255,255,0.05)", padding:"28px 0 42px", background:"#03050A" }}>
        <div className="al-sh">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:20, flexWrap:"wrap" }}>
            <a href="/"><Logo size="sm" /></a>
            <div style={{ display:"flex", gap:20, flexWrap:"wrap" }}>
              {[["Security","/security"],["Privacy","/privacy"],["security.txt","/.well-known/security.txt"],["Contact","mailto:hello@aliena.co.uk"]].map(([l,h])=>(
                <a key={l} href={h} style={{ color:C.muted, fontSize:13, transition:"color 0.2s" }}
                  onMouseEnter={e=>(e.currentTarget.style.color=C.text)}
                  onMouseLeave={e=>(e.currentTarget.style.color=C.muted)}>{l}</a>
              ))}
            </div>
            <div style={{ color:C.muted2, fontSize:13 }}>&#169; 2026 Aliena AI. Built in the UK.</div>
          </div>
        </div>
      </footer>
    </>
  );
}