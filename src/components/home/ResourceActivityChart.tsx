// FILE: src/components/home/ResourceActivityChart.tsx
// Week-on-week resource activity: Capacity · Allocated · Pipeline
// Accepts real API data; falls back to deterministic demo data while loading.
"use client";

import React, { useMemo, useRef, useState } from "react";

export type ResourceWeek = {
  weekStart:      string;
  capacity:       number;
  allocated:      number;
  pipeline:       number;
  utilisationPct: number;
};

type Props = {
  weeks?:   ResourceWeek[];
  days:     number;
  loading?: boolean;
};

function mondayOf(date: Date): Date {
  const d = new Date(date); const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() - (day === 0 ? 6 : day - 1)); d.setUTCHours(0,0,0,0); return d;
}
function addW(d: Date, n: number): Date { const r = new Date(d); r.setUTCDate(r.getUTCDate() + 7*n); return r; }
function isoDate(d: Date) { return d.toISOString().slice(0,10); }
function shortDate(iso: string) {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function catmullRom(pts: [number,number][], close=false, floorY?: number): string {
  if (pts.length < 2) return "";
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0=pts[Math.max(i-1,0)], p1=pts[i], p2=pts[i+1], p3=pts[Math.min(i+2,pts.length-1)];
    const cp1x=p1[0]+(p2[0]-p0[0])/6, cp1y=p1[1]+(p2[1]-p0[1])/6;
    const cp2x=p2[0]-(p3[0]-p1[0])/6, cp2y=p2[1]-(p3[1]-p1[1])/6;
    d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)},${cp2x.toFixed(1)} ${cp2y.toFixed(1)},${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  if (close && floorY !== undefined) {
    const l=pts[pts.length-1], f=pts[0];
    d += ` L ${l[0].toFixed(1)} ${floorY.toFixed(1)} L ${f[0].toFixed(1)} ${floorY.toFixed(1)} Z`;
  }
  return d;
}

function generateDemo(numericDays: number): ResourceWeek[] {
  const n = Math.max(4, Math.round(numericDays / 7));
  const start = mondayOf(addW(new Date(), -n + 1));
  return Array.from({ length: n }, (_, i) => {
    const mon = addW(start, i);
    const seed = mon.getUTCDate() + mon.getUTCMonth() * 31;
    const cap   = 80 + Math.sin(seed*0.31)*12 + Math.sin(seed*0.07)*6;
    const alloc = cap * Math.min(0.55 + Math.sin(seed*0.41+1)*0.18 + Math.sin(seed*0.13)*0.09, 0.99);
    const pipe  = cap * (0.12 + Math.sin(seed*0.27+2)*0.08 + 0.04);
    return { weekStart: isoDate(mon), capacity: Math.round(cap*10)/10, allocated: Math.round(alloc*10)/10, pipeline: Math.round(pipe*10)/10, utilisationPct: Math.round((alloc/cap)*100) };
  });
}

const W=900, H=220, PAD={t:14,r:16,b:32,l:42};
const cW=W-PAD.l-PAD.r, cH=H-PAD.t-PAD.b;

