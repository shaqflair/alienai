"use client";
// src/components/projects/ProjectPremortemCard.tsx
// Pre-Mortem AI widget for the project page

import React, { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, ShieldAlert, TrendingUp, TrendingDown, Minus,
  RefreshCw, ChevronDown, ChevronUp, Zap, Brain, Clock
} from "lucide-react";

type RiskBand = "Low" | "Moderate" | "High" | "Critical";
type Direction = "improving" | "stable" | "worsening";
type Priority  = "now" | "next" | "monitor";

type PremortemData = {
  ok: boolean;
  projectId: string;
  generatedAt: string;
  headline: {
    failureRiskScore: number;
    failureRiskBand:  RiskBand;
    confidence:       number;
    direction:        Direction;
    hiddenRisk:       boolean;
    summary:          string;
  };
  pillars: { schedule: number; governance: number; budget: number; stability: number };
  topDrivers: Array<{
    key: string; label: string; pillar: string;
    severity: "low" | "medium" | "high"; score: number; reason: string;
  }>;
  recommendedActions: Array<{
    priority: Priority; action: string; ownerHint?: string; rationale: string;
  }>;
  narrative: { executive: string; delivery: string };
  evidence: Array<{ ref: string; type: string; label: string; meta?: any }>;
  trend: { previousScore: number | null; delta: number | null; previousGeneratedAt: string | null };
};

const BAND_CONFIG: Record<RiskBand, {
  bg: string; border: string; color: string; pillBg: string; pillColor: string; pillBorder: string; dot: string;
}> = {
  Low:      { bg: "#f0fdf4", border: "#bbf7d0", color: "#15803d", pillBg: "#dcfce7", pillColor: "#15803d", pillBorder: "#86efac", dot: "#22c55e" },
  Moderate: { bg: "#fffbeb", border: "#fde68a", color: "#92400e", pillBg: "#fef3c7", pillColor: "#92400e", pillBorder: "#fcd34d", dot: "#f59e0b" },
  High:     { bg: "#fff7ed", border: "#fed7aa", color: "#c2410c", pillBg: "#ffedd5", pillColor: "#c2410c", pillBorder: "#fb923c", dot: "#f97316" },
  Critical: { bg: "#fff1f2", border: "#fecdd3", color: "#9f1239", pillBg: "#ffe4e6", pillColor: "#9f1239", pillBorder: "#fda4af", dot: "#f43f5e" },
};

const PRIORITY_CONFIG: Record<Priority, { label: string; bg: string; color: string; border: string }> = {
  now:     { label: "Now",     bg: "#fff1f2", color: "#9f1239", border: "#fecdd3" },
  next:    { label: "Next",    bg: "#fffbeb", color: "#92400e", border: "#fde68a" },
  monitor: { label: "Monitor", bg: "#f0f9ff", color: "#0369a1", border: "#bae6fd" },
};

function ScoreArc({ score, band }: { score: number; band: RiskBand }) {
  const cfg = BAND_CONFIG[band];
  const r = 36;
  const circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ * 0.75; 
  const offset = circ * 0.125; 

  return (
    <div style={{ position: "relative", width: 96, height: 96, flexShrink: 0 }}>
      <svg width={96} height={96} viewBox="0 0 96 96" style={{ transform: "rotate(-135deg)" }}>
        <circle cx={48} cy={48} r={r} fill="none" stroke="#f1f5f9" strokeWidth={8} strokeDasharray={circ} strokeDashoffset={-circ * 0.125} strokeLinecap="round" />
        <circle cx={48} cy={48} r={r} fill="none" stroke={cfg.dot} strokeWidth={8}
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeDashoffset={-offset}
          strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.8s ease" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: 22, fontWeight: 800, color: cfg.color, lineHeight: 1 }}>{score}</div>
        <div style={{ fontSize: 9, fontWeight: 700, color: cfg.color, opacity: 0.7 }}>/ 100</div>
      </div>
    </div>
  );
}

