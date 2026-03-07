import { useState, useMemo, useCallback } from "react";

/* ─── Google Fonts: DM Mono + DM Sans ─────────────────────────────────────── */
const FONT_LINK = document.createElement("link");
FONT_LINK.rel = "stylesheet";
FONT_LINK.href = "https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&family=DM+Sans:wght@300;400;500;600;700&display=swap";
document.head.appendChild(FONT_LINK);

/* ─── Design tokens ──────────────────────────────────────────────────────── */
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

/* ─── Global styles ──────────────────────────────────────────────────────── */
const GLOBAL_STYLE = `
  * { box-sizing: border-box; }
  body { background: ${T.bg}; font-family: ${T.sans}; color: ${T.text}; margin: 0; }
  input[type=number]::-webkit-inner-spin-button { opacity: 0.3; }
  input::placeholder { color: ${T.textSm}; }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: ${T.borderMd}; border-radius: 3px; }
  select { cursor: pointer; }
`;

/* ─── Demo data ──────────────────────────────────────────────────────────── */
const LINES = [
  { id:"l1", category:"people",          description:"Engineering Team",     budgeted:336000, actual:0,     forecast:348000, notes:"3 FTE × 12m" },
  { id:"l2", category:"people",          description:"Design & UX",          budgeted:144000, actual:0,     forecast:144000, notes:"1 FTE × 12m" },
  { id:"l3", category:"infrastructure",  description:"AWS Infrastructure",   budgeted:52800,  actual:0,     forecast:58800,  notes:"Includes prod + staging" },
  { id:"l4", category:"tools_licences",  description:"SaaS Licences",        budgeted:21600,  actual:0,     forecast:23400,  notes:"Figma, Linear, Datadog" },
  { id:"l5", category:"external_vendors",description:"External Consultancy", budgeted:56000,  actual:0,     forecast:56000,  notes:"Security audit Q3" },
];
const RESOURCES = [
  { id:"r1", name:"Alice Chen",       role:"developer",  type:"internal",   rate_type:"day_rate",    day_rate:650, planned_days:220, monthly_cost:"", planned_months:"", cost_line_id:"l1", notes:"", start_month:"2025-04" },
  { id:"r2", name:"Ben Okafor",       role:"developer",  type:"internal",   rate_type:"day_rate",    day_rate:600, planned_days:210, monthly_cost:"", planned_months:"", cost_line_id:"l1", notes:"", start_month:"2025-04" },
  { id:"r3", name:"Clara Martinez",   role:"designer",   type:"internal",   rate_type:"monthly_cost",day_rate:"",  planned_days:"",  monthly_cost:12000,planned_months:12, cost_line_id:"l2", notes:"", start_month:"2025-04" },
  { id:"r4", name:"Deepa Security Ltd",role:"consultant",type:"contractor", rate_type:"day_rate",   day_rate:1400,planned_days:40,  monthly_cost:"", planned_months:"", cost_line_id:"l5", notes:"Q3", start_month:"2025-10" },
];
const CHANGES = [
  { id:"c1", change_ref:"CR-001", title:"Add mobile app scope",   cost_impact:28000, status:"pending",  notes:"Awaiting board sign-off" },
  { id:"c2", change_ref:"CR-002", title:"Additional AWS regions", cost_impact:8400,  status:"approved", notes:"Approved 12 Feb" },
];
const SIGNALS = [
  { scope:"quarter", scopeKey:"Q2 FY25/26", severity:"warning",  message:"Forecast tracking 6% over budget this quarter" },
  { scope:"month",   scopeKey:"2025-05",    severity:"critical", message:"Infrastructure overspend detected (£4.8k above budget)" },
  { scope:"month",   scopeKey:"2025-09",    severity:"warning",  message:"AWS cost spike — review Reserved Instance coverage" },
];
const MONTH_SEED = {
  l1:{"2025-04":[28000,26800,29000],"2025-05":[28000,29500,28500],"2025-06":[28000,0,28000],"2025-07":[30000,0,31000],"2025-08":[30000,0,30000],"2025-09":[30000,0,32500],"2025-10":[30000,0,30000],"2025-11":[30000,0,30000],"2025-12":[30000,0,28000],"2026-01":[32000,0,32000],"2026-02":[32000,0,32000],"2026-03":[32000,0,32000]},
  l2:{"2025-04":[12000,11500,12000],"2025-05":[12000,11800,12000],"2025-06":[12000,0,12000],"2025-07":[12000,0,13000],"2025-08":[12000,0,12000],"2025-09":[12000,0,12000],"2025-10":[14000,0,14000],"2025-11":[14000,0,14000],"2025-12":[14000,0,14000],"2026-01":[14000,0,14000],"2026-02":[14000,0,14000],"2026-03":[14000,0,14000]},
  l3:{"2025-04":[4200,4100,4200],"2025-05":[4200,4800,5000],"2025-06":[4200,0,4200],"2025-07":[4500,0,4500],"2025-08":[4500,0,4800],"2025-09":[4500,0,6200],"2025-10":[5000,0,5000],"2025-11":[5000,0,5000],"2025-12":[5000,0,5200],"2026-01":[5500,0,5500],"2026-02":[5500,0,5500],"2026-03":[5500,0,5500]},
  l4:{"2025-04":[1800,1800,1800],"2025-05":[1800,1800,1800],"2025-06":[1800,0,1800],"2025-07":[1800,0,1800],"2025-08":[1800,0,1800],"2025-09":[1800,0,2200],"2025-10":[2000,0,2000],"2025-11":[2000,0,2000],"2025-12":[2000,0,2000],"2026-01":[2000,0,2000],"2026-02":[2000,0,2000],"2026-03":[2000,0,2000]},
  l5:{"2025-04":[0,0,0],"2025-05":[0,0,0],"2025-06":[0,0,0],"2025-07":[0,0,0],"2025-08":[0,0,0],"2025-09":[0,0,0],"2025-10":[14000,0,14000],"2025-11":[14000,0,14000],"2025-12":[14000,0,14000],"2026-01":[0,0,0],"2026-02":[0,0,0],"2026-03":[0,0,0]},
};
const MONTHS = ["2025-04","2025-05","2025-06","2025-07","2025-08","2025-09","2025-10","2025-11","2025-12","2026-01","2026-02","2026-03"];
const QUARTERS = [
  {label:"Q1 FY25/26",months:["2025-04","2025-05","2025-06"]},
  {label:"Q2 FY25/26",months:["2025-07","2025-08","2025-09"]},
  {label:"Q3 FY25/26",months:["2025-10","2025-11","2025-12"]},
  {label:"Q4 FY25/26",months:["2026-01","2026-02","2026-03"]},
];
const MS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CAT_LABELS = {people:"People & Contractors",tools_licences:"Tools & Licences",infrastructure:"Infrastructure",external_vendors:"External Vendors",travel:"Travel & Expenses",contingency:"Contingency",other:"Other"};
const RES_TYPES = {internal:"Internal",contractor:"Contractor",vendor:"Vendor",consultant:"Consultant"};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */
const CUR = (() => { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; })();
const isPast = mk => mk < CUR;
const isCur  = mk => mk === CUR;

function fmtGbp(n, shorten=false) {
  if (!n && n!==0) return "—";
  const v = Number(n);
  if (isNaN(v)) return "—";
  if (shorten) {
    if (Math.abs(v)>=1_000_000) return `£${(Math.abs(v)/1_000_000).toFixed(2)}M`;
    if (Math.abs(v)>=1000)      return `£${(Math.abs(v)/1000).toFixed(1)}k`;
    return `£${Math.abs(v)}`;
  }
  return `£${Math.abs(v).toLocaleString("en-GB")}`;
}
function pct(a,b) { if (!b) return null; return ((a-b)/b*100).toFixed(1); }
function resTotal(r) {
  return r.rate_type==="day_rate"
    ? (Number(r.day_rate)||0)*(Number(r.planned_days)||0)
    : (Number(r.monthly_cost)||0)*(Number(r.planned_months)||0);
}

