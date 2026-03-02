"use client";

export const dynamic = "force-dynamic";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Trophy, TrendingUp, Star, CheckCircle2, ShieldCheck,
  BookOpen, Layers, ChevronRight, RefreshCw, Filter,
  Calendar, ArrowUpRight, ArrowDownRight, Minus,
  AlertTriangle, Sparkles, Clock3, X, ExternalLink,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

type Days = 7 | 14 | 30 | 60;

type StoryItem = {
  id: string;
  category: string;
  title: string;
  summary: string;
  value_label?: string | null;
  project_id?: string | null;
  project_title?: string | null;
  href?: string | null;
  happened_at?: string | null;
  happened_at_uk?: string | null;
};

type SummaryData = {
  ok: boolean;
  days: number;
  score: number;
  prev_score: number;
  delta: number;
  count: number;
  breakdown: {
    milestones_done: number;
    wbs_done: number;
    raid_resolved: number;
    changes_delivered: number;
    lessons_positive: number;
  };
  top: StoryItem[];
};

type StoriesData = {
  ok: boolean;
  days: number;
  items: StoryItem[];
  projects: { id: string; title: string }[];
  meta: {
    total_items: number;
    project_count: number;
  };
};

// ─────────────────────────────────────────────────────────────────────────────
// UTILS
// ─────────────────────────────────────────────────────────────────────────────

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }

function catConfig(cat: string): {
  icon: React.ReactNode;
  bg: string;
  border: string;
  badge: string;
  badgeText: string;
  dot: string;
} {
  const c = cat.toLowerCase();
  if (c === "delivery")   return { icon: <CheckCircle2 className="h-4 w-4" />, bg: "bg-blue-50",   border: "border-blue-100",  badge: "bg-blue-100 text-blue-700",   badgeText: "Delivery",   dot: "#3b82f6" };
  if (c === "risk")        return { icon: <ShieldCheck  className="h-4 w-4" />, bg: "bg-green-50",  border: "border-green-100", badge: "bg-green-100 text-green-700", badgeText: "Risk",        dot: "#22c55e" };
  if (c === "governance") return { icon: <Layers       className="h-4 w-4" />, bg: "bg-purple-50", border: "border-purple-100",badge: "bg-purple-100 text-purple-700",badgeText: "Governance", dot: "#a855f7" };
  if (c === "learning")   return { icon: <BookOpen     className="h-4 w-4" />, bg: "bg-amber-50",  border: "border-amber-100", badge: "bg-amber-100 text-amber-700", badgeText: "Learning",   dot: "#f59e0b" };
  if (c === "commercial") return { icon: <TrendingUp   className="h-4 w-4" />, bg: "bg-emerald-50",border: "border-emerald-100",badge: "bg-emerald-100 text-emerald-700",badgeText:"Commercial",dot: "#10b981" };
  return { icon: <Star className="h-4 w-4" />, bg: "bg-gray-50", border: "border-gray-100", badge: "bg-gray-100 text-gray-600", badgeText: cat, dot: "#6b7280" };
}

function scoreColor(s: number) {
  if (s >= 75) return { text: "text-green-600", bg: "bg-green-50", ring: "#22c55e" };
  if (s >= 50) return { text: "text-amber-600", bg: "bg-amber-50", ring: "#f59e0b" };
  return { text: "text-red-500", bg: "bg-red-50", ring: "#ef4444" };
}

function timeAgo(iso: string | null | undefined) {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const d = Math.floor(ms / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7)  return `${d} days ago`;
  if (d < 31) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCORE RING
// ─────────────────────────────────────────────────────────────────────────────

function ScoreRing({ score, size = 120 }: { score: number; size?: number }) {
  const r = (size - 16) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score));
  const dash = (pct / 100) * circ;
  const cfg = scoreColor(score);

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f1f5f9" strokeWidth="8" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={cfg.ring}
          strokeWidth="8" strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: "stroke-dasharray 1s ease" }} />
      </svg>
      <div className="absolute text-center">
        <div className={`text-2xl font-bold leading-none ${cfg.text}`}>{pct}</div>
        <div className="text-[10px] text-gray-400 font-semibold mt-0.5">score</div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WIN CARD
// ─────────────────────────────────────────────────────────────────────────────

