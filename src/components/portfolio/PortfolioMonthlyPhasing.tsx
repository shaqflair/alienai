"use client";
// src/components/portfolio/PortfolioMonthlyPhasing.tsx
import { useOrgFy } from "@/hooks/useOrgFy";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TrendingUp, TrendingDown, Download, RefreshCw, Archive, Search, X, ChevronDown, Users, Building2 } from "lucide-react";

const P = {
  bg: "#F7F7F5", surface: "#FFFFFF", border: "#E3E3DF", borderMd: "#C8C8C4",
  text: "#0D0D0B", textMd: "#4A4A46", textSm: "#8A8A84",
  navy: "#1B3652", navyLt: "#EBF0F5",
  red: "#B83A2E", redLt: "#FDF2F1",
  green: "#2A6E47", greenLt: "#F0F7F3",
  amber: "#8A5B1A", amberLt: "#FDF6EC",
  violet: "#4A3A7A", violetLt: "#F4F2FB",
  mono: "'DM Mono', 'Courier New', monospace",
  sans: "'DM Sans', system-ui, sans-serif",
} as const;

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FY_START_OPTIONS = [{ value:4, label:"Apr \u2013 Mar (UK)" },{ value:1, label:"Jan \u2013 Dec" },{ value:7, label:"Jul \u2013 Jun" },{ value:10, label:"Oct \u2013 Sep" }];
const DURATION_OPTIONS = [{ value:12, label:"12 months" },{ value:18, label:"18 months" },{ value:24, label:"24 months" },{ value:36, label:"36 months" }];

type MonthKey    = string;
type MonthlyEntry= { budget: number|""; actual: number|""; forecast: number|""; locked: boolean };
type MonthlyData = Record<string, Record<MonthKey, MonthlyEntry>>;
type AggLine     = { id: string; category: string; description: string };
type ViewMode    = "full" | "bud_fct";
type FilterMode  = "pm" | "department";
type Project     = { id: string; title: string; projectCode: string; pmName: string; department: string };

interface PhasingResponse {
  ok: boolean; fyStart: number; fyYear: number; numMonths: number;
  monthKeys: MonthKey[]; aggregatedLines: AggLine[]; monthlyData: MonthlyData;
  projectCount: number; projectsWithPlan: number; filteredProjectCount: number;
  scope: string; allProjects: Project[]; error?: string;
}

