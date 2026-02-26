"use client";

import { useMemo } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, AlertTriangle, ExternalLink, DollarSign } from "lucide-react";
import type { FinancialPlanContent } from "@/components/artifact/FinancialPlanEditor";
import { extractFinancialSnapshot, fmtMoney, fmtPct, type FinancialSnapshot } from "@/lib/financial-plan-utils";

// ── Types ─────────────────────────────────────────────────────────────────────

type Props = {
  /** content_json from the financial_plan artifact */
  financialContent: FinancialPlanContent | null;
  /** href to the artifact detail page */
  artifactHref?: string;
  /** optional project name for header */
  projectName?: string;
  /** compact mode for dashboard grid */
  compact?: boolean;
};

// ── RAG pill ──────────────────────────────────────────────────────────────────

function RagPill({ rag }: { rag: "red" | "amber" | "green" }) {
  const map = {
    red:   { label: "Over Budget",   cls: "bg-red-100 text-red-700 border-red-200" },
    amber: { label: "Watch",         cls: "bg-amber-100 text-amber-700 border-amber-200" },
    green: { label: "On Track",      cls: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  }[rag];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border ${map.cls}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${rag === "red" ? "bg-red-500" : rag === "amber" ? "bg-amber-400" : "bg-emerald-500"}`} />
      {map.label}
    </span>
  );
}

// ── Spend bar ─────────────────────────────────────────────────────────────────

function SpendBar({ actual, forecast, budget }: { actual: number; forecast: number; budget: number }) {
  if (!budget) return null;
  const spentPct    = Math.min((actual / budget) * 100, 100);
  const forecastPct = Math.min((forecast / budget) * 100, 110); // allow slight overflow
  const over = forecast > budget;

  return (
    <div className="relative">
      <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
        {/* forecast track */}
        <div
          className={`absolute top-0 left-0 h-2 rounded-full transition-all ${over ? "bg-red-200" : "bg-emerald-100"}`}
          style={{ width: `${Math.min(forecastPct, 100)}%` }}
        />
        {/* actual spend */}
        <div
          className="absolute top-0 left-0 h-2 rounded-full bg-blue-500 transition-all"
          style={{ width: `${spentPct}%` }}
        />
      </div>
      {/* budget marker */}
      <div className="absolute top-0 left-full h-2 w-0.5 bg-neutral-400 -translate-x-px" style={{ left: "100%" }} />
    </div>
  );
}

// ── Category bar chart ────────────────────────────────────────────────────────

const CATEGORY_DISPLAY: Record<string, string> = {
  people:            "People",
  tools_licences:    "Tools",
  infrastructure:    "Infra",
  external_vendors:  "Vendors",
  travel:            "Travel",
  contingency:       "Contingency",
  other:             "Other",
};

const CATEGORY_COLORS = ["bg-blue-500", "bg-violet-500", "bg-amber-500", "bg-emerald-500"];

function CategoryBreakdown({ categories }: { categories: FinancialSnapshot["topCategories"]; sym: string }) {
  if (categories.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {categories.map((c, i) => (
        <div key={c.category} className="flex items-center gap-2">
          <div className="w-20 shrink-0">
            <span className="text-xs text-neutral-500 truncate">
              {CATEGORY_DISPLAY[c.category] ?? c.category}
            </span>
          </div>
          <div className="flex-1 h-1.5 rounded-full bg-neutral-100 overflow-hidden">
            <div
              className={`h-1.5 rounded-full ${CATEGORY_COLORS[i % CATEGORY_COLORS.length]} transition-all`}
              style={{ width: `${c.pct}%` }}
            />
          </div>
          <span className="text-xs text-neutral-500 w-8 text-right tabular-nums">{c.pct}%</span>
        </div>
      ))}
    </div>
  );
}

// ── Stat tile ─────────────────────────────────────────────────────────────────

function StatTile({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "good" | "bad" | "warn" | "neutral" }) {
  const colors = {
    good:    "text-emerald-700",
    bad:     "text-red-600",
    warn:    "text-amber-600",
    neutral: "text-neutral-800",
  };
  return (
    <div className="bg-white rounded-xl border border-neutral-100 px-4 py-3">
      <div className="text-[11px] text-neutral-500 font-medium uppercase tracking-wide mb-1">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${colors[highlight ?? "neutral"]}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ artifactHref }: { artifactHref?: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-neutral-200 bg-neutral-50 px-6 py-10 flex flex-col items-center gap-3 text-center">
      <div className="w-10 h-10 rounded-xl bg-neutral-100 flex items-center justify-center">
        <DollarSign className="w-5 h-5 text-neutral-400" />
      </div>
      <div>
        <p className="text-sm font-semibold text-neutral-700">No Financial Plan</p>
        <p className="text-xs text-neutral-400 mt-0.5">Create a Financial Plan artifact to see budget metrics here</p>
      </div>
      {artifactHref && (
        <Link
          href={artifactHref}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-semibold hover:bg-neutral-800 transition-colors"
        >
          Create Financial Plan
        </Link>
      )}
    </div>
  );
}

// ── Main widget ───────────────────────────────────────────────────────────────

export default function FinancialDashboardWidget({ financialContent, artifactHref, projectName, compact = false }: Props) {
  const snap = useMemo(
    () => (financialContent ? extractFinancialSnapshot(financialContent) : null),
    [financialContent]
  );

  if (!snap) return <EmptyState artifactHref={artifactHref} />;

  const { sym } = snap;
  const hasData = snap.approvedBudget > 0 || snap.totalForecast > 0;

  return (
    <div className="rounded-2xl border border-neutral-200 bg-white overflow-hidden shadow-sm">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-neutral-100 bg-neutral-50">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-neutral-900 flex items-center justify-center">
            <DollarSign className="w-3.5 h-3.5 text-white" />
          </div>
          <div>
            <span className="text-sm font-bold text-neutral-900">Financial Plan</span>
            {projectName && <span className="ml-2 text-xs text-neutral-400">{projectName}</span>}
          </div>
          {hasData && <RagPill rag={snap.ragStatus} />}
        </div>

        {artifactHref && (
          <Link
            href={artifactHref}
            className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-neutral-900 transition-colors"
          >
            Open <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>

      <div className="p-5 flex flex-col gap-5">
        {!hasData ? (
          <p className="text-sm text-neutral-400 text-center py-4">Add cost lines to see financial metrics.</p>
        ) : (
          <>
            {/* ── KPI tiles ── */}
            <div className={`grid gap-3 ${compact ? "grid-cols-2" : "grid-cols-2 md:grid-cols-4"}`}>
              <StatTile
                label="Approved Budget"
                value={fmtMoney(snap.approvedBudget, sym)}
                sub="total approved"
                highlight="neutral"
              />
              <StatTile
                label="Actual Spent"
                value={fmtMoney(snap.totalActual, sym)}
                sub={snap.spentPct !== null ? `${snap.spentPct}% of budget` : undefined}
                highlight="neutral"
              />
              <StatTile
                label="Total Forecast"
                value={fmtMoney(snap.totalForecast, sym)}
                sub={snap.utilPct !== null ? `${snap.utilPct}% utilisation` : undefined}
                highlight={snap.overBudget ? "bad" : "good"}
              />
              <StatTile
                label="Forecast Variance"
                value={snap.forecastVariance !== null ? fmtMoney(Math.abs(snap.forecastVariance), sym) : "—"}
                sub={
                  snap.forecastVariancePct !== null
                    ? `${snap.forecastVariancePct > 0 ? "over" : "under"} by ${Math.abs(snap.forecastVariancePct).toFixed(1)}%`
                    : undefined
                }
                highlight={snap.forecastVariance === null ? "neutral" : snap.forecastVariance > 0 ? "bad" : "good"}
              />
            </div>

            {/* ── Spend bar ── */}
            {snap.approvedBudget > 0 && (
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between text-xs text-neutral-500">
                  <span>Budget utilisation</span>
                  <div className="flex items-center gap-3">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" /> Actual</span>
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-200 inline-block" /> Forecast</span>
                  </div>
                </div>
                <SpendBar actual={snap.totalActual} forecast={snap.totalForecast} budget={snap.approvedBudget} />
                <div className="flex justify-between text-[11px] text-neutral-400 tabular-nums">
                  <span>{sym}0</span>
                  <span>{fmtMoney(snap.approvedBudget, sym)}</span>
                </div>
              </div>
            )}

            {/* ── Variance alert ── */}
            {snap.overBudget && snap.forecastVariance !== null && (
              <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3.5 py-2.5 text-sm text-red-700">
                <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <div>
                  <span className="font-semibold">Forecast exceeds budget</span> by{" "}
                  <span className="font-bold">{fmtMoney(snap.forecastVariance, sym)}</span>
                  {snap.forecastVariancePct !== null && ` (${fmtPct(snap.forecastVariancePct, { sign: true })})`}.
                  {snap.varianceNarrative && (
                    <p className="text-xs mt-1 text-red-600 opacity-80">{snap.varianceNarrative}</p>
                  )}
                </div>
              </div>
            )}

            {/* ── Change exposure ── */}
            {(snap.pendingExposure > 0 || snap.approvedExposure > 0) && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                <div className="text-xs font-semibold text-amber-800 uppercase tracking-wide mb-2">Change Exposure</div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div>
                    <div className="text-sm font-bold text-blue-700">{fmtMoney(snap.approvedExposure, sym)}</div>
                    <div className="text-[11px] text-neutral-500">Approved</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-amber-700">{fmtMoney(snap.pendingExposure, sym)}</div>
                    <div className="text-[11px] text-neutral-500">Pending</div>
                  </div>
                  <div>
                    <div className="text-sm font-bold text-neutral-800">{fmtMoney(snap.totalExposure, sym)}</div>
                    <div className="text-[11px] text-neutral-500">Total</div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Top categories ── */}
            {!compact && snap.topCategories.length > 0 && (
              <div>
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2.5">Forecast by Category</div>
                <CategoryBreakdown categories={snap.topCategories} sym={sym} />
              </div>
            )}

            {/* ── Summary ── */}
            {snap.summary && !compact && (
              <div className="rounded-xl bg-neutral-50 border border-neutral-100 px-4 py-3">
                <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-1">PM Summary</div>
                <p className="text-xs text-neutral-700 leading-relaxed">{snap.summary}</p>
              </div>
            )}

            {/* ── Footer ── */}
            {snap.lastUpdatedAt && (
              <div className="text-[11px] text-neutral-400 text-right">
                Updated {new Date(snap.lastUpdatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
