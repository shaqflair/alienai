"use client";
import React, { useMemo } from "react";

function clamp(n: number, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
}
function strokeFor(v: number) {
  if (v >= 75) return "rgba(var(--ai-bad), 0.9)";
  if (v >= 45) return "rgba(var(--ai-warn), 0.9)";
  return "rgba(var(--ai-good), 0.9)";
}

function Ring({ value, title }: { value: number; title: string }) {
  const v = clamp(value);
  const r = 12;
  const c = 2 * Math.PI * r;
  const dash = (v / 100) * c;

  const stroke = strokeFor(v);

  return (
    <div className="aiGauge" title={`${title}: ${v}%`}>
      <svg viewBox="0 0 34 34" aria-hidden>
        <circle cx="17" cy="17" r={r} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth="3" />
        <circle
          cx="17"
          cy="17"
          r={r}
          fill="none"
          stroke={stroke}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c - dash}`}
          transform="rotate(-90 17 17)"
        />
      </svg>
    </div>
  );
}

export default function ImpactMiniGauges({
  schedule = 0,
  cost = 0,
  scope = 0,
}: {
  schedule?: number; // 0-100
  cost?: number;
  scope?: number;
}) {
  const v = useMemo(() => ({ schedule, cost, scope }), [schedule, cost, scope]);
  return (
    <div className="aiGauges" aria-label="Impact gauges">
      <div style={{ position: "relative" }}>
        <Ring value={v.schedule} title="Schedule" />
        <div className="aiGaugeLabel">Sch</div>
      </div>
      <div style={{ position: "relative" }}>
        <Ring value={v.cost} title="Cost" />
        <div className="aiGaugeLabel">£</div>
      </div>
      <div style={{ position: "relative" }}>
        <Ring value={v.scope} title="Scope" />
        <div className="aiGaugeLabel">Scp</div>
      </div>
    </div>
  );
}