/* ─── Tiny components ─────────────────────────────────────────────────────── */

function Pill({color, children}) {
  const palettes = {
    red:    {bg:T.redLt,   text:T.red,    border:"#F0B0AA"},
    green:  {bg:T.greenLt, text:T.green,  border:"#A0D0B8"},
    amber:  {bg:T.amberLt, text:T.amber,  border:"#E0C080"},
    navy:   {bg:T.navyLt,  text:T.navy,   border:"#A0BAD0"},
    violet: {bg:T.violetLt,text:T.violet, border:"#C0B0E0"},
    gray:   {bg:"#F4F4F2", text:T.textMd, border:T.border},
  };
  const p = palettes[color] || palettes.gray;
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 8px",borderRadius:2,
      background:p.bg,color:p.text,border:`1px solid ${p.border}`,
      fontSize:10,fontFamily:T.mono,fontWeight:500,letterSpacing:"0.04em",whiteSpace:"nowrap"}}>
      {children}
    </span>
  );
}

function StatusDot({severity}) {
  const c = severity==="critical" ? T.red : severity==="warning" ? T.amber : T.green;
  return <span style={{display:"inline-block",width:6,height:6,borderRadius:"50%",background:c,flexShrink:0}} />;
}

function Mono({children, color, size=11}) {
  return <span style={{fontFamily:T.mono,fontSize:size,color:color||T.text}}>{children}</span>;
}

function Label({children, upper=true}) {
  return <span style={{
    fontFamily:T.mono,fontSize:9,letterSpacing:"0.12em",color:T.textSm,
    textTransform:upper?"uppercase":"none",fontWeight:500,
  }}>{children}</span>;
}

function Divider() {
  return <div style={{height:1,background:T.border,margin:"0 0"}} />;
}

function StatCard({label, value, sub, color, locked=false}) {
  return (
    <div style={{background:T.surface,border:`1px solid ${T.border}`,padding:"14px 18px",minWidth:120}}>
      <div style={{display:"flex",alignItems:"center",gap:5,marginBottom:4}}>
        {locked && <span style={{fontFamily:T.mono,fontSize:9,color:T.violet}}>⊠</span>}
        <Label>{label}</Label>
      </div>
      <div style={{fontFamily:T.mono,fontSize:18,fontWeight:500,color:color||T.text,lineHeight:1}}>{value}</div>
      {sub && <div style={{fontFamily:T.sans,fontSize:10,color:T.textSm,marginTop:4}}>{sub}</div>}
    </div>
  );
}

function DataRow({odd, children, hover=true}) {
  const [h, setH] = useState(false);
  return (
    <tr
      onMouseEnter={()=>hover&&setH(true)}
      onMouseLeave={()=>setH(false)}
      style={{background: h ? T.navyLt : odd ? "#FAFAF8" : T.surface, transition:"background 0.1s"}}
    >
      {children}
    </tr>
  );
}

function TD({children, right=false, mono=false, sm=false, muted=false, style={}}) {
  return (
    <td style={{
      padding:"6px 10px",
      borderBottom:`1px solid ${T.border}`,
      fontFamily: mono ? T.mono : T.sans,
      fontSize: sm ? 10 : 11,
      color: muted ? T.textSm : T.text,
      textAlign: right ? "right" : "left",
      verticalAlign:"middle",
      ...style,
    }}>
      {children}
    </td>
  );
}

function TH({children, right=false}) {
  return (
    <th style={{
      padding:"7px 10px",
      background:"#F2F2EF",
      borderBottom:`1px solid ${T.borderMd}`,
      fontFamily:T.mono,fontSize:9,fontWeight:500,
      color:T.textSm,letterSpacing:"0.1em",textTransform:"uppercase",
      textAlign:right?"right":"left",whiteSpace:"nowrap",
    }}>
      {children}
    </th>
  );
}

function InlineInput({value, onChange, placeholder, mono=false, right=false, width="100%"}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="text" value={value||""} placeholder={placeholder||""}
      onChange={e=>onChange(e.target.value)}
      onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
      style={{
        width, border:"none", background:"transparent",
        fontFamily:mono?T.mono:T.sans, fontSize:11, color:T.text,
        textAlign:right?"right":"left", padding:"3px 0",
        outline: focused ? `1px solid ${T.navy}` : "none",
        outlineOffset:2, borderRadius:1,
      }}
    />
  );
}

function NumInput({value, onChange, placeholder}) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      type="number" value={value||""} placeholder={placeholder||"0"}
      onChange={e=>onChange(e.target.value===""?"":Number(e.target.value))}
      onFocus={()=>setFocused(true)} onBlur={()=>setFocused(false)}
      style={{
        width:"100%", border:"none", background:"transparent",
        fontFamily:T.mono, fontSize:11, color:T.text,
        textAlign:"right", padding:"3px 4px",
        outline: focused ? `1px solid ${T.navy}` : "none",
        outlineOffset:2, borderRadius:1,
      }}
    />
  );
}

function PSelect({value, onChange, options, disabled=false, small=false}) {
  return (
    <select
      value={value} onChange={e=>onChange(e.target.value)} disabled={disabled}
      style={{
        border:`1px solid ${T.border}`,background:T.surface,
        fontFamily:T.mono,fontSize:small?9:10,color:T.text,
        padding:"4px 6px",borderRadius:0,outline:"none",width:"100%",
        letterSpacing:"0.02em",
      }}
    >
      {options.map(o=><option key={o.value||o} value={o.value||o}>{o.label||o}</option>)}
    </select>
  );
}

function Btn({children, onClick, variant="default", small=false}) {
  const [h, setH] = useState(false);
  const variants = {
    default: {
      bg:h?"#E8EDF2":T.navyLt, color:T.navy,
      border:`1px solid ${h?"#A0BAD0":"#C0D0E0"}`,
    },
    primary: {
      bg:h?"#153048":T.navy, color:"#FFFFFF",
      border:`1px solid ${T.navy}`,
    },
    ghost: {
      bg:"transparent", color:h?T.navy:T.textMd,
      border:`1px solid ${h?T.border:"transparent"}`,
    },
    danger: {
      bg:h?T.redLt:"transparent", color:h?T.red:T.textSm,
      border:`1px solid ${h?"#F0B0AA":"transparent"}`,
    },
  };
  const v = variants[variant] || variants.default;
  return (
    <button
      onClick={onClick}
      onMouseEnter={()=>setH(true)} onMouseLeave={()=>setH(false)}
      style={{
        display:"inline-flex",alignItems:"center",gap:4,
        padding: small ? "3px 8px" : "5px 12px",
        background:v.bg, color:v.color, border:v.border,
        fontFamily:T.mono,fontSize:small?9:10,fontWeight:500,
        letterSpacing:"0.05em",cursor:"pointer",borderRadius:0,
        transition:"all 0.1s",
      }}
    >
      {children}
    </button>
  );
}

/* ─── Monthly view helpers ───────────────────────────────────────────────── */
function monthTotals(seed) {
  const r={};
  for (const mk of MONTHS) {
    let b=0,a=0,f=0;
    for (const lid of Object.keys(seed)) {
      const d=seed[lid]?.[mk]||[0,0,0];
      b+=d[0]; a+=d[1]; f+=d[2];
    }
    r[mk]={b,a,f};
  }
  return r;
}
const MT = monthTotals(MONTH_SEED);

