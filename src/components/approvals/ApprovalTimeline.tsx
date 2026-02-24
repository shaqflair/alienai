"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  ShieldAlert,
  UserCog,
  FileCheck,
  RefreshCcw,
} from "lucide-react";

type TimelineEvent = {
  id: string;
  created_at: string;
  action_type: string;
  actor_user_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  comment: string | null;
  meta: any;
  step_id: string | null;
  artifact_id: string | null;
  change_id: string | null;
};

type Props = {
  projectId: string;
  artifactId?: string | null;
  changeId?: string | null;
  className?: string;
  title?: string;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function ukDateTime(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeStr(iso);
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function dayKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
}

function pillTone(action: string) {
  const a = action.toLowerCase();
  if (a.includes("approved")) return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (a.includes("rejected")) return "bg-rose-50 text-rose-700 ring-rose-200";
  if (a.includes("returned") || a.includes("request")) return "bg-amber-50 text-amber-800 ring-amber-200";
  if (a.includes("submitted")) return "bg-indigo-50 text-indigo-700 ring-indigo-200";
  if (a.includes("delegated")) return "bg-sky-50 text-sky-800 ring-sky-200";
  if (a.includes("escal")) return "bg-fuchsia-50 text-fuchsia-800 ring-fuchsia-200";
  if (a.includes("sla") || a.includes("breach")) return "bg-red-50 text-red-700 ring-red-200";
  return "bg-slate-50 text-slate-700 ring-slate-200";
}

function iconFor(action: string) {
  const a = action.toLowerCase();
  if (a.includes("approved")) return CheckCircle2;
  if (a.includes("rejected")) return XCircle;
  if (a.includes("returned") || a.includes("request")) return RefreshCcw;
  if (a.includes("submitted")) return FileCheck;
  if (a.includes("delegated")) return UserCog;
  if (a.includes("sla") || a.includes("breach")) return ShieldAlert;
  if (a.includes("escal")) return ArrowUpRight;
  return Clock;
}

function humanAction(action: string) {
  const a = action.trim();
  if (!a) return "Event";
  const s = a.replace(/[_-]+/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function prettyMeta(meta: any) {
  if (!meta) return null;
  try {
    const json = typeof meta === "string" ? JSON.parse(meta) : meta;
    const keys = Object.keys(json || {});
    if (!keys.length) return null;
    const slim: Record<string, any> = {};
    for (const k of keys.slice(0, 6)) slim[k] = json[k];
    return JSON.stringify(slim, null, 2);
  } catch {
    const s = safeStr(meta);
    return s.length > 600 ? s.slice(0, 600) + "…" : s;
  }
}

async function apiGet(url: string) {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    const err = data?.error || `Request failed (${res.status})`;
    throw new Error(err);
  }
  return data;
}

export default function ApprovalTimeline({
  projectId,
  artifactId,
  changeId,
  className,
  title = "Approval Audit Timeline",
}: Props) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set("project_id", projectId);
    if (artifactId) p.set("artifact_id", artifactId);
    if (changeId) p.set("change_id", changeId);
    p.set("limit", "250");
    return `/api/approvals/timeline?${p.toString()}`;
  }, [projectId, artifactId, changeId]);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = await apiGet(query);
      setEvents(Array.isArray(data.events) ? data.events : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load timeline");
      setEvents([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [query]);

  const grouped = useMemo(() => {
    const m = new Map<string, TimelineEvent[]>();
    for (const ev of events) {
      const k = dayKey(ev.created_at);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(ev);
    }
    return Array.from(m.entries());
  }, [events]);

  return (
    <div className={className}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900">{title}</div>
          <div className="mt-1 text-xs text-slate-600">
            Forensic history of submissions, decisions, delegation, escalations, and SLA events.
          </div>
        </div>

        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          <RefreshCcw className="h-4 w-4" />
          Refresh
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-slate-200 bg-white">
        {loading ? (
          <div className="p-5 text-sm text-slate-600">Loading timeline…</div>
        ) : err ? (
          <div className="p-5">
            <div className="text-sm font-medium text-rose-700">Couldn’t load timeline</div>
            <div className="mt-1 text-xs text-slate-600">{err}</div>
          </div>
        ) : events.length === 0 ? (
          <div className="p-5">
            <div className="text-sm font-medium text-slate-900">No events yet</div>
            <div className="mt-1 text-xs text-slate-600">
              This timeline will populate as users submit / approve / reject / delegate / escalate approvals.
            </div>
          </div>
        ) : (
          <div className="p-5">
            <div className="space-y-6">
              {grouped.map(([day, items]) => (
                <div key={day}>
                  <div className="mb-3 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-slate-300" />
                    <div className="text-xs font-semibold text-slate-700">{day}</div>
                    <div className="ml-auto text-[11px] text-slate-500">{items.length} event(s)</div>
                  </div>

                  <div className="space-y-3">
                    {items.map((ev, idx) => {
                      const Icon = iconFor(ev.action_type);
                      const meta = prettyMeta(ev.meta);
                      const actor = ev.actor_name || (ev.actor_user_id ? "User" : "System");
                      const role = ev.actor_role ? ` · ${ev.actor_role}` : "";
                      const isLastInGroup = idx === items.length - 1;

                      return (
                        <div key={ev.id} className="relative pl-9">
                          {!isLastInGroup && (
                            <div className="absolute left-3 top-7 h-full w-px bg-slate-200" />
                          )}

                          <div className="absolute left-0 top-1">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white shadow-sm">
                              <Icon className="h-4 w-4 text-slate-700" />
                            </div>
                          </div>

                          <div className="rounded-xl border border-slate-200 bg-slate-50/40 p-4">
                            <div className="flex flex-wrap items-center gap-2">
                              <span
                                className={[
                                  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset",
                                  pillTone(ev.action_type),
                                ].join(" ")}
                              >
                                {humanAction(ev.action_type)}
                              </span>

                              <div className="text-xs text-slate-700">
                                <span className="font-semibold">{actor}</span>
                                <span className="text-slate-500">{role}</span>
                              </div>

                              <div className="ml-auto text-[11px] text-slate-500">
                                {ukDateTime(ev.created_at)}
                              </div>
                            </div>

                            {ev.comment ? (
                              <div className="mt-2 text-sm text-slate-800 whitespace-pre-wrap">
                                {ev.comment}
                              </div>
                            ) : null}

                            {meta ? (
                              <details className="mt-3">
                                <summary className="cursor-pointer text-xs font-medium text-slate-700">
                                  Metadata
                                </summary>
                                <pre className="mt-2 overflow-auto rounded-lg border border-slate-200 bg-white p-3 text-[11px] text-slate-700">
                                  {meta}
                                </pre>
                              </details>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 border-t border-slate-200 pt-4 text-[11px] text-slate-500">
              Tip: Add SLA events (e.g. <span className="font-medium">sla-breached</span>) and escalation events to unlock
              “Approval Risk” panels in the cockpit.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
