"use client";
import { useState, useRef, useEffect } from "react";

type Project = {
  id: string; name: string; code: string; status: "Active" | "Closed";
  pm: string | null; createdAt: string; startDate: string | null;
  endDate: string | null; colour: string;
};

const INIT: Project[] = [
  { id:"1", name:"Project Saturn",  code:"100019", status:"Active", pm:null, createdAt:"06/01/2026", startDate:"25/12/2025", endDate:"30/06/2026", colour:"#06b6d4" },
  { id:"2", name:"Project Comfort", code:"100009", status:"Active", pm:null, createdAt:"18/12/2025", startDate:null, endDate:null, colour:"#8b5cf6" },
  { id:"3", name:"Project Neptune", code:"100008", status:"Active", pm:null, createdAt:"18/12/2025", startDate:null, endDate:null, colour:"#f59e0b" },
  { id:"4", name:"Project Nebula",  code:"100007", status:"Active", pm:null, createdAt:"18/12/2025", startDate:null, endDate:null, colour:"#10b981" },
];

const COLOURS = ["#06b6d4","#3b82f6","#8b5cf6","#ec4899","#f59e0b","#10b981","#ef4444","#f97316"];

export default function ProjectsPage() {
  const [projects, setProjects]   = useState(INIT);
  const [filter, setFilter]       = useState("Active");
  const [search, setSearch]       = useState("");
  const [sort, setSort]           = useState("Newest");
  const [showModal, setShowModal] = useState(false);

  const filtered = projects
    .filter(p => filter === "All" || p.status === filter)
    .filter(p => p.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sort === "A-Z" ? a.name.localeCompare(b.name) : b.createdAt.localeCompare(a.createdAt));

  return (
    <div style={{ minHeight:"100vh", background:"#f8fafc", fontFamily:"'Inter',-apple-system,sans-serif", padding:"32px 40px", color:"#0f172a" }}>
      {/* Header */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", marginBottom:24 }}>
        <div style={{ display:"flex", alignItems:"flex-start", gap:14 }}>
          <div style={{ width:42, height:42, borderRadius:12, background:"#e0f7fa", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0, marginTop:2 }}>
            <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
          </div>
          <div>
            <h1 style={{ fontSize:26, fontWeight:800, margin:0, letterSpacing:"-.5px" }}>Projects</h1>
            <p style={{ fontSize:13, color:"#64748b", margin:"3px 0 0" }}>Your portfolio entry point — search, filter, and jump into governance.</p>
          </div>
        </div>
        <div style={{ display:"flex", gap:10, alignItems:"center" }}>
          <button style={{ background:"white", color:"#0f172a", border:"1px solid #e2e8f0", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer" }}>
            Global artifacts
          </button>
          <button onClick={() => setShowModal(true)}
            style={{ background:"#06b6d4", color:"white", border:"none", borderRadius:10, padding:"9px 18px", fontSize:13, fontWeight:700, cursor:"pointer", display:"flex", alignItems:"center", gap:7 }}>
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="white" strokeWidth="2" strokeLinecap="round"/></svg>
            New project
          </button>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:"flex", gap:8, marginBottom:20 }}>
        {[
          { label:"Total",  value:projects.length,                                colour:"#06b6d4" },
          { label:"Active", value:projects.filter(p=>p.status==="Active").length, colour:"#10b981" },
          { label:"Closed", value:projects.filter(p=>p.status==="Closed").length, colour:"#94a3b8" },
        ].map(s => (
          <div key={s.label} style={{ display:"flex", alignItems:"center", gap:8, padding:"6px 14px", background:"white", border:"1px solid #e2e8f0", borderRadius:10, fontSize:13, color:"#64748b" }}>
            <span style={{ width:7, height:7, borderRadius:"50%", background:s.colour, display:"inline-block" }} />
            <span style={{ fontWeight:700, color:"#0f172a", marginRight:2 }}>{s.value}</span>{s.label}
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:12, flexWrap:"wrap" }}>
        <div style={{ display:"flex", gap:4 }}>
          {["Active","Closed","All"].map(f => (
            <button key={f} onClick={() => setFilter(f)}
              style={{ background:filter===f?"#06b6d4":"white", border:`1px solid ${filter===f?"#06b6d4":"#e2e8f0"}`, borderRadius:8, padding:"7px 14px", fontSize:13, fontWeight:filter===f?700:500, cursor:"pointer", color:filter===f?"white":"#64748b" }}>
              {f}
            </button>
          ))}
        </div>
        <div style={{ position:"relative", flex:1, maxWidth:280 }}>
          <svg style={{ position:"absolute", left:10, top:"50%", transform:"translateY(-50%)" }} width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="8" stroke="#94a3b8" strokeWidth="2"/><path d="m21 21-4.35-4.35" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          <input style={{ width:"100%", border:"1px solid #e2e8f0", borderRadius:8, padding:"8px 10px 8px 30px", fontSize:13, outline:"none", background:"white", boxSizing:"border-box" }}
            placeholder="Search projects…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div style={{ display:"flex", gap:4, marginLeft:"auto" }}>
          {["Newest","A-Z"].map(s => (
            <button key={s} onClick={() => setSort(s)}
              style={{ background:sort===s?"#06b6d4":"white", border:`1px solid ${sort===s?"#06b6d4":"#e2e8f0"}`, borderRadius:8, padding:"7px 14px", fontSize:13, fontWeight:sort===s?700:500, cursor:"pointer", color:sort===s?"white":"#64748b" }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <p style={{ fontSize:13, color:"#94a3b8", fontWeight:500, margin:"0 0 10px" }}>
        {filtered.length} project{filtered.length !== 1 ? "s" : ""}
      </p>

      {/* List */}
      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {filtered.map(p => (
          <ProjectRow key={p.id} project={p}
            onClose={() => setProjects(prev => prev.map(x => x.id===p.id ? {...x,status:"Closed"} : x))} />
        ))}
        {filtered.length === 0 && (
          <div style={{ textAlign:"center", padding:"40px 0", color:"#94a3b8", fontSize:14 }}>No projects match your filters.</div>
        )}
      </div>

      {showModal && (
        <CreateModal onClose={() => setShowModal(false)}
          onCreate={p => { setProjects(prev => [p,...prev]); setShowModal(false); }} />
      )}
    </div>
  );
}

function ProjectRow({ project: p, onClose }) {
  const dateRange = p.startDate && p.endDate ? `${p.startDate} — ${p.endDate}` : "— — —";
  const actions = [
    { label:"Overview",  icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#64748b" strokeWidth="2"/><path d="M12 8v4l3 3" stroke="#64748b" strokeWidth="2" strokeLinecap="round"/></svg> },
    { label:"Artifacts", icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#64748b" strokeWidth="2"/><path d="M14 2v6h6" stroke="#64748b" strokeWidth="2" strokeLinecap="round"/></svg> },
    { label:"Members",   icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><circle cx="9" cy="7" r="4" stroke="#64748b" strokeWidth="2"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="#64748b" strokeWidth="2" strokeLinecap="round"/></svg> },
    { label:"Approvals", icon:<svg width="13" height="13" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg> },
  ];

  return (
    <div style={{ background:"white", border:"1px solid #e2e8f0", borderRadius:14, padding:"16px 20px", display:"flex", alignItems:"center", gap:14 }}>
      <span style={{ width:10, height:10, borderRadius:"50%", background:p.colour, flexShrink:0 }} />
      <div style={{ flex:1, display:"flex", flexDirection:"column", gap:5 }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <span style={{ fontSize:15, fontWeight:700 }}>{p.name}</span>
          <span style={{ fontSize:11, fontWeight:700, background:"#f1f5f9", color:"#64748b", borderRadius:6, padding:"2px 7px", border:"1px solid #e2e8f0" }}>{p.code}</span>
          <span style={{ fontSize:11, fontWeight:700, borderRadius:6, padding:"2px 7px",
            background:p.status==="Active"?"#dcfce7":"#f1f5f9", color:p.status==="Active"?"#15803d":"#64748b" }}>
            {p.status}
          </span>
        </div>
        <div style={{ fontSize:12, color:"#94a3b8", display:"flex", alignItems:"center", gap:6 }}>
          PM: <span style={{ color:p.pm?"#0f172a":"#06b6d4" }}>{p.pm ?? "Unassigned"}</span>
          <span style={{ width:3, height:3, borderRadius:"50%", background:"#cbd5e1" }} />
          Created {p.createdAt}
        </div>
        <div style={{ fontSize:12, color:"#94a3b8", display:"flex", alignItems:"center" }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ marginRight:4, opacity:.5 }}>
            <rect x="3" y="4" width="18" height="18" rx="2" stroke="#64748b" strokeWidth="2"/>
            <path d="M16 2v4M8 2v4M3 10h18" stroke="#64748b" strokeWidth="2" strokeLinecap="round"/>
          </svg>
          {dateRange}
        </div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0, flexWrap:"wrap" }}>
        {actions.map(a => (
          <a key={a.label} href="#" style={{ display:"flex", alignItems:"center", gap:5, padding:"6px 11px", border:"1px solid #e2e8f0", borderRadius:8, fontSize:12, fontWeight:500, color:"#475569", textDecoration:"none", background:"white" }}>
            {a.icon}<span>{a.label}</span>
          </a>
        ))}
        <button onClick={onClose} style={{ padding:"6px 14px", border:"1px solid #fde68a", borderRadius:8, fontSize:12, fontWeight:700, color:"#92400e", background:"#fffbeb", cursor:"pointer" }}>Close</button>
        <button style={{ padding:"6px 8px", border:"1px solid #e2e8f0", borderRadius:8, background:"white", cursor:"pointer", display:"flex", alignItems:"center" }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="5" r="1.5" fill="#64748b"/><circle cx="12" cy="12" r="1.5" fill="#64748b"/><circle cx="12" cy="19" r="1.5" fill="#64748b"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function CreateModal({ onClose, onCreate }) {
  const [name, setName]           = useState("");
  const [pm, setPm]               = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate]     = useState("");
  const [code, setCode]           = useState("");
  const [dept, setDept]           = useState("");
  const [resStatus, setResStatus] = useState("Confirmed");
  const [colour, setColour]       = useState(COLOURS[0]);
  const [step, setStep]           = useState(1);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (!name) { setCode(""); return; }
    const slug = name.replace(/[^a-zA-Z0-9\s]/g,"").trim()
      .split(/\s+/).map(w => w.slice(0,3).toUpperCase()).join("-");
    setCode(slug || "");
  }, [name]);

  const inputStyle = { border:"1px solid #e2e8f0", borderRadius:10, padding:"9px 12px", fontSize:13, outline:"none", width:"100%", boxSizing:"border-box", background:"white", color:"#0f172a" };
  const hintStyle  = { fontSize:11, color:"#94a3b8", margin:"2px 0 0" };

  function Field({ label, children }) {
    return (
      <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
        <label style={{ fontSize:11, fontWeight:700, letterSpacing:".07em", textTransform:"uppercase", color:"#64748b" }}>{label}</label>
        {children}
      </div>
    );
  }

  return (
    <div ref={overlayRef} onClick={e => { if (e.target===overlayRef.current) onClose(); }}
      style={{ position:"fixed", inset:0, background:"rgba(15,23,42,.45)", backdropFilter:"blur(4px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000, padding:20 }}>
      <div style={{ background:"white", borderRadius:20, width:"100%", maxWidth:560, boxShadow:"0 24px 60px rgba(0,0,0,.18)", display:"flex", flexDirection:"column", maxHeight:"90vh", overflow:"hidden" }}>

        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", padding:"24px 28px 0" }}>
          <div>
            <h2 style={{ fontSize:20, fontWeight:800, margin:0, letterSpacing:"-.3px" }}>Create a project</h2>
            <p style={{ fontSize:13, color:"#64748b", margin:"4px 0 10px" }}>Enterprise setup — define ownership and delivery lead.</p>
            <div style={{ display:"inline-flex", alignItems:"center", gap:6, background:"#ecfeff", border:"1px solid #a5f3fc", borderRadius:20, padding:"4px 10px", fontSize:11, fontWeight:600, color:"#0891b2" }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" stroke="#0891b2" strokeWidth="2"/></svg>
              Active organisation: Aliena HQ
            </div>
          </div>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", padding:4 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M18 6 6 18M6 6l12 12" stroke="#64748b" strokeWidth="2" strokeLinecap="round"/></svg>
          </button>
        </div>

        {/* Steps */}
        <div style={{ display:"flex", alignItems:"center", gap:8, padding:"20px 28px 0" }}>
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:"#06b6d4", color:"white", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700 }}>
              {step > 1 ? "✓" : "1"}
            </div>
            <span style={{ fontSize:12, fontWeight:600, color:step===1?"#06b6d4":"#94a3b8", textTransform:"uppercase", letterSpacing:".05em" }}>Basics</span>
          </div>
          <div style={{ flex:1, height:1, background:step>1?"#06b6d4":"#e2e8f0", transition:"background .3s" }} />
          <div style={{ display:"flex", alignItems:"center", gap:7 }}>
            <div style={{ width:24, height:24, borderRadius:"50%", background:step>=2?"#06b6d4":"#f1f5f9", color:step>=2?"white":"#94a3b8", display:"flex", alignItems:"center", justifyContent:"center", fontSize:11, fontWeight:700, transition:"all .3s" }}>2</div>
            <span style={{ fontSize:12, fontWeight:600, color:step===2?"#06b6d4":"#94a3b8", textTransform:"uppercase", letterSpacing:".05em" }}>Heatmap</span>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:"20px 28px", display:"flex", flexDirection:"column", gap:16, overflowY:"auto", flex:1 }}>
          {step === 1 ? (
            <>
              <Field label="Project owner">
                <input style={{ ...inputStyle, background:"#f8fafc", color:"#64748b" }} value="paapa51@hotmail.com" readOnly />
                <p style={hintStyle}>Accountable governance lead — auto-set to you.</p>
              </Field>
              <Field label="Project name">
                <input style={inputStyle} placeholder="e.g. Project Venus" value={name}
                  onChange={e => setName(e.target.value)} autoFocus />
              </Field>
              <Field label="Project manager">
                <select style={inputStyle} value={pm} onChange={e => setPm(e.target.value)}>
                  <option value="">Unassigned</option>
                  <option>Alice</option><option>Bob</option>
                </select>
                <p style={hintStyle}>Assign now or later — used for delivery accountability.</p>
              </Field>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Field label="Start date">
                  <input style={inputStyle} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
                </Field>
                <Field label="Finish date">
                  <input style={inputStyle} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
                </Field>
              </div>
            </>
          ) : (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:8, padding:"10px 14px", background:"#ecfeff", borderRadius:10, border:"1px solid #a5f3fc" }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none">
                  <rect x="3" y="3" width="18" height="18" rx="2" stroke="#06b6d4" strokeWidth="2"/>
                  <path d="M3 9h18M9 9v12M15 9v12" stroke="#06b6d4" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                <span style={{ fontSize:11, fontWeight:700, letterSpacing:".07em", color:"#06b6d4", textTransform:"uppercase" }}>Resource heatmap settings</span>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <Field label="Project code">
                  <input style={inputStyle} placeholder="e.g. ATL-01" value={code} onChange={e => setCode(e.target.value)} />
                  <p style={hintStyle}><span style={{ color:"#06b6d4", fontWeight:600 }}>✦ Auto-generated</span> from name — edit to override.</p>
                </Field>
                <Field label="Department">
                  <input style={inputStyle} placeholder="e.g. Engineering" value={dept} onChange={e => setDept(e.target.value)} />
                  <p style={hintStyle}>Used in heatmap filter bar.</p>
                </Field>
              </div>
              <Field label="Resource status">
                <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
                  {["Confirmed","Pipeline"].map(s => (
                    <button key={s} onClick={() => setResStatus(s)}
                      style={{ border:"1px solid", borderRadius:10, padding:"10px 14px", fontSize:13, cursor:"pointer",
                        display:"flex", alignItems:"center", justifyContent:"center", gap:6, transition:"all .15s",
                        background:  resStatus===s ? (s==="Confirmed"?"#06b6d4":"#f1f5f9") : "white",
                        color:       resStatus===s ? (s==="Confirmed"?"white":"#0f172a") : "#64748b",
                        borderColor: resStatus===s ? (s==="Confirmed"?"#06b6d4":"#cbd5e1") : "#e2e8f0",
                        fontWeight:  resStatus===s ? 700 : 500 }}>
                      {s==="Confirmed"
                        ? <><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><polyline points="20 6 9 17 4 12" stroke={resStatus==="Confirmed"?"white":"#64748b"} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/></svg>Confirmed</>
                        : <><svg width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="9" stroke="#64748b" strokeWidth="2"/></svg>Pipeline</>}
                    </button>
                  ))}
                </div>
                <p style={hintStyle}>{resStatus==="Confirmed" ? "Confirmed projects affect the live capacity heatmap immediately." : "Pipeline projects appear as demand forecasts on the heatmap."}</p>
              </Field>
              <Field label="Project colour">
                <div style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap" }}>
                  {COLOURS.map(c => (
                    <button key={c} onClick={() => setColour(c)} style={{
                      width:30, height:30, borderRadius:"50%", background:c, border:"none", cursor:"pointer",
                      outline:colour===c?`3px solid ${c}`:"none", outlineOffset:2,
                      transform:colour===c?"scale(1.15)":"scale(1)", transition:"transform .15s" }} />
                  ))}
                  <span style={{ fontSize:11, fontWeight:700, background:"#f1f5f9", color:"#64748b", borderRadius:6, padding:"2px 7px", border:"1px solid #e2e8f0", marginLeft:4 }}>{code||"PRJ-01"}</span>
                </div>
                <p style={hintStyle}>Identifies this project in heatmap swimlane rows.</p>
              </Field>
            </>
          )}
        </div>

        {/* Footer */}
        <div style={{ padding:"16px 28px", borderTop:"1px solid #f1f5f9", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          {step === 1 ? (
            <>
              <button onClick={onClose} style={{ background:"none", border:"1px solid #e2e8f0", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer", color:"#64748b" }}>
                Cancel
              </button>
              <button onClick={() => name.trim() && setStep(2)}
                style={{ background:"#06b6d4", color:"white", border:"none", borderRadius:10, padding:"9px 18px", fontSize:13, fontWeight:700, cursor:"pointer", opacity:name.trim()?1:.45 }}>
                Next: Heatmap settings →
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep(1)} style={{ background:"none", border:"1px solid #e2e8f0", borderRadius:10, padding:"9px 16px", fontSize:13, fontWeight:600, cursor:"pointer", color:"#64748b" }}>
                ← Back
              </button>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <span style={{ fontSize:11, color:"#94a3b8" }}>Add role requirements after creation.</span>
                <button onClick={() => {
                  if (!name.trim()) return;
                  onCreate({ id:Date.now().toString(), name:name.trim(), code:code||"PRJ", status:"Active", pm:pm||null,
                    createdAt:new Date().toLocaleDateString("en-GB"), startDate:startDate||null, endDate:endDate||null, colour });
                }} style={{ background:"#06b6d4", color:"white", border:"none", borderRadius:10, padding:"9px 18px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
                  + Create project
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}