/* ─── Tab: Cost Breakdown ────────────────────────────────────────────────── */
function CostBreakdownTab() {
  const [lines, setLines] = useState(LINES);
  const totalB = lines.reduce((s,l)=>s+(l.budgeted||0),0);
  const totalF = lines.reduce((s,l)=>s+(l.forecast||0),0);
  const approvedBudget = 630000;
  const variance = totalF - approvedBudget;
  const over = variance > 0;
  const utilPct = Math.round((totalF/approvedBudget)*100);

  const update = (id, k, v) => setLines(prev=>prev.map(l=>l.id===id?{...l,[k]:v}:l));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Stats row */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:1,background:T.border}}>
        <StatCard label="Approved Budget"  value={fmtGbp(approvedBudget)} sub="FY 2025/26" color={T.navy} />
        <StatCard label="Total Budgeted"   value={fmtGbp(totalB)} sub="across all lines" />
        <StatCard label="Total Forecast"   value={fmtGbp(totalF)} sub={`${utilPct}% utilisation`} color={over?T.red:T.green} />
        <StatCard label="Forecast Variance" value={(over?"+":"")+fmtGbp(Math.abs(variance))}
          sub={over?"exceeds approved budget":"under approved budget"} color={over?T.red:T.green} />
      </div>

      {over && (
        <div style={{display:"flex",alignItems:"center",gap:8,padding:"8px 12px",
          background:T.redLt,border:`1px solid #F0B0AA`,fontFamily:T.mono,fontSize:10,color:T.red}}>
          ▲ Forecast exceeds approved budget by {fmtGbp(variance)} ({pct(totalF,approvedBudget)}%)
        </div>
      )}

      {/* Table */}
      <div style={{border:`1px solid ${T.border}`,overflow:"hidden"}}>
        <div style={{background:"#F5F5F2",borderBottom:`1px solid ${T.borderMd}`,
          padding:"6px 10px",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontFamily:T.mono,fontSize:9,letterSpacing:"0.1em",color:T.textSm,textTransform:"uppercase"}}>
            Cost Breakdown
          </span>
          <span style={{marginLeft:"auto"}}>
            <Pill color="violet">⊠ Actual column auto-computed from timesheets</Pill>
          </span>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <TH>Category</TH>
              <TH>Description</TH>
              <TH right>Budgeted</TH>
              <TH right>Actual ⊠</TH>
              <TH right>Forecast</TH>
              <TH right>Var %</TH>
              <TH>Notes</TH>
              <TH></TH>
            </tr>
          </thead>
          <tbody>
            {lines.map((l,i)=>{
              const v = l.budgeted ? pct(l.forecast, l.budgeted) : null;
              const over = v !== null && Number(v) > 0;
              return (
                <DataRow key={l.id} odd={i%2===1}>
                  <TD><PSelect value={l.category} onChange={v=>update(l.id,"category",v)}
                    options={Object.entries(CAT_LABELS).map(([k,lbl])=>({value:k,label:lbl}))} /></TD>
                  <TD><InlineInput value={l.description} onChange={v=>update(l.id,"description",v)} placeholder="Description…" /></TD>
                  <TD right mono><NumInput value={l.budgeted} onChange={v=>update(l.id,"budgeted",v)} /></TD>
                  <TD right mono style={{background:T.violetLt}}>
                    <span style={{color:T.violet,display:"flex",alignItems:"center",justifyContent:"flex-end",gap:3}}>
                      <span style={{fontSize:9}}>⊠</span>
                      {l.actual ? fmtGbp(l.actual,true) : <span style={{color:T.textSm}}>—</span>}
                    </span>
                  </TD>
                  <TD right mono><NumInput value={l.forecast} onChange={v=>update(l.id,"forecast",v)} /></TD>
                  <TD right>
                    {v !== null ? (
                      <span style={{fontFamily:T.mono,fontSize:10,fontWeight:500,
                        color:over?T.red:T.green}}>
                        {over?"+":""}{v}%
                      </span>
                    ) : <span style={{color:T.textSm,fontFamily:T.mono,fontSize:10}}>—</span>}
                  </TD>
                  <TD muted><InlineInput value={l.notes} onChange={v=>update(l.id,"notes",v)} placeholder="Notes…" /></TD>
                  <TD>
                    <Btn variant="danger" small onClick={()=>setLines(prev=>prev.filter(x=>x.id!==l.id))}>✕</Btn>
                  </TD>
                </DataRow>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{background:"#F0F0ED"}}>
              <td colSpan={2} style={{padding:"7px 10px",fontFamily:T.mono,fontSize:10,color:T.textMd,letterSpacing:"0.05em"}}>
                TOTAL
              </td>
              <td style={{padding:"7px 10px",fontFamily:T.mono,fontSize:11,fontWeight:500,color:T.navy,textAlign:"right"}}>{fmtGbp(totalB)}</td>
              <td style={{padding:"7px 10px",background:T.violetLt,fontFamily:T.mono,fontSize:11,fontWeight:500,color:T.violet,textAlign:"right"}}>—</td>
              <td style={{padding:"7px 10px",fontFamily:T.mono,fontSize:11,fontWeight:500,color:over?T.red:T.green,textAlign:"right"}}>{fmtGbp(totalF)}</td>
              <td style={{padding:"7px 10px",fontFamily:T.mono,fontSize:10,fontWeight:500,
                color:over?T.red:T.green,textAlign:"right"}}>
                {totalB ? `${over?"+":""}${pct(totalF,totalB)}%` : "—"}
              </td>
              <td colSpan={2} />
            </tr>
          </tfoot>
        </table>
        <div style={{padding:"8px 10px",background:"#F5F5F2",borderTop:`1px solid ${T.border}`}}>
          <Btn onClick={()=>setLines(prev=>[...prev,{id:"l"+Date.now(),category:"other",description:"",budgeted:"",actual:"",forecast:"",notes:""}])}>
            + Add line
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── Tab: Resources ─────────────────────────────────────────────────────── */
function ResourcesTab() {
  const [resources, setResources] = useState(RESOURCES);
  const totalCost = resources.reduce((s,r)=>s+resTotal(r),0);
  const update = (id, k, v) => setResources(prev=>prev.map(r=>r.id===id?{...r,[k]:v}:r));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:1,background:T.border}}>
        <StatCard label="Total Resources"      value={String(resources.length)} sub="across all roles" />
        <StatCard label="Total Resource Cost"  value={fmtGbp(totalCost,true)} sub="planned total" color={T.navy} />
        <StatCard label="Linked to Cost Lines" value={String(resources.filter(r=>r.cost_line_id).length)} sub="resources linked" color={T.green} />
        <StatCard label="Unlinked Resources"   value={String(resources.filter(r=>!r.cost_line_id).length)} sub="not rolled up" color={T.amber} />
      </div>

      <div style={{border:`1px solid ${T.border}`,overflow:"hidden"}}>
        <div style={{background:"#F5F5F2",borderBottom:`1px solid ${T.borderMd}`,padding:"6px 10px",
          display:"flex",alignItems:"center",gap:8}}>
          <Label>Resource Allocation</Label>
          <span style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
            <Pill color="violet">⊠ Actuals locked — approved timesheets × rate</Pill>
          </span>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:860}}>
            <thead>
              <tr>
                <TH>Name / Role</TH>
                <TH>Type</TH>
                <TH>Rate Method</TH>
                <TH right>Rate</TH>
                <TH right>Planned Qty</TH>
                <TH right>Total</TH>
                <TH>Links to</TH>
                <TH>Start</TH>
                <TH></TH>
              </tr>
            </thead>
            <tbody>
              {resources.map((r,i)=>{
                const tot = resTotal(r);
                const typeColors = {internal:T.navy,contractor:T.amber,vendor:"#6A3A7A",consultant:T.green};
                return (
                  <DataRow key={r.id} odd={i%2===1}>
                    <TD>
                      <div style={{fontFamily:T.sans,fontSize:11,fontWeight:500,color:T.text}}>{r.name||<span style={{color:T.textSm}}>Unnamed</span>}</div>
                      <div style={{fontFamily:T.mono,fontSize:9,color:T.textSm,marginTop:1}}>{r.role.replace("_"," ")}</div>
                    </TD>
                    <TD>
                      <span style={{fontFamily:T.mono,fontSize:9,color:typeColors[r.type]||T.textMd,
                        background:T.navyLt,padding:"2px 6px",letterSpacing:"0.06em",textTransform:"uppercase"}}>
                        {r.type}
                      </span>
                    </TD>
                    <TD>
                      <div style={{display:"flex",gap:1}}>
                        {["day_rate","monthly_cost"].map(rt=>(
                          <button key={rt} onClick={()=>update(r.id,"rate_type",rt)}
                            style={{padding:"2px 7px",fontFamily:T.mono,fontSize:9,
                              background:r.rate_type===rt?T.navy:T.bg,
                              color:r.rate_type===rt?"#FFF":T.textSm,
                              border:`1px solid ${r.rate_type===rt?T.navy:T.border}`,
                              cursor:"pointer",transition:"all 0.1s"}}>
                            {rt==="day_rate"?"Day":"Monthly"}
                          </button>
                        ))}
                      </div>
                    </TD>
                    <TD right mono>
                      {r.rate_type==="day_rate"
                        ? <span>{fmtGbp(r.day_rate,true)}<span style={{color:T.textSm,fontSize:9}}>/d</span></span>
                        : <span>{fmtGbp(r.monthly_cost,true)}<span style={{color:T.textSm,fontSize:9}}>/mo</span></span>
                      }
                    </TD>
                    <TD right mono>
                      {r.rate_type==="day_rate"
                        ? <span>{r.planned_days||"—"}<span style={{color:T.textSm,fontSize:9}}> d</span></span>
                        : <span>{r.planned_months||"—"}<span style={{color:T.textSm,fontSize:9}}> mo</span></span>
                      }
                    </TD>
                    <TD right mono style={{fontWeight:500,color:tot?T.navy:T.textSm}}>{tot?fmtGbp(tot,true):"—"}</TD>
                    <TD>
                      <span style={{fontFamily:T.mono,fontSize:9,color:r.cost_line_id?T.green:T.textSm}}>
                        {r.cost_line_id
                          ? LINES.find(l=>l.id===r.cost_line_id)?.description || r.cost_line_id
                          : "— unlinked —"}
                      </span>
                    </TD>
                    <TD mono sm muted>{r.start_month||"—"}</TD>
                    <TD>
                      <Btn variant="danger" small onClick={()=>setResources(prev=>prev.filter(x=>x.id!==r.id))}>✕</Btn>
                    </TD>
                  </DataRow>
                );
              })}
            </tbody>
            <tfoot>
              <tr style={{background:"#F0F0ED"}}>
                <td colSpan={5} style={{padding:"7px 10px",fontFamily:T.mono,fontSize:10,color:T.textMd}}>TOTAL</td>
                <td style={{padding:"7px 10px",fontFamily:T.mono,fontSize:11,fontWeight:500,color:T.navy,textAlign:"right"}}>{fmtGbp(totalCost,true)}</td>
                <td colSpan={3}/>
              </tr>
            </tfoot>
          </table>
        </div>
        <div style={{padding:"8px 10px",background:"#F5F5F2",borderTop:`1px solid ${T.border}`}}>
          <Btn onClick={()=>setResources(prev=>[...prev,{id:"r"+Date.now(),name:"",role:"developer",type:"internal",rate_type:"day_rate",day_rate:"",planned_days:"",monthly_cost:"",planned_months:"",cost_line_id:null,notes:"",start_month:""}])}>
            + Add resource
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── Tab: Monthly Phasing ───────────────────────────────────────────────── */
function MonthlyPhasingTab() {
  const [collapsed, setCollapsed] = useState(new Set(["Q3 FY25/26","Q4 FY25/26"]));
  const [viewMode, setViewMode] = useState("monthly");
  const toggleQ = label => setCollapsed(prev=>{ const n=new Set(prev); n.has(label)?n.delete(label):n.add(label); return n; });

  const grandTotal = MONTHS.reduce((s,mk)=>s+(MT[mk]?.f||0),0);
  const critCount = SIGNALS.filter(s=>s.severity==="critical").length;
  const warnCount = SIGNALS.filter(s=>s.severity==="warning").length;

  const fcastMv = {};
  for (let i=0;i<MONTHS.length;i++) {
    if(i===0){fcastMv[MONTHS[i]]=null;continue;}
    fcastMv[MONTHS[i]]=(MT[MONTHS[i]]?.f||0)-(MT[MONTHS[i-1]]?.f||0);
  }

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Toolbar */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,flexWrap:"wrap"}}>
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
        <div style={{display:"flex",alignItems:"center",gap:4}}>
          {["monthly","quarterly"].map(m=>(
            <button key={m} onClick={()=>setViewMode(m)}
              style={{padding:"4px 12px",fontFamily:T.mono,fontSize:9,letterSpacing:"0.08em",
                textTransform:"uppercase",
                background:viewMode===m?T.navy:T.bg,
                color:viewMode===m?"#FFF":T.textMd,
                border:`1px solid ${viewMode===m?T.navy:T.border}`,
                cursor:"pointer",transition:"all 0.1s"}}>
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center"}}>
        {[
          {c:"#DDEAF5",bc:"#A0BAD0",l:"Budget"},
          {c:"#F4F2FB",bc:"#C0B0E0",l:"Actual (locked)"},
          {c:"#EBF5F0",bc:"#A0D0B8",l:"Forecast"},
          {c:T.redLt,bc:"#F0B0AA",l:"Over budget"},
        ].map(({c,bc,l})=>(
          <span key={l} style={{display:"flex",alignItems:"center",gap:5,
            fontFamily:T.mono,fontSize:9,color:T.textSm,letterSpacing:"0.06em"}}>
            <span style={{width:10,height:10,background:c,border:`1px solid ${bc}`}}/>
            {l.toUpperCase()}
          </span>
        ))}
        <span style={{display:"flex",alignItems:"center",gap:5,fontFamily:T.mono,fontSize:9,color:T.textSm,letterSpacing:"0.06em"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:T.navy,
            boxShadow:`0 0 0 2px ${T.navyLt}`}}/>
          CURRENT MONTH
        </span>
      </div>

      {/* Table */}
      <div style={{border:`1px solid ${T.borderMd}`,overflow:"hidden",maxHeight:"60vh",overflowY:"auto",overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",minWidth: viewMode==="monthly" ? `${200+MONTHS.length*162+90}px` : "700px",
          fontSize:10,background:T.surface}}>
          <thead style={{position:"sticky",top:0,zIndex:20}}>
            {/* Quarter row */}
            <tr style={{background:"#EFEFEC"}}>
              <th style={{position:"sticky",left:0,zIndex:30,background:"#EFEFEC",
                minWidth:180,padding:"7px 10px",textAlign:"left",
                borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`,
                fontFamily:T.mono,fontSize:9,color:T.textSm,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                Cost Line
              </th>
              {viewMode==="monthly"
                ? QUARTERS.map(q=>(
                    <th key={q.label} colSpan={q.months.length*3}
                      style={{padding:"7px 10px",textAlign:"center",fontFamily:T.mono,fontSize:9,
                        fontWeight:500,color:T.text,letterSpacing:"0.08em",textTransform:"uppercase",
                        borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.border}`,
                        background:"#F2F2EF"}}>
                      {q.label}
                    </th>
                  ))
                : QUARTERS.map(q=>(
                    <th key={q.label} colSpan={5}
                      style={{padding:"7px 10px",textAlign:"center",fontFamily:T.mono,fontSize:9,
                        fontWeight:500,color:T.text,letterSpacing:"0.08em",textTransform:"uppercase",
                        borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.border}`,
                        background:"#F2F2EF"}}>
                      {q.label}
                    </th>
                  ))
              }
              <th style={{position:"sticky",right:0,zIndex:30,background:"#EFEFEC",
                minWidth:80,padding:"7px 10px",textAlign:"right",
                borderLeft:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`,
                fontFamily:T.mono,fontSize:9,color:T.textSm,letterSpacing:"0.1em",textTransform:"uppercase"}}>
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
                        background: cur?"#E8F0F8" : sig?.severity==="critical"?T.redLt : past?"#F9F9F7" : "#F7F7F5",
                        opacity: past&&!cur ? 0.7 : 1,
                      }}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                        {cur&&<span style={{width:5,height:5,borderRadius:"50%",background:T.navy,
                          boxShadow:`0 0 0 2px ${T.navyLt}`}}/>}
                        <span style={{fontFamily:T.mono,fontSize:10,fontWeight:cur?600:500,
                          color:cur?T.navy:T.text}}>
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

            {/* Bud/Act/Fct labels */}
            <tr style={{background:"#F2F2EF"}}>
              <th style={{position:"sticky",left:0,zIndex:30,background:"#F2F2EF",
                padding:"4px 10px",borderRight:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`}}/>
              {viewMode==="monthly"
                ? MONTHS.flatMap(mk=>[
                    <th key={`${mk}-b`} style={{padding:"4px 3px",textAlign:"right",fontFamily:T.mono,fontSize:8,
                      color:T.navy,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,
                      background:"#EEF4F9",minWidth:52}}>BUD</th>,
                    <th key={`${mk}-a`} style={{padding:"4px 3px",textAlign:"right",fontFamily:T.mono,fontSize:8,
                      color:T.violet,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,
                      background:"#F4F2FB",minWidth:52}}>ACT</th>,
                    <th key={`${mk}-f`} style={{padding:"4px 3px",textAlign:"right",fontFamily:T.mono,fontSize:8,
                      color:T.green,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,
                      borderRight:`1px solid ${T.border}`,background:"#F0F7F3",minWidth:52}}>FCT</th>,
                  ])
                : QUARTERS.flatMap(q=>[
                    <th key={`${q.label}-b`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.navy,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:"#EEF4F9"}}>Budget</th>,
                    <th key={`${q.label}-a`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.violet,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:"#F4F2FB"}}>Actual</th>,
                    <th key={`${q.label}-f`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.green,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,background:"#F0F7F3"}}>Forecast</th>,
                    <th key={`${q.label}-v`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.amber,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`}}>Var</th>,
                    <th key={`${q.label}-u`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.textSm,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:`1px solid ${T.borderMd}`,borderRight:`1px solid ${T.border}`}}>Util%</th>,
                  ])
              }
              <th style={{position:"sticky",right:0,zIndex:30,background:"#F2F2EF",
                padding:"4px 10px",textAlign:"right",fontFamily:T.mono,fontSize:8,color:T.green,
                letterSpacing:"0.08em",textTransform:"uppercase",
                borderLeft:`1px solid ${T.borderMd}`,borderBottom:`1px solid ${T.borderMd}`}}>FCT</th>
            </tr>
          </thead>

          <tbody>
            {viewMode==="monthly"
              ? QUARTERS.map(q=>{
                  const isCol=collapsed.has(q.label);
                  const sig=SIGNALS.find(s=>s.scopeKey===q.label);
                  const totB=q.months.reduce((s,mk)=>s+(MT[mk]?.b||0),0);
                  const totA=q.months.reduce((s,mk)=>s+(MT[mk]?.a||0),0);
                  const totF=q.months.reduce((s,mk)=>s+(MT[mk]?.f||0),0);
                  const over=totB&&totF>totB;
                  const util=totB?Math.round((totF/totB)*100):null;
                  return [
                    // Quarter row
                    <tr key={`qh-${q.label}`}
                      onClick={()=>toggleQ(q.label)}
                      style={{cursor:"pointer",background:
                        sig?.severity==="critical"?T.redLt:
                        sig?.severity==="warning"?T.amberLt:
                        "#EEEEEB",
                        borderBottom:`1px solid ${T.borderMd}`}}>
                      <td style={{position:"sticky",left:0,zIndex:10,padding:"7px 10px",
                        borderRight:`1px solid ${T.borderMd}`,
                        background: sig?.severity==="critical"?T.redLt: sig?.severity==="warning"?T.amberLt: "#EEEEEB",
                        minWidth:180}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontFamily:T.mono,fontSize:11,transition:"transform 0.15s",
                            display:"inline-block",transform:isCol?"rotate(0)":"rotate(90deg)",
                            color:T.textMd}}>▶</span>
                          <span style={{fontFamily:T.mono,fontSize:10,fontWeight:600,
                            letterSpacing:"0.08em",textTransform:"uppercase",color:T.text}}>
                            {q.label}
                          </span>
                          {sig&&<StatusDot severity={sig.severity}/>}
                        </div>
                      </td>
                      <td colSpan={q.months.length*3} style={{padding:"7px 12px"}}>
                        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
                          <span style={{fontFamily:T.mono,fontSize:10,color:T.textSm}}>
                            Budget <span style={{color:T.navy,fontWeight:600}}>{fmtGbp(totB,true)}</span>
                          </span>
                          <span style={{fontFamily:T.mono,fontSize:10,color:T.textSm}}>
                            Actual <span style={{color:T.violet}}>{fmtGbp(totA,true)||"—"}</span>
                          </span>
                          <span style={{fontFamily:T.mono,fontSize:10,color:T.textSm}}>
                            Forecast <span style={{color:over?T.red:T.green,fontWeight:600}}>{fmtGbp(totF,true)}</span>
                          </span>
                          {totB>0&&<span style={{fontFamily:T.mono,fontSize:10,color:over?T.red:T.green,fontWeight:600}}>
                            {over?"▲":"▼"} {fmtGbp(Math.abs(totF-totB),true)} ({over?"+":""}{pct(totF,totB)}%)
                          </span>}
                          {util!==null&&<span style={{marginLeft:"auto",fontFamily:T.mono,fontSize:10,
                            color:util>100?T.red:util>85?T.amber:T.textSm}}>
                            Util: {util}%
                          </span>}
                        </div>
                      </td>
                      <td style={{position:"sticky",right:0,zIndex:10,padding:"7px 10px",
                        background:sig?.severity==="critical"?T.redLt:sig?.severity==="warning"?T.amberLt:"#EEEEEB",
                        borderLeft:`1px solid ${T.borderMd}`}}/>
                    </tr>,

                    ...(isCol?[]:[
                      ...LINES.map((line,li)=>{
                        const lineFct=q.months.reduce((s,mk)=>s+(MONTH_SEED[line.id]?.[mk]?.[2]||0),0);
                        const lineBud=q.months.reduce((s,mk)=>s+(MONTH_SEED[line.id]?.[mk]?.[0]||0),0);
                        const isOver=lineBud>0&&lineFct>lineBud;
                        const rowBg=li%2===0?T.surface:"#FAFAF8";
                        return (
                          <tr key={`${q.label}-${line.id}`}
                            style={{background:rowBg,borderBottom:`1px solid ${T.border}`}}>
                            <td style={{position:"sticky",left:0,zIndex:10,padding:"5px 10px 5px 20px",
                              borderRight:`1px solid ${T.border}`,background:rowBg,minWidth:180}}>
                              <div style={{fontFamily:T.sans,fontSize:11,color:T.text,fontWeight:500}}>{line.description}</div>
                              <div style={{fontFamily:T.mono,fontSize:9,color:T.textSm,marginTop:1}}>{CAT_LABELS[line.category]||line.category}</div>
                            </td>
                            {q.months.map(mk=>{
                              const d=MONTH_SEED[line.id]?.[mk]||[0,0,0];
                              const locked=isPast(mk);
                              const fOver=d[0]&&d[2]>d[0];
                              return [
                                <td key={`${mk}-b`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,
                                  fontSize:10,color:T.navy,background:"#F2F8FF",borderBottom:`1px solid ${T.border}`,minWidth:52}}>
                                  {d[0]?fmtGbp(d[0],true):<span style={{color:T.border}}>—</span>}
                                </td>,
                                <td key={`${mk}-a`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,
                                  fontSize:10,color:T.violet,background:"#F9F7FF",borderBottom:`1px solid ${T.border}`,minWidth:52}}>
                                  {locked&&d[1]?fmtGbp(d[1],true):<span style={{color:T.border}}>—</span>}
                                </td>,
                                <td key={`${mk}-f`} style={{padding:"4px 6px",textAlign:"right",fontFamily:T.mono,
                                  fontSize:10,fontWeight:fOver?600:400,
                                  color:fOver?T.red:T.green,
                                  background:fOver?"#FDF5F4":"#F3FAF6",
                                  borderRight:`1px solid ${T.border}`,
                                  borderBottom:`1px solid ${T.border}`,minWidth:52}}>
                                  {d[2]?fmtGbp(d[2],true):<span style={{color:T.border}}>—</span>}
                                </td>,
                              ];
                            })}
                            <td style={{position:"sticky",right:0,zIndex:10,padding:"4px 10px",textAlign:"right",
                              fontFamily:T.mono,fontSize:10,fontWeight:600,
                              color:isOver?T.red:lineFct>0?T.green:T.textSm,
                              background:rowBg,borderLeft:`1px solid ${T.border}`,borderBottom:`1px solid ${T.border}`}}>
                              {lineFct?fmtGbp(lineFct,true):"—"}
                            </td>
                          </tr>
                        );
                      }),

                      // Q Totals
                      <tr key={`${q.label}-tot`} style={{background:"#F0F0ED",borderBottom:`2px solid ${T.borderMd}`}}>
                        <td style={{position:"sticky",left:0,zIndex:10,padding:"5px 10px 5px 20px",
                          borderRight:`1px solid ${T.borderMd}`,background:"#F0F0ED",
                          fontFamily:T.mono,fontSize:9,fontWeight:600,color:T.textSm,letterSpacing:"0.08em",textTransform:"uppercase"}}>
                          Q Total
                        </td>
                        {q.months.flatMap(mk=>{
                          const t=MT[mk];
                          const over=t.b&&t.f>t.b;
                          return [
                            <td key={`${mk}-tb`} style={{padding:"5px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:T.navy,background:"#E8F0F8"}}>{t.b?fmtGbp(t.b,true):"—"}</td>,
                            <td key={`${mk}-ta`} style={{padding:"5px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.violet,background:"#F0EEFF"}}>{isPast(mk)&&t.a?fmtGbp(t.a,true):"—"}</td>,
                            <td key={`${mk}-tf`} style={{padding:"5px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:over?T.red:T.green,background:over?"#FBF0EE":"#EAF5EE",borderRight:`1px solid ${T.border}`}}>{t.f?fmtGbp(t.f,true):"—"}</td>,
                          ];
                        })}
                        <td style={{position:"sticky",right:0,zIndex:10,padding:"5px 10px",textAlign:"right",
                          fontFamily:T.mono,fontSize:11,fontWeight:700,color:T.text,
                          background:"#F0F0ED",borderLeft:`1px solid ${T.borderMd}`}}>
                          {fmtGbp(q.months.reduce((s,mk)=>s+(MT[mk]?.f||0),0),true)}
                        </td>
                      </tr>,

                      // Movement
                      <tr key={`${q.label}-mv`} style={{background:"#FDFAF2",borderBottom:`1px solid #E8E0C0`}}>
                        <td style={{position:"sticky",left:0,zIndex:10,padding:"4px 10px 4px 20px",
                          borderRight:`1px solid #E8E0C0`,background:"#FDFAF2",
                          fontFamily:T.mono,fontSize:8,fontWeight:600,color:T.amber,letterSpacing:"0.1em",textTransform:"uppercase"}}>
                          Δ Forecast Movement
                        </td>
                        {q.months.flatMap(mk=>{
                          const mv=fcastMv[mk];
                          return [
                            <td key={`${mk}-m1`} style={{background:"#FDFAF2",borderBottom:`1px solid #F0E8C0`}}/>,
                            <td key={`${mk}-m2`} style={{background:"#FDFAF2",borderBottom:`1px solid #F0E8C0`}}/>,
                            <td key={`${mk}-m3`} style={{padding:"4px 6px",textAlign:"right",
                              background:"#FDFAF2",borderRight:`1px solid #E8E0C0`,borderBottom:`1px solid #F0E8C0`}}>
                              {mv&&mv!==0?(
                                <span style={{fontFamily:T.mono,fontSize:9,fontWeight:600,
                                  color:mv>0?T.red:T.green}}>
                                  {mv>0?"▲":"▼"} {fmtGbp(Math.abs(mv),true)}
                                </span>
                              ):<span style={{color:T.border,fontFamily:T.mono,fontSize:9}}>—</span>}
                            </td>,
                          ];
                        })}
                        <td style={{position:"sticky",right:0,zIndex:10,background:"#FDFAF2",borderLeft:`1px solid #E8E0C0`}}/>
                      </tr>,
                    ]),
                  ];
                })

              // Quarterly view
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
                      <td style={{position:"sticky",left:0,zIndex:10,padding:"10px 10px",
                        background:rowBg,minWidth:180,borderRight:`1px solid ${T.border}`}}>
                        <div style={{display:"flex",alignItems:"center",gap:6}}>
                          <span style={{fontFamily:T.mono,fontSize:10,fontWeight:600,letterSpacing:"0.08em",textTransform:"uppercase",color:T.text}}>{q.label}</span>
                          {sig&&<StatusDot severity={sig.severity}/>}
                        </div>
                        {sig&&<div style={{fontFamily:T.sans,fontSize:9,color:sig.severity==="critical"?T.red:T.amber,marginTop:3}}>{sig.message}</div>}
                      </td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,fontWeight:500,color:T.navy}}>{fmtGbp(qB,true)}</td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,color:T.violet,background:T.violetLt}}>{qA?fmtGbp(qA,true):"—"}</td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,fontWeight:600,color:over?T.red:T.green,background:over?T.redLt:T.greenLt}}>{fmtGbp(qF,true)}</td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,fontWeight:500,color:over?T.red:T.green}}>{qB?`${over?"+":""}${fmtGbp(qV,true)}`:"—"}</td>
                      <td style={{padding:"10px 8px",textAlign:"right",fontFamily:T.mono,fontSize:11,
                        color:(qU||0)>100?T.red:(qU||0)>85?T.amber:T.textMd,
                        borderRight:`1px solid ${T.border}`}}>
                        {qU!==null?`${qU}%`:"—"}
                      </td>
                      <td style={{position:"sticky",right:0,zIndex:10,padding:"10px 10px",textAlign:"right",
                        fontFamily:T.mono,fontSize:12,fontWeight:700,color:T.text,
                        background:rowBg,borderLeft:`1px solid ${T.border}`}}>
                        {fmtGbp(qF,true)}
                      </td>
                    </tr>
                  );
                })
            }
          </tbody>

          <tfoot style={{position:"sticky",bottom:0,zIndex:20}}>
            <tr style={{background:"#EAEAE7",borderTop:`2px solid ${T.borderMd}`}}>
              <td style={{position:"sticky",left:0,zIndex:30,padding:"8px 10px",
                background:"#EAEAE7",borderRight:`1px solid ${T.borderMd}`,
                fontFamily:T.mono,fontSize:9,fontWeight:600,letterSpacing:"0.1em",
                textTransform:"uppercase",color:T.textMd}}>
                Grand Total
              </td>
              {viewMode==="monthly"
                ? MONTHS.flatMap(mk=>{
                    const t=MT[mk];
                    const over=t.b&&t.f>t.b;
                    return [
                      <td key={`ft-${mk}-b`} style={{padding:"7px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:T.navy,background:"#E8F0F8"}}>{t.b?fmtGbp(t.b,true):"—"}</td>,
                      <td key={`ft-${mk}-a`} style={{padding:"7px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.violet,background:"#F0EEFF"}}>{isPast(mk)&&t.a?fmtGbp(t.a,true):"—"}</td>,
                      <td key={`ft-${mk}-f`} style={{padding:"7px 6px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:over?T.red:T.green,background:over?"#FAF0EE":"#E8F5EE",borderRight:`1px solid ${T.border}`}}>{t.f?fmtGbp(t.f,true):"—"}</td>,
                    ];
                  })
                : QUARTERS.flatMap(q=>{
                    const qB=q.months.reduce((s,mk)=>s+(MT[mk]?.b||0),0);
                    const qA=q.months.reduce((s,mk)=>s+(MT[mk]?.a||0),0);
                    const qF=q.months.reduce((s,mk)=>s+(MT[mk]?.f||0),0);
                    const qV=qB?qF-qB:0;
                    const qU=qB?Math.round((qF/qB)*100):null;
                    return [
                      <td key={`${q.label}-b`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:600,color:T.navy,background:"#E8F0F8"}}>{fmtGbp(qB,true)}</td>,
                      <td key={`${q.label}-a`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.violet,background:"#F0EEFF"}}>{fmtGbp(qA,true)}</td>,
                      <td key={`${q.label}-f`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,fontWeight:700,color:qF>qB?T.red:T.green,background:qF>qB?"#FAF0EE":"#E8F5EE"}}>{fmtGbp(qF,true)}</td>,
                      <td key={`${q.label}-v`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.amber}}>{qB?fmtGbp(qV,true):"—"}</td>,
                      <td key={`${q.label}-u`} style={{padding:"7px 8px",textAlign:"right",fontFamily:T.mono,fontSize:10,color:T.textMd,borderRight:`1px solid ${T.border}`}}>{qU!==null?`${qU}%`:"—"}</td>,
                    ];
                  })
              }
              <td style={{position:"sticky",right:0,zIndex:30,padding:"8px 10px",textAlign:"right",
                fontFamily:T.mono,fontSize:13,fontWeight:700,color:T.green,
                background:"#EAEAE7",borderLeft:`1px solid ${T.borderMd}`}}>
                {fmtGbp(grandTotal,true)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Forecast movement strip */}
      {viewMode==="monthly"&&(
        <div style={{border:`1px solid #E0D8B0`,background:"#FDFAF2",padding:"10px 14px"}}>
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
                <div key={mk} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",
                  background:up?T.redLt:T.greenLt,
                  border:`1px solid ${up?"#F0B0AA":"#A0D0B8"}`,
                  fontFamily:T.mono,fontSize:10,color:up?T.red:T.green}}>
                  <span style={{color:T.textSm,fontWeight:400}}>{MS[Number(m)-1]} {y.slice(2)}</span>
                  <span style={{fontWeight:600}}>{up?"▲":"▼"} {fmtGbp(Math.abs(mv),true)}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Tab: Change Exposure ───────────────────────────────────────────────── */
function ChangeExposureTab() {
  const [changes, setChanges] = useState(CHANGES);
  const approved = changes.filter(c=>c.status==="approved").reduce((s,c)=>s+(c.cost_impact||0),0);
  const pending  = changes.filter(c=>c.status==="pending").reduce((s,c)=>s+(c.cost_impact||0),0);
  const update = (id,k,v) => setChanges(prev=>prev.map(c=>c.id===id?{...c,[k]:v}:c));

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:1,background:T.border}}>
        <StatCard label="Approved Exposure" value={fmtGbp(approved,true)} color={T.navy} sub="formally approved changes" />
        <StatCard label="Pending Exposure"  value={fmtGbp(pending,true)}  color={pending>0?T.amber:T.textSm} sub="awaiting decision" />
        <StatCard label="Total Exposure"    value={fmtGbp(approved+pending,true)} color={T.text} sub="combined impact" />
      </div>

      <div style={{border:`1px solid ${T.border}`,overflow:"hidden"}}>
        <div style={{background:"#F5F5F2",borderBottom:`1px solid ${T.borderMd}`,padding:"6px 10px"}}>
          <Label>Change Exposure Log</Label>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse"}}>
          <thead>
            <tr>
              <TH>Ref</TH><TH>Title</TH><TH right>Cost Impact</TH>
              <TH>Status</TH><TH>Notes</TH><TH></TH>
            </tr>
          </thead>
          <tbody>
            {changes.length===0&&(
              <tr><td colSpan={6} style={{padding:"24px",textAlign:"center",fontFamily:T.mono,fontSize:10,color:T.textSm}}>
                No change exposure logged.
              </td></tr>
            )}
            {changes.map((c,i)=>{
              const statusColors = {approved:{bg:T.greenLt,color:T.green},pending:{bg:T.amberLt,color:T.amber},rejected:{bg:"#F5F5F2",color:T.textSm}};
              const sc = statusColors[c.status]||statusColors.pending;
              return (
                <DataRow key={c.id} odd={i%2===1}>
                  <TD mono sm><InlineInput value={c.change_ref} onChange={v=>update(c.id,"change_ref",v)} placeholder="CR-001" mono /></TD>
                  <TD><InlineInput value={c.title} onChange={v=>update(c.id,"title",v)} placeholder="Change title…" /></TD>
                  <TD right mono><NumInput value={c.cost_impact} onChange={v=>update(c.id,"cost_impact",v)} /></TD>
                  <TD>
                    <PSelect value={c.status} onChange={v=>update(c.id,"status",v)} small
                      options={["approved","pending","rejected"].map(s=>({value:s,label:s.charAt(0).toUpperCase()+s.slice(1)}))} />
                  </TD>
                  <TD muted><InlineInput value={c.notes} onChange={v=>update(c.id,"notes",v)} placeholder="Notes…" /></TD>
                  <TD><Btn variant="danger" small onClick={()=>setChanges(prev=>prev.filter(x=>x.id!==c.id))}>✕</Btn></TD>
                </DataRow>
              );
            })}
          </tbody>
        </table>
        <div style={{padding:"8px 10px",background:"#F5F5F2",borderTop:`1px solid ${T.border}`}}>
          <Btn onClick={()=>setChanges(prev=>[...prev,{id:"c"+Date.now(),change_ref:"",title:"",cost_impact:"",status:"pending",notes:""}])}>
            + Add change
          </Btn>
        </div>
      </div>
    </div>
  );
}

