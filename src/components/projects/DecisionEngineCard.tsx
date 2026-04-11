"use client";
// src/components/projects/DecisionEngineCard.tsx
// Decision Engine + Truth Layer — Phase 1 Power Features
import React, { useCallback, useEffect, useState } from "react";
import {
  Zap, ShieldAlert, TrendingDown, TrendingUp, AlertTriangle,
  CheckCircle, RefreshCw, ChevronDown, ChevronUp, Target,
  Eye, ArrowRight, Clock
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────
type TruthStatus = "green" | "amber" | "red" | "unknown";
type Priority    = "critical" | "high" | "medium";
type Effort      = "immediate" | "short_term" | "medium_term";

type DecisionAction = {
  id: string; priority: Priority; action: string; rationale: string;
  ownerHint: string; pillar: string; currentScore: number; resolvedScore: number;
  scoreImprovement: number; riskReductionPct: number; effort: Effort;
  evidenceRefs: string[]; consequence: string;
};

type WhatIfScenario = {
  label: string; description: string; projectedScore: number;
  projectedBand: string; keyAssumptions: string[];
};

type TruthSignal = {
  id: string; label: string; declared: string; evidence: string;
  severity: "low" | "medium" | "high"; direction: "worse_than_declared" | "better_than_declared" | "consistent";
};

type TruthLayer = {
  declaredStatus: TruthStatus; evidenceStatus: TruthStatus;
  confidenceInReporting: number; confidenceBand: "high" | "medium" | "low";
  isFalseGreen: boolean; isFalseAmber: boolean;
  gap: "none" | "minor" | "material" | "critical";
  signals: TruthSignal[]; narrative: string;
  reportingRisk: "low" | "medium" | "high" | "critical";
};

type EngineData = {
  ok: boolean; projectId: string;
  decisions: { currentFailureRisk: number; decisions: DecisionAction[]; worstCase: WhatIfScenario; bestCase: WhatIfScenario };
  truthLayer: TruthLayer;
  fromSnapshot: boolean; snapshotAge: number | null;
};

// ── Palette ────────────────────────────────────────────────────────────────
const C = {
  navy:      "#1B3652", navyLt: "#EBF0F5",
  red:       "#B83A2E", redLt:  "#FDF2F1",
  green:     "#2A6E47", greenLt:"#F0F7F3",
  amber:     "#8A5B1A", amberLt:"#FDF6EC",
  violet:    "#0e7490", violetLt:"#ecfeff",
  text:      "#0D0D0B", textMd: "#4A4A46", textSm: "#8A8A84",
  border:    "#E3E3DF", borderMd:"#C8C8C4",
  surface:   "#FFFFFF", bg:      "#F7F7F5",
  mono:      "'DM Mono','Courier New',monospace",
  sans:      "'DM Sans',system-ui,sans-serif",
};

const PRIORITY_CFG: Record<Priority, { bg: string; color: string; border: string; label: string }> = {
  critical: { bg: C.redLt,   color: C.red,   border: "#F0B0AA", label: "Critical" },
  high:      { bg: C.amberLt, color: C.amber, border: "#E0C080", label: "High" },
  medium:   { bg: C.navyLt,  color: C.navy,  border: "#A0BAD0", label: "Medium" },
};

const EFFORT_CFG: Record<Effort, { label: string; color: string }> = {
  immediate:   { label: "Now",         color: C.red    },
  short_term:  { label: "This week",  color: C.amber },
  medium_term: { label: "This month", color: C.navy   },
};

const STATUS_CFG: Record<TruthStatus, { label: string; bg: string; color: string; border: string; dot: string }> = {
  green:   { label: "Green",   bg: C.greenLt, color: C.green, border: "#A0D0B8", dot: "#22c55e" },
  amber:   { label: "Amber",   bg: C.amberLt, color: C.amber, border: "#E0C080", dot: "#f59e0b" },
  red:     { label: "Red",     bg: C.redLt,   color: C.red,   border: "#F0B0AA", dot: "#ef4444" },
  unknown: { label: "Unknown", bg: C.bg,       color: C.textSm, border: C.border, dot: "#94a3b8" },
};

// ── Helpers ────────────────────────────────────────────────────────────────
function StatusPill({ status }: { status: TruthStatus }) {
  const cfg = STATUS_CFG[status];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: cfg.dot }} />
      {cfg.label}
    </span>
  );
}

