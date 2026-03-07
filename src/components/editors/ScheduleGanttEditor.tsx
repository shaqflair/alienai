"use client";

import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";

/* ════════════════════════════════════════════════
   EXPORTED TYPES  (consumed by ArtifactDetailClientHost)
════════════════════════════════════════════════ */
export type ItemType   = "milestone" | "task" | "deliverable";
export type ItemStatus = "on_track"  | "at_risk" | "delayed" | "done";

export type ScheduleItem = {
  id:           string;
  phaseId:      string;
  type:         ItemType;
  name:         string;
  start:        string;   // ISO YYYY-MM-DD
  end?:         string;
  status:       ItemStatus;
  notes?:       string;
  dependencies?: string[];
};

export type SchedulePhase = {
  id:   string;
  name: string;
};

export type ScheduleDocV1 = {
  version:      1;
  type:         "schedule";
  anchor_date?: string;
  phases:       SchedulePhase[];
  items:        ScheduleItem[];
};

/* ════════════════════════════════════════════════
   DESIGN TOKENS  (vivid palette)
════════════════════════════════════════════════ */
const C = {
  bg:       "#EEF1F7",
  surface:  "#FFFFFF",
  border:   "#CDD3DF",
  borderMd: "#A8B3C8",
  text:     "#111827",
  textMd:   "#374151",
  textSm:   "#6B7280",

  blue:   "#2563EB",
  blueDk: "#1E40AF",
  blueLt: "#DBEAFE",
  h1:     "#2563EB",
  h2:     "#7C3AED",

  green:    "#059669", greenBg:  "#D1FAE5", greenBd:  "#6EE7B7",
  amber:    "#D97706", amberBg:  "#FEF3C7", amberBd:  "#FCD34D",
  red:      "#DC2626", redBg:    "#FEE2E2", redBd:    "#FCA5A5",
  violet:   "#7C3AED", violetBg: "#EDE9FE", violetBd: "#C4B5FD",

  phaseAccents:   ["#2563EB","#059669","#D97706","#7C3AED","#EA580C","#0891B2"],
  phaseAccentBgs: ["#EFF6FF","#D1FAE5","#FEF3C7","#EDE9FE","#FFF7ED","#E0F2FE"],

  mono: "'DM Mono', monospace",
  sans: "'DM Sans', sans-serif",
} as const;

/* ════════════════════════════════════════════════
   STATUS CONFIG
════════════════════════════════════════════════ */
const STATUS_CFG: Record<ItemStatus, { color:string; bg:string; bd:string; label:string }> = {
  on_track: { color:C.green,  bg:C.greenBg,  bd:C.greenBd,  label:"On Track" },
  at_risk:  { color:C.amber,  bg:C.amberBg,  bd:C.amberBd,  label:"At Risk"  },
  delayed:  { color:C.red,    bg:C.redBg,    bd:C.redBd,    label:"Delayed"  },
  done:     { color:C.violet, bg:C.violetBg, bd:C.violetBd, label:"Done"     },
};
const STATUS_KEYS: ItemStatus[] = ["on_track","at_risk","delayed","done"];

/* ════════════════════════════════════════════════
   LAYOUT CONSTANTS
════════════════════════════════════════════════ */
const SIDE_W   = 280;
const WEEK_W   = 120;
const LANE_H   = 44;
const PH_HDR_H = 48;
const ADD_ROW_H= 38;
const BAR_H    = 28;
const DAY_W    = WEEK_W / 7;
const MAX_DAY  = 51 * 7 + 6;
const DRAG_PX  = 4;

/* ════════════════════════════════════════════════
   PURE HELPERS
════════════════════════════════════════════════ */
function uuidish(): string {
  return (crypto as any)?.randomUUID?.() ?? `s_${Math.random().toString(16).slice(2)}_${Date.now()}`;
}
function safeStr(x: unknown): string { return typeof x === "string" ? x : x == null ? "" : String(x); }
function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, n)); }
function todayISO() { return new Date().toISOString().slice(0,10); }
function addDays(d: Date, n: number): Date { const o=new Date(d); o.setDate(o.getDate()+n); return o; }
function iso(d: Date): string { return d.toISOString().slice(0,10); }
function startOfWeekMonday(d: Date): Date {
  const day=d.getDay(), diff=(day===0?-6:1)-day;
  const o=new Date(d); o.setDate(d.getDate()+diff); o.setHours(0,0,0,0); return o;
}
function parseISO(s: string): Date|null {
  const x=safeStr(s).trim(); if(!x) return null;
  const d=new Date(`${x}T00:00:00`); if(isNaN(d.getTime())) return null;
  d.setHours(0,0,0,0); return d;
}
function dayIndex(anchor: Date, dateISO: string): number|null {
  const d=parseISO(dateISO); if(!d) return null;
  return Math.floor((d.getTime()-anchor.getTime())/86400000);
}
function fmtWeekHeader(s: Date): string {
  const e=addDays(s,6);
  const f=(d:Date)=>`${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]}`;
  return `${f(s)} – ${f(e)}`;
}
function parseDeps(x: unknown): string[] {
  if(Array.isArray(x)) return (x as any[]).map(safeStr).filter(Boolean).slice(0,50);
  if(typeof x==="string") return x.split(",").map(s=>s.trim()).filter(Boolean).slice(0,50);
  return [];
}
function compactPct(items: ScheduleItem[]): number {
  if(!items.length) return 0;
  return Math.round(items.filter(x=>x.status==="done").length/items.length*100);
}
function debounce<T extends (...args: any[])=>any>(fn: T, ms: number): T {
  let t: ReturnType<typeof setTimeout>|null=null;
  return ((...args:any[])=>{ if(t) clearTimeout(t); t=setTimeout(()=>fn(...args),ms); }) as T;
}

/* ════════════════════════════════════════════════
   WBS HELPERS  (unchanged from original)
════════════════════════════════════════════════ */
type WbsStatus = "not_started"|"in_progress"|"done"|"blocked";

function normalizeWbs(wbs: any): { rows: any[] } {
  let obj: any=wbs;
  if(typeof wbs==="string"){ try{ obj=JSON.parse(wbs); }catch{ obj=null; } }
  const rows=Array.isArray(obj?.rows)?obj.rows:Array.isArray(obj?.items)?obj.items:[];
  return { rows: (rows??[]).map((r:any)=>({
    id:               safeStr(r?.id)||uuidish(),
    level:            Number(r?.level??0)||0,
    deliverable:      safeStr(r?.deliverable)||safeStr(r?.name)||"(untitled)",
    description:      safeStr(r?.description),
    acceptance_criteria: safeStr(r?.acceptance_criteria),
    owner:            safeStr(r?.owner),
    status:           (safeStr(r?.status) as WbsStatus)||"not_started",
    due_date:         safeStr(r?.due_date),
    predecessor:      safeStr(r?.predecessor),
    tags:             Array.isArray(r?.tags)?r.tags.map((x:any)=>safeStr(x)).filter(Boolean):[],
  })).slice(0,5000) };
}

function wbsStatusToSchedule(s?: WbsStatus): ItemStatus {
  const v=safeStr(s).toLowerCase();
  if(v==="done")       return "done";
  if(v==="blocked")    return "at_risk";
  if(v==="in_progress")return "on_track";
  return "on_track";
}

function buildScheduleFromWbs(args:{ wbs:any; projectStartDate?:string|null; projectFinishDate?:string|null }): ScheduleDocV1|null {
  const { rows }=normalizeWbs(args.wbs);
  if(!rows.length) return null;
  const projStart=parseISO(args.projectStartDate||"")||parseISO(todayISO())!;
  const anchor=iso(startOfWeekMonday(projStart));
  const stack: any[]=[];
  const rootPhaseByRow=new Map<string,string>();
  const phaseNames: string[]=[];
  for(const r of rows){
    while(stack.length && r.level<=(stack[stack.length-1]?.level??0)) stack.pop();
    stack.push(r);
    const top=stack.find(x=>x.level===0)??stack[0];
    const phaseName=safeStr(top?.deliverable)||"Work";
    rootPhaseByRow.set(r.id,phaseName);
    if(!phaseNames.includes(phaseName)) phaseNames.push(phaseName);
  }
  const phases: SchedulePhase[]=phaseNames.map(name=>({id:uuidish(),name}));
  const phaseIdByName=new Map(phases.map(p=>[p.name,p.id]));
  const childrenCount=new Map<string,number>();
  for(let i=0;i<rows.length;i++){
    const r=rows[i],next=rows[i+1];
    if(next&&next.level>r.level) childrenCount.set(r.id,(childrenCount.get(r.id)??0)+1);
  }
  const rowIdSet=new Set(rows.map((r:any)=>r.id));
  const items: ScheduleItem[]=[];
  for(const r of rows){
    if((childrenCount.get(r.id)??0)>0) continue;
    const phaseName=rootPhaseByRow.get(r.id)??"Work";
    const phaseId=phaseIdByName.get(phaseName)||phases[0]?.id||uuidish();
    const endISO=parseISO(r.due_date||"")?safeStr(r.due_date):"";
    const deps: string[]=[]; const pred=safeStr(r.predecessor).trim();
    if(pred&&rowIdSet.has(pred)) deps.push(pred);
    items.push({ id:r.id, phaseId, type:"task", name:safeStr(r.deliverable)||"(untitled)",
      start:iso(projStart), end:endISO||iso(projStart),
      status:wbsStatusToSchedule(r.status),
      notes:[safeStr(r.description),safeStr(r.acceptance_criteria)].filter(Boolean).join("\n").trim(),
      dependencies:deps });
  }
  const projFinish=parseISO(args.projectFinishDate||"");
  if(projFinish){ const pf=projFinish.getTime(); for(const it of items){ const e=parseISO(it.end||"")||parseISO(it.start); if(e&&e.getTime()>pf) it.end=iso(projFinish); } }
  if(!items.length){ for(const pName of phaseNames){ const phaseId=phaseIdByName.get(pName)!; items.push({id:uuidish(),phaseId,type:"milestone",name:pName,start:iso(projStart),end:"",status:"on_track",notes:"",dependencies:[]}); } }
  return { version:1, type:"schedule", anchor_date:anchor, phases, items };
}

