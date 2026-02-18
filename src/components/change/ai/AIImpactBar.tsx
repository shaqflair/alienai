"use client";
import React, { useMemo } from "react";

function clamp(n: number, a = 0, b = 100) {
  return Math.max(a, Math.min(b, n));
}

function colorFor(score: number) {
  // returns rgba(var(...), alpha)
  if (score >= 75) return "rgba(var(--ai-bad), 0.85)";
  if (score >= 45) return "rgba(var(--ai-warn), 0.85)";
  return "rgba(var(--ai-good), 0.85)";
}

export default function AIImpactBar({
  score,
  label = "AI Impact Score",
}: {
  score: number; // 0-100
  label?: string;
}) {
  const v = clamp(Number(score || 0));
  const fill = useMemo(() => ({ width: `${v}%`, background: colorFor(v) }), [v]);

  const band = v >= 75 ? "High" : v >= 45 ? "Medium" : "Low";

  return (
    <div className="aiImpactWrap" aria-label={`${label} ${v}%`}>
      <div className="aiImpactLabel">
        <span>{label}</span>
        <span style={{ color: "rgba(255,255,255,0.84)" }}>
          {v}% <span style={{ color: "rgba(255,255,255,0.58)" }}>({band})</span>
        </span>
      </div>
      <div className="aiImpactTrack">
        <div className="aiImpactFill" style={fill} />
      </div>
    </div>
  );
}
