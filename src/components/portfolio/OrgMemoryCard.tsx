"use client";
// src/components/portfolio/OrgMemoryCard.tsx
import React, { useCallback, useEffect, useState } from "react";
import { Brain, RefreshCw, ChevronDown, ChevronUp, TrendingUp } from "lucide-react";
// Types inlined to avoid server-only import
type PatternEvidence = { project_id: string; project_title: string; value: string | number; context: string; };
type OrgPattern = { id?: string; pattern_type: string; title: string; description: string; evidence: PatternEvidence[]; frequency: number; avg_impact: string; applicable_when: string; recommendation: string; confidence: number; source_project_ids: string[]; };

const T = {
  bg:      "#f9f7f4", surface: "#ffffff", hr: "#e7e5e4",
  ink:      "#1c1917", ink2:   "#44403c", ink3: "#78716c", ink4: "#a8a29e", ink5: "#d6d3d1",
  red:      "#7f1d1d", redBg:  "#fef2f2", redBd: "#fca5a5",
  amber:    "#78350f", amberBg:"#fffbeb", amberBd:"#fcd34d",
  green:    "#14532d", greenBg:"#f0fdf4", greenBd:"#86efac",
  navy:     "#1B3652", navyBg: "#EBF0F5",
  mono:     "'IBM Plex Mono','Menlo',monospace",
  serif:    "'Playfair Display','Georgia',serif",
  body:     "'Source Serif 4','Georgia',serif",
};

const PATTERN_TYPE_CFG: Record<string, { label: string; color: string; bg: string }> = {
  delivery_slip:     { label: "Delivery risk",      color: T.red,   bg: T.redBg },
  approval_delay:    { label: "Approval pattern",   color: T.amber, bg: T.amberBg },
  budget_overrun:    { label: "Budget pattern",     color: T.red,   bg: T.redBg },
  scope_creep:       { label: "Scope pattern",      color: T.amber, bg: T.amberBg },
  governance_gap:    { label: "Governance pattern", color: T.amber, bg: T.amberBg },
  team_performance:  { label: "Team pattern",       color: T.navy,  bg: T.navyBg },
  phase_risk:        { label: "Phase risk",         color: T.red,   bg: T.redBg },
};