function DirectionChip({ direction }: { direction: Direction }) {
  const cfg = {
    improving: { icon: <TrendingDown size={10} />, label: "Improving", color: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
    stable:    { icon: <Minus size={10} />,        label: "Stable",    color: "#0369a1", bg: "#f0f9ff", border: "#bae6fd" },
    worsening: { icon: <TrendingUp size={10} />,   label: "Worsening", color: "#9f1239", bg: "#fff1f2", border: "#fecdd3" },
  }[direction];

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, background: cfg.bg, border: `1px solid ${cfg.border}`, color: cfg.color }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

function PillarBar({ label, score }: { label: string; score: number }) {
  const color = score >= 60 ? "#f43f5e" : score >= 35 ? "#f59e0b" : "#22c55e";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", fontWeight: 600 }}>
        <span>{label}</span>
        <span style={{ fontFamily: "'DM Mono', monospace", color }}>{score}</span>
      </div>
      <div style={{ height: 5, borderRadius: 3, background: "#f1f5f9", overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 3, transition: "width 0.6s ease" }} />
      </div>
    </div>
  );
}

export default function ProjectPremortemCard({
  projectId,
  autoLoad = true,
}: {
  projectId: string;
  autoLoad?: boolean;
}) {
  const [data,       setData]      = useState<PremortemData | null>(null);
  const [loading,    setLoading]   = useState(false);
  const [computing, setComputing] = useState(false);
  const [error,      setError]     = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res  = await fetch(`/api/ai/premortem/compute?projectId=${encodeURIComponent(projectId)}`, { cache: "no-store" });
      const json = await res.json();
      if (json.ok && json.hasData && json.snapshot) {
        const s = json.snapshot;
        setData({
          ok: true,
          projectId,
          generatedAt: s.generated_at,
          headline: {
            failureRiskScore: s.failure_risk_score,
            failureRiskBand:  s.failure_risk_band,
            confidence:       s.confidence_score,
            direction:        s.direction ?? "stable",
            hiddenRisk:       s.hidden_risk,
            summary:          s.narrative?.executive ?? "",
          },
          pillars: {
            schedule:   s.schedule_score,
            governance: s.governance_score,
            budget:     s.budget_score,
            stability:  s.stability_score,
          },
          topDrivers:         s.top_drivers ?? [],
          recommendedActions: s.recommended_actions ?? [],
          narrative:          s.narrative ?? { executive: "", delivery: "" },
          evidence:           s.evidence ?? [],
          trend: {
            previousScore:       json.trend?.previousScore ?? null,
            delta:               json.trend?.previousScore != null ? s.failure_risk_score - json.trend.previousScore : null,
            previousGeneratedAt: json.trend?.previousGeneratedAt ?? null,
          },
        });
      } else {
        setData(null);
      }
    } catch (e: any) {
      setError(String(e?.message || "Failed to load"));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  const compute = useCallback(async () => {
    setComputing(true);
    setError(null);
    try {
      const res  = await fetch("/api/ai/premortem/compute", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, persist: true }),
      });
      const json = await res.json();
      if (json.ok) {
        loadLatest();
      } else {
        setError(json.error || "Compute failed");
      }
    } catch (e: any) {
      setError(String(e?.message || "Compute failed"));
    } finally {
      setComputing(false);
    }
  }, [projectId, loadLatest]);

  useEffect(() => {
    if (autoLoad) loadLatest();
  }, [autoLoad, loadLatest]);

  const cfg = data ? BAND_CONFIG[data.headline.failureRiskBand] : BAND_CONFIG["Low"];

  if (!loading && !data && !error) {
    return (
      <div style={{ border: "1px solid #e2e8f0", borderRadius: 16, background: "#fff", padding: 24, fontFamily: "Inter, sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Brain size={18} color="white" />
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#6366f1", marginBottom: 2 }}>Pre-Mortem AI</div>
            <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Delivery Failure Risk</div>
          </div>
        </div>
        <p style={{ fontSize: 13, color: "#64748b", marginBottom: 16 }}>No analysis run yet. Run the first assessment for this project.</p>
        <button onClick={compute} disabled={computing} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 20px", borderRadius: 10, background: "#0f172a", color: "#fff", border: "none", fontSize: 13, fontWeight: 700, cursor: computing ? "not-allowed" : "pointer" }}>
          {computing ? <RefreshCw size={14} className="animate-spin" /> : <Zap size={14} />} {computing ? "Running..." : "Run Pre-Mortem"}
        </button>
      </div>
    );
  }

  if (loading) return <div style={{ padding: 24, fontSize: 13, color: "#94a3b8" }}>Loading Pre-Mortem AI...</div>;
  if (error) return <div style={{ padding: 24, fontSize: 12, color: "#9f1239" }}>{error}</div>;
  if (!data) return null;

  return (
    <div style={{ border: `1px solid ${cfg.border}`, borderRadius: 16, background: "#fff", overflow: "hidden", fontFamily: "Inter, sans-serif" }}>
      {data.headline.hiddenRisk && (
        <div style={{ background: "#fff7ed", borderBottom: "1px solid #fed7aa", padding: "10px 20px", display: "flex", alignItems: "center", gap: 8 }}>
          <AlertTriangle size={14} color="#c2410c" />
          <span style={{ fontSize: 12, fontWeight: 700, color: "#c2410c" }}>False Green Warning detected</span>
        </div>
      )}

      <div style={{ padding: "20px 24px", background: `linear-gradient(135deg, ${cfg.bg}, #ffffff)` }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#4f46e5)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Brain size={18} color="white" />
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", color: "#6366f1" }}>Pre-Mortem AI</div>
              <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>Failure Risk</div>
            </div>
          </div>
          <button onClick={compute} disabled={computing} style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", fontSize: 11 }}>
            <RefreshCw size={11} className={computing ? "animate-spin" : ""} /> {computing ? "Running..." : "Refresh"}
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 20, marginTop: 20 }}>
          <ScoreArc score={data.headline.failureRiskScore} band={data.headline.failureRiskBand} />
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ padding: "4px 12px", borderRadius: 20, fontSize: 12, fontWeight: 800, background: cfg.pillBg, color: cfg.pillColor, border: `1px solid ${cfg.pillBorder}` }}>{data.headline.failureRiskBand}</span>
              <DirectionChip direction={data.headline.direction} />
            </div>
            <p style={{ margin: 0, fontSize: 13, color: "#334155", lineHeight: 1.5 }}>{data.headline.summary}</p>
          </div>
        </div>
      </div>

      <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9", background: "#fafafa", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16 }}>
        <PillarBar label="Schedule" score={data.pillars.schedule} />
        <PillarBar label="Gov" score={data.pillars.governance} />
        <PillarBar label="Budget" score={data.pillars.budget} />
        <PillarBar label="Stability" score={data.pillars.stability} />
      </div>

      <div style={{ padding: "16px 24px", borderTop: "1px solid #f1f5f9" }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase" }}>Key Drivers</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {data.topDrivers.slice(0, 3).map(driver => (
            <div key={driver.key} style={{ padding: "10px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
               <div style={{ fontSize: 12, fontWeight: 700 }}>{driver.label}</div>
               <div style={{ fontSize: 11, color: "#475569" }}>{driver.reason}</div>
            </div>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 24px", borderTop: "1px solid #f1f5f9", display: "flex", justifyContent: "center" }}>
         <button onClick={() => setShowEvidence(!showEvidence)} style={{ background: "none", border: "none", color: "#6366f1", fontSize: 12, cursor: "pointer" }}>
            {showEvidence ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {showEvidence ? "Hide" : "View"} Evidence
         </button>
      </div>
      
      {showEvidence && (
        <div style={{ padding: "0 24px 16px", display: "flex", flexDirection: "column", gap: 6 }}>
           {data.evidence.map((ev, i) => (
             <div key={i} style={{ fontSize: 11, padding: "8px", background: "#f8fafc", borderRadius: 8, border: "1px solid #f1f5f9" }}>
               <strong>{ev.type}:</strong> {ev.label}
             </div>
           ))}
        </div>
      )}
    </div>
  );
}