/* ─── Tab: Narrative ─────────────────────────────────────────────────────── */
function NarrativeTab() {
  const [v1, setV1] = useState("Engineering costs are running slightly above budget in Q1 due to AWS cost spike in May. Infrastructure overspend driven by additional capacity provisioned for the load test environment, which will be decommissioned post-go-live. Overall forecast remains within 6% of approved budget.");
  const [v2, setV2] = useState("Rates based on approved rate card (Feb 2025 revision). Headcount plan assumes no attrition. AWS costs modelled at current reserved instance pricing. FX rate: 1.00 GBP = 1.00 GBP (sterling-only project).");
  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {[
        {label:"Variance Narrative", val:v1, set:setV1, placeholder:"Explain material variances between budget and forecast…"},
        {label:"Assumptions & Constraints", val:v2, set:setV2, placeholder:"Key assumptions: rates, headcount, duration, FX basis…"},
      ].map(({label,val,set,placeholder})=>(
        <div key={label}>
          <div style={{marginBottom:6}}>
            <Label>{label}</Label>
          </div>
          <textarea
            value={val} onChange={e=>set(e.target.value)} rows={5} placeholder={placeholder}
            style={{width:"100%",border:`1px solid ${T.border}`,background:T.surface,
              fontFamily:T.sans,fontSize:12,color:T.text,lineHeight:1.7,
              padding:"10px 12px",outline:"none",resize:"vertical",borderRadius:0,
              boxSizing:"border-box",
            }}
            onFocus={e=>e.target.style.borderColor=T.navy}
            onBlur={e=>e.target.style.borderColor=T.border}
          />
        </div>
      ))}
    </div>
  );
}

