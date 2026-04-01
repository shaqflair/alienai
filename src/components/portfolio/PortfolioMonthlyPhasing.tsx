"use client";
// src/components/portfolio/PortfolioMonthlyPhasing.tsx
// Portfolio-wide monthly phasing matrix — matching the financial plan format.
// Shows Forecast / Actual / Budget / Variance per month per project.

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Download,
  ChevronDown,
  ChevronRight,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  Calendar,
  Archive,
  Filter,
} from "lucide-react";

/* ─────────────────────────────────────────────────────── types */

interface FyMonth { year: number; month: number; label: string }

interface ProjectPhasing {
  id: string;
  title: string;
  projectCode: string;
  resourceStatus: string;
  isArchived: boolean;
  hasPlan: boolean;
  budget: number;
  forecast: number[];
  actual: number[];
  budgetArr: number[];
  variance: number[];
  totals: { forecast: number; actual: number; budget: number; variance: number };
}

interface PhasingData {
  ok: boolean;
  fyYear: number;
  fyStart: number;
  fyMonths: FyMonth[];
  projects: ProjectPhasing[];
  totals: {
    forecast: number[];
    actual: number[];
    budget: number[];
    variance: number[];
    totals: { forecast: number; actual: number; budget: number; variance: number };
  };
}

/* ─────────────────────────────────────────────────────── config */

const FY_START_OPTIONS = [
  { value: 4,  label: "Apr–Mar (UK)" },
  { value: 1,  label: "Jan–Dec" },
  { value: 7,  label: "Jul–Jun" },
  { value: 10, label: "Oct–Sep" },
];

function fyLabel(fyYear: number, fyStart: number): string {
  if (fyStart === 1) return String(fyYear);
  const endYear = fyYear + 1;
  return `${fyYear}/${String(endYear).slice(2)}`;
}

function fyYearOptions(fyStart: number): number[] {
  const now = new Date();
  const nowYear = now.getFullYear();
  const nowMonth = now.getMonth() + 1;
  const currentFy = nowMonth >= fyStart ? nowYear : nowYear - 1;
  return [currentFy + 1, currentFy, currentFy - 1, currentFy - 2, currentFy - 3];
}

/* ─────────────────────────────────────────────────────── formatters */

function fmt(v: number, showK = false): string {
  if (!Number.isFinite(v)) return "—";
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (showK) {
    return `${sign}£${(abs / 1000).toFixed(abs >= 10000 ? 0 : 1)}k`;
  }
  if (abs === 0) return "—";
  return `${sign}£${abs.toLocaleString("en-GB", { maximumFractionDigits: 0 })}`;
}

