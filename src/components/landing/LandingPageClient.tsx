"use client";

import { useMemo, useState, type ComponentType } from "react";
import {
  Activity, AlertTriangle, ArrowRight, BarChart3, Brain,
  Building2, CheckCircle2, ChevronRight, Cpu, FileCheck,
  Lock, Shield, Sparkles, TrendingUp, Users, Wallet, Zap,
} from "lucide-react";

const T = {
  cyan:"#00C2E8", cyanLt:"#57E7FF", green:"#22C55E", amber:"#EAB308",
  orange:"#F97316", purple:"#A855F7", red:"#EF4444",
  text:"#F5F8FC", muted:"#A0ACBC", muted2:"#667184",
  line:"rgba(255,255,255,0.07)", lineS:"rgba(255,255,255,0.1)",
  lineCyan:"rgba(0,194,232,0.18)", bg0:"#03050A", bg1:"#07101B",
};
const F = {
  display:"'Plus Jakarta Sans', sans-serif",
  body:"'Inter', system-ui, sans-serif",
  mono:"'Fira Code', monospace",
};

/* ---- Logo ---- */
function Logo({ size="md" }: { size?: "sm"|"md"|"lg" }) {
  const s = { sm:{icon:28,text:18,gap:10}, md:{icon:36,text:22,gap:12}, lg:{icon:52,text:32,gap:14} }[size];
  const L = [
    { ch:"\u039B", a:true  }, { ch:"L", a:false }, { ch:"I", a:true  },
    { ch:"\u039E", a:false }, { ch:"N", a:false }, { ch:"\u039B", a:false },
  ];
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:s.gap }}>
      <img src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
        alt="Aliena" width={s.icon} height={s.icon} style={{ objectFit:"contain", borderRadius:10 }} />
      <span style={{ fontFamily:F.display, letterSpacing:"0.18em", fontWeight:700, fontSize:s.text, display:"inline-flex" }}>
        {L.map((l,i) => <span key={i} style={{ color:l.a ? T.cyan : "inherit" }}>{l.ch}</span>)}
      </span>
    </span>
  );
}

/* ---- Starfield ---- */
const STARS = Array.from({length:80},(_,i)=>({
  id:i, x:(i*137.508+13)%100, y:(i*97.3+7)%100,
  size:i%3===0?2:1, delay:(i*0.19)%4, dur:2+(i%3), op:0.3+((i*0.07)%0.5),
}));
function Starfield({ density=1 }: { density?:number }) {
  const stars = STARS.slice(0, Math.floor(STARS.length*density));
  return (
    <div aria-hidden style={{ position:"absolute", inset:0, pointerEvents:"none", overflow:"hidden" }}>
      {stars.map(s => (
        <div key={s.id} style={{ position:"absolute", left:`${s.x}%`, top:`${s.y}%`,
          width:s.size, height:s.size, borderRadius:"50%", background:"white", opacity:s.op,
          animation:`al-twinkle ${s.dur}s ${s.delay}s ease-in-out infinite alternate` }} />
      ))}
    </div>
  );
}

/* ---- Governance Graph ---- */
type GN = { id:string; x:number; y:number; label:string; sub:string; color:string; health:number; Icon:ComponentType<{size?:number;color?:string}> };
const GNODES: GN[] = [
  {id:"programme", x:50,y:12, label:"Programme",    sub:"Portfolio View",         color:T.cyan,   health:92, Icon:Building2    },
  {id:"pmo",       x:20,y:32, label:"PMO Hub",      sub:"Governance Control",     color:T.cyanLt, health:88, Icon:Users        },
  {id:"finance",   x:50,y:32, label:"Finance",      sub:"Budget & Forecast",      color:T.green,  health:95, Icon:Wallet       },
  {id:"delivery",  x:80,y:32, label:"Delivery",     sub:"Milestones & Resources", color:T.amber,  health:78, Icon:TrendingUp   },
  {id:"approvals", x:10,y:53, label:"Approvals",    sub:"4 Pending",              color:T.orange, health:65, Icon:FileCheck    },
  {id:"raid",      x:28,y:53, label:"RAID",         sub:"12 Active",              color:T.red,    health:72, Icon:AlertTriangle},
  {id:"variance",  x:46,y:53, label:"Variance",     sub:"1.2M Flagged",           color:T.orange, health:58, Icon:Activity     },
  {id:"milestones",x:64,y:53, label:"Milestones",   sub:"3 At Risk",              color:T.amber,  health:81, Icon:TrendingUp   },
  {id:"resources", x:82,y:53, label:"Resources",    sub:"Overallocated",          color:T.red,    health:45, Icon:Users        },
  {id:"change",    x:18,y:73, label:"Change Mgmt",  sub:"Control & Impact",       color:T.orange, health:70, Icon:FileCheck    },
  {id:"ai",        x:58,y:73, label:"AI Governance",sub:"Intelligence Layer",     color:T.purple, health:99, Icon:Cpu          },
  {id:"reporting", x:50,y:90, label:"Exec Cockpit", sub:"Unified View",           color:T.cyan,   health:100,Icon:Activity     },
];
const EDGES: Array<[string,string]> = [
  ["programme","pmo"],["programme","finance"],["programme","delivery"],
  ["pmo","approvals"],["pmo","raid"],["pmo","change"],
  ["finance","variance"],["finance","change"],["finance","reporting"],
  ["delivery","milestones"],["delivery","resources"],
  ["approvals","ai"],["raid","ai"],["variance","ai"],["milestones","ai"],["resources","ai"],
  ["change","ai"],
  ["ai","reporting"],
];
function hcol(h:number){ return h>=80?T.green:h>=60?T.amber:T.red; }

