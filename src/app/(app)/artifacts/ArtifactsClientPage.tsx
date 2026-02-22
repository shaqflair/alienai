"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Search,
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
  TrendingUp,
  Activity,
  Layers,
  RefreshCw,
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
    status?: string | null;
    state?: string | null;
    lifecycle_status?: string | null;
    lifecycle_state?: string | null;
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

type ApiOk = Extract<ApiResp, { ok: true }>;

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

/**
 * Returns true if an artifact's own status is "closed" / "done" / "complete".
 */
function isClosedArtifactStatus(status?: string) {
  const s = norm(status);
  return !!s && (
    s.includes("closed") ||
    s.includes("done") ||
    s.includes("complete") ||
    s.includes("completed") ||
    s.includes("cancel")
  );
}

function isMissingEffort(a: ArtifactRow) {
  const t = norm(a.type);
  return t === "wbs" ? !safeStr(a.effort).trim() : false;
}

function isNeedsAttention(a: ArtifactRow) {
  if (isClosedArtifactStatus(a.status)) return false;
  if (a.stalled === true) return true;
  if (isMissingEffort(a)) return true;
  return false;
}

/**
 * Project lifecycle filter — excludes closed/cancelled/archived/inactive projects.
 */
function isInactiveProjectStatus(x?: string | null) {
  const s = norm(x);
  if (!s) return false;
  if (s.includes("cancel")) return true;
  if (s.includes("close")) return true;
  if (s.includes("archive")) return true;
  if (s.includes("inactive")) return true;
  if (s.includes("complete")) return true;
  if (s.includes("done")) return true;
  return false;
}

function isInactiveProject(a: ArtifactRow) {
  const p = a.project;
  if (!p) return false;
  return (
    isInactiveProjectStatus(p.status) ||
    isInactiveProjectStatus(p.state) ||
    isInactiveProjectStatus(p.lifecycle_status) ||
    isInactiveProjectStatus(p.lifecycle_state)
  );
}

/**
 * ✅ An artifact is "active" (eligible for stats) if BOTH:
 *   1. Its parent project is not inactive (closed/cancelled/archived/done)
 *   2. Its own status is not closed/done/complete/cancelled
 */
