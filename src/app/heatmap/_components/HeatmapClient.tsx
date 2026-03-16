"use client";
// FILE: src/app/heatmap/_components/HeatmapClient.tsx

import { useState, useCallback, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { HeatmapData, PersonRow, AllocationCell, Granularity, PeriodHeader, PipelineGapRow } from "../_lib/heatmap-query";
import { updateAllocation, deleteAllocationDirect } from "../../allocations/actions";
import AllocationAuditTrail from "@/components/heatmap/AllocationAuditTrail";

// -- Util ---------------------------------------------------------------------
const UC = {
  empty:    { bg:"#f8fafc",              text:"#cbd5e1", border:"#f1f5f9"               },
  low:      { bg:"rgba(16,185,129,0.1)", text:"#059669", border:"rgba(16,185,129,0.2)" },
  mid:      { bg:"rgba(245,158,11,0.1)", text:"#d97706", border:"rgba(245,158,11,0.2)" },
  high:     { bg:"rgba(239,68,68,0.1)",  text:"#dc2626", border:"rgba(239,68,68,0.2)"  },
  critical: { bg:"rgba(124,58,237,0.1)", text:"#7c3aed", border:"rgba(124,58,237,0.2)" },
};
function tier(p:number):keyof typeof UC{if(p===0)return"empty";if(p<75)return"low";if(p<95)return"mid";if(p<=110)return"high";return"critical";}
function ulabel(p:number){if(p===0)return"";if(p>200)return">200%";return`${p}%`;}
function ini(n:string){return n.split(" ").map((w:string)=>w[0]).join("").slice(0,2).toUpperCase();}
const AVC=["#00b8db","#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981","#ef4444","#f97316"];
function avcol(n:string){return AVC[n.charCodeAt(0)%AVC.length];}
const GL:Record<Granularity,string>={weekly:"Weekly",sprint:"Sprint",monthly:"Monthly",quarterly:"Quarterly"};
const CW:Record<Granularity,number>={weekly:64,sprint:80,monthly:90,quarterly:110};
const PERSON_COL = 280;

// -- Types --------------------------------------------------------------------
type CS={personId:string;personName:string;projectId:string;projectTitle:string;projectCode:string|null;colour:string;periodKey:string;startDate:string;endDate:string;daysAllocated:number;capacityDays:number;};
export type PersonOption={id:string;name:string;department:string|null;jobTitle:string|null;};
type PO={id:string;title:string;code:string|null;status:string;colour:string;};
type Filters={granularity:Granularity;dateFrom:string;dateTo:string;departments:string[];statuses:string[];personIds:string[];projectIds:string[];roles:string[];pmIds:string[];};

// -- Shared styles ------------------------------------------------------------
const MLS:React.CSSProperties={display:"block",fontSize:"10px",fontWeight:800,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"5px"};
const MIS:React.CSSProperties={width:"100%",boxSizing:"border-box",padding:"8px 10px",borderRadius:"8px",border:"1.5px solid #e2e8f0",fontSize:"13px",color:"#0f172a",fontFamily:"inherit",outline:"none"};

// -- Edit Modal ---------------------------------------------------------------
function EditModal({cell,people,projects,onClose,onSaved,onSaveError}:{cell:CS;people:PersonOption[];projects:PO[];onClose:()=>void;onSaved:(a:string,b:string,c:string,d:string,e:number,f:string)=>void;onSaveError?:(msg:string)=>void;}){
  const CAPS=[0.5,1,1.5,2,2.5,3,3.5,4,4.5,5];
  const[pid,setPid]=useState(cell.personId);const[prid,setPrid]=useState(cell.projectId);
  const[sd,setSd]=useState(cell.startDate);const[ed,setEd]=useState(cell.endDate);
  const[dpw,setDpw]=useState(cell.daysAllocated>0?cell.daysAllocated:5);
  const[at,setAt]=useState<"confirmed"|"soft">("confirmed");
  const[,startT]=useTransition();const[showDel,setShowDel]=useState(false);
  const[ps,setPs]=useState(cell.personName);
  const[prs,setPrs]=useState(cell.projectCode?`${cell.projectCode} - ${cell.projectTitle}`:cell.projectTitle);
  const[spd,setSpd]=useState(false);const[sprd,setSprd]=useState(false);
  const fp=people.filter(p=>p.name.toLowerCase().includes(ps.toLowerCase())||(p.jobTitle??"").toLowerCase().includes(ps.toLowerCase())).slice(0,8);
  const fpr=projects.filter(p=>p.title.toLowerCase().includes(prs.toLowerCase())||(p.code??"").toLowerCase().includes(prs.toLowerCase())).slice(0,8);
  const wk=(()=>{if(!sd||!ed||sd>ed)return 0;return Math.round((new Date(ed).getTime()-new Date(sd).getTime())/(7*86400000))+1;})();
  const DDS:React.CSSProperties={position:"absolute",top:"100%",left:0,right:0,zIndex:100,background:"white",border:"1.5px solid #e2e8f0",borderRadius:"8px",boxShadow:"0 8px 24px rgba(0,0,0,0.1)",marginTop:"4px",overflow:"hidden"};
  const DIS:React.CSSProperties={width:"100%",textAlign:"left",padding:"8px 12px",border:"none",borderBottom:"1px solid #f8fafc",background:"white",cursor:"pointer",fontSize:"12px",display:"flex",alignItems:"center",gap:"4px",fontFamily:"inherit"};
  function save(){const fd=new FormData();fd.set("person_id",pid);fd.set("project_id",prid);fd.set("start_date",sd);fd.set("end_date",ed);fd.set("days_per_week",String(dpw));fd.set("allocation_type",at);fd.set("return_to","/heatmap");onSaved(pid,prid,sd,ed,dpw,at);startT(async()=>{try{await updateAllocation(fd);}catch(e:any){onSaveError?.(e.message||"Save failed");}});}
  function del(){const fd=new FormData();fd.set("person_id",cell.personId);fd.set("project_id",cell.projectId);fd.set("return_to","/heatmap");onSaved(cell.personId,cell.projectId,"","",0,"");startT(async()=>{try{await deleteAllocationDirect(fd);}catch(e:any){onSaveError?.(e.message||"Delete failed");}});}
  const ac=projects.find(p=>p.id===prid)?.colour??cell.colour??"#00b8db";
  return(
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(15,23,42,0.5)",backdropFilter:"blur(3px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"white",borderRadius:"16px",border:`1.5px solid ${ac}30`,width:"100%",maxWidth:"440px",boxShadow:`0 20px 60px rgba(0,0,0,0.15)`}}>
        <div style={{padding:"16px 20px 12px",borderBottom:"1px solid #f1f5f9",background:`linear-gradient(135deg,${ac}08 0%,transparent 60%)`,borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div><div style={{fontSize:"15px",fontWeight:800,color:"#0f172a"}}>Edit allocation</div><div style={{fontSize:"11px",color:"#94a3b8",marginTop:"2px"}}>{cell.daysAllocated}d / {cell.capacityDays}d capacity ({Math.round((cell.daysAllocated/cell.capacityDays)*100)}%)</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:"18px",padding:"2px 6px"}}>x</button>
        </div>
        <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:"14px"}}>
          <div style={{position:"relative"}}><label style={MLS}>Person</label><input value={ps} onChange={e=>{setPs(e.target.value);setSpd(true);}} onFocus={()=>setSpd(true)} placeholder="Search people..." style={MIS}/>{spd&&fp.length>0&&<div style={DDS}>{fp.map(p=><button key={p.id} type="button" onClick={()=>{setPid(p.id);setPs(p.name);setSpd(false);}} style={{...DIS,background:p.id===pid?"rgba(0,184,219,0.08)":"white"}}><span style={{fontWeight:600,color:"#0f172a"}}>{p.name}</span>{p.jobTitle&&<span style={{color:"#94a3b8",fontSize:"11px"}}> - {p.jobTitle}</span>}</button>)}</div>}</div>
          <div style={{position:"relative"}}><label style={MLS}>Project</label><input value={prs} onChange={e=>{setPrs(e.target.value);setSprd(true);}} onFocus={()=>setSprd(true)} placeholder="Search projects..." style={MIS}/>{sprd&&fpr.length>0&&<div style={DDS}>{fpr.map(p=><button key={p.id} type="button" onClick={()=>{setPrid(p.id);setPrs(p.code?`${p.code} - ${p.title}`:p.title);setSprd(false);}} style={{...DIS,background:p.id===prid?"rgba(0,184,219,0.08)":"white"}}>{p.code&&<span style={{fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:"#64748b",marginRight:"6px"}}>{p.code}</span>}<span style={{fontWeight:600,color:"#0f172a"}}>{p.title}</span><span style={{marginLeft:"auto",fontSize:"10px",fontWeight:700,color:p.status==="confirmed"?"#059669":"#7c3aed",textTransform:"capitalize"}}>{p.status}</span></button>)}</div>}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}><div><label style={MLS}>Start</label><input type="date" value={sd} onChange={e=>setSd(e.target.value)} style={MIS}/></div><div><label style={MLS}>End</label><input type="date" value={ed} onChange={e=>setEd(e.target.value)} style={MIS}/></div></div>
          {wk>0&&<div style={{fontSize:"11px",color:"#94a3b8",marginTop:"-8px"}}>{wk}w - {Math.round(wk*dpw*10)/10}d total</div>}
          <div><label style={MLS}>Days / week</label><div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>{CAPS.map(d=><button key={d} type="button" onClick={()=>setDpw(d)} style={{padding:"6px 10px",borderRadius:"7px",border:`1.5px solid ${dpw===d?"#00b8db":"#e2e8f0"}`,background:dpw===d?"rgba(0,184,219,0.1)":"white",color:dpw===d?"#0e7490":"#475569",fontSize:"12px",fontWeight:dpw===d?800:500,cursor:"pointer"}}>{d}</button>)}</div></div>
          <div><label style={MLS}>Type</label><div style={{display:"flex",gap:"8px"}}>{(["confirmed","soft"] as const).map(t=><button key={t} type="button" onClick={()=>setAt(t)} style={{flex:1,padding:"7px",borderRadius:"7px",border:`1.5px solid ${at===t?"#00b8db":"#e2e8f0"}`,background:at===t?"rgba(0,184,219,0.08)":"white",color:at===t?"#0e7490":"#64748b",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>{t==="confirmed"?"Confirmed":"Soft"}</button>)}</div></div>
        </div>
        <div style={{padding:"12px 20px 16px",borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          {!showDel?<button onClick={()=>setShowDel(true)} style={{background:"none",border:"none",color:"#ef4444",fontSize:"12px",fontWeight:600,cursor:"pointer",padding:0}}>Remove allocation</button>
          :<div style={{display:"flex",gap:"8px",alignItems:"center"}}><span style={{fontSize:"12px",color:"#ef4444",fontWeight:600}}>Remove all weeks?</span><button onClick={del} style={{padding:"5px 12px",borderRadius:"6px",border:"none",background:"#ef4444",color:"white",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>Yes</button><button onClick={()=>setShowDel(false)} style={{padding:"5px 12px",borderRadius:"6px",border:"1px solid #e2e8f0",background:"white",fontSize:"12px",color:"#64748b",cursor:"pointer"}}>Cancel</button></div>}
          <div style={{display:"flex",gap:"8px"}}>
            <button onClick={onClose} style={{padding:"8px 16px",borderRadius:"8px",border:"1.5px solid #e2e8f0",background:"white",fontSize:"12px",fontWeight:600,color:"#475569",cursor:"pointer"}}>Cancel</button>
            <button onClick={save} disabled={!pid||!prid||!sd||!ed} style={{padding:"8px 18px",borderRadius:"8px",border:"none",background:!pid||!prid?"#e2e8f0":"#00b8db",color:!pid||!prid?"#94a3b8":"white",fontSize:"12px",fontWeight:800,cursor:!pid||!prid?"not-allowed":"pointer"}}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Searchable multi-select dropdown -----------------------------------------
function MultiDropdown({
  label, placeholder, options, selected, onToggle, renderOption, renderSelected,
}: {
  label: string;
  placeholder: string;
  options: { id: string; label: string; sub?: string; colour?: string }[];
  selected: string[];
  onToggle: (id: string) => void;
  renderOption?: (o: { id: string; label: string; sub?: string; colour?: string }) => React.ReactNode;
  renderSelected?: () => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [q,    setQ]    = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handle(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, []);

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(q.toLowerCase()) || (o.sub || "").toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <label style={MLS}>{label}</label>
      <button
        type="button"
        onClick={() => { setOpen(o => !o); setQ(""); }}
        style={{
          width: "100%", padding: "8px 10px", borderRadius: "8px",
          border: `1.5px solid ${selected.length > 0 ? "#00b8db" : "#e2e8f0"}`,
          background: selected.length > 0 ? "rgba(0,184,219,0.06)" : "white",
          color: "#0f172a", fontSize: "12px", fontFamily: "inherit",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "space-between",
          textAlign: "left",
        }}
      >
        <span style={{ color: selected.length > 0 ? "#0e7490" : "#94a3b8", fontWeight: selected.length > 0 ? 600 : 400 }}>
          {selected.length > 0
            ? (renderSelected ? renderSelected() : `${selected.length} selected`)
            : placeholder}
        </span>
        <span style={{ fontSize: "10px", color: "#94a3b8", marginLeft: "6px" }}>
          {open ? "^" : "v"}
        </span>
      </button>

      {open && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 200,
          background: "white", border: "1.5px solid #e2e8f0", borderRadius: "10px",
          boxShadow: "0 8px 24px rgba(0,0,0,0.1)", overflow: "hidden",
        }}>
          <div style={{ padding: "8px" }}>
            <input
              autoFocus
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={`Search ${label.toLowerCase()}...`}
              style={{ ...MIS, fontSize: "12px", padding: "6px 10px" }}
            />
          </div>
          <div style={{ maxHeight: "200px", overflowY: "auto" }}>
            {filtered.length === 0 && (
              <div style={{ padding: "10px 12px", fontSize: "12px", color: "#94a3b8", textAlign: "center" }}>No results</div>
            )}
            {filtered.map(o => (
              <button
                key={o.id}
                type="button"
                onClick={() => onToggle(o.id)}
                style={{
                  width: "100%", textAlign: "left", padding: "8px 12px",
                  border: "none", borderBottom: "1px solid #f8fafc",
                  background: selected.includes(o.id) ? "rgba(0,184,219,0.07)" : "white",
                  cursor: "pointer", display: "flex", alignItems: "center", gap: "8px",
                  fontFamily: "inherit",
                }}
              >
                <div style={{
                  width: "14px", height: "14px", borderRadius: "4px", flexShrink: 0,
                  border: `2px solid ${selected.includes(o.id) ? "#00b8db" : "#e2e8f0"}`,
                  background: selected.includes(o.id) ? "#00b8db" : "white",
                  display: "flex", alignItems: "center", justifyContent: "center",
                }}>
                  {selected.includes(o.id) && <span style={{ color: "white", fontSize: "9px", lineHeight: 1 }}>ok</span>}
                </div>
                {renderOption ? renderOption(o) : (
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: "12px", fontWeight: 600, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</div>
                    {o.sub && <div style={{ fontSize: "10px", color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.sub}</div>}
                  </div>
                )}
              </button>
            ))}
          </div>
          {selected.length > 0 && (
            <div style={{ padding: "6px 10px", borderTop: "1px solid #f1f5f9" }}>
              <button type="button" onClick={() => selected.forEach(id => onToggle(id))} style={{ background: "none", border: "none", color: "#ef4444", fontSize: "11px", fontWeight: 600, cursor: "pointer", padding: 0 }}>
                Clear {selected.length} selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// -- Ask AI Panel -------------------------------------------------------------
const PRESET_QUESTIONS = [
  "Who has the most availability in the next 4 weeks?",
  "Who is currently overallocated and by how much?",
  "Which projects have the highest risk of resource gaps?",
  "Can we take on a new project requiring 2 people full-time next month?",
  "Who could be freed up if we paused a project?",
  "What is the average team utilisation right now?",
  "Which people have zero allocation - are they unassigned?",
  "What is the resource situation for the next quarter?",
];

function AskAIPanel({ data, onClose }: { data: HeatmapData; onClose: () => void }) {
  const [question,  setQuestion]  = useState("");
  const [messages,  setMessages]  = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [loading,   setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function buildContext(): string {
    const lines: string[] = [
      `Resource Heatmap - ${data.dateFrom} to ${data.dateTo}`,
      `Granularity: ${data.granularity} | People: ${data.people.length}`,
      `Periods covered: ${data.periods.map(p => p.label).join(", ")}`,
      "",
      "CAPACITY KEY: Each period shows [utilisation% | allocated_days / capacity_days | available_days_remaining]",
      "0% or -- means FULLY AVAILABLE (no allocations that period).",
      "",
      "PEOPLE - PER-PERIOD BREAKDOWN:",
    ];

    for (const p of data.people) {
      const cap = p.defaultCapacityDays;
      lines.push(`\n> ${p.fullName} | ${p.jobTitle || p.department || "no role"} | ${cap}d/wk capacity`);

      const periodRows = data.periods.map(period => {
        const cell = p.summaryCells.find(c => c.periodKey === period.key);
        if (!cell || cell.capacityDays === 0) return `  ${period.label}: NO DATA`;
        const pct    = cell.utilisationPct;
        const alloc  = cell.daysAllocated;
        const totalCap = cell.capacityDays;
        const avail  = Math.max(0, totalCap - alloc);
        const status = pct === 0   ? "FULLY AVAILABLE"
                     : pct < 75   ? "available"
                     : pct < 95   ? "busy"
                     : pct <= 110 ? "at limit"
                     : "OVERALLOCATED";
        return `  ${period.label}: ${pct}% [${alloc}d allocated / ${totalCap}d capacity = ${avail}d free] - ${status}`;
      });
      lines.push(...periodRows);

      const projList = p.projects.map(pr => `${pr.projectCode || pr.projectTitle}(${pr.totalDays}d total)`).join(", ");
      lines.push(`  Projects: ${projList || "none assigned"}`);
    }

    if (data.pipelineGaps.length > 0) {
      lines.push("\n\nPIPELINE RESOURCE GAPS:");
      for (const g of data.pipelineGaps) {
        const gapStr = g.cells.filter(c => c.gapDays > 0)
          .map(c => `${c.periodKey}: needs ${c.gapDays}d (weighted: ${c.weightedDemand.toFixed(1)}d at ${g.winProbability}% win prob)`)
          .join(", ");
        lines.push(`* ${g.projectTitle} - ${gapStr || "no gaps"}`);
      }
    }

    lines.push("\n\nINSTRUCTIONS FOR AI:");
    lines.push("- 0% utilisation = person has NO allocations that period = they ARE available");
    lines.push("- Answer availability questions using the per-period data above, not just averages");
    lines.push("- Cite specific periods and day counts in your answers");

    return lines.join("\n");
  }

  async function ask(q: string) {
    if (!q.trim() || loading) return;
    const userMsg = { role: "user" as const, content: q };
    setMessages(m => [...m, userMsg]);
    setQuestion("");
    setLoading(true);

    try {
      const res = await fetch("/api/heatmap/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          context: buildContext(),
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Request failed");
      setMessages(m => [...m, { role: "assistant", content: json.text }]);
    } catch (e: any) {
      setMessages(m => [...m, { role: "assistant", content: `Error: ${e.message}` }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: "fixed", right: 0, top: 0, bottom: 0, width: "420px", zIndex: 1500,
      background: "white", borderLeft: "1.5px solid #e2e8f0",
      boxShadow: "-8px 0 32px rgba(0,0,0,0.1)",
      display: "flex", flexDirection: "column",
      fontFamily: "'DM Sans', sans-serif",
      animation: "slideInRight 0.2s ease",
    }}>
      <div style={{
        padding: "16px 20px", borderBottom: "1px solid #f1f5f9",
        background: "linear-gradient(135deg, rgba(0,184,219,0.06) 0%, transparent 60%)",
        display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0,
      }}>
        <div>
          <div style={{ fontSize: "15px", fontWeight: 800, color: "#0f172a", display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "18px" }}>*</span> Resource AI Advisor
          </div>
          <div style={{ fontSize: "11px", color: "#94a3b8", marginTop: "2px" }}>
            Ask anything about your team's capacity
          </div>
        </div>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#94a3b8", cursor: "pointer", fontSize: "20px", lineHeight: 1 }}>x</button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        {messages.length === 0 && (
          <div>
            <div style={{ fontSize: "12px", fontWeight: 700, color: "#64748b", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Suggested questions
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {PRESET_QUESTIONS.map(q => (
                <button key={q} type="button" onClick={() => ask(q)} style={{
                  padding: "9px 12px", borderRadius: "8px", border: "1.5px solid #e2e8f0",
                  background: "white", color: "#334155", fontSize: "12px", cursor: "pointer",
                  textAlign: "left", fontFamily: "inherit", fontWeight: 500,
                  transition: "all 0.15s", lineHeight: 1.4,
                }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#00b8db"; (e.currentTarget as HTMLButtonElement).style.background = "rgba(0,184,219,0.04)"; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.borderColor = "#e2e8f0"; (e.currentTarget as HTMLButtonElement).style.background = "white"; }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{
            display: "flex", flexDirection: "column",
            alignItems: m.role === "user" ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "90%", padding: "10px 14px", borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "12px 12px 12px 2px",
              background: m.role === "user" ? "#00b8db" : "#f8fafc",
              color: m.role === "user" ? "white" : "#0f172a",
              fontSize: "13px", lineHeight: 1.6,
              border: m.role === "assistant" ? "1px solid #e2e8f0" : "none",
              whiteSpace: "pre-wrap",
            }}>
              {m.content}
            </div>
          </div>
        ))}

        {loading && (
          <div style={{ display: "flex", alignItems: "center", gap: "8px", padding: "10px 14px", background: "#f8fafc", borderRadius: "12px 12px 12px 2px", border: "1px solid #e2e8f0", width: "fit-content" }}>
            {[0, 1, 2].map(i => (
              <div key={i} style={{
                width: "6px", height: "6px", borderRadius: "50%", background: "#00b8db",
                animation: `bounce 1s ease infinite ${i * 0.15}s`,
              }} />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div style={{ padding: "12px 16px", borderTop: "1px solid #f1f5f9", flexShrink: 0 }}>
        {messages.length > 0 && (
          <button type="button" onClick={() => setMessages([])} style={{
            background: "none", border: "none", color: "#94a3b8", fontSize: "11px",
            cursor: "pointer", padding: 0, marginBottom: "8px", display: "block",
          }}>
            New conversation
          </button>
        )}
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            value={question}
            onChange={e => setQuestion(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(question); } }}
            placeholder="Ask about capacity, availability, risks..."
            style={{
              flex: 1, padding: "9px 12px", borderRadius: "8px",
              border: "1.5px solid #e2e8f0", fontSize: "13px",
              fontFamily: "inherit", color: "#0f172a", outline: "none",
            }}
            onFocus={e => { e.target.style.borderColor = "#00b8db"; }}
            onBlur={e => { e.target.style.borderColor = "#e2e8f0"; }}
          />
          <button
            type="button"
            onClick={() => ask(question)}
            disabled={!question.trim() || loading}
            style={{
              padding: "9px 14px", borderRadius: "8px", border: "none",
              background: !question.trim() || loading ? "#e2e8f0" : "#00b8db",
              color: !question.trim() || loading ? "#94a3b8" : "white",
              fontSize: "13px", fontWeight: 700, cursor: !question.trim() ? "not-allowed" : "pointer",
              fontFamily: "inherit",
            }}
          >
            ^
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Sub-components -----------------------------------------------------------
function Avatar({name,size=30}:{name:string;size?:number}){return<div style={{width:size,height:size,borderRadius:"50%",background:avcol(name),color:"#fff",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.33,fontWeight:800}}>{ini(name)}</div>;}
function UtilBadge({pct}:{pct:number}){const c=UC[tier(pct)];if(pct===0)return null;return<span style={{fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",background:c.bg,color:c.text,border:`1px solid ${c.border}`,borderRadius:"4px",padding:"1px 5px"}}>{ulabel(pct)}</span>;}
function GranToggle({value,onChange}:{value:Granularity;onChange:(g:Granularity)=>void}){return<div style={{display:"flex",background:"#f1f5f9",borderRadius:"8px",padding:"3px",gap:"2px"}}>{(["weekly","sprint","monthly","quarterly"] as Granularity[]).map(g=><button key={g} type="button" onClick={()=>onChange(g)} style={{padding:"5px 12px",borderRadius:"6px",border:"none",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"inherit",background:value===g?"white":"transparent",color:value===g?"#0f172a":"#64748b",boxShadow:value===g?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>{GL[g]}</button>)}</div>;}

function HCell({cell,cw,cur}:{cell:AllocationCell|null;cw:number;cur:boolean}){
  const pct=cell?.utilisationPct??0,c=UC[tier(pct)],ex=cell?.hasException??false;
  const isLeaveOnly = ex && pct===0;
  const cap = cell?.capacityDays??0;
  const avail = cell?.daysAllocated!==undefined ? cap - cell.daysAllocated : cap;
  const tooltip = isLeaveOnly
    ? `Leave / exception this week - ${cap}d available, 0d allocated`
    : cell ? `${cell.daysAllocated}d / ${cell.capacityDays}d (${pct}%)${ex?" - Capacity exception":""}`
    : "---";
  return<div title={tooltip} style={{
    width:cw-2,minWidth:cw-2,height:"34px",borderRadius:"5px",
    background: isLeaveOnly ? "rgba(99,102,241,0.08)" : cur&&pct===0 ? "rgba(0,184,219,0.04)" : c.bg,
    border:`1px solid ${isLeaveOnly?"rgba(99,102,241,0.4)":ex?"rgba(99,102,241,0.35)":cur?"rgba(0,184,219,0.2)":c.border}`,
    display:"flex",alignItems:"center",justifyContent:"center",gap:"3px",
    fontSize:"11px",fontWeight:700,fontFamily:"'DM Mono',monospace",
    color: isLeaveOnly?"#818cf8" : pct===0?"#e2e8f0":c.text,
    cursor:cell&&cell.allocationIds.length>0?"pointer":"default",
    transition:"all 0.1s",position:"relative",flexShrink:0,
  }}>
    {isLeaveOnly
      ? <><span style={{fontSize:"12px",lineHeight:1}}>X</span><span style={{fontSize:"9px",fontWeight:700,color:"#818cf8",letterSpacing:"0.04em"}}>LEAVE</span></>
      : pct>0 ? ulabel(pct) : "--"
    }
    {ex&&!isLeaveOnly&&<div style={{position:"absolute",top:"3px",right:"3px",width:"5px",height:"5px",borderRadius:"50%",background:"#818cf8",boxShadow:"0 0 0 1px white"}}/>}
    {pct>0&&<div style={{position:"absolute",bottom:0,left:0,height:"3px",borderRadius:"0 0 4px 4px",width:`${Math.min(pct,100)}%`,background:c.text,opacity:0.4}}/>}
  </div>;
}

function PipeCell({cell,cw}:{cell:PipelineGapRow["cells"][number]|null;cw:number}){
  const hg=cell&&cell.gapDays>0,hd=cell&&cell.demandDays>0;
  return<div title={cell?`Demand:${cell.demandDays}d/Gap:${cell.gapDays}d`:"---"} style={{width:cw-2,minWidth:cw-2,height:"34px",borderRadius:"5px",background:hg?"rgba(239,68,68,0.06)":hd?"rgba(124,58,237,0.07)":"#f8fafc",border:`1.5px dashed ${hg?"rgba(239,68,68,0.3)":hd?"rgba(124,58,237,0.3)":"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:hg?"#dc2626":hd?"#7c3aed":"#cbd5e1",flexShrink:0}}>{hd?(hg?`-${cell!.gapDays}d`:`${cell!.demandDays}d`):"--"}</div>;
}

function PHeaders({periods,cw}:{periods:PeriodHeader[];cw:number}){return<div style={{display:"flex",gap:"2px"}}>{periods.map(p=><div key={p.key} style={{width:cw,minWidth:cw,flexShrink:0,textAlign:"center",padding:"0 2px"}}>{p.subLabel&&<div style={{fontSize:"9px",fontWeight:700,color:"#94a3b8",fontFamily:"'DM Mono',monospace",marginBottom:"1px"}}>{p.subLabel}</div>}<div style={{fontSize:"11px",fontWeight:p.isCurrentPeriod?800:500,color:p.isCurrentPeriod?"#00b8db":"#475569",background:p.isCurrentPeriod?"rgba(0,184,219,0.08)":"transparent",borderRadius:"5px",padding:"2px 0"}}>{p.label}</div></div>)}</div>;}

// -- HeatmapPersonRow -- with audit trail toggle ------------------------------
function HeatmapPersonRow({person,periods,cw,expanded,onToggle,onCell}:{person:PersonRow;periods:PeriodHeader[];cw:number;expanded:boolean;onToggle:()=>void;onCell:(s:CS)=>void}){
  const [showAudit, setShowAudit] = useState(false);
  return(
    <div style={{borderBottom:"1px solid #f1f5f9"}}>
      <div style={{display:"flex",alignItems:"center",padding:"6px 0",cursor:"pointer",background:expanded?"rgba(0,184,219,0.02)":"transparent"}} onClick={onToggle}>
        <div style={{width:PERSON_COL,minWidth:PERSON_COL,flexShrink:0,display:"flex",alignItems:"center",gap:"8px",paddingRight:"12px"}}>
          <span style={{fontSize:"12px",color:"#94a3b8",transform:expanded?"rotate(90deg)":"rotate(0)",transition:"transform 0.2s",display:"inline-block",width:"14px",flexShrink:0}}>{">"}</span>
          <Avatar name={person.fullName} size={28}/>
          <div style={{minWidth:0,flex:1}}>
            <div style={{fontSize:"13px",fontWeight:600,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{person.fullName}</div>
            <div style={{fontSize:"10px",color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              {person.jobTitle||person.department||"---"}
              {person.employmentType==="part_time"&&<span style={{color:"#f59e0b",marginLeft:"4px",fontWeight:600}}>PT</span>}
            </div>
          </div>
          <div style={{marginLeft:"auto",flexShrink:0}}><UtilBadge pct={person.avgUtilisationPct}/></div>
        </div>
        <div style={{display:"flex",gap:"2px"}}>{periods.map(p=>{const c=person.summaryCells.find(c=>c.periodKey===p.key)??null;return<HCell key={p.key} cell={c} cw={cw} cur={p.isCurrentPeriod}/>;})}</div>
      </div>

      {expanded&&(
        <div style={{paddingBottom:"4px"}}>
          {person.projects.length===0
            ?<div style={{paddingLeft:`${PERSON_COL+22}px`,padding:"8px 0 8px",fontSize:"12px",color:"#94a3b8",fontStyle:"italic"}}>No allocations in this period</div>
            :person.projects.map(proj=>(
              <div key={proj.projectId} style={{display:"flex",alignItems:"center",padding:"3px 0",gap:"2px"}}>
                <div style={{width:PERSON_COL,minWidth:PERSON_COL,flexShrink:0,display:"grid",gridTemplateColumns:"22px 72px 1fr 80px",gap:"4px",paddingRight:"12px",alignItems:"center"}}>
                  <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
                    <div style={{width:"3px",height:"22px",borderRadius:"2px",background:proj.colour}}/>
                  </div>
                  <div style={{fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:proj.colour,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={proj.projectCode||"---"}>
                    {proj.projectCode||<span style={{color:"#e2e8f0"}}>---</span>}
                  </div>
                  <div style={{fontSize:"11px",fontWeight:600,color:"#334155",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={proj.projectTitle}>
                    {proj.projectTitle}
                  </div>
                  <div style={{fontSize:"10px",color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",fontStyle:proj.roleOnProject?"normal":"italic"}} title={proj.roleOnProject||"---"}>
                    {proj.roleOnProject||<span style={{color:"#e2e8f0"}}>---</span>}
                  </div>
                </div>
                <div style={{display:"flex",gap:"2px"}}>{periods.map(p=>{
                  const c=proj.cells.find(c=>c.periodKey===p.key);
                  if(!c||c.daysAllocated===0)return<div key={p.key} style={{width:cw-2,minWidth:cw-2,height:"26px",flexShrink:0}}/>;
                  return<div key={p.key} title={`${c.daysAllocated}d - click to edit`} onClick={()=>onCell({personId:person.personId,personName:person.fullName,projectId:proj.projectId,projectTitle:proj.projectTitle,projectCode:proj.projectCode,colour:proj.colour,periodKey:p.key,startDate:p.startDate,endDate:p.endDate,daysAllocated:c.daysAllocated,capacityDays:c.capacityDays})} style={{width:cw-2,minWidth:cw-2,height:"26px",borderRadius:"4px",flexShrink:0,background:`${proj.colour}15`,border:`1px solid ${proj.colour}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:proj.colour,cursor:"pointer"}} onMouseEnter={e=>{const d=e.currentTarget as HTMLDivElement;d.style.background=`${proj.colour}30`;d.style.transform="scale(1.05)";}} onMouseLeave={e=>{const d=e.currentTarget as HTMLDivElement;d.style.background=`${proj.colour}15`;d.style.transform="scale(1)";}}>{c.daysAllocated}d</div>;
                })}</div>
              </div>
            ))
          }
          <div style={{paddingLeft:`${PERSON_COL+22}px`,padding:"4px 0 6px",display:"flex",alignItems:"center",gap:"16px"}}>
            <a href={`/allocations/new?person_id=${person.personId}&return_to=/heatmap`} style={{fontSize:"11px",color:"#00b8db",fontWeight:600,textDecoration:"none"}}>+ Allocate to project</a>
            <button
              type="button"
              onClick={e=>{e.stopPropagation();setShowAudit(v=>!v);}}
              style={{background:"none",border:"none",fontSize:"11px",color:showAudit?"#7c3aed":"#94a3b8",fontWeight:600,cursor:"pointer",padding:0,fontFamily:"inherit"}}
            >
              {showAudit?"- Hide history":"- View change history"}
            </button>
          </div>
          {showAudit&&(
            <div style={{marginLeft:PERSON_COL+22,marginRight:16,marginBottom:12,padding:"16px",background:"white",borderRadius:10,border:"1px solid #e2e8f0"}}>
              <AllocationAuditTrail
                personId={person.personId}
                title={`${person.fullName} - allocation history`}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PipeSection({gaps,periods,cw}:{gaps:PipelineGapRow[];periods:PeriodHeader[];cw:number}){
  const[open,setOpen]=useState(false);if(!gaps.length)return null;
  return(<div style={{marginTop:"16px",border:"1.5px dashed #c4b5fd",borderRadius:"12px",overflow:"hidden"}}>
    <div style={{padding:"10px 16px",background:"rgba(124,58,237,0.04)",display:"flex",alignItems:"center",gap:"10px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
      <div style={{flex:1}}><div style={{fontSize:"13px",fontWeight:700,color:"#7c3aed"}}>Pipeline projects - capacity gap analysis</div><div style={{fontSize:"11px",color:"#94a3b8"}}>{gaps.length} project{gaps.length>1?"s":""}</div></div>
      <span style={{fontSize:"14px",color:"#94a3b8",transform:open?"rotate(180deg)":"rotate(0)",transition:"transform 0.2s",display:"inline-block"}}>v</span>
    </div>
    {open&&<div style={{padding:"12px 16px"}}>
      <div style={{display:"flex",marginBottom:"8px"}}><div style={{width:PERSON_COL,minWidth:PERSON_COL,flexShrink:0}}/><PHeaders periods={periods} cw={cw}/></div>
      {gaps.map(proj=>(<div key={proj.projectId} style={{display:"flex",alignItems:"center",padding:"4px 0",borderTop:"1px solid #f5f0ff"}}>
        <div style={{width:PERSON_COL,minWidth:PERSON_COL,flexShrink:0,display:"flex",alignItems:"center",gap:"8px",paddingRight:"12px"}}>
          <div style={{width:"3px",height:"32px",borderRadius:"2px",background:proj.colour,flexShrink:0}}/>
          <div style={{minWidth:0}}>
            <div style={{fontSize:"12px",fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{proj.projectTitle}</div>
            <div style={{display:"flex",gap:"6px",alignItems:"center"}}>{proj.projectCode&&<span style={{fontSize:"10px",fontFamily:"'DM Mono',monospace",color:proj.colour,fontWeight:700}}>{proj.projectCode}</span>}<span style={{fontSize:"10px",color:"#94a3b8"}}>{proj.winProbability}% win</span></div>
          </div>
        </div>
        <div style={{display:"flex",gap:"2px"}}>{periods.map(p=><PipeCell key={p.key} cell={proj.cells.find(c=>c.periodKey===p.key)??null} cw={cw}/>)}</div>
      </div>))}
    </div>}
  </div>);
}

// -- Main Component -----------------------------------------------------------
export default function HeatmapClient({
  initialData, allPeople, allDepartments, allProjects, allRoles, allPMs, initialFilters, managerFilter,
}:{
  initialData: HeatmapData; allPeople: PersonOption[]; allDepartments: string[];
  allProjects: PO[]; allRoles: string[]; allPMs: PersonOption[];
  initialFilters: Filters; managerFilter?: any;
}) {
  const [data,     setData]     = useState<HeatmapData>(initialData);
  const [filters,  setFilters]  = useState<Filters>(initialFilters);
  const [exp,      setExp]      = useState<Set<string>>(new Set());
  const [loading,  setLoading]  = useState(false);
  const [ferr,     setFerr]     = useState<string | null>(null);
  const [showF,    setShowF]    = useState(false);
  const [edit,     setEdit]     = useState<CS | null>(null);
  const [saveErr,  setSaveErr]  = useState<string | null>(null);
  const [showAI,   setShowAI]   = useState(false);
  const [search,   setSearch]   = useState("");

  const saveErrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function showSaveErr(msg: string) { setSaveErr(msg); if (saveErrTimer.current) clearTimeout(saveErrTimer.current); saveErrTimer.current = setTimeout(() => setSaveErr(null), 5000); }
  const abrt = useRef<AbortController | null>(null);
  const cw   = CW[filters.granularity];
  const router = useRouter();

  function bp(f: Filters) {
    const p = new URLSearchParams();
    p.set("granularity", f.granularity); p.set("dateFrom", f.dateFrom); p.set("dateTo", f.dateTo);
    f.departments.forEach(d => p.append("dept", d));
    f.statuses.forEach(s => p.append("status", s));
    [...new Set([...f.personIds, ...f.pmIds])].forEach(id => p.append("person", id));
    (f.projectIds ?? []).forEach(id => p.append("project", id));
    return p;
  }

  const fetchData = useCallback(async (f: Filters) => {
    if (abrt.current) abrt.current.abort(); abrt.current = new AbortController();
    setLoading(true); setFerr(null);
    try {
      const res  = await fetch(`/api/heatmap/data?${bp(f)}&_t=${Date.now()}`, { signal: abrt.current.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if ((f.roles ?? []).length > 0) { json.people = (json.people ?? []).filter((p: any) => (f.roles ?? []).some(r => p.jobTitle && p.jobTitle.toLowerCase().includes(r.toLowerCase()))); }
      setData(json);
    } catch (e: any) { if (e.name !== "AbortError") setFerr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(filters); }, [filters, fetchData]);

  function onSaved(_a: string, _b: string, _c: string, _d: string, _e: number, _f: string) {
    setEdit(null); router.refresh();
    if (abrt.current) abrt.current.abort(); abrt.current = new AbortController();
    const f = filters;
    fetch(`/api/heatmap/data?${bp(f)}&_t=${Date.now()}`, { signal: abrt.current.signal })
      .then(r => r.ok ? r.json() : null)
      .then(json => { if (!json) return; if ((f.roles ?? []).length > 0) { json.people = (json.people ?? []).filter((p: any) => (f.roles ?? []).some(r => p.jobTitle && p.jobTitle.toLowerCase().includes(r.toLowerCase()))); } setData(json); })
      .catch(() => {});
  }

  const tD  = (d: string)  => setFilters(f => ({ ...f, departments: f.departments.includes(d)        ? f.departments.filter(x => x !== d)                  : [...f.departments, d] }));
  const tS  = (s: string)  => setFilters(f => ({ ...f, statuses:    f.statuses.includes(s)            ? f.statuses.filter(x => x !== s)                     : [...f.statuses, s] }));
  const tP  = (id: string) => setFilters(f => ({ ...f, personIds:   f.personIds.includes(id)          ? f.personIds.filter(x => x !== id)                   : [...f.personIds, id] }));
  const tPr = (id: string) => setFilters(f => ({ ...f, projectIds:  (f.projectIds ?? []).includes(id) ? (f.projectIds ?? []).filter(x => x !== id)          : [...(f.projectIds ?? []), id] }));
  const tR  = (r: string)  => setFilters(f => ({ ...f, roles:       (f.roles ?? []).includes(r)       ? (f.roles ?? []).filter(x => x !== r)                : [...(f.roles ?? []), r] }));
  const tPM = (id: string) => setFilters(f => ({ ...f, pmIds:       (f.pmIds ?? []).includes(id)      ? (f.pmIds ?? []).filter(x => x !== id)               : [...(f.pmIds ?? []), id] }));
  const clr = () => setFilters(f => ({ ...f, departments: [], statuses: [], personIds: [], projectIds: [], roles: [], pmIds: [] }));

  const afc = filters.departments.length + filters.statuses.length + filters.personIds.length + (filters.projectIds ?? []).length + (filters.roles ?? []).length + (filters.pmIds ?? []).length;
  const tE  = (id: string) => setExp(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const avg = data.people.length ? Math.round(data.people.reduce((s, p) => s + p.avgUtilisationPct, 0) / data.people.length) : 0;
  const oa  = data.people.filter(p => p.peakUtilisationPct > 100).length;
  const td  = data.people.reduce((s, p) => s + p.summaryCells.reduce((ss, c) => ss + c.daysAllocated, 0), 0);

  const visiblePeople = search.trim()
    ? data.people.filter(p => {
        const q = search.toLowerCase();
        return p.fullName.toLowerCase().includes(q) ||
          (p.department ?? "").toLowerCase().includes(q) ||
          (p.jobTitle ?? "").toLowerCase().includes(q) ||
          p.projects.some(pr =>
            pr.projectTitle.toLowerCase().includes(q) ||
            (pr.projectCode ?? "").toLowerCase().includes(q) ||
            (pr.roleOnProject ?? "").toLowerCase().includes(q)
          );
      })
    : data.people;

  const peopleOpts   = allPeople.map(p => ({ id: p.id, label: p.name, sub: p.jobTitle || p.department || "" }));
  const projectOpts  = allProjects.map(p => ({ id: p.id, label: p.title, sub: p.code || "", colour: p.colour }));

  return (<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
      .hmr{font-family:'DM Sans',sans-serif;min-height:100vh;background:#f8fafc;color:#0f172a;}
      .hmi{max-width:1400px;margin:0 auto;padding:32px 28px;}
      .hmc{background:white;border-radius:14px;border:1.5px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,0.04);}
      .hmtw{overflow-x:auto;}.hmti{min-width:max-content;padding:0 16px 16px;}
      .hmleg{display:flex;gap:16px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid #f1f5f9;background:#fafafa;}
      .hmli{display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;}
      @keyframes spin{to{transform:rotate(360deg);}}
      @keyframes slideUp{from{opacity:0;transform:translateY(8px);}to{opacity:1;transform:translateY(0);}}
      @keyframes slideInRight{from{opacity:0;transform:translateX(40px);}to{opacity:1;transform:translateX(0);}}
      @keyframes bounce{0%,80%,100%{transform:scale(0);}40%{transform:scale(1);}}
    `}</style>

    <div className="hmr"><div className="hmi">

      {saveErr && (
        <div style={{position:"fixed",bottom:"24px",left:"50%",transform:"translateX(-50%)",zIndex:3000,padding:"12px 20px",borderRadius:"10px",background:"#1e293b",color:"white",fontSize:"13px",fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,0.2)",display:"flex",alignItems:"center",gap:"12px",animation:"slideUp 0.2s ease",fontFamily:"'DM Sans',sans-serif"}}>
          <span style={{color:"#f87171"}}>!</span>{saveErr}
          <button onClick={() => setSaveErr(null)} style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:"16px",padding:"0 0 0 4px",lineHeight:1}}>x</button>
        </div>
      )}

      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"24px",flexWrap:"wrap",gap:"12px"}}>
        <div>
          <h1 style={{fontSize:"22px",fontWeight:800,color:"#0f172a",margin:0,marginBottom:"4px"}}>Resource Heatmap</h1>
          <p style={{fontSize:"13px",color:"#94a3b8",margin:0}}>
            {data.dateFrom ? new Date(data.dateFrom).toLocaleDateString("en-GB") : ""} to {data.dateTo ? new Date(data.dateTo).toLocaleDateString("en-GB") : ""} - {data.people.length} people - <span style={{color:"#00b8db"}}>{GL[data.granularity]} view</span>
            {loading && <span style={{marginLeft:"10px",display:"inline-block",width:"12px",height:"12px",borderRadius:"50%",border:"2px solid #e2e8f0",borderTopColor:"#00b8db",animation:"spin 0.6s linear infinite",verticalAlign:"middle"}}/>}
          </p>
        </div>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
          <button type="button" onClick={() => setShowAI(s => !s)} style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"8px 14px",borderRadius:"8px",border:`1.5px solid ${showAI?"#00b8db":"#e2e8f0"}`,background:showAI?"rgba(0,184,219,0.1)":"white",color:showAI?"#00b8db":"#64748b",fontSize:"12px",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>
            <span style={{fontSize:"14px"}}>*</span> Ask AI
          </button>
          <a href="/allocations/new" style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"8px 16px",borderRadius:"8px",background:"#00b8db",color:"white",fontSize:"13px",fontWeight:700,textDecoration:"none",boxShadow:"0 2px 10px rgba(0,184,219,0.3)"}}>+ Allocate resource</a>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px",marginBottom:"20px"}}>
        {[{l:"People",v:data.people.length,c:"#0f172a"},{l:"Avg util",v:`${avg}%`,c:avg>90?"#ef4444":avg>70?"#f59e0b":"#10b981"},{l:"Over-alloc",v:oa,c:oa>0?"#ef4444":"#10b981"},{l:"Total days",v:`${Math.round(td)}d`,c:"#0f172a"}].map(s=>(
          <div key={s.l} style={{background:"white",borderRadius:"10px",border:"1.5px solid #e2e8f0",padding:"12px 16px"}}>
            <div style={{fontSize:"10px",color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"4px"}}>{s.l}</div>
            <div style={{fontSize:"20px",fontWeight:800,color:String(s.c),fontFamily:"'DM Mono',monospace"}}>{String(s.v)}</div>
          </div>
        ))}
      </div>

      <div style={{display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap",marginBottom:"16px"}}>
        <GranToggle value={filters.granularity} onChange={g => setFilters(f => ({...f,granularity:g}))}/>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
          <input type="date" value={filters.dateFrom} onChange={e => setFilters(f => ({...f,dateFrom:e.target.value}))} style={{padding:"6px 10px",borderRadius:"7px",border:"1.5px solid #e2e8f0",fontSize:"12px",fontFamily:"inherit",color:"#0f172a",outline:"none"}}/>
          <span style={{fontSize:"12px",color:"#94a3b8"}}>to</span>
          <input type="date" value={filters.dateTo} onChange={e => setFilters(f => ({...f,dateTo:e.target.value}))} style={{padding:"6px 10px",borderRadius:"7px",border:"1.5px solid #e2e8f0",fontSize:"12px",fontFamily:"inherit",color:"#0f172a",outline:"none"}}/>
        </div>
        <button type="button" onClick={() => setShowF(s => !s)} style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:"8px",border:`1.5px solid ${showF||afc>0?"#00b8db":"#e2e8f0"}`,background:showF||afc>0?"rgba(0,184,219,0.08)":"white",color:afc>0?"#00b8db":"#475569",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
          Filters{afc>0&&<span style={{background:"#00b8db",color:"white",borderRadius:"10px",padding:"0 5px",fontSize:"10px",fontWeight:700}}>{afc}</span>}
        </button>
        <div style={{marginLeft:"auto",display:"flex",gap:"8px"}}>
          <button type="button" onClick={() => setExp(new Set(data.people.map(p => p.personId)))} style={{padding:"6px 12px",borderRadius:"7px",border:"1.5px solid #e2e8f0",background:"white",color:"#64748b",fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Expand all</button>
          <button type="button" onClick={() => setExp(new Set())} style={{padding:"6px 12px",borderRadius:"7px",border:"1.5px solid #e2e8f0",background:"white",color:"#64748b",fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>Collapse all</button>
        </div>
      </div>

      {showF && (
        <div style={{background:"white",border:"1.5px solid #e2e8f0",borderRadius:"12px",padding:"16px",marginBottom:"16px",display:"flex",flexDirection:"column",gap:"14px"}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"16px"}}>
            <MultiDropdown
              label="People"
              placeholder="All people"
              options={peopleOpts}
              selected={filters.personIds}
              onToggle={tP}
              renderSelected={() => `${filters.personIds.length} person${filters.personIds.length > 1 ? "s" : ""}`}
              renderOption={o => (
                <div style={{minWidth:0}}>
                  <div style={{fontSize:"12px",fontWeight:600,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.label}</div>
                  {o.sub&&<div style={{fontSize:"10px",color:"#94a3b8"}}>{o.sub}</div>}
                </div>
              )}
            />
            <MultiDropdown
              label="Project"
              placeholder="All projects"
              options={projectOpts}
              selected={filters.projectIds ?? []}
              onToggle={tPr}
              renderSelected={() => `${(filters.projectIds ?? []).length} project${(filters.projectIds ?? []).length > 1 ? "s" : ""}`}
              renderOption={o => (
                <div style={{minWidth:0,display:"flex",alignItems:"center",gap:"8px"}}>
                  <div style={{width:"3px",height:"20px",borderRadius:"2px",background:o.colour||"#00b8db",flexShrink:0}}/>
                  <div style={{minWidth:0}}>
                    {o.sub && <div style={{fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:o.colour||"#64748b"}}>{o.sub}</div>}
                    <div style={{fontSize:"12px",fontWeight:600,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.label}</div>
                  </div>
                </div>
              )}
            />
            {allDepartments.length > 0 && (
              <div>
                <label style={{...MLS}}>Department</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:"5px"}}>
                  {allDepartments.map(d => (
                    <button key={d} type="button" onClick={() => tD(d)} style={{padding:"4px 10px",borderRadius:"20px",border:"1.5px solid",borderColor:filters.departments.includes(d)?"#00b8db":"#e2e8f0",background:filters.departments.includes(d)?"rgba(0,184,219,0.1)":"white",color:filters.departments.includes(d)?"#00b8db":"#64748b",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      {d}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label style={{...MLS}}>Project status</label>
              <div style={{display:"flex",gap:"6px"}}>
                {[{v:"confirmed",c:"#00b8db",l:"Confirmed"},{v:"pipeline",c:"#7c3aed",l:"Pipeline"}].map(s => (
                  <button key={s.v} type="button" onClick={() => tS(s.v)} style={{padding:"5px 12px",borderRadius:"20px",border:"1.5px solid",borderColor:filters.statuses.includes(s.v)?s.c:"#e2e8f0",background:filters.statuses.includes(s.v)?`${s.c}15`:"white",color:filters.statuses.includes(s.v)?s.c:"#64748b",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                    {s.l}
                  </button>
                ))}
              </div>
            </div>
            {allRoles.length > 0 && (
              <div>
                <label style={{...MLS}}>Role</label>
                <div style={{display:"flex",flexWrap:"wrap",gap:"5px",maxHeight:"70px",overflowY:"auto"}}>
                  {allRoles.map(r => (
                    <button key={r} type="button" onClick={() => tR(r)} style={{padding:"4px 10px",borderRadius:"20px",border:"1.5px solid",borderColor:(filters.roles??[]).includes(r)?"#00b8db":"#e2e8f0",background:(filters.roles??[]).includes(r)?"rgba(0,184,219,0.1)":"white",color:(filters.roles??[]).includes(r)?"#00b8db":"#64748b",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"inherit"}}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {managerFilter?.active && <div style={{padding:"8px 12px",borderRadius:"8px",background:"rgba(0,184,219,0.08)",border:"1.5px solid rgba(0,184,219,0.2)",display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"11px",color:"#0e7490"}}><span><strong>Manager view:</strong> {managerFilter.directReportIds?.length ?? 0} direct reports</span><a href="/heatmap" style={{color:"#0e7490",fontWeight:700,textDecoration:"none"}}>Clear</a></div>}
          {afc > 0 && <button type="button" onClick={clr} style={{background:"none",border:"none",color:"#ef4444",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"inherit",padding:0,alignSelf:"flex-start"}}>Clear all filters</button>}
        </div>
      )}

      {ferr && <div style={{padding:"12px 16px",borderRadius:"9px",background:"#fef2f2",border:"1px solid #fecaca",color:"#dc2626",fontSize:"13px",marginBottom:"16px"}}>Failed to load: {ferr}</div>}

      <div className="hmc" style={{opacity:loading?0.7:1,transition:"opacity 0.2s"}}>
        <div style={{padding:"12px 16px 10px",borderBottom:"1px solid #f1f5f9",position:"sticky",top:0,background:"white",zIndex:10}}>
          <div style={{display:"flex",alignItems:"flex-end",marginBottom:"8px"}}>
            <div style={{width:PERSON_COL,minWidth:PERSON_COL,flexShrink:0}}>
              <div style={{fontSize:"10px",fontWeight:800,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"4px"}}>Person</div>
              <div style={{display:"grid",gridTemplateColumns:"22px 72px 1fr 80px",gap:"4px",paddingRight:"12px"}}>
                <div/><div style={{fontSize:"9px",fontWeight:700,color:"#d1d5db",textTransform:"uppercase",letterSpacing:"0.06em"}}>Code</div>
                <div style={{fontSize:"9px",fontWeight:700,color:"#d1d5db",textTransform:"uppercase",letterSpacing:"0.06em"}}>Project name</div>
                <div style={{fontSize:"9px",fontWeight:700,color:"#d1d5db",textTransform:"uppercase",letterSpacing:"0.06em"}}>Role</div>
              </div>
            </div>
            <div style={{overflow:"hidden",flex:1}}><PHeaders periods={data.periods} cw={cw}/></div>
          </div>
          <div style={{position:"relative"}}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, project code, project name, role or department..."
              style={{width:"100%",boxSizing:"border-box",padding:"7px 32px 7px 32px",borderRadius:"8px",border:"1.5px solid #e2e8f0",fontSize:"12px",fontFamily:"inherit",color:"#0f172a",outline:"none",background:"#f8fafc"}}
              onFocus={e=>{e.target.style.borderColor="#00b8db";e.target.style.background="white";}}
              onBlur={e=>{e.target.style.borderColor="#e2e8f0";e.target.style.background="#f8fafc";}}
            />
            <span style={{position:"absolute",left:"10px",top:"50%",transform:"translateY(-50%)",fontSize:"13px",color:"#94a3b8",pointerEvents:"none"}}>S</span>
            {search && <button type="button" onClick={() => setSearch("")} style={{position:"absolute",right:"8px",top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:"14px",lineHeight:1,padding:"2px 4px"}}>x</button>}
          </div>
          {search && <div style={{marginTop:"3px",fontSize:"11px",color:"#94a3b8"}}>{visiblePeople.length} of {data.people.length} people match</div>}
        </div>

        <div className="hmtw"><div className="hmti">
          {visiblePeople.length === 0
            ? <div style={{padding:"48px 0",textAlign:"center",color:"#94a3b8",fontSize:"14px"}}>{loading ? "Loading..." : search ? "No people match your search." : "No people match the current filters."}</div>
            : visiblePeople.map(p => (
                <HeatmapPersonRow
                  key={p.personId} person={p} periods={data.periods} cw={cw}
                  expanded={exp.has(p.personId)} onToggle={() => tE(p.personId)}
                  onCell={s => { setExp(e => new Set([...e, p.personId])); setEdit(s); }}
                />
              ))
          }
        </div></div>

        <div className="hmleg">
          {([{t:"low",l:"< 75% - available"},{t:"mid",l:"75-95% - busy"},{t:"high",l:"95-110% - at limit"},{t:"critical",l:"> 110% - over-allocated"}] as const).map(x => {
            const c = UC[x.t];
            return <div key={x.t} className="hmli"><div style={{width:"12px",height:"12px",borderRadius:"3px",background:c.bg,border:`1px solid ${c.border}`}}/>{x.l}</div>;
          })}
          <div className="hmli">
            <div style={{width:"12px",height:"12px",borderRadius:"3px",background:"#f8fafc",border:"1px solid rgba(99,102,241,0.35)",display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{width:"5px",height:"5px",borderRadius:"50%",background:"#818cf8"}}/>
            </div>
            Capacity exception (leave / public holiday)
          </div>
          {(data as any).exceptionCount > 0 && (
            <div className="hmli" style={{marginLeft:"auto",color:"#818cf8",fontSize:"10px"}}>
              {(data as any).exceptionCount} exception{(data as any).exceptionCount !== 1 ? "s" : ""} loaded
            </div>
          )}
        </div>
      </div>

      <PipeSection gaps={data.pipelineGaps} periods={data.periods} cw={cw}/>

    {/* -- Page-level allocation audit trail -- */}
    <div style={{ margin: "24px 0 0", padding: "20px 24px", background: "#ffffff", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
      <AllocationAuditTrail
        organisationId={(data as any).organisationId ?? undefined}
        title="Resource allocation history"
      />
    </div></div>

    {edit && <EditModal cell={edit} people={allPeople} projects={allProjects} onClose={() => setEdit(null)} onSaved={onSaved} onSaveError={showSaveErr}/>}
    {showAI && <AskAIPanel data={data} onClose={() => setShowAI(false)}/>}
  </>);
}