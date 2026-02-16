"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import "../lessons.css";

export default function LessonsInsights() {
  const { id } = useParams() as any;
  const [data, setData] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/lessons/insights?projectId=${encodeURIComponent(String(id))}`, { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => setData({ ok: false }));
  }, [id]);

  const cards = useMemo(() => {
    const t = data?.totals || {};
    return [
      { label: "Total lessons", value: t.lessons ?? 0 },
      { label: "AI generated", value: t.ai ?? 0 },
      { label: "Manual", value: t.manual ?? 0 },
    ];
  }, [data]);

  function renderMap(title: string, m: any) {
    const entries = Object.entries(m || {}).sort((a: any, b: any) => b[1] - a[1]);
    return (
      <div style={{ border: "1px solid rgba(0,0,0,.10)", borderRadius: 12, padding: 12, background: "#fff" }}>
        <div style={{ fontWeight: 700, marginBottom: 8 }}>{title}</div>
        {entries.length ? entries.map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid rgba(0,0,0,.06)" }}>
            <span className="pill gray">{k}</span>
            <span style={{ fontWeight: 700 }}>{String(v)}</span>
          </div>
        )) : <div style={{ color: "#666" }}>—</div>}
      </div>
    );
  }

  return (
    <div className="lessonsWrap">
      <div className="lessonsHeader">
        <div className="lessonsTitle">Lessons Insights</div>
        <a className="btn" href={`/projects/${String(id)}/lessons`}>Back</a>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12, marginBottom: 12 }}>
        {cards.map((c) => (
          <div key={c.label} style={{ border: "1px solid rgba(0,0,0,.10)", borderRadius: 12, padding: 12, background: "#fff" }}>
            <div style={{ color: "#666", fontWeight: 650, fontSize: 12 }}>{c.label}</div>
            <div style={{ fontWeight: 800, fontSize: 22 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
        {renderMap("By Category", data?.byCategory)}
        {renderMap("By Status", data?.byStatus)}
        {renderMap("By Severity", data?.bySeverity)}
        {renderMap("By Impact", data?.byImpact)}
      </div>

      <div style={{ marginTop: 12 }}>
        {renderMap("Monthly Trend", data?.monthlyTrend)}
      </div>
    </div>
  );
}
