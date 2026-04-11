"use client";
// src/components/projects/ProjectDependenciesTab.tsx
// Project-level dependency view: what this project needs + what needs this project
import React, { useCallback, useEffect, useState } from "react";
import { Plus, ChevronRight, X, AlertTriangle, CheckCircle, ArrowLeft, ArrowRight, Brain } from "lucide-react";

type DepNode = {
  project_id:    string;
  project_title: string;
  project_code:  string | null;
  status:        string;
  risk_score:    number;
  risk_band:     string;
  is_at_risk:    boolean;
  is_delayed:    boolean;
  delay_days:    number;
  finish_date:   string | null;
};

type DepEdge = {
  id:               string;
  from_project_id:  string;
  to_project_id:    string;
  from_label:       string | null;
  to_label:         string | null;
  dependency_type:  string;
  strength:         string;
  status:           string;
  risk_propagation: boolean;
  impact_description: string | null;
  lag_days:         number;
};

type GraphData = {
  ok:      boolean;
  nodes:   DepNode[];
  edges:   DepEdge[];
  impact_chains: any[];
  at_risk_count: number;
  critical_path: string[];
};

type OrgPattern = {
  id:             string;
  pattern_type:   string;
  title:          string;
  description:    string;
  avg_impact:     string;
  recommendation: string;
  confidence:     number;
  applicable_when: string;
};

const P = {
  navy:    "#1B3652", navyLt: "#EBF0F5",
  red:     "#B83A2E", redLt:  "#FDF2F1",
  amber:   "#8A5B1A", amberLt:"#FDF6EC",
  green:   "#2A6E47", greenLt:"#F0F7F3",
  text:    "#0D0D0B", textMd: "#4A4A46", textSm: "#8A8A84",
  border:  "#E3E3DF", borderMd:"#C8C8C4",
  surface: "#FFFFFF", bg:      "#F7F7F5",
  mono:    "'DM Mono','Courier New',monospace",
  sans:    "'DM Sans',system-ui,sans-serif",
};

function riskColor(band: string) {
  return band === "Critical" ? P.red : band === "High" ? P.amber : band === "Moderate" ? P.navy : P.green;
}
function riskBg(band: string) {
  return band === "Critical" ? P.redLt : band === "High" ? P.amberLt : band === "Moderate" ? P.navyLt : P.greenLt;
}

function ProjectChip({ node, direction, edge, onRemove, canEdit }: {
  node: DepNode; direction: "upstream" | "downstream"; edge: DepEdge; onRemove?: (id: string) => void; canEdit?: boolean;
}) {
  const color = riskColor(node.risk_band);
  const bg    = riskBg(node.risk_band);
  return (
    <div style={{ border: `1px solid ${P.border}`, borderRadius: 10, padding: "14px 16px", background: node.is_at_risk ? P.redLt : P.surface, display: "flex", alignItems: "flex-start", gap: 12 }}>
      {direction === "upstream"
        ? <ArrowLeft  size={16} color={P.textSm} style={{ flexShrink: 0, marginTop: 2 }} />
        : <ArrowRight size={16} color={P.textSm} style={{ flexShrink: 0, marginTop: 2 }} />}

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 4 }}>
          <a href={`/projects/${node.project_id}`} style={{ fontFamily: P.sans, fontSize: 14, fontWeight: 700, color: P.navy, textDecoration: "none" }}>{node.project_title}</a>
          {node.project_code && <span style={{ fontFamily: P.mono, fontSize: 9, color: P.textSm }}>{node.project_code}</span>}
          <span style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, padding: "1px 7px", background: bg, border: `1px solid ${color}33`, color, borderRadius: 20 }}>{node.risk_band}</span>
          {node.is_delayed && <span style={{ fontFamily: P.mono, fontSize: 9, fontWeight: 700, padding: "1px 7px", background: P.redLt, border: "1px solid #F0B0AA", color: P.red, borderRadius: 20 }}>+{node.delay_days}d delayed</span>}
        </div>
        <div style={{ fontSize: 12, color: P.textMd, marginBottom: 4 }}>
          {direction === "upstream"
            ? `This project depends on ${node.project_title} completing first`
            : `${node.project_title} is waiting on this project`}
        </div>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm }}>Type: {edge.dependency_type.replace(/_/g, " ")}</span>
          <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm }}>Strength: {edge.strength}</span>
          {edge.lag_days > 0 && <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm }}>Lag: {edge.lag_days}d</span>}
          {node.finish_date && <span style={{ fontFamily: P.mono, fontSize: 10, color: P.textSm }}>Ends: {new Date(node.finish_date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>}
        </div>
        {edge.impact_description && (
          <div style={{ marginTop: 6, fontSize: 12, color: P.textMd, fontStyle: "italic" }}>{edge.impact_description}</div>
        )}
        {node.is_at_risk && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8, padding: "6px 10px", background: P.redLt, border: "1px solid #F0B0AA", borderRadius: 6 }}>
            <AlertTriangle size={12} color={P.red} />
            <span style={{ fontFamily: P.mono, fontSize: 10, color: P.red, fontWeight: 700 }}>At risk — may impact your project delivery</span>
          </div>
        )}
      </div>

      {canEdit && onRemove && (
        <button onClick={() => onRemove(edge.id)} style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: P.textSm, padding: 2 }}>
          <X size={14} />
        </button>
      )}
    </div>
  );
}

