"use client";

// src/components/dashboard/ProjectHealthDashboard.tsx
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ArtifactHealth,
  ArtifactKey,
  ProjectHealthSnapshot,
  ProjectHealthResult,
  HealthSignal,
  RAGStatus,
  TrendDirection,
  computeHealthSignals,
  rollupRAG,
  computeTrend,
} from "@/lib/project-health";

// ─── Types ────────────────────────────────────────────────────────────────────

type WindowDays = 7 | 14 | 30 | 60;

// ─── Icons ────────────────────────────────────────────────────────────────────

const IconSpinner = () => (
  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
  </svg>
);

const IconChevron = ({ open }: { open: boolean }) => (
  <svg className={`w-4 h-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
  </svg>
);

const IconWarning = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
  </svg>
);

const IconAlert = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
  </svg>
);

const IconCheck = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
  </svg>
);

const IconRefresh = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
  </svg>
);

// ─── RAG config ───────────────────────────────────────────────────────────────

const RAG_CONFIG: Record<RAGStatus, { bg: string; border: string; text: string; dot: string; label: string }> = {
  green:   { bg: "bg-emerald-50",  border: "border-emerald-200", text: "text-emerald-800", dot: "bg-emerald-500",  label: "On Track" },
  amber:   { bg: "bg-amber-50",    border: "border-amber-200",   text: "text-amber-800",   dot: "bg-amber-500",    label: "At Risk"  },
  red:     { bg: "bg-red-50",      border: "border-red-200",     text: "text-red-800",     dot: "bg-red-500",      label: "Critical" },
  unknown: { bg: "bg-slate-50",    border: "border-slate-200",   text: "text-slate-500",   dot: "bg-slate-300",    label: "Unknown"  },
};

function RAGDot({ rag, size = "sm" }: { rag: RAGStatus; size?: "sm" | "lg" }) {
  const c = RAG_CONFIG[rag];
  const s = size === "lg" ? "w-3 h-3" : "w-2 h-2";
  return <span className={`inline-block rounded-full ${s} ${c.dot}`} />;
}

function RAGBadge({ rag }: { rag: RAGStatus }) {
  const c = RAG_CONFIG[rag];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border ${c.bg} ${c.border} ${c.text}`}>
      <RAGDot rag={rag} />
      {c.label}
    </span>
  );
}

// ─── Trend badge ──────────────────────────────────────────────────────────────

const TREND_CONFIG: Record<TrendDirection, { icon: string; text: string; color: string }> = {
  improving:    { icon: "↑", text: "Improving",    color: "text-emerald-600" },
  stable:       { icon: "→", text: "Stable",       color: "text-slate-500"   },
  deteriorating:{ icon: "↓", text: "Deteriorating",color: "text-red-600"     },
  unknown:      { icon: "—", text: "Unknown",      color: "text-slate-400"   },
};

function TrendBadge({ trend }: { trend: TrendDirection }) {
  const t = TREND_CONFIG[trend];
  return (
    <span className={`text-xs font-semibold ${t.color}`}>
      {t.icon} {t.text}
    </span>
  );
}

// ─── Signal badge ─────────────────────────────────────────────────────────────

const SIGNAL_STYLES = {
  critical: "bg-red-50 border-red-200 text-red-700",
  warning:  "bg-amber-50 border-amber-200 text-amber-700",
  info:     "bg-blue-50 border-blue-200 text-blue-700",
};