function isActiveArtifact(a: ArtifactRow) {
  if (isInactiveProject(a)) return false;
  if (isClosedArtifactStatus(a.status)) return false;
  return true;
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
  if (days < 7) return `${days}d ago`;
  if (days < 30) return `${Math.floor(days / 7)}w ago`;
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
  if (s.includes("review")) return "In Review";
  if (s.includes("progress")) return "In Progress";
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

function isOkResp(x: any): x is ApiOk {
  return !!x && typeof x === "object" && (x as any).ok === true;
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
   Type & Status Badge Configs
============================ */

const typeConfig: Record<string, { icon: React.ReactNode; bg: string; text: string; border: string }> = {
  charter: {
    icon: <FileText className="w-3 h-3" />,
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
  },
  wbs: {
    icon: <Layers className="w-3 h-3" />,
    bg: "bg-violet-50",
    text: "text-violet-700",
    border: "border-violet-200",
  },
  raid: {
    icon: <AlertCircle className="w-3 h-3" />,
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
  },
  change: {
    icon: <Sparkles className="w-3 h-3" />,
    bg: "bg-sky-50",
    text: "text-sky-700",
    border: "border-sky-200",
  },
  default: {
    icon: <FileText className="w-3 h-3" />,
    bg: "bg-slate-50",
    text: "text-slate-600",
    border: "border-slate-200",
  },
};

function TypeBadge({ type }: { type?: string }) {
  const t = norm(type);
  const config =
    typeConfig[t] ||
    typeConfig[Object.keys(typeConfig).find((k) => t.includes(k)) || "default"] ||
    typeConfig.default;

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide border ${config.bg} ${config.text} ${config.border}`}
    >
      {config.icon}
      {displayType(type)}
    </span>
  );
}

const statusConfig: Record<string, { dot: string; bg: string; text: string }> = {
  draft: { dot: "bg-slate-400", bg: "bg-slate-50", text: "text-slate-600" },
  review: { dot: "bg-amber-400", bg: "bg-amber-50", text: "text-amber-700" },
  progress: { dot: "bg-blue-500", bg: "bg-blue-50", text: "text-blue-700" },
  closed: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  done: { dot: "bg-emerald-500", bg: "bg-emerald-50", text: "text-emerald-700" },
  new: { dot: "bg-purple-500", bg: "bg-purple-50", text: "text-purple-700" },
  default: { dot: "bg-slate-300", bg: "bg-slate-50", text: "text-slate-500" },
};

function StatusBadge({ status }: { status?: string }) {
  const s = norm(status);
  const config =
    statusConfig[s] ||
    statusConfig[Object.keys(statusConfig).find((k) => s.includes(k)) || "default"] ||
    statusConfig.default;

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[11px] font-semibold tracking-wide ${config.bg} ${config.text}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
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
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-rose-50 text-rose-600 border border-rose-200">
        <AlertCircle className="w-3 h-3" />
        Risk
      </span>
    );
  }

  if (missingEffort) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-600 border border-amber-200">
        <Clock className="w-3 h-3" />
        Needs Effort
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-600 border border-emerald-200">
      <CheckCircle2 className="w-3 h-3" />
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
   Stat Card Component
============================ */

function StatCard({
  label,
  value,
  sub,
  accent,
  icon,
}: {
  label: string;
  value: string | number;
  sub?: string;
  accent?: "blue" | "emerald" | "amber" | "rose";
  icon?: React.ReactNode;
}) {
  const accentMap = {
    blue: {
      iconBg: "bg-blue-100",
      iconText: "text-blue-600",
      bar: "bg-blue-500",
      val: "text-blue-700",
    },
    emerald: {
      iconBg: "bg-emerald-100",
      iconText: "text-emerald-600",
      bar: "bg-emerald-500",
      val: "text-emerald-700",
    },
    amber: {
      iconBg: "bg-amber-100",
      iconText: "text-amber-600",
      bar: "bg-amber-400",
      val: "text-amber-700",
    },
    rose: {
      iconBg: "bg-rose-100",
      iconText: "text-rose-600",
      bar: "bg-rose-500",
      val: "text-rose-700",
    },
  };

  const c = accentMap[accent ?? "blue"];

  return (
    <div className="relative bg-white rounded-2xl border border-slate-100 p-5 shadow-sm hover:shadow-md transition-all duration-200 overflow-hidden group">
      {/* Top accent line */}
      <div className={`absolute top-0 left-0 right-0 h-0.5 ${c.bar}`} />

      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest mb-3">{label}</p>
          <p className={`text-3xl font-black ${c.val} leading-none`}>{value}</p>
          {sub && <p className="mt-1.5 text-xs text-slate-500 font-medium">{sub}</p>}
        </div>
        {icon && (
          <div className={`p-2.5 rounded-xl ${c.iconBg} ${c.iconText} group-hover:scale-110 transition-transform duration-200`}>
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================
   Sort Header Button
============================ */

function SortButton({
  label,
  sortKey,
  activeSortKey,
  sortDir,
  onToggle,
  align = "left",
}: {
  label: string;
  sortKey: SortKey;
  activeSortKey: SortKey;
  sortDir: SortDir;
  onToggle: (k: SortKey) => void;
  align?: "left" | "right";
}) {
  const active = activeSortKey === sortKey;
  return (
    <button
      type="button"
      onClick={() => onToggle(sortKey)}
      className={`inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest transition-colors ${
        active ? "text-slate-800" : "text-slate-400 hover:text-slate-600"
      } ${align === "right" ? "ml-auto" : ""}`}
    >
      {label}
      <span className={`transition-opacity ${active ? "opacity-100" : "opacity-0"}`}>
        {sortDir === "asc" ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
      </span>
    </button>
  );
}

/* ============================
   Main Page
============================ */

export default function ArtifactsClientPage() {
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
  }, [searchParams]);

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
  }, [urlStateDebounced, pathname, router]);

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
      if (!isOkResp(j)) throw new Error(safeStr((j as any)?.error) || "API returned invalid response");

      const ok = j;
      setItems(ok.items || []);
      setCursor(ok.nextCursor ?? null);

      const facet = (ok.facets?.types || []).filter(Boolean);
      const inferred = Array.from(new Set((ok.items || []).map((x) => safeStr(x.type)).filter(Boolean))).sort((a, b) =>
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
      if (!isOkResp(j)) throw new Error(safeStr((j as any)?.error) || "API returned invalid response");

      const ok = j;
      setItems((prev) => {
        const seen = new Set(prev.map((x) => x.id));
        const next = (ok.items || []).filter((x) => !seen.has(x.id));
        return [...prev, ...next];
      });
      setCursor(ok.nextCursor ?? null);
    } catch (e: any) {
      setError(e?.message || "Failed to load more");
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    if (!hydrated.current) return;
    loadFirst();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiParams]);

  /* ---------------- Derived State ---------------- */

  /**
   * visibleItems — all artifacts from non-inactive projects (used for the table/list view).
   * isInactiveProject already excludes closed/cancelled/archived parent projects.
   */
  const visibleItems = useMemo(() => (items || []).filter((a) => !isInactiveProject(a)), [items]);

  /**
   * activeItems — subset of visibleItems where the artifact itself is also not closed/done/complete.
   * Used exclusively for stats so they only count genuinely open, live work.
   */
  const activeItems = useMemo(() => visibleItems.filter(isActiveArtifact), [visibleItems]);

  const filteredItems = useMemo(() => {
    const t = norm(typeDebounced);
    return visibleItems.filter((a) => {
      if (t && norm(a.type) !== t) return false;
      return true;
    });
  }, [visibleItems, typeDebounced]);

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

  /* ---------------- Stats (active artifacts only) ------------------- */

  const stats = useMemo(() => {
    // ✅ All four stat cards use activeItems — excludes:
    //    • inactive/closed/cancelled/archived parent projects
    //    • artifacts whose own status is closed/done/complete/cancelled
    const total = activeItems.length;
    const thisWeek = activeItems.filter((i) => isWithinLastDays(i, 7)).length;
    const projects = new Set(activeItems.map((i) => i.project_id)).size;

    const needsAttentionItems = activeItems.filter(isNeedsAttention);
    const needsAttention = needsAttentionItems.length;

    const urgent = needsAttentionItems.filter((i) => i.stalled === true).length;
    const needsEffortCount = needsAttentionItems.filter(isMissingEffort).length;

    let attentionSub = "";
    if (urgent > 0 && needsEffortCount > 0) attentionSub = `${urgent} risk · ${needsEffortCount} need effort`;
    else if (urgent > 0) attentionSub = `${urgent} stalled`;
    else if (needsEffortCount > 0) attentionSub = `${needsEffortCount} missing effort`;
    else if (needsAttention === 0) attentionSub = "All looking good";

    return { total, thisWeek, projects, needsAttention, attentionSub };
  }, [activeItems]);

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

  function toggleProjectCollapse(projectId: string) {
    setCollapsed((prev) => ({ ...prev, [projectId]: !prev[projectId] }));
  }

  const hasActiveFilters = q || type;

  /* ============================
      Render
   ============================ */

  return (
    <div className="min-h-screen bg-[#F7F8FA]">
      {/* ─── Top Navigation Bar ─── */}
      <div className="sticky top-0 z-50 bg-white/90 backdrop-blur-md border-b border-slate-200/80 shadow-[0_1px_3px_rgba(0,0,0,0.05)]">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center justify-between h-16">
            {/* Brand */}
            <div className="flex items-center gap-3.5">
              <div className="relative h-9 w-9">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-[#0066FF] to-[#00B8DB] shadow-lg shadow-blue-500/25" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <Layers className="w-4.5 h-4.5 text-white" />
                </div>
              </div>
              <div>
                <h1 className="text-[15px] font-bold text-slate-900 leading-tight">Artifacts</h1>
                <p className="text-[11px] text-slate-400 font-medium">Project governance hub</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowFilters(!showFilters)}
                className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border transition-all duration-150 ${
                  showFilters
                    ? "bg-slate-900 text-white border-slate-900"
                    : "bg-white text-slate-600 border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                }`}
              >
                <Filter className="w-3.5 h-3.5" />
                Filters
                {hasActiveFilters && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-500 text-white text-[10px] font-bold">
                    {[q, type].filter(Boolean).length}
                  </span>
                )}
              </button>

              <button
                onClick={loadFirst}
                disabled={loading}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all duration-150 disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5" />
                )}
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6 space-y-5">
        {/* ─── Stats Cards ─── */}
        {/* Note: all stat values reflect ACTIVE artifacts only (not closed/cancelled projects or artifacts) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard
            label="Active Artifacts"
            value={stats.total}
            sub="Across open projects"
            accent="blue"
            icon={<Layers className="w-4 h-4" />}
          />
          <StatCard
            label="Updated This Week"
            value={stats.thisWeek}
            sub="Recent activity"
            accent="emerald"
            icon={<TrendingUp className="w-4 h-4" />}
          />
          <StatCard
            label="Active Projects"
            value={stats.projects}
            sub="With open artifacts"
            accent="blue"
            icon={<Folder className="w-4 h-4" />}
          />
          <StatCard
            label="Needs Attention"
            value={stats.needsAttention}
            sub={stats.attentionSub || undefined}
            accent={stats.needsAttention > 0 ? "rose" : "emerald"}
            icon={<Activity className="w-4 h-4" />}
          />
        </div>

        {/* ─── Expandable Filters ─── */}
        <div
          className={`overflow-hidden transition-all duration-300 ease-in-out ${
            showFilters ? "max-h-96 opacity-100" : "max-h-0 opacity-0 pointer-events-none"
          }`}
        >
          <div className="bg-white rounded-2xl border border-slate-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-700 uppercase tracking-widest">Filter Artifacts</h3>
              {hasActiveFilters && (
                <button
                  onClick={() => { setQ(""); setType(""); }}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold text-rose-500 hover:text-rose-600 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Clear all
                </button>
              )}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search artifacts…"
                  className="w-full rounded-lg bg-slate-50 border border-slate-200 pl-9 pr-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-400/15 outline-none transition-all"
                />
              </div>

              <select
                value={type}
                onChange={(e) => setType(e.target.value)}
                className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-2.5 text-sm text-slate-700 focus:bg-white focus:border-blue-400 focus:ring-2 focus:ring-blue-400/15 outline-none transition-all min-w-[160px]"
              >
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t} value={t}>
                    {displayType(t)}
                  </option>
                ))}
              </select>

              <button
                onClick={loadFirst}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-800 transition-colors"
              >
                {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                Apply
              </button>
            </div>
          </div>
        </div>

        {/* ─── View Toggle + Count ─── */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center bg-white rounded-lg border border-slate-200 p-1 shadow-sm gap-0.5">
            <button
              onClick={() => setView("list")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === "list"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <ListIcon className="w-3.5 h-3.5" />
              List
            </button>
            <button
              onClick={() => setView("grouped")}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                view === "grouped"
                  ? "bg-slate-900 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Grouped
            </button>
          </div>

          <p className="text-xs font-medium text-slate-400">
            {sortedItems.length} artifact{sortedItems.length !== 1 ? "s" : ""}
            {cursor && <span className="text-slate-300 mx-1.5">·</span>}
            {cursor && <span>more available</span>}
          </p>
        </div>

        {/* ─── Error ─── */}
        {error && (
          <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 flex items-center gap-2.5 font-medium">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* ─── Results ─── */}
        {loading && items.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center shadow-sm">
            <Loader2 className="w-6 h-6 text-slate-300 animate-spin mx-auto mb-3" />
            <p className="text-sm text-slate-400 font-medium">Loading artifacts…</p>
          </div>
        ) : sortedItems.length ? (
          view === "list" ? (
            /* ──── LIST VIEW ──── */
            <div className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden">
              {/* Header */}
              <div className="grid grid-cols-12 gap-4 px-6 py-3 border-b border-slate-100 bg-slate-50/60">
                <div className="col-span-3">
                  <SortButton label="Project" sortKey="project" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div className="col-span-4">
                  <SortButton label="Artifact" sortKey="artifact" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div className="col-span-2">
                  <SortButton label="Type" sortKey="type" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div className="col-span-2">
                  <SortButton label="Status" sortKey="status" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} />
                </div>
                <div className="col-span-1 flex justify-end">
                  <SortButton label="Updated" sortKey="updated" activeSortKey={sortKey} sortDir={sortDir} onToggle={toggleSort} align="right" />
                </div>
              </div>

              {/* Rows */}
              <div className="divide-y divide-slate-50">
                {sortedItems.map((a) => {
                  const isHighlighted = !!(highlightId && a.id === highlightId);
                  const openHref = buildArtifactHref(a);
                  return (
                    <div
                      key={a.id}
                      ref={(el) => { rowRefs.current[a.id] = el; }}
                      className={`group grid grid-cols-12 gap-4 px-6 py-3.5 transition-colors duration-100 ${
                        isHighlighted
                          ? "bg-blue-50/60 ring-1 ring-inset ring-blue-200"
                          : "hover:bg-slate-50/80"
                      }`}
                    >
                      {/* Project */}
                      <div className="col-span-3 flex flex-col justify-center gap-0.5 min-w-0">
                        <Link
                          href={`/projects/${a.project_id}`}
                          className="text-[11px] font-bold text-blue-600 hover:text-blue-700 hover:underline truncate"
                        >
                          {projectHumanId(a)}
                        </Link>
                        <span className="text-sm font-medium text-slate-700 truncate leading-tight">
                          {projectTitleLabel(a)}
                        </span>
                      </div>

                      {/* Artifact */}
                      <div className="col-span-4 flex items-center gap-2 min-w-0">
                        <Link
                          href={openHref}
                          className="text-sm font-semibold text-slate-800 hover:text-blue-600 transition-colors truncate"
                        >
                          {a.title}
                        </Link>
                        <AIHealthBadge artifact={a} />
                      </div>

                      {/* Type */}
                      <div className="col-span-2 flex items-center">
                        <TypeBadge type={a.type} />
                      </div>

                      {/* Status */}
                      <div className="col-span-2 flex items-center">
                        <StatusBadge status={a.status} />
                      </div>

                      {/* Updated */}
                      <div className="col-span-1 flex items-center justify-end">
                        <span className="text-xs font-medium text-slate-400 whitespace-nowrap">
                          {fmtRelativeTime(a.updated_at || a.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            /* ──── GROUPED VIEW ──── */
            <div className="space-y-4">
              {grouped.map((g) => {
                const isOpen = !collapsed[g.project_id];
                const attentionCount = g.items.filter(isNeedsAttention).length;
                return (
                  <div
                    key={g.project_id}
                    className="bg-white rounded-2xl border border-slate-100 shadow-sm overflow-hidden"
                  >
                    {/* Group Header */}
                    <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <button
                          onClick={() => toggleProjectCollapse(g.project_id)}
                          className="p-1 rounded-md hover:bg-slate-100 transition-colors flex-shrink-0"
                        >
                          {isOpen ? (
                            <ChevronDown className="w-4 h-4 text-slate-500" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-slate-500" />
                          )}
                        </button>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-bold text-blue-600 uppercase tracking-wider">
                              {g.project_human}
                            </span>
                            <h2 className="text-sm font-bold text-slate-800 truncate">{g.project_title}</h2>
                            {attentionCount > 0 && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-50 text-rose-600 border border-rose-200">
                                <AlertCircle className="w-2.5 h-2.5" />
                                {attentionCount}
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-slate-400 mt-0.5 font-medium">
                            {fmtRelativeTime(g.last_updated_raw)} · {g.items.length} artifact{g.items.length !== 1 ? "s" : ""}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Link
                          href={projectRaidHref(g.project_id)}
                          className="text-[11px] font-semibold text-slate-500 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 px-3 py-1.5 rounded-lg transition-all"
                        >
                          RAID
                        </Link>
                        <Link
                          href={projectChangeHref(g.project_id)}
                          className="text-[11px] font-semibold text-slate-500 hover:text-blue-600 bg-slate-50 hover:bg-blue-50 border border-slate-200 hover:border-blue-200 px-3 py-1.5 rounded-lg transition-all"
                        >
                          Changes
                        </Link>
                      </div>
                    </div>

                    {/* Group Rows */}
                    {isOpen && (
                      <div className="divide-y divide-slate-50">
                        {g.items.map((a) => (
                          <div
                            key={a.id}
                            className="px-5 py-3 flex items-center justify-between gap-4 hover:bg-slate-50/80 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0">
                              <TypeBadge type={a.type} />
                              <Link
                                href={buildArtifactHref(a)}
                                className="text-sm font-semibold text-slate-800 hover:text-blue-600 transition-colors truncate"
                              >
                                {a.title}
                              </Link>
                              <AIHealthBadge artifact={a} />
                            </div>
                            <div className="flex items-center gap-4 flex-shrink-0">
                              <StatusBadge status={a.status} />
                              <span className="text-xs text-slate-400 font-medium w-16 text-right">
                                {fmtRelativeTime(a.updated_at || a.created_at)}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )
        ) : (
          /* ──── EMPTY STATE ──── */
          <div className="bg-white rounded-2xl border border-slate-100 p-16 text-center shadow-sm">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-slate-100 mb-4">
              <Search className="w-5 h-5 text-slate-400" />
            </div>
            <h3 className="text-base font-bold text-slate-700">No artifacts found</h3>
            <p className="text-sm text-slate-400 mt-1">
              {hasActiveFilters ? "Try adjusting your filters or search terms." : "No active artifacts available."}
            </p>
            {hasActiveFilters && (
              <button
                onClick={() => { setQ(""); setType(""); }}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-blue-600 hover:text-blue-700"
              >
                <X className="w-4 h-4" />
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* ─── Load More ─── */}
        {cursor && !loading && (
          <div className="flex justify-center pt-2">
            <button
              onClick={loadMore}
              disabled={loadingMore}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl bg-white border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:border-slate-300 transition-all shadow-sm disabled:opacity-50"
            >
              {loadingMore ? <Loader2 className="w-4 h-4 animate-spin" /> : "Load more artifacts"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}