function ImpactBar({ current, resolved, max = 100 }: { current: number; resolved: number; max?: number }) {
  const improvement = current - resolved;
  return (
    <div style={{ position: "relative", height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
      <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${(current / max) * 100}%`, background: "#e2e8f0", borderRadius: 3 }} />
      <div style={{ position: "absolute", left: `${(resolved / max) * 100}%`, top: 0, height: "100%", width: `${(improvement / max) * 100}%`, background: C.green, borderRadius: 3, transition: "width 0.6s ease" }} />
    </div>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────
export default function DecisionEngineCard({ projectId }: { projectId: string }) {
  const [data,       setData]       = useState<EngineData | null>(null);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [activeTab,  setActiveTab]  = useState<"decisions" | "truth">("decisions");
  const [expanded,   setExpanded]   = useState<string | null>(null);
  const [showWhatIf, setShowWhatIf] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/ai/premortem/decisions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId }),
      });
      const json = await res.json();
      if (json.ok) setData(json);
      else setError(json.error ?? "Failed to load");
    } catch (e: any) { setError(String(e?.message ?? "Failed")); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div style={{ padding: 24, display: "flex", alignItems: "center", gap: 10, color: C.textSm, fontFamily: C.sans, fontSize: 13 }}>
      <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} />
      Loading Decision Engine…
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );

  if (error) return (
    <div style={{ padding: 16, background: C.redLt, border: `1px solid #F0B0AA`, color: C.red, fontSize: 12, fontFamily: C.sans, borderRadius: 12 }}>
      {error} — <button onClick={load} style={{ background: "none", border: "none", cursor: "pointer", color: C.red, fontSize: 12, textDecoration: "underline" }}>Retry</button>
    </div>
  );

  if (!data) return null;

  const { decisions: eng, truthLayer: truth } = data;
  const topDecisions = eng.decisions.slice(0, 4);
  const totalImpact  = topDecisions.reduce((s, d) => s + d.scoreImprovement, 0);

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 16, background: C.surface, overflow: "hidden", fontFamily: C.sans }}>

      {/* ── False-Green Warning Banner ──────────────────────────────────── */}
      {truth.isFalseGreen && truth.gap !== "none" && (
        <div style={{ background: truth.gap === "critical" ? C.redLt : C.amberLt, borderBottom: `1px solid ${truth.gap === "critical" ? "#F0B0AA" : "#E0C080"}`, padding: "10px 20px", display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} color={truth.gap === "critical" ? C.red : C.amber} />
          <span style={{ fontSize: 12, fontWeight: 700, color: truth.gap === "critical" ? C.red : C.amber }}>
            Truth Layer: {truth.gap === "critical" ? "Critical" : "Material"} gap between declared status and delivery evidence
          </span>
        </div>
      )}

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div style={{ padding: "20px 24px 0" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#1B3652,#0e7490)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <Target size={18} color="white" />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: C.navy, marginBottom: 2 }}>Aliena</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>Decision Engine</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {data.fromSnapshot && data.snapshotAge !== null && (
              <span style={{ fontSize: 10, color: C.textSm, display: "flex", alignItems: "center", gap: 4 }}>
                <Clock size={10} /> {data.snapshotAge}m ago
              </span>
            )}
            <button onClick={load} style={{ display: "flex", alignItems: "center", gap: 5, padding: "5px 12px", border: `1px solid ${C.navy}`, background: C.navy, color: "#fff", borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: "pointer" }}>
              <RefreshCw size={10} /> Refresh
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: "flex", gap: 0, borderBottom: `2px solid ${C.border}`, marginTop: 20 }}>
          {([
            { id: "decisions" as const, label: "Decision Engine", icon: <Zap size={12} /> },
            { id: "truth"     as const, label: "Truth Layer",     icon: <Eye size={12} /> },
          ]).map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", fontFamily: C.sans, fontSize: 12, fontWeight: activeTab === tab.id ? 700 : 500, cursor: "pointer", background: "none", border: "none", borderBottom: `2px solid ${activeTab === tab.id ? C.navy : "transparent"}`, color: activeTab === tab.id ? C.navy : C.textMd, marginBottom: -2 }}>
              {tab.icon} {tab.label}
              {tab.id === "truth" && truth.isFalseGreen && (
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: truth.gap === "critical" ? C.red : C.amber }} />
              )}
            </button>
          ))}
        </div>
      </div>

      {/* ── Decision Engine Tab ─────────────────────────────────────────── */}
      {activeTab === "decisions" && (
        <div style={{ padding: "20px 24px" }}>

          {/* Summary bar */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 20 }}>
            {[
              { label: "Current Risk",      value: `${eng.currentFailureRisk}/100`,  color: eng.currentFailureRisk >= 50 ? C.red : eng.currentFailureRisk >= 25 ? C.amber : C.green, bg: eng.currentFailureRisk >= 50 ? C.redLt : eng.currentFailureRisk >= 25 ? C.amberLt : C.greenLt },
              { label: "If Actions Taken",  value: `${eng.bestCase.projectedScore}/100`, color: C.green, bg: C.greenLt },
              { label: "If Nothing Done",   value: `${eng.worstCase.projectedScore}/100`, color: C.red, bg: C.redLt },
            ].map(card => (
              <div key={card.label} style={{ border: `1px solid ${C.border}`, padding: "12px 16px", background: card.bg }}>
                <div style={{ fontSize: 9, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textSm, marginBottom: 4 }}>{card.label}</div>
                <div style={{ fontSize: 20, fontWeight: 800, fontFamily: C.mono, color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          {/* Decisions list */}
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textSm, marginBottom: 12 }}>
            What decisions change this outcome?
          </div>

          {topDecisions.length === 0 ? (
            <div style={{ padding: "20px", textAlign: "center", color: C.textSm, fontSize: 13 }}>
              No high-impact decisions identified. Risk signals are low.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {topDecisions.map((d, i) => {
                const pcfg    = PRIORITY_CFG[d.priority];
                const ecfg    = EFFORT_CFG[d.effort];
                const isOpen  = expanded === d.id;

                return (
                  <div key={d.id} style={{ border: `1px solid ${i === 0 ? pcfg.border : C.border}`, borderRadius: 10, overflow: "hidden", background: i === 0 ? pcfg.bg : C.surface }}>
                    <button onClick={() => setExpanded(isOpen ? null : d.id)} style={{ width: "100%", padding: "12px 16px", display: "flex", alignItems: "flex-start", gap: 12, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>

                      {/* Priority badge */}
                      <span style={{ flexShrink: 0, marginTop: 1, display: "inline-block", padding: "2px 8px", fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", background: pcfg.bg, border: `1px solid ${pcfg.border}`, color: pcfg.color, borderRadius: 20 }}>
                        {pcfg.label}
                      </span>

                      {/* Action */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: C.text, lineHeight: 1.4 }}>{d.action}</div>
                        <div style={{ fontSize: 11, color: C.textMd, marginTop: 4 }}>{d.rationale}</div>
                      </div>

                      {/* Impact */}
                      <div style={{ flexShrink: 0, textAlign: "right" }}>
                        <div style={{ fontFamily: C.mono, fontSize: 13, fontWeight: 800, color: C.green }}>-{d.riskReductionPct}%</div>
                        <div style={{ fontSize: 9, color: C.textSm, fontFamily: C.mono }}>risk reduction</div>
                      </div>

                      {isOpen ? <ChevronUp size={14} color={C.textSm} style={{ flexShrink: 0, marginTop: 2 }} /> : <ChevronDown size={14} color={C.textSm} style={{ flexShrink: 0, marginTop: 2 }} />}
                    </button>

                    {/* Expanded detail */}
                    {isOpen && (
                      <div style={{ padding: "0 16px 16px", borderTop: `1px solid ${C.border}`, background: C.surface }}>
                        {/* Impact bar */}
                        <div style={{ marginTop: 12, marginBottom: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, fontFamily: C.mono, color: C.textSm, marginBottom: 4 }}>
                            <span>Pillar: {d.pillar}</span>
                            <span>{d.resolvedScore} → {d.currentScore} (current)</span>
                          </div>
                          <ImpactBar current={d.currentScore} resolved={d.resolvedScore} />
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginTop: 12 }}>
                          <div style={{ padding: "10px 12px", background: C.greenLt, border: "1px solid #A0D0B8", borderRadius: 8 }}>
                            <div style={{ fontSize: 9, fontFamily: C.mono, fontWeight: 700, color: C.green, marginBottom: 4 }}>IF RESOLVED</div>
                            <div style={{ fontSize: 11, color: C.green }}>Risk score improves by <strong>{d.scoreImprovement} points</strong></div>
                          </div>
                          <div style={{ padding: "10px 12px", background: C.redLt, border: "1px solid #F0B0AA", borderRadius: 8 }}>
                            <div style={{ fontSize: 9, fontFamily: C.mono, fontWeight: 700, color: C.red, marginBottom: 4 }}>IF IGNORED</div>
                            <div style={{ fontSize: 11, color: C.red }}>{d.consequence}</div>
                          </div>
                        </div>

                        <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, color: C.textSm }}>Owner: <strong style={{ color: C.text }}>{d.ownerHint}</strong></span>
                          <span style={{ fontSize: 10, color: ecfg.color, fontFamily: C.mono, fontWeight: 700 }}>⏱ {ecfg.label}</span>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* What-if scenarios */}
          {totalImpact > 0 && (
            <div style={{ marginTop: 16 }}>
              <button onClick={() => setShowWhatIf(v => !v)} style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.navy, fontWeight: 600, fontFamily: C.sans }}>
                {showWhatIf ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                What happens if we do nothing?
              </button>

              {showWhatIf && (
                <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {[eng.worstCase, eng.bestCase].map(scenario => {
                    const isWorst = scenario === eng.worstCase;
                    return (
                      <div key={scenario.label} style={{ border: `1px solid ${isWorst ? "#F0B0AA" : "#A0D0B8"}`, borderRadius: 10, padding: "14px 16px", background: isWorst ? C.redLt : C.greenLt }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                          {isWorst ? <TrendingUp size={14} color={C.red} /> : <TrendingDown size={14} color={C.green} />}
                          <span style={{ fontSize: 12, fontWeight: 700, color: isWorst ? C.red : C.green }}>{scenario.label}</span>
                        </div>
                        <div style={{ fontFamily: C.mono, fontSize: 22, fontWeight: 800, color: isWorst ? C.red : C.green, marginBottom: 6 }}>
                          {scenario.projectedScore}/100
                        </div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: isWorst ? C.red : C.green, marginBottom: 8 }}>{scenario.projectedBand}</div>
                        <ul style={{ margin: 0, paddingLeft: 14, display: "flex", flexDirection: "column", gap: 3 }}>
                          {scenario.keyAssumptions.map((a, i) => (
                            <li key={i} style={{ fontSize: 11, color: isWorst ? C.red : C.green }}>{a}</li>
                          ))}
                        </ul>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Truth Layer Tab ─────────────────────────────────────────────── */}
      {activeTab === "truth" && (
        <div style={{ padding: "20px 24px" }}>

          {/* Status comparison */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 16, alignItems: "center", marginBottom: 20 }}>
            <div style={{ border: `1px solid ${C.border}`, padding: "14px 16px", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 9, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textSm, marginBottom: 8 }}>Declared status</div>
              <StatusPill status={truth.declaredStatus} />
              <div style={{ fontSize: 10, color: C.textSm, marginTop: 6 }}>What the team reports</div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <ArrowRight size={18} color={truth.gap !== "none" ? C.red : C.green} />
              <span style={{ fontSize: 9, fontFamily: C.mono, fontWeight: 700, color: truth.gap !== "none" ? C.red : C.green, textAlign: "center", textTransform: "uppercase" }}>
                {truth.gap === "none" ? "match" : truth.gap + " gap"}
              </span>
            </div>

            <div style={{ border: `1px solid ${truth.isFalseGreen ? "#F0B0AA" : C.border}`, padding: "14px 16px", borderRadius: 10, textAlign: "center", background: truth.isFalseGreen ? C.redLt : C.surface }}>
              <div style={{ fontSize: 9, fontFamily: C.mono, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textSm, marginBottom: 8 }}>Evidence-based status</div>
              <StatusPill status={truth.evidenceStatus} />
              <div style={{ fontSize: 10, color: C.textSm, marginTop: 6 }}>What the signals suggest</div>
            </div>
          </div>

          {/* Confidence in reporting */}
          <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Confidence in reporting accuracy</span>
              <span style={{ fontFamily: C.mono, fontSize: 18, fontWeight: 800, color: truth.confidenceInReporting >= 70 ? C.green : truth.confidenceInReporting >= 40 ? C.amber : C.red }}>
                {truth.confidenceInReporting}%
              </span>
            </div>
            <div style={{ height: 6, background: C.border, borderRadius: 3, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${truth.confidenceInReporting}%`, background: truth.confidenceInReporting >= 70 ? C.green : truth.confidenceInReporting >= 40 ? "#f59e0b" : C.red, borderRadius: 3, transition: "width 0.6s ease" }} />
            </div>
            <div style={{ fontSize: 11, color: C.textMd, marginTop: 8 }}>{truth.narrative}</div>
          </div>

          {/* Signal breakdown */}
          {truth.signals.length > 0 && (
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textSm, marginBottom: 10 }}>
                Signal breakdown
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {truth.signals.map(sig => {
                  const isWorse   = sig.direction === "worse_than_declared";
                  const isBetter  = sig.direction === "better_than_declared";
                  const borderCol = isWorse ? (sig.severity === "high" ? "#F0B0AA" : "#E0C080") : isBetter ? "#A0D0B8" : C.border;
                  const bgCol     = isWorse ? (sig.severity === "high" ? C.redLt : C.amberLt) : isBetter ? C.greenLt : C.bg;
                  const textCol   = isWorse ? (sig.severity === "high" ? C.red : C.amber) : isBetter ? C.green : C.textMd;

                  return (
                    <div key={sig.id} style={{ border: `1px solid ${borderCol}`, borderRadius: 8, padding: "10px 12px", background: bgCol }}>
                      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: C.text, marginBottom: 2 }}>{sig.label}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 10, color: C.textSm }}>Declared: <em>{sig.declared}</em></span>
                            <span style={{ fontSize: 10, color: C.textSm }}>→</span>
                            <span style={{ fontSize: 10, fontWeight: 600, color: textCol }}>Evidence: {sig.evidence}</span>
                          </div>
                        </div>
                        <span style={{ flexShrink: 0, fontSize: 9, fontFamily: C.mono, fontWeight: 700, padding: "2px 8px", borderRadius: 20, background: isWorse ? (sig.severity === "high" ? "#F0B0AA" : "#E0C080") : "#A0D0B8", color: textCol }}>
                          {isWorse ? (isBetter ? "better" : "worse") : ""}
                          {sig.direction === "consistent" ? "consistent" : ""}
                          {isBetter ? "better" : ""}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {truth.signals.length === 0 && (
            <div style={{ padding: "20px", textAlign: "center", color: C.green, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
              <CheckCircle size={16} /> Declared status is consistent with delivery evidence.
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: "10px 24px", borderTop: `1px solid ${C.border}`, background: C.bg, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span style={{ fontSize: 10, color: C.textSm, fontFamily: C.mono }}>Decision Engine + Truth Layer · deterministic scoring</span>
        {data.fromSnapshot && <span style={{ fontSize: 10, color: C.textSm, fontFamily: C.mono }}>Based on Pre-Mortem snapshot</span>}
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}