const SYM = "\u00A3";
function fmt(n: number|""|null|undefined): string {
  if (n===""||n==null||isNaN(Number(n))) return "--";
  const v=Number(n), sign=v<0?"-":"", abs=Math.abs(v);
  if (abs>=1_000_000) return `${sign}${SYM}${(abs/1_000_000).toFixed(1)}M`;
  if (abs>=1000) return `${sign}${SYM}${abs.toLocaleString("en-GB",{maximumFractionDigits:0})}`;
  return `${sign}${SYM}${abs}`;
}
function fmtK(n: number|""|null|undefined): string {
  if (n===""||n==null||isNaN(Number(n))) return "--";
  const v=Number(n); if(v===0) return "--";
  const sign=v<0?"-":"", abs=Math.abs(v);
  if (abs>=1_000_000) return `${sign}${SYM}${(abs/1_000_000).toFixed(1)}M`;
  return `${sign}${SYM}${(abs/1000).toFixed(1)}k`;
}
function buildQuarters(keys: MonthKey[], fyStart: number) {
  const qs: { label: string; months: MonthKey[] }[] = [];
  for (let i=0; i<keys.length; i+=3) {
    const slice=keys.slice(i,i+3); if(!slice.length) break;
    const [y,m]=slice[0].split("-").map(Number), fyY=m>=fyStart?y:y-1;
    const qNum = Math.floor(i/3)+1; const qLabel = qNum<=4?`Q${qNum}`:`Q${((qNum-1)%4)+1}`; qs.push({ label:`${qLabel} FY${fyY}/${String(fyY+1).slice(2)}`, months:slice });
  }
  return qs;
}
function currentMonthKey() { const n=new Date(); return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,"0")}`; }
function isCurrentMonth(mk: MonthKey) { return mk===currentMonthKey(); }
function isPastMonth(mk: MonthKey)    { return mk<currentMonthKey(); }
function sumLines(lines: AggLine[], md: MonthlyData, months: MonthKey[], field: "budget"|"actual"|"forecast"): number {
  return lines.reduce((s,l)=>s+months.reduce((ms,mk)=>ms+(Number(md[l.id]?.[mk]?.[field])||0),0),0);
}
function fyYearOptions(fyStart: number): number[] {
  const now=new Date(), cur=now.getMonth()+1>=fyStart?now.getFullYear():now.getFullYear()-1;
  return [cur+1,cur,cur-1,cur-2];
}
function fyLabel(fyYear: number, fyStart: number) { return fyStart===1?String(fyYear):`${fyYear}/${String(fyYear+1).slice(2)}`; }

const thBase: React.CSSProperties = { padding:"3px 4px", textAlign:"right", fontFamily:P.mono, fontSize:8, fontWeight:500, letterSpacing:"0.08em", textTransform:"uppercase", borderBottom:`1px solid ${P.borderMd}` };
const selStyle: React.CSSProperties = { border:`1px solid ${P.border}`, background:P.surface, fontFamily:P.mono, fontSize:10, color:P.text, padding:"5px 8px", outline:"none", cursor:"pointer" };

/* ── Project Filter Panel ── */
function ProjectFilterPanel({ projects, selected, onChange }: {
  projects: Project[]; selected: Set<string>; onChange: (s: Set<string>) => void;
}) {
  const [search,     setSearch]     = useState("");
  const [open,       setOpen]       = useState(false);
  const [filterMode, setFilterMode] = useState<FilterMode>("pm");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const q = search.trim().toLowerCase();
  const filtered = projects.filter(p =>
    !q || p.title.toLowerCase().includes(q) || p.projectCode.toLowerCase().includes(q) ||
    p.pmName.toLowerCase().includes(q) || p.department.toLowerCase().includes(q)
  );

  const allSelected = selected.size === 0 || selected.size === projects.length;
  const label = allSelected ? `All projects (${projects.length})` : `${selected.size} of ${projects.length} selected`;

  function toggleAll() { onChange(new Set()); }
  function toggle(id: string) {
    const next = new Set(selected.size === 0 ? projects.map(p => p.id) : selected);
    next.has(id) ? next.delete(id) : next.add(id);
    if (next.size === projects.length) onChange(new Set()); else onChange(next);
  }

  // Group by PM or department
  const groups = useMemo(() => {
    const map = new Map<string, Project[]>();
    for (const p of filtered) {
      const key = filterMode === "pm"
        ? (p.pmName || "No PM assigned")
        : (p.department || "No department");
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(p);
    }
    return [...map.entries()].sort((a,b) => a[0].localeCompare(b[0]));
  }, [filtered, filterMode]);

  return (
    <div ref={ref} style={{ position:"relative" }}>
      <button onClick={() => setOpen(v => !v)}
        style={{ display:"flex", alignItems:"center", gap:6, padding:"5px 10px", border:`1px solid ${P.border}`, background:!allSelected?P.navyLt:P.bg, color:!allSelected?P.navy:P.textMd, fontFamily:P.mono, fontSize:9, letterSpacing:"0.06em", textTransform:"uppercase", cursor:"pointer", whiteSpace:"nowrap" }}>
        <Users size={11}/>{label}
        <ChevronDown size={10} style={{ transform:open?"rotate(180deg)":"none", transition:"transform 0.15s" }}/>
      </button>

      {open && (
        <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, zIndex:100, background:P.surface, border:`1px solid ${P.borderMd}`, boxShadow:"0 4px 16px rgba(0,0,0,0.12)", width:340, maxHeight:440, display:"flex", flexDirection:"column" }}>
          {/* Search */}
          <div style={{ padding:"8px 10px", borderBottom:`1px solid ${P.border}`, display:"flex", alignItems:"center", gap:6 }}>
            <Search size={12} color={P.textSm}/>
            <input autoFocus value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Search name, code, PM or department\u2026"
              style={{ flex:1, border:"none", outline:"none", fontFamily:P.mono, fontSize:10, color:P.text, background:"transparent" }}/>
            {search && <button onClick={()=>setSearch("")} style={{ border:"none", background:"none", cursor:"pointer", padding:0, color:P.textSm }}><X size={11}/></button>}
          </div>

          {/* Group by toggle */}
          <div style={{ padding:"6px 10px", borderBottom:`1px solid ${P.border}`, display:"flex", alignItems:"center", gap:6 }}>
            <span style={{ fontFamily:P.mono, fontSize:8, color:P.textSm, letterSpacing:"0.08em", textTransform:"uppercase" }}>Group by:</span>
            <div style={{ display:"flex", border:`1px solid ${P.border}` }}>
              {(["pm","department"] as FilterMode[]).map(m=>(
                <button key={m} onClick={()=>setFilterMode(m)} style={{ padding:"3px 10px", fontFamily:P.mono, fontSize:9, cursor:"pointer", background:filterMode===m?P.navy:P.bg, color:filterMode===m?"#FFF":P.textMd, border:"none", display:"flex", alignItems:"center", gap:4 }}>
                  {m==="pm"?<Users size={9}/>:<Building2 size={9}/>}
                  {m==="pm"?"PM":"Dept"}
                </button>
              ))}
            </div>
          </div>

          {/* All projects toggle */}
          <div style={{ padding:"6px 10px", borderBottom:`1px solid ${P.border}` }}>
            <label style={{ display:"flex", alignItems:"center", gap:8, cursor:"pointer", fontFamily:P.mono, fontSize:9, fontWeight:700, letterSpacing:"0.08em", textTransform:"uppercase", color:P.navy }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll} style={{ accentColor:P.navy }}/>
              All projects
            </label>
          </div>

          {/* Grouped list */}
          <div style={{ overflowY:"auto", flex:1 }}>
            {groups.map(([group, projs]) => (
              <div key={group}>
                <div style={{ padding:"5px 10px 3px", fontFamily:P.mono, fontSize:8, fontWeight:700, letterSpacing:"0.1em", textTransform:"uppercase", color:P.textSm, background:"#F5F5F2", borderBottom:`1px solid ${P.border}` }}>
                  {filterMode==="department"&&<Building2 size={8} style={{ marginRight:4, display:"inline" }}/>}
                  {group}
                </div>
                {projs.map(p => {
                  const isChecked = allSelected || selected.has(p.id);
                  return (
                    <label key={p.id} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 10px 6px 16px", cursor:"pointer", borderBottom:`1px solid ${P.border}`, background:isChecked?"#FAFAF8":P.surface }}>
                      <input type="checkbox" checked={isChecked} onChange={()=>toggle(p.id)} style={{ accentColor:P.navy, flexShrink:0 }}/>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontFamily:P.sans, fontSize:11, fontWeight:500, color:P.text, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.title}</div>
                        <div style={{ display:"flex", gap:8, marginTop:1 }}>
                          {p.projectCode&&<span style={{ fontFamily:P.mono, fontSize:9, color:P.textSm }}>{p.projectCode}</span>}
                          {filterMode==="pm"&&p.department&&<span style={{ fontFamily:P.mono, fontSize:9, color:P.textSm }}>{p.department}</span>}
                          {filterMode==="department"&&p.pmName&&<span style={{ fontFamily:P.mono, fontSize:9, color:P.textSm }}>PM: {p.pmName}</span>}
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            ))}
            {filtered.length===0&&<div style={{ padding:"20px 10px", textAlign:"center", fontFamily:P.mono, fontSize:10, color:P.textSm }}>No projects match</div>}
          </div>

          {/* Footer */}
          {!allSelected&&(
            <div style={{ padding:"6px 10px", borderTop:`1px solid ${P.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontFamily:P.mono, fontSize:9, color:P.textSm }}>{selected.size} selected</span>
              <button onClick={()=>onChange(new Set())} style={{ fontFamily:P.mono, fontSize:9, color:P.navy, background:"none", border:"none", cursor:"pointer", textDecoration:"underline" }}>Clear filter</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Main component ── */