/* ════════════════════════════════════════════════
   NORMALISE / SERIALIZE  (identical to original)
════════════════════════════════════════════════ */
function normalizeInitial(initialJson: any): ScheduleDocV1 {
  let obj: any=initialJson;
  if(typeof initialJson==="string"){ try{ obj=JSON.parse(initialJson); }catch{ obj=null; } }
  if(obj&&typeof obj==="object"&&obj.type==="schedule"&&Number(obj.version)===1){
    return {
      version:1, type:"schedule", anchor_date:safeStr(obj.anchor_date),
      phases:(Array.isArray(obj.phases)?obj.phases:[]).map((p:any)=>({id:safeStr(p?.id)||uuidish(),name:safeStr(p?.name)||"Phase"})).slice(0,200),
      items: (Array.isArray(obj.items)?obj.items:[]).map((it:any)=>({
        id:safeStr(it?.id)||uuidish(), phaseId:safeStr(it?.phaseId),
        type:(safeStr(it?.type) as ItemType)||"task", name:safeStr(it?.name)||"(untitled)",
        start:safeStr(it?.start), end:safeStr(it?.end),
        status:(safeStr(it?.status) as ItemStatus)||"on_track",
        notes:safeStr(it?.notes),
        dependencies:parseDeps(it?.dependencies??it?.dependsOn??it?.predecessors),
      })).slice(0,4000),
    };
  }
  const anchor=startOfWeekMonday(new Date());
  const p1=uuidish(),p2=uuidish(),p3=uuidish(),kickId=uuidish(),scopeId=uuidish();
  return {
    version:1, type:"schedule", anchor_date:iso(anchor),
    phases:[{id:p1,name:"Preparation"},{id:p2,name:"Deployment"},{id:p3,name:"Configuration"}],
    items:[
      {id:kickId, phaseId:p1,type:"milestone",name:"Kickoff",start:iso(addDays(anchor,2)),end:"",status:"on_track",dependencies:[]},
      {id:scopeId,phaseId:p1,type:"task",name:"Scoping Documentation",start:iso(addDays(anchor,7)),end:iso(addDays(anchor,20)),status:"at_risk",dependencies:[kickId]},
    ],
  };
}

function serialize(doc: ScheduleDocV1) {
  return {
    version:1, type:"schedule", anchor_date:safeStr(doc.anchor_date).trim(),
    phases:(doc.phases??[]).map(p=>({id:p.id,name:safeStr(p.name)})),
    items:(doc.items??[]).map(it=>({
      id:it.id, phaseId:it.phaseId, type:it.type, name:safeStr(it.name),
      start:safeStr(it.start), end:safeStr(it.end), status:it.status,
      notes:safeStr(it.notes),
      dependencies:Array.isArray(it.dependencies)?it.dependencies.map(safeStr).filter(Boolean):[],
    })),
  };
}

/* ════════════════════════════════════════════════
   SMALL UI ATOMS
════════════════════════════════════════════════ */
const Mono = ({ children, style={} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <span style={{ fontFamily:C.mono, ...style }}>{children}</span>
);
const ULabel = ({ children, style={} }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <Mono style={{ fontSize:8, letterSpacing:".12em", textTransform:"uppercase", color:C.textSm, fontWeight:600, ...style }}>{children}</Mono>
);

function StatusPill({ status }: { status: ItemStatus }) {
  const s=STATUS_CFG[status]??STATUS_CFG.on_track;
  return <span style={{ fontFamily:C.mono, fontSize:8, fontWeight:700, letterSpacing:".05em", color:s.color, background:s.bg, border:`1px solid ${s.bd}`, padding:"1px 6px", whiteSpace:"nowrap", flexShrink:0 }}>{s.label}</span>;
}

function TypeBadge({ type }: { type: ItemType }) {
  if(type==="milestone") return <span style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,flexShrink:0 }}><span style={{ width:9,height:9,background:C.amber,transform:"rotate(45deg)",display:"block",border:`1.5px solid ${C.amberBd}` }}/></span>;
  if(type==="deliverable") return <span style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,flexShrink:0 }}><span style={{ width:10,height:10,background:C.violet,display:"block" }}/></span>;
  return <span style={{ display:"inline-flex",alignItems:"center",justifyContent:"center",width:18,height:18,flexShrink:0 }}><span style={{ width:10,height:10,borderRadius:"50%",background:C.blue,display:"block" }}/></span>;
}

function PhaseProgressBar({ items }: { items: ScheduleItem[] }) {
  const tasks=items.filter(i=>i.type!=="milestone");
  const pct=compactPct(tasks.length?tasks:items);
  const col=items.some(i=>i.status==="delayed")?C.red:items.some(i=>i.status==="at_risk")?C.amber:C.green;
  return (
    <div style={{ display:"flex", alignItems:"center", gap:7 }}>
      <div style={{ width:54, height:3, background:C.border, overflow:"hidden" }}>
        <div style={{ width:`${pct}%`, height:"100%", background:col, transition:"width .3s" }}/>
      </div>
      <Mono style={{ fontSize:9, color:col, fontWeight:700 }}>{pct}%</Mono>
    </div>
  );
}