/* ─── Signals panel ──────────────────────────────────────────────────────── */
function SignalsPanel() {
  return (
    <div style={{border:`1px solid ${T.border}`,overflow:"hidden",marginBottom:16}}>
      <div style={{background:"#F5F5F2",borderBottom:`1px solid ${T.borderMd}`,padding:"6px 10px",
        display:"flex",alignItems:"center",gap:10}}>
        <Label>Intelligence Signals</Label>
        <span style={{marginLeft:"auto",fontFamily:T.mono,fontSize:9,color:T.textSm}}>
          {SIGNALS.length} active
        </span>
      </div>
      {SIGNALS.map((s,i)=>(
        <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,padding:"8px 12px",
          borderBottom: i<SIGNALS.length-1 ? `1px solid ${T.border}` : "none",
          background:s.severity==="critical"?T.redLt:s.severity==="warning"?T.amberLt:T.greenLt}}>
          <StatusDot severity={s.severity}/>
          <div>
            <div style={{fontFamily:T.mono,fontSize:9,fontWeight:600,color:T.textMd,letterSpacing:"0.06em",textTransform:"uppercase",marginBottom:2}}>
              {s.scopeKey}
            </div>
            <div style={{fontFamily:T.sans,fontSize:11,color:T.text}}>{s.message}</div>
          </div>
          <span style={{marginLeft:"auto"}}>
            <Pill color={s.severity==="critical"?"red":s.severity==="warning"?"amber":"green"}>
              {s.severity.toUpperCase()}
            </Pill>
          </span>
        </div>
      ))}
    </div>
  );
}

