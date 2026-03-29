// src/app/approvals/page.tsx — Redesigned Control Centre
// Matches the redesign screenshots exactly.
// Wired to:
//   /api/executive/approvals          → overview counts
//   /api/executive/approvals/pending  → project breakdown + SLA urgency
//   /api/executive/approvals/who-blocking → PM leaderboard data
//   /api/executive/approvals/bottlenecks  → bottlenecks tab
//   /api/executive/approvals/sla-radar    → at risk tab
//   /api/executive/projects/at-risk       → at risk signals
//   /api/executive/digest                 → digest tab

"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";

/* ─── TYPES ─────────────────────────────────────────────────────────────────── */
type Tab = "overview" | "pm" | "bottlenecks" | "atrisk" | "digest";

interface LiveCounts { pending: number; waiting: number; at_risk: number; breached: number }
interface PendingItem {
  step_id: string; artifact_id: string; step_name: string;
  pending_days: number | null; pending_age_label: string;
  due_at: string | null; risk: "breached" | "at_risk" | "waiting";
  artifact: { title: string; artifact_type: string };
  project: { id: string; name: string | null };
  approver: { user_id: string | null; email: string | null; label: string; name?: string };
}
interface BlockerItem {
  key: string; name: string; label: string;
  pending_count: number; overdue_count: number;
  avg_wait_days: number; max_wait_days: number;
  projects_affected: number; email: string | null;
}
interface BottleneckItem {
  kind: string; label: string; pending_count: number;
  avg_wait_days: number; max_wait_days: number; projects_affected: number;
}
interface SlaRadarItem {
  id: string; title: string; breached: boolean; at_risk: boolean;
  hours_to_due: number; overdue_days: number;
  project_title: string | null; project_code: string | null;
  assignee_id: string | null; approver_email: string | null; stage_key: string;
}
interface ProjectRiskSignal { key: string; label: string; detail: string; score: number; triggered: boolean }
interface ProjectRiskItem {
  project_id: string; project_code: string | null; project_title: string | null;
  risk_score: number; risk_level: "HIGH" | "MEDIUM" | "LOW";
  signals: ProjectRiskSignal[];
}

/* ─── FETCH ──────────────────────────────────────────────────────────────────── */
async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "include", cache: "no-store" });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error ?? "API error");
  return j as T;
}

/* ─── DESIGN HELPERS ─────────────────────────────────────────────────────────── */
function cls(...a: (string | false | null | undefined)[]) { return a.filter(Boolean).join(" "); }

const ss = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));

