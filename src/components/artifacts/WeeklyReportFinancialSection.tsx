// Drop this inside WeeklyReportEditor alongside RAG / summary sections.
// Receives financialContent (nullable) from the parent, which loads it server-side
// or fetches it from the current financial_plan artifact.
"use client";

import { useMemo } from "react";
import Link from "next/link";
import { TrendingUp, TrendingDown, AlertTriangle, ExternalLink, DollarSign, Minus } from "lucide-react";
import type { FinancialPlanContent } from "@/components/artifact/FinancialPlanEditor";
import { extractFinancialSnapshot, fmtMoney, fmtPct } from "@/lib/financial-plan-utils";

type Props = {
  financialContent: FinancialPlanContent | null;
  /** href to open the full financial plan artifact */
  financialPlanHref?: string;
};

// ── Inline RAG dot ────────────────────────────────────────────────────────────
function RagDot({ rag }: { rag: "red" | "amber" | "green" }) {
  const col = {
    red:   "bg-red-500",
    amber: "bg-amber-400",
    green: "bg-emerald-500",
  }[rag];
  return <span className={`inline-block w-2 h-2 rounded-full ${col} ring-2 ring-white shadow`} />;
}

// ── Trend icon ────────────────────────────────────────────────────────────────
function TrendIcon({ pct }: { pct: number | null }) {
  if (pct === null) return <Minus className="w-3.5 h-3.5 text-neutral-400" />;
  if (pct > 0) return <TrendingUp className="w-3.5 h-3.5 text-red-500" />;
  return <TrendingDown className="w-3.5 h-3.5 text-emerald-500" />;
}

