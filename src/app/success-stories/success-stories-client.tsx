"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Sparkles,
  Filter,
  CheckCircle2,
  ShieldCheck,
  AlertTriangle,
  Clock3,
  CircleDollarSign,
} from "lucide-react";

type StoryCategory = "Commercial" | "Delivery" | "Risk" | "Governance" | "Learning";

type SuccessStory = {
  id: string;
  category: StoryCategory | string;
  title: string;
  summary: string;
  value_label?: string | null;
  project_id?: string | null;
  project_title?: string | null;
  href?: string | null;
  happened_at?: string | null;
  happened_at_uk?: string | null;
};

type ApiOk = {
  ok: true;
  days: number;
  items: SuccessStory[];
  projects: { id: string; title: string }[];
};
type ApiErr = { ok: false; error: string };
type ApiResp = ApiOk | ApiErr;

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function clampDays(n: any): 7 | 14 | 30 | 60 {
  const v = Number(n);
  return v === 7 || v === 14 || v === 30 || v === 60 ? v : 30;
}

function fmtDateUK(x?: string | null) {
  if (!x) return "—";
  const s = String(x).trim();
  if (!s) return "—";

  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (!yyyy || !mm || !dd) return "—";
    return `${String(dd).padStart(2, "0")}/${String(mm).padStart(2, "0")}/${String(yyyy)}`;
  }

  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getUTCFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function catIcon(cat: string) {
  const c = (cat || "").toLowerCase();
  if (c.includes("commercial")) return <CircleDollarSign className="h-4 w-4" />;
  if (c.includes("delivery")) return <Clock3 className="h-4 w-4" />;
  if (c.includes("risk")) return <AlertTriangle className="h-4 w-4" />;
  if (c.includes("govern")) return <ShieldCheck className="h-4 w-4" />;
  if (c.includes("learn")) return <Sparkles className="h-4 w-4" />;
  return <CheckCircle2 className="h-4 w-4" />;
}

function catColor(cat: string): string {
  const c = (cat || "").toLowerCase();
  if (c.includes("commercial")) return "text-amber-600 bg-amber-50";
  if (c.includes("delivery")) return "text-blue-600 bg-blue-50";
  if (c.includes("risk")) return "text-rose-600 bg-rose-50";
  if (c.includes("govern")) return "text-purple-600 bg-purple-50";
  if (c.includes("learn")) return "text-emerald-600 bg-emerald-50";
  return "text-slate-600 bg-slate-100";
}

