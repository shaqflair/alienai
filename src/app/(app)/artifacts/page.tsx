// src/app/(app)/artifacts/page.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Search,
  ArrowUpRight,
  Loader2,
  List as ListIcon,
  LayoutGrid,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Sparkles,
  Filter,
  X,
  Clock,
  Folder,
  FileText,
  AlertCircle,
  CheckCircle2,
  MoreHorizontal,
} from "lucide-react";

/* ============================
   Types
============================ */

type ArtifactRow = {
  id: string;
  project_id: string;
  title: string;
  type: string;
  status?: string;
  created_at?: string | null;
  updated_at?: string | null;
  href?: string;
  project?: {
    id?: string;
    title?: string | null;
    project_code?: string | number | null;
  } | null;
  effort?: string | null;
  stalled?: boolean | null;
};

type ApiResp =
  | { ok: false; error: string }
  | {
      ok: true;
      items: ArtifactRow[];
      nextCursor: string | null;
      facets?: { types?: string[] };
    };

/* ============================
   Utilities
============================ */

const safeStr = (x: any) => (typeof x === "string" ? x : x == null ? "" : String(x));
const norm = (x: any) => safeStr(x).trim().toLowerCase();

function looksLikeUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function safeDateMs(x?: string | null) {
  if (!x) return 0;
  const d = new Date(x);
  const t = d.getTime();
  return Number.isFinite(t) ? t : 0;
}

function artifactUpdatedMs(a: ArtifactRow) {
  return safeDateMs(a.updated_at || a.created_at || null);
}

function isWithinLastDays(a: ArtifactRow, days: number) {
  const ms = artifactUpdatedMs(a);
  if (!ms) return false;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return ms >= cutoff;
}

function isClosedStatus(status?: string) {
  const s = norm(status);
  return !!s && (s.includes("closed") || s.includes("done") || s.includes("complete") || s.includes("completed"));
}

function isMissingEffort(a: ArtifactRow) {
  const t = norm(a.type);
  return t === "wbs" ? !safeStr(a.effort).trim() : false;
}

/**
 * ✅ Single source of truth for "Needs attention"
 * Matches AIHealthBadge logic + avoids counting closed items.
 */
function isNeedsAttention(a: ArtifactRow) {
  if (isClosedStatus(a.status)) return false;
  if (a.stalled === true) return true;
  if (isMissingEffort(a)) return true;
  return false;
}

const fmtDateUk = (x?: string | null) => {
  if (!x) return "—";
  const d = new Date(x);
  if (Number.isNaN(d.getTime())) return String(x);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

const fmtRelativeTime = (x?: string | null) => {
  if (!x) return "";
  const d = new Date(x);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return fmtDateUk(x);
};

function projectHumanId(a: ArtifactRow) {
  const code = a.project?.project_code ?? "";
  const s = String(code ?? "").trim();
  if (s) return s;
  const pid = safeStr(a.project_id).trim();
  return pid ? pid.slice(0, 8) : "—";
}

function projectTitleLabel(a: ArtifactRow) {
  const t = safeStr(a.project?.title).trim();
  return t || "Project";
}

function buildArtifactHref(a: ArtifactRow) {
  if (a.href) return a.href;
  const pid = safeStr(a.project_id).trim();
  const aid = safeStr(a.id).trim();
  const t = norm(a.type);

  if (!pid) return "/projects";
  if (t === "raid" || t === "raid_log") return `/projects/${pid}/raid`;
  if (t === "change_requests" || t === "change" || t === "changes" || t.includes("change"))
    return `/projects/${pid}/change`;
  if (t === "lessons_learned" || t === "lessons" || t.includes("lesson")) return `/projects/${pid}/lessons`;
  if (aid) return `/projects/${pid}/artifacts/${aid}`;
  return `/projects/${pid}/artifacts`;
}

function projectChangeHref(projectId: string) {
  const pid = safeStr(projectId).trim();
  return pid ? `/projects/${pid}/change` : "/projects";
}
function projectRaidHref(projectId: string) {
  const pid = safeStr(projectId).trim();
  return pid ? `/projects/${pid}/raid` : "/projects";
}

function displayType(type?: string) {
  if (!type) return "—";
  const t = norm(type);
  if (t === "wbs") return "WBS";
  if (t === "raid_log" || t === "raid") return "RAID";
  if (t === "project_charter" || t.includes("charter")) return "Project Charter";
  return safeStr(type).replace(/_/g, " ").trim();
}

function displayStatus(status?: string) {
  if (!status) return "—";
  const s = norm(status);
  if (s === "draft") return "Draft";
  if (s.includes("review")) return "In review";
  if (s.includes("progress")) return "In progress";
  if (s.includes("closed") || s.includes("done")) return "Closed";
  if (s.includes("new")) return "New";
  return safeStr(status).replace(/_/g, " ").trim();
}

function safeParseJson(txt: string): any {
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

/* ============================
   Hooks
============================ */

function useDebouncedValue<T>(value: T, delayMs: number) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), delayMs);
    return () => window.clearTimeout(t);
  }, [value, delayMs]);
  return v;
}