// ── Main section ──────────────────────────────────────────────────────────────
export default function WeeklyReportFinancialSection({ financialContent, financialPlanHref }: Props) {
  const snap = useMemo(
    () => (financialContent ? extractFinancialSnapshot(financialContent) : null),
    [financialContent]
  );

  if (!snap) {
    return (
      <div className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50 px-5 py-6 text-center">
        <DollarSign className="w-5 h-5 text-neutral-300 mx-auto mb-2" />
        <p className="text-sm text-neutral-500 font-medium">No Financial Plan linked</p>
        <p className="text-xs text-neutral-400 mt-0.5">
          Create a{" "}
          {financialPlanHref ? (
            <Link href={financialPlanHref} className="underline text-blue-500 hover:text-blue-600">Financial Plan artifact</Link>
          ) : (
            "Financial Plan artifact"
          )}{" "}
          to surface budget data in this report.
        </p>
      </div>
    );
  }

  const { sym } = snap;
  const hasData = snap.approvedBudget > 0 || snap.totalForecast > 0;

  if (!hasData) {
    return (
      <div className="rounded-xl border border-neutral-100 bg-neutral-50 px-5 py-5 text-center">
        <p className="text-sm text-neutral-400">Financial plan exists but has no cost data yet.</p>
        {financialPlanHref && (
          <Link href={financialPlanHref} className="mt-2 inline-flex items-center gap-1 text-xs text-blue-500 hover:text-blue-600">
            Add cost lines <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-neutral-50 border-b border-neutral-100">
        <div className="flex items-center gap-2">
          <RagDot rag={snap.ragStatus} />
          <span className="text-sm font-semibold text-neutral-800">Financial Snapshot</span>
          <span className="text-xs text-neutral-400">{snap.currency}</span>
        </div>
        {financialPlanHref && (
          <Link
            href={financialPlanHref}
            className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-700 transition-colors"
          >
            Full plan <ExternalLink className="w-3 h-3" />
          </Link>
        )}
      </div>

      <div className="p-4 flex flex-col gap-4">
        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {
              label: "Approved Budget",
              value: fmtMoney(snap.approvedBudget, sym),
              sub: null,
              highlight: "neutral" as const,
            },
            {
              label: "Actual Spent",
              value: fmtMoney(snap.totalActual, sym),
              sub: snap.spentPct !== null ? `${snap.spentPct}% of budget` : null,
              highlight: "neutral" as const,
            },
            {
              label: "Forecast at Completion",
              value: fmtMoney(snap.totalForecast, sym),
              sub: snap.utilPct !== null ? `${snap.utilPct}% utilisation` : null,
              highlight: snap.overBudget ? "bad" as const : "good" as const,
            },
            {
              label: "Forecast Variance",
              value: snap.forecastVariance !== null
                ? `${snap.forecastVariance >= 0 ? "+" : ""}${fmtMoney(snap.forecastVariance, sym)}`
                : "—",
              sub: snap.forecastVariancePct !== null ? fmtPct(snap.forecastVariancePct, { sign: true }) : null,
              highlight: snap.forecastVariance === null
                ? "neutral" as const
                : snap.forecastVariance > 0 ? "bad" as const : "good" as const,
            },
          ].map((tile) => {
            const colors = { good: "text-emerald-700", bad: "text-red-600", neutral: "text-neutral-800" };
            return (
              <div key={tile.label} className="bg-neutral-50 rounded-lg px-3 py-2.5 border border-neutral-100">
                <div className="text-[11px] text-neutral-500 mb-1">{tile.label}</div>
                <div className={`text-base font-bold tabular-nums ${colors[tile.highlight]}`}>{tile.value}</div>
                {tile.sub && <div className="text-[11px] text-neutral-400 mt-0.5">{tile.sub}</div>}
              </div>
            );
          })}
        </div>

        {/* Spend bar */}
        {snap.approvedBudget > 0 && (
          <div className="flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-neutral-400">
              <span>Budget utilisation</span>
              <span className="flex items-center gap-1">
                <TrendIcon pct={snap.forecastVariancePct} />
                {snap.forecastVariancePct !== null
                  ? `${fmtPct(snap.forecastVariancePct, { sign: true })} vs budget`
                  : "No budget set"}
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-neutral-100 overflow-hidden">
              {/* forecast */}
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${snap.overBudget ? "bg-red-200" : "bg-emerald-100"}`}
                style={{ width: `${Math.min((snap.totalForecast / snap.approvedBudget) * 100, 100)}%` }}
              />
              {/* actual */}
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-blue-500"
                style={{ width: `${Math.min((snap.totalActual / snap.approvedBudget) * 100, 100)}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-neutral-400 tabular-nums">
              <span>{sym}0</span>
              <span>{fmtMoney(snap.approvedBudget, sym)}</span>
            </div>
          </div>
        )}

        {/* Over-budget alert */}
        {snap.overBudget && snap.forecastVariance !== null && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-xs text-red-700">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              <span className="font-semibold">Forecast over budget</span> by {fmtMoney(snap.forecastVariance, sym)}
              {snap.forecastVariancePct !== null && ` (${fmtPct(snap.forecastVariancePct, { sign: true })})`}.
              {snap.varianceNarrative && ` ${snap.varianceNarrative}`}
            </span>
          </div>
        )}

        {/* Change exposure */}
        {snap.totalExposure > 0 && (
          <div className="flex items-center gap-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-2.5">
            <div className="text-xs font-semibold text-amber-800 shrink-0">Change Exposure</div>
            <div className="flex items-center gap-4 text-xs ml-auto">
              <span className="text-blue-700 font-semibold">{fmtMoney(snap.approvedExposure, sym)} <span className="font-normal text-neutral-500">approved</span></span>
              <span className="text-amber-700 font-semibold">{fmtMoney(snap.pendingExposure, sym)} <span className="font-normal text-neutral-500">pending</span></span>
            </div>
          </div>
        )}

        {/* Top categories (compact) */}
        {snap.topCategories.length > 0 && (
          <div>
            <div className="text-[11px] font-semibold text-neutral-400 uppercase tracking-wide mb-2">Top Spend Categories</div>
            <div className="flex flex-wrap gap-2">
              {snap.topCategories.map((c) => (
                <div key={c.category} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-100 border border-neutral-200">
                  <span className="text-xs text-neutral-600 font-medium capitalize">
                    {c.category.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-neutral-400 tabular-nums">{fmtMoney(c.forecast, sym)}</span>
                  <span className="text-[11px] text-neutral-400">·</span>
                  <span className="text-[11px] text-neutral-500 tabular-nums">{c.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