function SignalBadge({ signal }: { signal: HealthSignal }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium border ${SIGNAL_STYLES[signal.severity]}`} title={signal.detail}>
      {signal.severity === "critical" ? <IconAlert /> : <IconWarning />}
      {signal.label}
    </span>
  );
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

function Sparkline({
  snapshots,
  artifactKey,
  windowDays,
}: {
  snapshots: ProjectHealthSnapshot[];
  artifactKey: ArtifactKey | "overall";
  windowDays: WindowDays;
}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const data = [...snapshots]
    .filter((s) => new Date(s.snapshotDate) >= cutoff)
    .sort((a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime());

  if (data.length < 2) {
    return <span className="text-xs text-slate-300 italic">No trend data</span>;
  }

  const ragScore = (r: RAGStatus) => r === "red" ? 2 : r === "amber" ? 1 : 0;
  const getValue = (s: ProjectHealthSnapshot): RAGStatus => {
    if (artifactKey === "financial") return s.financialRag;
    if (artifactKey === "raid") return s.raidRag;
    if (artifactKey === "schedule") return s.scheduleRag;
    return s.overallRag;
  };

  const W = 80, H = 24, pad = 2;
  const scores = data.map((s) => ragScore(getValue(s)));
  const maxScore = 2;
  const points = scores.map((score, i) => {
    const x = pad + (i / (data.length - 1)) * (W - pad * 2);
    const y = H - pad - ((score / maxScore) * (H - pad * 2));
    return `${x},${y}`;
  });

  const lastRag = getValue(data[data.length - 1]);
  const strokeColor = lastRag === "red" ? "#ef4444" : lastRag === "amber" ? "#f59e0b" : "#10b981";

  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {points.map((p, i) => {
        const [x, y] = p.split(",").map(Number);
        const dotRag = getValue(data[i]);
        const dotColor = dotRag === "red" ? "#ef4444" : dotRag === "amber" ? "#f59e0b" : "#10b981";
        return <circle key={i} cx={x} cy={y} r="2.5" fill={dotColor} />;
      })}
    </svg>
  );
}

// ─── RAG history heatmap row ──────────────────────────────────────────────────

function HeatmapRow({
  label,
  snapshots,
  artifactKey,
  windowDays,
}: {
  label: string;
  snapshots: ProjectHealthSnapshot[];
  artifactKey: ArtifactKey | "overall";
  windowDays: WindowDays;
}) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const data = [...snapshots]
    .filter((s) => new Date(s.snapshotDate) >= cutoff)
    .sort((a, b) => new Date(a.snapshotDate).getTime() - new Date(b.snapshotDate).getTime());

  const getValue = (s: ProjectHealthSnapshot): RAGStatus => {
    if (artifactKey === "financial") return s.financialRag;
    if (artifactKey === "raid") return s.raidRag;
    if (artifactKey === "schedule") return s.scheduleRag;
    return s.overallRag;
  };

  const cellBg = (rag: RAGStatus) =>
    rag === "red" ? "bg-red-400" : rag === "amber" ? "bg-amber-400" : rag === "green" ? "bg-emerald-400" : "bg-slate-200";

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-slate-500 w-20 shrink-0">{label}</span>
      <div className="flex gap-0.5 flex-1">
        {data.length === 0 ? (
          <span className="text-xs text-slate-300 italic">No data</span>
        ) : (
          data.map((s, i) => (
            <div
              key={i}
              className={`h-5 flex-1 rounded-sm ${cellBg(getValue(s))}`}
              title={`${s.snapshotDate}: ${getValue(s).toUpperCase()}`}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Artifact tile ────────────────────────────────────────────────────────────

function ArtifactTile({
  artifact,
  snapshots,
  windowDays,
  signals,
}: {
  artifact: ArtifactHealth;
  snapshots: ProjectHealthSnapshot[];
  windowDays: WindowDays;
  signals: HealthSignal[];
}) {
  const c = RAG_CONFIG[artifact.rag];
  const tileSignals = signals.filter((s) => s.affectedArtifacts.includes(artifact.key));

  return (
    <div className={`rounded-xl border-2 p-4 flex flex-col gap-3 ${c.bg} ${c.border}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{artifact.label}</p>
          <RAGBadge rag={artifact.rag} />
        </div>
        <Sparkline snapshots={snapshots} artifactKey={artifact.key} windowDays={windowDays} />
      </div>
      <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">{artifact.headline || "No data available"}</p>
      <div className="flex items-center justify-between">
        <div className="flex gap-3 text-xs">
          {artifact.criticalSignals > 0 && (
            <span className="text-red-600 font-semibold">{artifact.criticalSignals} critical</span>
          )}
          {artifact.warningSignals > 0 && (
            <span className="text-amber-600">{artifact.warningSignals} warning</span>
          )}
          {artifact.criticalSignals === 0 && artifact.warningSignals === 0 && (
            <span className="text-emerald-600">No signals</span>
          )}
        </div>
        {artifact.lastUpdated && (
          <span className="text-xs text-slate-400">
            {new Date(artifact.lastUpdated).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </span>
        )}
      </div>
      {tileSignals.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-current/10">
          {tileSignals.map((s, i) => <SignalBadge key={i} signal={s} />)}
        </div>
      )}
    </div>
  );
}