function GovernanceGraph() {
  const [hov,setHov] = useState<string|null>(null);
  const [sel,setSel] = useState<string|null>(null);
  const nm = useMemo(()=>Object.fromEntries(GNODES.map(n=>[n.id,n])),[]);
  const nx=(x:number)=>(x/100)*800, ny=(y:number)=>(y/100)*500;
  const sn = sel ? nm[sel] : null;
  return (
    <div style={{ position:"relative", width:"100%", height:"100%", minHeight:480 }}>
      <div aria-hidden style={{ position:"absolute", inset:0, opacity:0.06,
        backgroundImage:"linear-gradient(rgba(0,194,232,.55) 1px,transparent 1px),linear-gradient(90deg,rgba(0,194,232,.55) 1px,transparent 1px)",
        backgroundSize:"40px 40px" }} />
      <svg viewBox="0 0 800 500" style={{ width:"100%", height:"100%", overflow:"visible" }} preserveAspectRatio="xMidYMid meet">
        <defs>
          <linearGradient id="ge" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%"   stopColor={T.cyan} stopOpacity="0.08" />
            <stop offset="50%"  stopColor={T.cyan} stopOpacity="0.7"  />
            <stop offset="100%" stopColor={T.cyan} stopOpacity="0.08" />
          </linearGradient>
          <marker id="ga" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <polygon points="0 0,6 3,0 6" fill={T.cyan} opacity="0.5" />
          </marker>
          <filter id="gp"><feGaussianBlur stdDeviation="2.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          <filter id="gg"><feGaussianBlur stdDeviation="8"   result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
        </defs>
        {EDGES.map(([a,b])=>{
          const s=nm[a],e=nm[b]; const hi=hov===a||hov===b||sel===a||sel===b;
          return <line key={`${a}-${b}`} x1={nx(s.x)} y1={ny(s.y)} x2={nx(e.x)} y2={ny(e.y)}
            stroke={hi?T.cyan:"url(#ge)"} strokeWidth={hi?1.6:0.85} strokeDasharray="4 4"
            opacity={hi?1:0.42} markerEnd="url(#ga)" />;
        })}
        {EDGES.map(([a,b],i)=>{
          const s=nm[a],e=nm[b]; const toAi=b==="ai";
          return (
            <circle key={`p-${a}-${b}`} r={toAi?3.5:2.5} fill={toAi?T.purple:T.cyanLt} filter="url(#gp)" opacity="0">
              <animateMotion dur={`${1.8+(i%5)*0.3}s`} repeatCount="indefinite" path={`M${nx(s.x)},${ny(s.y)} L${nx(e.x)},${ny(e.y)}`}/>
              <animate attributeName="opacity" values="0;1;1;0" dur={`${1.8+(i%5)*0.3}s`} repeatCount="indefinite"/>
            </circle>
          );
        })}
        {GNODES.map(node=>{
          const x=nx(node.x),y=ny(node.y),ai=node.id==="ai",rep=node.id==="reporting",chg=node.id==="change";
          const hi=hov===node.id,sc=sel===node.id,c=2*Math.PI*22;
          return (
            <g key={node.id} transform={`translate(${x},${y})`} style={{ cursor:"pointer" }}
              onMouseEnter={()=>setHov(node.id)} onMouseLeave={()=>setHov(null)}
              onClick={()=>setSel(s=>s===node.id?null:node.id)}>
              {ai&&<>
                <circle r="44" fill="none" stroke={T.purple} strokeWidth="1.5" opacity="0.3">
                  <animate attributeName="r" values="36;52;36" dur="2.5s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.4;0;0.4" dur="2.5s" repeatCount="indefinite"/>
                </circle>
                <circle r="30" fill="none" stroke={T.purple} strokeWidth="1" opacity="0.5">
                  <animate attributeName="r" values="28;40;28" dur="2s" begin="0.5s" repeatCount="indefinite"/>
                  <animate attributeName="opacity" values="0.6;0;0.6" dur="2s" begin="0.5s" repeatCount="indefinite"/>
                </circle>
              </>}
              {rep&&<circle r="34" fill="none" stroke={T.cyan} strokeWidth="1.25" opacity="0.22">
                <animate attributeName="r" values="30;38;30" dur="3s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.25;0.08;0.25" dur="3s" repeatCount="indefinite"/>
              </circle>}
              {chg&&<circle r="30" fill="none" stroke={T.orange} strokeWidth="1" opacity="0.25">
                <animate attributeName="r" values="26;34;26" dur="2.8s" repeatCount="indefinite"/>
                <animate attributeName="opacity" values="0.3;0.06;0.3" dur="2.8s" repeatCount="indefinite"/>
              </circle>}
              {(hi||sc)&&<circle r="34" fill="none" stroke={node.color} strokeWidth="1.5" opacity="0.35" filter="url(#gg)"/>}
              <circle r="22" fill="none" stroke={hcol(node.health)} strokeWidth="2.5"
                strokeDasharray={`${(node.health/100)*c} ${c}`} strokeLinecap="round" transform="rotate(-90)" opacity="0.88"/>
              <circle r="18" fill="rgba(7,10,18,0.95)" stroke={node.color} strokeWidth="1.5"/>
              <text y="-28" textAnchor="middle" fill={hcol(node.health)} fontSize="9" fontWeight="600" fontFamily={F.mono}>{node.health}%</text>
              <g transform="translate(0,-1)">
                <foreignObject x="-10" y="-10" width="20" height="20">
                  <div style={{ width:20, height:20, display:"flex", alignItems:"center", justifyContent:"center" }}>
                    <node.Icon size={12} color={node.color}/>
                  </div>
                </foreignObject>
              </g>
              <text y="34" textAnchor="middle" fill={T.text}   fontSize="10" fontWeight="600" fontFamily={F.display}>{node.label}</text>
              <text y="45" textAnchor="middle" fill={T.muted2} fontSize="8"  fontFamily={F.mono}>{node.sub}</text>
            </g>
          );
        })}
      </svg>
      {sn&&(
        <div style={{ position:"absolute", top:14, right:14, width:230, background:"rgba(9,13,22,0.95)",
          backdropFilter:"blur(22px)", border:`1px solid ${T.lineS}`, borderRadius:18, padding:16 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
            <div style={{ width:38, height:38, borderRadius:"50%", border:`2px solid ${sn.color}`,
              background:`${sn.color}18`, display:"flex", alignItems:"center", justifyContent:"center" }}>
              <sn.Icon size={16} color={sn.color}/>
            </div>
            <div>
              <div style={{ fontFamily:F.display, fontSize:13, fontWeight:600, color:T.text }}>{sn.label}</div>
              <div style={{ fontFamily:F.mono, fontSize:9, color:T.muted2 }}>{sn.sub}</div>
            </div>
          </div>
          <div style={{ fontSize:11, color:"#7C889B", marginBottom:6 }}>Health</div>
          <div style={{ height:5, background:"rgba(255,255,255,0.08)", borderRadius:999, overflow:"hidden" }}>
            <div style={{ height:"100%", width:`${sn.health}%`, background:hcol(sn.health), borderRadius:999 }}/>
          </div>
          <div style={{ textAlign:"right", fontSize:11, color:hcol(sn.health), fontFamily:F.mono, marginTop:5 }}>{sn.health}%</div>
        </div>
      )}
      <div style={{ position:"absolute", bottom:16, left:16, background:"rgba(9,13,22,0.92)",
        backdropFilter:"blur(18px)", border:`1px solid ${T.line}`, borderRadius:16, padding:"12px 14px" }}>
        <div style={{ fontFamily:F.mono, fontSize:9, color:T.muted2, marginBottom:7, letterSpacing:"0.12em" }}>SIGNAL LEGEND</div>
        {[[T.green,"Healthy (80%+)"],[T.amber,"Warning (60-79%)"],[T.red,"Critical (<60%)"]].map(([c,l])=>(
          <div key={l} style={{ display:"flex", alignItems:"center", gap:7, marginBottom:4, fontSize:10, color:T.muted }}>
            <div style={{ width:7, height:7, borderRadius:"50%", background:c, flexShrink:0 }}/>{l}
          </div>
        ))}
      </div>
      <div style={{ position:"absolute", top:16, left:16, display:"flex", alignItems:"center", gap:8,
        fontFamily:F.mono, fontSize:10, color:"#86EFAC", padding:"8px 10px", borderRadius:999,
        border:"1px solid rgba(34,197,94,0.16)", background:"rgba(34,197,94,0.08)" }}>
        <div style={{ width:7, height:7, borderRadius:"50%", background:T.green, animation:"al-live 1.5s ease-in-out infinite" }}/>
        LIVE GOVERNANCE FLOW
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                 */
/* ------------------------------------------------------------------ */
export default function LandingPageClient() {
  const pillars = [
    { k:"01", Icon:Shield,    title:"Governance Control",   desc:"Structured approvals, traceable decisions, delegated authority and boardroom-grade control.",   bullets:["Multi-step approvals","Decision audit trail","Delegated governance"] },
    { k:"02", Icon:Zap,       title:"Delivery Intelligence", desc:"AI risk signals, milestone visibility and executive insight before issues escalate.",           bullets:["AI risk signals","Milestone visibility","Weekly executive summaries"] },
    { k:"03", Icon:BarChart3, title:"Financial Oversight",   desc:"Budget, forecast and actuals brought together with early variance detection.",                 bullets:["Budget vs forecast vs actual","Variance detection","Change impact visibility"] },
    { k:"04", Icon:Users,     title:"Resource Command",      desc:"Capacity heatmaps, allocation pressure and clearer forward planning across programmes.",       bullets:["Capacity heatmaps","Allocation pressure","Forward planning insight"] },
    { k:"05", Icon:Brain,     title:"AI Governance Brain",   desc:"Natural-language insight, AI summaries and due-soon prompts across the delivery estate.",      bullets:["Natural-language insights","AI-generated summaries","Due-soon prompts"] },
  ];
  const outcomes = [
    { value:"Faster",   label:"approval turnaround",   desc:"Eliminate manual chasing with structured approval chains." },
    { value:"Earlier",  label:"risk detection",        desc:"AI signals surface blockers before they become failures." },
    { value:"Stronger", label:"auditability",          desc:"Every decision is logged, traceable and board-ready." },
    { value:"Clearer",  label:"executive reporting",   desc:"One operating picture replaces fragmented status updates." },
  ];
  const audiences = [
    { Icon:Building2,  title:"Enterprise PMOs",                    desc:"Portfolio-level visibility, governance discipline and leadership-ready reporting across complex delivery estates." },
    { Icon:Shield,     title:"Public Sector & Regulated Delivery", desc:"Accountability, decision traceability and structured oversight without adding operational drag." },
    { Icon:TrendingUp, title:"Transformation Leaders",             desc:"One AI-powered control layer spanning risks, approvals, milestones, commercials and resourcing." },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=Inter:wght@400;500;600;700;800&family=Fira+Code:wght@400;500;600&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
        html{scroll-behavior:smooth}
        body{background:${T.bg0};color:${T.text};font-family:${F.body};-webkit-font-smoothing:antialiased;overflow-x:hidden}
        a{color:inherit;text-decoration:none}
        @keyframes al-twinkle{from{opacity:.14}to{opacity:.86}}
        @keyframes al-float{0%,100%{transform:translateY(0)}50%{transform:translateY(-10px)}}
        @keyframes al-live{0%,100%{opacity:1}50%{opacity:.28}}
        @keyframes al-glow{0%,100%{box-shadow:0 0 28px rgba(0,194,232,.12)}50%{box-shadow:0 0 54px rgba(0,194,232,.26)}}
        @keyframes al-fadeup{from{opacity:0;transform:translateY(28px)}to{opacity:1;transform:translateY(0)}}
        .al-f1{animation:al-fadeup .7s .05s both}.al-f2{animation:al-fadeup .7s .15s both}
        .al-f3{animation:al-fadeup .7s .25s both}.al-f4{animation:al-fadeup .7s .35s both}
        .al-f5{animation:al-fadeup .7s .45s both}
        .tg{background:linear-gradient(135deg,${T.cyan} 0%,${T.cyanLt} 100%);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
        .al-shell{width:100%;max-width:1280px;margin:0 auto;padding:0 28px}
        .al-kicker{font-size:11px;color:${T.cyanLt};font-family:${F.mono};letter-spacing:.14em;text-transform:uppercase;margin-bottom:12px}
        .al-h2{font-family:${F.display};font-size:clamp(32px,4.5vw,58px);line-height:.98;letter-spacing:-.045em;font-weight:700;margin-bottom:18px}
        .al-sub{font-size:17px;line-height:1.8;color:${T.muted};max-width:700px}
        .al-card{border-radius:22px;border:1px solid ${T.line};background:rgba(255,255,255,.03);box-shadow:0 10px 30px rgba(0,0,0,.18);transition:border-color .25s,transform .25s,box-shadow .25s}
        .al-card:hover{border-color:${T.lineCyan};transform:translateY(-4px);box-shadow:0 24px 60px rgba(0,0,0,.28)}
        .al-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 22px;border-radius:12px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s;border:none;white-space:nowrap;font-family:${F.body}}
        .al-btn:hover{transform:translateY(-1px)}
        .al-btn-p{background:linear-gradient(135deg,${T.cyan},${T.cyanLt});color:#031018;box-shadow:0 0 24px rgba(0,194,232,.2)}
        .al-btn-p:hover{box-shadow:0 0 42px rgba(0,194,232,.34)}
        .al-btn-g{background:rgba(255,255,255,.045);color:${T.text};border:1px solid rgba(255,255,255,.1)!important}
        .al-btn-g:hover{background:rgba(255,255,255,.08)}
        .al-btn-o{background:transparent;color:${T.text};border:1px solid rgba(0,194,232,.28)!important}
        .al-btn-o:hover{background:rgba(0,194,232,.07);border-color:${T.cyan}!important}
        .al-btn-lg{padding:14px 28px;font-size:15px;border-radius:14px}
        .chip{padding:8px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);color:${T.muted};font-size:12px}
        .hero-panel{background:rgba(8,12,20,.88);backdrop-filter:blur(28px);-webkit-backdrop-filter:blur(28px);border:1px solid rgba(255,255,255,.1);border-radius:24px;box-shadow:0 32px 90px rgba(0,0,0,.55);animation:al-glow 4s 2s ease-in-out infinite;overflow:hidden}
        .hero-grid{display:grid;grid-template-columns:1.02fr .98fr;gap:54px;align-items:center}
        .p-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:16px}
        .t-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
        .f-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
        .two-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        .ont-grid{display:grid;grid-template-columns:minmax(0,420px) minmax(0,1fr);gap:24px;align-items:stretch}
        @media(max-width:1100px){
          .hero-r{display:none!important}
          .hero-grid,.p-grid,.t-grid,.ont-grid,.two-grid{grid-template-columns:1fr!important}
          .f-grid{grid-template-columns:repeat(2,1fr)!important}
        }
        @media(max-width:640px){
          .nav-links{display:none!important}
          .hero-actions{display:grid!important;width:100%}
          .f-grid{grid-template-columns:1fr!important}
          .al-btn{width:100%}
        }
      `}</style>

      {/* NAV */}
      <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:100,
        backdropFilter:"blur(22px)", WebkitBackdropFilter:"blur(22px)",
        background:"rgba(4,7,12,0.7)", borderBottom:`1px solid ${T.line}` }}>
        <div className="al-shell" style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:24, paddingTop:14, paddingBottom:14 }}>
          <a href="/"><Logo size="md"/></a>
          <div className="nav-links" style={{ display:"flex", alignItems:"center", gap:28 }}>
            {[["Platform","#platform"],["Intelligence","#intelligence"],["Outcomes","#outcomes"],["Security","/security"]].map(([l,h])=>(
              <a key={l} href={h} style={{ fontSize:13, color:T.muted, fontWeight:500, transition:"color 0.2s" }}
                onMouseEnter={e=>(e.currentTarget.style.color=T.text)}
                onMouseLeave={e=>(e.currentTarget.style.color=T.muted)}>{l}</a>
            ))}
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <a href="/login" className="al-btn al-btn-g">Sign in</a>
            <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-p">Book a demo</a>
          </div>
        </div>
      </nav>

    {/* HERO */}
<section
  style={{
    position: "relative",
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    paddingTop: 88,
    overflow: "hidden",
    background:
      "radial-gradient(ellipse at 68% 45%,rgba(0,194,232,.08) 0%,transparent 55%),radial-gradient(ellipse at 92% 12%,rgba(87,231,255,.05) 0%,transparent 28%),linear-gradient(180deg,#03050A 0%,#07101B 100%)",
  }}
>
  <Starfield density={1} />
  <div
    aria-hidden
    style={{
      position: "absolute",
      right: "-4%",
      top: "50%",
      transform: "translateY(-50%)",
      width: "52vw",
      maxWidth: 760,
      aspectRatio: "1",
      opacity: 0.05,
      pointerEvents: "none",
      zIndex: 1,
    }}
  >
    <img
      src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
      alt=""
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        filter: "blur(2px)",
      }}
    />
  </div>
  <div className="al-shell" style={{ position: "relative", zIndex: 2 }}>
    <div
      className="hero-grid"
      style={{ minHeight: "calc(100vh - 88px)", padding: "60px 0" }}
    >
      <div>
        <div
          className="al-f1"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 14px",
            borderRadius: 999,
            border: `1px solid ${T.lineCyan}`,
            background: "rgba(0,194,232,.08)",
            color: T.cyanLt,
            fontSize: 11,
            fontFamily: F.mono,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            marginBottom: 24,
          }}
        >
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: T.cyan,
              boxShadow: `0 0 10px ${T.cyan}`,
              display: "inline-block",
            }}
          />
          AI-powered governance for complex delivery
        </div>

        <h1 className="al-f2" style={{ marginBottom: 22 }}>
          <span
            style={{
              fontFamily: F.body,
              fontSize: "clamp(30px,4vw,54px)",
              lineHeight: 1.06,
              letterSpacing: "-0.03em",
              fontWeight: 300,
              display: "block",
              color: "rgba(245,248,252,0.82)",
            }}
          >
            See risks, approvals, and delivery pressure
          </span>
          <span
            style={{
              fontFamily: F.display,
              fontSize: "clamp(40px,5.5vw,78px)",
              lineHeight: 0.94,
              letterSpacing: "-0.055em",
              fontWeight: 700,
              display: "block",
              marginTop: 4,
            }}
          >
            before projects go <span className="tg">off track</span>
          </span>
        </h1>

        <p
          className="al-f3"
          style={{
            fontSize: 18,
            lineHeight: 1.8,
            color: T.muted,
            maxWidth: 620,
            marginBottom: 34,
          }}
        >
          Aliena brings approvals, RAID, finance, milestones, resources, and
          executive reporting into one AI-powered governance platform for PMOs,
          delivery leaders, and regulated organisations.
        </p>

        <div
          className="al-f4 hero-actions"
          style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 22 }}
        >
          <a
            href="mailto:support@aliena.co.uk"
            className="al-btn al-btn-p al-btn-lg"
          >
            Book a demo <ArrowRight size={16} />
          </a>
          <a href="#platform" className="al-btn al-btn-o al-btn-lg">
            See platform overview
          </a>
        </div>

        <div
          className="al-f5"
          style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 28 }}
        >
          {[
            "Live governance view",
            "AI risk signals",
            "Approval control",
            "Audit-ready workflows",
          ].map((p) => (
            <span key={p} className="chip">
              {p}
            </span>
          ))}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3,minmax(0,1fr))",
            gap: 12,
            maxWidth: 620,
          }}
        >
          {[
            { n: "17", l: "active projects" },
            { n: "4", l: "approvals escalated" },
            { n: "91%", l: "governance compliance" },
          ].map((m) => (
            <div
              key={m.l}
              style={{
                padding: "14px 16px",
                borderRadius: 18,
                background: "rgba(255,255,255,.035)",
                border: `1px solid ${T.lineS}`,
              }}
            >
              <div
                style={{
                  fontFamily: F.display,
                  fontWeight: 700,
                  fontSize: 26,
                  lineHeight: 1,
                  marginBottom: 6,
                  color: T.text,
                }}
              >
                {m.n}
              </div>
              <div style={{ color: T.muted, fontSize: 12, lineHeight: 1.4 }}>
                {m.l}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="hero-r" style={{ position: "relative", height: 620 }}>
        {[320, 440, 560].map((r, i) => (
          <div
            key={r}
            aria-hidden
            style={{
              position: "absolute",
              top: "50%",
              left: "50%",
              width: r,
              height: r,
              borderRadius: "50%",
              border: `1px solid rgba(0,194,232,${0.07 - i * 0.02})`,
              transform: "translate(-50%,-50%)",
              animation: `al-float ${8 + i * 2}s ${i * 1.5}s ease-in-out infinite`,
            }}
          />
        ))}

        <div
          className="hero-panel"
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%,-50%)",
            width: 470,
            zIndex: 2,
          }}
        >
          <div
            style={{
              padding: "13px 16px",
              borderBottom: `1px solid ${T.line}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              background: "rgba(255,255,255,.02)",
            }}
          >
            <div style={{ display: "flex", gap: 6 }}>
              {[0, 1, 2].map((d) => (
                <span
                  key={d}
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: "rgba(255,255,255,.25)",
                    display: "inline-block",
                  }}
                />
              ))}
            </div>
            <span
              style={{
                fontFamily: F.mono,
                fontSize: 10,
                color: T.muted2,
                letterSpacing: "0.08em",
              }}
            >
              ALIENA EXECUTIVE COCKPIT
            </span>
            <span
              style={{
                padding: "4px 10px",
                borderRadius: 999,
                border: `1px solid ${T.lineCyan}`,
                color: T.cyanLt,
                background: "rgba(0,194,232,.08)",
                fontFamily: F.mono,
                fontSize: 10,
              }}
            >
              LIVE
            </span>
          </div>

          <div style={{ padding: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(3,1fr)",
                gap: 10,
                marginBottom: 14,
              }}
            >
              {[
                { v: "17", l: "active projects", c: T.cyanLt },
                { v: "4", l: "approvals escalated", c: T.amber },
                { v: "1.2m", l: "variance flagged", c: T.green },
              ].map((m) => (
                <div
                  key={m.v + m.l}
                  style={{
                    padding: 13,
                    borderRadius: 16,
                    background: "rgba(255,255,255,.04)",
                    border: `1px solid ${T.line}`,
                  }}
                >
                  <div
                    style={{
                      fontFamily: F.display,
                      fontSize: 24,
                      fontWeight: 700,
                      lineHeight: 1,
                      marginBottom: 6,
                      color: m.c,
                    }}
                  >
                    {m.v}
                  </div>
                  <div style={{ fontSize: 11, color: T.muted, lineHeight: 1.4 }}>
                    {m.l}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gap: 10, marginBottom: 14 }}>
              {[
                ["Budget control", 86],
                ["Milestone health", 78],
                ["Approval compliance", 91],
                ["Resource readiness", 73],
              ].map(([l, v]) => (
                <div
                  key={l as string}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "118px 1fr 38px",
                    gap: 8,
                    alignItems: "center",
                  }}
                >
                  <span style={{ fontSize: 11, color: T.muted }}>{l}</span>
                  <div
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: "rgba(255,255,255,.08)",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: `${v}%`,
                        borderRadius: 999,
                        background: `linear-gradient(90deg,${T.cyan},${T.cyanLt})`,
                      }}
                    />
                  </div>
                  <span
                    style={{
                      fontSize: 11,
                      color: T.text,
                      textAlign: "right",
                      fontFamily: F.mono,
                    }}
                  >
                    {v}%
                  </span>
                </div>
              ))}
            </div>

            <div style={{ display: "grid", gap: 9 }}>
              {[
                {
                  t: "APPROVAL FLOW",
                  b: "Needs review",
                  tx: "One financial plan is 5 days outside target SLA.",
                },
                {
                  t: "BUDGET VARIANCE",
                  b: "Emerging",
                  tx: "Forecast overrun trend in Q3 unless scope is adjusted.",
                },
                {
                  t: "RESOURCE LOAD",
                  b: "Pressure",
                  tx: "Delivery leadership is over-allocated across two programmes.",
                },
              ].map((s) => (
                <div
                  key={s.t}
                  style={{
                    padding: "10px 12px",
                    borderRadius: 14,
                    background: "rgba(255,255,255,.03)",
                    border: `1px solid ${T.line}`,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 10,
                        color: T.cyanLt,
                        fontFamily: F.mono,
                        letterSpacing: "0.06em",
                      }}
                    >
                      {s.t}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        color: "#FDE68A",
                        background: "rgba(234,179,8,.1)",
                        border: "1px solid rgba(234,179,8,.2)",
                        padding: "2px 8px",
                        borderRadius: 999,
                      }}
                    >
                      {s.b}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: T.text, lineHeight: 1.55 }}>
                    {s.tx}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: 10,
            bottom: 34,
            width: 184,
            padding: 14,
            borderRadius: 18,
            background: "rgba(8,12,20,.9)",
            border: `1px solid ${T.lineS}`,
            backdropFilter: "blur(18px)",
          }}
        >
          <div
            style={{
              fontFamily: F.mono,
              fontSize: 10,
              color: T.purple,
              letterSpacing: "0.1em",
              marginBottom: 8,
            }}
          >
            AI INSIGHT
          </div>
          <div
            style={{
              fontFamily: F.display,
              fontSize: 15,
              fontWeight: 600,
              marginBottom: 8,
            }}
          >
            Governance pressure emerging
          </div>
          <div style={{ fontSize: 12, color: T.muted, lineHeight: 1.55 }}>
            2 approvals and 1 milestone now influence portfolio confidence.
          </div>
        </div>
      </div>
    </div>
  </div>
