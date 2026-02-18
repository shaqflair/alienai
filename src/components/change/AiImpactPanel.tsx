"use client";

import React, { useMemo } from "react";
import type { AiImpact } from "@/lib/change/types";

/* ---------------- utils ---------------- */

function safeNum(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function fmtCurrency(n: number) {
  const v = safeNum(n, 0);
  try {
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      maximumFractionDigits: 0,
    }).format(v);
  } catch {
    return `£${v}`;
  }
}

type Tone = "high" | "med" | "low" | "none";

function toneFromRiskText(risk: string): Tone {
  const s = String(risk ?? "").toLowerCase();
  if (/(critical|sev\s*1|sev\s*2|high)/i.test(s)) return "high";
  if (/(medium|moderate)/i.test(s)) return "med";
  if (/(low|minor)/i.test(s)) return "low";
  return "none";
}

function toneLabel(t: Tone) {
  if (t === "high") return "High risk";
  if (t === "med") return "Medium risk";
  if (t === "low") return "Low risk";
  return "No risk flagged";
}

function toneClasses(t: Tone): string {
  if (t === "high") return "bg-rose-50 text-rose-700 border-rose-200";
  if (t === "med") return "bg-amber-50 text-amber-700 border-amber-200";
  if (t === "low") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-gray-50 text-gray-600 border-gray-200";
}

function barColor(t: Tone): string {
  if (t === "high") return "bg-rose-500";
  if (t === "med") return "bg-amber-500";
  if (t === "low") return "bg-emerald-500";
  return "bg-gray-300";
}

function barPct(t: Tone) {
  if (t === "high") return 88;
  if (t === "med") return 58;
  if (t === "low") return 28;
  return 10;
}

/* ---------------- component ---------------- */

export default function AiImpactPanel({
  days,
  cost,
  risk,
  onChange,
  onAiScan,
  aiBusy,
  disabled,
}: {
  days: number;
  cost: number;
  risk: string;
  onChange: (next: AiImpact) => void;
  onAiScan?: () => Promise<void> | void;
  aiBusy?: boolean;
  disabled?: boolean;
}) {
  const daysN = useMemo(() => safeNum(days, 0), [days]);
  const costN = useMemo(() => safeNum(cost, 0), [cost]);
  const tone = useMemo(() => toneFromRiskText(risk), [risk]);
  const canScan = !!onAiScan && !aiBusy && !disabled;

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold text-gray-900">AI Impact</h2>
        
        <div className="flex items-center gap-2">
          {onAiScan && (
            <button
              type="button"
              onClick={async () => {
                if (!onAiScan || aiBusy || disabled) return;
                await onAiScan();
              }}
              disabled={!canScan}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 text-xs font-medium rounded-full border border-indigo-200 hover:bg-indigo-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Ask AI to scan this change and propose impact/risk suggestions"
            >
              {aiBusy ? (
                <>
                  <div className="w-3 h-3 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                  Scanning…
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Run AI scan
                </>
              )}
            </button>
          )}
          
          <span 
            className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium border ${toneClasses(tone)}`}
            title="Quick summary badge (based on keywords in Risk summary)"
          >
            {toneLabel(tone)}
          </span>
        </div>
      </div>

      {/* Risk Signal Bar */}
      <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 space-y-3">
        <div className="flex justify-between items-center">
          <span className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Risk signal</span>
          <span className="text-xs font-medium text-gray-500">{barPct(tone)}%</span>
        </div>
        
        <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
          <div 
            className={`h-full rounded-full transition-all duration-500 ${barColor(tone)}`}
            style={{ width: `${barPct(tone)}%` }}
          />
        </div>
        
        <p className="text-xs text-gray-500">
          Keep this short: level + why + mitigation (owner optional).
        </p>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Estimated delay
          </div>
          <div className="text-2xl font-bold text-gray-900">{daysN} <span className="text-sm font-normal text-gray-500">days</span></div>
          <p className="text-xs text-gray-500 mt-1">Schedule impact</p>
        </div>

        <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
          <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
            Estimated cost
          </div>
          <div className="text-2xl font-bold text-gray-900">{fmtCurrency(costN)}</div>
          <p className="text-xs text-gray-500 mt-1">Budget impact</p>
        </div>
      </div>

      {/* Risk Summary */}
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">Risk summary</label>
        <textarea
          rows={4}
          value={risk ?? ""}
          onChange={(e) => onChange({ days: daysN, cost: costN, risk: e.target.value })}
          placeholder="e.g., Medium: misconfiguration risk if approvals are rushed"
          disabled={!!disabled}
          className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50 resize-y"
        />
      </div>

      {/* Edit Numbers */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Update days</label>
          <input
            type="text"
            inputMode="numeric"
            value={String(daysN)}
            onChange={(e) => onChange({ days: safeNum(e.target.value, 0), cost: costN, risk: risk ?? "" })}
            placeholder="0"
            disabled={!!disabled}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">Update cost (£)</label>
          <input
            type="text"
            inputMode="numeric"
            value={String(costN)}
            onChange={(e) => onChange({ days: daysN, cost: safeNum(e.target.value, 0), risk: risk ?? "" })}
            placeholder="0"
            disabled={!!disabled}
            className="w-full px-3 py-2 bg-white border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
