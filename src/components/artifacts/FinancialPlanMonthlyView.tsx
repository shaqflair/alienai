import { useState, useMemo, useCallback } from "react";

/* ─── Fonts ──────────────────────────────────────────────────────────────── */
const FONT_LINK = document.createElement("link");
FONT_LINK.rel = "stylesheet";
FONT_LINK.href = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600;700&display=swap";
document.head.appendChild(FONT_LINK);

/* ─── Tokens ─────────────────────────────────────────────────────────────── */
const T = {
  bg:       "#F7F7F5",
  surface:  "#FFFFFF",
  border:   "#E3E3DF",
  borderMd: "#C8C8C4",
  text:     "#0D0D0B",
  textMd:   "#4A4A46",
  textSm:   "#8A8A84",
  navy:     "#1B3652",
  navyLt:   "#EBF0F5",
  red:      "#B83A2E",
  redLt:    "#FDF2F1",
  green:    "#2A6E47",
  greenLt:  "#F0F7F3",
  amber:    "#8A5B1A",
  amberLt:  "#FDF6EC",
  violet:   "#4A3A7A",
  violetLt: "#F4F2FB",
  mono:     "'DM Mono', monospace",
  sans:     "'DM Sans', sans-serif",
};

/* ─── Demo data ──────────────────────────────────────────────────────────── */
const LINES = [
  { id:"l1", description:"Engineering Team",     category:"people" },
  { id:"l2", description:"Design & UX",          category:"people" },
  { id:"l3", description:"AWS Infrastructure",   category:"infrastructure" },
  { id:"l4", description:"SaaS Licences",        category:"tools_licences" },
  { id:"l5", description:"External Consultancy", category:"external_vendors" },
];

const MONTHS = [
  "2025-04","2025-05","2025-06",
  "2025-07","2025-08","2025-09",
  "2025-10","2025-11","2025-12",
  "2026-01","2026-02","2026-03",
];

const QUARTERS = [
  { label:"Q1 FY25/26", months:["2025-04","2025-05","2025-06"] },
  { label:"Q2 FY25/26", months:["2025-07","2025-08","2025-09"] },
  { label:"Q3 FY25/26", months:["2025-10","2025-11","2025-12"] },
  { label:"Q4 FY25/26", months:["2026-01","2026-02","2026-03"] },
];

const SEED = {
  l1:{"2025-04":[28000,26800,29000],"2025-05":[28000,29500,28500],"2025-06":[28000,0,28000],"2025-07":[30000,0,31000],"2025-08":[30000,0,30000],"2025-09":[30000,0,32500],"2025-10":[30000,0,30000],"2025-11":[30000,0,30000],"2025-12":[30000,0,28000],"2026-01":[32000,0,32000],"2026-02":[32000,0,32000],"2026-03":[32000,0,32000]},
  l2:{"2025-04":[12000,11500,12000],"2025-05":[12000,11800,12000],"2025-06":[12000,0,12000],"2025-07":[12000,0,13000],"2025-08":[12000,0,12000],"2025-09":[12000,0,12000],"2025-10":[14000,0,14000],"2025-11":[14000,0,14000],"2025-12":[14000,0,14000],"2026-01":[14000,0,14000],"2026-02":[14000,0,14000],"2026-03":[14000,0,14000]},
  l3:{"2025-04":[4200,4100,4200],"2025-05":[4200,4800,5000],"2025-06":[4200,0,4200],"2025-07":[4500,0,4500],"2025-08":[4500,0,4800],"2025-09":[4500,0,6200],"2025-10":[5000,0,5000],"2025-11":[5000,0,5000],"2025-12":[5000,0,5200],"2026-01":[5500,0,5500],"2026-02":[5500,0,5500],"2026-03":[5500,0,5500]},
  l4:{"2025-04":[1800,1800,1800],"2025-05":[1800,1800,1800],"2025-06":[1800,0,1800],"2025-07":[1800,0,1800],"2025-08":[1800,0,1800],"2025-09":[1800,0,2200],"2025-10":[2000,0,2000],"2025-11":[2000,0,2000],"2025-12":[2000,0,2000],"2026-01":[2000,0,2000],"2026-02":[2000,0,2000],"2026-03":[2000,0,2000]},
  l5:{"2025-04":[0,0,0],"2025-05":[0,0,0],"2025-06":[0,0,0],"2025-07":[0,0,0],"2025-08":[0,0,0],"2025-09":[0,0,0],"2025-10":[14000,0,14000],"2025-11":[14000,0,14000],"2025-12":[14000,0,14000],"2026-01":[0,0,0],"2026-02":[0,0,0],"2026-03":[0,0,0]},
};

const SIGNALS = [
  { scope:"quarter", scopeKey:"Q2 FY25/26", severity:"warning",  message:"Forecast tracking 6% over budget" },
  { scope:"month",   scopeKey:"2025-05",    severity:"critical", message:"Infrastructure overspend" },
  { scope:"month",   scopeKey:"2025-09",    severity:"warning",  message:"AWS cost spike" },
];