</section>
      {/* TRUST BAND */}
      <div style={{ borderTop:"1px solid rgba(255,255,255,.05)", borderBottom:"1px solid rgba(255,255,255,.05)", background:"rgba(255,255,255,.015)", padding:"16px 28px" }}>
        <div className="al-shell" style={{ display:"flex", flexWrap:"wrap", gap:10, justifyContent:"center" }}>
          {["Built in the UK","Row-level security","Governance-ready workflows","Audit-grade decision trails","AI-assisted oversight"].map(i=>(
            <span key={i} className="chip">{i}</span>
          ))}
        </div>
      </div>

      {/* PROBLEM */}
      <section style={{ padding:"104px 0", background:"linear-gradient(180deg,#07101B 0%,#04080F 100%)", position:"relative", overflow:"hidden" }}>
        <div className="al-shell">
          <div className="al-kicker">The problem</div>
          <h2 className="al-h2" style={{ maxWidth:860 }}>
            Most PMOs don&apos;t suffer from lack of effort.<br/>They suffer from <span className="tg">fragmented control.</span>
          </h2>
          <p className="al-sub" style={{ marginBottom:40 }}>Delivery teams work hard, but governance breaks when planning, decisions, risks, approvals and reporting live across too many disconnected places.</p>
          <div className="t-grid" style={{ marginBottom:24 }}>
            {[{title:"Fragmented control",desc:"Plans, RAID, approvals and reporting sit across spreadsheets, inboxes and disconnected tools."},{title:"Reactive governance",desc:"Leaders hear about delivery risk too late, after schedule, budget or confidence has already slipped."},{title:"Weak executive visibility",desc:"Decision-makers lack one reliable operating picture across projects, portfolios and approvals."}].map(p=>(
              <div key={p.title} className="al-card" style={{ padding:30 }}>
                <h3 style={{ fontFamily:F.display, fontSize:22, marginBottom:12, lineHeight:1.1, letterSpacing:"-0.03em" }}>{p.title}</h3>
                <p style={{ color:T.muted, fontSize:15, lineHeight:1.75 }}>{p.desc}</p>
              </div>
            ))}
          </div>
          <div style={{ padding:"30px 32px", borderRadius:24, border:"1px solid rgba(0,194,232,.14)", background:"linear-gradient(135deg,rgba(0,194,232,.08) 0%,rgba(255,255,255,.02) 100%)", display:"flex", justifyContent:"space-between", alignItems:"center", gap:20, flexWrap:"wrap" }}>
            <div style={{ maxWidth:760 }}>
              <div style={{ fontFamily:F.display, fontSize:28, fontWeight:700, letterSpacing:"-0.04em", marginBottom:8 }}>Aliena turns delivery operations into a governed intelligence system.</div>
              <div style={{ color:T.muted, fontSize:15, lineHeight:1.8 }}>One control layer for programme oversight, one source of truth for governance, and one AI brain to help leaders act before issues escalate.</div>
            </div>
            <a href="#platform" className="al-btn al-btn-p al-btn-lg">Explore the platform <ChevronRight size={16}/></a>
          </div>
        </div>
      </section>

      {/* PILLARS */}
      <section id="platform" style={{ position:"relative", padding:"108px 0", overflow:"hidden", background:"#020507" }}>
        <Starfield density={0.6}/>
        <div aria-hidden style={{ position:"absolute", inset:0, zIndex:0,
          backgroundImage:"repeating-linear-gradient(0deg,transparent,transparent 38px,rgba(0,194,232,.03) 38px,rgba(0,194,232,.03) 39px),repeating-linear-gradient(60deg,transparent,transparent 38px,rgba(0,194,232,.025) 38px,rgba(0,194,232,.025) 39px)",
          maskImage:"linear-gradient(to bottom right,rgba(0,0,0,.4) 0%,transparent 70%)",
          WebkitMaskImage:"linear-gradient(to bottom right,rgba(0,0,0,.4) 0%,transparent 70%)" }}/>
        <div className="al-shell" style={{ position:"relative", zIndex:1 }}>
          <div style={{ maxWidth:650, marginBottom:48 }}>
            <div className="al-kicker">Platform pillars</div>
            <h2 className="al-h2">Five pillars.<br/><span className="tg">One control layer.</span></h2>
            <p className="al-sub">Built to replace fragmented tools with a governed, AI-assisted delivery system.</p>
          </div>
          <div className="p-grid">
            {pillars.map(p=>(
              <div key={p.k} style={{ padding:"30px 28px", borderRadius:22, border:`1px solid ${T.line}`, background:"rgba(5,9,14,.82)", backdropFilter:"blur(12px)", WebkitBackdropFilter:"blur(12px)", position:"relative", overflow:"hidden", transition:"border-color .25s,transform .25s,box-shadow .25s" }}
                onMouseEnter={e=>{const el=e.currentTarget as HTMLDivElement;el.style.borderColor="rgba(0,194,232,.22)";el.style.transform="translateY(-3px)";el.style.boxShadow="0 24px 60px rgba(0,0,0,.28)"}}
                onMouseLeave={e=>{const el=e.currentTarget as HTMLDivElement;el.style.borderColor=T.line;el.style.transform="translateY(0)";el.style.boxShadow="none"}}>
                <div aria-hidden style={{ position:"absolute", top:0, left:0, right:0, height:1, background:"linear-gradient(90deg,transparent,rgba(87,231,255,.5),transparent)" }}/>
                <div style={{ fontFamily:F.mono, fontSize:11, color:T.cyanLt, marginBottom:14, letterSpacing:"0.1em" }}>{p.k}</div>
                <div style={{ marginBottom:16, color:T.cyan }}><p.Icon size={22}/></div>
                <div style={{ fontFamily:F.display, fontSize:24, letterSpacing:"-0.04em", marginBottom:10 }}>{p.title}</div>
                <div style={{ color:T.muted, fontSize:14, lineHeight:1.75, marginBottom:18 }}>{p.desc}</div>
                <div style={{ display:"grid", gap:8 }}>
                  {p.bullets.map(b=>(
                    <div key={b} style={{ display:"flex", alignItems:"flex-start", gap:9, fontSize:13 }}>
                      <span style={{ width:18, height:18, borderRadius:"50%", background:"rgba(34,197,94,.1)", border:"1px solid rgba(34,197,94,.2)", display:"flex", alignItems:"center", justifyContent:"center", color:T.green, fontSize:11, flexShrink:0, marginTop:1 }}>&#10003;</span>
                      {b}
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ padding:30, borderRadius:22, border:"1px solid rgba(0,194,232,.15)", background:"linear-gradient(135deg,rgba(0,194,232,.07) 0%,rgba(255,255,255,.02) 100%)", display:"flex", flexDirection:"column", justifyContent:"center", alignItems:"center", textAlign:"center", gap:14 }}>
              <Sparkles size={28} color={T.cyan}/>
              <div style={{ fontFamily:F.display, fontSize:23, fontWeight:700, letterSpacing:"-0.03em" }}>Ready to see it live?</div>
              <div style={{ color:T.muted, fontSize:14, lineHeight:1.7, maxWidth:230 }}>Book a leadership demo and see Aliena in your delivery context.</div>
              <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-p" style={{ marginTop:4 }}>Book demo <ArrowRight size={14}/></a>
            </div>
          </div>
        </div>
      </section>

      {/* GOVERNANCE INTELLIGENCE */}
      <section id="intelligence" style={{ position:"relative", padding:"110px 0", overflow:"hidden", background:"radial-gradient(circle at 20% 20%,rgba(0,194,232,.06) 0%,transparent 30%),linear-gradient(180deg,#020408 0%,#03060B 100%)" }}>
        <div aria-hidden style={{ position:"absolute", inset:0, backgroundImage:"linear-gradient(rgba(255,255,255,.02) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.02) 1px,transparent 1px)", backgroundSize:"72px 72px", maskImage:"linear-gradient(to bottom,rgba(0,0,0,.65),rgba(0,0,0,.08))", WebkitMaskImage:"linear-gradient(to bottom,rgba(0,0,0,.65),rgba(0,0,0,.08))", pointerEvents:"none" }}/>
        <div className="al-shell" style={{ position:"relative", zIndex:1 }}>
          <div className="ont-grid">
            <div style={{ borderRadius:28, border:`1px solid ${T.lineS}`, background:"linear-gradient(180deg,rgba(10,14,22,.96) 0%,rgba(6,9,15,.92) 100%)", boxShadow:"0 30px 80px rgba(0,0,0,.45)", padding:28, display:"flex", flexDirection:"column", justifyContent:"space-between", minHeight:620 }}>
              <div>
                <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"7px 12px", borderRadius:999, border:"1px solid rgba(168,85,247,.24)", background:"rgba(168,85,247,.08)", marginBottom:18 }}>
                  <Sparkles size={14} color={T.purple}/>
                  <span style={{ fontFamily:F.mono, fontSize:10, color:"#D8B4FE", letterSpacing:"0.12em", textTransform:"uppercase" }}>Governance Intelligence</span>
                </div>
                <h2 style={{ fontFamily:F.display, fontSize:"clamp(34px,4.5vw,56px)", lineHeight:0.98, letterSpacing:"-0.05em", fontWeight:700, marginBottom:16 }}>
                  One platform.<br/><span className="tg">Total governance.</span>
                </h2>
                <p style={{ color:T.muted, fontSize:16, lineHeight:1.8, marginBottom:26, maxWidth:360 }}>
                  Aliena connects approvals, RAID, finance, milestones, resources and AI governance into one live operating picture so leaders can see pressure before it becomes failure.
                </p>
                <div style={{ display:"grid", gap:12, marginBottom:24 }}>
                  {[{title:"Live governance graph",desc:"Every node contributes to one connected delivery model.",color:T.cyan},{title:"Health scoring",desc:"Critical pressure points are surfaced automatically.",color:T.green},{title:"AI synthesis",desc:"Signals converge into one intelligence layer for action.",color:T.purple},{title:"Change control",desc:"Every scope change is tracked, costed and approved before it moves.",color:T.amber}].map(item=>(
                    <div key={item.title} style={{ padding:"14px 14px 14px 16px", borderRadius:18, border:`1px solid ${T.line}`, background:"rgba(255,255,255,.03)" }}>
                      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:6 }}>
                        <div style={{ width:9, height:9, borderRadius:"50%", background:item.color, boxShadow:`0 0 14px ${item.color}`, flexShrink:0 }}/>
                        <div style={{ fontFamily:F.display, fontSize:15, fontWeight:600, color:T.text, letterSpacing:"-0.02em" }}>{item.title}</div>
                      </div>
                      <div style={{ color:T.muted, fontSize:13, lineHeight:1.65, paddingLeft:19 }}>{item.desc}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ borderTop:`1px solid ${T.line}`, paddingTop:18 }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:16 }}>
                  {[{v:"12",l:"nodes"},{v:"17",l:"connections"},{v:"84%",l:"health"}].map(m=>(
                    <div key={m.l} style={{ padding:"14px 10px", borderRadius:16, background:"rgba(255,255,255,.03)", border:`1px solid ${T.line}`, textAlign:"center" }}>
                      <div style={{ fontFamily:F.display, fontSize:22, fontWeight:700, lineHeight:1, color:T.text, marginBottom:6 }}>{m.v}</div>
                      <div style={{ fontSize:11, color:T.muted2, textTransform:"uppercase", letterSpacing:"0.08em", fontFamily:F.mono }}>{m.l}</div>
                    </div>
                  ))}
                </div>
                <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-p" style={{ width:"100%", justifyContent:"center" }}>
                  Explore governance intelligence <ArrowRight size={14}/>
                </a>
              </div>
            </div>
            <div style={{ position:"relative", borderRadius:30, border:`1px solid ${T.lineS}`, background:"linear-gradient(180deg,rgba(8,12,20,.96) 0%,rgba(5,8,14,.94) 100%)", boxShadow:"0 40px 100px rgba(0,0,0,.5)", overflow:"hidden", minHeight:620 }}>
              <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:16, padding:"18px 22px", borderBottom:`1px solid ${T.line}`, background:"rgba(255,255,255,.02)" }}>
                <div style={{ display:"flex", alignItems:"center", gap:12, minWidth:0 }}>
                  <div style={{ width:34, height:34, borderRadius:12, background:"linear-gradient(135deg,rgba(0,194,232,.18),rgba(168,85,247,.18))", border:`1px solid ${T.line}`, display:"flex", alignItems:"center", justifyContent:"center", color:T.cyan, flexShrink:0 }}>
                    <Cpu size={16}/>
                  </div>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontFamily:F.display, fontSize:16, fontWeight:600, color:T.text, letterSpacing:"-0.02em" }}>Governance command map</div>
                    <div style={{ fontFamily:F.mono, fontSize:10, color:T.muted2, letterSpacing:"0.08em", textTransform:"uppercase", marginTop:2 }}>Connected intelligence across the delivery estate</div>
                  </div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8, padding:"7px 10px", borderRadius:999, border:"1px solid rgba(34,197,94,.18)", background:"rgba(34,197,94,.08)", flexShrink:0 }}>
                  <div style={{ width:7, height:7, borderRadius:"50%", background:T.green, animation:"al-live 1.5s ease-in-out infinite" }}/>
                  <span style={{ fontFamily:F.mono, fontSize:10, color:"#86EFAC", letterSpacing:"0.08em", textTransform:"uppercase" }}>Live</span>
                </div>
              </div>
              <div style={{ padding:20, position:"relative" }}>
                <div style={{ display:"grid", gridTemplateColumns:"repeat(4,minmax(0,1fr))", gap:12, marginBottom:16 }}>
                  {[{label:"AI signals",value:"27",tone:T.purple},{label:"At-risk areas",value:"3",tone:T.amber},{label:"Governed flow",value:"84%",tone:T.cyan},{label:"Change requests",value:"6",tone:T.orange}].map(item=>(
                    <div key={item.label} style={{ padding:14, borderRadius:18, background:"rgba(255,255,255,.03)", border:`1px solid ${T.line}` }}>
                      <div style={{ fontFamily:F.mono, fontSize:10, color:T.muted2, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:8 }}>{item.label}</div>
                      <div style={{ fontFamily:F.display, fontSize:28, lineHeight:1, fontWeight:700, color:item.tone, letterSpacing:"-0.04em" }}>{item.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ borderRadius:24, border:`1px solid ${T.line}`, background:`radial-gradient(circle at 50% 20%,rgba(0,194,232,.05) 0%,transparent 30%),rgba(4,8,14,.8)`, padding:16, minHeight:500 }}>
                  <GovernanceGraph/>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OUTCOMES */}
      <section id="outcomes" style={{ padding:"104px 0", background:"linear-gradient(180deg,#04060C 0%,#050810 100%)", position:"relative", overflow:"hidden" }}>
        <div aria-hidden style={{ position:"absolute", top:"50%", left:"50%", transform:"translate(-50%,-50%)", width:800, height:400, background:`radial-gradient(ellipse,rgba(0,194,232,.05) 0%,transparent 70%)`, pointerEvents:"none" }}/>
        <div className="al-shell" style={{ position:"relative", zIndex:1 }}>
          <div className="al-kicker">Outcomes</div>
          <h2 className="al-h2">Better decisions.<br/><span className="tg">Earlier intervention.</span></h2>
          <p className="al-sub" style={{ marginBottom:40 }}>The goal is not more dashboards. The goal is better control, earlier intervention and more confident delivery.</p>
          <div className="f-grid">
            {outcomes.map(o=>(
              <div key={o.label} className="al-card" style={{ padding:"28px 22px", textAlign:"center" }}>
                <div className="tg" style={{ fontFamily:F.display, fontSize:42, fontWeight:800, lineHeight:1, marginBottom:10 }}>{o.value}</div>
                <div style={{ color:T.text, fontSize:15, fontWeight:600, marginBottom:8 }}>{o.label}</div>
                <div style={{ color:T.muted, fontSize:13, lineHeight:1.65 }}>{o.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* COMPARISON */}
      <section style={{ padding:"104px 0", background:"#020507", position:"relative", overflow:"hidden" }}>
        <Starfield density={0.3}/>
        <div className="al-shell" style={{ position:"relative", zIndex:1 }}>
          <div className="al-kicker">Why Aliena wins</div>
          <h2 className="al-h2">Traditional tools record.<br/><span className="tg">Aliena interprets.</span></h2>
          <p className="al-sub" style={{ marginBottom:40 }}>From system of record to system of intelligence. That is the category shift.</p>
          <div className="two-grid">
            <div style={{ padding:"28px 26px", borderRadius:22, border:"1px solid rgba(255,255,255,.08)", background:"rgba(255,255,255,.02)" }}>
              <div style={{ fontFamily:F.mono, fontSize:10, color:T.muted2, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:20 }}>Traditional PM tools</div>
              <div style={{ display:"grid", gap:14 }}>
                {["Static reports assembled after the fact","Disconnected approvals and governance evidence","RAID logs that depend on manual interpretation","Executive visibility arrives too late","No early warning before issues escalate"].map(t=>(
                  <div key={t} style={{ display:"flex", alignItems:"flex-start", gap:10, fontSize:14, color:T.muted, lineHeight:1.6 }}>
                    <span style={{ width:18, height:18, borderRadius:"50%", background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.2)", display:"flex", alignItems:"center", justifyContent:"center", color:T.red, fontSize:12, flexShrink:0, marginTop:1 }}>&#x2715;</span>{t}
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding:"28px 26px", borderRadius:22, border:"1px solid rgba(0,194,232,.18)", background:"linear-gradient(135deg,rgba(0,194,232,.06) 0%,rgba(255,255,255,.02) 100%)" }}>
              <div style={{ fontFamily:F.mono, fontSize:10, color:T.cyanLt, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:20 }}>Aliena AI</div>
              <div style={{ display:"grid", gap:14 }}>
                {["Live delivery intelligence with AI-assisted summaries","Traceable approval flows and defendable decisions","Risk, financial and schedule signals surfaced early","One control layer for leaders, PMOs and delivery teams","Change control tracked and costed before it moves"].map(t=>(
                  <div key={t} style={{ display:"flex", alignItems:"flex-start", gap:10, fontSize:14, lineHeight:1.6 }}>
                    <CheckCircle2 size={16} color={T.green} style={{ flexShrink:0, marginTop:2 }}/>{t}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHO IT SERVES */}
      <section style={{ padding:"104px 0", background:"linear-gradient(180deg,#04060C 0%,#050810 100%)" }}>
        <div className="al-shell">
          <div className="al-kicker">Who it serves</div>
          <h2 className="al-h2">Built for organisations where<br/><span className="tg">governance and delivery</span> both matter.</h2>
          <p className="al-sub" style={{ marginBottom:40 }}>Aliena is strongest where complexity, accountability and executive visibility are all non-negotiable.</p>
          <div className="t-grid">
            {audiences.map(a=>(
              <div key={a.title} className="al-card" style={{ padding:30 }}>
                <div style={{ width:44, height:44, borderRadius:14, background:"rgba(0,194,232,.08)", border:"1px solid rgba(0,194,232,.14)", display:"flex", alignItems:"center", justifyContent:"center", color:T.cyan, marginBottom:18 }}>
                  <a.Icon size={20}/>
                </div>
                <h3 style={{ fontFamily:F.display, fontSize:20, letterSpacing:"-0.03em", marginBottom:12 }}>{a.title}</h3>
                <p style={{ color:T.muted, fontSize:15, lineHeight:1.75 }}>{a.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SECURITY STRIP */}
      <section style={{ padding:"72px 0", background:"#020407", position:"relative", overflow:"hidden" }}>
        <div aria-hidden style={{ position:"absolute", top:0, left:0, right:0, height:1, background:`linear-gradient(90deg,transparent,${T.lineCyan},transparent)` }}/>
        <div className="al-shell">
          <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:40, flexWrap:"wrap" }}>
            <div style={{ maxWidth:560 }}>
              <div className="al-kicker">Security &amp; readiness</div>
              <h2 style={{ fontFamily:F.display, fontSize:"clamp(26px,3.5vw,40px)", fontWeight:700, letterSpacing:"-0.04em", lineHeight:1.05, marginBottom:14 }}>
                Enterprise confidence is <span className="tg">part of the product.</span>
              </h2>
              <p style={{ color:T.muted, fontSize:15, lineHeight:1.8 }}>Row-level security, governed approval workflows, audit-grade decision trails and UK-built infrastructure. Security is not an afterthought.</p>
            </div>
            <div style={{ display:"grid", gap:12, minWidth:280 }}>
              {[{Icon:Lock,label:"Row-level security enforced at database level"},{Icon:Shield,label:"Governed approval workflows with full traceability"},{Icon:CheckCircle2,label:"UK GDPR compliant, ISO 27001 in progress"}].map(item=>(
                <div key={item.label} style={{ display:"flex", alignItems:"center", gap:12, padding:"14px 16px", borderRadius:16, border:"1px solid rgba(255,255,255,.07)", background:"rgba(255,255,255,.03)" }}>
                  <item.Icon size={16} color={T.cyan} style={{ flexShrink:0 }}/>
                  <span style={{ fontSize:14, color:T.muted, lineHeight:1.5 }}>{item.label}</span>
                </div>
              ))}
              <a href="/security" style={{ display:"inline-flex", alignItems:"center", gap:8, marginTop:4, fontSize:14, fontWeight:600, color:T.cyanLt, fontFamily:F.body, transition:"opacity 0.2s" }}
                onMouseEnter={e=>(e.currentTarget.style.opacity="0.7")}
                onMouseLeave={e=>(e.currentTarget.style.opacity="1")}>
                View full security details <ArrowRight size={14}/>
              </a>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section style={{ padding:"110px 0", background:"#04060C" }}>
        <div className="al-shell">
          <div style={{ borderRadius:30, border:"1px solid rgba(0,194,232,.15)", background:"radial-gradient(ellipse at top center,rgba(0,194,232,.09) 0%,transparent 50%),rgba(255,255,255,.025)", padding:"64px 32px", textAlign:"center", boxShadow:"0 0 80px rgba(0,194,232,.05)" }}>
            <div style={{ display:"inline-flex", alignItems:"center", gap:8, padding:"7px 14px", borderRadius:999, border:`1px solid ${T.lineCyan}`, background:"rgba(0,194,232,.08)", color:T.cyanLt, fontSize:11, fontFamily:F.mono, letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:24 }}>
              <Sparkles size={13} color={T.cyan}/> Get started today
            </div>
            <h2 style={{ fontFamily:F.display, fontSize:"clamp(36px,5vw,62px)", lineHeight:1.0, letterSpacing:"-0.045em", fontWeight:700, maxWidth:860, margin:"0 auto 18px" }}>
              Bring governance, visibility and <span className="tg">AI decision intelligence</span> into one platform.
            </h2>
            <p style={{ maxWidth:560, margin:"0 auto 32px", color:T.muted, fontSize:17, lineHeight:1.8 }}>
              Book a leadership demo and see how Aliena turns fragmented delivery into a governed, AI-powered system.
            </p>
            <div style={{ display:"flex", justifyContent:"center", gap:12, flexWrap:"wrap" }}>
              <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-p al-btn-lg">Book a demo <ArrowRight size={16}/></a>
              <a href="mailto:support@aliena.co.uk" className="al-btn al-btn-g al-btn-lg">Contact sales</a>
            </div>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer style={{ borderTop:"1px solid rgba(255,255,255,.06)", background:"#02040A", padding:"44px 0 52px" }}>
        <div className="al-shell">
          <div style={{ display:"grid", gridTemplateColumns:"1fr auto auto", gap:48, alignItems:"start", marginBottom:36 }}>
            <div>
              <a href="/"><Logo size="sm"/></a>
              <p style={{ marginTop:14, fontSize:13, color:T.muted2, lineHeight:1.75, maxWidth:280 }}>
                AI governance platform for programme delivery. Built in the UK.
              </p>
              <div style={{ marginTop:14 }}>
                <a href="mailto:support@aliena.co.uk" style={{ fontSize:12, color:T.muted, transition:"color 0.2s" }}
                  onMouseEnter={e=>(e.currentTarget.style.color=T.text)}
                  onMouseLeave={e=>(e.currentTarget.style.color=T.muted)}>support@aliena.co.uk</a>
              </div>
            </div>
            <div>
              <div style={{ fontFamily:F.mono, fontSize:9, color:T.muted2, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>Product</div>
              <div style={{ display:"grid", gap:10 }}>
                {[["Platform","#platform"],["Intelligence","#intelligence"],["Outcomes","#outcomes"],["Sign in","/login"]].map(([l,h])=>(
                  <a key={l} href={h} style={{ fontSize:13, color:T.muted, transition:"color 0.2s" }}
                    onMouseEnter={e=>(e.currentTarget.style.color=T.text)}
                    onMouseLeave={e=>(e.currentTarget.style.color=T.muted)}>{l}</a>
                ))}
              </div>
            </div>
            <div>
              <div style={{ fontFamily:F.mono, fontSize:9, color:T.muted2, letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:14 }}>Legal</div>
              <div style={{ display:"grid", gap:10 }}>
                {[["Security","/security"],["Privacy","/privacy"],["security.txt","/.well-known/security.txt"],["Contact","mailto:support@aliena.co.uk"]].map(([l,h])=>(
                  <a key={l} href={h} style={{ fontSize:13, color:T.muted, transition:"color 0.2s" }}
                    onMouseEnter={e=>(e.currentTarget.style.color=T.text)}
                    onMouseLeave={e=>(e.currentTarget.style.color=T.muted)}>{l}</a>
                ))}
              </div>
            </div>
          </div>
          <div style={{ borderTop:"1px solid rgba(255,255,255,.05)", paddingTop:24, display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:12 }}>
            <span style={{ fontSize:12, color:T.muted2, fontFamily:F.mono }}>&#169; 2026 Aliena AI. Built in the UK.</span>
            <div style={{ display:"flex", gap:20 }}>
              <a href="/security" style={{ fontSize:12, color:T.muted2, transition:"color 0.2s" }} onMouseEnter={e=>(e.currentTarget.style.color=T.muted)} onMouseLeave={e=>(e.currentTarget.style.color=T.muted2)}>Security</a>
              <a href="/privacy"  style={{ fontSize:12, color:T.muted2, transition:"color 0.2s" }} onMouseEnter={e=>(e.currentTarget.style.color=T.muted)} onMouseLeave={e=>(e.currentTarget.style.color=T.muted2)}>Privacy</a>
            </div>
          </div>
        </div>
      </footer>
    </>
  );
}