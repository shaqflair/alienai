"use client";
// FILE: src/app/heatmap/_components/HeatmapClient.tsx

import { useState, useCallback, useRef, useEffect, useTransition } from "react";
import type { HeatmapData, PersonRow, AllocationCell, Granularity, PeriodHeader, PipelineGapRow } from "../_lib/heatmap-query";
import { updateAllocation, deleteAllocationDirect } from "../../allocations/actions";

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

type CS={personId:string;personName:string;projectId:string;projectTitle:string;projectCode:string|null;colour:string;periodKey:string;startDate:string;endDate:string;daysAllocated:number;capacityDays:number;};
export type PersonOption={id:string;name:string;department:string|null;jobTitle:string|null;};
type PO={id:string;title:string;code:string|null;status:string;colour:string;};
type Filters={granularity:Granularity;dateFrom:string;dateTo:string;departments:string[];statuses:string[];personIds:string[];projectIds:string[];roles:string[];pmIds:string[];};

const MLS:React.CSSProperties={display:"block",fontSize:"10px",fontWeight:800,color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"5px"};
const MIS:React.CSSProperties={width:"100%",boxSizing:"border-box",padding:"8px 10px",borderRadius:"8px",border:"1.5px solid #e2e8f0",fontSize:"13px",color:"#0f172a",fontFamily:"inherit",outline:"none"};
const DDS:React.CSSProperties={position:"absolute",top:"100%",left:0,right:0,zIndex:100,background:"white",border:"1.5px solid #e2e8f0",borderRadius:"8px",boxShadow:"0 8px 24px rgba(0,0,0,0.1)",marginTop:"4px",overflow:"hidden"};
const DIS:React.CSSProperties={width:"100%",textAlign:"left",padding:"8px 12px",border:"none",borderBottom:"1px solid #f8fafc",background:"white",cursor:"pointer",fontSize:"12px",display:"flex",alignItems:"center",gap:"4px",fontFamily:"inherit"};