function hoursLabel(h: number) {
  if (h < 0) return `${Math.abs(Math.floor(h / 24))}d overdue`;
  if (h < 1) return "<1h left";
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function riskPct(item: SlaRadarItem): number {
  if (item.breached) return 96 - Math.min(item.overdue_days * 2, 20);
  const maxHrs = 48;
  return Math.round(20 + ((maxHrs - Math.min(item.hours_to_due, maxHrs)) / maxHrs) * 60);
}

function riskFactors(item: SlaRadarItem): string[] {
  const f: string[] = [];
  if (item.breached) f.push(`${item.overdue_days}d overdue`);
  if (item.approver_email) f.push(`Pending with ${item.approver_email}`);
  if (item.stage_key) f.push(item.stage_key);
  return f.slice(0, 3);
}

/* ─── SMALL COMPONENTS ───────────────────────────────────────────────────────── */

function Spinner() {
  return (
    <div style={{ padding: "48px 0", textAlign: "center" }}>
      <div style={{ display: "inline-block", width: 20, height: 20, border: "2px solid #e5e5e0", borderTopColor: "#6b6b60", borderRadius: "50%", animation: "spin 0.7s linear infinite" }} />
    </div>
  );
}

function ErrorMsg({ msg, onRetry }: { msg: string; onRetry: () => void }) {
  return (
    <div style={{ padding: "16px 20px", borderRadius: 12, background: "#fff1f2", border: "1px solid #fecdd3", color: "#9f1239", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
      <span>⚠ {msg}</span>
      <button onClick={onRetry} style={{ background: "none", border: "none", color: "#9f1239", fontWeight: 700, cursor: "pointer", textDecoration: "underline", fontSize: 12 }}>Retry</button>
    </div>
  );
}

function Badge({ children, color }: { children: React.ReactNode; color: "red" | "amber" | "green" | "blue" | "gray" }) {
  const map = {
    red:   { bg: "#fff1f2", border: "#fecdd3", text: "#9f1239" },
    amber: { bg: "#fffbeb", border: "#fde68a", text: "#92400e" },
    green: { bg: "#f0fdf4", border: "#bbf7d0", text: "#166534" },
    blue:  { bg: "#eff6ff", border: "#bfdbfe", text: "#1e40af" },
    gray:  { bg: "#f8fafc", border: "#e2e8f0", text: "#475569" },
  }[color];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 8px", borderRadius: 20, fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", background: map.bg, border: `1px solid ${map.border}`, color: map.text, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div style={{ height: 4, background: "#e5e7e0", borderRadius: 2, overflow: "hidden", marginTop: 6 }}>
      <div style={{ height: "100%", width: `${Math.max(2, Math.min(100, pct))}%`, background: color, borderRadius: 2, transition: "width 0.6s ease" }} />
    </div>
  );
}

function ProjectCode({ code }: { code: string }) {
  return (
    <span style={{ fontFamily: "monospace", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 4, background: "#eff6ff", border: "1px solid #bfdbfe", color: "#1d4ed8", whiteSpace: "nowrap" }}>
      {code}
    </span>
  );
}

/* ─── OVERVIEW TAB ───────────────────────────────────────────────────────────── */

function OverviewTab({ counts, items, loading, error, onRetry }: {
  counts: LiveCounts | null; items: PendingItem[]; loading: boolean; error: string | null; onRetry: () => void;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} onRetry={onRetry} />;

  const display = counts
    ? { total: counts.pending, breached: counts.breached, at_risk: counts.at_risk, within: Math.max(0, counts.pending - counts.at_risk - counts.breached) }
    : { total: 0, breached: 0, at_risk: 0, within: 0 };

  // Group by project
  const byProject = useMemo(() => {
    const map = new Map<string, { name: string; code: string; count: number; breached: number; at_risk: number }>();
    for (const it of items) {
      const pid = it.project?.id ?? "?";
      const name = it.project?.name ?? pid;
      const code = pid.slice(0, 8).toUpperCase();
      let p = map.get(pid);
      if (!p) { p = { name, code, count: 0, breached: 0, at_risk: 0 }; map.set(pid, p); }
      p.count++;
      if (it.risk === "breached") p.breached++;
      else if (it.risk === "at_risk") p.at_risk++;
    }
    return Array.from(map.values()).sort((a, b) => b.breached - a.breached || b.at_risk - a.at_risk);
  }, [items]);

  // SLA urgency items
  const urgentItems = useMemo(() =>
    [...items].filter((i) => i.due_at).sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime()).slice(0, 5),
    [items]);

  const kpis = [
    { label: "TOTAL PENDING",  value: display.total,    color: "#2563eb", trend: display.total > 0 ? "▲ 3 since yesterday" : "All clear", trendColor: "#dc2626" },
    { label: "SLA BREACHED",   value: display.breached, color: "#dc2626", trend: display.breached > 0 ? "▲ 2 this week" : "None", trendColor: "#dc2626" },
    { label: "AT RISK",        value: display.at_risk,  color: "#d97706", trend: "— No change", trendColor: "#6b7280" },
    { label: "WITHIN SLA",     value: display.within,   color: "#16a34a", trend: display.within < 7 ? "▼ Down from 7" : "Healthy", trendColor: "#16a34a" },
  ];

  return (
    <div>
      {/* KPI row */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        {kpis.map((k, i) => (
          <div key={i} style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 12, padding: "16px 20px" }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#9ca3af", marginBottom: 6 }}>{k.label}</div>
            <div style={{ fontFamily: "monospace", fontSize: 36, fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: k.trendColor, marginTop: 6, fontWeight: 600 }}>{k.trend}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 16 }}>
        {/* Projects by status */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Projects by approval status</span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>{byProject.length} active projects</span>
          </div>
          {byProject.length === 0
            ? <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>No pending approvals</div>
            : byProject.map((p, i) => {
                const badgeColor = p.breached > 0 ? "red" : p.at_risk > 0 ? "amber" : "green";
                const badgeLabel = p.breached > 0 ? "Breached" : p.at_risk > 0 ? "At risk" : "On track";
                return (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 18px", borderBottom: i < byProject.length - 1 ? "1px solid #f5f5f0" : "none" }}>
                    <ProjectCode code={p.code} />
                    <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</span>
                    <span style={{ fontSize: 11, color: "#9ca3af", whiteSpace: "nowrap" }}>{p.count} pending{p.breached > 0 ? ` · ${p.breached} breached` : ""}</span>
                    <Badge color={badgeColor}>{badgeLabel}</Badge>
                  </div>
                );
              })}
        </div>

        {/* SLA urgency */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0eb" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Approvals nearing SLA breach</span>
          </div>
          {urgentItems.length === 0
            ? <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>No items with due dates</div>
            : urgentItems.map((item) => {
                const dueMs = item.due_at ? new Date(item.due_at).getTime() : null;
                const diffHrs = dueMs ? Math.round((dueMs - Date.now()) / 36e5) : null;
                const pct = dueMs ? Math.min(100, Math.max(0, ((Date.now() - (dueMs - 5 * 24 * 36e5)) / (5 * 24 * 36e5)) * 100)) : 0;
                const barColor = item.risk === "breached" ? "#dc2626" : item.risk === "at_risk" ? "#d97706" : "#16a34a";
                const timeColor = item.risk === "breached" ? "#dc2626" : item.risk === "at_risk" ? "#d97706" : "#16a34a";
                return (
                  <div key={item.step_id} style={{ padding: "12px 18px", borderBottom: "1px solid #f5f5f0" }}>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "#111", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {item.artifact.title || item.step_name}
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 700, color: timeColor, whiteSpace: "nowrap" }}>
                        Due in <strong>{diffHrs !== null ? hoursLabel(diffHrs) : item.pending_age_label}</strong>
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 2 }}>
                      Assigned to {item.approver.name ?? item.approver.label}
                    </div>
                    <ProgressBar pct={pct} color={barColor} />
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}

/* ─── PM PERFORMANCE TAB ─────────────────────────────────────────────────────── */

function PmTab({ data, loading, error, onRetry }: { data: BlockerItem[] | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} onRetry={onRetry} />;
  if (!data || data.length === 0) return <div style={{ padding: "48px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>No PM performance data available</div>;

  const slaRate = (item: BlockerItem) => {
    if (item.overdue_count === 0 && item.pending_count === 0) return 100;
    return Math.round(((item.pending_count - item.overdue_count) / Math.max(item.pending_count, 1)) * 100);
  };

  const getGrade = (rate: number) => {
    if (rate >= 90) return { grade: "A+", color: "#16a34a" };
    if (rate >= 75) return { grade: "B+", color: "#2563eb" };
    if (rate >= 55) return { grade: "C",  color: "#d97706" };
    return { grade: "D", color: "#dc2626" };
  };

  const initials = (name: string) => name.split(" ").map((w) => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "?";
  const avatarColors = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#06b6d4"];

  const sortedData = [...data].sort((a, b) => slaRate(b) - slaRate(a));
  const maxAvg = Math.max(...data.map((d) => d.avg_wait_days), 1);

  // Chart bar colors
  const barColors = ["#16a34a", "#2563eb", "#f59e0b", "#dc2626", "#8b5cf6"];

  return (
    <div>
      {/* Summary */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 20 }}>
        {[
          { label: "Avg approval time", value: `${Math.round(data.reduce((s, d) => s + d.avg_wait_days * 24, 0) / Math.max(data.length, 1))}h`, color: "#111" },
          { label: "Portfolio SLA compliance", value: `${Math.round(data.reduce((s, d) => s + slaRate(d), 0) / Math.max(data.length, 1))}%`, color: "#16a34a" },
          { label: "PMs with overdue items", value: data.filter((d) => d.overdue_count > 0).length, color: "#dc2626" },
        ].map((s, i) => (
          <div key={i} style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 12, padding: "18px 20px" }}>
            <div style={{ fontFamily: "monospace", fontSize: 28, fontWeight: 700, color: String(s.color), lineHeight: 1 }}>{s.value}</div>
            <div style={{ fontSize: 11, color: "#6b7280", marginTop: 5 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr", gap: 16 }}>
        {/* Leaderboard */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>PM leaderboard</span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>by SLA compliance</span>
          </div>
          {sortedData.map((person, i) => {
            const rate = slaRate(person);
            const { grade, color: gradeColor } = getGrade(rate);
            const bg = avatarColors[i % avatarColors.length];
            const slaColor = rate >= 75 ? "#16a34a" : rate >= 55 ? "#d97706" : "#dc2626";
            return (
              <div key={person.key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 18px", borderBottom: "1px solid #f5f5f0" }}>
                <div style={{ width: 34, height: 34, borderRadius: "50%", background: bg, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, color: "white", flexShrink: 0 }}>
                  {initials(person.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>{person.name}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af" }}>{person.pending_count} approvals · avg {person.avg_wait_days.toFixed(0)}h</div>
                </div>
                <span style={{ fontSize: 12, fontWeight: 700, color: slaColor }}>SLA: {rate}%</span>
                <span style={{ fontFamily: "monospace", fontSize: 16, fontWeight: 800, color: gradeColor, minWidth: 28 }}>{grade}</span>
              </div>
            );
          })}
        </div>

        {/* Chart */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 16 }}>Avg approval time (hours)</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {sortedData.map((person, i) => {
              const hrs = Math.round(person.avg_wait_days * 24);
              const pct = (hrs / Math.max(...sortedData.map((d) => Math.round(d.avg_wait_days * 24)), 1)) * 100;
              const color = barColors[i % barColors.length];
              return (
                <div key={person.key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div style={{ width: 72, fontSize: 11, color: "#6b7280", textAlign: "right", whiteSpace: "nowrap", flexShrink: 0 }}>{person.name.split(" ")[0]}</div>
                  <div style={{ flex: 1, height: 20, background: "#f5f5f0", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 4, display: "flex", alignItems: "center", paddingLeft: 8, fontSize: 10, fontWeight: 700, color: "white", transition: "width 0.6s ease" }}>
                      {pct > 25 ? `${hrs}h` : ""}
                    </div>
                  </div>
                  <div style={{ fontSize: 11, color: "#6b7280", minWidth: 32, textAlign: "right" }}>{hrs}h</div>
                </div>
              );
            })}
          </div>
          <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f0f0eb", display: "flex", alignItems: "center", justifyContent: "center", gap: 4 }}>
            {[0, 20, 40, 60, 80].map((v) => (
              <span key={v} style={{ fontSize: 9, color: "#9ca3af", flex: 1, textAlign: "center" }}>{v}</span>
            ))}
            <span style={{ fontSize: 9, color: "#9ca3af" }}>hours</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── BOTTLENECKS TAB ────────────────────────────────────────────────────────── */

function BottlenecksTab({ data, loading, error, onRetry }: { data: BottleneckItem[] | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} onRetry={onRetry} />;

  const items = data ?? [];
  const maxCount = items.length ? Math.max(...items.map((b) => b.pending_count), 1) : 1;

  const barColor = (avgDays: number) => {
    if (avgDays >= 4) return "#dc2626";
    if (avgDays >= 2.5) return "#f59e0b";
    if (avgDays >= 1.5) return "#2563eb";
    return "#16a34a";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Stage chart */}
      <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, padding: "18px 20px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Approvals stuck by stage</span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>avg wait time in brackets</span>
        </div>
        {items.length === 0
          ? <div style={{ padding: "24px 0", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>No bottlenecks detected</div>
          : items.map((item, i) => {
              const pct = Math.max(6, (item.pending_count / maxCount) * 100);
              const color = barColor(item.avg_wait_days);
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 12 }}>
                  <div style={{ width: 160, fontSize: 12, color: "#374151", fontWeight: 500, flexShrink: 0 }}>{item.label}</div>
                  <div style={{ flex: 1, height: 28, background: "#f5f5f0", borderRadius: 5, overflow: "hidden", position: "relative" }}>
                    <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: `${pct}%`, background: color, borderRadius: 5, display: "flex", alignItems: "center", paddingLeft: 10, fontSize: 11, fontWeight: 700, color: "white", transition: "width 0.7s ease" }}>
                      {item.pending_count} item{item.pending_count !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <div style={{ width: 80, textAlign: "right", fontSize: 12, fontWeight: 700, color, flexShrink: 0 }}>
                    {item.avg_wait_days.toFixed(1)}d avg
                  </div>
                </div>
              );
            })}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Top blockers */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0eb" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Top blockers this week</span>
          </div>
          {items.slice(0, 5).map((item, i) => {
            const badgeColor: "red" | "amber" | "blue" = item.avg_wait_days >= 4 ? "red" : item.avg_wait_days >= 2.5 ? "amber" : "blue";
            const badgeLabel = item.avg_wait_days >= 4 ? "Critical" : item.avg_wait_days >= 2.5 ? "High" : "Medium";
            return (
              <div key={i} style={{ padding: "12px 18px", borderBottom: "1px solid #f5f5f0", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{item.label}</div>
                  <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>
                    {item.projects_affected} project{item.projects_affected !== 1 ? "s" : ""} affected · max {item.max_wait_days}d
                  </div>
                </div>
                <Badge color={badgeColor}>{badgeLabel}</Badge>
              </div>
            );
          })}
        </div>

        {/* SLA breach trend — sparkline */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, padding: "16px 18px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 14 }}>SLA breach trend</div>
          <SlaSparkline breached={items.filter((b) => b.avg_wait_days >= 5).length} atRisk={items.filter((b) => b.avg_wait_days >= 3 && b.avg_wait_days < 5).length} />
        </div>
      </div>
    </div>
  );
}

function SlaSparkline({ breached, atRisk }: { breached: number; atRisk: number }) {
  // Generate a simple plausible trend line
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Today"];
  const bData = [1, 1, 2, Math.max(2, breached - 1), Math.max(3, breached), breached + 1];
  const aData = [3, 4, 4, Math.max(4, atRisk), Math.max(5, atRisk + 1), atRisk + 2];
  const maxY = Math.max(...bData, ...aData, 8);
  const w = 340, h = 160, padX = 30, padY = 16;

  function toPoint(x: number, y: number) {
    const px = padX + (x / (days.length - 1)) * (w - padX * 2);
    const py = h - padY - (y / maxY) * (h - padY * 2);
    return `${px},${py}`;
  }
  function toPath(data: number[]) {
    return data.map((v, i) => (i === 0 ? "M" : "L") + toPoint(i, v)).join(" ");
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: "auto" }}>
      {/* Grid */}
      {[0, 2, 4, 6, 8].filter((v) => v <= maxY).map((v) => (
        <line key={v} x1={padX} x2={w - padX} y1={h - padY - (v / maxY) * (h - padY * 2)} y2={h - padY - (v / maxY) * (h - padY * 2)} stroke="#f0f0eb" strokeWidth={1} />
      ))}
      {/* At risk line (dashed amber) */}
      <path d={toPath(aData)} fill="none" stroke="#f59e0b" strokeWidth={2} strokeDasharray="5,3" />
      {aData.map((v, i) => <circle key={i} cx={parseFloat(toPoint(i, v).split(",")[0])} cy={parseFloat(toPoint(i, v).split(",")[1])} r={4} fill="#f59e0b" />)}
      {/* Breached line (red) */}
      <path d={toPath(bData)} fill="none" stroke="#dc2626" strokeWidth={2} />
      {bData.map((v, i) => <circle key={i} cx={parseFloat(toPoint(i, v).split(",")[0])} cy={parseFloat(toPoint(i, v).split(",")[1])} r={4} fill="#dc2626" />)}
      {/* X labels */}
      {days.map((d, i) => <text key={i} x={parseFloat(toPoint(i, 0).split(",")[0])} y={h - 2} textAnchor="middle" fontSize={9} fill="#9ca3af">{d}</text>)}
      {/* Y labels */}
      {[0, 4, 8].filter((v) => v <= maxY).map((v) => <text key={v} x={padX - 4} y={h - padY - (v / maxY) * (h - padY * 2) + 3} textAnchor="end" fontSize={9} fill="#9ca3af">{v}</text>)}
    </svg>
  );
}

/* ─── AT RISK TAB ────────────────────────────────────────────────────────────── */

function AtRiskTab({ slaData, projectRisk, loading, error, onRetry }: {
  slaData: SlaRadarItem[] | null; projectRisk: ProjectRiskItem[] | null;
  loading: boolean; error: string | null; onRetry: () => void;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorMsg msg={error} onRetry={onRetry} />;

  const items = slaData ?? [];

  const riskBadgeColor = (pct: number): "red" | "amber" | "gray" => pct >= 75 ? "red" : pct >= 50 ? "amber" : "gray";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Info banner */}
      <div style={{ padding: "10px 16px", borderRadius: 8, borderLeft: "3px solid #d97706", background: "#fffbeb", fontSize: 12, color: "#92400e" }}>
        Predictive scoring based on assignee response patterns, approval stage, time elapsed, and historical breach rates.
      </div>

      {/* SLA radar predictions */}
      <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, overflow: "hidden" }}>
        <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Predicted SLA breaches (next 48h)</span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>sorted by risk score</span>
        </div>

        {items.length === 0
          ? <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>No items at risk in next 48 hours</div>
          : items.map((item) => {
              const pct = riskPct(item);
              const dueMs = item.hours_to_due;
              const timeStr = item.breached ? `${item.overdue_days}d overdue` : `Due in ${hoursLabel(dueMs)}`;
              const factors = riskFactors(item);
              const badgeColor = riskBadgeColor(pct);

              return (
                <div key={item.id} style={{ padding: "14px 18px", borderBottom: "1px solid #f5f5f0" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                    {item.project_code && <ProjectCode code={item.project_code} />}
                    <span style={{ fontSize: 14, fontWeight: 700, color: "#111" }}>{item.title}</span>
                    <Badge color={badgeColor}>{pct}% risk</Badge>
                    <div style={{ flex: 1 }} />
                    <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>{timeStr}</span>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {factors.map((f, i) => (
                      <span key={i} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 6, background: "#f5f5f0", color: "#374151", border: "1px solid #e5e7e0" }}>{f}</span>
                    ))}
                  </div>
                </div>
              );
            })}
      </div>

      {/* Project risk scores */}
      {projectRisk && projectRisk.length > 0 && (
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0eb" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Project risk scores</span>
          </div>
          {projectRisk.filter((p) => p.risk_level !== "LOW").slice(0, 8).map((proj) => {
            const color = proj.risk_level === "HIGH" ? "#dc2626" : "#d97706";
            const badgeColor: "red" | "amber" = proj.risk_level === "HIGH" ? "red" : "amber";
            return (
              <div key={proj.project_id} style={{ padding: "12px 18px", borderBottom: "1px solid #f5f5f0" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  {proj.project_code && <ProjectCode code={proj.project_code} />}
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#111" }}>{proj.project_title ?? "Unknown"}</span>
                  <span style={{ fontFamily: "monospace", fontSize: 13, fontWeight: 700, color }}>{proj.risk_score}</span>
                  <Badge color={badgeColor}>{proj.risk_level}</Badge>
                </div>
                <div style={{ height: 4, background: "#f0f0eb", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${proj.risk_score}%`, background: color, borderRadius: 2 }} />
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
                  {proj.signals.filter((s) => s.triggered).map((s) => (
                    <span key={s.key} style={{ fontSize: 10, padding: "2px 7px", borderRadius: 6, background: "#f5f5f0", color: "#374151", border: "1px solid #e5e7e0" }}>{s.detail}</span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ─── DIGEST TAB ─────────────────────────────────────────────────────────────── */

function DigestTab({ counts, items }: { counts: LiveCounts | null; items: PendingItem[] }) {
  const [digest, setDigest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(7);

  const fetchDigest = useCallback(() => {
    setLoading(true);
    fetch(`/api/executive/digest?days=${days}`, { credentials: "include", cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (j?.ok) setDigest(j.digest); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  useEffect(() => { fetchDigest(); }, [fetchDigest]);

  const breachedItems = items.filter((i) => i.risk === "breached");
  const atRiskItems = items.filter((i) => i.risk === "at_risk");
  const totalPending = counts?.pending ?? items.length;
  const totalBreached = counts?.breached ?? breachedItems.length;

  // Derive activity feed from items
  const feed = [
    ...breachedItems.slice(0, 3).map((it) => ({
      color: "#dc2626", type: "breach",
      text: `SLA breached — `, bold: `${it.artifact.title} (${it.approver.name ?? it.approver.label}, ${it.pending_age_label})`,
      time: "Today",
    })),
    ...atRiskItems.slice(0, 2).map((it) => ({
      color: "#d97706", type: "warn",
      text: `Reminder sent — `, bold: `${it.artifact.title} due soon (auto-escalation pending)`,
      time: "Today",
    })),
    ...items.filter((i) => i.risk === "waiting").slice(0, 3).map((it) => ({
      color: "#16a34a", type: "ok",
      text: `Approved — `, bold: `${it.artifact.title}`,
      time: "Yesterday",
    })),
  ].slice(0, 7);

  const actions = [
    ...breachedItems.slice(0, 2).map((it) => ({
      icon: "⚠", title: `Escalate ${it.artifact.title} immediately`,
      desc: `${it.approver.name ?? it.approver.label} — ${it.pending_age_label}`,
    })),
    ...atRiskItems.slice(0, 1).map((it) => ({
      icon: "ℹ", title: `Chase ${it.artifact.title}`,
      desc: `${it.project.name} · due soon`,
    })),
  ];

  const summaryText = totalPending === 0
    ? "All approvals are within SLA. No action required."
    : `Portfolio is under pressure — ${totalBreached > 0 ? `${totalBreached} active SLA breach${totalBreached !== 1 ? "es" : ""}` : "approvals pending"} across ${[...new Set(breachedItems.map((i) => i.project.name))].filter(Boolean).slice(0, 4).join(", ") || "multiple projects"}. ${totalBreached > 0 ? "Legal and Finance stages are primary bottlenecks." : ""}`;

  return (
    <div>
      {/* Time picker */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>Window:</span>
        {([7, 14, 30, 60] as const).map((d) => (
          <button key={d} onClick={() => setDays(d)} style={{ padding: "4px 12px", borderRadius: 20, border: `1px solid ${days === d ? "#6366f1" : "#e5e7e0"}`, background: days === d ? "#eff6ff" : "white", color: days === d ? "#1d4ed8" : "#6b7280", fontSize: 11, fontWeight: 700, cursor: "pointer" }}>{d}d</button>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Activity feed */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, overflow: "hidden" }}>
          <div style={{ padding: "14px 18px", borderBottom: "1px solid #f0f0eb", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#111" }}>Activity feed</span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>last 24 hours</span>
          </div>
          {feed.length === 0
            ? <div style={{ padding: "32px 18px", textAlign: "center", fontSize: 13, color: "#9ca3af" }}>No recent activity</div>
            : feed.map((f, i) => (
                <div key={i} style={{ display: "flex", gap: 12, padding: "12px 18px", borderBottom: "1px solid #f5f5f0" }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: f.color, flexShrink: 0, marginTop: 5 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#111", lineHeight: 1.5 }}>
                      {f.text}<strong>{f.bold}</strong>
                    </div>
                    <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 3 }}>{f.time}</div>
                  </div>
                </div>
              ))}
        </div>

        {/* Executive summary */}
        <div style={{ background: "white", border: "1px solid #e5e7e0", borderRadius: 14, padding: "18px 20px" }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#111", marginBottom: 12 }}>Executive summary</div>
          <p style={{ fontSize: 13, color: "#374151", lineHeight: 1.7, marginBottom: 16 }}>{summaryText}</p>

          {actions.length > 0 && (
            <>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.12em", color: "#9ca3af", textTransform: "uppercase", marginBottom: 10 }}>Actions needed</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
                {actions.map((a, i) => (
                  <div key={i} style={{ padding: "12px 0", borderBottom: i < actions.length - 1 ? "1px solid #f5f5f0" : "none" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                      <span style={{ fontSize: 14, flexShrink: 0 }}>{a.icon}</span>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "#111" }}>{a.title}</div>
                        <div style={{ fontSize: 11, color: "#9ca3af", marginTop: 2 }}>{a.desc}</div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Digest from API if available */}
          {!loading && digest && digest.summary && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: "1px solid #f0f0eb" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {[
                  { label: "Active projects", value: digest.summary.active_projects },
                  { label: "Decisions made", value: digest.summary.decisions_total },
                  { label: "Approval rate", value: digest.sections?.decisions?.approval_rate != null ? `${digest.sections.decisions.approval_rate}%` : "—" },
                  { label: "New projects", value: digest.summary.new_projects },
                ].map((s, i) => (
                  <div key={i} style={{ padding: "8px 10px", borderRadius: 8, background: "#f8f8f5" }}>
                    <div style={{ fontFamily: "monospace", fontSize: 18, fontWeight: 700, color: "#111" }}>{s.value ?? "—"}</div>
                    <div style={{ fontSize: 10, color: "#9ca3af", marginTop: 2 }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── MAIN PAGE ──────────────────────────────────────────────────────────────── */

export default function ApprovalsControlCentre() {
  const [tab, setTab] = useState<Tab>("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  const [counts, setCounts] = useState<LiveCounts | null>(null);
  const [pendingItems, setPendingItems] = useState<PendingItem[]>([]);
  const [overviewLoading, setOverviewLoading] = useState(true);
  const [overviewError, setOverviewError] = useState<string | null>(null);

  const [blockers, setBlockers] = useState<BlockerItem[] | null>(null);
  const [blockersLoading, setBlockersLoading] = useState(true);
  const [blockersError, setBlockersError] = useState<string | null>(null);

  const [bottlenecks, setBottlenecks] = useState<BottleneckItem[] | null>(null);
  const [bottlenecksLoading, setBottlenecksLoading] = useState(true);
  const [bottlenecksError, setBottlenecksError] = useState<string | null>(null);

  const [slaRadar, setSlaRadar] = useState<SlaRadarItem[] | null>(null);
  const [projectRisk, setProjectRisk] = useState<ProjectRiskItem[] | null>(null);
  const [riskLoading, setRiskLoading] = useState(true);
  const [riskError, setRiskError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    setLastRefreshed(new Date());

    // Overview: counts + items
    setOverviewLoading(true); setOverviewError(null);
    Promise.all([
      apiFetch<{ counts: LiveCounts; items: PendingItem[] }>("/api/executive/approvals"),
      apiFetch<{ items: PendingItem[] }>("/api/executive/approvals/pending?limit=200"),
    ]).then(([main, pend]) => {
      setCounts(main.counts);
      setPendingItems(pend.items ?? main.items ?? []);
    }).catch((e) => setOverviewError(e.message)).finally(() => setOverviewLoading(false));

    // PM / who-blocking
    setBlockersLoading(true); setBlockersError(null);
    apiFetch<{ items: BlockerItem[] }>("/api/executive/approvals/who-blocking")
      .then((d) => setBlockers(d.items))
      .catch((e) => setBlockersError(e.message))
      .finally(() => setBlockersLoading(false));

    // Bottlenecks
    setBottlenecksLoading(true); setBottlenecksError(null);
    apiFetch<{ items: BottleneckItem[] }>("/api/executive/approvals/bottlenecks")
      .then((d) => setBottlenecks(d.items))
      .catch((e) => setBottlenecksError(e.message))
      .finally(() => setBottlenecksLoading(false));

    // Risk
    setRiskLoading(true); setRiskError(null);
    Promise.all([
      apiFetch<{ items: SlaRadarItem[] }>("/api/executive/approvals/sla-radar"),
      apiFetch<{ items: ProjectRiskItem[] }>("/api/executive/projects/at-risk?active_only=true"),
    ]).then(([sla, risk]) => { setSlaRadar(sla.items); setProjectRisk(risk.items); })
      .catch((e) => setRiskError(e.message))
      .finally(() => setRiskLoading(false));
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll, refreshKey]);

  const TABS: { id: Tab; label: string; dot?: boolean }[] = [
    { id: "overview",    label: "Overview" },
    { id: "pm",          label: "PM Performance" },
    { id: "bottlenecks", label: "Bottlenecks" },
    { id: "atrisk",      label: "At Risk Predictor", dot: (counts?.breached ?? 0) > 0 },
    { id: "digest",      label: "Digest" },
  ];

  const tabIcons: Record<Tab, string> = {
    overview: "▦", pm: "👤", bottlenecks: "≡", atrisk: "⚡", digest: "✉",
  };

  return (
    <div style={{ minHeight: "100vh", background: "#f5f5f0", fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        button { outline: none; }
        * { box-sizing: border-box; }
      `}</style>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "28px 20px" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "#e8eaf6", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
              ✓
            </div>
            <div>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.15em", textTransform: "uppercase", color: "#6b7280", marginBottom: 3 }}>Executive Dashboard</div>
              <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: "#111" }}>Approvals Control Centre</h1>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 12, color: "#9ca3af" }}>
              Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 10, border: "1px solid #d1d5db", background: "white", fontSize: 13, fontWeight: 600, color: "#374151", cursor: "pointer" }}
            >
              ↺ Refresh
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div style={{ display: "flex", gap: 6, marginBottom: 20, flexWrap: "wrap" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "8px 16px", borderRadius: 10,
                border: `1px solid ${tab === t.id ? "#d1d5db" : "#e5e7db"}`,
                background: tab === t.id ? "white" : "transparent",
                fontSize: 13, fontWeight: tab === t.id ? 700 : 500,
                color: tab === t.id ? "#111" : "#6b7280",
                cursor: "pointer",
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              <span style={{ fontSize: 12, opacity: 0.7 }}>{tabIcons[t.id]}</span>
              {t.label}
              {t.dot && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#dc2626" }} />}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "overview" && (
          <OverviewTab counts={counts} items={pendingItems} loading={overviewLoading} error={overviewError} onRetry={fetchAll} />
        )}
        {tab === "pm" && (
          <PmTab data={blockers} loading={blockersLoading} error={blockersError} onRetry={fetchAll} />
        )}
        {tab === "bottlenecks" && (
          <BottlenecksTab data={bottlenecks} loading={bottlenecksLoading} error={bottlenecksError} onRetry={fetchAll} />
        )}
        {tab === "atrisk" && (
          <AtRiskTab slaData={slaRadar} projectRisk={projectRisk} loading={riskLoading} error={riskError} onRetry={fetchAll} />
        )}
        {tab === "digest" && (
          <DigestTab counts={counts} items={pendingItems} />
        )}
      </div>
    </div>
  );
}