/* ─── Root ───────────────────────────────────────────────────────────────── */
export default function FinancialPlanPalantir() {
  const [tab, setTab] = useState("budget");

  const TABS = [
    {id:"budget",    label:"Cost Breakdown"},
    {id:"resources", label:`Resources (${RESOURCES.length})`},
    {id:"monthly",   label:"Monthly Phasing", badge:1},
    {id:"changes",   label:`Change Exposure (${CHANGES.length})`},
    {id:"narrative", label:"Narrative"},
  ];

  return (
    <>
      <style>{GLOBAL_STYLE}</style>
      <div style={{minHeight:"100vh",background:T.bg,fontFamily:T.sans,padding:"0 0 60px"}}>

        {/* Top bar */}
        <div style={{background:T.navy,padding:"10px 24px",
          display:"flex",alignItems:"center",gap:16,borderBottom:`2px solid #0D2540`}}>
          <div>
            <div style={{fontFamily:T.mono,fontSize:8,color:"#7A9EC0",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:2}}>
              Λ L I Ξ N Λ · Project Financial Plan
            </div>
            <div style={{fontFamily:T.mono,fontSize:14,fontWeight:500,color:"#FFFFFF",letterSpacing:"0.02em"}}>
              Digital Transformation Initiative · FY 2025/26
            </div>
          </div>
          <div style={{marginLeft:"auto",display:"flex",gap:12,alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,
              padding:"4px 12px",border:`1px solid #3A6080`,background:"rgba(255,255,255,0.06)"}}>
              <span style={{width:6,height:6,borderRadius:"50%",background:"#5AA878"}}/>
              <span style={{fontFamily:T.mono,fontSize:9,color:"#90B8CC",letterSpacing:"0.08em"}}>GBP · £630,000 APPROVED</span>
            </div>
            <span style={{fontFamily:T.mono,fontSize:9,color:"#607080",letterSpacing:"0.06em"}}>
              Apr 2025 — Mar 2026
            </span>
          </div>
        </div>

        <div style={{padding:"20px 24px",maxWidth:1400,margin:"0 auto"}}>

          {/* Header row: currency + budget */}
          <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20,flexWrap:"wrap"}}>
            <div>
              <div style={{marginBottom:4}}><Label>Currency</Label></div>
              <PSelect value="GBP" onChange={()=>{}}
                options={["GBP","USD","EUR","AUD","CAD"].map(c=>({value:c,label:c}))} />
            </div>
            <div>
              <div style={{marginBottom:4}}><Label>Total Approved Budget</Label></div>
              <div style={{display:"flex",alignItems:"center",gap:0,border:`1px solid ${T.border}`,background:T.surface}}>
                <span style={{padding:"5px 8px",fontFamily:T.mono,fontSize:11,color:T.textSm,
                  borderRight:`1px solid ${T.border}`}}>£</span>
                <input type="number" defaultValue={630000} style={{border:"none",background:"transparent",
                  fontFamily:T.mono,fontSize:11,fontWeight:500,color:T.navy,
                  padding:"5px 10px",width:130,outline:"none"}}/>
              </div>
            </div>
            <div style={{flex:1}}>
              <div style={{marginBottom:4}}><Label>Plan Summary</Label></div>
              <input type="text" defaultValue="Core engineering, design, and infrastructure costs for the DT platform build. FY25/26 run-rate model."
                style={{border:`1px solid ${T.border}`,background:T.surface,fontFamily:T.sans,fontSize:11,
                  color:T.text,padding:"5px 10px",width:"100%",outline:"none",borderRadius:0}}/>
            </div>
          </div>

          {/* Signals (shown on monthly tab) */}
          {tab==="monthly"&&<SignalsPanel/>}

          {/* Tabs */}
          <div style={{display:"flex",borderBottom:`2px solid ${T.borderMd}`,marginBottom:20,gap:0,overflowX:"auto"}}>
            {TABS.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)}
                style={{padding:"9px 18px",fontFamily:T.mono,fontSize:10,fontWeight:500,
                  letterSpacing:"0.08em",textTransform:"uppercase",cursor:"pointer",
                  border:"none",borderBottom: tab===t.id ? `2px solid ${T.navy}` : "2px solid transparent",
                  marginBottom:-2,background:"transparent",
                  color: tab===t.id ? T.navy : T.textSm,
                  display:"flex",alignItems:"center",gap:6,
                  transition:"color 0.1s",
                }}>
                {t.label}
                {t.badge&&(
                  <span style={{display:"inline-flex",alignItems:"center",justifyContent:"center",
                    width:14,height:14,borderRadius:"50%",
                    background:T.amber,color:"#FFF",
                    fontFamily:T.mono,fontSize:8,fontWeight:700}}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab==="budget"    && <CostBreakdownTab/>}
          {tab==="resources" && <ResourcesTab/>}
          {tab==="monthly"   && <MonthlyPhasingTab/>}
          {tab==="changes"   && <ChangeExposureTab/>}
          {tab==="narrative" && <NarrativeTab/>}
        </div>
      </div>
    </>
  );
}