function AddDepModal({ projectId, allProjects, currentProjectTitle, mode, onAdd, onClose }: {
  projectId: string; allProjects: DepNode[]; currentProjectTitle: string;
  mode: "upstream" | "downstream";
  onAdd: (otherId: string, type: string, desc: string) => Promise<void>;
  onClose: () => void;
}) {
  const others    = allProjects.filter(p => p.project_id !== projectId);
  const [otherId, setOtherId] = useState(others[0]?.project_id ?? "");
  const [type,    setType]    = useState("finish_to_start");
  const [desc,    setDesc]    = useState("");
  const [saving,  setSaving]  = useState(false);
  const [error,    setError]   = useState<string | null>(null);

  const INP: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "8px 10px", fontFamily: P.mono, fontSize: 12, color: P.text, background: "#fff", border: `1px solid ${P.border}`, borderRadius: 6, outline: "none" };
  const LBL: React.CSSProperties = { display: "block", marginBottom: 5, fontFamily: P.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: P.textSm };

  async function handle() {
    setSaving(true); setError(null);
    try { await onAdd(otherId, type, desc); onClose(); }
    catch (e: any) { setError(e?.message ?? "Failed"); }
    finally { setSaving(false); }
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: P.surface, width: "100%", maxWidth: 480, borderRadius: 12, border: `1px solid ${P.border}`, boxShadow: "0 24px 80px rgba(0,0,0,0.2)", overflow: "hidden", fontFamily: P.sans }}>
        <div style={{ padding: "18px 22px 14px", borderBottom: `1px solid ${P.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: P.text }}>
            {mode === "upstream" ? "Add upstream dependency" : "Add downstream dependency"}
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: P.textSm }}><X size={16} /></button>
        </div>
        <div style={{ padding: "18px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ padding: "10px 14px", background: P.bg, borderRadius: 8, fontSize: 12, color: P.textMd }}>
            {mode === "upstream"
              ? <><strong>{currentProjectTitle}</strong> depends on the project below completing first.</>
              : <>The project below depends on <strong>{currentProjectTitle}</strong> completing first.</>}
          </div>
          <div><label style={LBL}>Project</label>
            <select value={otherId} onChange={e => setOtherId(e.target.value)} style={INP}>
              {others.map(p => <option key={p.project_id} value={p.project_id}>{p.project_title}</option>)}
            </select>
          </div>
          <div><label style={LBL}>Dependency type</label>
            <select value={type} onChange={e => setType(e.target.value)} style={INP}>
              <option value="finish_to_start">Finish to start (most common)</option>
              <option value="blocks">Blocks</option>
              <option value="integrates_with">Integrates with</option>
              <option value="start_to_start">Start to start</option>
            </select>
          </div>
          <div><label style={LBL}>Impact description (optional)</label>
            <input value={desc} onChange={e => setDesc(e.target.value)} placeholder="e.g. Requires data migration" style={INP} /></div>
          {error && <div style={{ fontSize: 12, color: P.red, padding: "8px 12px", background: P.redLt, border: "1px solid #F0B0AA", borderRadius: 6 }}>{error}</div>}
        </div>
        <div style={{ padding: "12px 22px 18px", borderTop: `1px solid ${P.border}`, display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button onClick={onClose} style={{ padding: "7px 18px", fontFamily: P.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", background: "transparent", color: P.textSm, border: `1px solid ${P.border}`, borderRadius: 6, cursor: "pointer" }}>Cancel</button>
          <button onClick={handle} disabled={saving || !otherId} style={{ padding: "7px 18px", fontFamily: P.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", background: saving ? P.textSm : P.navy, color: "#fff", border: "none", borderRadius: 6, cursor: saving ? "default" : "pointer" }}>{saving ? "Adding…" : "Add"}</button>
        </div>
      </div>
    </div>
  );
}

export default function ProjectDependenciesTab({ projectId, projectTitle, canEdit = false }: { projectId: string; projectTitle: string; canEdit?: boolean }) {
  const [graph,    setGraph]    = useState<GraphData | null>(null);
  const [patterns, setPatterns] = useState<OrgPattern[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState<"upstream" | "downstream" | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [gRes, mRes] = await Promise.allSettled([
      fetch("/api/ai/dependencies").then(r => r.json()),
      fetch("/api/ai/org-memory").then(r => r.json()),
    ]);
    if (gRes.status === "fulfilled" && gRes.value?.ok) setGraph(gRes.value);
    if (mRes.status === "fulfilled" && mRes.value?.ok) setPatterns(mRes.value.patterns ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function addDep(otherId: string, type: string, desc: string, mode: "upstream" | "downstream") {
    const from = mode === "upstream"   ? projectId : otherId;
    const to   = mode === "upstream"   ? otherId   : projectId;
    const res  = await fetch("/api/ai/dependencies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ from_project_id: from, to_project_id: to, dependency_type: type, impact_description: desc }) });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    await load();
  }

  async function removeDep(depId: string) {
    await fetch("/api/ai/dependencies", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "delete", dependencyId: depId }) });
    await load();
  }

  const upstream    = (graph?.edges ?? []).filter(e => e.from_project_id === projectId);
  const downstream = (graph?.edges ?? []).filter(e => e.to_project_id   === projectId);

  const getNode = (id: string) => graph?.nodes.find(n => n.project_id === id);

  const relevantChains = (graph?.impact_chains ?? []).filter(c =>
    c.trigger_project_id === projectId || c.affected_projects?.includes(projectTitle)
  );

  const thisNode  = graph?.nodes.find(n => n.project_id === projectId);
  const relevantPatterns = patterns.filter(p => {
    if (!thisNode) return false;
    if (p.pattern_type === "approval_delay"  && thisNode.risk_band !== "Low") return true;
    if (p.pattern_type === "delivery_slip"   && thisNode.is_at_risk)          return true;
    if (p.pattern_type === "phase_risk"      && thisNode.risk_score >= 30)    return true;
    if (p.pattern_type === "budget_overrun") return true;
    return false;
  }).slice(0, 2);

  if (loading) return (
    <div style={{ padding: "60px", textAlign: "center", fontFamily: P.mono, fontSize: 11, color: P.textSm }}>Loading dependencies…</div>
  );

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "24px 0", display: "flex", flexDirection: "column", gap: 24, fontFamily: P.sans }}>

      {/* Upstream */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: P.text }}>Upstream dependencies</div>
            <div style={{ fontSize: 12, color: P.textSm, marginTop: 2 }}>Projects this project depends on</div>
          </div>
          {canEdit && (
            <button onClick={() => setModal("upstream")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontFamily: P.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: P.navy, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
              <Plus size={11} /> Add upstream
            </button>
          )}
        </div>

        {upstream.length === 0 ? (
          <div style={{ padding: "24px", border: `1px dashed ${P.border}`, borderRadius: 10, textAlign: "center" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, color: P.green, marginBottom: 6 }}>
              <CheckCircle size={16} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>No upstream dependencies</span>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {upstream.map(edge => {
              const node = getNode(edge.to_project_id);
              if (!node) return null;
              return <ProjectChip key={edge.id} node={node} direction="upstream" edge={edge} onRemove={canEdit ? removeDep : undefined} canEdit={canEdit} />;
            })}
          </div>
        )}
      </div>

      <div style={{ height: 1, background: P.border }} />

      {/* Downstream */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: P.text }}>Downstream dependants</div>
            <div style={{ fontSize: 12, color: P.textSm, marginTop: 2 }}>Projects waiting on this project</div>
          </div>
          {canEdit && (
            <button onClick={() => setModal("downstream")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", fontFamily: P.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", background: P.navy, color: "#fff", border: "none", borderRadius: 8, cursor: "pointer" }}>
              <Plus size={11} /> Add downstream
            </button>
          )}
        </div>

        {downstream.length === 0 ? (
          <div style={{ padding: "24px", border: `1px dashed ${P.border}`, borderRadius: 10, textAlign: "center" }}>
            <div style={{ fontSize: 13, color: P.textSm }}>No projects are waiting on this project</div>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {downstream.map(edge => {
              const node = getNode(edge.from_project_id);
              if (!node) return null;
              return <ProjectChip key={edge.id} node={node} direction="downstream" edge={edge} onRemove={canEdit ? removeDep : undefined} canEdit={canEdit} />;
            })}
          </div>
        )}
      </div>

      {/* Impact analysis */}
      {relevantChains.length > 0 && (
        <>
          <div style={{ height: 1, background: P.border }} />
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: P.text, marginBottom: 6 }}>Impact analysis</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {relevantChains.map((chain, i) => (
                <div key={i} style={{ padding: "14px 16px", border: `1px solid #F0B0AA`, borderLeft: `4px solid ${P.red}`, borderRadius: 10, background: P.redLt }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
                    <AlertTriangle size={13} color={P.red} />
                    <span style={{ fontFamily: P.mono, fontSize: 10, fontWeight: 700, color: P.red, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                      {chain.trigger_project_id === projectId ? "If this project delays" : "Upstream risk"}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: P.red, lineHeight: 1.6 }}>{chain.chain_description}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Org Memory */}
      {relevantPatterns.length > 0 && (
        <>
          <div style={{ height: 1, background: P.border }} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#1B3652,#0e7490)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Brain size={14} color="white" />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: P.text }}>Organisational Memory</div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {relevantPatterns.map((p, i) => (
                <div key={i} style={{ padding: "14px 16px", border: `1px solid ${P.border}`, borderRadius: 10, background: P.bg }}>
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 6 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: P.text }}>{p.title}</div>
                    <span style={{ flexShrink: 0, fontFamily: P.mono, fontSize: 11, fontWeight: 700, color: P.amber }}>{p.avg_impact}</span>
                  </div>
                  <div style={{ fontSize: 12, color: P.textMd, marginBottom: 8 }}>{p.description}</div>
                  <div style={{ padding: "8px 12px", background: P.greenLt, border: "1px solid #A0D0B8", borderRadius: 6 }}>
                    <div style={{ fontSize: 12, color: P.green, marginTop: 3 }}>{p.recommendation}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {modal && (
        <AddDepModal
          projectId={projectId}
          allProjects={graph?.nodes ?? []}
          currentProjectTitle={projectTitle}
          mode={modal}
          onAdd={(otherId, type, desc) => addDep(otherId, type, desc, modal)}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}