export default function ResourceActivityChart({ weeks: propWeeks, days, loading }: Props) {
  const weeks = useMemo(() => (propWeeks && propWeeks.length > 0 ? propWeeks : generateDemo(days)), [propWeeks, days]);
  const svgRef = useRef<SVGSVGElement>(null);
  const [hov, setHov] = useState<number|null>(null);

  const maxVal = useMemo(() => Math.max(...weeks.flatMap(w=>[w.capacity, w.allocated+w.pipeline]), 1)*1.1, [weeks]);

  const yTicks = useMemo(() => {
    const top = Math.ceil(maxVal/10)*10;
    const step = top<=60?10:top<=120?20:top<=200?40:50;
    const t: number[] = []; for (let v=0; v<=top; v+=step) t.push(v); return t;
  }, [maxVal]);

  const xPos = (i:number) => PAD.l + (i/Math.max(weeks.length-1,1))*cW;
  const yPos = (v:number) => PAD.t + cH - (v/maxVal)*cH;
  const floorY = PAD.t + cH;

  const capPts   = useMemo(()=>weeks.map((w,i)=>[xPos(i),yPos(w.capacity)]  as [number,number]),[weeks,maxVal]);
  const allocPts = useMemo(()=>weeks.map((w,i)=>[xPos(i),yPos(w.allocated)] as [number,number]),[weeks,maxVal]);
  const pipePts  = useMemo(()=>weeks.map((w,i)=>[xPos(i),yPos(w.pipeline)]  as [number,number]),[weeks,maxVal]);

  const xLabels = useMemo(() => {
    const n=weeks.length; const step=n<=6?1:n<=12?2:3;
    return weeks.map((w,i)=>({i,label:shortDate(w.weekStart)})).filter((_,i)=>i%step===0);
  }, [weeks]);

  function onMouseMove(e: React.MouseEvent<SVGSVGElement>) {
    const svg=svgRef.current; if (!svg) return;
    const rect=svg.getBoundingClientRect();
    const svgX=((e.clientX-rect.left)/rect.width)*W;
    let best=0, bestDist=Infinity;
    for (let i=0; i<weeks.length; i++) { const dist=Math.abs(xPos(i)-svgX); if (dist<bestDist){bestDist=dist;best=i;} }
    setHov(best);
  }

  const hovData = hov!==null ? weeks[hov] : null;
  const TW=168, TH=120;
  const tooltipX = (i:number) => { const px=xPos(i); return px+TW>W-PAD.r?px-TW-8:px+10; };
  const utilColor=(p:number)=>p>=90?"#dc2626":p>=75?"#d97706":"#16a34a";
  const utilBg=(p:number)=>p>=90?"#fef2f2":p>=75?"#fefce8":"#f0fdf4";

  if (loading) return <div className="w-full animate-pulse" style={{height:220,background:"#f8fafc",borderRadius:8}}/>;

  return (
    <div style={{position:"relative",userSelect:"none"}}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="w-full" style={{height:220,cursor:"crosshair"}}
        onMouseMove={onMouseMove} onMouseLeave={()=>setHov(null)}>
        <defs>
          <linearGradient id="rcCapGrad"   x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#bfdbfe" stopOpacity=".50"/><stop offset="100%" stopColor="#bfdbfe" stopOpacity=".03"/></linearGradient>
          <linearGradient id="rcAllocGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#a7f3d0" stopOpacity=".65"/><stop offset="100%" stopColor="#a7f3d0" stopOpacity=".04"/></linearGradient>
          <linearGradient id="rcPipeGrad"  x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#ddd6fe" stopOpacity=".50"/><stop offset="100%" stopColor="#ddd6fe" stopOpacity=".03"/></linearGradient>
        </defs>
        {yTicks.map(tick=>(
          <g key={tick}>
            <line x1={PAD.l} y1={yPos(tick)} x2={W-PAD.r} y2={yPos(tick)} stroke="#f1f5f9" strokeWidth="1"/>
            <text x={PAD.l-6} y={yPos(tick)+3.5} textAnchor="end" fill="#94a3b8" fontSize="10">{(tick/5).toFixed(1)}</text>
          </g>
        ))}
        <path d={catmullRom(capPts,  true,floorY)} fill="url(#rcCapGrad)"/>
        <path d={catmullRom(pipePts, true,floorY)} fill="url(#rcPipeGrad)"/>
        <path d={catmullRom(allocPts,true,floorY)} fill="url(#rcAllocGrad)"/>
        <path d={catmullRom(capPts)}   fill="none" stroke="#93c5fd" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d={catmullRom(allocPts)} fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinejoin="round"/>
        <path d={catmullRom(pipePts)}  fill="none" stroke="#a78bfa" strokeWidth="2"   strokeLinejoin="round" strokeDasharray="5 3"/>
        {hov!==null && <line x1={xPos(hov)} y1={PAD.t} x2={xPos(hov)} y2={floorY} stroke="#94a3b8" strokeWidth="1" strokeDasharray="3 3"/>}
        {hov!==null && [{pts:capPts,color:"#93c5fd"},{pts:allocPts,color:"#34d399"},{pts:pipePts,color:"#a78bfa"}].map(({pts,color})=>(
          <circle key={color} cx={pts[hov][0]} cy={pts[hov][1]} r="4.5" fill={color} stroke="white" strokeWidth="2"/>
        ))}
        {hov!==null && hovData && (()=>{
          const tx=tooltipX(hov), ty=PAD.t+2, up=hovData.utilisationPct;
          return (
            <g>
              <rect x={tx} y={ty} width={TW} height={TH} rx="8" fill="white" stroke="#e2e8f0" strokeWidth="1" style={{filter:"drop-shadow(0 4px 12px rgba(0,0,0,0.10))"}}/>
              <text x={tx+10} y={ty+17} fontSize="11" fontWeight="700" fill="#0f172a">w/c {shortDate(hovData.weekStart)}</text>
              <rect x={tx+TW-44} y={ty+5} width={36} height={16} rx="8" fill={utilBg(up)}/>
              <text x={tx+TW-26} y={ty+16} fontSize="10" fontWeight="800" textAnchor="middle" fill={utilColor(up)}>{up}%</text>
              {[
                {label:"Capacity", value:`${(hovData.capacity/5).toFixed(1)} FTE`, color:"#93c5fd", dy:36},
                {label:"Allocated",value:`${(hovData.allocated/5).toFixed(1)} FTE`,color:"#34d399", dy:56},
                {label:"Pipeline", value:`${(hovData.pipeline/5).toFixed(1)} FTE`, color:"#a78bfa", dy:76},
              ].map(({label,value,color,dy})=>(
                <g key={label}>
                  <circle cx={tx+16} cy={ty+dy-4} r="4" fill={color}/>
                  <text x={tx+26} y={ty+dy} fontSize="11" fontWeight="600" fill="#334155">{label}</text>
                  <text x={tx+TW-10} y={ty+dy} fontSize="11" fontWeight="700" fill="#0f172a" textAnchor="end">{value}</text>
                </g>
              ))}
              <line x1={tx+10} y1={ty+88} x2={tx+TW-10} y2={ty+88} stroke="#f1f5f9" strokeWidth="1"/>
              <text x={tx+10} y={ty+103} fontSize="10" fill="#94a3b8">Utilisation</text>
              <text x={tx+TW-10} y={ty+103} fontSize="10" fontWeight="800" textAnchor="end" fill={utilColor(up)}>{up}%</text>
            </g>
          );
        })()}
        {xLabels.map(({i,label})=>(
          <text key={i} x={xPos(i)} y={H-7} textAnchor="middle" fill={hov===i?"#475569":"#94a3b8"} fontSize="10" fontWeight={hov===i?"700":"400"}>{label}</text>
        ))}
      </svg>
    </div>
  );
}