/* ── Edit Modal ─────────────────────────────────────────────────────── */
function EditModal({cell,people,projects,onClose,onSaved}:{cell:CS;people:PersonOption[];projects:PO[];onClose:()=>void;onSaved:(a:string,b:string,c:string,d:string,e:number,f:string)=>void;}){
  const CAPS=[0.5,1,1.5,2,2.5,3,3.5,4,4.5,5];
  const[pid,setPid]=useState(cell.personId);
  const[prid,setPrid]=useState(cell.projectId);
  const[sd,setSd]=useState(cell.startDate);
  const[ed,setEd]=useState(cell.endDate);
  const[dpw,setDpw]=useState(cell.daysAllocated>0?cell.daysAllocated:5);
  const[at,setAt]=useState<"confirmed"|"soft">("confirmed");
  const[err,setErr]=useState<string|null>(null);
  const[pend,startT]=useTransition();
  const[showDel,setShowDel]=useState(false);
  const[ps,setPs]=useState(cell.personName);
  const[prs,setPrs]=useState(cell.projectCode?`${cell.projectCode} - ${cell.projectTitle}`:cell.projectTitle);
  const[spd,setSpd]=useState(false);
  const[sprd,setSprd]=useState(false);
  const fp=people.filter(p=>p.name.toLowerCase().includes(ps.toLowerCase())||(p.jobTitle??"").toLowerCase().includes(ps.toLowerCase())).slice(0,8);
  const fpr=projects.filter(p=>p.title.toLowerCase().includes(prs.toLowerCase())||(p.code??"").toLowerCase().includes(prs.toLowerCase())).slice(0,8);
  const wk=(()=>{if(!sd||!ed||sd>ed)return 0;return Math.round((new Date(ed).getTime()-new Date(sd).getTime())/(7*86400000))+1;})();
  function save(){setErr(null);const fd=new FormData();fd.set("person_id",pid);fd.set("project_id",prid);fd.set("start_date",sd);fd.set("end_date",ed);fd.set("days_per_week",String(dpw));fd.set("allocation_type",at);fd.set("return_to","/heatmap");startT(async()=>{try{await updateAllocation(fd);onSaved(pid,prid,sd,ed,dpw,at);}catch(e:any){setErr(e.message||"Failed");}});}
  function del(){const fd=new FormData();fd.set("person_id",cell.personId);fd.set("project_id",cell.projectId);fd.set("return_to","/heatmap");startT(async()=>{try{await deleteAllocationDirect(fd);onSaved(cell.personId,cell.projectId,"","",0,"");}catch(e:any){setErr(e.message||"Failed");}});}
  const ac=projects.find(p=>p.id===prid)?.colour??cell.colour??"#00b8db";
  return(
    <div onClick={e=>{if(e.target===e.currentTarget)onClose();}} style={{position:"fixed",inset:0,zIndex:2000,background:"rgba(15,23,42,0.5)",backdropFilter:"blur(3px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"20px",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{background:"white",borderRadius:"16px",border:`1.5px solid ${ac}30`,width:"100%",maxWidth:"440px",boxShadow:`0 20px 60px rgba(0,0,0,0.15),0 0 0 4px ${ac}10`}}>
        <div style={{padding:"16px 20px 12px",borderBottom:"1px solid #f1f5f9",background:`linear-gradient(135deg,${ac}08 0%,transparent 60%)`,borderRadius:"16px 16px 0 0",display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div><div style={{fontSize:"15px",fontWeight:800,color:"#0f172a"}}>Edit allocation</div><div style={{fontSize:"11px",color:"#94a3b8",marginTop:"2px"}}>{cell.daysAllocated}d allocated{cell.capacityDays>0?` / ${cell.capacityDays}d capacity (${Math.round((cell.daysAllocated/cell.capacityDays)*100)}%)`:"" as any}</div></div>
          <button onClick={onClose} style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:"18px",padding:"2px 6px"}}>x</button>
        </div>
        <div style={{padding:"16px 20px",display:"flex",flexDirection:"column",gap:"14px"}}>
          {err&&<div style={{padding:"8px 12px",borderRadius:"8px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",color:"#dc2626",fontSize:"12px"}}>{err}</div>}
          <div style={{position:"relative"}}><label style={MLS}>Person</label><input value={ps} onChange={e=>{setPs(e.target.value);setSpd(true);}} onFocus={()=>setSpd(true)} placeholder="Search people..." style={MIS}/>{spd&&fp.length>0&&<div style={DDS}>{fp.map(p=><button key={p.id} type="button" onClick={()=>{setPid(p.id);setPs(p.name);setSpd(false);}} style={{...DIS,background:p.id===pid?"rgba(0,184,219,0.08)":"white"}}><span style={{fontWeight:600,color:"#0f172a"}}>{p.name}</span>{p.jobTitle&&<span style={{color:"#94a3b8",fontSize:"11px"}}> - {p.jobTitle}</span>}</button>)}</div>}</div>
          <div style={{position:"relative"}}><label style={MLS}>Project</label><input value={prs} onChange={e=>{setPrs(e.target.value);setSprd(true);}} onFocus={()=>setSprd(true)} placeholder="Search projects..." style={MIS}/>{sprd&&fpr.length>0&&<div style={DDS}>{fpr.map(p=><button key={p.id} type="button" onClick={()=>{setPrid(p.id);setPrs(p.code?`${p.code} - ${p.title}`:p.title);setSprd(false);}} style={{...DIS,background:p.id===prid?"rgba(0,184,219,0.08)":"white"}}>{p.code&&<span style={{fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:"#64748b",marginRight:"6px"}}>{p.code}</span>}<span style={{fontWeight:600,color:"#0f172a"}}>{p.title}</span><span style={{marginLeft:"auto",fontSize:"10px",fontWeight:700,color:p.status==="confirmed"?"#059669":"#7c3aed",textTransform:"capitalize"}}>{p.status}</span></button>)}</div>}</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}><div><label style={MLS}>Start date</label><input type="date" value={sd} onChange={e=>setSd(e.target.value)} style={MIS}/></div><div><label style={MLS}>End date</label><input type="date" value={ed} onChange={e=>setEd(e.target.value)} style={MIS}/></div></div>
          {wk>0&&<div style={{fontSize:"11px",color:"#94a3b8",marginTop:"-8px"}}>{wk}w - {Math.round(wk*dpw*10)/10}d total</div>}
          <div><label style={MLS}>Days / week</label><div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>{CAPS.map(d=><button key={d} type="button" onClick={()=>setDpw(d)} style={{padding:"6px 10px",borderRadius:"7px",border:`1.5px solid ${dpw===d?"#00b8db":"#e2e8f0"}`,background:dpw===d?"rgba(0,184,219,0.1)":"white",color:dpw===d?"#0e7490":"#475569",fontSize:"12px",fontWeight:dpw===d?800:500,cursor:"pointer"}}>{d}</button>)}</div></div>
          <div><label style={MLS}>Type</label><div style={{display:"flex",gap:"8px"}}>{(["confirmed","soft"] as const).map(t=><button key={t} type="button" onClick={()=>setAt(t)} style={{flex:1,padding:"7px",borderRadius:"7px",border:`1.5px solid ${at===t?"#00b8db":"#e2e8f0"}`,background:at===t?"rgba(0,184,219,0.08)":"white",color:at===t?"#0e7490":"#64748b",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>{t==="confirmed"?"Confirmed":"Soft"}</button>)}</div></div>
        </div>
        <div style={{padding:"12px 20px 16px",borderTop:"1px solid #f1f5f9",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          {!showDel?<button onClick={()=>setShowDel(true)} style={{background:"none",border:"none",color:"#ef4444",fontSize:"12px",fontWeight:600,cursor:"pointer",padding:0}}>Remove allocation</button>:<div style={{display:"flex",gap:"8px",alignItems:"center"}}><span style={{fontSize:"12px",color:"#ef4444",fontWeight:600}}>Remove all weeks?</span><button onClick={del} disabled={pend} style={{padding:"5px 12px",borderRadius:"6px",border:"none",background:"#ef4444",color:"white",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>Yes</button><button onClick={()=>setShowDel(false)} style={{padding:"5px 12px",borderRadius:"6px",border:"1px solid #e2e8f0",background:"white",fontSize:"12px",color:"#64748b",cursor:"pointer"}}>Cancel</button></div>}
          <div style={{display:"flex",gap:"8px"}}><button onClick={onClose} style={{padding:"8px 16px",borderRadius:"8px",border:"1.5px solid #e2e8f0",background:"white",fontSize:"12px",fontWeight:600,color:"#475569",cursor:"pointer"}}>Cancel</button><button onClick={save} disabled={pend||!pid||!prid||!sd||!ed} style={{padding:"8px 18px",borderRadius:"8px",border:"none",background:pend||!pid||!prid?"#e2e8f0":"#00b8db",color:pend||!pid||!prid?"#94a3b8":"white",fontSize:"12px",fontWeight:800,cursor:pend||!pid||!prid?"not-allowed":"pointer"}}>{pend?"Saving...":"Save changes"}</button></div>
        </div>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────────── */
function Avatar({name,size=30}:{name:string;size?:number}){return<div style={{width:size,height:size,borderRadius:"50%",background:avcol(name),color:"#fff",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:size*0.33,fontWeight:800,fontFamily:"'DM Sans',sans-serif"}}>{ini(name)}</div>;}
function UtilBadge({pct}:{pct:number}){const c=UC[tier(pct)];if(pct===0)return null;return<span style={{fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",background:c.bg,color:c.text,border:`1px solid ${c.border}`,borderRadius:"4px",padding:"1px 5px"}}>{ulabel(pct)}</span>;}
function GranToggle({value,onChange}:{value:Granularity;onChange:(g:Granularity)=>void}){return<div style={{display:"flex",background:"#f1f5f9",borderRadius:"8px",padding:"3px",gap:"2px"}}>{(["weekly","sprint","monthly","quarterly"] as Granularity[]).map(g=><button key={g} type="button" onClick={()=>onChange(g)} style={{padding:"5px 12px",borderRadius:"6px",border:"none",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",background:value===g?"white":"transparent",color:value===g?"#0f172a":"#64748b",boxShadow:value===g?"0 1px 4px rgba(0,0,0,0.08)":"none"}}>{GL[g]}</button>)}</div>;}
function Chip({label,active,colour,onClick}:{label:string;active:boolean;colour?:string;onClick:()=>void}){const c=colour||"#00b8db";return<button type="button" onClick={onClick} style={{display:"inline-flex",alignItems:"center",gap:"5px",padding:"4px 10px",borderRadius:"20px",border:"1.5px solid",borderColor:active?c:"#e2e8f0",background:active?`${c}15`:"white",color:active?c:"#64748b",fontSize:"12px",fontWeight:600,fontFamily:"'DM Sans',sans-serif",cursor:"pointer"}}>{label}</button>;}

/* HeatmapCell: shows utilisation % + indigo dot for leave/exception */
function HCell({cell,cw,cur}:{cell:AllocationCell|null;cw:number;cur:boolean}){
  const pct=cell?.utilisationPct??0,c=UC[tier(pct)],ex=cell?.hasException??false;
  return<div title={cell?`${cell.daysAllocated}d / ${cell.capacityDays}d (${pct}%)${ex?" - Reduced capacity (leave/exception)":""}`:ex?"Reduced capacity":"No allocation"} style={{width:cw-2,minWidth:cw-2,height:"34px",borderRadius:"5px",background:cur&&pct===0?"rgba(0,184,219,0.04)":c.bg,border:`1px solid ${ex?"rgba(99,102,241,0.35)":cur?"rgba(0,184,219,0.2)":c.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:pct===0?(ex?"#a5b4fc":"#e2e8f0"):c.text,cursor:cell&&cell.allocationIds.length>0?"pointer":"default",transition:"all 0.1s",position:"relative",flexShrink:0}}>
    {pct>0?ulabel(pct):"--"}
    {ex&&<div style={{position:"absolute",top:"3px",right:"3px",width:"5px",height:"5px",borderRadius:"50%",background:"#818cf8",boxShadow:"0 0 0 1px white"}}/>}
    {pct>0&&<div style={{position:"absolute",bottom:0,left:0,height:"3px",borderRadius:"0 0 4px 4px",width:`${Math.min(pct,100)}%`,background:c.text,opacity:0.4,transition:"width 0.3s"}}/>}
  </div>;
}
function PipeCell({cell,cw,cur}:{cell:PipelineGapRow["cells"][number]|null;cw:number;cur:boolean}){
  const hg=cell&&cell.gapDays>0,hd=cell&&cell.demandDays>0;
  return<div title={cell?`Demand:${cell.demandDays}d/Gap:${cell.gapDays}d`:"No demand"} style={{width:cw-2,minWidth:cw-2,height:"34px",borderRadius:"5px",background:hg?"rgba(239,68,68,0.06)":hd?"rgba(124,58,237,0.07)":"#f8fafc",border:`1.5px dashed ${hg?"rgba(239,68,68,0.3)":hd?"rgba(124,58,237,0.3)":"#e2e8f0"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:hg?"#dc2626":hd?"#7c3aed":"#cbd5e1",flexShrink:0}}>{hd?(hg?`-${cell!.gapDays}d`:`${cell!.demandDays}d`):"--"}</div>;
}
function PHeaders({periods,cw}:{periods:PeriodHeader[];cw:number}){return<div style={{display:"flex",gap:"2px"}}>{periods.map(p=><div key={p.key} style={{width:cw,minWidth:cw,flexShrink:0,textAlign:"center",padding:"0 2px"}}>{p.subLabel&&<div style={{fontSize:"9px",fontWeight:700,color:"#94a3b8",fontFamily:"'DM Mono',monospace",marginBottom:"1px"}}>{p.subLabel}</div>}<div style={{fontSize:"11px",fontWeight:p.isCurrentPeriod?800:500,color:p.isCurrentPeriod?"#00b8db":"#475569",fontFamily:"'DM Sans',sans-serif",background:p.isCurrentPeriod?"rgba(0,184,219,0.08)":"transparent",borderRadius:"5px",padding:"2px 0"}}>{p.label}</div></div>)}</div>;}

function PersonRow({person,periods,cw,expanded,onToggle,onCell}:{person:PersonRow;periods:PeriodHeader[];cw:number;expanded:boolean;onToggle:()=>void;onCell:(s:CS)=>void}){
  return(<div style={{borderBottom:"1px solid #f1f5f9"}}>
    <div style={{display:"flex",alignItems:"center",padding:"6px 0",cursor:"pointer",background:expanded?"rgba(0,184,219,0.02)":"transparent"}} onClick={onToggle}>
      <div style={{width:"220px",minWidth:"220px",flexShrink:0,display:"flex",alignItems:"center",gap:"8px",paddingRight:"12px"}}>
        <span style={{fontSize:"12px",color:"#94a3b8",transform:expanded?"rotate(90deg)":"rotate(0deg)",transition:"transform 0.2s",display:"inline-block",width:"14px",flexShrink:0}}>{">"}</span>
        <Avatar name={person.fullName} size={28}/>
        <div style={{minWidth:0}}><div style={{fontSize:"13px",fontWeight:600,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{person.fullName}</div><div style={{fontSize:"10px",color:"#94a3b8",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{person.jobTitle||person.department||"--"}{person.employmentType==="part_time"&&<span style={{color:"#f59e0b",marginLeft:"4px",fontWeight:600}}>PT</span>}</div></div>
        <div style={{marginLeft:"auto",flexShrink:0}}><UtilBadge pct={person.avgUtilisationPct}/></div>
      </div>
      <div style={{display:"flex",gap:"2px"}}>{periods.map(p=>{const c=person.summaryCells.find(c=>c.periodKey===p.key)??null;return<HCell key={p.key} cell={c} cw={cw} cur={p.isCurrentPeriod}/>;})}</div>
    </div>
    {expanded&&<div style={{paddingLeft:"220px",paddingBottom:"4px"}}>
      {person.projects.length===0?<div style={{padding:"8px 0",fontSize:"12px",color:"#94a3b8",fontStyle:"italic"}}>No allocations in this period</div>:person.projects.map(proj=>(
        <div key={proj.projectId} style={{display:"flex",alignItems:"center",padding:"3px 0",gap:"2px",position:"relative"}}>
          <div style={{position:"absolute",left:"-218px",width:"214px",display:"flex",alignItems:"center",gap:"6px",paddingRight:"8px",overflow:"hidden"}}>
            <div style={{width:"3px",height:"20px",borderRadius:"2px",background:proj.colour,flexShrink:0}}/>
            <div style={{minWidth:0,overflow:"hidden"}}><div style={{fontSize:"11px",fontWeight:600,color:proj.colour,fontFamily:"'DM Mono',monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{proj.projectCode||proj.projectTitle.slice(0,10)}</div>{proj.roleOnProject&&<div style={{fontSize:"10px",color:"#94a3b8",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{proj.roleOnProject}</div>}</div>
          </div>
          <div style={{display:"flex",gap:"2px"}}>{periods.map(p=>{const c=proj.cells.find(c=>c.periodKey===p.key);if(!c||c.daysAllocated===0)return<div key={p.key} style={{width:cw-2,minWidth:cw-2,height:"26px",flexShrink:0}}/>;return<div key={p.key} title={`${c.daysAllocated}d - click to edit`} onClick={()=>onCell({personId:person.personId,personName:person.fullName,projectId:proj.projectId,projectTitle:proj.projectTitle,projectCode:proj.projectCode,colour:proj.colour,periodKey:p.key,startDate:p.startDate,endDate:p.endDate,daysAllocated:c.daysAllocated,capacityDays:c.capacityDays})} style={{width:cw-2,minWidth:cw-2,height:"26px",borderRadius:"4px",flexShrink:0,background:`${proj.colour}15`,border:`1px solid ${proj.colour}30`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:700,fontFamily:"'DM Mono',monospace",color:proj.colour,cursor:"pointer",transition:"all 0.1s"}} onMouseEnter={e=>{const d=e.currentTarget as HTMLDivElement;d.style.background=`${proj.colour}30`;d.style.transform="scale(1.05)";}} onMouseLeave={e=>{const d=e.currentTarget as HTMLDivElement;d.style.background=`${proj.colour}15`;d.style.transform="scale(1)";}}>{c.daysAllocated}d</div>;})}</div>
        </div>
      ))}
      <div style={{padding:"4px 0 6px"}}><a href={`/allocations/new?person_id=${person.personId}&return_to=/heatmap`} style={{fontSize:"11px",color:"#00b8db",fontWeight:600,textDecoration:"none"}}>+ Allocate to project</a></div>
    </div>}
  </div>);
}

function PipeSection({gaps,periods,cw}:{gaps:PipelineGapRow[];periods:PeriodHeader[];cw:number}){
  const[open,setOpen]=useState(false);if(!gaps.length)return null;
  return(<div style={{marginTop:"16px",border:"1.5px dashed #c4b5fd",borderRadius:"12px",overflow:"hidden"}}>
    <div style={{padding:"10px 16px",background:"rgba(124,58,237,0.04)",display:"flex",alignItems:"center",gap:"10px",cursor:"pointer"}} onClick={()=>setOpen(o=>!o)}>
      <div style={{flex:1}}><div style={{fontSize:"13px",fontWeight:700,color:"#7c3aed"}}>Pipeline projects - capacity gap analysis</div><div style={{fontSize:"11px",color:"#94a3b8"}}>{gaps.length} project{gaps.length>1?"s":""} - Dashed cells show demand vs available capacity</div></div>
      <span style={{fontSize:"14px",color:"#94a3b8",transform:open?"rotate(180deg)":"rotate(0deg)",transition:"transform 0.2s",display:"inline-block"}}>v</span>
    </div>
    {open&&<div style={{padding:"12px 16px"}}>
      <div style={{display:"flex",marginBottom:"8px"}}><div style={{width:"220px",minWidth:"220px",flexShrink:0}}/><PHeaders periods={periods} cw={cw}/></div>
      {gaps.map(proj=>(<div key={proj.projectId} style={{display:"flex",alignItems:"center",padding:"4px 0",borderTop:"1px solid #f5f0ff"}}>
        <div style={{width:"220px",minWidth:"220px",flexShrink:0,display:"flex",alignItems:"center",gap:"8px",paddingRight:"12px"}}>
          <div style={{width:"3px",height:"32px",borderRadius:"2px",background:proj.colour,flexShrink:0}}/><div style={{minWidth:0}}><div style={{fontSize:"12px",fontWeight:700,color:"#0f172a",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{proj.projectTitle}</div><div style={{display:"flex",gap:"6px",alignItems:"center"}}>{proj.projectCode&&<span style={{fontSize:"10px",fontFamily:"'DM Mono',monospace",color:proj.colour,fontWeight:700}}>{proj.projectCode}</span>}<span style={{fontSize:"10px",color:"#94a3b8"}}>{proj.winProbability}% win</span></div></div>
        </div>
        <div style={{display:"flex",gap:"2px"}}>{periods.map(p=><PipeCell key={p.key} cell={proj.cells.find(c=>c.periodKey===p.key)??null} cw={cw} cur={p.isCurrentPeriod}/>)}</div>
      </div>))}
    </div>}
  </div>);
}

/* ── Main Component ──────────────────────────────────────────────────── */
export default function HeatmapClient({initialData,allPeople,allDepartments,allProjects,allRoles,allPMs,initialFilters,managerFilter}:{initialData:HeatmapData;allPeople:PersonOption[];allDepartments:string[];allProjects:PO[];allRoles:string[];allPMs:PersonOption[];initialFilters:Filters;managerFilter?:any;}){
  const[data,setData]=useState<HeatmapData>(initialData);
  const[filters,setFilters]=useState<Filters>(initialFilters);
  const[exp,setExp]=useState<Set<string>>(new Set());
  const[loading,setLoading]=useState(false);
  const[ferr,setFerr]=useState<string|null>(null);
  const[showF,setShowF]=useState(false);
  const[edit,setEdit]=useState<CS|null>(null);
  const abrt=useRef<AbortController|null>(null);
  const cw=CW[filters.granularity];

  function bp(f:Filters){const p=new URLSearchParams();p.set("granularity",f.granularity);p.set("dateFrom",f.dateFrom);p.set("dateTo",f.dateTo);f.departments.forEach(d=>p.append("dept",d));f.statuses.forEach(s=>p.append("status",s));[...new Set([...f.personIds,...f.pmIds])].forEach(id=>p.append("person",id));(f.projectIds??[]).forEach(id=>p.append("project",id));return p;}

  const fetchData=useCallback(async(f:Filters)=>{
    if(abrt.current)abrt.current.abort();abrt.current=new AbortController();
    setLoading(true);setFerr(null);
    try{const res=await fetch(`/api/heatmap/data?${bp(f)}`,{signal:abrt.current.signal});if(!res.ok)throw new Error(`HTTP ${res.status}`);const json=await res.json();if((f.roles??[]).length>0){json.people=(json.people??[]).filter((p:any)=>(f.roles??[]).some(r=>p.jobTitle&&p.jobTitle.toLowerCase().includes(r.toLowerCase())));}setData(json);}
    catch(e:any){if(e.name!=="AbortError")setFerr(e.message);}finally{setLoading(false);}
  },[]);

  useEffect(()=>{fetchData(filters);},[filters,fetchData]);

  // FIX: close modal instantly, refetch silently in background (no loading flash)
  function onSaved(_a:string,_b:string,_c:string,_d:string,_e:number,_f:string){
    setEdit(null);
    if(abrt.current)abrt.current.abort();abrt.current=new AbortController();
    const f=filters;
    fetch(`/api/heatmap/data?${bp(f)}`,{signal:abrt.current.signal}).then(r=>r.ok?r.json():null).then(json=>{if(!json)return;if((f.roles??[]).length>0){json.people=(json.people??[]).filter((p:any)=>(f.roles??[]).some(r=>p.jobTitle&&p.jobTitle.toLowerCase().includes(r.toLowerCase())));}setData(json);}).catch(()=>{});
  }

  const tD=(d:string)=>setFilters(f=>({...f,departments:f.departments.includes(d)?f.departments.filter(x=>x!==d):[...f.departments,d]}));
  const tS=(s:string)=>setFilters(f=>({...f,statuses:f.statuses.includes(s)?f.statuses.filter(x=>x!==s):[...f.statuses,s]}));
  const tP=(id:string)=>setFilters(f=>({...f,personIds:f.personIds.includes(id)?f.personIds.filter(x=>x!==id):[...f.personIds,id]}));
  const tPr=(id:string)=>setFilters(f=>({...f,projectIds:(f.projectIds??[]).includes(id)?(f.projectIds??[]).filter(x=>x!==id):[...(f.projectIds??[]),id]}));
  const tR=(r:string)=>setFilters(f=>({...f,roles:(f.roles??[]).includes(r)?(f.roles??[]).filter(x=>x!==r):[...(f.roles??[]),r]}));
  const tPM=(id:string)=>setFilters(f=>({...f,pmIds:(f.pmIds??[]).includes(id)?(f.pmIds??[]).filter(x=>x!==id):[...(f.pmIds??[]),id]}));
  const clr=()=>setFilters(f=>({...f,departments:[],statuses:[],personIds:[],projectIds:[],roles:[],pmIds:[]}));
  const afc=filters.departments.length+filters.statuses.length+filters.personIds.length+(filters.projectIds??[]).length+(filters.roles??[]).length+(filters.pmIds??[]).length;
  const tE=(id:string)=>setExp(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const avg=data.people.length?Math.round(data.people.reduce((s,p)=>s+p.avgUtilisationPct,0)/data.people.length):0;
  const oa=data.people.filter(p=>p.peakUtilisationPct>100).length;
  const td=data.people.reduce((s,p)=>s+p.summaryCells.reduce((ss,c)=>ss+c.daysAllocated,0),0);

  return(<>
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
      .hmr{font-family:'DM Sans',sans-serif;min-height:100vh;background:#f8fafc;color:#0f172a;}
      .hmi{max-width:1400px;margin:0 auto;padding:32px 28px;}
      .hmc{background:white;border-radius:14px;border:1.5px solid #e2e8f0;overflow:hidden;box-shadow:0 1px 8px rgba(0,0,0,0.04);}
      .hmtw{overflow-x:auto;}.hmti{min-width:max-content;padding:0 16px 16px;}
      .hmfp{background:white;border:1.5px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;display:flex;flex-direction:column;gap:14px;}
      .hmfgl{font-size:10px;font-weight:800;color:#94a3b8;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;}
      .hmch{display:flex;flex-wrap:wrap;gap:6px;}
      .hmleg{display:flex;gap:16px;flex-wrap:wrap;padding:10px 16px;border-top:1px solid #f1f5f9;background:#fafafa;}
      .hmli{display:flex;align-items:center;gap:6px;font-size:11px;color:#64748b;}
      @keyframes spin{to{transform:rotate(360deg);}}
    `}</style>
    <div className="hmr"><div className="hmi">
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"24px",flexWrap:"wrap",gap:"12px"}}>
        <div><h1 style={{fontSize:"22px",fontWeight:800,color:"#0f172a",margin:0,marginBottom:"4px"}}>Resource Heatmap</h1>
        <p style={{fontSize:"13px",color:"#94a3b8",margin:0}}>{data.dateFrom?new Date(data.dateFrom).toLocaleDateString("en-GB"):""} to {data.dateTo?new Date(data.dateTo).toLocaleDateString("en-GB"):""} - {data.people.length} people - <span style={{color:"#00b8db"}}>{GL[data.granularity]} view</span>{loading&&<span style={{marginLeft:"10px",display:"inline-block",width:"12px",height:"12px",borderRadius:"50%",border:"2px solid #e2e8f0",borderTopColor:"#00b8db",animation:"spin 0.6s linear infinite",verticalAlign:"middle"}}/>}</p></div>
        <a href="/allocations/new" style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"8px 16px",borderRadius:"8px",background:"#00b8db",color:"white",fontSize:"13px",fontWeight:700,textDecoration:"none",boxShadow:"0 2px 10px rgba(0,184,219,0.3)"}}>+ Allocate resource</a>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px",marginBottom:"20px"}}>
        {[{l:"People",v:data.people.length,c:"#0f172a"},{l:"Avg util",v:`${avg}%`,c:avg>90?"#ef4444":avg>70?"#f59e0b":"#10b981"},{l:"Over-alloc",v:oa,c:oa>0?"#ef4444":"#10b981"},{l:"Total days",v:`${Math.round(td)}d`,c:"#0f172a"}].map(s=>(
          <div key={s.l} style={{background:"white",borderRadius:"10px",border:"1.5px solid #e2e8f0",padding:"12px 16px"}}><div style={{fontSize:"10px",color:"#94a3b8",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:"4px"}}>{s.l}</div><div style={{fontSize:"20px",fontWeight:800,color:String(s.c),fontFamily:"'DM Mono',monospace"}}>{String(s.v)}</div></div>
        ))}
      </div>
      <div style={{display:"flex",alignItems:"center",gap:"12px",flexWrap:"wrap",marginBottom:"16px"}}>
        <GranToggle value={filters.granularity} onChange={g=>setFilters(f=>({...f,granularity:g}))}/>
        <div style={{display:"flex",gap:"8px",alignItems:"center"}}><input type="date" value={filters.dateFrom} onChange={e=>setFilters(f=>({...f,dateFrom:e.target.value}))} style={{padding:"6px 10px",borderRadius:"7px",border:"1.5px solid #e2e8f0",fontSize:"12px",fontFamily:"'DM Sans',sans-serif",color:"#0f172a",outline:"none"}}/><span style={{fontSize:"12px",color:"#94a3b8"}}>to</span><input type="date" value={filters.dateTo} onChange={e=>setFilters(f=>({...f,dateTo:e.target.value}))} style={{padding:"6px 10px",borderRadius:"7px",border:"1.5px solid #e2e8f0",fontSize:"12px",fontFamily:"'DM Sans',sans-serif",color:"#0f172a",outline:"none"}}/></div>
        <button type="button" onClick={()=>setShowF(s=>!s)} style={{display:"inline-flex",alignItems:"center",gap:"6px",padding:"7px 14px",borderRadius:"8px",border:`1.5px solid ${showF||afc>0?"#00b8db":"#e2e8f0"}`,background:showF||afc>0?"rgba(0,184,219,0.08)":"white",color:afc>0?"#00b8db":"#475569",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Filters{afc>0&&<span style={{background:"#00b8db",color:"white",borderRadius:"10px",padding:"0 5px",fontSize:"10px",fontWeight:700}}>{afc}</span>}</button>
        <div style={{marginLeft:"auto",display:"flex",gap:"8px"}}><button type="button" onClick={()=>setExp(new Set(data.people.map(p=>p.personId)))} style={{padding:"6px 12px",borderRadius:"7px",border:"1.5px solid #e2e8f0",background:"white",color:"#64748b",fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Expand all</button><button type="button" onClick={()=>setExp(new Set())} style={{padding:"6px 12px",borderRadius:"7px",border:"1.5px solid #e2e8f0",background:"white",color:"#64748b",fontSize:"11px",fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif"}}>Collapse all</button></div>
      </div>
      {showF&&<div className="hmfp"><div style={{display:"flex",gap:"32px",flexWrap:"wrap"}}>
        {allDepartments.length>0&&<div><div className="hmfgl">Department</div><div className="hmch">{allDepartments.map(d=><Chip key={d} label={d} active={filters.departments.includes(d)} onClick={()=>tD(d)}/>)}</div></div>}
        <div><div className="hmfgl">Project status</div><div className="hmch"><Chip label="Confirmed" active={filters.statuses.includes("confirmed")} colour="#00b8db" onClick={()=>tS("confirmed")}/><Chip label="Pipeline" active={filters.statuses.includes("pipeline")} colour="#7c3aed" onClick={()=>tS("pipeline")}/></div></div>
        {allPeople.length>0&&<div style={{flex:1,minWidth:"200px"}}><div className="hmfgl">People</div><div className="hmch" style={{maxHeight:"80px",overflowY:"auto"}}>{allPeople.map(p=><Chip key={p.id} label={p.name.split(" ")[0]} active={filters.personIds.includes(p.id)} onClick={()=>tP(p.id)}/>)}</div></div>}
        {allProjects.length>0&&<div style={{flex:1,minWidth:"220px"}}><div className="hmfgl">Project</div><div className="hmch" style={{maxHeight:"80px",overflowY:"auto"}}>{allProjects.map(p=><Chip key={p.id} label={p.code?`[${p.code}] ${p.title}`:p.title} active={(filters.projectIds??[]).includes(p.id)} colour={p.status==="pipeline"?"#7c3aed":"#00b8db"} onClick={()=>tPr(p.id)}/>)}</div></div>}
        {allRoles.length>0&&<div style={{flex:1,minWidth:"200px"}}><div className="hmfgl">Role</div><div className="hmch" style={{maxHeight:"80px",overflowY:"auto"}}>{allRoles.map(r=><Chip key={r} label={r} active={(filters.roles??[]).includes(r)} onClick={()=>tR(r)}/>)}</div></div>}
        {allPMs.length>0&&<div style={{flex:1,minWidth:"200px"}}><div className="hmfgl">PM / Manager</div><div className="hmch" style={{maxHeight:"80px",overflowY:"auto"}}>{allPMs.map(p=><Chip key={p.id} label={p.name} active={(filters.pmIds??[]).includes(p.id)} onClick={()=>tPM(p.id)}/>)}</div></div>}
      </div>
      {managerFilter?.active&&<div style={{padding:"8px 12px",borderRadius:"8px",background:"rgba(0,184,219,0.08)",border:"1.5px solid rgba(0,184,219,0.2)",display:"flex",alignItems:"center",justifyContent:"space-between",fontSize:"11px",color:"#0e7490"}}><span><strong>Manager view:</strong> showing {managerFilter.directReportIds?.length??0} direct reports</span><a href="/heatmap" style={{color:"#0e7490",fontWeight:700,textDecoration:"none"}}>Clear</a></div>}
      {afc>0&&<div><button type="button" onClick={clr} style={{background:"none",border:"none",color:"#ef4444",fontSize:"12px",fontWeight:600,cursor:"pointer",fontFamily:"'DM Sans',sans-serif",padding:0}}>Clear all filters</button></div>}
      </div>}
      {ferr&&<div style={{padding:"12px 16px",borderRadius:"9px",background:"#fef2f2",border:"1px solid #fecaca",color:"#dc2626",fontSize:"13px",marginBottom:"16px"}}>Failed to load: {ferr}</div>}
      <div className="hmc" style={{opacity:loading?0.7:1,transition:"opacity 0.2s"}}>
        <div style={{padding:"12px 16px 8px",borderBottom:"1px solid #f1f5f9",display:"flex",alignItems:"flex-end",position:"sticky",top:0,background:"white",zIndex:10}}><div style={{width:"220px",minWidth:"220px",flexShrink:0,fontSize:"10px",fontWeight:800,color:"#94a3b8",letterSpacing:"0.08em",textTransform:"uppercase"}}>PERSON</div><div style={{overflow:"hidden",flex:1}}><PHeaders periods={data.periods} cw={cw}/></div></div>
        <div className="hmtw"><div className="hmti">{data.people.length===0?<div style={{padding:"48px 0",textAlign:"center",color:"#94a3b8",fontSize:"14px"}}>{loading?"Loading...":"No people match the current filters."}</div>:data.people.map(p=><PersonRow key={p.personId} person={p} periods={data.periods} cw={cw} expanded={exp.has(p.personId)} onToggle={()=>tE(p.personId)} onCell={s=>{setExp(e=>new Set([...e,p.personId]));setEdit(s);}}/>)}</div></div>
        <div className="hmleg">
          {([{t:"low",l:"< 75% - available"},{t:"mid",l:"75-95% - busy"},{t:"high",l:"95-110% - at limit"},{t:"critical",l:"> 110% - over-allocated"}] as const).map(x=>{const c=UC[x.t];return<div key={x.t} className="hmli"><div style={{width:"12px",height:"12px",borderRadius:"3px",background:c.bg,border:`1px solid ${c.border}`}}/>{x.l}</div>;})}
          <div className="hmli"><div style={{width:"12px",height:"12px",borderRadius:"3px",background:"#f8fafc",border:"1px solid rgba(99,102,241,0.35)",display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{width:"5px",height:"5px",borderRadius:"50%",background:"#818cf8"}}/></div>Capacity exception (leave / public holiday)</div>
        </div>
      </div>
      <PipeSection gaps={data.pipelineGaps} periods={data.periods} cw={cw}/>
    </div></div>
    {edit&&<EditModal cell={edit} people={allPeople} projects={allProjects} onClose={()=>setEdit(null)} onSaved={onSaved}/>}
  </>);
}