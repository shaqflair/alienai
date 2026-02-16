"use client";

import React from "react";

type Severity = "ok" | "warning" | "critical";

export function WbsHealthBadge(props: { missing: number; total?: number; severity: Severity; impactPct?: number }) {
  const { missing, total, impactPct } = props;

  // ✅ Guardrail: if missing > 0, severity cannot be "ok"
  const sev: Severity =
    missing > 0 ? (props.severity === "critical" ? "critical" : "warning") : "ok";

  const label = missing <= 0 ? "Good" : sev === "critical" ? "Critical" : "Needs effort";

  const sub =
    missing <= 0
      ? "All items have estimated effort."
      : `${missing} WBS item(s) are missing estimated effort. Fill this to improve schedule and capacity accuracy.`;

  const cls =
    sev === "ok"
      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
      : sev === "warning"
      ? "bg-amber-50 text-amber-800 ring-1 ring-amber-200"
      : "bg-rose-50 text-rose-800 ring-1 ring-rose-200";

  const dot =
    sev === "ok" ? "bg-emerald-600" : sev === "warning" ? "bg-amber-500" : "bg-rose-600";

  return (
    <div className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold ${cls}`}
        title={sub}
      >
        {/* ✅ consistent dot (cleaner than emoji, matches enterprise UI) */}
        <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />

        <span>WBS {label}</span>

        {/* ✅ show missing count when non-zero (so it matches your tile story) */}
        {missing > 0 ? (
          <span className="ml-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold">
            {missing} missing
          </span>
        ) : null}

        {typeof impactPct === "number" && impactPct > 0 ? (
          <span className="ml-1 rounded-full bg-white/70 px-2 py-0.5 text-[11px] font-semibold">
            -{impactPct}% conf
          </span>
        ) : null}
      </span>

      {typeof total === "number" ? (
        <span className="text-xs text-muted-foreground">
          {missing}/{total} missing
        </span>
      ) : null}
    </div>
  );
}