function PatternCard({ pattern }: { pattern: OrgPattern & { id?: string } }) {
  const [open, setOpen] = useState(false);
  const cfg = PATTERN_TYPE_CFG[pattern.pattern_type] ?? { label: pattern.pattern_type, color: T.navy, bg: T.navyBg };

  return (
    <div style={{ border: `1px solid ${T.hr}`, borderRadius: 8, overflow: "hidden", background: T.surface }}>
      <button onClick={() => setOpen(v => !v)} style={{ width: "100%", padding: "14px 18px", display: "flex", alignItems: "flex-start", gap: 14, background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
        <div style={{ flexShrink: 0, width: 36, height: 36, borderRadius: 10, background: cfg.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <TrendingUp size={16} color={cfg.color} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
            <span style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: cfg.color, padding: "1px 7px", background: cfg.bg, border: `1px solid ${cfg.color}22`, borderRadius: 3 }}>{cfg.label}</span>
            <span style={{ fontFamily: T.mono, fontSize: 9, color: T.ink4 }}>{pattern.frequency} project{pattern.frequency !== 1 ? "s" : ""} · {pattern.confidence}% confidence</span>
          </div>
          <div style={{ fontFamily: T.serif, fontSize: 14, fontWeight: 600, color: T.ink, lineHeight: 1.4 }}>{pattern.title}</div>
          <div style={{ fontFamily: T.body, fontSize: 12, color: T.ink3, marginTop: 3 }}>{pattern.description.slice(0, 100)}{pattern.description.length > 100 ? "…" : ""}</div>
        </div>
        <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <div style={{ fontFamily: T.mono, fontSize: 12, fontWeight: 700, color: cfg.color }}>{pattern.avg_impact}</div>
          {open ? <ChevronUp size={14} color={T.ink4} /> : <ChevronDown size={14} color={T.ink4} />}
        </div>
      </button>

      {open && (
        <div style={{ borderTop: `1px solid ${T.hr}`, padding: "14px 18px 18px", background: "#fafaf9" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 14 }}>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink4, marginBottom: 5 }}>Applicable when</div>
              <p style={{ fontFamily: T.body, fontSize: 12, color: T.ink2, margin: 0, lineHeight: 1.6 }}>{pattern.applicable_when}</p>
            </div>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink4, marginBottom: 5 }}>Average impact</div>
              <p style={{ fontFamily: T.body, fontSize: 12, color: cfg.color, margin: 0, lineHeight: 1.6, fontWeight: 600 }}>{pattern.avg_impact}</p>
            </div>
          </div>

          <div style={{ padding: "12px 16px", background: T.greenBg, border: `1px solid ${T.greenBd}`, borderRadius: 6, marginBottom: 14 }}>
            <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: T.green, marginBottom: 4 }}>Recommendation</div>
            <p style={{ fontFamily: T.body, fontSize: 13, color: T.green, margin: 0, lineHeight: 1.6 }}>{pattern.recommendation}</p>
          </div>

          {pattern.evidence?.length > 0 && (
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: T.ink4, marginBottom: 8 }}>Evidence from your projects</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                {pattern.evidence.slice(0, 4).map((ev: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px", background: T.surface, border: `1px solid ${T.hr}`, borderRadius: 5 }}>
                    <span style={{ fontFamily: T.body, fontSize: 12, color: T.ink2 }}>{ev.project_title}</span>
                    <span style={{ fontFamily: T.mono, fontSize: 10, color: cfg.color, fontWeight: 600 }}>{ev.context}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 14 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontFamily: T.mono, fontSize: 9, color: T.ink4, textTransform: "uppercase", letterSpacing: "0.06em" }}>Pattern confidence</span>
              <span style={{ fontFamily: T.mono, fontSize: 10, color: T.ink3, fontWeight: 600 }}>{pattern.confidence}%</span>
            </div>
            <div style={{ height: 3, background: T.hr, borderRadius: 2, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pattern.confidence}%`, background: pattern.confidence >= 75 ? T.green : pattern.confidence >= 50 ? T.amber : T.red }} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function OrgMemoryCard() {
  const [patterns, setPatterns] = useState<(OrgPattern & { id?: string })[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [running,  setRunning]  = useState(false);
  const [lastRun,  setLastRun]  = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/ai/org-memory");
      const json = await res.json();
      if (json.ok) setPatterns(json.patterns ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function recompute() {
    setRunning(true);
    try {
      const res  = await fetch("/api/ai/org-memory", { method: "POST" });
      const json = await res.json();
      if (json.ok) { setLastRun(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })); await load(); }
    } finally { setRunning(false); }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16, fontFamily: T.body }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg,#1B3652,#0e7490)", display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Brain size={18} color="white" />
            </div>
            <div>
              <div style={{ fontFamily: T.mono, fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: T.navy }}>Aliena</div>
              <div style={{ fontFamily: T.serif, fontSize: 20, fontWeight: 700, color: T.ink }}>Organisational Memory</div>
            </div>
          </div>
          <p style={{ margin: "8px 0 0", fontFamily: T.body, fontSize: 13, color: T.ink3 }}>
            Patterns learned from your organisation's delivery history. Applied to new projects automatically.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {lastRun && <span style={{ fontFamily: T.mono, fontSize: 10, color: T.ink4 }}>Last run {lastRun}</span>}
          <button onClick={recompute} disabled={running} style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 16px", fontFamily: T.mono, fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", background: T.ink, color: "#fff", border: "none", borderRadius: 4, cursor: running ? "default" : "pointer", opacity: running ? 0.7 : 1 }}>
            <Brain size={11} /> {running ? "Learning…" : "Run analysis"}
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: "60px", textAlign: "center", fontFamily: T.mono, fontSize: 11, color: T.ink5 }}>LOADING...</div>}

      {!loading && patterns.length === 0 && (
        <div style={{ padding: "48px", textAlign: "center", border: `1px dashed ${T.hr}`, borderRadius: 8 }}>
          <Brain size={32} color={T.ink5} style={{ margin: "0 auto 12px" }} />
          <div style={{ fontFamily: T.serif, fontSize: 16, fontWeight: 600, color: T.ink2, marginBottom: 8 }}>No patterns learned yet</div>
          <button onClick={recompute} style={{ padding: "8px 20px", fontFamily: T.mono, fontSize: 10, fontWeight: 700, background: T.ink, color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>Run first analysis</button>
        </div>
      )}

      {!loading && patterns.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {patterns.map((p, i) => <PatternCard key={p.id ?? i} pattern={p} />)}
        </div>
      )}
    </div>
  );
}