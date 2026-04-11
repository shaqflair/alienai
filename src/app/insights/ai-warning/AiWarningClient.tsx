//src/insights/AiwarningClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";

// ─── Types ────────────────────────────────────────────────────────────────────

type ProjectMini = {
  id: string;
  title: string | null;
  project_code: string | number | null;
  client_name?: string | null;
};

type BlockedRow = {
  work_item_id: string;
  project_id: string;
  project?: ProjectMini;
  title: string;
  stage: string;
  due_date: string | null;
  status?: string | null;
  blocked_seconds_window: number;
  currently_blocked: boolean;
  last_block_event_at: string | null;
  last_block_reason: string | null;
};

type DrillOk = {
  ok: true;
  days: number;
  projects: string[];
  project_map: Record<string, ProjectMini>;
  data: {
    blocked: BlockedRow[];
    wip: { stage: string; count: number }[];
    dueSoon: any[];
    recentDone: any[];
  };
};

type DrillResp = { ok: false; error: string; meta?: any } | DrillOk;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDateUK(x: any) {
  if (!x) return "—";
  const s = String(x).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function fmtBlocked(secs: any) {
  const n = Number(secs);
  if (!Number.isFinite(n) || n <= 0) return "0h";
  const h = n / 3600;
  if (h < 1) return `${Math.round(n / 60)}m`;
  if (h < 48) return `${Math.round(h * 10) / 10}h`;
  return `${Math.round((h / 24) * 10) / 10}d`;
}

function projectLabel(p?: ProjectMini | null) {
  if (!p) return "—";
  const code = p.project_code != null && String(p.project_code).trim() ? String(p.project_code).trim() : null;
  const title = p.title?.trim() || null;
  if (title && code) return `${title} (${code})`;
  return title || code || "—";
}

function stageLabel(s: any) {
  return String(s ?? "").trim().replaceAll("_", " ") || "—";
}

function pct(x: number, total: number) {
  if (!total) return 0;
  return Math.round((x / total) * 10) / 10;
}

function maxStage(rows: { stage: string; count: number }[]) {
  if (!rows?.length) return null;
  return rows.reduce((best, r) => ((r?.count || 0) > (best?.count || 0) ? r : best), rows[0]);
}

function nowUK() {
  return new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Divider() {
  return <div style={{ borderTop: "1px solid #e2e0d8", margin: "0" }} />;
}

function StatusPip({ level }: { level: "critical" | "warning" | "stable" }) {
  const colours = {
    critical: "#c0392b",
    warning: "#d97706",
    stable: "#16a34a",
  } as const;
  return (
    <span
      style={{
        display: "inline-block",
        width: 10,
        height: 10,
        borderRadius: "50%",
        background: colours[level],
        boxShadow: `0 0 0 3px ${colours[level]}22`,
        flexShrink: 0,
      }}
    />
  );
}

function KpiCell({
  label, value, sub, accent,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "danger" | "warn" | "ok" | "neutral";
}) {
  const valueColor =
    accent === "danger" ? "#c0392b" :
    accent === "warn"   ? "#b45309" :
    accent === "ok"     ? "#15803d" :
    "#1c1917";

  return (
    <div style={{ padding: "20px 24px", borderRight: "1px solid #e2e0d8" }}>
      <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: "0.08em", textTransform: "uppercase", color: "#78716c", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ fontSize: 36, fontWeight: 700, lineHeight: 1, color: valueColor, fontFamily: "'Georgia', 'Times New Roman', serif" }}>
        {value}
      </div>
      {sub && <div style={{ fontSize: 12, color: "#a8a29e", marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

function SectionHead({ title, count }: { title: string; count?: number }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "20px 24px 12px" }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: "#78716c" }}>
        {title}
      </div>
      {count !== undefined && (
        <div style={{ fontSize: 11, color: "#a8a29e" }}>{count} items</div>
      )}
    </div>
  );
}

function BlockedItem({ row }: { row: BlockedRow }) {
  const urgent = row.currently_blocked;
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr auto",
      alignItems: "start",
      gap: 12,
      padding: "14px 24px",
      borderBottom: "1px solid #f0ede6",
      background: urgent ? "#fffbeb" : "transparent",
    }}>
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
          {urgent && <StatusPip level="critical" />}
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1c1917" }}>{row.title || "Untitled"}</span>
        </div>
        <div style={{ fontSize: 12, color: "#78716c", display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span>Project: {projectLabel(row.project)}</span>
          <span>Stage: {stageLabel(row.stage)}</span>
          {row.due_date && <span>Due: {fmtDateUK(row.due_date)}</span>}
          {row.last_block_reason && <span>Reason: {row.last_block_reason}</span>}
        </div>
      </div>
      <div style={{ textAlign: "right", flexShrink: 0 }}>
        <div style={{
          fontSize: 13,
          fontWeight: 700,
          color: urgent ? "#c0392b" : "#b45309",
          fontFamily: "'Georgia', 'Times New Roman', serif",
        }}>
          {fmtBlocked(row.blocked_seconds_window)}
        </div>
        <div style={{ fontSize: 11, color: "#a8a29e" }}>blocked</div>
      </div>
    </div>
  );
}

