// src/app/changes/ChangesClient.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Loader2, Search } from "lucide-react";

type Row = {
  id: string;
  public_id?: string | null;
  seq?: number | null;

  project_id: string;
  artifact_id?: string | null;

  title?: string | null;
  description?: string | null;

  status?: string | null;
  delivery_status?: string | null;
  priority?: string | null;

  decision_status?: string | null;
  decision_at?: string | null;

  updated_at?: string | null;
  created_at?: string | null;

  requester_name?: string | null;
  requester_id?: string | null;

  projects?: { id?: string; title?: string | null; project_code?: any } | null;
};

type ApiResp =
  | { ok: false; error: string }
  | {
      ok: true;
      items: Row[];
      nextCursor: string | null;
      facets?: { priorities?: string[]; statuses?: string[] };
    };

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function fmtUkDate(x?: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return String(x);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(d);
}

function normPriority(p: any) {
  const v = safeStr(p).trim().toLowerCase();
  if (!v) return "";
  if (v === "critical") return "Critical";
  if (v === "high") return "High";
  if (v === "medium") return "Medium";
  if (v === "low") return "Low";
  return safeStr(p).trim();
}

function badge(priority: string) {
  const p = priority.toLowerCase();
  if (p === "critical") return "border-rose-600/40 bg-rose-50 text-rose-800";
  if (p === "high") return "border-amber-600/40 bg-amber-50 text-amber-800";
  if (p === "medium") return "border-slate-300 bg-slate-50 text-slate-700";
  return "border-slate-300 bg-white text-slate-700";
}

function statusBadge(s: string) {
  const v = s.toLowerCase();
  if (v === "review" || v === "analysis") return "border-amber-600/40 bg-amber-50 text-amber-800";
  if (v === "implemented") return "border-emerald-600/40 bg-emerald-50 text-emerald-800";
  if (v === "closed") return "border-slate-300 bg-slate-50 text-slate-700";
  if (v === "in_progress") return "border-blue-600/40 bg-blue-50 text-blue-800";
  return "border-slate-300 bg-white text-slate-700";
}

function projectLabel(r: Row) {
  const code = r?.projects?.project_code;
  const title = safeStr(r?.projects?.title) || "Project";
  const codeStr = code != null ? String(code) : "";
  return codeStr ? `${codeStr} • ${title}` : title;
}

/**
 * ✅ Deep-link straight to the CR inside the project Change Board (Kanban)
 * - /projects/:projectId/change?cr=<uuid>&publicId=<cr-123>
 */
function openHref(r: Row) {
  const pid = safeStr(r.project_id).trim();
  if (!pid) return "/projects";

  const sp = new URLSearchParams();
  sp.set("cr", safeStr(r.id).trim());
  const pub = safeStr(r.public_id).trim();
  if (pub) sp.set("publicId", pub);

  return `/projects/${pid}/change?${sp.toString()}`;
}