function WinCard({ item, onClick }: { item: StoryItem; onClick?: () => void }) {
  const cfg = catConfig(item.category);
  const ago = timeAgo(item.happened_at);

  return (
    <div
      onClick={onClick}
      className={[
        "rounded-2xl border p-5 transition-all duration-200",
        cfg.bg, cfg.border,
        onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : "",
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className={["flex items-center gap-2 text-xs font-semibold rounded-full px-2.5 py-1", cfg.badge].join(" ")}>
          {cfg.icon}
          {cfg.badgeText}
        </div>
        {ago && <span className="text-[11px] text-gray-400 shrink-0 mt-0.5">{ago}</span>}
      </div>

      <h3 className="text-sm font-bold text-gray-900 mb-1 leading-snug">{item.title}</h3>
      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2 mb-3">{item.summary}</p>

      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          {item.project_title && (
            <span className="text-[11px] font-semibold text-gray-500 truncate block">
              {item.project_title}
            </span>
          )}
          {item.happened_at_uk && (
            <span className="text-[10px] text-gray-400">{item.happened_at_uk}</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {item.value_label && (
            <span className="text-[10px] font-bold text-gray-500 bg-white/80 border border-gray-200 rounded-full px-2 py-0.5">
              {item.value_label}
            </span>
          )}
          {item.href && <ExternalLink className="h-3.5 w-3.5 text-gray-400" />}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BREAKDOWN BAR
// ─────────────────────────────────────────────────────────────────────────────

function BreakdownBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-28 text-xs font-medium text-gray-500 shrink-0">{label}</div>
      <div className="flex-1 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700"
          style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="w-6 text-xs font-bold text-gray-700 text-right shrink-0">{value}</div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORIES = ["All", "Delivery", "Risk", "Governance", "Learning", "Commercial"];
const DAYS_OPTIONS: Days[] = [7, 14, 30, 60];

export default function SuccessStoriesPage() {
  const router = useRouter();

  const [days,        setDays]        = useState<Days>(30);
  const [category,    setCategory]    = useState("All");
  const [projectId,   setProjectId]   = useState("");
  const [summary,     setSummary]     = useState<SummaryData | null>(null);
  const [stories,     setStories]     = useState<StoriesData | null>(null);
  const [sumLoading, setSumLoading] = useState(true);
  const [stoLoading, setStoLoading] = useState(true);
  const [selected,    setSelected]    = useState<StoryItem | null>(null);

  const fetchSummary = useCallback(async () => {
    setSumLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (projectId) params.set("projectId", projectId);
      const r = await fetch(`/api/success-stories/summary?${params}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) setSummary(j);
    } catch {}
    finally { setSumLoading(false); }
  }, [days, projectId]);

  const fetchStories = useCallback(async () => {
    setStoLoading(true);
    try {
      const params = new URLSearchParams({ days: String(days) });
      if (projectId) params.set("projectId", projectId);
      if (category !== "All") params.set("category", category);
      const r = await fetch(`/api/success-stories?${params}`, { cache: "no-store" });
      const j = await r.json().catch(() => null);
      if (j?.ok) setStories(j);
    } catch {}
    finally { setStoLoading(false); }
  }, [days, projectId, category]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);
  useEffect(() => { fetchStories(); }, [fetchStories]);

  const projects = stories?.projects ?? [];
  const items = stories?.items ?? [];
  const bd = summary?.breakdown;
  const bdMax = bd ? Math.max(
    bd.milestones_done, bd.wbs_done, bd.raid_resolved,
    bd.changes_delivered, bd.lessons_positive, 1
  ) : 1;
  const totalWins = summary?.count ?? 0;
  const score = summary?.score ?? 0;
  const delta = summary?.delta ?? 0;
  const scoreCfg = scoreColor(score);

  const catCounts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const it of items) {
      const c = it.category || "Other";
      m[c] = (m[c] ?? 0) + 1;
    }
    return m;
  }, [items]);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        .ss-root { font-family: 'Plus Jakarta Sans', sans-serif; }
      `}</style>

      {selected && (
        <>
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm"
            onClick={() => setSelected(null)} />
          <div className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[60]
            w-full max-w-lg rounded-2xl bg-white border border-gray-200 shadow-2xl p-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className={["flex items-center gap-2 text-xs font-semibold rounded-full px-3 py-1.5", catConfig(selected.category).badge].join(" ")}>
                {catConfig(selected.category).icon}
                {selected.category}
              </div>
              <button onClick={() => setSelected(null)}
                className="h-8 w-8 rounded-xl hover:bg-gray-100 flex items-center justify-center transition-colors">
                <X className="h-4 w-4 text-gray-400" />
              </button>
            </div>
            <h2 className="text-lg font-bold text-gray-900 mb-2">{selected.title}</h2>
            <p className="text-sm text-gray-600 leading-relaxed mb-4">{selected.summary}</p>
            <div className="space-y-2 mb-5">
              {selected.project_title && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-20 shrink-0">Project</span>
                  <span className="font-semibold text-gray-700">{selected.project_title}</span>
                </div>
              )}
              {selected.happened_at_uk && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-20 shrink-0">Date</span>
                  <span className="font-semibold text-gray-700">{selected.happened_at_uk}</span>
                </div>
              )}
              {selected.value_label && (
                <div className="flex items-center gap-2 text-sm">
                  <span className="text-gray-400 w-20 shrink-0">Status</span>
                  <span className="font-semibold text-gray-700">{selected.value_label}</span>
                </div>
              )}
            </div>
            {selected.href && (
              <button
                onClick={() => { setSelected(null); router.push(selected.href!); }}
                className="w-full h-10 rounded-xl bg-blue-600 text-white text-sm font-semibold
                  flex items-center justify-center gap-2 hover:bg-blue-700 transition-colors">
                View in project <ExternalLink className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </>
      )}

      <div className="ss-root min-h-screen" style={{ background: "#f8fafc" }}>
        <div className="bg-white border-b border-gray-100" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
          <div className="max-w-screen-xl mx-auto px-6 py-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <button onClick={() => router.push("/")}
                  className="h-9 w-9 rounded-xl border border-gray-200 flex items-center justify-center hover:bg-gray-50 transition-colors">
                  <ChevronRight className="h-4 w-4 text-gray-400 rotate-180" />
                </button>
                <div>
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-xl bg-amber-100 flex items-center justify-center">
                      <Trophy className="h-4 w-4 text-amber-600" />
                    </div>
                    <h1 className="text-xl font-bold text-gray-900">Success Stories</h1>
                  </div>
                  <p className="text-sm text-gray-400 mt-0.5 ml-10">
                    Celebrating delivery wins, resolved risks and positive outcomes
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 flex-wrap justify-end">
                {projects.length > 0 && (
                  <select
                    value={projectId}
                    onChange={e => setProjectId(e.target.value)}
                    className="h-9 rounded-xl border border-gray-200 bg-white px-3 text-xs font-medium text-gray-600
                      outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100 transition-all"
                  >
                    <option value="">All projects</option>
                    {projects.map(p => (
                      <option key={p.id} value={p.id}>{p.title}</option>
                    ))}
                  </select>
                )}
                <div className="flex items-center gap-0.5 p-1 rounded-xl bg-gray-100">
                  {DAYS_OPTIONS.map(d => (
                    <button key={d} type="button" onClick={() => setDays(d)}
                      className={["px-3 py-1.5 rounded-lg text-xs font-semibold transition-all",
                        days === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"].join(" ")}>
                      {d}d
                    </button>
                  ))}
                </div>
                <button onClick={() => { fetchSummary(); fetchStories(); }}
                  className="h-9 w-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors"
                  title="Refresh">
                  <RefreshCw className="h-3.5 w-3.5 text-gray-400" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-screen-xl mx-auto px-6 py-6 space-y-5">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="bg-white rounded-2xl border border-gray-100 p-6 flex items-center gap-6"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              {sumLoading ? (
                <div className="w-[120px] h-[120px] rounded-full bg-gray-100 animate-pulse shrink-0" />
              ) : (
                <ScoreRing score={score} />
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">
                  Momentum Score
                </div>
                {sumLoading ? (
                  <div className="space-y-2">
                    <div className="h-7 w-24 bg-gray-100 rounded animate-pulse" />
                    <div className="h-4 w-32 bg-gray-100 rounded animate-pulse" />
                  </div>
                ) : (
                  <>
                    <div className={`text-3xl font-bold ${scoreCfg.text}`}>{score}<span className="text-lg text-gray-400">/100</span></div>
                    <div className="flex items-center gap-1.5 mt-1.5">
                      {delta > 0 ? (
                        <><ArrowUpRight className="h-3.5 w-3.5 text-green-500" /><span className="text-xs font-semibold text-green-600">+{Math.abs(Math.round(delta))} vs prev period</span></>
                      ) : delta < 0 ? (
                        <><ArrowDownRight className="h-3.5 w-3.5 text-red-500" /><span className="text-xs font-semibold text-red-500">-{Math.abs(Math.round(delta))} vs prev period</span></>
                      ) : (
                        <><Minus className="h-3.5 w-3.5 text-gray-400" /><span className="text-xs text-gray-400">No change vs prev period</span></>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-1">{totalWins} win{totalWins !== 1 ? "s" : ""} in {days} days</div>
                  </>
                )}
              </div>
            </div>

            <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 p-6"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="h-8 w-8 rounded-xl bg-blue-50 flex items-center justify-center">
                  <TrendingUp className="h-4 w-4 text-blue-500" />
                </div>
                <h2 className="font-semibold text-gray-900">Win Breakdown</h2>
              </div>
              {sumLoading ? (
                <div className="space-y-3">{[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <div className="w-28 h-3 bg-gray-100 rounded animate-pulse" />
                    <div className="flex-1 h-2 bg-gray-100 rounded animate-pulse" />
                    <div className="w-5 h-3 bg-gray-100 rounded animate-pulse" />
                  </div>
                ))}</div>
              ) : (
                <div className="space-y-3.5">
                  <BreakdownBar label="Milestones"   value={bd?.milestones_done    ?? 0} max={bdMax} color="#3b82f6" />
                  <BreakdownBar label="Work Packages" value={bd?.wbs_done           ?? 0} max={bdMax} color="#06b6d4" />
                  <BreakdownBar label="Risks Resolved" value={bd?.raid_resolved    ?? 0} max={bdMax} color="#22c55e" />
                  <BreakdownBar label="Changes Delivered" value={bd?.changes_delivered ?? 0} max={bdMax} color="#a855f7" />
                  <BreakdownBar label="Lessons"      value={bd?.lessons_positive   ?? 0} max={bdMax} color="#f59e0b" />
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto pb-1">
            {CATEGORIES.map(cat => {
              const count = cat === "All" ? items.length : (catCounts[cat] ?? 0);
              const active = category === cat;
              const cfg = cat !== "All" ? catConfig(cat) : null;
              return (
                <button key={cat} type="button" onClick={() => setCategory(cat)}
                  className={["flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all border",
                    active
                      ? "bg-gray-900 text-white border-gray-900"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"].join(" ")}>
                  {cfg?.icon && <span className={active ? "text-white opacity-80" : ""}>{cfg.icon}</span>}
                  {cat}
                  {count > 0 && (
                    <span className={["rounded-full px-1.5 py-0.5 text-[10px] font-bold",
                      active ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500"].join(" ")}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {stoLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="h-44 rounded-2xl bg-white border border-gray-100 animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 py-20 text-center"
              style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <Trophy className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <div className="text-base font-semibold text-gray-600">No wins found</div>
              <div className="text-sm text-gray-400 mt-1">
                {category !== "All"
                  ? `No ${category.toLowerCase()} wins in the last ${days} days`
                  : `No success stories recorded in the last ${days} days`}
              </div>
              {category !== "All" && (
                <button onClick={() => setCategory("All")}
                  className="mt-4 text-sm text-blue-600 hover:text-blue-700 font-medium">
                  Clear filter →
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {items.map((item, i) => (
                <div key={item.id}
                  style={{ animationDelay: `${i * 30}ms`, animation: "fadeUp 0.3s ease both" }}>
                  <WinCard
                    item={item}
                    onClick={() => setSelected(item)}
                  />
                </div>
              ))}
            </div>
          )}

          {!stoLoading && items.length > 0 && (
            <div className="text-center text-xs text-gray-400 pb-4">
              Showing {items.length} success {items.length === 1 ? "story" : "stories"} · Last {days} days
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes fadeUp {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