export default function PortfolioMonthlyPhasing() {
  const orgFy = useOrgFy();
  const [fyStart,   setFyStart]   = useState(4);
  const [fyYear,    setFyYear]    = useState(() => { const now=new Date(); return now.getMonth()+1>=4?now.getFullYear():now.getFullYear()-1; });
  const [fyInitialised, setFyInitialised] = useState(false);
  // Once org FY loads, set defaults if user hasn't changed them
  useEffect(() => {
    if (!orgFy.loading && !fyInitialised) {
      setFyStart(orgFy.fyStartMonth);
      setFyYear(orgFy.fyYear);
      setFyInitialised(true);
    }
  }, [orgFy.loading, orgFy.fyStartMonth, orgFy.fyYear, fyInitialised]);
  const [numMonths, setNumMonths] = useState(12);
  const [scope,     setScope]     = useState<"active"|"all">("active");
  const [viewMode,  setViewMode]  = useState<ViewMode>("full");
  const [data,      setData]      = useState<PhasingResponse|null>(null);
  const [loading,   setLoading]   = useState(false);
  const [exporting, setExporting] = useState(false);
  const [activeQs,  setActiveQs]  = useState<Set<string>|null>(null);
  const [selectedProjects, setSelectedProjects] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const ids = selectedProjects.size>0?`&projectIds=${[...selectedProjects].join(",")}`:"";
      const r   = await fetch(`/api/portfolio/budget-phasing?fyStart=${fyStart}&fyYear=${fyYear}&fyMonths=${numMonths}&scope=${scope}${ids}`,{cache:"no-store"});
      const j   = await r.json();
      setData(j); setActiveQs(null);
    } catch (e: any) {
      setData({ok:false,error:e.message,fyStart,fyYear,numMonths,monthKeys:[],aggregatedLines:[],monthlyData:{},projectCount:0,projectsWithPlan:0,filteredProjectCount:0,scope,allProjects:[]});
    } finally { setLoading(false); }
  }, [fyStart,fyYear,numMonths,scope,selectedProjects]);

  useEffect(()=>{load();},[load]);

  const monthKeys     = data?.monthKeys??[];
  const lines         = data?.aggregatedLines??[];
  const md            = data?.monthlyData??{};
  const allProjects   = data?.allProjects??[];
  const quarters      = useMemo(()=>buildQuarters(monthKeys,fyStart),[monthKeys,fyStart]);
  const visibleMonths = useMemo(()=>{
    if(!activeQs||activeQs.size===0) return monthKeys;
    return quarters.filter(q=>activeQs.has(q.label)).flatMap(q=>q.months);
  },[activeQs,monthKeys,quarters]);
  const visibleQuarters = quarters.filter(q=>q.months.some(mk=>visibleMonths.includes(mk)));
  const colsPerMonth    = viewMode==="full"?3:2;

  const toggleQuarter = useCallback((label: string)=>{
    setActiveQs(prev=>{
      const current=prev??new Set(quarters.map(q=>q.label));
      const next=new Set(current);
      if(next.has(label)){if(next.size===1)return null;next.delete(label);}else next.add(label);
      return next.size===quarters.length?null:next;
    });
  },[quarters]);

  const monthTotals = useMemo(()=>{
    const result: Record<MonthKey,{budget:number;actual:number;forecast:number}>={};
    for(const mk of monthKeys){
      result[mk]={budget:sumLines(lines,md,[mk],"budget"),actual:isPastMonth(mk)?sumLines(lines,md,[mk],"actual"):0,forecast:sumLines(lines,md,[mk],"forecast")};
    }
    return result;
  },[monthKeys,md,lines]);

  const grandForecast=visibleMonths.reduce((s,mk)=>s+(monthTotals[mk]?.forecast??0),0);
  const grandBudget  =visibleMonths.reduce((s,mk)=>s+(monthTotals[mk]?.budget??0),0);

  const handleExport = useCallback(async()=>{
    setExporting(true);
    try {
      const ids=selectedProjects.size>0?`&projectIds=${[...selectedProjects].join(",")}`:"";
      const r=await fetch(`/api/portfolio/budget-phasing/export?fyStart=${fyStart}&fyYear=${fyYear}&fyMonths=${numMonths}&scope=${scope}${ids}`);
      if(!r.ok) throw new Error("Export failed");
      const blob=await r.blob(),url=URL.createObjectURL(blob),a=document.createElement("a");
      a.href=url;a.download=`portfolio-phasing-fy${fyLabel(fyYear,fyStart).replace("/","-")}.xlsx`;a.click();URL.revokeObjectURL(url);
    } catch(e:any){alert("Export failed: "+e.message);}
    finally{setExporting(false);}
  },[fyStart,fyYear,numMonths,scope,selectedProjects]);

  const filterActive = selectedProjects.size>0;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:12,fontFamily:P.sans}}>

      {/* Toolbar */}
      <div style={{display:"flex",flexWrap:"wrap",alignItems:"center",justifyContent:"space-between",gap:8}}>
        <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
          <select value={fyStart} onChange={e=>setFyStart(Number(e.target.value))} style={selStyle}>
            {FY_START_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select value={fyYear} onChange={e=>setFyYear(Number(e.target.value))} style={selStyle}>
            {fyYearOptions(fyStart).map(y=><option key={y} value={y}>FY {fyLabel(y,fyStart)}</option>)}
          </select>
          <select value={numMonths} onChange={e=>setNumMonths(Number(e.target.value))} style={selStyle}>
            {DURATION_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <div style={{display:"flex",border:`1px solid ${P.border}`}}>
            {(["active","all"] as const).map(s=>(
              <button key={s} onClick={()=>setScope(s)} style={{padding:"5px 10px",fontFamily:P.mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",cursor:"pointer",background:scope===s?P.navy:P.bg,color:scope===s?"#FFF":P.textMd,border:"none",display:"flex",alignItems:"center",gap:4}}>
                {s==="all"&&<Archive size={10}/>}
                {s==="active"?"Active only":"Incl. closed"}
              </button>
            ))}
          </div>
          {allProjects.length>0&&<ProjectFilterPanel projects={allProjects} selected={selectedProjects} onChange={setSelectedProjects}/>}
          <button onClick={load} style={{display:"flex",alignItems:"center",gap:4,padding:"5px 10px",border:`1px solid ${P.border}`,background:P.bg,color:P.textMd,fontFamily:P.mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",cursor:"pointer"}}>
            <RefreshCw size={11} style={{animation:loading?"spin 1s linear infinite":"none"}}/>
          </button>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6}}>
          {data&&<span style={{fontFamily:P.mono,fontSize:9,color:filterActive?P.navy:P.textSm}}>{filterActive?`${data.filteredProjectCount} projects selected`:`${data.projectsWithPlan}/${data.projectCount} with plan`}</span>}
          <div style={{display:"flex",border:`1px solid ${P.border}`}}>
            {(["full","bud_fct"] as ViewMode[]).map(m=>(
              <button key={m} onClick={()=>setViewMode(m)} style={{padding:"5px 10px",fontFamily:P.mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",cursor:"pointer",background:viewMode===m?P.navy:P.bg,color:viewMode===m?"#FFF":P.textMd,border:"none"}}>
                {m==="full"?"Bud + Act + Fct":"Bud + Fct only"}
              </button>
            ))}
          </div>
          <button onClick={handleExport} disabled={exporting||!data?.ok} style={{display:"flex",alignItems:"center",gap:5,padding:"5px 12px",border:`1px solid ${P.border}`,background:P.navy,color:"#FFF",fontFamily:P.mono,fontSize:9,letterSpacing:"0.06em",textTransform:"uppercase",cursor:"pointer",opacity:exporting?0.7:1}}>
            <Download size={11}/>{exporting?"Exporting\u2026":"Export XLSX"}
          </button>
        </div>
      </div>

      {/* Filter chips */}
      {filterActive&&allProjects.length>0&&(
        <div style={{display:"flex",flexWrap:"wrap",gap:4,alignItems:"center"}}>
          <span style={{fontFamily:P.mono,fontSize:8,color:P.textSm,letterSpacing:"0.08em",textTransform:"uppercase"}}>Filtered:</span>
          {[...selectedProjects].slice(0,6).map(id=>{
            const p=allProjects.find(x=>x.id===id); if(!p) return null;
            return (
              <span key={id} style={{display:"flex",alignItems:"center",gap:4,padding:"2px 8px",background:P.navyLt,border:`1px solid ${P.navy}33`,borderRadius:2,fontFamily:P.mono,fontSize:9,color:P.navy}}>
                {p.projectCode||p.title.slice(0,12)}
                <button onClick={()=>{const next=new Set(selectedProjects.size===0?allProjects.map(x=>x.id):selectedProjects);next.delete(id);setSelectedProjects(next.size===allProjects.length?new Set():next);}} style={{border:"none",background:"none",cursor:"pointer",padding:0,color:P.navy,lineHeight:1}}>
                  <X size={9}/>
                </button>
              </span>
            );
          })}
          {selectedProjects.size>6&&<span style={{fontFamily:P.mono,fontSize:9,color:P.textSm}}>+{selectedProjects.size-6} more</span>}
          <button onClick={()=>setSelectedProjects(new Set())} style={{fontFamily:P.mono,fontSize:9,color:P.red,background:"none",border:"none",cursor:"pointer",textDecoration:"underline",marginLeft:4}}>Clear all</button>
        </div>
      )}

      {/* Quarter filter */}
      <div style={{display:"flex",flexWrap:"wrap",gap:6,alignItems:"center"}}>
        <span style={{fontFamily:P.mono,fontSize:9,color:P.textSm,letterSpacing:"0.08em",textTransform:"uppercase",marginRight:4}}>Quarter:</span>
        <button onClick={()=>setActiveQs(null)} style={{padding:"4px 12px",fontFamily:P.mono,fontSize:9,fontWeight:700,cursor:"pointer",border:"1px solid",borderColor:!activeQs?P.navy:P.border,background:!activeQs?P.navy:P.bg,color:!activeQs?"#FFF":P.textMd,borderRadius:3}}>All</button>
        {quarters.map(q=>{
          const isActive=!activeQs||activeQs.has(q.label);
          const qFct=sumLines(lines,md,q.months,"forecast"),qBud=sumLines(lines,md,q.months,"budget"),over=qBud>0&&qFct>qBud;
          return (
            <button key={q.label} onClick={()=>toggleQuarter(q.label)} style={{padding:"4px 12px",fontFamily:P.mono,fontSize:9,fontWeight:700,cursor:"pointer",border:"1px solid",borderRadius:3,borderColor:isActive?(over?P.amber:P.navy):P.border,background:isActive?(over?P.amberLt:P.navyLt):P.bg,color:isActive?(over?P.amber:P.navy):P.textSm,opacity:isActive?1:0.5}}>
              {q.label.split(" ")[0]} {q.label.split(" ")[1]}
              {qFct!==0&&<span style={{marginLeft:6,fontWeight:400,opacity:0.7}}>{fmtK(qFct)}</span>}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div style={{display:"flex",flexWrap:"wrap",gap:12,alignItems:"center"}}>
        {[{bg:"#EEF4F9",bc:"#A0BAD0",l:"Budget"},...(viewMode==="full"?[{bg:P.violetLt,bc:"#C0B0E0",l:"Actual (locked)"}]:[]),{bg:P.greenLt,bc:"#A0D0B8",l:"Forecast"},{bg:P.redLt,bc:"#F0B0AA",l:"Over budget"}].map(({bg,bc,l})=>(
          <span key={l} style={{display:"flex",alignItems:"center",gap:5,fontFamily:P.mono,fontSize:9,color:P.textSm,letterSpacing:"0.06em"}}>
            <span style={{width:10,height:10,background:bg,border:`1px solid ${bc}`,display:"inline-block",flexShrink:0}}/>{l.toUpperCase()}
          </span>
        ))}
        <span style={{display:"flex",alignItems:"center",gap:5,fontFamily:P.mono,fontSize:9,color:P.textSm,letterSpacing:"0.06em"}}>
          <span style={{width:6,height:6,borderRadius:"50%",background:P.navy,boxShadow:`0 0 0 2px ${P.navyLt}`,display:"inline-block",flexShrink:0}}/>CURRENT MONTH
        </span>
      </div>

      {/* States */}
      {loading&&<div style={{border:`1px solid ${P.borderMd}`,padding:48,textAlign:"center"}}><span style={{fontFamily:P.mono,fontSize:11,color:P.textSm}}>LOADING PORTFOLIO PHASING\u2026</span></div>}
      {!loading&&data&&!data.ok&&<div style={{border:`1px solid ${P.borderMd}`,borderLeft:`3px solid ${P.red}`,padding:"16px 20px",background:P.redLt}}><span style={{fontFamily:P.mono,fontSize:11,color:P.red}}>{data.error}</span></div>}
      {!loading&&data?.ok&&lines.length===0&&<div style={{border:`1px dashed ${P.amber}`,background:P.amberLt,padding:"48px 24px",textAlign:"center"}}><p style={{fontFamily:P.sans,fontSize:13,color:P.amber}}>No financial plan phasing data found for the selected projects and FY {fyLabel(fyYear,fyStart)}.</p></div>}

      {/* Table */}
      {!loading&&data?.ok&&lines.length>0&&(
        <div style={{border:`1px solid ${P.borderMd}`,maxHeight:"65vh",overflowY:"auto",overflowX:"auto"}}>
          <table style={{borderCollapse:"collapse",background:P.surface,minWidth:`${220+visibleMonths.length*(colsPerMonth===3?168:120)+100}px`}}>
            <thead style={{position:"sticky",top:0,zIndex:20}}>
              <tr style={{background:"#EFEFEC"}}>
                <th style={{position:"sticky",left:0,zIndex:30,background:"#EFEFEC",minWidth:220,padding:"7px 10px",textAlign:"left",borderRight:`1px solid ${P.borderMd}`,borderBottom:`1px solid ${P.border}`,fontFamily:P.mono,fontSize:8,color:P.textSm,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:500}}>Cost Category</th>
                {visibleQuarters.map(q=>{
                  const qm=q.months.filter(mk=>visibleMonths.includes(mk));
                  return <th key={q.label} colSpan={qm.length*colsPerMonth} style={{padding:"7px 10px",textAlign:"center",fontFamily:P.mono,fontSize:9,fontWeight:600,color:P.text,letterSpacing:"0.08em",textTransform:"uppercase",borderRight:`1px solid ${P.borderMd}`,borderBottom:`1px solid ${P.border}`,background:"#F2F2EF"}}>{q.label}</th>;
                })}
                <th style={{position:"sticky",right:0,zIndex:30,background:"#EFEFEC",minWidth:100,padding:"7px 10px",textAlign:"right",borderLeft:`1px solid ${P.borderMd}`,borderBottom:`1px solid ${P.border}`,fontFamily:P.mono,fontSize:8,color:P.textSm,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:500}}>Total FCT</th>
              </tr>
              <tr style={{background:"#F7F7F5"}}>
                <th style={{position:"sticky",left:0,zIndex:30,background:"#F7F7F5",padding:"4px 10px",borderRight:`1px solid ${P.borderMd}`,borderBottom:`1px solid ${P.border}`}}/>
                {visibleMonths.map(mk=>{
                  const month=Number(mk.split("-")[1]),year=Number(mk.split("-")[0]),isCur=isCurrentMonth(mk),isPast=isPastMonth(mk);
                  return (
                    <th key={mk} colSpan={colsPerMonth} style={{padding:"5px 4px",textAlign:"center",borderRight:`1px solid ${P.border}`,borderBottom:`1px solid ${P.border}`,background:isCur?"#E8F0F8":isPast?"#F9F9F7":"#F7F7F5",opacity:isPast&&!isCur?0.8:1}}>
                      <div style={{display:"flex",alignItems:"center",justifyContent:"center",gap:3}}>
                        {isCur&&<span style={{width:5,height:5,borderRadius:"50%",background:P.navy,boxShadow:`0 0 0 2px ${P.navyLt}`,display:"inline-block",flexShrink:0}}/>}
                        <span style={{fontFamily:P.mono,fontSize:10,fontWeight:isCur?600:400,color:isCur?P.navy:P.text}}>{MONTH_SHORT[month-1]}</span>
                        <span style={{fontFamily:P.mono,fontSize:9,color:P.textSm}}>{String(year).slice(2)}</span>
                      </div>
                    </th>
                  );
                })}
                <th style={{position:"sticky",right:0,zIndex:30,background:"#F7F7F5",padding:"4px 10px",borderLeft:`1px solid ${P.borderMd}`,borderBottom:`1px solid ${P.border}`}}/>
              </tr>
              <tr style={{background:"#F2F2EF"}}>
                <th style={{position:"sticky",left:0,zIndex:30,background:"#F2F2EF",padding:"3px 10px",borderRight:`1px solid ${P.borderMd}`,borderBottom:`1px solid ${P.borderMd}`}}/>
                {visibleMonths.flatMap(mk=>viewMode==="full"
                  ?[<th key={`${mk}-b`} style={{...thBase,background:"#EEF4F9",color:P.navy,minWidth:52}}>BUD</th>,<th key={`${mk}-a`} style={{...thBase,background:P.violetLt,color:P.violet,minWidth:52}}>ACT</th>,<th key={`${mk}-f`} style={{...thBase,background:"#F0F7F3",color:P.green,borderRight:`1px solid ${P.border}`,minWidth:52}}>FCT</th>]
                  :[<th key={`${mk}-b`} style={{...thBase,background:"#EEF4F9",color:P.navy,minWidth:58}}>BUD</th>,<th key={`${mk}-f`} style={{...thBase,background:"#F0F7F3",color:P.green,borderRight:`1px solid ${P.border}`,minWidth:58}}>FCT</th>]
                )}
                <th style={{...thBase,position:"sticky",right:0,zIndex:30,background:"#F0F7F3",color:P.green,borderLeft:`1px solid ${P.borderMd}`,textAlign:"right",padding:"3px 10px"}}>FCT</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line,li)=>{
                const lineFct=visibleMonths.reduce((s,mk)=>s+(Number(md[line.id]?.[mk]?.forecast)||0),0);
                const lineBud=visibleMonths.reduce((s,mk)=>s+(Number(md[line.id]?.[mk]?.budget)||0),0);
                const isOver=lineBud>0&&lineFct>lineBud,isNeg=lineFct<0,rowBg=li%2===0?P.surface:"#FAFAF8";
                const cell=(val:number|"",color:string)=>(
                  <div style={{padding:"5px 6px",textAlign:"right",fontFamily:P.mono,fontSize:10,color,fontVariantNumeric:"tabular-nums"}}>
                    {val!==""&&Number(val)!==0?fmtK(val):"--"}
                  </div>
                );
                return (
                  <tr key={line.id} style={{background:rowBg,borderBottom:`1px solid ${P.border}`}}>
                    <td style={{position:"sticky",left:0,zIndex:10,padding:"6px 10px 6px 16px",borderRight:`1px solid ${P.border}`,background:rowBg,minWidth:220}}>
                      <span style={{fontFamily:P.sans,fontSize:11,fontWeight:500,color:P.text,display:"block",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:180}}>{line.description}</span>
                    </td>
                    {visibleMonths.flatMap(mk=>{
                      const e=md[line.id]?.[mk]??{budget:"",actual:"",forecast:"",locked:false};
                      const fOver=e.budget&&Number(e.forecast)>Number(e.budget);
                      return viewMode==="full"
                        ?[<td key={`${mk}-b`} style={{borderBottom:`1px solid ${P.border}`,background:"#F2F8FF",minWidth:52}}>{cell(e.budget,P.navy)}</td>,<td key={`${mk}-a`} style={{borderBottom:`1px solid ${P.border}`,background:"#F9F7FF",minWidth:52}}>{cell(e.actual,P.violet)}</td>,<td key={`${mk}-f`} style={{borderBottom:`1px solid ${P.border}`,borderRight:`1px solid ${P.border}`,minWidth:52,background:fOver?"#FDF5F4":"#F3FAF6"}}>{cell(e.forecast,fOver?P.red:P.green)}</td>]
                        :[<td key={`${mk}-b`} style={{borderBottom:`1px solid ${P.border}`,background:"#F2F8FF",minWidth:58}}>{cell(e.budget,P.navy)}</td>,<td key={`${mk}-f`} style={{borderBottom:`1px solid ${P.border}`,borderRight:`1px solid ${P.border}`,minWidth:58,background:fOver?"#FDF5F4":"#F3FAF6"}}>{cell(e.forecast,fOver?P.red:P.green)}</td>];
                    })}
                    <td style={{position:"sticky",right:0,zIndex:10,padding:"5px 10px",textAlign:"right",fontFamily:P.mono,fontSize:10,fontWeight:700,color:isNeg?P.red:isOver?P.red:lineFct>0?P.green:P.textSm,background:rowBg,borderLeft:`1px solid ${P.border}`,borderBottom:`1px solid ${P.border}`,fontVariantNumeric:"tabular-nums"}}>
                      {lineFct!==0?fmtK(lineFct):"--"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot style={{position:"sticky",bottom:0,zIndex:20}}>
              <tr style={{background:"#EAEAE7",borderTop:`2px solid ${P.borderMd}`}}>
                <td style={{position:"sticky",left:0,zIndex:30,padding:"7px 10px",background:"#EAEAE7",borderRight:`1px solid ${P.borderMd}`,fontFamily:P.mono,fontSize:8,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:P.textMd}}>Portfolio Total</td>
                {visibleMonths.flatMap(mk=>{
                  const t=monthTotals[mk],fNeg=t.forecast<0,fOver=t.budget>0&&t.forecast>t.budget;
                  return viewMode==="full"
                    ?[<td key={`ft-${mk}-b`} style={{padding:"6px 5px",textAlign:"right",fontFamily:P.mono,fontSize:10,fontWeight:600,color:P.navy,background:"#E8F0F8",fontVariantNumeric:"tabular-nums"}}>{t.budget?fmtK(t.budget):"--"}</td>,<td key={`ft-${mk}-a`} style={{padding:"6px 5px",textAlign:"right",fontFamily:P.mono,fontSize:10,color:P.violet,background:"#F0EEFF",fontVariantNumeric:"tabular-nums"}}>{t.actual?fmtK(t.actual):"--"}</td>,<td key={`ft-${mk}-f`} style={{padding:"6px 5px",textAlign:"right",fontFamily:P.mono,fontSize:10,fontWeight:700,color:fNeg?P.red:fOver?P.red:P.green,background:(fNeg||fOver)?"#FAF0EE":"#E8F5EE",borderRight:`1px solid ${P.border}`,fontVariantNumeric:"tabular-nums"}}>{t.forecast!==0?fmtK(t.forecast):"--"}</td>]
                    :[<td key={`ft-${mk}-b`} style={{padding:"6px 5px",textAlign:"right",fontFamily:P.mono,fontSize:10,fontWeight:600,color:P.navy,background:"#E8F0F8",fontVariantNumeric:"tabular-nums"}}>{t.budget?fmtK(t.budget):"--"}</td>,<td key={`ft-${mk}-f`} style={{padding:"6px 5px",textAlign:"right",fontFamily:P.mono,fontSize:10,fontWeight:700,color:fNeg?P.red:fOver?P.red:P.green,background:(fNeg||fOver)?"#FAF0EE":"#E8F5EE",borderRight:`1px solid ${P.border}`,fontVariantNumeric:"tabular-nums"}}>{t.forecast!==0?fmtK(t.forecast):"--"}</td>];
                })}
                <td style={{position:"sticky",right:0,zIndex:30,padding:"7px 12px",textAlign:"right",fontFamily:P.mono,fontSize:13,fontWeight:700,color:grandForecast<0?P.red:grandBudget>0&&grandForecast>grandBudget?P.red:P.green,background:"#EAEAE7",borderLeft:`1px solid ${P.borderMd}`,fontVariantNumeric:"tabular-nums"}}>
                  {grandForecast!==0?fmtK(grandForecast):"--"}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Movement strip */}
      {!loading&&data?.ok&&lines.length>0&&(
        <div style={{border:`1px solid #E0D8B0`,background:"#FDFAF2",padding:"10px 14px"}}>
          <div style={{fontFamily:P.mono,fontSize:8,fontWeight:700,letterSpacing:"0.12em",textTransform:"uppercase",color:P.amber,marginBottom:6}}>
            Portfolio Budget vs Forecast (per month)
            {filterActive&&<span style={{marginLeft:8,fontWeight:400,color:P.textSm}}>\u2014 {data?.filteredProjectCount} project{data?.filteredProjectCount!==1?"s":""} selected</span>}
          </div>
          <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
            {visibleMonths.map(mk=>{
              const bud=monthTotals[mk]?.budget??0,fct=monthTotals[mk]?.forecast??0;
              if(!bud&&!fct) return null;
              const gap=fct-bud,[y,m]=mk.split("-"),over=gap>0,under=gap<0;
              return (
                <div key={mk} style={{display:"flex",alignItems:"center",gap:5,padding:"3px 9px",background:over?P.redLt:under?P.greenLt:"#F4F4F2",border:`1px solid ${over?"#F0B0AA":under?"#A0D0B8":P.border}`,fontFamily:P.mono,fontSize:10}}>
                  <span style={{color:P.textSm}}>{MONTH_SHORT[Number(m)-1]} {y.slice(2)}</span>
                  {gap===0?<span style={{color:P.textSm,fontWeight:500}}>on budget</span>:<><span style={{fontWeight:600,color:over?P.red:P.green,fontVariantNumeric:"tabular-nums"}}>{over?"+":"-"}{fmtK(Math.abs(gap))}</span><span style={{fontSize:9,color:P.textSm}}>{over?"over":"under"}</span></>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Quarter cards */}
      {!loading&&data?.ok&&lines.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(visibleQuarters.length,4)},1fr)`,gap:8}}>
          {visibleQuarters.map(q=>{
            const qM=q.months.filter(mk=>visibleMonths.includes(mk));
            const qBud=sumLines(lines,md,qM,"budget"),qAct=sumLines(lines,md,qM.filter(isPastMonth),"actual"),qFct=sumLines(lines,md,qM,"forecast");
            const qVar=qBud?qFct-qBud:0,qUtil=qBud?Math.round((qFct/qBud)*100):null,over=qBud>0&&qFct>qBud;
            return (
              <div key={q.label} style={{border:`1px solid ${over?"#E0C080":P.border}`,background:over?P.amberLt:P.surface,padding:"10px 12px"}}>
                <div style={{fontFamily:P.mono,fontSize:9,fontWeight:700,color:over?P.amber:P.navy,letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:6}}>{q.label}</div>
                <div style={{display:"flex",gap:10,flexWrap:"wrap",fontFamily:P.mono,fontSize:10}}>
                  <span style={{color:P.textSm}}>Budget <strong style={{color:P.navy}}>{fmt(qBud)}</strong></span>
                  <span style={{color:P.textSm}}>Forecast <strong style={{color:qFct<0?P.red:over?P.red:P.green}}>{fmt(qFct)}</strong></span>
                  {qAct>0&&<span style={{color:P.textSm}}>Actual <strong style={{color:P.violet}}>{fmt(qAct)}</strong></span>}
                </div>
                {qBud>0&&(
                  <div style={{marginTop:4,display:"flex",alignItems:"center",gap:6,fontFamily:P.mono,fontSize:9}}>
                    {over?<TrendingUp style={{width:10,height:10,color:P.red}}/>:<TrendingDown style={{width:10,height:10,color:P.green}}/>}
                    <span style={{color:over?P.red:P.green,fontWeight:600}}>{over?"+":""}{fmt(qVar)} ({over?"+":""}{qBud?((qFct-qBud)/qBud*100).toFixed(1):"0"}%)</span>
                    {qUtil!==null&&<span style={{marginLeft:"auto",color:P.textSm}}>Util: <strong style={{color:qUtil>100?P.red:qUtil>85?P.amber:P.textMd}}>{qUtil}%</strong></span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
    </div>
  );
}