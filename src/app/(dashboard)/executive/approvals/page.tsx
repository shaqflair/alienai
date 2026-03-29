"use client";

/**
 * Approvals Control Centre — Executive Dashboard
 *
 * Wired to:
 *   GET /api/executive/approvals          → overview counts + pending items
 *   GET /api/executive/approvals/bottlenecks → bottleneck aggregates
 *   GET /api/executive/approvals/sla-radar   → items breached / at-risk within 48h
 *   GET /api/executive/approvals/who-blocking → per-person blocking stats
 *   GET /api/executive/projects/at-risk      → project-level risk scores + signals
 *
 * Drop this file in:
 *   src/app/(dashboard)/executive/approvals/page.tsx
 * or wherever your executive routes live.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";

// ─── Types aligned to API response shapes ────────────────────────────────────

interface ApprovalCounts {
  pending: number;
  waiting: number;
  at_risk: number;
  breached: number;
}

interface ApprovalItem {
  step_id: string;
  artifact_id: string;
  step_name: string;
  pending_days: number | null;
  pending_age_label: string;
  due_at: string | null;
  risk: "breached" | "at_risk" | "waiting";
  artifact: { title: string; artifact_type: string };
  project: { id: string; name: string | null };
  approver: { user_id: string | null; email: string | null; label: string; name?: string };
}

interface OverviewData {
  counts: ApprovalCounts;
  items: ApprovalItem[];
}

interface BlockerItem {
  key: string;
  name: string;
  label: string;
  pending_count: number;
  overdue_count: number;
  avg_wait_days: number;
  max_wait_days: number;
  projects_affected: number;
  user_id: string | null;
  email: string | null;
}

interface BottleneckItem {
  kind: string;
  label: string;
  pending_count: number;
  avg_wait_days: number;
  max_wait_days: number;
  projects_affected: number;
}

interface SlaRadarItem {
  id: string;
  title: string;
  breached: boolean;
  at_risk: boolean;
  hours_to_due: number;
  overdue_days: number;
  project_title: string | null;
  project_code: string | null;
  assignee_id: string | null;
  approver_email: string | null;
  stage_key: string;
}

interface ProjectRiskSignal {
  key: string;
  label: string;
  detail: string;
  score: number;
  triggered: boolean;
}

interface ProjectRiskItem {
  project_id: string;
  project_code: string | null;
  project_title: string | null;
  risk_score: number;
  risk_level: "HIGH" | "MEDIUM" | "LOW";
  signals: ProjectRiskSignal[];
  days_since_activity: number | null;
  overdue_steps: number;
  rejection_rate: number | null;
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${path} → ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error ?? "API error");
  return json as T;
}

// ─── Small UI helpers ─────────────────────────────────────────────────────────

function cls(...args: (string | false | null | undefined)[]) {
  return args.filter(Boolean).join(" ");
}

function riskColor(risk: string) {
  if (risk === "breached") return "text-red-600 dark:text-red-400";
  if (risk === "at_risk") return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

function riskBadge(risk: string) {
  if (risk === "breached")
    return "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-300 dark:ring-red-800";
  if (risk === "at_risk")
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800";
  return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:ring-emerald-800";
}

function riskLabel(risk: string) {
  if (risk === "breached") return "Breached";
  if (risk === "at_risk") return "At risk";
  return "On track";
}

function levelBadge(level: "HIGH" | "MEDIUM" | "LOW") {
  if (level === "HIGH")
    return "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-900/20 dark:text-red-300 dark:ring-red-800";
  if (level === "MEDIUM")
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:ring-amber-800";
  return "bg-slate-100 text-slate-600 ring-1 ring-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:ring-slate-700";
}

function hoursLabel(h: number) {
  if (h < 0) return `${Math.abs(Math.floor(h / 24))}d overdue`;
  if (h < 1) return "<1h left";
  if (h < 24) return `${h}h left`;
  return `${Math.floor(h / 24)}d left`;
}

function Spinner() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600 dark:border-slate-700 dark:border-t-slate-300" />
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-sm text-slate-400 dark:text-slate-500">
      <svg className="mb-3 h-8 w-8 opacity-40" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
      {message}
    </div>
  );
}

function ErrorBanner({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
      <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <span className="flex-1">{message}</span>
      <button onClick={onRetry} className="shrink-0 font-medium underline underline-offset-2 hover:opacity-70">
        Retry
      </button>
    </div>
  );
}

// ─── Stat card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
  sub,
}: {
  label: string;
  value: number | string;
  accent?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
      <p className="mb-1.5 text-xs font-medium uppercase tracking-widest text-slate-400 dark:text-slate-500">
        {label}
      </p>
      <p className={cls("text-3xl font-semibold tabular-nums", accent ?? "text-slate-800 dark:text-slate-100")}>
        {value}
      </p>
      {sub && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">{sub}</p>}
    </div>
  );
}

// ─── Progress bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
      <div
        className={cls("h-full rounded-full transition-all", color)}
        style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
      />
    </div>
  );
}

// ─── Tab nav ──────────────────────────────────────────────────────────────────

type Tab = "overview" | "pm" | "bottlenecks" | "risk" | "digest";

const TABS: { id: Tab; label: string; dotColor?: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "pm", label: "PM Performance" },
  { id: "bottlenecks", label: "Bottlenecks" },
  { id: "risk", label: "At Risk Predictor", dotColor: "bg-red-400" },
  { id: "digest", label: "Digest" },
];

// ─── Overview Tab ─────────────────────────────────────────────────────────────

function OverviewTab({ data, loading, error, onRetry }: {
  data: OverviewData | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!data) return <EmptyState message="No approval data" />;

  const { counts, items } = data;

  // Group items by project for the right panel
  const byProject = items.reduce<Record<string, ApprovalItem[]>>((acc, item) => {
    const pid = item.project?.id ?? "unknown";
    if (!acc[pid]) acc[pid] = [];
    acc[pid].push(item);
    return acc;
  }, {});

  const projectGroups = Object.entries(byProject).map(([pid, rows]) => {
    const name = rows[0]?.project?.name ?? pid;
    const code = pid.slice(0, 8).toUpperCase();
    const breached = rows.filter((r) => r.risk === "breached").length;
    const at_risk = rows.filter((r) => r.risk === "at_risk").length;
    const worstRisk = breached > 0 ? "breached" : at_risk > 0 ? "at_risk" : "waiting";
    return { pid, name, code, rows, breached, at_risk, worstRisk };
  }).sort((a, b) => {
    const w = (r: string) => (r === "breached" ? 2 : r === "at_risk" ? 1 : 0);
    return w(b.worstRisk) - w(a.worstRisk);
  });

  // SLA urgency — items sorted by due_at ascending
  const urgentItems = [...items]
    .filter((i) => i.due_at)
    .sort((a, b) => new Date(a.due_at!).getTime() - new Date(b.due_at!).getTime())
    .slice(0, 8);

  return (
    <div className="space-y-4">
      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Total pending"
          value={counts.pending}
          accent="text-slate-800 dark:text-slate-100"
          sub={counts.pending === 0 ? "All clear" : "requires action"}
        />
        <StatCard
          label="SLA breached"
          value={counts.breached}
          accent={counts.breached > 0 ? "text-red-600 dark:text-red-400" : undefined}
          sub={counts.breached > 0 ? "escalate now" : "none"}
        />
        <StatCard
          label="At risk"
          value={counts.at_risk}
          accent={counts.at_risk > 0 ? "text-amber-500 dark:text-amber-400" : undefined}
          sub={counts.at_risk > 0 ? "due within 48h" : "none"}
        />
        <StatCard
          label="Within SLA"
          value={Math.max(0, counts.waiting - counts.at_risk - counts.breached)}
          accent="text-emerald-600 dark:text-emerald-400"
          sub="healthy"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* By project */}
        <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">By project</span>
            <span className="text-xs text-slate-400">{projectGroups.length} projects</span>
          </div>
          {projectGroups.length === 0 ? (
            <EmptyState message="No pending approvals" />
          ) : (
            <ul className="divide-y divide-slate-50 dark:divide-slate-800">
              {projectGroups.map((g) => (
                <li key={g.pid} className="flex items-center gap-3 px-5 py-3">
                  <span className="shrink-0 rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                    {g.code}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-slate-700 dark:text-slate-300">
                    {g.name}
                  </span>
                  <span className="shrink-0 text-xs text-slate-400">
                    {g.rows.length} pending
                    {g.breached > 0 && ` · ${g.breached} breached`}
                  </span>
                  <span className={cls("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", riskBadge(g.worstRisk))}>
                    {riskLabel(g.worstRisk)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* SLA urgency */}
        <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">SLA urgency</span>
          </div>
          {urgentItems.length === 0 ? (
            <EmptyState message="No items with due dates" />
          ) : (
            <ul className="divide-y divide-slate-50 dark:divide-slate-800">
              {urgentItems.map((item) => {
                const dueMs = item.due_at ? new Date(item.due_at).getTime() : null;
                const diffHrs = dueMs ? Math.round((dueMs - Date.now()) / 36e5) : null;
                const pct = dueMs
                  ? Math.min(
                      100,
                      Math.max(
                        0,
                        ((Date.now() - (dueMs - 5 * 24 * 36e5)) /
                          (5 * 24 * 36e5)) *
                          100
                      )
                    )
                  : 0;
                const barColor =
                  item.risk === "breached"
                    ? "bg-red-500"
                    : item.risk === "at_risk"
                    ? "bg-amber-400"
                    : "bg-emerald-400";

                return (
                  <li key={item.step_id} className="px-5 py-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                        {item.artifact.title || item.step_name}
                      </span>
                      <span className={cls("shrink-0 text-xs font-semibold", riskColor(item.risk))}>
                        {diffHrs !== null ? hoursLabel(diffHrs) : item.pending_age_label}
                      </span>
                    </div>
                    <p className="mb-1.5 text-xs text-slate-400">
                      {item.project.name ?? item.project.id} · {item.approver.name ?? item.approver.label}
                    </p>
                    <ProgressBar pct={pct} color={barColor} />
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── PM Performance Tab (who-blocking) ────────────────────────────────────────

function PmTab({ data, loading, error, onRetry }: {
  data: BlockerItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!data || data.length === 0) return <EmptyState message="No blocking data available" />;

  const maxCount = Math.max(...data.map((d) => d.pending_count), 1);

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Total approvers with items" value={data.length} />
        <StatCard
          label="With overdue items"
          value={data.filter((d) => d.overdue_count > 0).length}
          accent="text-red-600 dark:text-red-400"
        />
        <StatCard
          label="Avg wait (days)"
          value={
            data.length
              ? (data.reduce((s, d) => s + d.avg_wait_days, 0) / data.length).toFixed(1)
              : "—"
          }
        />
      </div>

      {/* Leaderboard */}
      <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Who is blocking approvals
          </span>
          <span className="ml-2 text-xs text-slate-400">sorted by overdue count</span>
        </div>
        <ul className="divide-y divide-slate-50 dark:divide-slate-800">
          {data.map((person, i) => {
            const initials = person.name
              .split(/\s+/)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? "")
              .join("");
            const avatarColors = [
              "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300",
              "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
              "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
              "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
              "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
            ];
            const color = avatarColors[i % avatarColors.length];

            return (
              <li key={person.key} className="px-5 py-3.5">
                <div className="mb-2 flex items-center gap-3">
                  <div
                    className={cls(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      color
                    )}
                  >
                    {initials || "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                      {person.name}
                    </p>
                    <p className="text-xs text-slate-400">
                      {person.email ?? person.label} · {person.projects_affected} project
                      {person.projects_affected !== 1 ? "s" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {person.pending_count} pending
                    </p>
                    {person.overdue_count > 0 && (
                      <p className="text-xs font-medium text-red-600 dark:text-red-400">
                        {person.overdue_count} overdue
                      </p>
                    )}
                  </div>
                </div>
                {/* Inline bar for pending count */}
                <ProgressBar
                  pct={(person.pending_count / maxCount) * 100}
                  color={
                    person.overdue_count > 0
                      ? "bg-red-400"
                      : person.avg_wait_days > 3
                      ? "bg-amber-400"
                      : "bg-indigo-400"
                  }
                />
                <div className="mt-1.5 flex gap-4 text-xs text-slate-400">
                  <span>avg {person.avg_wait_days.toFixed(1)}d wait</span>
                  <span>max {person.max_wait_days}d</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ─── Bottlenecks Tab ──────────────────────────────────────────────────────────

function BottlenecksTab({ data, loading, error, onRetry }: {
  data: BottleneckItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!data || data.length === 0) return <EmptyState message="No bottleneck data available" />;

  const maxCount = Math.max(...data.map((d) => d.pending_count), 1);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Approval queues" value={data.length} />
        <StatCard
          label="Longest wait (days)"
          value={Math.max(...data.map((d) => d.max_wait_days))}
          accent="text-red-600 dark:text-red-400"
        />
        <StatCard
          label="Projects impacted"
          value={data.reduce((s, d) => Math.max(s, d.projects_affected), 0)}
        />
      </div>

      <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            Approvals stuck by stage
          </span>
          <span className="ml-2 text-xs text-slate-400">avg wait in days</span>
        </div>
        <ul className="divide-y divide-slate-50 dark:divide-slate-800">
          {data.map((item) => {
            const pct = (item.pending_count / maxCount) * 100;
            const isHot = item.avg_wait_days > 3 || item.max_wait_days > 5;
            const barColor = isHot ? "bg-red-400" : item.avg_wait_days > 2 ? "bg-amber-400" : "bg-indigo-400";

            return (
              <li key={item.label} className="px-5 py-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                      {item.label}
                    </p>
                    <p className="text-xs text-slate-400">
                      {item.projects_affected} project{item.projects_affected !== 1 ? "s" : ""} affected
                      {item.kind ? ` · ${item.kind}` : ""}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={cls("text-sm font-semibold tabular-nums", isHot ? "text-red-600 dark:text-red-400" : "text-slate-700 dark:text-slate-300")}>
                      {item.pending_count} pending
                    </p>
                    <p className="text-xs text-slate-400">
                      avg {item.avg_wait_days.toFixed(1)}d · max {item.max_wait_days}d
                    </p>
                  </div>
                </div>
                <ProgressBar pct={pct} color={barColor} />
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ─── At Risk Tab ──────────────────────────────────────────────────────────────

function RiskTab({
  slaData,
  projectRisk,
  loading,
  error,
  onRetry,
}: {
  slaData: SlaRadarItem[] | null;
  projectRisk: ProjectRiskItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;

  return (
    <div className="space-y-4">
      {/* Info banner */}
      <div className="flex items-start gap-3 rounded-lg border border-indigo-100 bg-indigo-50 px-4 py-3 text-xs text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">
        <svg className="mt-0.5 h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        SLA radar surfaces items breached or due within 48 hours. Project risk scores are computed from overdue steps, inactivity, and rejection rates.
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* SLA Radar */}
        <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">SLA radar</span>
            {slaData && (
              <span className="text-xs text-slate-400">
                {slaData.filter((i) => i.breached).length} breached ·{" "}
                {slaData.filter((i) => i.at_risk).length} at risk
              </span>
            )}
          </div>
          {!slaData || slaData.length === 0 ? (
            <EmptyState message="No items breached or due within 48h" />
          ) : (
            <ul className="divide-y divide-slate-50 dark:divide-slate-800">
              {slaData.map((item) => (
                <li key={item.id} className="px-5 py-3.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                        {item.title}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {item.project_code && (
                          <span className="mr-1.5 rounded bg-indigo-50 px-1 py-0.5 font-mono text-[10px] text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                            {item.project_code}
                          </span>
                        )}
                        {item.project_title}
                        {item.approver_email && ` · ${item.approver_email}`}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <span className={cls("rounded-full px-2 py-0.5 text-[10px] font-semibold", riskBadge(item.breached ? "breached" : "at_risk"))}>
                        {item.breached ? `${item.overdue_days}d overdue` : hoursLabel(item.hours_to_due)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-1.5 text-xs text-slate-400">{item.stage_key}</p>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Project risk scores */}
        <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Project risk scores</span>
            {projectRisk && (
              <span className="text-xs text-slate-400">
                {projectRisk.filter((p) => p.risk_level === "HIGH").length} high
              </span>
            )}
          </div>
          {!projectRisk || projectRisk.length === 0 ? (
            <EmptyState message="No projects at elevated risk" />
          ) : (
            <ul className="divide-y divide-slate-50 dark:divide-slate-800">
              {projectRisk.map((proj) => (
                <li key={proj.project_id} className="px-5 py-3.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        {proj.project_code && (
                          <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-indigo-600 dark:bg-indigo-950 dark:text-indigo-300">
                            {proj.project_code}
                          </span>
                        )}
                        <span className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                          {proj.project_title ?? "Unknown project"}
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-sm font-semibold tabular-nums text-slate-600 dark:text-slate-400">
                        {proj.risk_score}
                      </span>
                      <span className={cls("rounded-full px-2 py-0.5 text-[10px] font-semibold", levelBadge(proj.risk_level))}>
                        {proj.risk_level}
                      </span>
                    </div>
                  </div>
                  <ProgressBar
                    pct={proj.risk_score}
                    color={proj.risk_level === "HIGH" ? "bg-red-500" : proj.risk_level === "MEDIUM" ? "bg-amber-400" : "bg-slate-300"}
                  />
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {proj.signals
                      .filter((s) => s.triggered)
                      .map((s) => (
                        <span
                          key={s.key}
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                          title={`Score +${s.score}`}
                        >
                          {s.detail}
                        </span>
                      ))}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Digest Tab ───────────────────────────────────────────────────────────────

function DigestTab({
  overview,
  blockers,
  loading,
  error,
  onRetry,
}: {
  overview: OverviewData | null;
  blockers: BlockerItem[] | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (loading) return <Spinner />;
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />;
  if (!overview) return <EmptyState message="No digest data" />;

  const { counts, items } = overview;
  const breachedItems = items.filter((i) => i.risk === "breached");
  const atRiskItems = items.filter((i) => i.risk === "at_risk");
  const topBlockers = (blockers ?? []).filter((b) => b.overdue_count > 0).slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Executive summary */}
      <div className="rounded-xl border border-slate-100 bg-white px-6 py-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-300">
          Executive summary
        </h3>
        <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          {counts.pending === 0 ? (
            "All approvals are within SLA. No action required."
          ) : (
            <>
              Portfolio has{" "}
              <strong className="text-slate-800 dark:text-slate-200">{counts.pending} pending approval{counts.pending !== 1 ? "s" : ""}</strong>
              {counts.breached > 0 && (
                <>
                  {" "}— including{" "}
                  <strong className="text-red-600 dark:text-red-400">
                    {counts.breached} SLA breach{counts.breached !== 1 ? "es" : ""}
                  </strong>
                  {" "}requiring immediate escalation
                </>
              )}
              {counts.at_risk > 0 && (
                <>
                  {" "}and{" "}
                  <strong className="text-amber-600 dark:text-amber-400">
                    {counts.at_risk} item{counts.at_risk !== 1 ? "s" : ""} at risk
                  </strong>
                  {" "}due within 48 hours
                </>
              )}
              .
            </>
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Breached items */}
        <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="flex items-center justify-between border-b border-red-50 px-5 py-3.5 dark:border-slate-800">
            <span className="text-sm font-medium text-red-600 dark:text-red-400">
              SLA breaches
            </span>
            <span className="text-xs text-slate-400">{breachedItems.length} items</span>
          </div>
          {breachedItems.length === 0 ? (
            <EmptyState message="No breaches — nice!" />
          ) : (
            <ul className="divide-y divide-slate-50 dark:divide-slate-800">
              {breachedItems.slice(0, 10).map((item) => (
                <li key={item.step_id} className="px-5 py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-slate-700 dark:text-slate-300">
                        {item.artifact.title || item.step_name}
                      </p>
                      <p className="text-xs text-slate-400">
                        {item.project.name} · {item.approver.name ?? item.approver.label}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-semibold text-red-600 dark:text-red-400">
                      {item.pending_age_label}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Actions needed */}
        <div className="rounded-xl border border-slate-100 bg-white dark:border-slate-800 dark:bg-slate-900">
          <div className="border-b border-slate-100 px-5 py-3.5 dark:border-slate-800">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Actions needed
            </span>
          </div>
          <ul className="divide-y divide-slate-50 dark:divide-slate-800">
            {breachedItems.slice(0, 3).map((item) => (
              <li key={item.step_id} className="flex gap-3 px-5 py-3.5">
                <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Escalate — {item.artifact.title || item.step_name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {item.approver.name ?? item.approver.label} unresponsive · {item.pending_age_label}
                  </p>
                </div>
              </li>
            ))}
            {atRiskItems.slice(0, 2).map((item) => (
              <li key={item.step_id} className="flex gap-3 px-5 py-3.5">
                <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Chase — {item.artifact.title || item.step_name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {item.project.name} · due soon
                  </p>
                </div>
              </li>
            ))}
            {topBlockers.map((b) => (
              <li key={b.key} className="flex gap-3 px-5 py-3.5">
                <div className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                    Review PM workload — {b.name}
                  </p>
                  <p className="text-xs text-slate-400">
                    {b.overdue_count} overdue · {b.pending_count} total pending
                  </p>
                </div>
              </li>
            ))}
            {breachedItems.length === 0 && atRiskItems.length === 0 && topBlockers.length === 0 && (
              <li className="px-5 py-10 text-center text-sm text-slate-400">
                No actions required right now
              </li>
            )}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function ApprovalsControlCentre() {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());

  // Per-endpoint state
  const [overview, setOverview] = useState<OverviewData | null>(null);
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

    // Overview
    setOverviewLoading(true);
    setOverviewError(null);
    apiFetch<{ counts: ApprovalCounts; items: ApprovalItem[] }>("/api/executive/approvals")
      .then((d) => setOverview(d))
      .catch((e) => setOverviewError(e.message))
      .finally(() => setOverviewLoading(false));

    // Who is blocking
    setBlockersLoading(true);
    setBlockersError(null);
    apiFetch<{ items: BlockerItem[] }>("/api/executive/approvals/who-blocking")
      .then((d) => setBlockers(d.items))
      .catch((e) => setBlockersError(e.message))
      .finally(() => setBlockersLoading(false));

    // Bottlenecks
    setBottlenecksLoading(true);
    setBottlenecksError(null);
    apiFetch<{ items: BottleneckItem[] }>("/api/executive/approvals/bottlenecks")
      .then((d) => setBottlenecks(d.items))
      .catch((e) => setBottlenecksError(e.message))
      .finally(() => setBottlenecksLoading(false));

    // SLA radar + project risk (combined in one loading state for the Risk tab)
    setRiskLoading(true);
    setRiskError(null);
    Promise.all([
      apiFetch<{ items: SlaRadarItem[] }>("/api/executive/approvals/sla-radar"),
      apiFetch<{ items: ProjectRiskItem[] }>("/api/executive/projects/at-risk?active_only=true"),
    ])
      .then(([sla, risk]) => {
        setSlaRadar(sla.items);
        setProjectRisk(risk.items);
      })
      .catch((e) => setRiskError(e.message))
      .finally(() => setRiskLoading(false));
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll, refreshKey]);

  const handleRefresh = () => setRefreshKey((k) => k + 1);

  // Derive a top-level error pill count for the badge
  const breachedCount = overview?.counts?.breached ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-600">
              <svg className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 11l3 3L22 4" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
              </svg>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400 dark:text-slate-500">
                Executive Dashboard
              </p>
              <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">
                Approvals Control Centre
              </h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-400">
              Updated {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </span>
            <button
              onClick={handleRefresh}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:bg-slate-800"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Tab nav */}
        <div className="mb-5 border-b border-slate-200 dark:border-slate-800">
          <nav className="-mb-px flex gap-0">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cls(
                  "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-sm font-medium transition",
                  activeTab === tab.id
                    ? "border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400"
                    : "border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-300"
                )}
              >
                {tab.dotColor && (
                  <span className={cls("h-1.5 w-1.5 rounded-full", tab.dotColor)} />
                )}
                {tab.label}
                {tab.id === "risk" && breachedCount > 0 && (
                  <span className="ml-1 rounded-full bg-red-100 px-1.5 py-0.5 text-[10px] font-bold text-red-600 dark:bg-red-900/40 dark:text-red-400">
                    {breachedCount}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab content */}
        {activeTab === "overview" && (
          <OverviewTab
            data={overview}
            loading={overviewLoading}
            error={overviewError}
            onRetry={handleRefresh}
          />
        )}
        {activeTab === "pm" && (
          <PmTab
            data={blockers}
            loading={blockersLoading}
            error={blockersError}
            onRetry={handleRefresh}
          />
        )}
        {activeTab === "bottlenecks" && (
          <BottlenecksTab
            data={bottlenecks}
            loading={bottlenecksLoading}
            error={bottlenecksError}
            onRetry={handleRefresh}
          />
        )}
        {activeTab === "risk" && (
          <RiskTab
            slaData={slaRadar}
            projectRisk={projectRisk}
            loading={riskLoading}
            error={riskError}
            onRetry={handleRefresh}
          />
        )}
        {activeTab === "digest" && (
          <DigestTab
            overview={overview}
            blockers={blockers}
            loading={overviewLoading}
            error={overviewError}
            onRetry={handleRefresh}
          />
        )}
      </div>
    </div>
  );
}