const MS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CAT_LABELS = { people:"People",infrastructure:"Infra",tools_licences:"Tools",external_vendors:"Vendors",travel:"Travel",contingency:"Contingency",other:"Other" };

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const CUR_MK = (() => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; })();
const isPast = mk => mk < CUR_MK;
const isCur  = mk => mk === CUR_MK;

function fmtK(n) {
  if (n==null||n===""||isNaN(Number(n))||Number(n)===0) return "—";
  const v = Number(n);
  if (Math.abs(v)>=1_000_000) return `£${(Math.abs(v)/1_000_000).toFixed(2)}M`;
  if (Math.abs(v)>=1000)      return `£${(Math.abs(v)/1000).toFixed(1)}k`;
  return `£${Math.abs(v)}`;
}
function fmtFull(n) {
  if (!n) return "—";
  return `£${Math.abs(Number(n)).toLocaleString("en-GB")}`;
}
function pctStr(a,b) {
  if (!b) return null;
  return ((a-b)/b*100).toFixed(1);
}

function buildMT() {
  const r={};
  for (const mk of MONTHS) {
    let b=0,a=0,f=0;
    for (const lid of Object.keys(SEED)) {
      const d=SEED[lid]?.[mk]||[0,0,0];
      b+=d[0]; a+=d[1]; f+=d[2];
    }
    r[mk]={b,a,f};
  }
  return r;
}
const MT = buildMT();

/* ─── Design primitives ───────────────────────────────────────────────────── */
function Label({children}) {
  return (
    <span style={{fontFamily:T.mono,fontSize:8,letterSpacing:"0.12em",color:T.textSm,textTransform:"uppercase",fontWeight:500}}>
      {children}
    </span>
  );
}

function StatusDot({severity}) {
  const c = severity==="critical" ? T.red : severity==="warning" ? T.amber : T.green;
  return <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:c,flexShrink:0}}/>;
}

function Pill({color, children}) {
  const p = {
    red:   {bg:T.redLt,   text:T.red,   border:"#F0B0AA"},
    amber: {bg:T.amberLt, text:T.amber, border:"#E0C080"},
    green: {bg:T.greenLt, text:T.green, border:"#A0D0B8"},
    gray:  {bg:"#F4F4F2", text:T.textMd,border:T.border},
  }[color]||{bg:"#F4F4F2",text:T.textMd,border:T.border};
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",
      background:p.bg,color:p.text,border:`1px solid ${p.border}`,
      fontFamily:T.mono,fontSize:9,fontWeight:500,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
      {children}
    </span>
  );
}

function ModeBtn({label, active, onClick}) {
  const [h,setH] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{padding:"4px 12px",fontFamily:T.mono,fontSize:9,letterSpacing:"0.08em",
        textTransform:"uppercase",background:active?T.navy:h?"#E8EDF2":T.bg,
        color:active?"#FFF":h?T.navy:T.textMd,border:`1px solid ${active?T.navy:T.border}`,
        cursor:"pointer",transition:"all 0.1s"}}>
      {label}
    </button>
  );
}

function ConfigBtn({active, onClick}) {
  const [h,setH] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{padding:"4px 12px",fontFamily:T.mono,fontSize:9,letterSpacing:"0.08em",
        textTransform:"uppercase",display:"flex",alignItems:"center",gap:5,
        background:active?"#E8EDF2":h?"#E8EDF2":T.bg,
        color:active?T.navy:T.textMd,
        border:`1px solid ${active?T.borderMd:T.border}`,
        cursor:"pointer",transition:"all 0.1s"}}>
      ⚙ Configure
    </button>
  );
}