/* ════════════════════════════════════════════════
   GANTT BAR
════════════════════════════════════════════════ */
function GanttBar({
  item, geom, isSelected, readOnly, onDown, onDownResize, onClick,
}: {
  item: ScheduleItem;
  geom: { left: number; width: number };
  isSelected: boolean;
  readOnly: boolean;
  onDown: (e: React.PointerEvent) => void;
  onDownResize: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}) {
  const [hov,setHov]=useState(false);
  const s=STATUS_CFG[item.status]??STATUS_CFG.on_track;
  const hot=isSelected||hov;

  if(item.type==="milestone") {
    return (
      <div style={{ position:"absolute", left:geom.left, top:"50%", transform:"translate(-50%,-50%)", zIndex:isSelected?10:3, cursor:"pointer" }}
        onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
        onPointerDown={onDown} onClick={onClick}>
        <div style={{ width:20, height:20, background:hot?s.color:C.surface, border:`2.5px solid ${s.color}`, transform:"rotate(45deg)",
          boxShadow:isSelected?`0 0 0 5px ${s.bg},0 2px 12px ${s.bd}`:hov?`0 0 0 4px ${s.bg}`:`0 0 0 2px ${s.bg}`, transition:"all .13s" }}/>
      </div>
    );
  }

  return (
    <div style={{ position:"absolute", left:geom.left, width:geom.width, top:"50%", transform:"translateY(-50%)", zIndex:isSelected?10:3, cursor:readOnly?"pointer":"grab" }}
      onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}
      onPointerDown={onDown} onClick={onClick}>
      <div style={{ height:BAR_H, background:hot?s.color:s.bg, border:`1.5px solid ${hot?s.color:s.bd}`, display:"flex", alignItems:"center", overflow:"hidden",
        boxShadow:isSelected?`0 0 0 2px ${s.bd},0 4px 14px ${s.bd}`:hov?`0 4px 14px ${s.bd}`:"none", transition:"all .13s" }}>
        <div style={{ width:4, alignSelf:"stretch", background:s.color, flexShrink:0 }}/>
        <div style={{ width:7, height:7, borderRadius:"50%", background:hot?"rgba(255,255,255,.7)":s.color, margin:"0 6px", flexShrink:0 }}/>
        <span style={{ fontFamily:C.sans, fontSize:11, fontWeight:600, color:hot?"#FFF":s.color, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", flex:1, transition:"color .13s" }}>
          {item.name||"(untitled)"}
        </span>
        {!readOnly && (
          <div style={{ width:8, alignSelf:"stretch", cursor:"ew-resize", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}
            onPointerDown={e=>{ e.stopPropagation(); onDownResize(e); }}>
            <div style={{ width:2, height:12, borderRadius:1, background:hot?"rgba(255,255,255,.4)":s.bd }}/>
          </div>
        )}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════
   MAIN COMPONENT
════════════════════════════════════════════════ */
export default function ScheduleGanttEditor({
  projectId,
  artifactId,
  initialJson,
  readOnly = false,
  projectTitle,
  projectStartDate,
  projectFinishDate,
  latestWbsJson,
  wbsArtifactId,
}: {
  projectId:         string;
  artifactId:        string;
  initialJson:       any;
  readOnly?:         boolean;
  projectTitle?:     string | null;
  projectStartDate?: string | null;
  projectFinishDate?:string | null;
  latestWbsJson?:    any    | null;
  wbsArtifactId?:    string | null;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  /* ── doc state ── */
  const [doc, setDoc]     = useState<ScheduleDocV1>(() => normalizeInitial(initialJson));
  const [dirty, setDirty] = useState(false);
  const [msg, setMsg]     = useState("");
  const [msgType, setMsgType] = useState<"info"|"success"|"warn">("info");

  const etagRef                   = useRef<string|null>(null);
  const hydratedOnceRef           = useRef(false);
  const lastHydratedFingerprintRef= useRef<string>("");
  const savingRef                 = useRef(false);

  const updateDoc = useCallback((fn: (prev: ScheduleDocV1) => ScheduleDocV1) => {
    setDoc(p => fn(p)); setDirty(true);
  }, []);

  function showMsg(text: string, type: "info"|"success"|"warn" = "info") {
    setMsg(text); setMsgType(type);
    if(type!=="warn") setTimeout(()=>setMsg(""), type==="success"?1200:2500);
  }

  /* ── hydration from server (identical logic to original) ── */
  useLayoutEffect(() => {
    const nextDoc=normalizeInitial(initialJson);
    let nextFp=""; try{ nextFp=JSON.stringify(serialize(nextDoc)); }catch{}
    if(!hydratedOnceRef.current||!dirty){
      hydratedOnceRef.current=true;
      lastHydratedFingerprintRef.current=nextFp;
      setDoc(nextDoc); setDirty(false); return;
    }
    if(nextFp&&nextFp===lastHydratedFingerprintRef.current) return;
    showMsg("⚠ A newer server version is available. Save your changes or reload.","warn");
  }, [initialJson, dirty]);

  useEffect(()=>{
    function onBeforeUnload(e: BeforeUnloadEvent){ if(!dirty) return; e.preventDefault(); e.returnValue=""; }
    window.addEventListener("beforeunload",onBeforeUnload);
    return()=>window.removeEventListener("beforeunload",onBeforeUnload);
  },[dirty]);

  /* ── WBS state ── */
  const [wbsJson, setWbsJson]   = useState<any|null>(latestWbsJson??null);
  const [wbsLoading, setWbsLoading] = useState(false);
  useEffect(()=>{ setWbsJson(latestWbsJson??null); },[latestWbsJson]);

  /* ── view state ── */
  const [viewW, setViewW]     = useState(12);
  const [pgStart, setPgStart] = useState(0);
  const [search, setSearch]   = useState("");
  const [collapsed, setCol]   = useState<Record<string,boolean>>({});
  const [showM, setShowM]     = useState(true);
  const [showT, setShowT]     = useState(true);
  const [showD, setShowD]     = useState(true);
  const [sFilt, setSFilt]     = useState<ItemStatus|null>(null);
  const [selId, setSelId]     = useState<string|null>(null);
  const [panelOpen, setPanel] = useState(false);
  const [depQ, setDepQ]       = useState("");
  const [endErr, setEndErr]   = useState("");

  /* ── anchor & weeks ── */
  const anchor = useMemo(()=>{
    const raw=parseISO(doc.anchor_date||"");
    if(raw) return startOfWeekMonday(raw);
    const proj=parseISO(projectStartDate||"");
    if(proj) return startOfWeekMonday(proj);
    return startOfWeekMonday(new Date());
  },[doc.anchor_date,projectStartDate]);

  /* seed range from project dates */
  const seededRef=useRef(false);
  useEffect(()=>{
    if(seededRef.current) return;
    const s=parseISO(projectStartDate||""),e=parseISO(projectFinishDate||"");
    if(!s||!e) return;
    seededRef.current=true;
    setDoc(p=>safeStr(p.anchor_date).trim()?p:{...p,anchor_date:iso(startOfWeekMonday(s))});
  },[projectStartDate,projectFinishDate]);

  const allWeeks = useMemo(()=>Array.from({length:52},(_,i)=>{
    const s=addDays(anchor,i*7); return {idx:i,start:s,label:`W${i+1}`,range:fmtWeekHeader(s)};
  }),[anchor]);

  const pageWeeks = useMemo(()=>viewW===52?allWeeks:allWeeks.slice(clamp(pgStart,0,51),clamp(pgStart+viewW,0,52)),[allWeeks,viewW,pgStart]);
  const pSD=(pageWeeks[0]?.idx??0)*7;
  const pED=((pageWeeks[pageWeeks.length-1]?.idx??0))*7+6;

  const todayX = useMemo(()=>{
    const d=dayIndex(anchor,todayISO()); if(d===null||d<pSD||d>pED) return null; return (d-pSD)*DAY_W;
  },[anchor,pSD,pED]);

  /* ── filtered items per phase ── */
  const itemsByPhase = useMemo(()=>{
    const q=search.trim().toLowerCase();
    const m=new Map<string,ScheduleItem[]>();
    for(const it of doc.items){
      if(it.type==="milestone"&&!showM) continue;
      if(it.type==="task"&&!showT) continue;
      if(it.type==="deliverable"&&!showD) continue;
      if(sFilt&&it.status!==sFilt) continue;
      if(q&&!`${it.name} ${it.notes}`.toLowerCase().includes(q)) continue;
      const arr=m.get(it.phaseId)??[]; arr.push(it); m.set(it.phaseId,arr);
    }
    for(const [k,arr] of m.entries()){
      arr.sort((a,b)=>(parseISO(a.start)?.getTime()??0)-(parseISO(b.start)?.getTime()??0));
      m.set(k,arr);
    }
    return m;
  },[doc.items,showM,showT,showD,sFilt,search]);

  /* ── bar geometry ── */
  const geomMap = useMemo(()=>{
    const m=new Map<string,{left:number;width:number;startDay:number;endDay:number}|null>();
    for(const it of doc.items){
      const sd=dayIndex(anchor,it.start); if(sd===null){m.set(it.id,null);continue;}
      const eISO=it.type==="milestone"?it.start:safeStr(it.end)||it.start;
      const ed=dayIndex(anchor,eISO)??sd;
      const s=clamp(Math.min(sd,ed),0,MAX_DAY),e=clamp(Math.max(sd,ed),0,MAX_DAY);
      if(e<pSD||s>pED){m.set(it.id,null);continue;}
      const si=Math.max(s,pSD),ei=Math.min(e,pED);
      const left=(si-pSD)*DAY_W+8;
      const width=it.type==="milestone"?20:Math.max(16,(ei-si+1)*DAY_W-16);
      m.set(it.id,{left,width,startDay:s,endDay:e});
    }
    return m;
  },[doc.items,anchor,pSD,pED]);

  /* ── progress ── */
  const allVisible = useMemo(()=>[...itemsByPhase.values()].flat(),[itemsByPhase]);
  const overallPct = useMemo(()=>compactPct(allVisible.filter(i=>i.type!=="milestone")),[allVisible]);
  const sCounts    = useMemo(()=>Object.fromEntries(STATUS_KEYS.map(k=>[k,doc.items.filter(i=>i.status===k).length])) as Record<ItemStatus,number>,[doc.items]);

  /* ── selection ── */
  const selItem  = useMemo(()=>doc.items.find(i=>i.id===selId)??null,[selId,doc.items]);
  const itemById = useMemo(()=>new Map(doc.items.map(i=>[i.id,i])),[doc.items]);
  const depCands = useMemo(()=>{
    if(!selItem) return [];
    const q=depQ.trim().toLowerCase();
    const ex=new Set(selItem.dependencies??[]);
    return doc.items.filter(x=>x.id!==selItem.id&&!ex.has(x.id)&&(!q||x.name.toLowerCase().includes(q))).slice(0,20);
  },[depQ,doc.items,selItem]);

  /* ── total scroll height ── */
  const totalH = useMemo(()=>doc.phases.reduce((acc,ph)=>{
    if(collapsed[ph.id]) return acc+PH_HDR_H;
    const n=(itemsByPhase.get(ph.id)??[]).length;
    return acc+PH_HDR_H+(n===0?LANE_H:n*LANE_H)+ADD_ROW_H;
  },0),[doc.phases,collapsed,itemsByPhase]);

  /* ════════════════════════════════════════════════
     ACTIONS
  ════════════════════════════════════════════════ */
  function normaliseItem(prev: ScheduleItem, patch: Partial<ScheduleItem>): ScheduleItem {
    const n={ ...prev, ...patch } as ScheduleItem;
    if(n.type==="milestone") n.end=""; else n.end=safeStr(n.end)||safeStr(n.start);
    n.dependencies=(n.dependencies??[]).map(safeStr).filter(Boolean);
    return n;
  }

  function updateItem(id: string, patch: Partial<ScheduleItem>) {
    if(patch.end!==undefined){
      const it=doc.items.find(x=>x.id===id);
      if(it&&it.type!=="milestone"){
        const s=parseISO((patch.start as string|undefined)??it.start);
        const e=parseISO(patch.end||"");
        if(s&&e&&e<s) setEndErr("End date must be on or after start date");
        else setEndErr("");
      }
    } else setEndErr("");
    updateDoc(p=>({...p,items:p.items.map(it=>it.id===id?normaliseItem(it,patch):it)}));
  }

  function addPhase() {
    const id=uuidish();
    updateDoc(p=>({...p,phases:[...p.phases,{id,name:"New Phase"}]}));
  }
  function deletePhase(phaseId: string) {
    updateDoc(p=>({...p,phases:p.phases.filter(x=>x.id!==phaseId),items:p.items.filter(x=>x.phaseId!==phaseId)}));
    if(selItem?.phaseId===phaseId){ setSelId(null); setPanel(false); }
  }
  function updatePhase(phaseId: string, patch: Partial<SchedulePhase>) {
    updateDoc(p=>({...p,phases:p.phases.map(ph=>ph.id===phaseId?{...ph,...patch}:ph)}));
  }
  function addItem(phaseId: string, type: ItemType) {
    const start=pageWeeks[0]?.start?iso(pageWeeks[0].start):todayISO();
    const end=type==="milestone"?"":iso(addDays(pageWeeks[0]?.start??new Date(),7));
    const item: ScheduleItem={ id:uuidish(), phaseId, type,
      name:type==="milestone"?"New Milestone":type==="task"?"New Task":"New Deliverable",
      start, end, status:"on_track", notes:"", dependencies:[] };
    updateDoc(p=>({...p,items:[...p.items,item]}));
    setSelId(item.id); setPanel(true);
  }
  function deleteItem(id: string) {
    updateDoc(p=>({...p,items:p.items.filter(x=>x.id!==id).map(x=>({...x,dependencies:(x.dependencies??[]).filter(d=>d!==id)}))}));
    if(selId===id){ setSelId(null); setPanel(false); }
  }
  function duplicateItem(id: string) {
    updateDoc(p=>{
      const it=p.items.find(x=>x.id===id); if(!it) return p;
      return {...p,items:[...p.items,{...it,id:uuidish(),name:`${it.name} (copy)`}]};
    });
  }
  function shiftItem(id: string, weeks: number) {
    const days=weeks*7;
    updateDoc(p=>({...p,items:p.items.map(it=>{
      if(it.id!==id) return it;
      const s=parseISO(it.start); if(!s) return it;
      const ns=iso(addDays(s,days));
      if(it.type==="milestone") return {...it,start:ns,end:""};
      const e=parseISO(safeStr(it.end)||it.start)??s;
      return {...it,start:ns,end:iso(addDays(e,days))};
    })}));
  }

  /* ── WBS fetch & import ── */
  async function fetchLatestWbsJson(): Promise<any|null> {
    try {
      setWbsLoading(true);
      if(!wbsArtifactId) throw new Error("No WBS artifact found for this project.");
      const url=`/api/artifacts/${encodeURIComponent(wbsArtifactId)}/content-json?projectId=${encodeURIComponent(projectId)}`;
      const res=await fetch(url,{method:"GET",headers:{Accept:"application/json"},cache:"no-store",credentials:"include"});
      const j=await res.json().catch(()=>({}));
      if(!res.ok||j?.ok===false) throw new Error(j?.error||`WBS fetch failed (${res.status})`);
      return j?.content_json??null;
    } catch(e:any){ showMsg(`⚠ ${e?.message??"Could not load WBS"}`,"warn"); return null; }
    finally{ setWbsLoading(false); }
  }

  async function appendFromWbs() {
    if(readOnly) return;
    let loaded=wbsJson;
    if(!loaded){ loaded=await fetchLatestWbsJson(); if(loaded) setWbsJson(loaded); }
    if(!loaded) return;
    const rows=normalizeWbs(loaded).rows;
    if(!rows.length){ showMsg("⚠ No WBS found for this project.","warn"); return; }
    const imported=buildScheduleFromWbs({wbs:loaded,projectStartDate,projectFinishDate});
    if(!imported){ showMsg("⚠ WBS format not recognised.","warn"); return; }
    const ok=window.confirm("Append from WBS will ADD tasks into this schedule.\n\nContinue?");
    if(!ok) return;
    updateDoc(prev=>{
      const existingIds=new Set((prev.items??[]).map(x=>x.id));
      const phaseIdByName=new Map<string,string>();
      for(const p of prev.phases??[]) phaseIdByName.set(safeStr(p.name).trim().toLowerCase(),p.id);
      const newPhases=[...(prev.phases??[])];
      const importedPhaseIdMap=new Map<string,string>();
      for(const p of imported.phases??[]){
        const key=safeStr(p.name).trim().toLowerCase()||"phase";
        const existing=phaseIdByName.get(key);
        if(existing){ importedPhaseIdMap.set(p.id,existing); continue; }
        const id=uuidish(); newPhases.push({id,name:safeStr(p.name)||"Phase"});
        phaseIdByName.set(key,id); importedPhaseIdMap.set(p.id,id);
      }
      const idMap=new Map<string,string>();
      for(const it of imported.items??[]){ idMap.set(it.id,existingIds.has(it.id)?uuidish():it.id); }
      const appendedItems=(imported.items??[]).map(it=>{
        const newId=idMap.get(it.id)??uuidish();
        const mappedPhaseId=importedPhaseIdMap.get(it.phaseId)??it.phaseId;
        const deps=(it.dependencies??[]).map(d=>idMap.get(d)??"").filter(Boolean);
        return normaliseItem({...it,id:newId,phaseId:mappedPhaseId,dependencies:deps},{});
      });
      const mergedItems=[...(prev.items??[])];
      for(const it of appendedItems){ if(!existingIds.has(it.id)){ mergedItems.push(it); existingIds.add(it.id); } }
      return {...prev,phases:newPhases,items:mergedItems};
    });
    showMsg("✓ Appended from WBS — remember to Save","success");
  }

  /* ── Save ── */
  async function save(showToast=true) {
    if(readOnly||savingRef.current) return;
    if(!dirty){ if(showToast) showMsg("Nothing to save"); return; }

    const projStart=parseISO(projectStartDate||"");
    const projFinish=parseISO(projectFinishDate||"");
    if(projStart&&projFinish){
      for(const it of doc.items??[]){
        const s=parseISO(it.start);
        const eISO=it.type==="milestone"?it.start:safeStr(it.end)||it.start;
        const e=parseISO(eISO)??s;
        if(s&&s.getTime()<projStart.getTime()){ showMsg(`⚠ "${it.name}" starts before project start.`,"warn"); return; }
        if(e&&e.getTime()>projFinish.getTime()){ showMsg(`⚠ "${it.name}" ends after project finish.`,"warn"); return; }
      }
    }

    const payload={ projectId, title:"Schedule / Roadmap", content_json:serialize(doc) };
    savingRef.current=true;

    startTransition(async()=>{
      try{
        const headers: Record<string,string>={ "Content-Type":"application/json", Accept:"application/json" };
        const ifMatch=safeStr(etagRef.current).trim();
        if(ifMatch) headers["If-Match"]=ifMatch;
        const res=await fetch(`/api/artifacts/${encodeURIComponent(artifactId)}/content-json`,{
          method:"POST",headers,body:JSON.stringify(payload),credentials:"include",
        });
        const j=await res.json().catch(()=>({}));
        if(!res.ok){
          if(res.status===409) throw new Error(j?.error||"Conflict: someone else updated this schedule. Refresh to get the latest.");
          throw new Error(j?.error||`Save failed (${res.status})`);
        }
        const nextEtag=safeStr(j?.artifact?.updated_at)||safeStr(j?.artifact?.updatedAt)||safeStr(res.headers.get("ETag")||res.headers.get("etag"));
        if(nextEtag) etagRef.current=nextEtag;
        try{ lastHydratedFingerprintRef.current=JSON.stringify(serialize(doc)); }catch{}
        setDirty(false);
        router.refresh();
        if(showToast) showMsg("✓ Saved","success");
      } catch(e:any){
        if(showToast) showMsg(`⚠ ${e?.message??"Save failed"}`,"warn");
      } finally{ savingRef.current=false; }
    });
  }

  /* ── Exports ── */
  const downloadLinkRef=useRef<HTMLAnchorElement|null>(null);
  function triggerDownload(url: string) {
    if(!downloadLinkRef.current){ const a=document.createElement("a"); a.style.display="none"; document.body.appendChild(a); downloadLinkRef.current=a; }
    downloadLinkRef.current.href=url; downloadLinkRef.current.click();
  }
  const titleText=safeStr(projectTitle).trim()||"Schedule / Roadmap";
  function triggerExcelDownload(){ triggerDownload(`/api/export/excel?artifactId=${artifactId}&title=${encodeURIComponent(titleText.replace(/[^a-z0-9]/gi,"_"))}`); }
  function triggerPptxDownload(){  triggerDownload(`/api/export/pptx?artifactId=${artifactId}&title=${encodeURIComponent(titleText.replace(/[^a-z0-9]/gi,"_"))}`);  }

  /* ── Keyboard shortcuts ── */
  useEffect(()=>{
    function onKey(e: KeyboardEvent){
      const tag=(e.target as HTMLElement)?.tagName?.toLowerCase();
      const isEditing=["input","textarea","select"].includes(tag);
      if((e.metaKey||e.ctrlKey)&&e.key==="s"){ e.preventDefault(); save(true); return; }
      if(isEditing) return;
      if(e.key==="Escape"){ setPanel(false); setSelId(null); return; }
      if(!selId||readOnly) return;
      if(e.key==="Delete"||e.key==="Backspace"){ e.preventDefault(); deleteItem(selId); return; }
      if(e.key==="ArrowLeft"){ e.preventDefault(); shiftItem(selId,-1); return; }
      if(e.key==="ArrowRight"){ e.preventDefault(); shiftItem(selId,1);  return; }
    }
    window.addEventListener("keydown",onKey);
    return()=>window.removeEventListener("keydown",onKey);
  },[selId,readOnly,dirty]);

  /* ── Drag ── */
  type DragState={ mode:"move"|"resize_end"; id:string; pointerId:number; startX:number; moved:boolean; origS:number; origE:number; };
  const dragRef=useRef<DragState|null>(null);
  const rafRef=useRef<number|null>(null);

  function beginDrag(e: React.PointerEvent, id: string, mode: "move"|"resize_end") {
    if(readOnly) return;
    const it=doc.items.find(x=>x.id===id); if(!it) return;
    const s0=dayIndex(anchor,it.start); if(s0===null) return;
    const eISO=it.type==="milestone"?it.start:safeStr(it.end)||it.start;
    const e0=dayIndex(anchor,eISO)??s0;
    dragRef.current={ mode, id, pointerId:e.pointerId, startX:e.clientX, moved:false,
      origS:clamp(Math.min(s0,e0),0,MAX_DAY), origE:clamp(Math.max(s0,e0),0,MAX_DAY) };
    try{ (e.currentTarget as any)?.setPointerCapture?.(e.pointerId); }catch{}
    e.preventDefault(); e.stopPropagation();
  }

  function applyDelta(dd: number) {
    const st=dragRef.current; if(!st) return;
    updateDoc(prev=>({...prev,items:prev.items.map(x=>{
      if(x.id!==st.id) return x;
      const ds=clamp(dd,-MAX_DAY,MAX_DAY);
      if(st.mode==="move"){
        if(x.type==="milestone") return normaliseItem(x,{start:iso(addDays(anchor,clamp(st.origS+ds,0,MAX_DAY))),end:""});
        const dur=Math.max(0,st.origE-st.origS),ns=clamp(st.origS+ds,0,MAX_DAY);
        return normaliseItem(x,{start:iso(addDays(anchor,ns)),end:iso(addDays(anchor,clamp(ns+dur,ns,MAX_DAY)))});
      }
      if(x.type==="milestone") return x;
      return normaliseItem(x,{end:iso(addDays(anchor,clamp(st.origE+ds,st.origS,MAX_DAY)))});
    })}));
  }

  useEffect(()=>{
    function onMove(ev: PointerEvent){
      const st=dragRef.current; if(!st||ev.pointerId!==st.pointerId) return;
      const dx=ev.clientX-st.startX; if(Math.abs(dx)>=DRAG_PX) st.moved=true;
      const dd=Math.round(dx/DAY_W);
      if(rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current=requestAnimationFrame(()=>applyDelta(dd));
      ev.preventDefault();
    }
    function onUp(ev: PointerEvent){
      const st=dragRef.current; if(!st||ev.pointerId!==st.pointerId) return;
      dragRef.current=null;
      if(rafRef.current){ cancelAnimationFrame(rafRef.current); rafRef.current=null; }
    }
    window.addEventListener("pointermove",onMove,{passive:false});
    window.addEventListener("pointerup",onUp,{passive:false});
    window.addEventListener("pointercancel",onUp,{passive:false});
    return()=>{ window.removeEventListener("pointermove",onMove); window.removeEventListener("pointerup",onUp); window.removeEventListener("pointercancel",onUp); };
  },[anchor]);

  /* ── Dependency arrow paths ── */
  const scrollRef  =useRef<HTMLDivElement|null>(null);
  const svgWrapRef =useRef<HTMLDivElement|null>(null);
  const barRefs    =useRef<Map<string,HTMLElement>>(new Map());
  const [depPaths, setDepPaths]=useState<Array<{predId:string;succId:string;a:{x1:number;y1:number;x2:number;y2:number}}>>([]); 
  const regBar=useCallback((id:string,el:HTMLElement|null)=>{ if(el) barRefs.current.set(id,el); else barRefs.current.delete(id); },[]);

  const recompDeps=useMemo(()=>debounce(()=>{
    const wrap=svgWrapRef.current,scroll=scrollRef.current; if(!wrap||!scroll) return;
    const wr=wrap.getBoundingClientRect(),sl=scroll.scrollLeft,st=scroll.scrollTop;
    const next: typeof depPaths=[];
    for(const it of doc.items){
      for(const predId of it.dependencies??[]){
        const pe=barRefs.current.get(predId),se=barRefs.current.get(it.id); if(!pe||!se) continue;
        const pr=pe.getBoundingClientRect(),sr=se.getBoundingClientRect();
        const x1=pr.right-wr.left+sl,y1=pr.top-wr.top+st+pr.height/2;
        const x2=sr.left-wr.left+sl, y2=sr.top-wr.top+st+sr.height/2;
        next.push({predId,succId:it.id,a:{x1,y1,x2,y2}});
      }
    }
    setDepPaths(next.slice(0,2500));
  },20),[doc.items]);

  useLayoutEffect(()=>{ setTimeout(()=>recompDeps(),0); },[pageWeeks,collapsed,geomMap,recompDeps]);
  useEffect(()=>{
    const el=scrollRef.current;
    window.addEventListener("resize",recompDeps);
    if(el) el.addEventListener("scroll",recompDeps,{passive:true});
    return()=>{ window.removeEventListener("resize",recompDeps); if(el) el.removeEventListener("scroll",recompDeps); };
  },[recompDeps]);

  function depPathD({x1,y1,x2,y2}: {x1:number;y1:number;x2:number;y2:number}) {
    const s=16; return `M${x1} ${y1} L${x1+s} ${y1} L${x1+s} ${y2} L${x2} ${y2}`;
  }
  function arrowPt({x2,y2}: {x2:number;y2:number}) {
    return `M${x2-5} ${y2-3} L${x2} ${y2} L${x2-5} ${y2+3}`;
  }

  /* ── Message style ── */
  const msgStyle: React.CSSProperties = msgType==="success"
    ?{background:C.greenBg,color:C.green,border:`1px solid ${C.greenBd}`}
    :msgType==="warn"
    ?{background:C.amberBg,color:C.amber,border:`1px solid ${C.amberBd}`}
    :{background:C.blueLt,color:C.blue,border:`1px solid ${C.border}`};

  /* ════════════════════════════════════════════════
     RENDER
  ════════════════════════════════════════════════ */
  return (
    <div style={{height:"100vh",display:"flex",flexDirection:"column",background:C.bg,fontFamily:C.sans,fontSize:13,color:C.text,userSelect:"none"}}>

      {/* ═══ HEADER ═══ */}
      <header style={{background:`linear-gradient(120deg,${C.h1},${C.h2})`,padding:"11px 22px",flexShrink:0,borderBottom:"2px solid rgba(0,0,0,.15)",display:"flex",alignItems:"center",gap:14}}>
        <div>
          <Mono style={{fontSize:8,color:"rgba(255,255,255,.5)",letterSpacing:".16em",display:"block",marginBottom:3,textTransform:"uppercase" as const}}>Schedule &amp; Roadmap</Mono>
          <Mono style={{fontSize:14,fontWeight:600,color:"#FFF"}}>{titleText}</Mono>
          {projectStartDate&&projectFinishDate&&(
            <Mono style={{fontSize:9,color:"rgba(255,255,255,.55)",display:"block",marginTop:2}}>{projectStartDate} → {projectFinishDate}</Mono>
          )}
        </div>

        {/* Status filter chips */}
        <div style={{marginLeft:"auto",display:"flex",gap:6,flexWrap:"wrap" as const,alignItems:"center"}}>
          {STATUS_KEYS.map(k=>{
            const s=STATUS_CFG[k]; const on=sFilt===k;
            return (
              <button key={k} type="button" onClick={()=>setSFilt(on?null:k)} style={{display:"flex",alignItems:"center",gap:6,padding:"4px 11px",background:on?"rgba(255,255,255,.24)":"rgba(255,255,255,.1)",border:`1.5px solid ${on?"rgba(255,255,255,.7)":"rgba(255,255,255,.22)"}`,cursor:"pointer",fontFamily:C.mono,fontSize:9,color:on?"#FFF":"rgba(255,255,255,.75)",fontWeight:on?700:400,transition:"all .12s"}}>
                <span style={{width:8,height:8,borderRadius:"50%",background:on?"#FFF":s.color}}/>
                {s.label}
                <span style={{fontWeight:700,color:on?"#FFF":"rgba(255,255,255,.5)"}}>{sCounts[k]}</span>
              </button>
            );
          })}
        </div>

        {/* Inline message */}
        {msg&&(
          <span style={{fontFamily:C.mono,fontSize:9,padding:"4px 12px",...msgStyle,flexShrink:0}}>
            {msg}
            {msgType==="warn"&&<button type="button" onClick={()=>setMsg("")} style={{marginLeft:6,background:"none",border:"none",cursor:"pointer",color:"inherit",fontSize:13,padding:0,lineHeight:1}}>×</button>}
          </span>
        )}
      </header>

      {/* ═══ TOOLBAR ═══ */}
      <div style={{background:C.surface,borderBottom:`1.5px solid ${C.border}`,padding:"7px 22px",display:"flex",alignItems:"center",gap:8,flexShrink:0,flexWrap:"wrap" as const}}>
        {/* zoom */}
        <div style={{display:"flex",border:`1.5px solid ${C.border}`,overflow:"hidden"}}>
          {([1,4,12,36,52] as const).map(v=>(
            <button key={v} type="button" onClick={()=>{setViewW(v);setPgStart(0);}} style={{padding:"4px 11px",fontFamily:C.mono,fontSize:9,cursor:"pointer",background:viewW===v?C.blue:C.surface,color:viewW===v?"#FFF":C.textMd,border:"none",borderRight:`1px solid ${C.border}`,fontWeight:viewW===v?700:400,transition:"background .1s"}}>
              {v===52?"52 wks":v===36?"36 wks":v===12?"12 wks":v===4?"4 wks":"1 wk"}
            </button>
          ))}
        </div>

        {/* page nav */}
        {viewW!==52&&(
          <div style={{display:"flex",border:`1.5px solid ${C.border}`,overflow:"hidden"}}>
            <button type="button" disabled={pgStart<=0} onClick={()=>setPgStart(p=>clamp(p-viewW,0,52))} style={{width:28,height:26,border:"none",borderRight:`1px solid ${C.border}`,background:C.bg,color:C.textMd,cursor:"pointer",fontFamily:C.mono,fontSize:12,opacity:pgStart<=0?.35:1}}>←</button>
            <span style={{padding:"0 10px",display:"flex",alignItems:"center",fontFamily:C.mono,fontSize:9,color:C.textSm}}>W{pgStart+1}–W{Math.min(pgStart+viewW,52)}</span>
            <button type="button" disabled={pgStart+viewW>=52} onClick={()=>setPgStart(p=>clamp(p+viewW,0,52))} style={{width:28,height:26,border:"none",borderLeft:`1px solid ${C.border}`,background:C.bg,color:C.textMd,cursor:"pointer",fontFamily:C.mono,fontSize:12,opacity:pgStart+viewW>=52?.35:1}}>→</button>
          </div>
        )}

        <div style={{width:1,height:18,background:C.border}}/>

        {/* M T D type toggles */}
        {([
          {key:"M",on:showM,set:setShowM,col:C.amber, bg:C.amberBg, bd:C.amberBd,  label:"Milestones"},
          {key:"T",on:showT,set:setShowT,col:C.blue,  bg:C.blueLt,  bd:C.border,   label:"Tasks"},
          {key:"D",on:showD,set:setShowD,col:C.violet,bg:C.violetBg,bd:C.violetBd, label:"Deliverables"},
        ] as const).map(({key,on,set,col,bg,bd,label})=>(
          <button key={key} type="button" onClick={()=>set(!on)} title={`${on?"Hide":"Show"} ${label}`}
            style={{display:"flex",alignItems:"center",gap:5,padding:"3px 10px",background:on?bg:C.bg,border:`1.5px solid ${on?col:C.border}`,cursor:"pointer",fontFamily:C.mono,fontSize:9,color:on?col:C.textSm,fontWeight:on?700:400,transition:"all .12s"}}>
            <span style={{fontWeight:700,fontSize:10}}>{key}</span>
            <span style={{fontSize:8}}>{label}</span>
          </button>
        ))}

        <div style={{width:1,height:18,background:C.border}}/>

        {/* search */}
        <div style={{display:"flex",alignItems:"center",gap:6,border:`1.5px solid ${C.border}`,background:C.bg,padding:"3px 10px"}}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke={C.textSm} strokeWidth="2.2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search items…" aria-label="Search schedule items"
            style={{border:"none",background:"transparent",fontFamily:C.mono,fontSize:9,color:C.text,outline:"none",width:120}}/>
          {search&&<button type="button" onClick={()=>setSearch("")} aria-label="Clear search" style={{border:"none",background:"none",cursor:"pointer",color:C.textSm,fontSize:13,padding:0}}>×</button>}
        </div>

        <div style={{marginLeft:"auto",display:"flex",gap:6,alignItems:"center"}}>
          {/* Import WBS */}
          {!readOnly&&(
            <button type="button" onClick={appendFromWbs} disabled={wbsLoading} style={{padding:"4px 10px",fontFamily:C.mono,fontSize:9,cursor:wbsLoading?"not-allowed":"pointer",background:C.bg,color:C.textMd,border:`1.5px solid ${C.border}`,opacity:wbsLoading?.6:1}}>
              {wbsLoading?"Loading WBS…":"Import WBS"}
            </button>
          )}

          {/* Excel / PPT */}
          <div style={{display:"flex",border:`1.5px solid ${C.border}`,overflow:"hidden"}}>
            <button type="button" onClick={triggerExcelDownload} disabled={!doc.items?.length} style={{padding:"4px 10px",fontFamily:C.mono,fontSize:9,cursor:"pointer",background:C.bg,color:C.textMd,border:"none",borderRight:`1px solid ${C.border}`,opacity:!doc.items?.length?.5:1}}>Excel</button>
            <button type="button" onClick={triggerPptxDownload}  disabled={!doc.items?.length} style={{padding:"4px 10px",fontFamily:C.mono,fontSize:9,cursor:"pointer",background:C.bg,color:C.textMd,border:"none",opacity:!doc.items?.length?.5:1}}>PPT</button>
          </div>

          {/* + Phase */}
          {!readOnly&&(
            <button type="button" onClick={addPhase} style={{padding:"4px 12px",fontFamily:C.mono,fontSize:9,fontWeight:700,cursor:"pointer",background:C.bg,color:C.textMd,border:`1.5px solid ${C.border}`,transition:"all .12s"}}>
              + Phase
            </button>
          )}

          {/* Save */}
          {!readOnly&&(
            <button type="button" onClick={()=>save(true)} disabled={isPending||!dirty}
              style={{padding:"4px 14px",fontFamily:C.mono,fontSize:9,fontWeight:700,cursor:dirty&&!isPending?"pointer":"default",background:dirty&&!isPending?`linear-gradient(120deg,${C.h1},${C.h2})`:"#C8CFD8",color:"#FFF",border:"none",letterSpacing:".05em",boxShadow:dirty&&!isPending?`0 2px 8px ${C.h1}55`:"none",display:"flex",alignItems:"center",gap:7,transition:"all .15s"}}>
              {isPending&&<div style={{width:10,height:10,border:"2px solid rgba(255,255,255,.3)",borderTopColor:"#FFF",borderRadius:"50%",animation:"spin 0.7s linear infinite"}}/>}
              Save ⌘S
              {dirty&&!isPending&&<span style={{width:7,height:7,borderRadius:"50%",background:"#FCD34D"}} title="Unsaved changes"/>}
            </button>
          )}
        </div>
      </div>

      {/* ═══ LEGEND ROW ═══ */}
      <div style={{background:C.surface,borderBottom:`1px solid ${C.border}`,padding:"4px 22px",display:"flex",alignItems:"center",gap:14,flexShrink:0,flexWrap:"wrap" as const}}>
        <ULabel>Legend:</ULabel>
        {([
          {icon:<span style={{display:"inline-block",width:9,height:9,background:C.amber,transform:"rotate(45deg)",border:`1.5px solid ${C.amberBd}`}}/>, label:"Milestone"},
          {icon:<span style={{display:"inline-block",width:9,height:9,borderRadius:"50%",background:C.blue}}/>,                                          label:"Task"},
          {icon:<span style={{display:"inline-block",width:9,height:9,background:C.violet}}/>,                                                            label:"Deliverable"},
        ] as const).map(({icon,label})=>(
          <span key={label} style={{display:"flex",alignItems:"center",gap:5,fontFamily:C.mono,fontSize:9,color:C.textMd}}>{icon}{label}</span>
        ))}
        <div style={{width:1,height:12,background:C.border}}/>
        {STATUS_KEYS.map(k=>{ const s=STATUS_CFG[k]; return(
          <span key={k} style={{display:"flex",alignItems:"center",gap:5,fontFamily:C.mono,fontSize:9,color:C.textMd}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:s.color}}/>{s.label}
          </span>
        );})}
        <div style={{width:1,height:12,background:C.border}}/>
        <span style={{fontFamily:C.mono,fontSize:8,color:C.textSm}}>Drag to move · Drag right edge to resize · ← → shift · ⌘S save · Del delete</span>
      </div>

      {/* ═══ MAIN BODY ═══ */}
      <div style={{flex:1,display:"flex",overflow:"hidden"}}>
        <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

          {/* Sticky week header */}
          <div style={{flexShrink:0,display:"flex",background:"#E4E9F2",borderBottom:`2px solid ${C.borderMd}`,zIndex:30}}>
            <div style={{width:SIDE_W,minWidth:SIDE_W,flexShrink:0,padding:"9px 16px",borderRight:`2px solid ${C.borderMd}`,display:"flex",alignItems:"center"}}>
              <ULabel>Phase / Item</ULabel>
            </div>
            <div style={{flex:1,overflow:"hidden"}}>
              <div id="gantt-hdr-inner" style={{display:"flex",width:pageWeeks.length*WEEK_W}}>
                {pageWeeks.map((w,i)=>(
                  <div key={w.idx} style={{width:WEEK_W,minWidth:WEEK_W,borderRight:`1px solid ${C.border}`,padding:"7px 0",textAlign:"center" as const,position:"relative",background:i%2===0?"#E4E9F2":"#DDE3EE"}}>
                    <Mono style={{fontSize:11,fontWeight:700,color:C.text,display:"block"}}>{w.label}</Mono>
                    <Mono style={{fontSize:8,color:C.textSm,display:"block",marginTop:2}}>{w.range}</Mono>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable body */}
          <div ref={scrollRef} style={{flex:1,overflow:"auto",position:"relative"}}
            onScroll={e=>{
              const hdr=document.getElementById("gantt-hdr-inner");
              if(hdr) hdr.style.transform=`translateX(-${e.currentTarget.scrollLeft}px)`;
              recompDeps();
            }}>

            {/* SVG dep overlay */}
            <div ref={svgWrapRef} style={{position:"absolute",inset:0,width:SIDE_W+pageWeeks.length*WEEK_W,height:totalH,minWidth:"100%",minHeight:"100%",pointerEvents:"none",zIndex:20}} aria-hidden="true">
              {depPaths.length>0&&(
                <svg style={{position:"absolute",inset:0,overflow:"visible"}} width={SIDE_W+pageWeeks.length*WEEK_W} height={totalH}>
                  {depPaths.map((p,i)=>(
                    <g key={`${p.predId}_${p.succId}_${i}`}>
                      <path d={depPathD(p.a)} fill="none" stroke="rgba(99,102,241,.45)" strokeWidth={1.5} strokeDasharray="4 2" strokeLinejoin="round" strokeLinecap="round"/>
                      <path d={arrowPt(p.a)} fill="none" stroke="rgba(99,102,241,.45)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round"/>
                    </g>
                  ))}
                </svg>
              )}
            </div>

            {/* Today line */}
            {todayX!==null&&(
              <div style={{position:"absolute",top:0,left:SIDE_W+todayX,width:2,height:totalH,background:C.blue,opacity:.2,pointerEvents:"none",zIndex:5}} aria-hidden="true">
                <div style={{position:"absolute",top:0,left:"50%",transform:"translateX(-50%)",background:C.blue,color:"#FFF",fontFamily:C.mono,fontSize:8,fontWeight:700,padding:"2px 7px",whiteSpace:"nowrap" as const}}>TODAY</div>
              </div>
            )}

            {/* Phase rows */}
            {doc.phases.map((ph,pi)=>{
              const accent   =C.phaseAccents[pi%C.phaseAccents.length];
              const accentBg =C.phaseAccentBgs[pi%C.phaseAccentBgs.length];
              const isCol    =!!collapsed[ph.id];
              const phItems  =itemsByPhase.get(ph.id)??[];
              const allPhItems=doc.items.filter(i=>i.phaseId===ph.id);
              const pct      =compactPct(allPhItems.filter(i=>i.type!=="milestone"));

              return (
                <div key={ph.id} style={{borderBottom:`2px solid ${C.borderMd}`}}>

                  {/* Phase header row */}
                  <div style={{display:"flex",height:PH_HDR_H,background:accentBg,borderBottom:`1px solid ${accent}33`,borderLeft:`5px solid ${accent}`}}>
                    <div style={{width:SIDE_W-5,minWidth:SIDE_W-5,flexShrink:0,display:"flex",alignItems:"center",gap:7,padding:"0 10px",borderRight:`2px solid ${C.borderMd}`}}>
                      <button type="button" onClick={()=>setCol(p=>({...p,[ph.id]:!p[ph.id]}))} aria-expanded={!isCol} aria-label={`${isCol?"Expand":"Collapse"} phase ${ph.name}`}
                        style={{background:"none",border:"none",cursor:"pointer",padding:0,display:"flex",alignItems:"center",flexShrink:0}}>
                        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{transform:isCol?"none":"rotate(90deg)",transition:"transform .15s"}} aria-hidden="true">
                          <path d="M4 2l4 4-4 4" stroke={accent} strokeWidth="2.2" strokeLinecap="square"/>
                        </svg>
                      </button>
                      <input value={ph.name} disabled={readOnly} onChange={e=>updatePhase(ph.id,{name:e.target.value})}
                        aria-label={`Phase name: ${ph.name}`}
                        style={{flex:1,background:"none",border:"none",outline:"none",fontFamily:C.sans,fontSize:13,fontWeight:700,color:C.text,padding:0,minWidth:0}}/>
                      <span style={{fontFamily:C.mono,fontSize:9,fontWeight:700,color:accent,background:"rgba(255,255,255,.6)",border:`1.5px solid ${accent}44`,padding:"1px 7px",flexShrink:0}}>{allPhItems.length}</span>
                      {!readOnly&&(
                        <button type="button" onClick={()=>deletePhase(ph.id)} title={`Delete phase ${ph.name}`} aria-label={`Delete phase ${ph.name}`}
                          style={{background:"none",border:"none",cursor:"pointer",padding:2,color:C.textSm,flexShrink:0,opacity:.6}}>
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                        </button>
                      )}
                    </div>
                    {/* Progress in header */}
                    <div style={{flex:1,display:"flex",alignItems:"center",padding:"0 14px",gap:12}}>
                      <div style={{flex:1,height:4,background:"rgba(0,0,0,.08)",overflow:"hidden",maxWidth:200}}>
                        <div style={{width:`${pct}%`,height:"100%",background:accent,transition:"width .3s"}} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}/>
                      </div>
                      <Mono style={{fontSize:9,fontWeight:700,color:accent}}>{pct}%</Mono>
                      <Mono style={{fontSize:9,color:C.textSm,marginLeft:4}}>{allPhItems.length} items</Mono>
                    </div>
                  </div>

                  {/* Swim lanes */}
                  {!isCol&&(
                    <>
                      {phItems.length===0?(
                        <div style={{display:"flex",height:LANE_H,background:C.surface,borderBottom:`1px solid ${C.border}`}}>
                          <div style={{width:SIDE_W,minWidth:SIDE_W,flexShrink:0,borderRight:`2px solid ${C.borderMd}`,borderLeft:`5px solid ${accent}22`,display:"flex",alignItems:"center",padding:"0 12px 0 18px"}}>
                            <span style={{fontFamily:C.mono,fontSize:9,color:C.textSm}}>No items</span>
                          </div>
                          <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",position:"relative" as const}}>
                            {pageWeeks.map((_,i)=><div key={i} style={{position:"absolute",top:0,bottom:0,left:i*WEEK_W,width:WEEK_W,borderRight:`1px solid ${C.border}`,background:i%2===0?"transparent":"rgba(0,0,0,.012)"}} aria-hidden="true"/>)}
                            <div style={{position:"relative",zIndex:2,border:`1.5px dashed ${C.border}`,padding:"4px 20px"}}>
                              <span style={{fontFamily:C.mono,fontSize:9,color:C.textSm}}>Add items using the buttons below</span>
                            </div>
                          </div>
                        </div>
                      ):phItems.map((it,ii)=>{
                        const geom =geomMap.get(it.id);
                        const isSel=selId===it.id;

                        return (
                          <div key={it.id} style={{display:"flex",height:LANE_H,background:isSel?C.blueLt:ii%2===0?C.surface:"#F8FAFB",borderBottom:`1px solid ${C.border}`,transition:"background .1s"}}>
                            {/* sidebar */}
                            <div style={{width:SIDE_W,minWidth:SIDE_W,flexShrink:0,borderRight:`2px solid ${C.borderMd}`,borderLeft:`5px solid ${accent}`,display:"flex",alignItems:"center",gap:7,padding:"0 10px 0 14px",cursor:"pointer",overflow:"hidden"}}
                              onClick={()=>{setSelId(it.id);setPanel(true);setEndErr("");}}>
                              <TypeBadge type={it.type}/>
                              <span style={{fontFamily:C.sans,fontSize:11,fontWeight:500,color:C.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const,flex:1}}>{it.name}</span>
                              <StatusPill status={it.status}/>
                            </div>
                            {/* swim lane timeline */}
                            <div style={{flex:1,position:"relative" as const,overflow:"hidden"}}>
                              {pageWeeks.map((_,i)=><div key={i} aria-hidden="true" style={{position:"absolute",top:0,bottom:0,left:i*WEEK_W,width:WEEK_W,borderRight:`1px solid ${C.border}`,background:i%2===0?"transparent":"rgba(0,0,0,.012)",pointerEvents:"none"}}/>)}
                              {todayX!==null&&<div aria-hidden="true" style={{position:"absolute",top:0,bottom:0,left:todayX,width:2,background:C.blue,opacity:.12,pointerEvents:"none",zIndex:1}}/>}
                              {geom&&(
                                <div ref={el=>regBar(it.id,el as HTMLElement|null)} style={{position:"absolute",inset:0}}>
                                  <GanttBar
                                    item={it} geom={geom} isSelected={isSel} readOnly={readOnly}
                                    onDown={e=>beginDrag(e,it.id,"move")}
                                    onDownResize={e=>beginDrag(e,it.id,"resize_end")}
                                    onClick={e=>{if(dragRef.current?.moved)return;e.stopPropagation();setSelId(it.id);setPanel(true);setEndErr("");}}
                                  />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}

                      {/* Add row */}
                      {!readOnly&&(
                        <div style={{display:"flex",height:ADD_ROW_H,background:`${accentBg}55`,borderBottom:`1px solid ${C.border}`}}>
                          <div style={{width:SIDE_W,minWidth:SIDE_W,flexShrink:0,borderRight:`2px solid ${C.borderMd}`,borderLeft:`5px solid ${accent}22`,display:"flex",alignItems:"center",gap:6,padding:"0 10px 0 16px"}}>
                            <ULabel style={{color:C.textSm,marginRight:2}}>Add:</ULabel>
                            {([
                              ["milestone","◆",C.amber, C.amberBg, C.amberBd, "M"],
                              ["task",     "●",C.blue,  C.blueLt,  C.border,  "T"],
                              ["deliverable","■",C.violet,C.violetBg,C.violetBd,"D"],
                            ] as const).map(([type,ic,col,bg,bd,short])=>(
                              <button key={type} type="button" onClick={()=>addItem(ph.id,type as ItemType)}
                                aria-label={`Add ${type} to ${ph.name}`}
                                style={{display:"inline-flex",alignItems:"center",gap:4,padding:"2px 9px",border:`1.5px solid ${bd}`,background:bg,fontFamily:C.mono,fontSize:8,color:col,cursor:"pointer",fontWeight:700,transition:"all .1s"}}>
                                {ic} {short}
                              </button>
                            ))}
                          </div>
                          <div style={{flex:1}}/>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ═══ EDIT PANEL ═══ */}
        {panelOpen&&selItem&&(
          <aside style={{width:348,flexShrink:0,background:C.surface,borderLeft:`2px solid ${C.border}`,display:"flex",flexDirection:"column",zIndex:30}}>
            <div style={{display:"flex",alignItems:"center",gap:8,padding:"11px 14px",borderBottom:`1px solid ${C.border}`,background:`linear-gradient(120deg,${C.h1}11,${C.h2}11)`,flexShrink:0}}>
              <TypeBadge type={selItem.type}/>
              <span style={{fontFamily:C.sans,fontSize:13,fontWeight:700,color:C.text}}>Edit Item</span>
              <button type="button" onClick={()=>{setPanel(false);setSelId(null);setEndErr("");}} aria-label="Close edit panel"
                style={{marginLeft:"auto",background:"none",border:"none",cursor:"pointer",color:C.textSm,fontSize:18,lineHeight:1}}>×</button>
            </div>

            <div style={{flex:1,overflowY:"auto",padding:14,display:"flex",flexDirection:"column",gap:14}}>
              {/* quick actions */}
              {!readOnly&&(
                <div style={{display:"flex",flexWrap:"wrap" as const,gap:6}}>
                  {([
                    ["✓ Done",  ()=>updateItem(selItem.id,{status:"done"}),    C.violet,C.violetBg,C.violetBd],
                    ["← 1 wk", ()=>shiftItem(selItem.id,-1),                  C.textMd,C.bg,C.border],
                    ["1 wk →",  ()=>shiftItem(selItem.id,1),                   C.textMd,C.bg,C.border],
                    ["⧉ Copy",  ()=>duplicateItem(selItem.id),                 C.blue,C.blueLt,C.border],
                  ] as const).map(([lbl,fn,col,bg,bd])=>(
                    <button key={lbl} type="button" onClick={fn as ()=>void} style={{padding:"3px 10px",fontFamily:C.mono,fontSize:9,fontWeight:700,cursor:"pointer",border:`1.5px solid ${bd}`,background:bg,color:col}}>{lbl}</button>
                  ))}
                </div>
              )}

              {/* Name */}
              <div>
                <ULabel style={{display:"block",marginBottom:5}}>Name</ULabel>
                <input id="item-name" value={selItem.name} disabled={readOnly} onChange={e=>updateItem(selItem.id,{name:e.target.value})}
                  style={{width:"100%",padding:"6px 10px",border:`1.5px solid ${C.border}`,fontFamily:C.sans,fontSize:12,color:C.text,outline:"none",boxSizing:"border-box" as const}}/>
              </div>

              {/* Start / End */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <ULabel style={{display:"block",marginBottom:5}}>Start</ULabel>
                  <input id="item-start" type="date" value={selItem.start||""} disabled={readOnly}
                    onChange={e=>{setEndErr("");updateItem(selItem.id,{start:e.target.value});}}
                    style={{width:"100%",padding:"6px 8px",border:`1.5px solid ${C.border}`,fontFamily:C.mono,fontSize:10,color:C.text,outline:"none",boxSizing:"border-box" as const}}/>
                </div>
                <div>
                  <ULabel style={{display:"block",marginBottom:5}}>End</ULabel>
                  <input id="item-end" type="date"
                    value={selItem.type==="milestone"?"":selItem.end||""}
                    disabled={readOnly||selItem.type==="milestone"}
                    aria-invalid={!!endErr} aria-describedby={endErr?"end-err":undefined}
                    onChange={e=>updateItem(selItem.id,{end:e.target.value})}
                    style={{width:"100%",padding:"6px 8px",border:`1.5px solid ${endErr?C.red:C.border}`,fontFamily:C.mono,fontSize:10,color:C.text,outline:"none",boxSizing:"border-box" as const,background:endErr?C.redBg:"#FFF",opacity:selItem.type==="milestone"?.45:1}}/>
                  {endErr&&<p id="end-err" role="alert" style={{margin:"3px 0 0",fontFamily:C.mono,fontSize:9,color:C.red}}>{endErr}</p>}
                </div>
              </div>

              {/* Type / Status */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                <div>
                  <ULabel style={{display:"block",marginBottom:5}}>Type</ULabel>
                  <select id="item-type" value={selItem.type} disabled={readOnly} onChange={e=>updateItem(selItem.id,{type:e.target.value as ItemType})}
                    style={{width:"100%",padding:"6px 8px",border:`1.5px solid ${C.border}`,fontFamily:C.mono,fontSize:10,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box" as const}}>
                    <option value="milestone">Milestone</option>
                    <option value="task">Task</option>
                    <option value="deliverable">Deliverable</option>
                  </select>
                </div>
                <div>
                  <ULabel style={{display:"block",marginBottom:5}}>Status</ULabel>
                  <select id="item-status" value={selItem.status} disabled={readOnly} onChange={e=>updateItem(selItem.id,{status:e.target.value as ItemStatus})}
                    style={{width:"100%",padding:"6px 8px",border:`1.5px solid ${C.border}`,fontFamily:C.mono,fontSize:10,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box" as const}}>
                    <option value="on_track">On Track</option>
                    <option value="at_risk">At Risk</option>
                    <option value="delayed">Delayed</option>
                    <option value="done">Done</option>
                  </select>
                </div>
              </div>

              {/* Status badge */}
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{width:10,height:10,borderRadius:"50%",background:STATUS_CFG[selItem.status]?.color,display:"inline-block"}}/>
                <span style={{fontFamily:C.mono,fontSize:10,fontWeight:700,color:STATUS_CFG[selItem.status]?.color}}>{STATUS_CFG[selItem.status]?.label}</span>
              </div>

              {/* Phase */}
              <div>
                <ULabel style={{display:"block",marginBottom:5}}>Phase</ULabel>
                <select value={selItem.phaseId} disabled={readOnly} onChange={e=>updateItem(selItem.id,{phaseId:e.target.value})}
                  style={{width:"100%",padding:"6px 8px",border:`1.5px solid ${C.border}`,fontFamily:C.sans,fontSize:11,color:C.text,background:C.surface,outline:"none",boxSizing:"border-box" as const}}>
                  {doc.phases.map(ph=><option key={ph.id} value={ph.id}>{ph.name}</option>)}
                </select>
              </div>

              {/* Dependencies */}
              <div>
                <ULabel style={{display:"block",marginBottom:5}}>Dependencies</ULabel>
                {!readOnly&&(
                  <div style={{position:"relative" as const,marginBottom:8}}>
                    <input value={depQ} onChange={e=>setDepQ(e.target.value)} placeholder="Search to add dependency…" aria-label="Search dependencies"
                      style={{width:"100%",padding:"6px 10px",border:`1.5px solid ${C.border}`,fontFamily:C.mono,fontSize:9,color:C.text,outline:"none",boxSizing:"border-box" as const}}/>
                    {depQ&&(
                      <div role="listbox" aria-label="Dependency candidates" style={{position:"absolute" as const,zIndex:40,top:"calc(100% + 2px)",left:0,right:0,background:C.surface,border:`1.5px solid ${C.border}`,maxHeight:160,overflowY:"auto",boxShadow:"0 4px 16px rgba(0,0,0,.12)"}}>
                        {depCands.length===0
                          ?<div style={{padding:"8px 10px",fontFamily:C.mono,fontSize:9,color:C.textSm}}>No matches</div>
                          :depCands.map(it=>(
                            <button key={it.id} type="button" role="option" aria-selected={false}
                              onClick={()=>{updateItem(selItem.id,{dependencies:[...(selItem.dependencies??[]),it.id]});setDepQ("");}}
                              style={{width:"100%",padding:"7px 10px",textAlign:"left" as const,border:"none",borderBottom:`1px solid ${C.border}`,background:C.surface,cursor:"pointer",fontFamily:C.sans,fontSize:11}}>
                              <div style={{fontWeight:600,color:C.text}}>{it.name}</div>
                              <Mono style={{fontSize:9,color:C.textSm}}>{it.type} · {it.start}{it.type!=="milestone"&&it.end?` → ${it.end}`:""}</Mono>
                            </button>
                          ))
                        }
                      </div>
                    )}
                  </div>
                )}
                <div style={{display:"flex",flexWrap:"wrap" as const,gap:5}} aria-label="Current dependencies">
                  {(selItem.dependencies??[]).map(id=>{
                    const it=itemById.get(id);
                    return (
                      <div key={id} style={{display:"inline-flex",alignItems:"center",gap:5,padding:"2px 8px",background:C.blueLt,border:`1px solid ${C.border}`,fontFamily:C.mono,fontSize:9,color:C.blue}}>
                        <span style={{maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" as const}}>{it?.name||`ID:${id.slice(0,6)}`}</span>
                        {!readOnly&&<button type="button" onClick={()=>updateItem(selItem.id,{dependencies:(selItem.dependencies??[]).filter(x=>x!==id)})} aria-label={`Remove dependency: ${it?.name}`} style={{background:"none",border:"none",cursor:"pointer",color:C.textSm,fontSize:13,padding:0,lineHeight:1}}>×</button>}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Notes */}
              <div>
                <ULabel style={{display:"block",marginBottom:5}}>Notes</ULabel>
                <textarea id="item-notes" value={selItem.notes||""} disabled={readOnly} rows={4} onChange={e=>updateItem(selItem.id,{notes:e.target.value})}
                  style={{width:"100%",padding:"6px 10px",border:`1.5px solid ${C.border}`,fontFamily:C.sans,fontSize:11,color:C.text,outline:"none",resize:"none" as const,boxSizing:"border-box" as const}}/>
              </div>
            </div>

            {/* Delete */}
            {!readOnly&&(
              <div style={{padding:12,borderTop:`1px solid ${C.border}`,flexShrink:0}}>
                <button type="button" onClick={()=>deleteItem(selItem.id)} aria-label={`Delete item: ${selItem.name}`}
                  style={{width:"100%",padding:"7px 0",fontFamily:C.mono,fontSize:9,fontWeight:700,cursor:"pointer",background:C.redBg,color:C.red,border:`1.5px solid ${C.redBd}`,display:"flex",alignItems:"center",justifyContent:"center",gap:6}}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M9 6V4h6v2"/></svg>
                  Delete Item
                </button>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* ═══ FOOTER STATUS BAR ═══ */}
      <div style={{background:C.text,borderTop:`2px solid ${C.blue}`,padding:"7px 22px",display:"flex",alignItems:"center",gap:16,flexShrink:0}} role="status" aria-label="Schedule summary">
        <div style={{display:"flex",alignItems:"center",gap:10,marginRight:16}}>
          <ULabel style={{color:"rgba(255,255,255,.4)"}}>Overall</ULabel>
          <div style={{width:100,height:4,background:"rgba(255,255,255,.1)",overflow:"hidden"}}>
            <div style={{width:`${overallPct}%`,height:"100%",background:`linear-gradient(90deg,${C.green},${C.blue})`,transition:"width .4s"}} role="progressbar" aria-valuenow={overallPct} aria-valuemin={0} aria-valuemax={100}/>
          </div>
          <Mono style={{fontSize:10,fontWeight:700,color:C.green}}>{overallPct}%</Mono>
        </div>
        {STATUS_KEYS.map(k=>sCounts[k]>0&&(
          <span key={k} style={{display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:8,height:8,borderRadius:"50%",background:STATUS_CFG[k].color}}/>
            <Mono style={{fontSize:9,fontWeight:700,color:STATUS_CFG[k].color}}>{sCounts[k]}</Mono>
            <Mono style={{fontSize:9,color:"rgba(255,255,255,.35)"}}>{STATUS_CFG[k].label}</Mono>
          </span>
        ))}
        <Mono style={{marginLeft:"auto",fontSize:9,color:"rgba(255,255,255,.25)"}}>
          {doc.items.length} items · {doc.phases.length} phases · {pageWeeks.length} wks
        </Mono>
      </div>

      {/* Hidden download anchor */}
      {/* eslint-disable-next-line jsx-a11y/anchor-has-content */}
      <a ref={downloadLinkRef} style={{display:"none"}} aria-hidden="true"/>
    </div>
  );
}