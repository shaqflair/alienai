import "server-only";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import {
  AlertTriangle,
  Activity,
  ShieldAlert,
  CheckCircle2,
  Clock3,
  ChevronRight,
} from "lucide-react";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type PlatformEvent = {
  id: string;
  event_type: string;
  severity: "info" | "warning" | "critical";
  source: string;
  title: string;
  message: string | null;
  route: string | null;
  status: "open" | "investigating" | "resolved" | "ignored";
  occurrence_count: number;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  metadata?: any;
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - t;
  if (!Number.isFinite(t) || diffMs < 0) return "just now";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function severityClasses(sev: PlatformEvent["severity"]) {
  if (sev === "critical") {
    return {
      wrap: "border-red-200 bg-red-50",
      pill: "bg-red-100 text-red-700 border-red-200",
      dot: "bg-red-500",
      icon: <ShieldAlert className="h-4 w-4 text-red-500" />,
    };
  }
  if (sev === "warning") {
    return {
      wrap: "border-amber-200 bg-amber-50",
      pill: "bg-amber-100 text-amber-700 border-amber-200",
      dot: "bg-amber-500",
      icon: <AlertTriangle className="h-4 w-4 text-amber-500" />,
    };
  }
  return {
    wrap: "border-blue-200 bg-blue-50",
    pill: "bg-blue-100 text-blue-700 border-blue-200",
    dot: "bg-blue-500",
    icon: <Activity className="h-4 w-4 text-blue-500" />,
  };
}

function statusClasses(status: PlatformEvent["status"]) {
  if (status === "resolved") return "bg-green-100 text-green-700 border-green-200";
  if (status === "investigating") return "bg-purple-100 text-purple-700 border-purple-200";
  if (status === "ignored") return "bg-gray-100 text-gray-600 border-gray-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function StatCard({
  label,
  value,
  sub,
  tone = "slate",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "slate" | "red" | "amber" | "green";
}) {
  const tones = {
    slate: "bg-white border-slate-200 text-slate-900",
    red: "bg-red-50 border-red-200 text-red-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    green: "bg-green-50 border-green-200 text-green-700",
  }[tone];

  return (
    <div className={`rounded-2xl border p-5 ${tones}`}>
      <div className="text-xs font-semibold uppercase tracking-wider opacity-70">{label}</div>
      <div className="mt-2 text-3xl font-bold">{value}</div>
      {sub && <div className="mt-1 text-xs opacity-70">{sub}</div>}
    </div>
  );
}