/* ─── Quarter header row ──────────────────────────────────────────────────── */
function QuarterHeaderRow({ q, collapsed, onToggle }) {
  const totB = q.months.reduce((s,mk)=>s+(MT[mk]?.b||0),0);
  const totA = q.months.reduce((s,mk)=>s+(MT[mk]?.a||0),0);
  const totF = q.months.reduce((s,mk)=>s+(MT[mk]?.f||0),0);
  const over = totB && totF > totB;
  const util = totB ? Math.round((totF/totB)*100) : null;
  const variance = totB ? totF - totB : null;
  const sig = SIGNALS.find(s => s.scopeKey === q.label);
  const bg = sig?.severity==="critical" ? T.redLt : sig?.severity==="warning" ? T.amberLt : "#EEEEEB";
  const [h, setH] = useState(false);

  return (
    <tr onClick={onToggle}
      onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{cursor:"pointer",background:h?"#E8E8E4":bg,borderBottom:`1px solid ${T.borderMd}`,transition:"background 0.1s"}}>
      <td style={{position:"sticky",left:0,zIndex:10,padding:"8px 10px",minWidth:200,
        borderRight:`1px solid ${T.borderMd}`,background:h?"#E8E8E4":bg}}>
        <div style={{display:"flex",alignItems:"center",gap:7}}>
          <span style={{fontFamily:T.mono,fontSize:11,display:"inline-block",
            transform:collapsed?"rotate(0deg)":"rotate(90deg)",transition:"transform 0.15s",color:T.textMd}}>
            ▶
          </span>
          <span style={{fontFamily:T.mono,fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:T.text}}>
            {q.label}
          </span>
          {sig && <StatusDot severity={sig.severity}/>}
        </div>
      </td>
      <td colSpan={q.months.length*3} style={{padding:"8px 14px"}}>
        <div style={{display:"flex",alignItems:"center",gap:18,flexWrap:"wrap"}}>
          <span style={{fontFamily:T.mono,fontSize:10,color:T.textSm}}>
            Budget <span style={{color:T.navy,fontWeight:600}}>{fmtK(totB)}</span>
          </span>
          <span style={{fontFamily:T.mono,fontSize:10,color:T.textSm}}>
            Actual <span style={{color:T.violet}}>{fmtK(totA)||"—"}</span>
          </span>
          <span style={{fontFamily:T.mono,fontSize:10,color:T.textSm}}>
            Forecast <span style={{color:over?T.red:T.green,fontWeight:600}}>{fmtK(totF)}</span>
          </span>
          {variance!==null && (
            <span style={{fontFamily:T.mono,fontSize:10,fontWeight:600,color:over?T.red:T.green}}>
              {over?"▲":"▼"} {fmtK(Math.abs(variance))}
              {totB>0&&<span style={{fontWeight:400,color:T.textSm}}> ({over?"+":""}{pctStr(totF,totB)}%)</span>}
            </span>
          )}
          {util!==null && (
            <span style={{marginLeft:"auto",fontFamily:T.mono,fontSize:10,
              color:util>100?T.red:util>85?T.amber:T.textSm}}>
              Util: <span style={{fontWeight:600,color:util>100?T.red:util>85?T.amber:T.textMd}}>{util}%</span>
            </span>
          )}
        </div>
      </td>
      <td style={{position:"sticky",right:0,zIndex:10,background:h?"#E8E8E4":bg,
        borderLeft:`1px solid ${T.borderMd}`,minWidth:80}}/>
    </tr>
  );
}

