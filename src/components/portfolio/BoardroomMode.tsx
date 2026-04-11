"use client";
// src/components/portfolio/BoardroomMode.tsx
// One-click executive view: risks, decisions, exposure, confidence, narrative
import React, { useCallback, useEffect, useState } from "react";
import { Brain, TrendingUp, Target, Eye, AlertTriangle, RefreshCw, X } from "lucide-react";
import type { PortfolioIntelligencePayload } from "@/lib/server/portfolio/loadPortfolioIntelligence";

const T = {
  bg:      "#f9f7f4", surface: "#ffffff", hr: "#e7e5e4",
  ink:      "#1c1917", ink2:   "#44403c", ink3: "#78716c", ink4: "#a8a29e", ink5: "#d6d3d1",
  red:      "#7f1d1d", redBg:  "#fef2f2", redBd: "#fca5a5",
  amber:    "#78350f", amberBg:"#fffbeb", amberBd:"#fcd34d",
  green:    "#14532d", greenBg:"#f0fdf4", greenBd:"#86efac",
  mono:      "'IBM Plex Mono','Menlo',monospace",
  serif:    "'Playfair Display','Georgia',serif",
  body:      "'Source Serif 4','Georgia',serif",
};

type Props = {
  data: PortfolioIntelligencePayload;
  onClose: () => void;
};

