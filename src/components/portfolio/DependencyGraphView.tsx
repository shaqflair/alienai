"use client";
// src/components/portfolio/DependencyGraphView.tsx
// Interactive dependency graph with impact chain visualization
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Plus, RefreshCw, AlertTriangle, ChevronRight, X, Link } from "lucide-react";
// Types inlined from computeDependencyGraph to avoid importing server-only module
type DependencyNode = { project_id: string; project_title: string; project_code: string | null; status: string; risk_score: number; risk_band: string; is_at_risk: boolean; is_delayed: boolean; delay_days: number; finish_date: string | null; };
type DependencyEdge = { id: string; from_project_id: string; to_project_id: string; from_label: string | null; to_label: string | null; dependency_type: string; strength: string; status: string; risk_propagation: boolean; impact_description: string | null; lag_days: number; };
type ImpactChain = { trigger_project_id: string; trigger_project: string; affected_projects: string[]; chain_description: string; max_delay_days: number; severity: "critical" | "high" | "medium" | "low"; };
type DependencyGraphResult = { nodes: DependencyNode[]; edges: DependencyEdge[]; impact_chains: ImpactChain[]; at_risk_count: number; critical_path: string[]; generated_at: string; };

const T = {
  bg:      "#f9f7f4", surface: "#ffffff", hr: "#e7e5e4",
  ink:      "#1c1917", ink2:   "#44403c", ink3: "#78716c", ink4: "#a8a29e", ink5: "#d6d3d1",
  red:      "#7f1d1d", redBg:  "#fef2f2", redBd: "#fca5a5",
  amber:    "#78350f", amberBg:"#fffbeb", amberBd:"#fcd34d",
  green:    "#14532d", greenBg:"#f0fdf4", greenBd:"#86efac",
  navy:     "#1B3652", navyLt: "#EBF0F5",
  mono:     "'IBM Plex Mono','Menlo',monospace",
  serif:    "'Playfair Display','Georgia',serif",
  body:     "'Source Serif 4','Georgia',serif",
};

type AddDepModal = {
  projects: DependencyNode[];
  onAdd: (from: string, to: string, type: string, description: string) => Promise<void>;
  onClose: () => void;
};