/* ============================
   Visual System (Premium Light)
============================ */

const CYAN = "#00B8DB";
const BORDER_CYAN = `border-[${CYAN}]`;

const typeConfig: Record<string, { icon: React.ReactNode; bg: string; text: string; border: string }> = {
  charter: {
    icon: <FileText className="w-3.5 h-3.5" />,
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  wbs: {
    icon: <Folder className="w-3.5 h-3.5" />,
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
  },
  raid: {
    icon: <AlertCircle className="w-3.5 h-3.5" />,
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
  change: {
    icon: <Sparkles className="w-3.5 h-3.5" />,
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
  },
  default: {
    icon: <FileText className="w-3.5 h-3.5" />,
    bg: "bg-gray-50",
    text: "text-gray-700",
    border: "border-gray-200",
  },
};

function TypeBadge({ type }: { type?: string }) {
  const t = norm(type);
  const config =
    typeConfig[t] || typeConfig[Object.keys(typeConfig).find((k) => t.includes(k)) || "default"] || typeConfig.default;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium border ${config.bg} ${config.text} ${config.border}`}
    >
      {config.icon}
      {displayType(type)}
    </span>
  );
}

const statusConfig: Record<string, { dot: string; bg: string; text: string }> = {
  draft: { dot: "bg-gray-400", bg: "bg-gray-50", text: "text-gray-600" },
  review: { dot: "bg-amber-500", bg: "bg-amber-50", text: "text-amber-700" },
  progress: { dot: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  closed: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  done: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  new: { dot: "bg-purple-500", bg: "bg-purple-50", text: "text-purple-700" },
  default: { dot: "bg-gray-400", bg: "bg-gray-50", text: "text-gray-600" },
};

function StatusBadge({ status }: { status?: string }) {
  const s = norm(status);
  const config =
    statusConfig[s] ||
    statusConfig[Object.keys(statusConfig).find((k) => s.includes(k)) || "default"] ||
    statusConfig.default;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium ${config.bg} ${config.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
      {displayStatus(status)}
    </span>
  );
}

function AIHealthBadge({ artifact }: { artifact: ArtifactRow }) {
  const stalled = artifact.stalled === true;
  const t = norm(artifact.type);
  const missingEffort = t === "wbs" ? !safeStr(artifact.effort).trim() : false;

  if (stalled) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-rose-50 text-rose-700 border border-rose-200">
        <AlertCircle className="w-3.5 h-3.5" />
        Risk
      </span>
    );
  }

  if (missingEffort) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-amber-50 text-amber-700 border border-amber-200">
        <Clock className="w-3.5 h-3.5" />
        Needs effort
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
      <CheckCircle2 className="w-3.5 h-3.5" />
      Healthy
    </span>
  );
}

/* ============================
   Grouped View Helpers
============================ */

type ProjectGroup = {
  project_id: string;
  project_human: string;
  project_title: string;
  last_updated_ms: number;
  last_updated_raw: string;
  items: ArtifactRow[];
};

function groupByProject(items: ArtifactRow[]): ProjectGroup[] {
  const map = new Map<string, ProjectGroup>();

  for (const it of items) {
    const pid = safeStr(it.project_id) || "unknown";
    const raw = safeStr(it.updated_at) || safeStr(it.created_at) || "";
    const ms = safeDateMs(raw);

    const existing = map.get(pid);
    if (!existing) {
      map.set(pid, {
        project_id: pid,
        project_human: projectHumanId(it),
        project_title: projectTitleLabel(it),
        last_updated_ms: ms,
        last_updated_raw: raw,
        items: [it],
      });
    } else {
      existing.items.push(it);
      if (ms > existing.last_updated_ms) {
        existing.last_updated_ms = ms;
        existing.last_updated_raw = raw;
      }
      if (existing.project_title === "Project" && projectTitleLabel(it) !== "Project") {
        existing.project_title = projectTitleLabel(it);
      }
    }
  }

  for (const g of map.values()) {
    g.items.sort((a, b) => {
      const bm = safeDateMs(b.updated_at || b.created_at);
      const am = safeDateMs(a.updated_at || a.created_at);
      if (bm !== am) return bm - am;
      return safeStr(a.id).localeCompare(safeStr(b.id));
    });
  }

  return Array.from(map.values()).sort((a, b) => {
    if (b.last_updated_ms !== a.last_updated_ms) return b.last_updated_ms - a.last_updated_ms;
    return `${a.project_human} ${a.project_title}`.localeCompare(`${b.project_human} ${b.project_title}`, undefined, {
      sensitivity: "base",
    });
  });
}

/* ============================
   Sort System
============================ */

type SortKey = "project" | "artifact" | "type" | "status" | "updated";
type SortDir = "asc" | "desc";

function parseSort(raw: string | null): { key: SortKey; dir: SortDir } {
  const s = norm(raw);
  if (s === "title_asc") return { key: "artifact", dir: "asc" };
  if (s === "updated_desc" || !s) return { key: "updated", dir: "desc" };
  const m = s.match(/^(project|artifact|type|status|updated)_(asc|desc)$/);
  if (m) return { key: m[1] as SortKey, dir: m[2] as SortDir };
  return { key: "updated", dir: "desc" };
}

function sortToParam(key: SortKey, dir: SortDir) {
  return `${key}_${dir}`;
}

function cmpBase(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

/* ============================
   Components
============================ */

function StatCard({ label, value, trend }: { label: string; value: string | number; trend?: string }) {
  return (
    <div
      className={`bg-white rounded-xl border p-5 shadow-sm hover:shadow-md transition-shadow border-[#00B8DB]`}
    >
      <div className="text-sm text-gray-500 font-medium">{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold text-gray-900">{value}</span>
        {trend && <span className="text-xs text-emerald-600 font-medium">{trend}</span>}
      </div>
    </div>
  );
}

/* ============================
   Main Page
============================ */

export default function ArtifactsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const hydrated = useRef(false);

  const [q, setQ] = useState("");
  const [type, setType] = useState("");
  const [view, setView] = useState<"list" | "grouped">("list");

  const [sortKey, setSortKey] = useState<SortKey>("updated");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [highlightId, setHighlightId] = useState<string>("");

  const [items, setItems] = useState<ArtifactRow[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [showFilters, setShowFilters] = useState(false);

  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const qDebounced = useDebouncedValue(q, 250);
  const typeDebounced = useDebouncedValue(type, 150);

  /* ---------------- Effects ---------------- */

  useEffect(() => {
    if (hydrated.current) return;

    const q0 = safeStr(searchParams.get("q")).trim();
    const t0 = safeStr(searchParams.get("type")).trim();
    const v0 = safeStr(searchParams.get("view")).trim();
    const { key, dir } = parseSort(searchParams.get("sort"));
    const aid0 = safeStr(searchParams.get("artifactId")).trim();

    if (q0) setQ(q0);
    if (t0) setType(t0);
    setView(v0 === "grouped" ? "grouped" : "list");
    setSortKey(key);
    setSortDir(dir);

    if (aid0 && looksLikeUuid(aid0)) setHighlightId(aid0);

    hydrated.current = true;
  }, []);

  const urlState = useMemo(
    () => ({
      q,
      type,
      view,
      sort: sortToParam(sortKey, sortDir),
      artifactId: highlightId,
    }),
    [q, type, view, sortKey, sortDir, highlightId]
  );

  const urlStateDebounced = useDebouncedValue(urlState, 200);

  useEffect(() => {
    if (!hydrated.current) return;
    const sp = new URLSearchParams();
    if (urlStateDebounced.q) sp.set("q", urlStateDebounced.q);
    if (urlStateDebounced.type) sp.set("type", urlStateDebounced.type);
    sp.set("view", urlStateDebounced.view);
    sp.set("sort", urlStateDebounced.sort);
    if (urlStateDebounced.artifactId) sp.set("artifactId", urlStateDebounced.artifactId);

    const qs = sp.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }, [urlStateDebounced]);

  const apiParams = useMemo(() => {
    const sp = new URLSearchParams();
    if (qDebounced) sp.set("q", qDebounced);
    if (typeDebounced) sp.set("type", typeDebounced);
    sp.set("minimal", "1");
    sp.set("serverSort", "1");
    sp.set("limit", "50");
    return sp.toString();
  }, [qDebounced, typeDebounced]);

  /* ---------------- Data Loading ---------------- */

  async function loadFirst() {
    setLoading(true);
    setError("");
    try {
      const r = await fetch(`/api/artifacts?${apiParams}`, { cache: "no-store" });
      const txt = await r.text();
      const j = safeParseJson(txt) as ApiResp | null;

      if (!r.ok) throw new Error((j as any)?.error || `Load failed (${r.status})`);
      if (!j || (j as any).ok !== true) throw new Error("API returned invalid response");

      setItems(j.items || []);
      setCursor(j.nextCursor ?? null);

      const facet = (j.facets?.types || []).filter(Boolean);
      const inferred = Array.from(new Set((j.items || []).map((x) => safeStr(x.type)).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      );
      setTypes(facet.length ? facet : inferred);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
      setItems([]);
      setCursor(null);
      setTypes([]);
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setError("");

    try {
      const sp = new URLSearchParams(apiParams);
      sp.set("cursor", cursor);

      const r = await fetch(`/api/artifacts?${sp.toString()}`, { cache: "no-store" });
      const txt = await r.text();
      const j = safeParseJson(txt) as ApiResp | null;

      if (!r.ok) throw new Error((j as any)?.error || `Load failed (${r.status})`);
      if (!j || (j as any).ok !== true) throw new Error("API returned invalid response");

      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const next = (j.items || []).filter((x) => !seen.has(x.id));
        return [...prev, ...next];
      });
      setCursor(j.nextCursor ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!hydrated.current) return;
    loadFirst();
  }, [apiParams]);

  /* ---------------- Derived State ---------------- */

  const filteredItems = useMemo(() => {
    const t = norm(typeDebounced);
    return (items || []).filter((a) => {
      if (t && norm(a.type) !== t) return false;
      return true;
    });
  }, [items, typeDebounced]);

  const sortedItems = useMemo(() => {
    const isDefaultUpdatedDesc = sortKey === "updated" && sortDir === "desc";
    if (isDefaultUpdatedDesc) return filteredItems;

    const arr = [...filteredItems];
    const mul = sortDir === "asc" ? 1 : -1;

    arr.sort((a, b) => {
      const aUpd = safeDateMs(a.updated_at || a.created_at);
      const bUpd = safeDateMs(b.updated_at || b.created_at);

      if (sortKey === "updated") {
        if (aUpd !== bUpd) return (aUpd - bUpd) * mul;
        return safeStr(a.id).localeCompare(safeStr(b.id));
      }

      if (sortKey === "project") {
        const av = `${projectHumanId(a)} ${projectTitleLabel(a)}`;
        const bv = `${projectHumanId(b)} ${projectTitleLabel(b)}`;
        const c = cmpBase(av, bv) * mul;
        if (c) return c;
        if (aUpd !== bUpd) return (aUpd - bUpd) * -1;
        return safeStr(a.id).localeCompare(safeStr(b.id));
      }

      if (sortKey === "artifact") {
        const c = cmpBase(safeStr(a.title), safeStr(b.title)) * mul;
        if (c) return c;
        if (aUpd !== bUpd) return (aUpd - bUpd) * -1;
        return safeStr(a.id).localeCompare(safeStr(b.id));
      }

      if (sortKey === "type") {
        const c = cmpBase(displayType(a.type), displayType(b.type)) * mul;
        if (c) return c;
        if (aUpd !== bUpd) return (aUpd - bUpd) * -1;
        return safeStr(a.id).localeCompare(safeStr(b.id));
      }

      if (sortKey === "status") {
        const c = cmpBase(displayStatus(a.status), displayStatus(b.status)) * mul;
        if (c) return c;
        if (aUpd !== bUpd) return (aUpd - bUpd) * -1;
        return safeStr(a.id).localeCompare(safeStr(b.id));
      }

      return 0;
    });

    return arr;
  }, [filteredItems, sortKey, sortDir]);

  const grouped = useMemo(() => groupByProject(sortedItems), [sortedItems]);

  /* ---------------- Scroll to Highlight ---------------- */

  useEffect(() => {
    if (!highlightId) return;
    const el = rowRefs.current[highlightId];
    if (!el) return;

    const t = window.setTimeout(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 140);

    return () => window.clearTimeout(t);
  }, [highlightId, view, sortedItems]);

  /* ---------------- Handlers ---------------- */

  function toggleSort(nextKey: SortKey) {
    if (sortKey !== nextKey) {
      setSortKey(nextKey);
      setSortDir(nextKey === "updated" ? "desc" : "asc");
      return;
    }
    setSortDir((d) => (d === "asc" ? "desc" : "asc"));
  }

  function sortIndicator(key: SortKey) {
    if (sortKey !== key) return <div className="w-4 h-4 opacity-0" />;
    return sortDir === "asc" ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />;
  }

  function toggleProjectCollapse(projectId: string) {
    setCollapsed((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  }

  const hasActiveFilters = q || type;

  // ✅ Stats computed from the same rules as badges
  const stats = useMemo(() => {
    const total = items.length;
    const thisWeek = items.filter((i) => isWithinLastDays(i, 7)).length;
    const projects = new Set(items.map((i) => i.project_id)).size;

    const needsAttentionItems = items.filter(isNeedsAttention);
    const needsAttention = needsAttentionItems.length;

    const urgent = needsAttentionItems.filter((i) => i.stalled === true && !isClosedStatus(i.status)).length;
    const needsEffortCount = needsAttentionItems.filter((i) => isMissingEffort(i)).length;

    let trend = "";
    if (urgent > 0 && needsEffortCount > 0) trend = `${urgent} urgent • ${needsEffortCount} need effort`;
    else if (urgent > 0) trend = `${urgent} urgent`;
    else if (needsEffortCount > 0) trend = `${needsEffortCount} need effort`;

    return { total, thisWeek, projects, needsAttention, needsAttentionTrend: trend };
  }, [items]);

  /* ============================
     Render
  ============================ */

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Top Navigation Bar */}
      <div className="sticky top-0 z-50 bg-white border-b border-[#00B8DB] shadow-sm">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-blue-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-600/20">
                <Folder className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-gray-900">Artifacts</h1>
                <p className="text-sm text-gray-500">Governance across all projects</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowFilters(!showFilters)}
                className={`gap-2 ${showFilters ? "bg-gray-100 border-gray-300" : ""}`}
              >
                <Filter className="w-4 h-4" />
                Filters
                {hasActiveFilters && (
                  <span className="ml-1 px-1.5 py-0.5 bg-blue-600 text-white text-xs rounded-full">
                    {[q, type].filter(Boolean).length}
                  </span>
                )}
              </Button>

              <Button variant="outline" size="sm" onClick={loadFirst} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Refresh"}
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Artifacts" value={stats.total} trend="+12%" />
          <StatCard label="This Week" value={stats.thisWeek} />
          <StatCard label="Projects" value={stats.projects} />
          <StatCard label="Needs Attention" value={stats.needsAttention} trend={stats.needsAttentionTrend || undefined} />
        </div>

        {/* Expandable Filters */}
        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            showFilters ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="bg-white rounded-xl border border-[#00B8DB] p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Filters</h3>
              {hasActiveFilters && (
                <button
                  onClick={() => {
                    setQ("");
                    setType("");
                  }}
                  className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
                >
                  <X className="w-4 h-4" /> Clear all
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search artifacts..."
                  className="w-full rounded-lg bg-gray-50 border border-gray-200 pl-10 pr-4 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                />
              </div>

              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-2.5 text-sm text-gray-700 focus:bg-white focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
              >
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {displayType(t)}
                  </option>
                ))}
              </select>

              <Button onClick={loadFirst} className="bg-blue-600 hover:bg-blue-700 text-white font-medium">
                {loading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching...
                  </span>
                ) : (
                  "Apply Filters"
                )}
              </Button>
            </div>
          </div>
        </div>

        {/* View Toggle & Sort Info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 bg-white rounded-lg border border-[#00B8DB] p-1 shadow-sm">
            <button
              onClick={() => setView("list")}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                view === "list" ? "bg-gray-900 text-white shadow-sm" : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <ListIcon className="w-4 h-4" />
              List
            </button>
            <button
              onClick={() => setView("grouped")}
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                view === "grouped"
                  ? "bg-gray-900 text-white shadow-sm"
                  : "text-gray-600 hover:text-gray-900 hover:bg-gray-50"
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
              Grouped
            </button>
          </div>

          <div className="text-sm text-gray-500">
            {sortedItems.length} artifact{sortedItems.length !== 1 ? "s" : ""}
            {cursor && ` • More available`}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="rounded-lg border border-[#00B8DB] bg-red-50 px-4 py-3 text-sm text-red-700 flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Results */}
        {loading && items.length === 0 ? (
          <div className="bg-white rounded-xl border border-[#00B8DB] p-12 text-center">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4">
              <Loader2 className="w-6 h-6 text-gray-400 animate-spin" />
            </div>
            <p className="text-gray-500">Loading artifacts...</p>
          </div>
        ) : sortedItems.length ? (
          view === "list" ? (
            <div className="bg-white rounded-xl border border-[#00B8DB] shadow-sm overflow-hidden">
              {/* Table Header */}
              <div className="border-b border-gray-200 bg-gray-50/80 backdrop-blur">
                <div className="grid grid-cols-12 gap-4 px-6 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <button
                    type="button"
                    onClick={() => toggleSort("project")}
                    className="col-span-3 flex items-center gap-2 hover:text-gray-700 transition-colors text-left"
                  >
                    Project {sortIndicator("project")}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSort("artifact")}
                    className="col-span-4 flex items-center gap-2 hover:text-gray-700 transition-colors text-left"
                  >
                    Artifact {sortIndicator("artifact")}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSort("type")}
                    className="col-span-2 flex items-center gap-2 hover:text-gray-700 transition-colors text-left"
                  >
                    Type {sortIndicator("type")}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSort("status")}
                    className="col-span-2 flex items-center gap-2 hover:text-gray-700 transition-colors text-left"
                  >
                    Status {sortIndicator("status")}
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleSort("updated")}
                    className="col-span-1 flex items-center justify-end gap-2 hover:text-gray-700 transition-colors text-right"
                  >
                    {sortIndicator("updated")}
                  </button>
                </div>
              </div>

              {/* Table Body */}
              <div className="divide-y divide-gray-100">
                {sortedItems.map((a, index) => {
                  const isHighlighted = highlightId && a.id === highlightId;
                  const openHref = buildArtifactHref(a);
                  const changeHref = projectChangeHref(a.project_id);
                  const raidHref = projectRaidHref(a.project_id);

                  return (
                    <div
                      key={a.id}
                      ref={(el) => {
                        rowRefs.current[a.id] = el;
                      }}
                      className={`group grid grid-cols-12 gap-4 px-6 py-4 transition-all duration-200 ${
                        isHighlighted ? "bg-blue-50/80 ring-1 ring-inset ring-blue-200" : "hover:bg-gray-50"
                      } ${index % 2 === 0 ? "bg-white" : "bg-gray-50/30"}`}
                    >
                      <div className="col-span-3 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-gray-100 text-xs font-mono font-medium text-gray-600">
                            {projectHumanId(a).slice(0, 2)}
                          </span>
                          <span className="font-medium text-gray-900 truncate">{projectTitleLabel(a)}</span>
                        </div>
                      </div>

                      <div className="col-span-4 min-w-0">
                        <Link
                          href={openHref}
                          className="font-semibold text-gray-900 hover:text-blue-600 transition-colors truncate block"
                        >
                          {a.title || "Untitled artifact"}
                        </Link>
                        <div className="flex items-center gap-3 mt-1">
                          <AIHealthBadge artifact={a} />
                        </div>
                      </div>

                      <div className="col-span-2">
                        <TypeBadge type={a.type} />
                      </div>

                      <div className="col-span-2">
                        <StatusBadge status={a.status} />
                      </div>

                      <div className="col-span-1 flex items-center justify-end gap-2">
                        <span className="text-xs text-gray-400 tabular-nums">
                          {fmtRelativeTime(a.updated_at || a.created_at)}
                        </span>

                        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                          <Link
                            href={openHref}
                            className="p-1.5 rounded-md hover:bg-gray-200 text-gray-500 hover:text-gray-700 transition-colors"
                            title="Open"
                          >
                            <ArrowUpRight className="w-4 h-4" />
                          </Link>
                        </div>
                      </div>

                      {/* Hover Actions Row */}
                      <div className="col-span-12 mt-2 opacity-0 group-hover:opacity-100 transition-all duration-200 max-h-0 group-hover:max-h-10 overflow-hidden">
                        <div className="flex items-center gap-2 pl-8">
                          <span className="text-xs text-gray-400">Quick actions:</span>
                          <Link
                            href={changeHref}
                            className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors"
                          >
                            Change Request
                          </Link>
                          <Link
                            href={raidHref}
                            className="text-xs px-2 py-1 rounded-md bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900 transition-colors"
                          >
                            RAID Log
                          </Link>
                          <span className="text-xs text-gray-300">•</span>
                          <span className="text-xs text-gray-400">Updated {fmtDateUk(a.updated_at || a.created_at)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map((g) => {
                const isCollapsed = collapsed[g.project_id] === true;
                return (
                  <div key={g.project_id} className="bg-white rounded-xl border border-[#00B8DB] shadow-sm overflow-hidden">
                    {/* Project Header */}
                    <button
                      type="button"
                      onClick={() => toggleProjectCollapse(g.project_id)}
                      className="w-full flex items-center justify-between px-6 py-4 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100 hover:from-gray-100 hover:to-gray-50 transition-all"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`transition-transform duration-200 ${isCollapsed ? "" : "rotate-90"}`}>
                          <ChevronRight className="w-5 h-5 text-gray-400" />
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm shadow-md">
                            {g.project_human.slice(0, 2)}
                          </div>
                          <div className="text-left">
                            <div className="font-semibold text-gray-900">{g.project_title}</div>
                            <div className="text-sm text-gray-500">
                              {g.project_human} • {g.items.length} artifact{g.items.length !== 1 ? "s" : ""}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400">Updated {fmtRelativeTime(g.last_updated_raw)}</span>
                        <div className="flex items-center gap-1 ml-4">
                          <Link
                            href={`/projects/${g.project_id}/change`}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-200 text-gray-700 hover:border-blue-300 hover:text-blue-600 transition-colors shadow-sm"
                          >
                            Change
                          </Link>
                          <Link
                            href={`/projects/${g.project_id}/raid`}
                            className="px-3 py-1.5 text-xs font-medium rounded-md bg-white border border-gray-200 text-gray-700 hover:border-rose-300 hover:text-rose-600 transition-colors shadow-sm"
                          >
                            RAID
                          </Link>
                        </div>
                      </div>
                    </button>

                    {/* Collapsible Content */}
                    <div className={`transition-all duration-300 ease-in-out ${isCollapsed ? "max-h-0" : "max-h-[2000px]"}`}>
                      <div className="p-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {g.items.map((a) => {
                          const isHighlighted = highlightId && a.id === highlightId;
                          const openHref = buildArtifactHref(a);

                          return (
                            <div
                              key={a.id}
                              ref={(el) => {
                                rowRefs.current[a.id] = el;
                              }}
                              className={`group relative rounded-lg border p-4 transition-all duration-200 hover:shadow-md ${
                                isHighlighted
                                  ? "border-blue-400 bg-blue-50/50 ring-2 ring-blue-200"
                                  : "border-[#00B8DB] bg-white hover:border-[#00B8DB]"
                              }`}
                            >
                              <div className="flex items-start justify-between mb-3">
                                <TypeBadge type={a.type} />
                                <Link
                                  href={openHref}
                                  className="opacity-0 group-hover:opacity-100 p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all"
                                >
                                  <ArrowUpRight className="w-4 h-4" />
                                </Link>
                              </div>

                              <Link
                                href={openHref}
                                className="block font-semibold text-gray-900 hover:text-blue-600 transition-colors mb-2 line-clamp-2"
                              >
                                {a.title || "Untitled artifact"}
                              </Link>

                              <div className="flex items-center gap-2 mb-3">
                                <StatusBadge status={a.status} />
                              </div>

                              <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                                <AIHealthBadge artifact={a} />
                                <span className="text-xs text-gray-400">{fmtRelativeTime(a.updated_at || a.created_at)}</span>
                              </div>

                              {/* Card Hover Actions */}
                              <div className="absolute inset-x-0 -bottom-px opacity-0 group-hover:opacity-100 transition-all duration-200 translate-y-2 group-hover:translate-y-0">
                                <div className="flex items-center justify-center gap-2 pb-3">
                                  <Link
                                    href={projectChangeHref(a.project_id)}
                                    className="px-3 py-1 text-xs font-medium rounded-full bg-gray-900 text-white hover:bg-gray-800 transition-colors shadow-lg"
                                  >
                                    Change
                                  </Link>
                                  <Link
                                    href={projectRaidHref(a.project_id)}
                                    className="px-3 py-1 text-xs font-medium rounded-full bg-white text-gray-700 border border-gray-200 hover:border-gray-300 transition-colors shadow-lg"
                                  >
                                    RAID
                                  </Link>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )
        ) : (
          <div className="bg-white rounded-xl border border-[#00B8DB] p-12 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-gray-100 mb-4">
              <Search className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900 mb-1">No artifacts found</h3>
            <p className="text-gray-500 mb-4">Try adjusting your filters or search query</p>
            {hasActiveFilters && (
              <Button
                variant="outline"
                onClick={() => {
                  setQ("");
                  setType("");
                }}
              >
                Clear filters
              </Button>
            )}
          </div>
        )}

        {/* Load More */}
        {(cursor || loadingMore) && (
          <div className="flex justify-center pt-4">
            <Button onClick={loadMore} disabled={loadingMore} variant="outline" className="min-w-[200px] border-[#00B8DB]">
              {loadingMore ? (
                <span className="inline-flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading more...
                </span>
              ) : (
                `Load more (${sortedItems.length} loaded)`
              )}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