export default function BoardroomMode({ data, onClose }: Props) {
  const [narrative, setNarrative] = useState<string | null>(null);
  const [narLoading, setNarLoading] = useState(false);

  const topRisks     = data.projects.filter(p => p.has_snapshot).slice(0, 3);
  const topDecisions = data.topDecisions.slice(0, 3);
  const falseGreens  = data.projects.filter(p => p.is_false_green);

  // Generate AI narrative
  const genNarrative = useCallback(async () => {
    setNarLoading(true);
    try {
      const prompt = `You are a senior programme director briefing the board in under 60 words.
Portfolio state: ${data.totalProjects} active projects, avg failure risk ${data.avgFailureRisk}/100 (${data.portfolioRiskBand}).
Critical: ${data.criticalCount}, High: ${data.highCount}, False green: ${data.falseGreenCount}.
Top risk project: ${topRisks[0]?.project_title ?? "none"} (score ${topRisks[0]?.failure_risk_score ?? 0}).
Reporting trust: ${data.reportingTrustScore}%.
Write ONE executive briefing paragraph. Direct, no fluff. Start with the most important thing.`;

      const res  = await fetch("/api/ai/briefing/narrative", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const json = await res.json();
      setNarrative(json.narrative || json.text || null);
    } catch { setNarrative(null); } finally { setNarLoading(false); }
  }, [data, topRisks]);

  useEffect(() => { genNarrative(); }, [genNarrative]);

  const bandColor = (band: string) => band === "Critical" ? T.red : band === "High" ? T.amber : T.green;
  const bandBg    = (band: string) => band === "Critical" ? T.redBg : band === "High" ? T.amberBg : T.greenBg;
  const bandBd    = (band: string) => band === "Critical" ? T.redBd : band === "High" ? T.amberBd : T.greenBd;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2000, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
         onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: T.bg, width: "100%", maxWidth: 900, maxHeight: "92vh", overflowY: "auto", borderRadius: 4, border: `1px solid ${T.hr}`, boxShadow: "0 32px 100px rgba(0,0,0,0.35)" }}>

        {/* Header */}
        <div style={{ padding: "24px 32px 20px", borderBottom: `2px solid ${T.ink}`, display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.15em", textTransform: "uppercase", color: T.ink4, marginBottom: 6 }}>
              Aliena · Boardroom Mode
            </div>
            <div style={{ fontFamily: T.serif, fontSize: 36, fontWeight: 700, color: T.ink, letterSpacing: "-0.02em", lineHeight: 1 }}>
              Programme Status
            </div>
            <div style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4, marginTop: 8 }}>
              {data.totalProjects} projects · {new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "")}
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.ink4, padding: 4 }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: "24px 32px", display: "flex", flexDirection: "column", gap: 24 }}>

          {/* AI Narrative — 30-second brief */}
          <div style={{ background: T.surface, border: `1px solid ${T.hr}`, padding: "20px 24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
              <Brain size={14} color={T.ink3} />
              <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: T.ink4 }}>30-second AI brief</span>
              <button onClick={genNarrative} disabled={narLoading} style={{ marginLeft: "auto", background: "none", border: "none", cursor: "pointer", color: T.ink4 }}>
                <RefreshCw size={12} style={{ animation: narLoading ? "spin 1s linear infinite" : "none" }} />
              </button>
            </div>
            {narLoading ? (
              <div style={{ fontFamily: T.body, fontSize: 15, color: T.ink4 }}>Generating briefing…</div>
            ) : narrative ? (
              <p style={{ fontFamily: T.body, fontSize: 15, color: T.ink2, lineHeight: 1.75, margin: 0, fontWeight: 300 }}>{narrative}</p>
            ) : (
              <p style={{ fontFamily: T.body, fontSize: 15, color: T.ink4, margin: 0 }}>
                Portfolio of {data.totalProjects} projects with average failure risk {data.avgFailureRisk}/100. {data.criticalCount} projects in critical band. {data.falseGreenCount > 0 ? `${data.falseGreenCount} project${data.falseGreenCount !== 1 ? "s" : ""} reporting false green status.` : "Reporting confidence is high."} {data.topDecisions[0] ? `Priority action: ${data.topDecisions[0].action}` : ""}
              </p>
            )}
          </div>

          {/* False green alert */}
          {falseGreens.length > 0 && (
            <div style={{ background: T.redBg, border: `1px solid ${T.redBd}`, padding: "14px 20px", display: "flex", alignItems: "flex-start", gap: 12 }}>
              <AlertTriangle size={16} color={T.red} style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <div style={{ fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.red, marginBottom: 4 }}>
                  Truth Layer — {falseGreens.length} false-green project{falseGreens.length !== 1 ? "s" : ""}
                </div>
                <div style={{ fontFamily: T.body, fontSize: 13, color: T.red, fontWeight: 300 }}>
                  {falseGreens.map(p => p.project_title).join(", ")} — declared healthy but Pre-Mortem AI evidence disagrees. Board visibility is compromised.
                </div>
              </div>
            </div>
          )}

          {/* Three columns */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>

            {/* Top risks */}
            <div style={{ background: T.surface, border: `1px solid ${T.hr}` }}>
              <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "center", gap: 8 }}>
                <TrendingUp size={13} color={T.red} />
                <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink4 }}>Top risks</span>
              </div>
              <div>
                {topRisks.length === 0 ? (
                  <div style={{ padding: "16px 18px", fontFamily: T.mono, fontSize: 11, color: T.ink5 }}>No risk data yet</div>
                ) : topRisks.map((proj, i) => (
                  <div key={proj.project_id} style={{ padding: "12px 18px", borderBottom: i < topRisks.length - 1 ? `1px solid ${T.hr}` : "none" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink, fontWeight: 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{proj.project_title}</div>
                        {proj.pm_name && <div style={{ fontFamily: T.mono, fontSize: 9, color: T.ink4, marginTop: 2 }}>{proj.pm_name}</div>}
                      </div>
                      <span style={{ flexShrink: 0, fontFamily: T.mono, fontSize: 9, fontWeight: 600, padding: "2px 7px", borderRadius: 2, color: bandColor(proj.failure_risk_band), background: bandBg(proj.failure_risk_band), border: `1px solid ${bandBd(proj.failure_risk_band)}` }}>
                        {proj.failure_risk_band}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Decisions needed */}
            <div style={{ background: T.surface, border: `1px solid ${T.hr}` }}>
              <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "center", gap: 8 }}>
                <Target size={13} color={T.amber} />
                <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink4 }}>Decisions needed</span>
              </div>
              <div>
                {topDecisions.map((d, i) => (
                  <div key={i} style={{ padding: "12px 18px", borderBottom: i < topDecisions.length - 1 ? `1px solid ${T.hr}` : "none" }}>
                    <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink, lineHeight: 1.4, marginBottom: 4 }}>{d.action}</div>
                    <div style={{ fontFamily: T.mono, fontSize: 9, color: T.ink4 }}>{d.project_title}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Confidence + metrics */}
            <div style={{ display: "flex", flexDirection: "column", gap: 0, background: T.surface, border: `1px solid ${T.hr}` }}>
              <div style={{ padding: "14px 18px 10px", borderBottom: `1px solid ${T.hr}`, display: "flex", alignItems: "center", gap: 8 }}>
                <Eye size={13} color={T.ink3} />
                <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: T.ink4 }}>Confidence</span>
              </div>
              <div style={{ padding: "16px 18px", borderBottom: `1px solid ${T.hr}` }}>
                <div style={{ fontFamily: T.serif, fontSize: 40, fontWeight: 700, color: data.reportingTrustScore >= 80 ? T.green : data.reportingTrustScore >= 60 ? T.amber : T.red, lineHeight: 1 }}>
                  {data.reportingTrustScore}<span style={{ fontFamily: T.mono, fontSize: 16, fontWeight: 300, color: T.ink4 }}>%</span>
                </div>
                <div style={{ fontFamily: T.mono, fontSize: 9, color: T.ink4, marginTop: 4 }}>reporting trust score</div>
              </div>
              <div style={{ padding: "14px 18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontFamily: T.mono, fontSize: 9, color: T.ink4 }}>CRITICAL PROJECTS</span>
                  <span style={{ fontFamily: T.mono, fontSize: 14, fontWeight: 600, color: data.criticalCount > 0 ? T.red : T.green }}>{data.criticalCount}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Forecast trajectory */}
          <div style={{ background: T.redBg, border: `1px solid ${T.redBd}`, padding: "18px 24px" }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.red, marginBottom: 10 }}>
              What happens if we do nothing?
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 20 }}>
                <div>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.red, textTransform: "uppercase", marginBottom: 4 }}>Avg risk trajectory</div>
                  <div style={{ fontFamily: T.serif, fontSize: 28, fontWeight: 700, color: T.red }}>{Math.min(100, data.avgFailureRisk + 15)}/100</div>
                  <div style={{ fontFamily: T.mono, fontSize: 9, color: T.red, opacity: 0.7 }}>in 30 days without action</div>
                </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}