function fmtPct(v: number, total: number): string {
  if (!total || !Number.isFinite(v / total)) return "";
  const pct = (v / total) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(0)}%`;
}

/* ─────────────────────────────────────────────────────── sub-components */

const METRIC_COLORS = {
  forecast: { text: "#2563EB", bg: "#EFF6FF" },
  actual:   { text: "#059669", bg: "#F0FDF4" },
  budget:   { text: "#6B7280", bg: "#F9FAFB" },
  variance: { textPos: "#059669", textNeg: "#DC2626", bgPos: "#F0FDF4", bgNeg: "#FFF0F0" },
};

type Metric = "forecast" | "actual" | "budget" | "variance";
const METRICS: Metric[] = ["forecast", "actual", "budget", "variance"];
const METRIC_LABELS: Record<Metric, string> = {
  forecast: "FCT",
  actual: "ACT",
  budget: "BDG",
  variance: "VAR",
};

function MonthCell({ value, metric, isTotal = false }: { value: number; metric: Metric; isTotal?: boolean }) {
  const isVariance = metric === "variance";
  const isPos = value >= 0;

  const color = isVariance
    ? (isPos ? METRIC_COLORS.variance.textPos : METRIC_COLORS.variance.textNeg)
    : METRIC_COLORS[metric].text;

  const bg = isVariance
    ? (isPos ? METRIC_COLORS.variance.bgPos : METRIC_COLORS.variance.bgNeg)
    : isTotal ? "#F0F0E8" : "transparent";

  return (
    <td
      style={{
        padding: "3px 6px",
        textAlign: "right",
        fontSize: 11,
        fontVariantNumeric: "tabular-nums",
        color,
        background: bg,
        fontWeight: isTotal ? 600 : 400,
        whiteSpace: "nowrap",
        borderRight: metric === "variance" ? "1px solid #E5E5DC" : undefined,
        minWidth: 70,
      }}
    >
      {fmt(value, isTotal)}
    </td>
  );
}

function MonthGroupHeader({ month }: { month: FyMonth }) {
  return (
    <th
      colSpan={4}
      style={{
        padding: "6px 4px",
        textAlign: "center",
        fontSize: 10,
        fontWeight: 700,
        background: "#1A1A1A",
        color: "#FFFFFF",
        borderRight: "1px solid #333",
        whiteSpace: "nowrap",
        letterSpacing: "0.05em",
      }}
    >
      {month.label}
    </th>
  );
}

function MetricSubHeader({ metric }: { metric: Metric }) {
  const colors = METRIC_COLORS[metric as keyof typeof METRIC_COLORS] as any;
  return (
    <th
      style={{
        padding: "4px 6px",
        textAlign: "center",
        fontSize: 9,
        fontWeight: 700,
        background: "#F5F5F0",
        color: colors.text ?? colors.textPos,
        borderRight: metric === "variance" ? "1px solid #E5E5DC" : "none",
        minWidth: 70,
        whiteSpace: "nowrap",
      }}
    >
      {METRIC_LABELS[metric]}
    </th>
  );
}

/* ─────────────────────────────────────────────────────── project row */

function ProjectRow({
  proj,
  fyMonths,
  expanded,
  onToggle,
}: {
  proj: ProjectPhasing;
  fyMonths: FyMonth[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const hasData = proj.hasPlan;
  const varColor = proj.totals.variance >= 0 ? "#059669" : "#DC2626";

  return (
    <>
      <tr
        style={{
          cursor: "pointer",
          background: expanded ? "#FAFAF5" : "white",
          borderBottom: "1px solid #EEEEEE",
        }}
        onClick={onToggle}
      >
        {/* Sticky project name */}
        <td
          style={{
            position: "sticky",
            left: 0,
            background: expanded ? "#FAFAF5" : "white",
            zIndex: 2,
            padding: "8px 10px",
            minWidth: 220,
            maxWidth: 220,
            borderRight: "2px solid #E5E5DC",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "#9CA3AF", flexShrink: 0 }}>
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            <div>
              <div style={{ fontWeight: 600, fontSize: 12, color: "#1A1A1A", lineHeight: 1.3 }}>
                {proj.title}
                {proj.isArchived && (
                  <span style={{ marginLeft: 6, fontSize: 9, color: "#9CA3AF", fontWeight: 400 }}>ARCHIVED</span>
                )}
              </div>
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 500 }}>{proj.projectCode}</div>
            </div>
          </div>
        </td>

        {/* Collapsed summary: show total variance and spark */}
        {!expanded && (
          <>
            <td style={{ padding: "6px 10px", fontSize: 11, color: "#6B7280", textAlign: "right", minWidth: 90 }}>
              {fmt(proj.totals.budget, true)}
            </td>
            <td style={{ padding: "6px 10px", fontSize: 11, color: METRIC_COLORS.forecast.text, textAlign: "right", minWidth: 90 }}>
              {fmt(proj.totals.forecast, true)}
            </td>
            <td style={{ padding: "6px 10px", fontSize: 11, color: METRIC_COLORS.actual.text, textAlign: "right", minWidth: 90 }}>
              {fmt(proj.totals.actual, true)}
            </td>
            <td style={{ padding: "6px 10px", fontSize: 11, fontWeight: 600, color: varColor, textAlign: "right", minWidth: 90 }}>
              {fmt(proj.totals.variance, true)}
              <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 4, color: varColor }}>
                {fmtPct(proj.totals.variance, proj.totals.budget)}
              </span>
            </td>
            <td style={{ padding: "6px 10px", textAlign: "right" }}>
              {proj.totals.variance >= 0
                ? <TrendingUp size={12} color="#059669" />
                : <TrendingDown size={12} color="#DC2626" />}
            </td>
            {/* Fill remaining month columns with empty */}
            {fyMonths.slice(1).map((_, i) => (
              <td key={i} colSpan={4} style={{ borderRight: "1px solid #E5E5DC" }} />
            ))}
          </>
        )}

        {/* Expanded: show all month cells */}
        {expanded && fyMonths.map((_, mi) => (
          METRICS.map(metric => (
            <MonthCell
              key={`${mi}-${metric}`}
              value={metric === "forecast" ? proj.forecast[mi]
                : metric === "actual" ? proj.actual[mi]
                : metric === "budget" ? proj.budgetArr[mi]
                : proj.variance[mi]}
              metric={metric}
            />
          ))
        ))}

        {/* Row total */}
        {expanded && METRICS.map(metric => (
          <MonthCell
            key={`total-${metric}`}
            value={metric === "forecast" ? proj.totals.forecast
              : metric === "actual" ? proj.totals.actual
              : metric === "budget" ? proj.totals.budget
              : proj.totals.variance}
            metric={metric}
            isTotal
          />
        ))}
      </tr>
    </>
  );
}

/* ─────────────────────────────────────────────────────── totals row */

function TotalsRow({ data, fyMonths }: { data: PhasingData; fyMonths: FyMonth[] }) {
  return (
    <tr style={{ background: "#1A1A1A", position: "sticky", bottom: 0, zIndex: 3 }}>
      <td
        style={{
          position: "sticky",
          left: 0,
          background: "#1A1A1A",
          zIndex: 4,
          padding: "8px 10px",
          fontWeight: 700,
          fontSize: 12,
          color: "white",
          minWidth: 220,
          borderRight: "2px solid #444",
        }}
      >
        Portfolio Total
      </td>
      {fyMonths.map((_, mi) =>
        METRICS.map(metric => {
          const val = metric === "forecast" ? data.totals.forecast[mi]
            : metric === "actual" ? data.totals.actual[mi]
            : metric === "budget" ? data.totals.budget[mi]
            : data.totals.variance[mi];
          const isVariance = metric === "variance";
          const color = isVariance
            ? (val >= 0 ? "#34D399" : "#F87171")
            : metric === "forecast" ? "#93C5FD"
            : metric === "actual" ? "#6EE7B7"
            : "#9CA3AF";
          return (
            <td
              key={`tot-${mi}-${metric}`}
              style={{
                padding: "6px 6px",
                textAlign: "right",
                fontSize: 10,
                fontVariantNumeric: "tabular-nums",
                color,
                fontWeight: 600,
                borderRight: metric === "variance" ? "1px solid #333" : undefined,
                whiteSpace: "nowrap",
              }}
            >
              {fmt(val)}
            </td>
          );
        })
      )}
      {METRICS.map(metric => {
        const val = metric === "forecast" ? data.totals.totals.forecast
          : metric === "actual" ? data.totals.totals.actual
          : metric === "budget" ? data.totals.totals.budget
          : data.totals.totals.variance;
        const isVariance = metric === "variance";
        const color = isVariance ? (val >= 0 ? "#34D399" : "#F87171") : "white";
        return (
          <td
            key={`grand-${metric}`}
            style={{
              padding: "6px 8px",
              textAlign: "right",
              fontSize: 11,
              fontVariantNumeric: "tabular-nums",
              color,
              fontWeight: 700,
              background: "#111",
              whiteSpace: "nowrap",
            }}
          >
            {fmt(val, true)}
          </td>
        );
      })}
    </tr>
  );
}

/* ─────────────────────────────────────────────────────── main component */

export default function PortfolioMonthlyPhasing() {
  const [fyStart, setFyStart] = useState(4);
  const [fyYear, setFyYear] = useState<number>(() => {
    const now = new Date();
    return now.getMonth() + 1 >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  });
  const [scope, setScope] = useState<"active" | "all">("active");
  const [data, setData] = useState<PhasingData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  const [allExpanded, setAllExpanded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/portfolio/budget-phasing?fy=${fyYear}&fyStart=${fyStart}&scope=${scope}`,
        { cache: "no-store" }
      );
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? "Failed to load");
      setData(json);
      // Auto-expand if few projects
      if (json.projects.length <= 5) {
        setExpandedProjects(new Set(json.projects.map((p: any) => p.id)));
        setAllExpanded(true);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [fyYear, fyStart, scope]);

  useEffect(() => { load(); }, [load]);

  const toggleProject = useCallback((id: string) => {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    if (!data) return;
    if (allExpanded) {
      setExpandedProjects(new Set());
      setAllExpanded(false);
    } else {
      setExpandedProjects(new Set(data.projects.map(p => p.id)));
      setAllExpanded(true);
    }
  }, [data, allExpanded]);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const res = await fetch(
        `/api/portfolio/budget-phasing/export?fy=${fyYear}&fyStart=${fyStart}&scope=${scope}`
      );
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `portfolio-phasing-fy${fyLabel(fyYear, fyStart).replace("/", "-")}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      alert("Export failed: " + e.message);
    } finally {
      setExporting(false);
    }
  }, [fyYear, fyStart, scope]);

  const yearOptions = fyYearOptions(fyStart);
  const fyMonths = data?.fyMonths ?? [];

  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 0 16px",
          flexWrap: "wrap",
        }}
      >
        {/* FY Start selector */}
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <Calendar size={13} color="#9CA3AF" />
          <select
            value={fyStart}
            onChange={e => setFyStart(Number(e.target.value))}
            style={selectStyle}
          >
            {FY_START_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* FY Year selector */}
        <select
          value={fyYear}
          onChange={e => setFyYear(Number(e.target.value))}
          style={selectStyle}
        >
          {yearOptions.map(y => (
            <option key={y} value={y}>FY {fyLabel(y, fyStart)}</option>
          ))}
        </select>

        {/* Scope toggle */}
        <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: "1px solid #E5E5DC" }}>
          {(["active", "all"] as const).map(s => (
            <button
              key={s}
              onClick={() => setScope(s)}
              style={{
                padding: "5px 12px",
                fontSize: 11,
                fontWeight: 500,
                border: "none",
                cursor: "pointer",
                background: scope === s ? "#1A1A1A" : "white",
                color: scope === s ? "white" : "#6B7280",
                display: "flex",
                alignItems: "center",
                gap: 4,
              }}
            >
              {s === "all" && <Archive size={11} />}
              {s === "active" ? "Active only" : "All incl. closed"}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button onClick={load} style={iconBtnStyle} title="Refresh">
          <RefreshCw size={13} style={{ animation: loading ? "spin 1s linear infinite" : "none" }} />
        </button>

        <div style={{ flex: 1 }} />

        {/* Expand/collapse all */}
        <button onClick={toggleAll} style={textBtnStyle}>
          <Filter size={11} />
          {allExpanded ? "Collapse all" : "Expand all"}
        </button>

        {/* Export */}
        <button
          onClick={handleExport}
          disabled={exporting || !data}
          style={{
            ...textBtnStyle,
            background: "#1A1A1A",
            color: "white",
            padding: "6px 14px",
            borderRadius: 6,
            opacity: exporting ? 0.7 : 1,
          }}
        >
          <Download size={12} />
          {exporting ? "Exporting…" : "Export XLSX"}
        </button>
      </div>

      {/* Summary KPIs */}
      {data && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 16 }}>
          {[
            { label: "Total Budget", value: data.totals.totals.budget, color: "#6B7280" },
            { label: "Total Forecast", value: data.totals.totals.forecast, color: "#2563EB" },
            { label: "Total Actual", value: data.totals.totals.actual, color: "#059669" },
            { label: "Variance", value: data.totals.totals.variance, color: data.totals.totals.variance >= 0 ? "#059669" : "#DC2626" },
          ].map(kpi => (
            <div
              key={kpi.label}
              style={{
                background: "white",
                border: "1px solid #E5E5DC",
                borderRadius: 8,
                padding: "12px 16px",
              }}
            >
              <div style={{ fontSize: 10, color: "#9CA3AF", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
                {kpi.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: kpi.color, fontVariantNumeric: "tabular-nums" }}>
                {fmt(kpi.value, true)}
              </div>
              {kpi.label === "Variance" && (
                <div style={{ fontSize: 10, color: kpi.color, marginTop: 2 }}>
                  {fmtPct(kpi.value, data.totals.totals.budget)} vs budget
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Error */}
      {error && (
        <div style={{ padding: 16, background: "#FFF0F0", border: "1px solid #FCA5A5", borderRadius: 8, color: "#DC2626", fontSize: 13 }}>
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
          Loading phasing data…
        </div>
      )}

      {/* Phasing table */}
      {data && data.projects.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", color: "#9CA3AF", fontSize: 13 }}>
          No projects found for FY {fyLabel(fyYear, fyStart)}
        </div>
      )}

      {data && data.projects.length > 0 && (
        <div
          style={{
            border: "1px solid #E5E5DC",
            borderRadius: 8,
            overflow: "auto",
            maxHeight: "calc(100vh - 380px)",
            position: "relative",
          }}
        >
          <table style={{ borderCollapse: "collapse", width: "max-content", minWidth: "100%" }}>
            <thead style={{ position: "sticky", top: 0, zIndex: 5 }}>
              {/* Month group row */}
              <tr>
                <th
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 6,
                    background: "#1A1A1A",
                    minWidth: 220,
                    padding: "8px 10px",
                    textAlign: "left",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "white",
                    borderRight: "2px solid #333",
                  }}
                >
                  Project
                </th>
                {!allExpanded && (
                  <>
                    <th style={collapsedThStyle}>Budget</th>
                    <th style={collapsedThStyle}>Forecast</th>
                    <th style={collapsedThStyle}>Actual</th>
                    <th style={collapsedThStyle}>Variance</th>
                    <th style={collapsedThStyle}></th>
                    {fyMonths.slice(1).map((m, i) => (
                      <th key={i} colSpan={4} style={{ background: "#1A1A1A", borderRight: "1px solid #333" }} />
                    ))}
                  </>
                )}
                {allExpanded && fyMonths.map((m, i) => <MonthGroupHeader key={i} month={m} />)}
                {allExpanded && (
                  <th
                    colSpan={4}
                    style={{
                      padding: "6px 8px",
                      textAlign: "center",
                      fontSize: 10,
                      fontWeight: 700,
                      background: "#111",
                      color: "#FFFFFF",
                      whiteSpace: "nowrap",
                      letterSpacing: "0.05em",
                    }}
                  >
                    FY Total
                  </th>
                )}
              </tr>

              {/* Sub-column headers */}
              {allExpanded && (
                <tr>
                  <th
                    style={{
                      position: "sticky",
                      left: 0,
                      zIndex: 6,
                      background: "#F5F5F0",
                      minWidth: 220,
                      padding: "4px 10px",
                      borderRight: "2px solid #E5E5DC",
                    }}
                  />
                  {fyMonths.map((_, mi) =>
                    METRICS.map(metric => <MetricSubHeader key={`${mi}-${metric}`} metric={metric} />)
                  )}
                  {METRICS.map(metric => (
                    <th
                      key={`grand-hdr-${metric}`}
                      style={{
                        padding: "4px 8px",
                        textAlign: "center",
                        fontSize: 9,
                        fontWeight: 700,
                        background: "#E8E8E0",
                        color: METRIC_COLORS[metric as keyof typeof METRIC_COLORS] as any,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {METRIC_LABELS[metric]}
                    </th>
                  ))}
                </tr>
              )}
            </thead>

            <tbody>
              {data.projects.map(proj => (
                <ProjectRow
                  key={proj.id}
                  proj={proj}
                  fyMonths={fyMonths}
                  expanded={expandedProjects.has(proj.id)}
                  onToggle={() => toggleProject(proj.id)}
                />
              ))}
            </tbody>

            <tfoot>
              <TotalsRow data={data} fyMonths={fyMonths} />
            </tfoot>
          </table>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

/* ─────────────────────────────────────────────────────── styles */

const selectStyle: React.CSSProperties = {
  padding: "5px 10px",
  fontSize: 12,
  border: "1px solid #E5E5DC",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  cursor: "pointer",
  fontFamily: "inherit",
};

const iconBtnStyle: React.CSSProperties = {
  width: 30,
  height: 30,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid #E5E5DC",
  borderRadius: 6,
  background: "white",
  cursor: "pointer",
  color: "#6B7280",
};

const textBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 5,
  padding: "6px 12px",
  fontSize: 12,
  fontWeight: 500,
  border: "1px solid #E5E5DC",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  cursor: "pointer",
  fontFamily: "inherit",
};

const collapsedThStyle: React.CSSProperties = {
  padding: "6px 10px",
  fontSize: 10,
  fontWeight: 600,
  background: "#1A1A1A",
  color: "#9CA3AF",
  textAlign: "right",
  minWidth: 90,
};
