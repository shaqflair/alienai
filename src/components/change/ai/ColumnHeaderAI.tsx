"use client";
import React, { useEffect, useRef, useState } from "react";

export default function ColumnHeaderAI({
  title,
  count,
  hint,
}: {
  title: string;
  count: number;
  hint?: string;
}) {
  const [pulse, setPulse] = useState(false);
  const prev = useRef<number>(count);

  useEffect(() => {
    if (prev.current !== count) {
      setPulse(true);
      const t = setTimeout(() => setPulse(false), 240);
      prev.current = count;
      return () => clearTimeout(t);
    }
  }, [count]);

  return (
    <div className="aiColHead">
      <div className="aiColTitle" title={hint || title}>
        <span className="aiColGlow" aria-hidden />
        <span style={{ fontWeight: 650 }}>{title}</span>
        {hint ? <span style={{ color: "rgba(255,255,255,0.55)", fontSize: 12 }}>{hint}</span> : null}
      </div>
      <span className={`aiCountBadge ${pulse ? "aiCountPulse" : ""}`}>{count}</span>
    </div>
  );
}