/* ─── Main ────────────────────────────────────────────────────────────────── */
export default function FinancialPlanMonthlyViewPalantir() {
  const [collapsed, setCollapsed] = useState(new Set(["Q3 FY25/26","Q4 FY25/26"]));
  const [viewMode, setViewMode]   = useState("monthly");
  const [showConfig, setShowConfig] = useState(false);
  const [fyYear, setFyYear]       = useState(2025);

  const toggleQ = useCallback(label => {
    setCollapsed(prev => { const n=new Set(prev); n.has(label)?n.delete(label):n.add(label); return n; });
  }, []);

  const fcastMv = useMemo(() => {
    const r={};
    for (let i=0; i<MONTHS.length; i++) {
      if(i===0){r[MONTHS[i]]=null;continue;}
      r[MONTHS[i]]=(MT[MONTHS[i]]?.f||0)-(MT[MONTHS[i-1]]?.f||0);
    }
    return r;
  }, []);

  const grandTotal = MONTHS.reduce((s,mk)=>s+(MT[mk]?.f||0),0);
  const critCount = SIGNALS.filter(s=>s.severity==="critical").length;
  const warnCount = SIGNALS.filter(s=>s.severity==="warning").length;

  return (
    <div style={{minHeight:"100vh",background:T.bg,fontFamily:T.sans,padding:0}}>

      {/* Top bar */}
      <div style={{background:T.navy,padding:"10px 24px",display:"flex",alignItems:"center",gap:16,borderBottom:`2px solid #0D2540`}}>
        <div>
          <div style={{fontFamily:T.mono,fontSize:8,color:"#7A9EC0",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:2}}>
            AlienAI · Financial Plan
          </div>
          <div style={{fontFamily:T.mono,fontSize:13,fontWeight:500,color:"#FFFFFF",letterSpacing:"0.02em"}}>
            Monthly Phasing — FY {fyYear}/{String(fyYear+1).slice(2)}
          </div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:10,alignItems:"center"}}>
          <div style={{padding:"3px 12px",border:`1px solid #3A6080`,background:"rgba(255,255,255,0.06)",
            fontFamily:T.mono,fontSize:9,color:"#90B8CC",letterSpacing:"0.06em"}}>
            GBP · 12 months · {LINES.length} cost lines
          </div>
          <div style={{fontFamily:T.mono,fontSize:9,color:"#607080"}}>
            Grand Forecast: <span style={{color:"#8EC9A8",fontWeight:600}}>{fmtFull(grandTotal)}</span>
          </div>
        </div>
      </div>

      <div style={{padding:"20px 24px",maxWidth:1600,margin:"0 auto",display:"flex",flexDirection:"column",gap:16}}>

        {/* ── Toolbar ── */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
          {/* Signal badges */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            {critCount>0 && (
              <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",
                background:T.redLt,border:`1px solid #F0B0AA`,
                fontFamily:T.mono,fontSize:9,color:T.red,letterSpacing:"0.06em"}}>
                <StatusDot severity="critical"/> {critCount} CRITICAL
              </div>
            )}
            {warnCount>0 && (
              <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",
                background:T.amberLt,border:`1px solid #E0C080`,
                fontFamily:T.mono,fontSize:9,color:T.amber,letterSpacing:"0.06em"}}>
                <StatusDot severity="warning"/> {warnCount} WARNING
              </div>
            )}
            {critCount===0&&warnCount===0&&(
              <div style={{display:"flex",alignItems:"center",gap:5,padding:"4px 10px",
                background:T.greenLt,border:`1px solid #A0D0B8`,
                fontFamily:T.mono,fontSize:9,color:T.green,letterSpacing:"0.06em"}}>
                <StatusDot severity="ok"/> ON TRACK
              </div>
            )}
          </div>

          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <ConfigBtn active={showConfig} onClick={()=>setShowConfig(v=>!v)}/>
            <div style={{display:"flex",gap:0}}>
              <ModeBtn label="Monthly"   active={viewMode==="monthly"}   onClick={()=>setViewMode("monthly")}/>
              <ModeBtn label="Quarterly" active={viewMode==="quarterly"} onClick={()=>setViewMode("quarterly")}/>
            </div>
          </div>
        </div>

        {/* ── Config panel ── */}
        {showConfig && (
          <div style={{border:`1px solid ${T.border}`,background:T.surface,padding:"14px 18px",
            display:"flex",flexWrap:"wrap",gap:20,alignItems:"flex-end"}}>
            {[
              { label:"FY Start Month", ctrl:
                <select value={4} onChange={()=>{}}
                  style={{border:`1px solid ${T.border}`,background:T.bg,fontFamily:T.mono,fontSize:10,
                    color:T.text,padding:"5px 8px",borderRadius:0,outline:"none"}}>
                  {[{v:1,l:"Jan — Calendar"},{v:4,l:"Apr — UK/NHS"},{v:7,l:"Jul"},{v:10,l:"Oct"}]
                    .map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              },
              { label:"FY Start Year", ctrl:
                <input type="number" value={fyYear} onChange={e=>setFyYear(Number(e.target.value))} min={2020} max={2040}
                  style={{border:`1px solid ${T.border}`,background:T.bg,fontFamily:T.mono,fontSize:10,
                    color:T.text,padding:"5px 8px",width:80,borderRadius:0,outline:"none"}}/>
              },
              { label:"Duration", ctrl:
                <select value={12} onChange={()=>{}}
                  style={{border:`1px solid ${T.border}`,background:T.bg,fontFamily:T.mono,fontSize:10,
                    color:T.text,padding:"5px 8px",borderRadius:0,outline:"none"}}>
                  {[{v:12,l:"12 months"},{v:18,l:"18 months"},{v:24,l:"24 months"}]
                    .map(o=><option key={o.v} value={o.v}>{o.l}</option>)}
                </select>
              },
            ].map(({label,ctrl})=>(
              <div key={label}>
                <div style={{marginBottom:5}}><Label>{label}</Label></div>
                {ctrl}
              </div>
            ))}
          </div>
        )}

        {/* ── Legend ── */}
        <div style={{display:"flex",flexWrap:"wrap",gap:14,alignItems:"center"}}>
          {[
            {bg:"#EEF4F9",bc:"#A0BAD0",l:"Budget"},
            {bg:T.violetLt,bc:"#C0B0E0",l:"Actual (locked)"},
            {bg:"#EBF5F0",bc:"#A0D0B8",l:"Forecast"},
            {bg:T.redLt,bc:"#F0B0AA",l:"Over budget"},
          ].map(({bg,bc,l})=>(
            <span key={l} style={{display:"flex",alignItems:"center",gap:5,
              fontFamily:T.mono,fontSize:9,color:T.textSm,letterSpacing:"0.06em"}}>
              <span style={{width:10,height:10,background:bg,border:`1px solid ${bc}`}}/>
              {l.toUpperCase()}
            </span>
          ))}
          <span style={{display:"flex",alignItems:"center",gap:5,fontFamily:T.mono,fontSize:9,color:T.textSm,letterSpacing:"0.06em"}}>
            <span style={{width:6,height:6,borderRadius:"50%",background:T.navy,boxShadow:`0 0 0 2px ${T.navyLt}`}}/>
            CURRENT MONTH
          </span>
        </div>

        {/* ── Table ── */}
        <div style={{border:`1px solid ${T.borderMd}`,overflow:"hidden",maxHeight:"65vh",overflowY:"auto",overflowX:"auto"}}>
          <table style={{borderCollapse:"collapse",
            minWidth: viewMode==="monthly" ? `${200+MONTHS.length*162+90}px` : "700px",
            background:T.surface}}>

            {/* THEAD */}
            <thead style={{position:"sticky",top:0,zIndex:20}}>

              {/* Quarter row */}
              <tr style={{background:"#EFEFEC"}}>
                <th style={{position:"sticky",left:0,zIndex:30,background:"#EFEFEC",
                  minWidth:200,padding:"7px 10px",textAlign:"left",
                  borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`,
                  fontFamily:T.mono,fontSize:8,color:T.textSm,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:500}}>
                  Cost Line
                </th>
                {viewMode==="monthly"
                  ? QUARTERS.map(q=>(
                      <th key={q.label} colSpan={q.months.length*3}
                        style={{padding:"7px 10px",textAlign:"center",fontFamily:T.mono,fontSize:9,fontWeight:500,
                          color:T.text,letterSpacing:"0.08em",textTransform:"uppercase",
                          borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.border}`,background:"#F2F2EF"}}>
                        {q.label}
                      </th>
                    ))
                  : QUARTERS.map(q=>(
                      <th key={q.label} colSpan={5}
                        style={{padding:"7px 10px",textAlign:"center",fontFamily:T.mono,fontSize:9,fontWeight:500,
                          color:T.text,letterSpacing:"0.08em",textTransform:"uppercase",
                          borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.border}`,background:"#F2F2EF"}}>
                        {q.label}
                      </th>
                    ))
                }
                <th style={{position:"sticky",right:0,zIndex:30,background:"#EFEFEC",
                  minWidth:80,padding:"7px 10px",textAlign:"right",
                  borderLeft:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`,
                  fontFamily:T.mono,fontSize:8,color:T.textSm,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:500}}>
                  Total
                </th>
              </tr>

              {/* Month sub-headers */}
              {viewMode==="monthly" && (
                <tr style={{background:"#F7F7F5"}}>
                  <th style={{position:"sticky",left:0,zIndex:30,background:"#F7F7F5",
                    padding:"4px 10px",borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.border}`}}/>
                  {MONTHS.map(mk=>{
                    const m=Number(mk.split("-")[1]); const y=Number(mk.split("-")[0]);
                    const cur=isCur(mk); const past=isPast(mk);
                    const sig=SIGNALS.find(s=>s.scope==="month"&&s.scopeKey===mk);
                    return (
                      <th key={mk} colSpan={3}
                        style={{padding:"5px 4px",textAlign:"center",
                          borderRight:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,
                          background:cur?"#E8F0F8":sig?.severity==="critical"?T.redLt:sig?.severity==="warning"?T.amberLt:past?"#F9F9F7":"#F7F7F5",
                          opacity:past&&!cur?0.75:1}}>
                        <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                          {cur&&<span style={{width:5,height:5,borderRadius:"50%",background:T.navy,boxShadow:`0 0 0 2px ${T.navyLt}`}}/>}
                          <span style={{fontFamily:T.mono,fontSize:10,fontWeight:cur?600:400,color:cur?T.navy:T.text}}>
                            {MS[m-1]}
                          </span>
                          <span style={{fontFamily:T.mono,fontSize:9,color:T.textSm}}>{String(y).slice(2)}</span>
                          {sig&&<StatusDot severity={sig.severity}/>}
                        </div>
                      </th>
                    );
                  })}
                  <th style={{position:"sticky",right:0,zIndex:30,background:"#F7F7F5",
                    padding:"4px 10px",borderLeft:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.border}`}}/>
                </tr>
              )}

              {/* Bud / Act / Fct sub-labels */}
              <tr style={{background:"#F2F2EF"}}>
                <th style={{position:"sticky",left:0,zIndex:30,background:"#F2F2EF",
                  padding:"3px 10px",borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`}}/>
                {viewMode==="monthly"
                  ? MONTHS.flatMap(mk=>[
                      <th key={`${mk}-b`} style={{padding:"3px 3px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.navy,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:"#EEF4F9",minWidth:52,fontWeight:500}}>BUD</th>,
                      <th key={`${mk}-a`} style={{padding:"3px 3px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.violet,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:T.violetLt,minWidth:52,fontWeight:500}}>ACT</th>,
                      <th key={`${mk}-f`} style={{padding:"3px 3px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.green,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,borderRight:`1px solid ${T.border}`,background:"#F0F7F3",minWidth:52,fontWeight:500}}>FCT</th>,
                    ])
                  : QUARTERS.flatMap(q=>[
                      <th key={`${q.label}-b`} style={{padding:"3px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.navy,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:"#EEF4F9",fontWeight:500}}>Budget</th>,
                      <th key={`${q.label}-a`} style={{padding:"3px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.violet,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:T.violetLt,fontWeight:500}}>Actual</th>,
                      <th key={`${q.label}-f`} style={{padding:"3px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.green,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:"#F0F7F3",fontWeight:500}}>Forecast</th>,
                      <th key={`${q.label}-v`} style={{padding:"3px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.amber,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,fontWeight:500}}>Var</th>,
                      <th key={`${q.label}-u`} style={{padding:"3px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.textSm,letterSpacing:"0.06em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,borderRight:`1px solid ${T.border}`,fontWeight:500}}>Util%</th>,
                    ])
                }
                <th style={{position:"sticky",right:0,zIndex:30,background:"#F0F7F3",
                  padding:"3px 10px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.green,
                  letterSpacing:"0.08em",textTransform:"uppercase",fontWeight:500,
                  borderLeft:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`}}>FCT</th>
              </tr>
            </thead>

            {/* TBODY */}
            <tbody>
              {viewMode==="monthly"
                ? QUARTERS.map(q=>{
                    const isCol = collapsed.has(q.label);
                    return [
                      <QuarterHeaderRow key={`qh-${q.label}`} q={q} collapsed={isCol} onToggle={()=>toggleQ(q.label)}/>,
                      ...(isCol ? [] : [

                        // Cost line rows
                        ...LINES.map((line,li)=>{
                          const lineFct = q.months.reduce((s,mk)=>s+(SEED[line.id]?.[mk]?.[2]||0),0);
                          const lineBud = q.months.reduce((s,mk)=>s+(SEED[line.id]?.[mk]?.[0]||0),0);
                          const isOver  = lineBud>0 && lineFct>lineBud;
                          const rowBg   = li%2===0 ? T.surface : "#FAFAF8";
                          return (
                            <tr key={`${q.label}-${line.id}`}
                              style={{background:rowBg,borderBottom:`1px solid ${T.border}`}}>
                              <td style={{position:"sticky",left:0,zIndex:10,padding:"5px 10px 5px 22px",
                                borderRight:`1px solid ${T.border}`,background:rowBg,minWidth:200,verticalAlign:"middle"}}>
                                <div style={{fontFamily:T.sans,fontSize:11,fontWeight:500,color:T.text}}>{line.description}</div>
                                <div style={{fontFamily:T.mono,fontSize:8,color:T.textSm,marginTop:1,letterSpacing:"0.04em"}}>{CAT_LABELS[line.category]||line.category}</div>
                              </td>
                              {q.months.map(mk=>{
                                const d    = SEED[line.id]?.[mk]||[0,0,0];
                                const locked = isPast(mk);
                                const fOver  = d[0]&&d[2]>d[0];
                                return [
                                  <td key={`${mk}-b`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,
                                    fontSize:10,color:T.navy,background:"#F2F8FF",
                                    borderBottom:`1px solid ${T.border}`,minWidth:52,verticalAlign:"middle"}}>
                                    {d[0]?fmtK(d[0]):<span style={{color:T.border}}>—</span>}
                                  </td>,
                                  <td key={`${mk}-a`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,
                                    fontSize:10,color:T.violet,background:"#F9F7FF",
                                    borderBottom:`1px solid ${T.border}`,minWidth:52,verticalAlign:"middle"}}>
                                    {locked&&d[1]?fmtK(d[1]):<span style={{color:T.border}}>—</span>}
                                  </td>,
                                  <td key={`${mk}-f`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,
                                    fontSize:10,fontWeight:fOver?600:400,
                                    color:fOver?T.red:T.green,
                                    background:fOver?"#FDF5F4":"#F3FAF6",
                                    borderRight:`1px solid ${T.border}`,
                                    borderBottom:`1px solid ${T.border}`,minWidth:52,verticalAlign:"middle"}}>
                                    {d[2]?fmtK(d[2]):<span style={{color:T.border}}>—</span>}
                                  </td>,
                                ];
                              })}
                              <td style={{position:"sticky",right:0,zIndex:10,padding:"4px 10px",textAlign:"right",
                                fontFamily:T.mono,fontSize:10,fontWeight:600,
                                color:isOver?T.red:lineFct>0?T.green:T.textSm,
                                background:rowBg,borderLeft:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`,verticalAlign:"middle"}}>
                                {lineFct?fmtK(lineFct):"—"}
                              </td>
                            </tr>
                          );
                        }),

                        // Q Totals row
                        <tr key={`${q.label}-tot`} style={{background:"#F0F0ED",borderBottom:`2px solid ${T.borderMd}`}}>
                          <td style={{position:"sticky",left:0,zIndex:10,padding:"5px 10px 5px 22px",
                            borderRight:`1px solid ${T.borderMd}`,background:"#F0F0ED",
                            fontFamily:T.mono,fontSize:8,fontWeight:600,color:T.textSm,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                            Q Total
                          </td>
                          {q.months.flatMap(mk=>{
                            const t=MT[mk]; const over=t.b&&t.f>t.b;
                            return [
                              <td key={`${mk}-tb`} style={{padding:"5px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:T.navy,background:"#E8F0F8"}}>{t.b?fmtK(t.b):"—"}</td>,
                              <td key={`${mk}-ta`} style={{padding:"5px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.violet,background:"#F0EEFF"}}>{isPast(mk)&&t.a?fmtK(t.a):"—"}</td>,
                              <td key={`${mk}-tf`} style={{padding:"5px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:over?T.red:T.green,background:over?"#FBF0EE":"#EAF5EE",borderRight:`1px solid ${T.border}`}}>{t.f?fmtK(t.f):"—"}</td>,
                            ];
                          })}
                          <td style={{position:"sticky",right:0,zIndex:10,padding:"5px 10px",textAlign:"right",
                            fontFamily:T.mono,fontSize:11,fontWeight:700,color:T.text,
                            background:"#F0F0ED",borderLeft:`1px solid ${T.borderMd}`}}>
                            {fmtK(q.months.reduce((s,mk)=>s+(MT[mk]?.f||0),0))}
                          </td>
                        </tr>,

                        // Δ Movement row
                        <tr key={`${q.label}-mv`} style={{background:"#FDFAF2",borderBottom:`1px solid #E8E0C0`}}>
                          <td style={{position:"sticky",left:0,zIndex:10,padding:"4px 10px 4px 22px",
                            borderRight:`1px solid #E8E0C0`,background:"#FDFAF2",
                            fontFamily:T.mono,fontSize:8,fontWeight:600,color:T.amber,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                            Δ Movement
                          </td>
                          {q.months.flatMap(mk=>{
                            const mv=fcastMv[mk];
                            return [
                              <td key={`${mk}-m1`} style={{background:"#FDFAF2",borderBottom:`1px solid #F0E8C0`}}/>,
                              <td key={`${mk}-m2`} style={{background:"#FDFAF2",borderBottom:`1px solid #F0E8C0`}}/>,
                              <td key={`${mk}-m3`} style={{padding:"4px 6px",textAlign:"right",
                                background:"#FDFAF2",borderRight:`1px solid #E8E0C0`,borderBottom:`1px solid #F0E8C0`}}>
                                {mv&&mv!==0?(
                                  <span style={{fontFamily:T.mono,fontSize:9,fontWeight:600,color:mv>0?T.red:T.green}}>
                                    {mv>0?"▲":"▼"} {fmtK(Math.abs(mv))}
                                  </span>
                                ):<span style={{fontFamily:T.mono,fontSize:9,color:T.border}}>—</span>}
                              </td>,
                            ];
                          })}
                          <td style={{position:"sticky",right:0,zIndex:10,background:"#FDFAF2",borderLeft:`1px solid #E8E0C0`}}/>
                        </tr>,
                      ]),
                    ];
                  })

                // ── Quarterly view ──
                : QUARTERS.map((q,qi)=>{
                    const qB=q.months.reduce((s,mk)=>s+(MT[mk]?.b||0),0);
                    const qA=q.months.filter(isPast).reduce((s,mk)=>s+(MT[mk]?.a||0),0);
                    const qF=q.months.reduce((s,mk)=>s+(MT[mk]?.f||0),0);
                    const qV=qB?qF-qB:0;
                    const qU=qB?Math.round((qF/qB)*100):null;
                    const over=qB>0&&qF>qB;
                    const sig=SIGNALS.find(s=>s.scopeKey===q.label);
                    const rowBg=sig?.severity==="critical"?T.redLt:sig?.severity==="warning"?T.amberLt:qi%2===0?T.surface:"#FAFAF8";
                    return (
                      <tr key={q.label} style={{background:rowBg,borderBottom:`1px solid ${T.border}`}}>
                        <td style={{position:"sticky",left:0,zIndex:10,padding:"10px",
                          background:rowBg,minWidth:200,borderRight:`1px solid ${T.border}`,verticalAlign:"middle"}}>
                          <div style={{display:"flex",alignItems:"center",gap:6}}>
                            <span style={{fontFamily:T.mono,fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:T.text}}>{q.label}</span>
                            {sig&&<StatusDot severity={sig.severity}/>}
                          </div>
                          {sig&&<div style={{fontFamily:T.sans,fontSize:10,color:sig.severity==="critical"?T.red:T.amber,marginTop:3}}>{sig.message}</div>}
                        </td>
                        <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,fontWeight:500,color:T.navy,background:"#F2F8FF"}}>{fmtK(qB)}</td>
                        <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,color:T.violet,background:"#F9F7FF"}}>{qA?fmtK(qA):"—"}</td>
                        <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,fontWeight:600,color:over?T.red:T.green,background:over?T.redLt:T.greenLt}}>{fmtK(qF)}</td>
                        <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,fontWeight:500,color:over?T.red:T.green}}>{qB?`${over?"+":""}${fmtK(qV)}`:"—"}</td>
                        <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,
                          color:(qU||0)>100?T.red:(qU||0)>85?T.amber:T.textMd,
                          borderRight:`1px solid ${T.border}`}}>
                          {qU!==null?`${qU}%`:"—"}
                        </td>
                        <td style={{position:"sticky",right:0,zIndex:10,padding:"10px",textAlign:"right",
                          fontFamily:T.mono,fontSize:12,fontWeight:700,color:T.text,
                          background:rowBg,borderLeft:`1px solid ${T.border}`,verticalAlign:"middle"}}>
                          {fmtK(qF)}
                        </td>
                      </tr>
                    );
                  })
              }
            </tbody>

            {/* TFOOT */}
            <tfoot style={{position:"sticky",bottom:0,zIndex:20}}>
              <tr style={{background:"#EAEAE7",borderTop:`2px solid ${T.borderMd}`}}>
                <td style={{position:"sticky",left:0,zIndex:30,padding:"8px 10px",
                  background:"#EAEAE7",borderRight:`1px solid ${T.borderMd}`,
                  fontFamily:T.mono,fontSize:8,fontWeight:600,letterSpacing:"0.12em",
                  textTransform:"uppercase",color:T.textMd}}>
                  Grand Total
                </td>
                {viewMode==="monthly"
                  ? MONTHS.flatMap(mk=>{
                      const t=MT[mk]; const over=t.b&&t.f>t.b;
                      return [
                        <td key={`ft-${mk}-b`} style={{padding:"7px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:T.navy,background:"#E8F0F8"}}>{t.b?fmtK(t.b):"—"}</td>,
                        <td key={`ft-${mk}-a`} style={{padding:"7px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.violet,background:"#F0EEFF"}}>{isPast(mk)&&t.a?fmtK(t.a):"—"}</td>,
                        <td key={`ft-${mk}-f`} style={{padding:"7px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:over?T.red:T.green,background:over?"#FAF0EE":"#E8F5EE",borderRight:`1px solid ${T.border}`}}>{t.f?fmtK(t.f):"—"}</td>,
                      ];
                    })
                  : QUARTERS.flatMap(q=>{
                      const qB=q.months.reduce((s,mk)=>s+(MT[mk]?.b||0),0);
                      const qA=q.months.reduce((s,mk)=>s+(MT[mk]?.a||0),0);
                      const qF=q.months.reduce((s,mk)=>s+(MT[mk]?.f||0),0);
                      const qV=qB?qF-qB:0;
                      const qU=qB?Math.round((qF/qB)*100):null;
                      return [
                        <td key={`${q.label}-b`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:T.navy,background:"#E8F0F8"}}>{fmtK(qB)}</td>,
                        <td key={`${q.label}-a`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.violet,background:"#F0EEFF"}}>{fmtK(qA)}</td>,
                        <td key={`${q.label}-f`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:qF>qB?T.red:T.green,background:qF>qB?"#FAF0EE":"#E8F5EE"}}>{fmtK(qF)}</td>,
                        <td key={`${q.label}-v`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.amber}}>{qB?fmtK(qV):"—"}</td>,
                        <td key={`${q.label}-u`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.textMd,borderRight:`1px solid ${T.border}`}}>{qU!==null?`${qU}%`:"—"}</td>,
                      ];
                    })
                }
                <td style={{position:"sticky",right:0,zIndex:30,padding:"8px 12px",textAlign:"right",
                  fontFamily:T.mono,fontSize:13,fontWeight:700,color:T.green,
                  background:"#EAEAE7",borderLeft:`1px solid ${T.borderMd}`}}>
                  {fmtK(grandTotal)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* ── Forecast movement strip ── */}
        {viewMode==="monthly" && (
          <div style={{border:`1px solid #E0D8B0`,background:"#FDFAF2",padding:"12px 16px"}}>
            <div style={{fontFamily:T.mono,fontSize:8,fontWeight:600,letterSpacing:"0.12em",
              textTransform:"uppercase",color:T.amber,marginBottom:8}}>
              Δ Forecast Movement — month on month
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {MONTHS.map((mk,i)=>{
                if(i===0)return null;
                const mv=fcastMv[mk];
                if(!mv||mv===0)return null;
                const [y,m]=mk.split("-");
                const up=mv>0;
                return (
                  <div key={mk} style={{display:"flex",alignItems:"center",gap:6,padding:"3px 10px",
                    background:up?T.redLt:T.greenLt,
                    border:`1px solid ${up?"#F0B0AA":"#A0D0B8"}`,
                    fontFamily:T.mono,fontSize:10}}>
                    <span style={{color:T.textSm,fontWeight:400}}>{MS[Number(m)-1]} {y.slice(2)}</span>
                    <span style={{fontWeight:600,color:up?T.red:T.green}}>{up?"▲":"▼"} {fmtK(Math.abs(mv))}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Signals ── */}
        <div style={{border:`1px solid ${T.border}`,overflow:"hidden"}}>
          <div style={{background:"#F5F5F2",borderBottom:`1px solid ${T.borderMd}`,padding:"6px 10px",
            display:"flex",alignItems:"center",gap:8}}>
            <Label>Intelligence Signals</Label>
            <span style={{marginLeft:"auto",fontFamily:T.mono,fontSize:9,color:T.textSm}}>{SIGNALS.length} active</span>
          </div>
          {SIGNALS.map((s,i)=>(
            <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 14px",
              borderBottom:i<SIGNALS.length-1?`1px solid ${T.border}`:"none",
              background:s.severity==="critical"?T.redLt:s.severity==="warning"?T.amberLt:T.greenLt}}>
              <StatusDot severity={s.severity}/>
              <div>
                <div style={{fontFamily:T.mono,fontSize:9,fontWeight:600,color:T.textMd,
                  letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>
                  {s.scopeKey}
                </div>
                <div style={{fontFamily:T.sans,fontSize:11,color:T.text}}>{s.message}</div>
              </div>
              <div style={{marginLeft:"auto"}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",
                  background:s.severity==="critical"?T.redLt:s.severity==="warning"?T.amberLt:T.greenLt,
                  color:s.severity==="critical"?T.red:s.severity==="warning"?T.amber:T.green,
                  border:`1px solid ${s.severity==="critical"?"#F0B0AA":s.severity==="warning"?"#E0C080":"#A0D0B8"}`,
                  fontFamily:T.mono,fontSize:9,fontWeight:500,letterSpacing:"0.04em"}}>
                  {s.severity.toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}