function WipBar({ stage, count, total }: { stage: string; count: number; total: number }) {
  const share = total ? (count / total) : 0;
  const isHeavy = share >= 0.4;
  return (
    <div style={{ padding: "10px 24px", borderBottom: "1px solid #f0ede6" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 13, color: "#1c1917" }}>{stageLabel(stage)}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: isHeavy ? "#b45309" : "#44403c" }}>
          {count} <span style={{ fontWeight: 400, color: "#a8a29e", fontSize: 11 }}>({Math.round(share * 100)}%)</span>
        </span>
      </div>
      <div style={{ height: 4, background: "#f0ede6", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%",
          width: `${Math.round(share * 100)}%`,
          background: isHeavy ? "#d97706" : "#44403c",
          borderRadius: 2,
          transition: "width 0.6s ease",
        }} />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function AiWarningClient({ days }: { days: 7 | 14 | 30 | 60 }) {
  const [data, setData] = useState<DrillResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(`/api/ai/flow-warning/drilldown?days=${days}`, { cache: "no-store" })
      .then(async (res) => {
        const ct = res.headers.get("content-type") || "";
        if (!ct.includes("application/json")) {
          const txt = await res.text();
          if (!cancelled) setData({ ok: false, error: `Non-JSON response: ${txt.slice(0, 120)}` });
          return;
        }
        const j = await res.json() as DrillResp;
        if (!cancelled) setData(j);
      })
      .catch((e) => { if (!cancelled) setData({ ok: false, error: String(e?.message || e || "Failed") }); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [days]);

  const ok = data && (data as any).ok === true;
  const d = ok ? data as DrillOk : null;

  const analysis = useMemo(() => {
    if (!d) return null;

    const blocked = d.data.blocked || [];
    const wip = d.data.wip || [];
    const dueSoon = d.data.dueSoon || [];
    const recentDone = d.data.recentDone || [];

    const blockedNow = blocked.filter((b) => b.currently_blocked).length;
    const blockedAny = blocked.length;
    const wipTotal = wip.reduce((a, x) => a + (x.count || 0), 0);
    const top = maxStage(wip);
    const topShare = top ? pct(top.count || 0, wipTotal) : 0;

    const level: "critical" | "warning" | "stable" =
      blockedNow > 0 ? "critical" :
      blockedAny > 0 || topShare >= 40 ? "warning" :
      "stable";

    const verdict =
      level === "critical"
        ? `${blockedNow} item${blockedNow !== 1 ? "s" : ""} currently blocked. Immediate executive attention required.`
        : level === "warning"
        ? "No active blockers, but flow risk signals are present. Monitor closely."
        : "Portfolio flow is healthy. No blockers detected in this window.";

    const actions: string[] = [];
    if (blockedNow > 0) actions.push(`Resolve ${blockedNow} active blocker${blockedNow !== 1 ? "s" : ""} immediately`);
    if (top && topShare >= 40) actions.push(`Investigate WIP concentration in "${stageLabel(top.stage)}" (${Math.round(topShare)}% of open work)`);
    if (dueSoon.length > 0) actions.push(`Review ${dueSoon.length} item${dueSoon.length !== 1 ? "s" : ""} due within 30 days`);
    if (recentDone.length === 0) actions.push("Throughput is low — investigate delivery cadence");
    if (actions.length === 0) actions.push("Maintain current pace and review again next cycle");

    return { blocked, wip, dueSoon, recentDone, blockedNow, blockedAny, wipTotal, top, topShare, level, verdict, actions };
  }, [d]);

  // ─── Page shell ──────────────────────────────────────────────────────────────

  const shell: React.CSSProperties = {
    minHeight: "100vh",
    background: "#faf9f7",
    color: "#1c1917",
    fontFamily: "'Helvetica Neue', 'Arial', sans-serif",
    opacity: mounted ? 1 : 0,
    transition: "opacity 0.3s ease",
  };

  const card: React.CSSProperties = {
    background: "#ffffff",
    border: "1px solid #e2e0d8",
    borderRadius: 2,
    overflow: "hidden",
  };

  const levelColor = {
    critical: "#c0392b",
    warning: "#d97706",
    stable: "#15803d",
  } as const;

  const levelLabel = {
    critical: "CRITICAL",
    warning: "ADVISORY",
    stable: "STABLE",
  } as const;

  return (
    <div style={shell}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 32px 80px" }}>

        {/* ── Masthead ── */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <Link
                href="/insights"
                style={{ fontSize: 12, color: "#78716c", textDecoration: "none", letterSpacing: "0.04em" }}
              >
                ← INSIGHTS
              </Link>
              <span style={{ fontSize: 12, color: "#d6d3cc" }}>|</span>
              <span style={{ fontSize: 12, color: "#78716c", letterSpacing: "0.04em" }}>
                {days}-DAY WINDOW
              </span>
            </div>
            <span style={{ fontSize: 12, color: "#a8a29e" }}>{nowUK()}</span>
          </div>

          <h1 style={{
            fontSize: 38,
            fontWeight: 700,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
            color: "#1c1917",
            fontFamily: "'Georgia', 'Times New Roman', serif",
            margin: 0,
          }}>
            Delivery Intelligence Brief
          </h1>
          <p style={{ fontSize: 15, color: "#78716c", marginTop: 10, maxWidth: 580 }}>
            Portfolio-level flow analysis — blockers, bottlenecks, and near-term delivery risk for executive review.
          </p>
        </div>

        {/* ── Loading ── */}
        {loading && (
          <div style={{ ...card, padding: "40px 32px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "#78716c", letterSpacing: "0.06em" }}>
              LOADING INTELLIGENCE…
            </div>
          </div>
        )}

        {/* ── Error ── */}
        {!loading && data && (data as any).ok === false && (
          <div style={{ ...card, borderLeft: "4px solid #c0392b", padding: "24px 28px" }}>
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.06em", color: "#c0392b", marginBottom: 8 }}>
              DATA UNAVAILABLE
            </div>
            <div style={{ fontSize: 14, color: "#44403c" }}>{(data as any).error}</div>
          </div>
        )}

        {/* ── Main content ── */}
        {!loading && ok && analysis && (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

            {/* Status banner */}
            <div style={{
              ...card,
              borderLeft: `4px solid ${levelColor[analysis.level]}`,
              padding: "24px 28px",
              display: "flex",
              alignItems: "center",
              gap: 20,
            }}>
              <div style={{ flexShrink: 0 }}>
                <StatusPip level={analysis.level} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
                  <span style={{
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: "0.1em",
                    color: levelColor[analysis.level],
                  }}>
                    {levelLabel[analysis.level]}
                  </span>
                  <span style={{ fontSize: 11, color: "#d6d3cc" }}>•</span>
                  <span style={{ fontSize: 11, color: "#78716c", letterSpacing: "0.04em" }}>DELIVERY STATUS</span>
                </div>
                <div style={{ fontSize: 17, color: "#1c1917", fontWeight: 500, lineHeight: 1.4 }}>
                  {analysis.verdict}
                </div>
              </div>
            </div>

            {/* KPI strip */}
            <div style={{ ...card }}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
              }}>
                <KpiCell
                  label="Active Blockers"
                  value={analysis.blockedNow}
                  sub="currently blocked"
                  accent={analysis.blockedNow > 0 ? "danger" : "ok"}
                />
                <KpiCell
                  label="Blocked (Window)"
                  value={analysis.blockedAny}
                  sub={`in last ${days} days`}
                  accent={analysis.blockedAny > 0 ? "warn" : "neutral"}
                />
                <KpiCell
                  label="Open WIP"
                  value={analysis.wipTotal}
                  sub="items in flight"
                  accent="neutral"
                />
                <KpiCell
                  label="Due Soon"
                  value={analysis.dueSoon.length}
                  sub="next 30 days"
                  accent={analysis.dueSoon.length > 0 ? "warn" : "neutral"}
                />
              </div>
            </div>

            {/* Two-column layout */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 380px", gap: 20, alignItems: "start" }}>

              {/* Left — Active blockers */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
                <div style={card}>
                  <SectionHead title="Active Blockers" count={analysis.blockedNow + (analysis.blockedAny - analysis.blockedNow)} />
                  <Divider />
                  {analysis.blocked.length === 0 ? (
                    <div style={{ padding: "24px", fontSize: 14, color: "#78716c" }}>
                      No blocked items detected in this window.
                    </div>
                  ) : (
                    analysis.blocked
                      .sort((a, b) => (b.currently_blocked ? 1 : 0) - (a.currently_blocked ? 1 : 0))
                      .map((row) => <BlockedItem key={row.work_item_id} row={row} />)
                  )}
                </div>

                {/* Due soon */}
                {analysis.dueSoon.length > 0 && (
                  <div style={card}>
                    <SectionHead title="Due Within 30 Days" count={analysis.dueSoon.length} />
                    <Divider />
                    {analysis.dueSoon.slice(0, 8).map((item: any, i: number) => (
                      <div key={i} style={{ padding: "12px 24px", borderBottom: "1px solid #f0ede6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <div>
                          <div style={{ fontSize: 14, fontWeight: 500, color: "#1c1917" }}>{item?.title || "Untitled"}</div>
                          <div style={{ fontSize: 12, color: "#78716c", marginTop: 2 }}>
                            {item?.project_title || item?.project_code || "—"}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: "#b45309", fontWeight: 600, fontFamily: "'Georgia', serif" }}>
                          {fmtDateUK(item?.due_date)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Right column */}
              <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

                {/* Recommended actions */}
                <div style={{ ...card, borderTop: `3px solid ${levelColor[analysis.level]}` }}>
                  <SectionHead title="Executive Actions Required" />
                  <Divider />
                  <div style={{ padding: "8px 0 8px" }}>
                    {analysis.actions.map((action, i) => (
                      <div key={i} style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: 12,
                        padding: "12px 24px",
                        borderBottom: i < analysis.actions.length - 1 ? "1px solid #f0ede6" : "none",
                      }}>
                        <div style={{
                          flexShrink: 0,
                          width: 22,
                          height: 22,
                          borderRadius: "50%",
                          background: "#1c1917",
                          color: "#faf9f7",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 11,
                          fontWeight: 700,
                          marginTop: 1,
                        }}>
                          {i + 1}
                        </div>
                        <div style={{ fontSize: 14, color: "#1c1917", lineHeight: 1.5 }}>{action}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* WIP distribution */}
                <div style={card}>
                  <SectionHead title="WIP by Stage" count={analysis.wipTotal} />
                  <Divider />
                  {analysis.wip.length === 0 ? (
                    <div style={{ padding: "20px 24px", fontSize: 13, color: "#78716c" }}>No open items.</div>
                  ) : (
                    analysis.wip
                      .sort((a, b) => b.count - a.count)
                      .map((row) => (
                        <WipBar key={row.stage} stage={row.stage} count={row.count} total={analysis.wipTotal} />
                      ))
                  )}
                  {analysis.top && (
                    <div style={{ padding: "14px 24px", background: "#faf9f7", borderTop: "1px solid #e2e0d8" }}>
                      <span style={{ fontSize: 12, color: "#78716c" }}>
                        Largest concentration:{" "}
                        <strong style={{ color: analysis.topShare >= 40 ? "#b45309" : "#1c1917" }}>
                          {stageLabel(analysis.top.stage)} ({Math.round(analysis.topShare)}%)
                        </strong>
                        {analysis.topShare >= 40 && " — bottleneck risk"}
                      </span>
                    </div>
                  )}
                </div>

                {/* Throughput signal */}
                <div style={card}>
                  <SectionHead title="Throughput Signal" />
                  <Divider />
                  <div style={{ padding: "20px 24px" }}>
                    <div style={{
                      fontSize: 44,
                      fontWeight: 700,
                      lineHeight: 1,
                      color: analysis.recentDone.length > 0 ? "#15803d" : "#78716c",
                      fontFamily: "'Georgia', 'Times New Roman', serif",
                    }}>
                      {analysis.recentDone.length}
                    </div>
                    <div style={{ fontSize: 13, color: "#78716c", marginTop: 6 }}>
                      completions in last ~42 days
                    </div>
                    {analysis.recentDone.length === 0 && (
                      <div style={{ marginTop: 12, fontSize: 13, color: "#c0392b", lineHeight: 1.5 }}>
                        No recent completions recorded. Investigate delivery cadence.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>

            {/* Footer */}
            <div style={{ borderTop: "1px solid #e2e0d8", paddingTop: 20, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#a8a29e" }}>
                Data window: {days} days · Generated {nowUK()}
              </span>
              <div style={{ display: "flex", gap: 16 }}>
                {([7, 14, 30, 60] as const).map((d) => (
                  <Link
                    key={d}
                    href={`?days=${d}`}
                    style={{
                      fontSize: 12,
                      color: d === days ? "#1c1917" : "#a8a29e",
                      textDecoration: "none",
                      fontWeight: d === days ? 700 : 400,
                      letterSpacing: "0.04em",
                    }}
                  >
                    {d}D
                  </Link>
                ))}
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}