function AddDependencyModal({ projects, onAdd, onClose }: AddDepModal) {
  const [fromId,  setFromId]  = useState(projects[0]?.project_id ?? "");
  const [toId,    setToId]    = useState(projects[1]?.project_id ?? "");
  const [type,    setType]    = useState("finish_to_start");
  const [desc,    setDesc]    = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,    setError]   = useState<string | null>(null);

  async function handleAdd() {
    if (fromId === toId) { setError("Cannot create a self-dependency"); return; }
    setSaving(true); setError(null);
    try {
      await onAdd(fromId, toId, type, desc);
      onClose();
    } catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  const INP: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 10px", fontFamily: T.mono, fontSize: 12, color: T.ink, background: "#fff", border: `1px solid ${T.hr}`, borderRadius: 4, outline: "none" };
  const LBL: React.CSSProperties = { display: "block", marginBottom: 5, fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink4 };

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: T.surface, width: "100%", maxWidth: 480, borderRadius: 8, border: `1px solid ${T.hr}`, boxShadow: "0 24px 80px rgba(0,0,0,0.2)", overflow: "hidden" }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${T.hr}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: T.serif, fontSize: 18, fontWeight: 700, color: T.ink }}>Add Dependency</div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink4 }}><X size={16} /></button>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div><label style={LBL}>From project (depends on)</label>
            <select value={fromId} onChange={e => setFromId(e.target.value)} style={INP}>
              {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.project_title}</option>)}
            </select>
          </div>
          <div style={{ textAlign: "center", color: T.ink4 }}><ChevronRight size={16} /></div>
          <div><label style={LBL}>To project (must complete first)</label>
            <select value={toId} onChange={e => setToId(e.target.value)} style={INP}>
              {projects.map(p => <option key={p.project_id} value={p.project_id}>{p.project_title}</option>)}
            </select>
          </div>
          <div><label style={LBL}>Dependency type</label>
            <select value={type} onChange={e => setType(e.target.value)} style={INP}>
              <option value="finish_to_start">Finish to start</option>
              <option value="blocks">Blocks</option>
              <option value="integrates_with">Integrates with</option>
              <option value="start_to_start">Start to start</option>
            </select>
          </div>
          <div><label style={LBL}>Impact description (optional)</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Migration must complete first" style={INP} />
          </div>
          {error && <div style={{ fontSize: 12, color: T.red, padding: "8px 12px", background: T.redBg, border: `1px solid ${T.redBd}`, borderRadius: 4 }}>{error}</div>}
        </div>
        <div style={{ padding: "12px 22px 18px", borderTop: `1px solid ${T.hr}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "7px 18px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, background: "transparent", color: T.ink3, border: `1px solid ${T.hr}`, borderRadius: 4, cursor: "pointer" }}>Cancel</button>
          <button onClick={handleAdd} disabled={saving} style={{ padding: "7px 18px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, background: saving ? T.ink3 : T.ink, color: "#fff", border: "none", borderRadius: 4, cursor: saving ? "default" : "pointer" }}>{saving ? "Adding…" : "Add Dependency"}</button>
        </div>
      </div>
    </div>
  );
}

function NodeCard({ node, selected, onClick }: { node: DependencyNode; selected: boolean; onClick: () => void }) {
  const riskColor = node.risk_band === "Critical" ? T.red : node.risk_band === "High" ? T.amber : node.risk_band === "Moderate" ? "#1e40af" : T.green;
  const riskBg    = node.risk_band === "Critical" ? T.redBg : node.risk_band === "High" ? T.amberBg : node.risk_band === "Moderate" ? "#eff6ff" : T.greenBg;

  return (
    <div onClick={onClick} style={{ padding: "10px 14px", border: `2px solid ${selected ? T.navy : node.is_at_risk ? "#fca5a5" : T.hr}`, borderRadius: 8, background: node.is_at_risk ? T.redBg : T.surface, cursor: "pointer", transition: "all 0.15s", minWidth: 160 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: riskColor, flexShrink: 0 }} />
        <span style={{ fontFamily: T.body, fontSize: 12, fontWeight: 600, color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.project_title}</span>
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, padding: "1px 6px", background: riskBg, border: `1px solid ${riskColor}22`, color: riskColor, borderRadius: 3 }}>{node.risk_band}</span>
        {node.is_delayed && <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, padding: "1px 6px", background: T.redBg, border: `1px solid ${T.redBd}`, color: T.red, borderRadius: 3 }}>+{node.delay_days}d</span>}
      </div>
    </div>
  );
}

export default function DependencyGraphView() {
  const [data,        setData]        = useState<DependencyGraphResult | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [selected,    setSelected]    = useState<string | null>(null);
  const [showAdd,      setShowAdd]      = useState(false);
  const [activeTab,    setActiveTab]    = useState<"graph" | "chains" | "critical">("graph");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/ai/dependencies");
      const json = await res.json();
      if (json.ok) setData(json);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function handleAddDependency(from: string, to: string, type: string, description: string) {
    const res  = await fetch("/api/ai/dependencies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_project_id: from, to_project_id: to, dependency_type: type, impact_description: description }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    await load();
  }

  async function handleRemove(depId: string) {
    await fetch("/api/ai/dependencies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", dependencyId: depId }) });
    await load();
  }

  const selectedNode    = data?.nodes.find(n => n.project_id === selected);
  const selectedEdgesIn = data?.edges.filter(e => e.to_project_id === selected) ?? [];
  const selectedEdgesOut = data?.edges.filter(e => e.from_project_id === selected) ?? [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: T.body }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ fontFamily: T.serif, fontSize: 22, fontWeight: 700, color: T.ink }}>Dependency Graph</div>
          {data && <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, marginTop: 3 }}>{data.nodes.length} projects · {data.edges.length} dependencies</div>}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, background: "transparent", color: T.ink3, border: `1px solid ${T.hr}`, borderRadius: 4, cursor: "pointer" }}>
            <RefreshCw size={11} /> Refresh
          </button>
          <button onClick={() => setShowAdd(true)} style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 14px", fontFamily: T.mono, fontSize: 10, fontWeight: 600, background: T.ink, color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            <Plus size={11} /> Add dependency
          </button>
        </div>
      </div>

      <div style={{ display: "flex", borderBottom: `1px solid ${T.hr}`, gap: 0 }}>
        {([["graph", "Project Graph"], ["chains", "Impact Chains"], ["critical", "Critical Path"]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{ padding: "8px 18px", fontFamily: T.mono, fontSize: 10, fontWeight: activeTab === id ? 600 : 400, background: "none", border: "none", borderBottom: `2px solid ${activeTab === id ? T.ink : "transparent"}`, color: activeTab === id ? T.ink : T.ink4, cursor: "pointer", marginBottom: -1 }}>
            {label}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ padding: "60px", textAlign: "center", fontFamily: T.mono, fontSize: 11, color: T.ink5 }}>LOADING...</div>
      ) : activeTab === "graph" && data ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 280px", gap: 16 }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {data.nodes.map(node => (
              <NodeCard key={node.project_id} node={node} selected={selected === node.project_id} onClick={() => setSelected(selected === node.project_id ? null : node.project_id)} />
            ))}
          </div>
          <div>
            {selectedNode ? (
              <div style={{ border: `1px solid ${T.hr}`, borderRadius: 8, padding: "16px", background: T.surface }}>
                <div style={{ fontFamily: T.serif, fontSize: 15, fontWeight: 700, color: T.ink, marginBottom: 12 }}>{selectedNode.project_title}</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4 }}>Risk: {selectedNode.risk_band}</div>
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4 }}>Delay: {selectedNode.delay_days}d</div>
              </div>
            ) : (
              <div style={{ border: `1px dashed ${T.hr}`, borderRadius: 8, padding: "24px", textAlign: "center" }}>
                <Link size={20} color={T.ink5} style={{ margin: "0 auto 8px" }} />
                <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink5 }}>Click a project to view connections</div>
              </div>
            )}
          </div>
        </div>
      ) : activeTab === "chains" && data ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {data.impact_chains.map((chain, i) => (
            <div key={i} style={{ border: `1px solid ${T.redBd}`, borderLeft: `4px solid ${T.red}`, borderRadius: 8, padding: "16px 20px", background: T.redBg }}>
              <div style={{ fontFamily: T.mono, fontSize: 20, fontWeight: 700, color: T.red, marginBottom: 8 }}>+{chain.max_delay_days}d</div>
              <p style={{ fontFamily: T.body, fontSize: 13, color: T.ink2 }}>{chain.chain_description}</p>
            </div>
          ))}
        </div>
      ) : activeTab === "critical" && data ? (
        <div style={{ background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 8, padding: "24px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {data.critical_path.map((proj, i) => (
              <React.Fragment key={proj}>
                <div style={{ padding: "8px 16px", background: "#f5f3f0", borderRadius: 6, whiteSpace: "nowrap", fontSize: 13, fontWeight: 500 }}>{proj}</div>
                {i < data.critical_path.length - 1 && <ChevronRight size={14} />}
              </React.Fragment>
            ))}
          </div>
        </div>
      ) : null}

      {showAdd && data && (
        <AddDependencyModal projects={data.nodes} onAdd={handleAddDependency} onClose={() => setShowAdd(false)} />
      )}
    </div>
  );
}