export default function ChangesClient({
  initialQ,
  initialPriority,
  initialStale,
}: {
  initialQ: string;
  initialPriority: string;
  initialStale: boolean;
}) {
  const router = useRouter();

  const [q, setQ] = useState(initialQ);
  const [priority, setPriority] = useState(initialPriority); // CSV
  const [stale, setStale] = useState(initialStale);

  const [items, setItems] = useState<Row[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState("");

  // ✅ keep URL in sync so briefing links + refresh work
  // IMPORTANT: This is the portfolio page => /changes (NOT /change)
  useEffect(() => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (priority.trim()) qs.set("priority", priority.trim());
    if (stale) qs.set("stale", "1");

    const href = qs.toString() ? `/changes?${qs.toString()}` : "/changes";
    router.replace(href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, priority, stale]);

  const params = useMemo(() => {
    const qs = new URLSearchParams();
    if (q.trim()) qs.set("q", q.trim());
    if (priority.trim()) qs.set("priority", priority.trim());
    if (stale) qs.set("stale", "1");
    qs.set("limit", "60");
    return qs;
  }, [q, priority, stale]);

  async function loadFirst() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`/api/change/portfolio?${params.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as ApiResp;
      if (!j.ok) throw new Error((j as any).error || "Failed to load");
      setItems(Array.isArray(j.items) ? j.items : []);
      setCursor(j.nextCursor ?? null);
    } catch (e: any) {
      setItems([]);
      setCursor(null);
      setErr(e?.message || "Failed to load changes");
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setErr("");
    try {
      const qs = new URLSearchParams(params);
      qs.set("cursor", cursor);
      const r = await fetch(`/api/change/portfolio?${qs.toString()}`, { cache: "no-store" });
      const j = (await r.json()) as ApiResp;
      if (!j.ok) throw new Error((j as any).error || "Failed to load more");
      const next = Array.isArray(j.items) ? j.items : [];
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        return [...prev, ...next.filter((x) => !seen.has(x.id))];
      });
      setCursor(j.nextCursor ?? null);
    } catch (e: any) {
      setErr(e?.message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.toString()]);

  return (
    <div className="min-h-screen bg-white text-gray-900 font-['Inter','system-ui',sans-serif]">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex items-start justify-between gap-6 mb-8">
          <div>
            <h1 className="text-4xl font-bold tracking-tight text-gray-900">Change Control</h1>
            <p className="mt-3 text-lg text-gray-600">
              Portfolio view across your projects — filter, scan, and open the source.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Back to Dashboard
            </Link>
            <button
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => loadFirst()}
              disabled={loading}
            >
              Refresh
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-col md:flex-row gap-4 items-end">
            <div className="flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search (title, public id, priority)…"
                className="w-full pl-11 pr-4 py-3 rounded-lg border border-gray-300 text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 outline-none"
              />
            </div>

            <div className="flex items-center gap-3 w-full md:w-auto">
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full md:w-[240px] px-4 py-3 rounded-lg border border-gray-300 bg-white text-gray-700 focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
                title="Priority filter"
              >
                <option value="">All priorities</option>
                <option value="High,Critical">High + Critical</option>
                <option value="Critical">Critical</option>
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>

              <button
                type="button"
                onClick={() => setStale((v) => !v)}
                className={[
                  "px-4 py-3 rounded-lg border text-sm font-medium transition",
                  stale
                    ? "border-amber-600 bg-amber-50 text-amber-800"
                    : "border-gray-300 bg-white text-gray-700 hover:bg-gray-50",
                ].join(" ")}
                title="Show stale items (no updates for 14+ days)"
              >
                Stale
              </button>

              <button
                className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-medium transition"
                onClick={() => loadFirst()}
                disabled={loading}
              >
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    Loading
                  </span>
                ) : (
                  "Apply"
                )}
              </button>
            </div>
          </div>

          {err && (
            <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-4 text-rose-800 flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span>{err}</span>
            </div>
          )}
        </div>

        {/* Table */}
        <div className="mt-8 rounded-xl border border-gray-200 bg-white overflow-hidden shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-gray-50">
            <div className="font-semibold text-lg text-gray-900">Change Requests</div>
            {loading ? (
              <div className="text-sm text-gray-500">Loading…</div>
            ) : (
              <div className="text-sm text-gray-500">{items.length} items</div>
            )}
          </div>

          <div className="w-full overflow-x-auto">
            <table className="w-full text-sm text-gray-700">
              <thead className="text-gray-600 bg-gray-50">
                <tr className="border-b border-gray-200">
                  <th className="text-left font-semibold px-6 py-4">Project</th>
                  <th className="text-left font-semibold px-6 py-4">CR</th>
                  <th className="text-left font-semibold px-6 py-4">Title</th>
                  <th className="text-left font-semibold px-6 py-4">Priority</th>
                  <th className="text-left font-semibold px-6 py-4">Status</th>
                  <th className="text-left font-semibold px-6 py-4">Updated</th>
                  <th className="text-right font-semibold px-6 py-4"></th>
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td className="px-6 py-12 text-gray-500 text-center" colSpan={7}>
                      Loading change requests…
                    </td>
                  </tr>
                ) : items.length ? (
                  items.map((r) => {
                    const pri = normPriority(r.priority);
                    const lane = safeStr(r.delivery_status || r.status || "new")
                      .trim()
                      .replace(/\s+/g, "_")
                      .toLowerCase();

                    const pub = safeStr(r.public_id) || (r.seq != null ? `CR-${r.seq}` : "");
                    const title = safeStr(r.title) || "Untitled change";

                    return (
                      <tr key={r.id} className="border-b border-gray-100 hover:bg-gray-50 transition">
                        <td className="px-6 py-4 font-medium text-gray-900 min-w-[260px]">
                          {projectLabel(r)}
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="font-mono text-gray-900">{pub || r.id.slice(0, 8)}</span>
                        </td>

                        <td className="px-6 py-4 min-w-[420px]">
                          <div className="font-medium text-gray-900">{title}</div>
                          {r.requester_name ? (
                            <div className="text-xs text-gray-500 mt-1">Requester: {r.requester_name}</div>
                          ) : null}
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={[
                              "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium",
                              badge(pri || "Medium"),
                            ].join(" ")}
                          >
                            {pri || "—"}
                          </span>
                        </td>

                        <td className="px-6 py-4">
                          <span
                            className={[
                              "inline-flex items-center rounded-full border px-3 py-1.5 text-xs font-medium",
                              statusBadge(lane),
                            ].join(" ")}
                          >
                            {lane}
                          </span>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">{fmtUkDate(r.updated_at || r.created_at)}</td>

                        <td className="px-6 py-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 transition font-medium"
                            onClick={() => router.push(openHref(r))}
                            title="Open this CR on the project change board"
                          >
                            Open <ArrowUpRight className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td className="px-6 py-12 text-gray-500 text-center" colSpan={7}>
                      No change requests found for this filter.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="px-6 py-4 flex items-center justify-between">
            <div className="text-sm text-gray-500">{cursor ? "More available" : items.length ? "End of list" : ""}</div>
            {cursor ? (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 text-sm font-medium transition disabled:opacity-60"
              >
                {loadingMore ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading…
                  </span>
                ) : (
                  "Load more"
                )}
              </button>
            ) : null}
          </div>
        </div>

        <div className="h-10" />
      </div>
    </div>
  );
}