export default async function PlatformHealthPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <h1 className="text-xl font-bold text-slate-900">Platform Health</h1>
          <p className="mt-2 text-sm text-slate-500">Please sign in to view platform monitoring.</p>
        </div>
      </div>
    );
  }

  const { data, error } = await supabase
    .from("platform_events")
    .select(
      "id,event_type,severity,source,title,message,route,status,occurrence_count,first_seen_at,last_seen_at,created_at,metadata",
    )
    .order("last_seen_at", { ascending: false })
    .limit(100);

  const rows: PlatformEvent[] = Array.isArray(data) ? (data as PlatformEvent[]) : [];

  const openRows = rows.filter((r) => r.status === "open" || r.status === "investigating");
  const criticalOpen = openRows.filter((r) => r.severity === "critical");
  const warningOpen = openRows.filter((r) => r.severity === "warning");
  const resolvedRows = rows.filter((r) => r.status === "resolved");

  const routeCounts = new Map<string, number>();
  for (const row of openRows) {
    const key = safeStr(row.route).trim() || "(no route)";
    routeCounts.set(key, (routeCounts.get(key) ?? 0) + 1);
  }
  const topRoutes = Array.from(routeCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-600">
              AI Self-Monitoring
            </div>
            <h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-900">
              Platform Health
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Live operational incidents, route failures, and application stability signals.
            </p>
          </div>

          <div className="flex gap-2">
            <Link
              href="/"
              className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Back to app
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-3xl border border-red-200 bg-red-50 p-6 text-red-700">
            Failed to load platform events: {error.message}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
              <StatCard label="Open incidents" value={openRows.length} sub="Open + investigating" />
              <StatCard label="Critical" value={criticalOpen.length} sub="Needs urgent attention" tone="red" />
              <StatCard label="Warnings" value={warningOpen.length} sub="Degraded but not fatal" tone="amber" />
              <StatCard label="Resolved in feed" value={resolvedRows.length} sub="Recent successful recoveries" tone="green" />
            </div>

            <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-3">
              <div className="xl:col-span-2 rounded-3xl border border-slate-200 bg-white shadow-sm">
                <div className="border-b border-slate-100 px-6 py-4">
                  <h2 className="text-base font-semibold text-slate-900">Incident Feed</h2>
                  <p className="mt-1 text-xs text-slate-500">Most recent platform events first</p>
                </div>

                <div className="divide-y divide-slate-100">
                  {rows.length === 0 ? (
                    <div className="px-6 py-16 text-center">
                      <CheckCircle2 className="mx-auto h-10 w-10 text-green-400" />
                      <div className="mt-3 text-sm font-semibold text-slate-700">No incidents recorded</div>
                      <div className="mt-1 text-xs text-slate-500">Self-monitoring is active and waiting for signals.</div>
                    </div>
                  ) : (
                    rows.map((row) => {
                      const sev = severityClasses(row.severity);
                      return (
                        <div key={row.id} className="px-6 py-5">
                          <div className="flex items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${sev.pill}`}>
                                  {sev.icon}
                                  {row.severity.toUpperCase()}
                                </span>
                                <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold ${statusClasses(row.status)}`}>
                                  {row.status}
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {timeAgo(row.last_seen_at)}
                                </span>
                              </div>

                              <div className="mt-3 text-sm font-semibold text-slate-900">
                                {row.title}
                              </div>

                              {row.message && (
                                <div className="mt-1 text-sm text-slate-600 font-mono bg-slate-50 p-2 rounded-lg border border-slate-100 line-clamp-2">
                                  {row.message}
                                </div>
                              )}

                              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                                  {row.event_type}
                                </span>
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                                  {row.source}
                                </span>
                                {row.route && (
                                  <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                                    {row.route}
                                  </span>
                                )}
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium">
                                  hits: {row.occurrence_count}
                                </span>
                              </div>
                            </div>

                            <div className="shrink-0 text-right">
                              <div className="text-[11px] text-slate-400 uppercase tracking-tighter">first seen</div>
                              <div className="text-xs font-medium text-slate-600">
                                {timeAgo(row.first_seen_at)}
                              </div>
                              <div className="mt-3 text-[11px] text-slate-400 uppercase tracking-tighter">last seen</div>
                              <div className="text-xs font-medium text-slate-600">
                                {timeAgo(row.last_seen_at)}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-6 py-4">
                    <h2 className="text-base font-semibold text-slate-900">Top affected routes</h2>
                  </div>
                  <div className="p-4">
                    {topRoutes.length === 0 ? (
                      <div className="px-2 py-6 text-sm text-slate-500">No route-level incidents yet.</div>
                    ) : (
                      <div className="space-y-2">
                        {topRoutes.map(([route, count]) => (
                          <div
                            key={route}
                            className="flex items-center justify-between rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3"
                          >
                            <div className="min-w-0 pr-3 text-sm font-medium text-slate-700 truncate">
                              {route}
                            </div>
                            <div className="shrink-0 rounded-full bg-slate-200 px-2.5 py-1 text-xs font-bold text-slate-700">
                              {count}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-100 px-6 py-4">
                    <h2 className="text-base font-semibold text-slate-900">Monitoring Status</h2>
                  </div>
                  <div className="p-5 text-sm text-slate-600 space-y-3">
                    <div className="flex items-start gap-3">
                      <ChevronRight className="mt-0.5 h-4 w-4 text-cyan-500" />
                      <span><strong>Boundary Check:</strong> Active</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <ChevronRight className="mt-0.5 h-4 w-4 text-cyan-500" />
                      <span><strong>UI Shielding:</strong> Enabled</span>
                    </div>
                    <div className="flex items-start gap-3">
                      <ChevronRight className="mt-0.5 h-4 w-4 text-cyan-500" />
                      <span><strong>Deduplication:</strong> Fingerprinting on</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}