export default function SuccessStoriesClient({
  initialDays,
  initialProjectId,
  initialCategory,
  initialForecastVariance,
}: {
  initialDays: number;
  initialProjectId?: string;
  initialCategory?: string;
  initialForecastVariance?: string;
}) {
  const [days, setDays] = useState<7 | 14 | 30 | 60>(clampDays(initialDays));
  const [projectId, setProjectId] = useState<string>(safeStr(initialProjectId));
  const [category, setCategory] = useState<string>(safeStr(initialCategory));
  const [loading, setLoading] = useState<boolean>(true);
  const [err, setErr] = useState<string>("");
  const [items, setItems] = useState<SuccessStory[]>([]);
  const [projects, setProjects] = useState<{ id: string; title: string }[]>([]);

  const fvNum = useMemo(() => {
    const n = Number(initialForecastVariance);
    return Number.isFinite(n) ? n : null;
  }, [initialForecastVariance]);

  const url = useMemo(() => {
    const u = new URL("/api/success-stories", window.location.origin);
    u.searchParams.set("days", String(days));
    if (projectId) u.searchParams.set("projectId", projectId);
    if (category) u.searchParams.set("category", category);
    if (fvNum != null) u.searchParams.set("fv", String(fvNum));
    return u.toString();
  }, [days, projectId, category, fvNum]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setErr("");
        const r = await fetch(url, { cache: "no-store" });
        const j = (await r.json()) as ApiResp;
        if (!j?.ok) throw new Error((j as any)?.error || "Failed to load");
        if (cancelled) return;
        setItems(Array.isArray(j.items) ? j.items : []);
        setProjects(Array.isArray(j.projects) ? j.projects : []);
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message || "Failed to load");
        setItems([]);
        setProjects([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  const categories = useMemo(() => {
    const base = ["Commercial", "Delivery", "Risk", "Governance", "Learning"];
    const set = new Set<string>(base);
    for (const it of items) set.add(String(it.category || ""));
    return Array.from(set).filter(Boolean).sort();
  }, [items]);

  return (
    <div className="space-y-6">
      {/* Controls - Light theme */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm p-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-2 text-slate-700">
            <Filter className="h-4 w-4 text-[#00B8DB]" />
            <span className="font-semibold text-sm">Filters</span>
            <span className="text-slate-300">•</span>
            <span className="text-sm text-slate-500">Window: {days} days</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {[7, 14, 30, 60].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d as any)}
                className={[
                  "px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors",
                  days === d
                    ? "bg-[#00B8DB] text-white border-[#00B8DB]"
                    : "bg-white text-slate-600 border-slate-200 hover:border-[#00B8DB] hover:text-[#00B8DB]",
                ].join(" ")}
              >
                {d}d
              </button>
            ))}

            <select
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:border-[#00B8DB]"
            >
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>

            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-700 focus:outline-none focus:border-[#00B8DB]"
            >
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>

            <Link
              href={`/success-stories?days=${days}`}
              className="px-3 py-2 rounded-lg border border-slate-200 bg-white text-sm text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors"
              title="Reset filters"
            >
              Reset
            </Link>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 text-slate-500">
          <div className="h-4 w-4 border-2 border-slate-300 border-t-[#00B8DB] rounded-full animate-spin" />
          Loading success stories…
        </div>
      ) : err ? (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-700 text-sm">{err}</div>
      ) : !items.length ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-slate-500">
          No success stories found in the last {days} days.
          <div className="mt-2 text-slate-400 text-sm">
            Tip: complete milestones, close risks/issues, implement changes, complete WBS items, and publish positive
            lessons.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {items.map((s) => {
            const dateLabel = s.happened_at_uk ? s.happened_at_uk : fmtDateUK(s.happened_at);
            const catStyle = catColor(String(s.category));

            return (
              <div
                key={s.id}
                className="group rounded-xl border-2 border-transparent bg-white p-5 shadow-sm hover:border-[#00B8DB] hover:shadow-md transition-all cursor-pointer"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {/* Header */}
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`p-1.5 rounded-lg ${catStyle}`}>
                        {catIcon(String(s.category))}
                      </div>
                      <span className="text-sm font-medium text-slate-600">{s.category}</span>
                      <span className="text-slate-300">•</span>
                      <span className="text-sm text-slate-400">{dateLabel}</span>
                    </div>

                    {/* Title */}
                    <h3 className="text-lg font-bold text-slate-900 mb-2 group-hover:text-[#00B8DB] transition-colors">
                      {s.title}
                    </h3>
                    
                    {/* Summary */}
                    <p className="text-sm text-slate-600 leading-relaxed mb-4">
                      {s.summary}
                    </p>

                    {/* Tags */}
                    <div className="flex flex-wrap items-center gap-2">
                      {s.project_title ? (
                        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
                          Project: {s.project_title}
                        </span>
                      ) : null}

                      {s.value_label ? (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-600 border border-emerald-100">
                          {s.value_label}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {s.href ? (
                    <Link
                      href={s.href}
                      className="shrink-0 inline-flex items-center gap-1 text-sm font-semibold text-[#00B8DB] hover:underline"
                      title="Open source artifact"
                    >
                      View <ArrowUpRight className="h-4 w-4" />
                    </Link>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-slate-400">
        Stories are derived from positive transitions (e.g., milestones completed, RAID mitigated/closed, changes
        implemented, WBS done, positive/published lessons).
      </div>
    </div>
  );
}