// ─── AI panel ─────────────────────────────────────────────────────────────────

function AIPanel({
  result,
  loading,
  error,
  onExplain,
  signals,
}: {
  result: ProjectHealthResult | null;
  loading: boolean;
  error: string | null;
  onExplain: () => void;
  signals: HealthSignal[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    breakdown: true,
    crossCutting: true,
    actions: false,
    warnings: false,
  });
  const toggle = (k: string) => setExpanded((p) => ({ ...p, [k]: !p[k] }));

  const URGENCY_STYLES: Record<string, string> = {
    immediate: "bg-red-100 text-red-700",
    this_week: "bg-orange-100 text-orange-700",
    this_sprint: "bg-amber-100 text-amber-700",
    monitor: "bg-slate-100 text-slate-600",
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.416A7.5 7.5 0 0112 19.5a7.5 7.5 0 01-4.09-1.184l-.347-.416z" />
            </svg>
          </div>
          <span className="text-sm font-semibold text-slate-800">Health Intelligence</span>
          {result?.fallback && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 border border-slate-200">Rule-based</span>
          )}
        </div>
        <button
          onClick={onExplain}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          {loading ? <IconSpinner /> : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.347.416A7.5 7.5 0 0112 19.5a7.5 7.5 0 01-4.09-1.184l-.347-.416z" />
            </svg>
          )}
          {loading ? "Analysing…" : result ? "Re-analyse" : "Explain with AI"}
        </button>
      </div>

      {/* Signals */}
      {signals.length > 0 && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          <p className="text-xs font-medium text-slate-500 mb-2">Cross-Artifact Signals</p>
          <div className="flex flex-wrap gap-1.5">
            {signals.map((s, i) => <SignalBadge key={i} signal={s} />)}
          </div>
        </div>
      )}

      {!result && !loading && (
        <div className="px-4 py-8 text-center">
          {error
            ? <p className="text-sm text-red-500">{error}</p>
            : <p className="text-sm text-slate-400">Click "Explain with AI" for cross-artifact health analysis</p>
          }
        </div>
      )}

      {loading && (
        <div className="px-4 py-6 space-y-3 animate-pulse">
          {[1, 2, 3].map((n) => <div key={n} className="h-3 bg-slate-100 rounded" style={{ width: `${90 - n * 10}%` }} />)}
        </div>
      )}

      {result && !loading && (
        <div className="divide-y divide-slate-100">
          {/* Headline */}
          <div className="px-4 py-4">
            <div className="flex items-start gap-3">
              <RAGBadge rag={result.rag} />
              <p className="text-sm font-medium text-slate-800 leading-snug">{result.headline}</p>
            </div>
            {result.narrative && (
              <p className="mt-2 text-sm text-slate-600 leading-relaxed">{result.narrative}</p>
            )}
          </div>

          {/* Artifact breakdown */}
          {result.artifactBreakdown?.length > 0 && (
            <div>
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("breakdown")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Artifact Breakdown</span>
                <IconChevron open={expanded.breakdown} />
              </button>
              {expanded.breakdown && (
                <div className="px-4 pb-3 space-y-2">
                  {result.artifactBreakdown.map((a, i) => (
                    <div key={i} className="flex items-start gap-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
                      <RAGDot rag={a.rag} size="lg" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-700">{a.label}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{a.summary}</p>
                        {a.topConcern && (
                          <p className="text-xs text-red-600 mt-0.5 font-medium">{a.topConcern}</p>
                        )}
                      </div>
                      <RAGBadge rag={a.rag} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Cross-cutting risks */}
          {result.crossCuttingRisks?.length > 0 && (
            <div>
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("crossCutting")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Cross-Cutting Risks ({result.crossCuttingRisks.length})</span>
                <IconChevron open={expanded.crossCutting} />
              </button>
              {expanded.crossCutting && (
                <div className="px-4 pb-3 space-y-2">
                  {result.crossCuttingRisks.map((r, i) => (
                    <div key={i} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-800">{r.title}</span>
                        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${URGENCY_STYLES[r.urgency]}`}>
                          {r.urgency.replace("_", " ")}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500">{r.rationale}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Exec actions */}
          {result.execActions?.length > 0 && (
            <div>
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("actions")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Exec Actions ({result.execActions.length})</span>
                <IconChevron open={expanded.actions} />
              </button>
              {expanded.actions && (
                <div className="px-4 pb-3 space-y-1.5">
                  {result.execActions.map((a, i) => (
                    <div key={i} className="flex items-start gap-2.5">
                      <span className="shrink-0 mt-0.5 text-emerald-500"><IconCheck /></span>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-slate-700">{a.action}</span>
                        <span className="text-xs text-slate-400 ml-1">— {a.owner}</span>
                        <span className="text-xs text-slate-400 ml-1">· {a.timeframe}</span>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${a.priority === "high" ? "bg-red-100 text-red-700" : a.priority === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500"}`}>
                        {a.priority}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Early warnings */}
          {result.earlyWarnings?.length > 0 && (
            <div>
              <button className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors" onClick={() => toggle("warnings")}>
                <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Early Warnings ({result.earlyWarnings.length})</span>
                <IconChevron open={expanded.warnings} />
              </button>
              {expanded.warnings && (
                <div className="px-4 pb-4 space-y-1.5">
                  {result.earlyWarnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded px-3 py-2 border border-amber-100">
                      <IconWarning /><span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main dashboard ───────────────────────────────────────────────────────────

interface ProjectHealthDashboardProps {
  projectId: string;
  projectName?: string;
  // Pass artifact health directly OR let component fetch from Supabase
  initialArtifacts?: ArtifactHealth[];
  initialSnapshots?: ProjectHealthSnapshot[];
  // Optional: provide a fetch function to load Supabase data
  onFetchData?: (projectId: string, windowDays: WindowDays) => Promise<{
    artifacts: ArtifactHealth[];
    snapshots: ProjectHealthSnapshot[];
  }>;
}

export default function ProjectHealthDashboard({
  projectId,
  projectName,
  initialArtifacts = [],
  initialSnapshots = [],
  onFetchData,
}: ProjectHealthDashboardProps) {
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const [artifacts, setArtifacts] = useState<ArtifactHealth[]>(initialArtifacts);
  const [snapshots, setSnapshots] = useState<ProjectHealthSnapshot[]>(initialSnapshots);
  const [loadingData, setLoadingData] = useState(false);

  const [aiResult, setAiResult] = useState<ProjectHealthResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const signals = useMemo(() => computeHealthSignals(artifacts, snapshots), [artifacts, snapshots]);
  const overallRag = useMemo(() => rollupRAG(artifacts), [artifacts]);
  const trend = useMemo(() => computeTrend(snapshots, windowDays), [snapshots, windowDays]);

  // Fetch data when window changes (if onFetchData provided)
  useEffect(() => {
    if (!onFetchData) return;
    setLoadingData(true);
    onFetchData(projectId, windowDays)
      .then(({ artifacts: a, snapshots: s }) => {
        setArtifacts(a);
        setSnapshots(s);
      })
      .catch(console.error)
      .finally(() => setLoadingData(false));
  }, [projectId, windowDays, onFetchData]);

  const handleExplain = useCallback(async () => {
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await fetch("/api/ai/project-health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ artifacts, snapshots, projectName, windowDays }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setAiResult(data.result);
    } catch (e: any) {
      setAiError(e.message || "Failed to fetch health intelligence");
    } finally {
      setAiLoading(false);
    }
  }, [artifacts, snapshots, projectName, windowDays]);

  const criticalSignals = signals.filter((s) => s.severity === "critical");
  const artifactTiles = artifacts.filter((a) => a.key !== "overall");

  // Stats
  const totalCritical = artifacts.reduce((s, a) => s + a.criticalSignals, 0);
  const totalWarning = artifacts.reduce((s, a) => s + a.warningSignals, 0);
  const complete = artifacts.filter((a) => a.key !== "overall" && a.rag === "green").length;

  return (
    <div className="flex flex-col gap-5">
      {/* Critical signal bar */}
      {criticalSignals.length > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-red-50 border border-red-200">
          <span className="text-red-600 font-semibold text-sm">
            ⚠ {criticalSignals.length} Cross-Artifact Signal{criticalSignals.length > 1 ? "s" : ""}
          </span>
          <div className="flex flex-wrap gap-1.5 flex-1">
            {criticalSignals.map((s, i) => <SignalBadge key={i} signal={s} />)}
          </div>
        </div>
      )}

      {/* Header row */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div>
            <p className="text-xs text-slate-500 font-medium uppercase tracking-wide mb-1">Overall Health</p>
            <div className="flex items-center gap-2">
              <RAGBadge rag={overallRag} />
              <TrendBadge trend={trend} />
            </div>
          </div>
          <div className="h-10 w-px bg-slate-200" />
          <div className="flex gap-4 text-sm">
            <span className="text-red-600 font-semibold">{totalCritical} critical</span>
            <span className="text-amber-600">{totalWarning} warnings</span>
            <span className="text-emerald-600">{complete}/{artifactTiles.length} artifacts green</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Time window selector */}
          <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            {([7, 14, 30, 60] as WindowDays[]).map((d) => (
              <button
                key={d}
                onClick={() => setWindowDays(d)}
                className={`px-3 py-1.5 font-medium transition-colors ${windowDays === d ? "bg-slate-800 text-white" : "text-slate-500 hover:bg-slate-50"}`}
              >
                {d}d
              </button>
            ))}
          </div>
          {loadingData && <IconSpinner />}
        </div>
      </div>

      {/* Artifact tiles */}
      <div className={`grid gap-3 ${artifactTiles.length <= 2 ? "grid-cols-2" : "grid-cols-3"}`}>
        {artifactTiles.map((a) => (
          <ArtifactTile
            key={a.key}
            artifact={a}
            snapshots={snapshots}
            windowDays={windowDays}
            signals={signals}
          />
        ))}
      </div>

      {/* Heatmap */}
      {snapshots.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm px-4 py-4">
          <p className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">
            RAG History — Last {windowDays} Days
          </p>
          <div className="space-y-2">
            {(["overall", "financial", "raid", "schedule"] as const).map((key) => (
              <HeatmapRow
                key={key}
                label={key.charAt(0).toUpperCase() + key.slice(1)}
                snapshots={snapshots}
                artifactKey={key}
                windowDays={windowDays}
              />
            ))}
          </div>
          <div className="flex items-center gap-3 mt-3 pt-3 border-t border-slate-100">
            <p className="text-xs text-slate-400">Legend:</p>
            {(["green", "amber", "red"] as RAGStatus[]).map((r) => (
              <div key={r} className="flex items-center gap-1">
                <span className={`w-3 h-3 rounded-sm ${RAG_CONFIG[r].dot.replace("bg-", "bg-").replace("500", "400")}`} />
                <span className="text-xs text-slate-500 capitalize">{r}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI panel */}
      <AIPanel
        result={aiResult}
        loading={aiLoading}
        error={aiError}
        onExplain={handleExplain}
        signals={signals}
      />
    </div>
  );
}