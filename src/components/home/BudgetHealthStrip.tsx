"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  TrendingUp, TrendingDown, Minus, AlertTriangle,
  DollarSign, Sparkles, ArrowUpRight, Target,
  BarChart3, ShieldAlert, Eye,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

type RagLetter = "G" | "A" | "R";

type FinancialPlanSummary =
  | { ok: false; error: string }
  | {
      ok: true;
      total_approved_budget?: number | null;
      total_spent?: number | null;
      variance_pct?: number | null;
      pending_exposure_pct?: number | null;
      rag: "G" | "A" | "R";
      currency?: string | null;
      project_ref?: string | null;
      artifact_id?: string | null;
      project_count?: number;
    };

type Props = {
  summary: FinancialPlanSummary | null;
  loading: boolean;
  projectRef: string;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function num(x: any, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }

function fmtBudget(value: number | null | undefined, currency = "GBP"): string {
  const v = Number(value);
  if (!Number.isFinite(v)) return "—";
  const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "AUD" ? "A$" : "C$";
  if (Math.abs(v) >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (Math.abs(v) >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}k`;
  return `${sym}${v.toFixed(0)}`;
}

function ragColors(r: RagLetter) {
  if (r === "G") return { bar: "#10b981", text: "text-emerald-600", bg: "bg-emerald-50", border: "border-emerald-200", badge: "bg-emerald-100 text-emerald-700 border-emerald-200", label: "On Budget", glow: "rgba(16,185,129,0.25)" };
  if (r === "A") return { bar: "#f59e0b", text: "text-amber-600", bg: "bg-amber-50", border: "border-amber-200", badge: "bg-amber-100 text-amber-700 border-amber-200", label: "Watch", glow: "rgba(245,158,11,0.25)" };
  return { bar: "#f43f5e", text: "text-rose-600", bg: "bg-rose-50", border: "border-rose-200", badge: "bg-rose-100 text-rose-700 border-rose-200", label: "Over Budget", glow: "rgba(244,63,94,0.25)" };
}

// ── Stat cell ─────────────────────────────────────────────────────────────────

function StatCell({
  label, value, sub, accent, icon, large,
}: {
  label: string; value: string; sub?: string;
  accent?: string; icon?: React.ReactNode; large?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
        {icon && <span className="opacity-60">{icon}</span>}
        {label}
      </div>
      <div
        className={`font-bold tabular-nums leading-none ${large ? "text-3xl" : "text-xl"}`}
        style={{ color: accent ?? "#0f172a", fontFamily: "var(--font-mono, 'DM Mono', monospace)" }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-slate-400 font-medium">{sub}</div>}
    </div>
  );
}

// ── Utilisation bar ───────────────────────────────────────────────────────────

function UtilBar({ spent, budget, rag }: { spent: number; budget: number; rag: RagLetter }) {
  const pct = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 110) : 0;
  const colors = ragColors(rag);
  const overrun = pct > 100;
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[10px] text-slate-400 font-semibold">
        <span>Spend utilisation</span>
        <span className={overrun ? "text-rose-600 font-bold" : "text-slate-500"}>{pct}%</span>
      </div>
      <div className="relative h-2.5 rounded-full overflow-hidden bg-slate-100">
        <div
          className="absolute top-0 left-0 h-full rounded-full opacity-30 transition-all duration-700"
          style={{ width: `${Math.min(pct, 100)}%`, background: colors.bar }}
        />
        <div
          className="absolute top-0 left-0 h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(pct * 0.72, 100)}%`,
            background: colors.bar,
            boxShadow: `0 0 8px ${colors.glow}`,
          }}
        />
        <div className="absolute top-0 right-0 h-full w-px bg-slate-300 opacity-60" style={{ right: "0%" }} />
      </div>
      <div className="flex justify-between text-[10px] text-slate-300 tabular-nums">
        <span>£0</span>
        <span>{fmtBudget(budget)}</span>
      </div>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyStrip({ onCta }: { onCta: () => void }) {
  return (
    <div
      className="w-full rounded-2xl border border-dashed border-slate-200 flex items-center gap-6 px-8 py-6"
      style={{ background: "linear-gradient(135deg, rgba(248,250,255,0.9), rgba(243,246,255,0.8))" }}
    >
      <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center flex-shrink-0">
        <DollarSign className="w-5 h-5 text-slate-400" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-slate-700">No Financial Plan linked</p>
        <p className="text-xs text-slate-400 mt-0.5">Create a Financial Plan artifact to track budget health across the portfolio here</p>
      </div>
      <button
        onClick={onCta}
        className="flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-colors"
      >
        Create Plan <ArrowUpRight className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

export default function BudgetHealthStrip({ summary, loading, projectRef }: Props) {
  const router = useRouter();

  const hasData = summary?.ok === true;
  const rag = (hasData ? (summary as any).rag : null) as RagLetter | null;
  const currency = hasData ? ((summary as any).currency || "GBP") : "GBP";
  const budget = hasData ? num((summary as any).total_approved_budget) : 0;
  const spent = hasData ? num((summary as any).total_spent) : 0;
  const variancePct = hasData ? num((summary as any).variance_pct) : null;
  const pendingExposurePct = hasData ? num((summary as any).pending_exposure_pct) : null;
  const projectCount = hasData ? ((summary as any).project_count ?? 1) : null;
  const artifactId = hasData ? (summary as any).artifact_id : null;

  const utilPct = budget > 0 ? Math.min(Math.round((spent / budget) * 100), 999) : null;
  const varianceAmt = budget > 0 && variancePct !== null ? (budget * variancePct) / 100 : null;

  const colors = rag ? ragColors(rag) : ragColors("G");

  const aiNarrative = useMemo(() => {
    if (!hasData || !rag) return "No financial data available.";
    if (rag === "G") return `Portfolio is tracking within approved limits. Utilisation at ${utilPct ?? "?"}% — no material overrun risk detected. Continue monitoring forecast vs actuals monthly.`;
    if (rag === "A") return `Budget at ${utilPct ?? "?"}% utilisation with ${variancePct !== null ? `${Math.abs(variancePct).toFixed(1)}% variance` : "variance"} flagged. Proactive review of cost lines recommended before forecast breaches approved ceiling.`;
    return `Forecast exceeds approved budget${variancePct !== null ? ` by ${Math.abs(variancePct).toFixed(1)}%` : ""}. Immediate CFO/sponsor escalation warranted. Identify cost reduction levers or secure supplementary budget approval.`;
  }, [hasData, rag, utilPct, variancePct]);

  function navigate() {
    if (artifactId) router.push(`/projects/${projectRef}/artifacts/${artifactId}?panel=intelligence`);
    else router.push(`/projects/${projectRef}/artifacts/new?type=FINANCIAL_PLAN`);
  }

  if (!hasData && !loading) {
    return (
      <section className="mb-6">
        <StripHeader />
        <EmptyStrip onCta={() => router.push(`/projects/${projectRef}/artifacts/new?type=FINANCIAL_PLAN`)} />
      </section>
    );
  }

  return (
    <section className="mb-6">
      <StripHeader />

      <div
        className="relative overflow-hidden rounded-2xl"
        style={{
          background: "linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(248,250,255,0.97) 100%)",
          border: `1.5px solid ${rag ? colors.bar + "44" : "rgba(226,232,240,0.8)"}`,
          boxShadow: `0 2px 8px rgba(0,0,0,0.04), 0 8px 32px ${rag ? colors.glow : "rgba(99,102,241,0.08)"}, 0 1px 0 rgba(255,255,255,1) inset`,
          backdropFilter: "blur(28px)",
        }}
      >
        <div
          className="absolute top-0 inset-x-0 h-[3px] rounded-t-2xl"
          style={{ background: rag ? `linear-gradient(90deg, transparent 0%, ${colors.bar} 20%, ${colors.bar} 80%, transparent 100%)` : "transparent" }}
        />

        <div
          className="absolute left-0 top-0 bottom-0 w-1 rounded-l-2xl"
          style={{ background: rag ? colors.bar : "#6366f1", boxShadow: `0 0 20px ${rag ? colors.glow : "rgba(99,102,241,0.3)"}` }}
        />

        <div className="pl-5 pr-6 py-5">
          {loading ? (
            <LoadingSkeleton />
          ) : (
            <div className="flex items-start gap-8 flex-wrap xl:flex-nowrap">
              <div className="flex items-center gap-4 flex-shrink-0">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center flex-shrink-0"
                  style={{
                    background: `linear-gradient(135deg, ${colors.bar}, ${colors.bar}cc)`,
                    boxShadow: `0 4px 20px ${colors.glow}, 0 1px 0 rgba(255,255,255,0.2) inset`,
                  }}
                >
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold uppercase tracking-widest ${colors.badge}`}>
                      <span className="w-1.5 h-1.5 rounded-full" style={{ background: colors.bar }} />
                      {colors.label}
                    </span>
                  </div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Budget Health</div>
                </div>
              </div>

              <div className="hidden xl:block w-px self-stretch bg-slate-100" />

              <div className="flex items-start gap-8 flex-wrap flex-1 min-w-0">
                <StatCell label="Approved Budget" value={fmtBudget(budget, currency)} sub="total authorised" icon={<Target className="w-3 h-3" />} large />
                <StatCell label="Actual Spent" value={fmtBudget(spent, currency)} sub={utilPct !== null ? `${utilPct}% of budget` : undefined} accent={utilPct && utilPct > 90 ? "#f43f5e" : "#0f172a"} icon={<BarChart3 className="w-3 h-3" />} large />
                <StatCell label="Forecast Variance" value={variancePct !== null ? `${variancePct > 0 ? "+" : ""}${variancePct.toFixed(1)}%` : "—"} sub={varianceAmt !== null ? `${varianceAmt > 0 ? "over" : "under"} by ${fmtBudget(Math.abs(varianceAmt), currency)}` : undefined} accent={variancePct === null ? "#64748b" : variancePct > 5 ? "#f43f5e" : variancePct > 0 ? "#f59e0b" : "#10b981"} icon={variancePct === null || variancePct === 0 ? <Minus className="w-3 h-3" /> : variancePct > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />} large />
              </div>

              <div className="hidden xl:block w-px self-stretch bg-slate-100" />

              {budget > 0 && (
                <div className="flex-shrink-0 w-52">
                  <UtilBar spent={spent} budget={budget} rag={rag ?? "G"} />
                </div>
              )}

              <div className="hidden xl:block w-px self-stretch bg-slate-100" />

              <div className="flex-1 min-w-[180px] max-w-xs">
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles className="w-3 h-3 text-amber-500" />
                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">AI Outlook</span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{aiNarrative}</p>
              </div>

              <div className="flex-shrink-0 flex flex-col gap-2 justify-center">
                <button
                  onClick={navigate}
                  className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-white text-xs font-bold transition-all hover:opacity-90 active:scale-95"
                  style={{
                    background: rag ? `linear-gradient(135deg, ${colors.bar}, ${colors.bar}cc)` : "linear-gradient(135deg, #6366f1, #4f46e5)",
                    boxShadow: `0 4px 14px ${rag ? colors.glow : "rgba(99,102,241,0.35)"}`,
                  }}
                >
                  <Eye className="w-3.5 h-3.5" />
                  {artifactId ? "View Plan" : "Create Plan"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function StripHeader() {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      <div className="h-4 w-0.5 rounded-full bg-emerald-500" style={{ boxShadow: "0 0 8px rgba(16,185,129,0.5)" }} />
      <span className="text-[11px] text-emerald-600 uppercase tracking-[0.22em] font-bold">Budget Health</span>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="flex items-center gap-8 animate-pulse">
      <div className="w-14 h-14 rounded-2xl bg-slate-200 flex-shrink-0" />
      <div className="flex gap-8 flex-1">
        {[0, 1, 2].map(i => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-2 w-16 bg-slate-200 rounded" />
            <div className="h-7 w-24 bg-slate-200 rounded" />
          </div>
        ))}
      </div>
    </div>
  );
}
