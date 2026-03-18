"use client";

// src/components/home/HomePage.tsx -- dashboard-summary single-effect version

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  memo,
} from "react";
import dynamic from "next/dynamic";
import type { BriefingData } from "@/lib/server/home/loadExecutiveBriefing";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import {
  Bell,
  Sparkles,
  AlertTriangle,
  ShieldCheck,
  Clock3,
  Trophy,
  CheckCircle2,
  ArrowUpRight,
  X,
  CircleDot,
  ChevronRight,
  Activity,
  Layers,
  RefreshCw,
  DollarSign,
  Search,
  SlidersHorizontal,
  Download,
  Settings,
  Calendar,
  CheckCheck,
} from "lucide-react";
import type { ResourceWeek } from "@/components/home/ResourceActivityChart";

const PortfolioAskDrawer = dynamic(() => import("@/components/home/PortfolioAskDrawer"), {
  ssr: false,
});

const ExecutiveBriefingCard = dynamic(
  () => import("@/components/home/ExecutiveBriefingCard"),
  {
    ssr: false,
    loading: () => (
      <div
        className="rounded-2xl border border-gray-100 bg-white p-6"
        style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}
      >
        <div className="animate-pulse space-y-4">
          <div className="h-5 w-48 rounded bg-gray-100" />
          <div className="h-4 w-3/4 rounded bg-gray-100" />
          <div className="grid grid-cols-2 gap-3">
            <div className="h-24 rounded-xl bg-gray-50" />
            <div className="h-24 rounded-xl bg-gray-50" />
          </div>
        </div>
      </div>
    ),
  },
);

const ResourceActivityChart = dynamic(
  () => import("@/components/home/ResourceActivityChart"),
  {
    ssr: false,
    loading: () => <div className="h-[280px] animate-pulse rounded-2xl bg-gray-50" />,
  },
);

/* --- Filter model -------------------------------------------------------- */

type PortfolioFilters = {
  q?: string;
  projectId?: string[];
  projectName?: string[];
  projectCode?: string[];
  projectManagerId?: string[];
  department?: string[];
};

/* --- Types ---------------------------------------------------------------- */

type WindowDays = 7 | 14 | 30 | 60 | "all";
type NotifRow = {
  id: string;
  user_id: string;
  project_id: string | null;
  artifact_id: string | null;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  is_read: boolean | null;
  created_at: string;
  actor_user_id: string | null;
  metadata: any;
};
type NotifApiResp = { ok: false; error: string } | { ok: true; unreadCount?: number; items: NotifRow[] };
type BellTab = "all" | "action" | "ai" | "approvals";

type DueItemType = "artifact" | "milestone" | "work_item" | "raid" | "change";
type DueDigestItem = {
  itemType: DueItemType;
  title: string;
  dueDate: string | null;
  status?: string | null;
  ownerLabel?: string | null;
  ownerEmail?: string | null;
  link?: string | null;
  meta?: any;
};

type ArtifactDueAi = {
  summary: string;
  windowDays: number;
  counts: {
    total: number;
    milestone: number;
    work_item: number;
    raid: number;
    artifact: number;
    change: number;
  };
  dueSoon: DueDigestItem[];
  recommendedMessage?: string;
};

type ArtifactDueResp =
  | { ok: false; error: string; meta?: any }
  | {
      ok: true;
      eventType: "artifact_due";
      scope?: "project" | "org";
      project_id?: string;
      project_human_id?: string | null;
      project_code?: string | null;
      project_name?: string | null;
      model?: string;
      ai: ArtifactDueAi;
      stats?: any;
    };

type Insight = {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  body: string;
  href?: string | null;
};

type HomeData =
  | { ok: false; error: string }
  | {
      ok: true;
      user: { id: string; email?: string | null };
      isExec: boolean;
      roles: string[];
      projects: {
        id: string;
        title: string;
        client_name?: string | null;
        project_code?: any;
        status?: string | null;
        lifecycle_state?: string | null;
        state?: string | null;
        phase?: string | null;
        is_active?: boolean | null;
        active?: boolean | null;
        deleted_at?: string | null;
        deletedAt?: string | null;
        is_deleted?: boolean | null;
        deleted?: boolean | null;
        is_archived?: boolean | null;
        archived?: boolean | null;
        archived_at?: string | null;
        cancelled_at?: string | null;
        closed_at?: string | null;
        department?: string | null;
        project_manager?: string | null;
        project_manager_id?: string | null;
        pm_name?: string | null;
        pm_user_id?: string | null;
      }[];
      kpis: {
        portfolioHealth: number;
        openRisks: number;
        highRisks: number;
        forecastVariance: number;
        milestonesDue: number;
        openLessons: number;
      };
      approvals: { count: number; items: any[] };
      rag: { project_id: string; title: string; rag: "G" | "A" | "R"; health: number }[];
    };

type RaidPanel = {
  days: number;
  due_total: number;
  overdue_total: number;
  risk_due?: number;
  issue_due?: number;
  dependency_due?: number;
  assumption_due?: number;
  risk_hi?: number;
  issue_hi?: number;
};

type PortfolioHealthApi =
  | { ok: false; error: string; meta?: any }
  | {
      ok: true;
      score: number | null;
      portfolio_health: number;
      days?: 7 | 14 | 30 | 60 | "all";
      windowDays?: number;
      projectCount: number;
      parts: {
        schedule: number | null;
        raid: number | null;
        budget: number | null;
        governance: number | null;
        flow?: number | null;
        approvals?: number | null;
        activity?: number | null;
      };
      projectScores?: Record<string, { score: number; rag: "G" | "A" | "R" }>;
      drivers?: any[];
      meta?: any;
    };

type RagLetter = "G" | "A" | "R";

type FinancialPlanSummary =
  | { ok: false; error: string }
  | {
      ok: true;
      total_approved_budget?: number | null;
      total_spent?: number | null;
      variance_pct?: number | null;
      pending_exposure_pct?: number | null;
      rag: "G" | "A" | "R";
      currency?: string | null;
      project_ref?: string | null;
      artifact_id?: string | null;
      project_count?: number;
      portfolio?: any;
    };

type RecentWin = {
  id: string;
  title: string;
  date: string;
  type: string;
  project_id: string;
  project_code: string | null;
  project_name: string | null;
  project_colour: string;
  link: string | null;
};

type ProjectOption = { id: string; name: string; code: string | null };

type DashboardSummaryResponse =
  | {
      ok: false;
      error?: string;
    }
  | {
      ok: true;
      generated_at?: string;
      portfolioHealth?: PortfolioHealthApi | null;
      insights?: Insight[] | null;
      financialPlan?: FinancialPlanSummary | null;
      due?: ArtifactDueResp | null;
      raidPanel?: { ok?: boolean; panel?: RaidPanel | null } | RaidPanel | null;
      resourceActivity?: { ok?: boolean; weeks?: ResourceWeek[] | null } | ResourceWeek[] | null;
      recentWins?: { ok?: boolean; wins?: RecentWin[] | null } | RecentWin[] | null;
      milestonesDue?: { ok?: boolean; count?: number | null } | number | null;
      executiveBriefing?: any | null;
    };

/* --- Utils ---------------------------------------------------------------- */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
function clamp01to100(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function clampDays(x: number) {
  if (!Number.isFinite(x)) return 60;
  return Math.max(1, Math.min(365, Math.floor(x)));
}
function normalizeWindowDays(v: WindowDays): 7 | 14 | 30 | 60 {
  if (v === "all") return 60;
  return clampDays(v) as 7 | 14 | 30 | 60;
}
function uniqStrings(input: any): string[] {
  const arr: string[] = [];
  const push = (v: any) => {
    const s = safeStr(v).trim();
    if (s) arr.push(s);
  };
  if (Array.isArray(input)) input.forEach(push);
  else if (typeof input === "string") input.split(",").forEach(push);
  else if (input != null) push(input);
  return Array.from(new Set(arr));
}
function hasActiveFilters(f: PortfolioFilters) {
  return Boolean(
    (f.q && f.q.trim()) ||
      f.projectId?.length ||
      f.projectName?.length ||
      f.projectCode?.length ||
      f.projectManagerId?.length ||
      f.department?.length,
  );
}
function searchParamsToFilters(sp: URLSearchParams): PortfolioFilters {
  const q = safeStr(sp.get("q")).trim() || undefined;
  const projectId = uniqStrings(sp.getAll("projectId").flatMap((x) => x.split(",")));
  const projectCode = uniqStrings([
    ...sp.getAll("projectCode").flatMap((x) => x.split(",")),
    ...sp.getAll("code").flatMap((x) => x.split(",")),
  ]);
  const projectName = uniqStrings(sp.getAll("name").flatMap((x) => x.split(",")));
  const pm = uniqStrings(sp.getAll("pm").flatMap((x) => x.split(",")));
  const dept = uniqStrings(sp.getAll("dept").flatMap((x) => x.split(",")));
  const out: PortfolioFilters = {};
  if (q) out.q = q;
  if (projectId.length) out.projectId = projectId;
  if (projectName.length) out.projectName = projectName;
  if (projectCode.length) out.projectCode = projectCode;
  if (pm.length) out.projectManagerId = pm;
  if (dept.length) out.department = dept;
  return out;
}
function filtersToSearchParams(f: PortfolioFilters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q?.trim()) sp.set("q", f.q.trim());
  (f.projectId ?? []).forEach((v) => sp.append("projectId", v));
  (f.projectCode ?? []).forEach((v) => sp.append("projectCode", v));
  (f.projectManagerId ?? []).forEach((v) => sp.append("pm", v));
  (f.department ?? []).forEach((v) => sp.append("dept", v));
  return sp;
}
function deriveApiFilters(f: PortfolioFilters, projectOptions: ProjectOption[]): PortfolioFilters {
  const selectedIds = new Set(f.projectId ?? []);
  if (!selectedIds.size) return f;
  const optById = new Map(projectOptions.map((p) => [p.id, p]));
  const codes: string[] = [];
  const names: string[] = [];
  for (const id of selectedIds) {
    const opt = optById.get(id);
    if (!opt) continue;
    if (opt.code) codes.push(opt.code);
    else names.push(opt.name);
  }
  return {
    ...f,
    projectCode: uniqStrings([...(f.projectCode ?? []), ...codes]),
    projectName: uniqStrings([...(f.projectName ?? []), ...names]),
  };
}
function appendFiltersToUrl(path: string, f: PortfolioFilters) {
  const sp = filtersToSearchParams(f);
  return `${path}${sp.toString() ? `?${sp.toString()}` : ""}`;
}
function timeAgo(iso: string) {
  const t = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = now - t;
  if (!Number.isFinite(t) || diffMs < 0) return "just now";
  const s = Math.floor(diffMs / 1000);
  if (s < 60) return `${s}s ago`;
  const m2 = Math.floor(s / 60);
  if (m2 < 60) return `${m2}m ago`;
  const h = Math.floor(m2 / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function groupLabel(iso: string) {
  const h = (Date.now() - new Date(iso).getTime()) / 36e5;
  if (h < 24) return "Today";
  if (h < 168) return "This week";
  return "Earlier";
}
function typeLooksApproval(t: string) {
  const s = t.toLowerCase();
  return s.includes("approval") || s.includes("approve") || s.includes("decision");
}
function typeLooksAI(t: string) {
  const s = t.toLowerCase();
  return s.includes("ai") || s.includes("warning") || s.includes("predict") || s.includes("slip");
}
function typeLooksAction(t: string) {
  const s = t.toLowerCase();
  return (
    typeLooksApproval(s) ||
    typeLooksAI(s) ||
    s.includes("overdue") ||
    s.includes("assigned") ||
    s.includes("risk") ||
    s.includes("issue") ||
    s.includes("milestone") ||
    s.includes("portfolio")
  );
}
function severityFromNotif(n: NotifRow): "high" | "medium" | "info" | "success" {
  const metaSev = safeStr(n?.metadata?.severity).toLowerCase();
  if (["high", "medium", "info", "success"].includes(metaSev)) return metaSev as any;
  const t = safeStr(n.type).toLowerCase();
  if (t.includes("success") || t.includes("completed") || t.includes("delivered")) return "success";
  if (t.includes("high") || t.includes("critical") || t.includes("breach")) return "high";
  if (t.includes("warning") || t.includes("overdue") || t.includes("at_risk") || t.includes("risk") || t.includes("issue"))
    return "medium";
  return "info";
}
function notifIcon(n: NotifRow) {
  const t = safeStr(n.type).toLowerCase();
  const sev = severityFromNotif(n);
  if (typeLooksApproval(t)) return <ShieldCheck className="h-4 w-4" />;
  if (typeLooksAI(t)) return <Sparkles className="h-4 w-4" />;
  if (t.includes("overdue")) return <Clock3 className="h-4 w-4" />;
  if (t.includes("success") || t.includes("trophy")) return <Trophy className="h-4 w-4" />;
  if (sev === "high") return <AlertTriangle className="h-4 w-4" />;
  return <CircleDot className="h-4 w-4" />;
}
function tabMatch(tab: BellTab, n: NotifRow) {
  if (tab === "all") return true;
  if (tab === "approvals") return typeLooksApproval(n.type);
  if (tab === "ai") return typeLooksAI(n.type);
  if (tab === "action") return typeLooksAction(n.type);
  return true;
}
function runIdle(fn: () => void) {
  if (typeof window !== "undefined" && typeof (window as any).requestIdleCallback === "function") {
    return (window as any).requestIdleCallback(fn, { timeout: 1200 });
  }
  return window.setTimeout(fn, 0);
}
function scoreToRag(score: number): RagLetter {
  const s = clamp01to100(score);
  if (s >= 85) return "G";
  if (s >= 70) return "A";
  return "R";
}
function projectCodeLabel(pc: any): string {
  if (typeof pc === "string") return pc.trim();
  if (typeof pc === "number" && Number.isFinite(pc)) return String(pc);
  if (pc && typeof pc === "object") {
    const v = safeStr(pc.project_code) || safeStr(pc.code) || safeStr(pc.value) || safeStr(pc.id);
    return v.trim();
  }
  return "";
}
function dueDateLabel(iso: string | null | undefined) {
  const s = safeStr(iso).trim();
  if (!s) return "--";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" });
}
function isOverdue(iso: string | null | undefined) {
  const s = safeStr(iso).trim();
  if (!s) return false;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return false;
  return t < Date.now() - 30000;
}
function calcRagAgg(
  rag: { project_id?: string; rag: RagLetter; health: number }[] | null | undefined,
  projects: { id: string }[] | null | undefined,
) {
  const proj = Array.isArray(projects) ? projects : [];
  const list = Array.isArray(rag) ? rag : [];
  const byPid = new Map<string, { rag: RagLetter; health: number }>();
  for (const it of list) {
    const pid = String(it?.project_id || "").trim();
    const letter = String(it?.rag || "").toUpperCase() as RagLetter;
    if (pid && ["G", "A", "R"].includes(letter)) {
      byPid.set(pid, { rag: letter, health: it?.health != null ? Number(it.health) : NaN });
    }
  }
  let g = 0, a = 0, r = 0, scored = 0;
  const vals: number[] = [];
  for (const p of proj) {
    const pid = String((p as any)?.id || "").trim();
    if (!pid) continue;
    const hit = byPid.get(pid);
    if (!hit) continue;
    scored++;
    if (hit.rag === "G") g++;
    else if (hit.rag === "A") a++;
    else if (hit.rag === "R") r++;
    const h = Number(hit.health);
    vals.push(Number.isFinite(h) && h > 0 ? clamp01to100(h) : hit.rag === "G" ? 90 : hit.rag === "A" ? 78 : 45);
  }
  const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0;
  return {
    avgHealth: clamp01to100(avg),
    g, a, r, scored,
    unscored: Math.max(0, proj.length - scored),
    projectsTotal: proj.length,
  };
}
function fixInsightHref(x: Insight, days?: WindowDays): string | undefined {
  const title = safeStr(x?.title).toLowerCase();
  const body = safeStr(x?.body).toLowerCase();
  const href = safeStr(x?.href).trim();
  const isWbs = title.includes("wbs") || body.includes("wbs") || href.includes("/wbs") || href.includes("type=wbs");
  if (isWbs) {
    const sp = new URLSearchParams();
    if (typeof days === "number" && Number.isFinite(days)) sp.set("days", String(days));
    const qs = sp.toString();
    return qs ? `/wbs/stats?${qs}` : "/wbs/stats";
  }
  return href || undefined;
}
function orderBriefingInsights(xs: Insight[]) {
  return [...(Array.isArray(xs) ? xs : [])].sort((a, b) => (a?.id === "ai-warning" ? 0 : 1) - (b?.id === "ai-warning" ? 0 : 1));
}
function ragDotColor(r: RagLetter) {
  return r === "G" ? "#22c55e" : r === "A" ? "#f59e0b" : "#ef4444";
}
function winTypeIcon(type: string): string {
  const t = (type ?? "").toLowerCase();
  if (t.includes("risk")) return "!";
  if (t.includes("commercial") || t.includes("budget")) return "\u00a3";
  if (t.includes("learning") || t.includes("lesson")) return "L";
  if (t.includes("change") || t.includes("governance")) return "C";
  if (t.includes("milestone") || t.includes("delivery")) return "M";
  return "*";
}
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}
function stableFilterKey(f: PortfolioFilters) {
  return JSON.stringify({
    q: f.q ?? "",
    projectId: [...(f.projectId ?? [])].sort(),
    projectName: [...(f.projectName ?? [])].sort(),
    projectCode: [...(f.projectCode ?? [])].sort(),
    projectManagerId: [...(f.projectManagerId ?? [])].sort(),
    department: [...(f.department ?? [])].sort(),
  });
}
function normalizeDueItemsFromEvent(j: ArtifactDueResp | null | undefined): DueDigestItem[] {
  if (!j || !j.ok) return [];
  const ai = (j as any).ai as ArtifactDueAi;
  const list = Array.isArray(ai?.dueSoon) ? ai.dueSoon : [];
  return list
    .sort((a: any, b: any) => {
      const ta = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      const tb = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER;
      return ta - tb;
    })
    .slice(0, 20)
    .map((x: any) => ({
      ...x,
      title: safeStr(x?.title || x?.name || x?.artifact_title || x?.milestone_title).trim() || "Untitled",
      dueDate: x?.dueDate || x?.due_date || x?.due_at || x?.deadline || null,
      ownerLabel: x?.ownerLabel || x?.owner_label || x?.owner_name || x?.assignee_name || null,
      ownerEmail: x?.ownerEmail || x?.owner_email || x?.assignee_email || null,
      link: safeStr(x?.link || x?.href || x?.url || x?.project_link).trim() || null,
      meta: {
        ...x?.meta,
        project_code: x?.meta?.project_code || x?.project_code || x?.project_human_id || null,
        project_name: x?.meta?.project_name || x?.project_name || x?.project_title || null,
      },
    }));
}
function normalizeRaidPanel(input: any, fallbackDays: number): RaidPanel | null {
  const p = input?.panel ?? input;
  if (!p || typeof p !== "object") return null;
  return {
    days: num(p.days, fallbackDays),
    due_total: num(p.due_total),
    overdue_total: num(p.overdue_total),
    risk_due: num(p.risk_due),
    issue_due: num(p.issue_due),
    dependency_due: num(p.dependency_due),
    assumption_due: num(p.assumption_due),
    risk_hi: num(p.risk_hi),
    issue_hi: num(p.issue_hi),
  };
}
function normalizeWeeks(input: any): ResourceWeek[] {
  if (Array.isArray(input)) return input as ResourceWeek[];
  if (Array.isArray(input?.weeks)) return input.weeks as ResourceWeek[];
  return [];
}
function normalizeWins(input: any): RecentWin[] {
  if (Array.isArray(input)) return input as RecentWin[];
  if (Array.isArray(input?.wins)) return input.wins as RecentWin[];
  return [];
}
function normalizeMilestonesDueCount(input: any): number | null {
  if (typeof input === "number" && Number.isFinite(input)) return Math.max(0, input);
  if (typeof input?.count === "number" && Number.isFinite(input.count)) return Math.max(0, input.count);
  return 0;
}

/* --- Notification Bell ---------------------------------------------------- */

function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BellTab>("all");
  const [items, setItems] = useState<NotifRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const r = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      const j: NotifApiResp = await r.json().catch(() => ({ ok: false, error: "Bad JSON" } as any));
      if (!j?.ok) throw new Error();
      const list = Array.isArray(j.items) ? j.items : [];
      setItems(list);
      setUnreadCount(
        Math.max(
          0,
          typeof (j as any).unreadCount === "number"
            ? (j as any).unreadCount
            : list.filter((x) => x.is_read !== true).length,
        ),
      );
    } catch {
      //
    } finally {
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    const id = runIdle(() => refresh());
    return () => {
      if (typeof window !== "undefined" && typeof (window as any).cancelIdleCallback === "function") {
        (window as any).cancelIdleCallback(id);
      } else {
        window.clearTimeout(id);
      }
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    refresh();
    pollRef.current = setInterval(refresh, 15000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [open, refresh]);

  const filtered = useMemo(() => items.filter((n) => tabMatch(tab, n)), [items, tab]);

  const grouped = useMemo(() => {
    const map = new Map<string, NotifRow[]>();
    for (const n of filtered) {
      const k = groupLabel(n.created_at);
      const arr = map.get(k) ?? [];
      arr.push(n);
      map.set(k, arr);
    }
    return Array.from(map.entries());
  }, [filtered]);

  async function markRead(id: string) {
    const wasUnread = items.some((n) => n.id === id && n.is_read !== true);
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    if (wasUnread) setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
    } catch {
      refresh();
    }
  }

  async function markAllRead() {
    if (!items.filter((n) => n.is_read !== true).length) return;
    setItems((prev) => prev.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
    try {
      await fetch("/api/notifications/read-all", { method: "POST" });
    } catch {
      refresh();
    }
  }

  function onClickItem(n: NotifRow) {
    if (n.is_read !== true) markRead(n.id);
    setOpen(false);
    const href = safeStr(n.link || n.metadata?.href || "").trim();
    if (href) router.push(href);
  }

  const hasUnread = unreadCount > 0;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Notifications"
        title="Notifications"
        className={[
          "relative flex h-9 w-9 items-center justify-center rounded-xl border transition-colors",
          open
            ? "border-gray-900 bg-gray-900"
            : hasUnread
              ? "border-blue-200 bg-blue-50 hover:bg-blue-100"
              : "border-gray-200 bg-white hover:bg-gray-50",
        ].join(" ")}
      >
        <Bell className={["h-4 w-4 transition-colors", open ? "text-white" : hasUnread ? "text-blue-700" : "text-gray-700"].join(" ")} />
        {hasUnread && (
          <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white ring-2 ring-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <m.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute right-0 top-full z-50 mt-2 w-[400px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl"
            >
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div className="font-semibold text-gray-900">Notifications</div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={markAllRead}
                    className="flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900"
                  >
                    <CheckCheck className="h-3 w-3" /> Mark all read
                  </button>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-gray-100"
                  >
                    <X className="h-3.5 w-3.5 text-gray-400" />
                  </button>
                </div>
              </div>

              <div className="flex gap-1 border-b border-gray-100 bg-gray-50/50 px-3 py-2">
                {(["all", "action", "ai", "approvals"] as BellTab[]).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setTab(k)}
                    className={[
                      "rounded-lg px-2.5 py-1 text-xs font-medium transition-all",
                      tab === k ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-gray-100",
                    ].join(" ")}
                  >
                    {k === "all" ? "All" : k === "action" ? "Action" : k === "ai" ? "AI" : "Approvals"}
                  </button>
                ))}
              </div>

              <div className="max-h-[420px] overflow-auto">
                {grouped.length === 0 ? (
                  <div className="py-12 text-center">
                    <CheckCheck className="mx-auto mb-2 h-8 w-8 text-gray-300" />
                    <div className="text-sm font-medium text-gray-600">All caught up</div>
                  </div>
                ) : (
                  grouped.map(([label, rows]) => (
                    <div key={label}>
                      <div className="px-4 pb-1.5 pt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                        {label}
                      </div>
                      <div className="space-y-0.5 px-2 pb-1">
                        {rows.map((n) => {
                          const unread = n.is_read !== true;
                          const sev = severityFromNotif(n);
                          return (
                            <button
                              key={n.id}
                              type="button"
                              onClick={() => onClickItem(n)}
                              className={[
                                "w-full rounded-xl border px-3 py-2.5 text-left transition-all",
                                unread ? "border-blue-100 bg-blue-50/60" : "border-transparent hover:bg-gray-50",
                              ].join(" ")}
                            >
                              <div className="flex items-start gap-2.5">
                                <div
                                  className={[
                                    "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border",
                                    sev === "high"
                                      ? "border-red-100 bg-red-50 text-red-500"
                                      : sev === "medium"
                                        ? "border-amber-100 bg-amber-50 text-amber-500"
                                        : sev === "success"
                                          ? "border-green-100 bg-green-50 text-green-500"
                                          : "border-blue-100 bg-blue-50 text-blue-500",
                                  ].join(" ")}
                                >
                                  {notifIcon(n)}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="truncate text-sm font-medium text-gray-800">{n.title}</div>
                                    <div className="shrink-0 text-[11px] text-gray-400">{timeAgo(n.created_at)}</div>
                                  </div>
                                  {n.body && <div className="mt-0.5 line-clamp-1 text-xs text-gray-500">{n.body}</div>}
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="border-t border-gray-100 px-5 py-2.5">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    router.push("/notifications");
                  }}
                  className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  View all notifications <ChevronRight className="h-3 w-3" />
                </button>
              </div>
            </m.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

/* --- KPI Card ------------------------------------------------------------- */

const KPI_THEMES: Record<string, { bg: string; iconBg: string; iconColor: string; valueColor: string; labelColor: string; subColor: string; trendBg: string; trendColor: string }> = {
  green:  { bg: "bg-green-50",  iconBg: "bg-green-100",  iconColor: "text-green-600",  valueColor: "text-green-700",  labelColor: "text-green-800",  subColor: "text-green-600/80",  trendBg: "bg-green-100",  trendColor: "text-green-700"  },
  amber:  { bg: "bg-amber-50",  iconBg: "bg-amber-100",  iconColor: "text-amber-600",  valueColor: "text-amber-700",  labelColor: "text-amber-800",  subColor: "text-amber-600/80",  trendBg: "bg-amber-100",  trendColor: "text-amber-700"  },
  red:    { bg: "bg-red-50",    iconBg: "bg-red-100",    iconColor: "text-red-500",    valueColor: "text-red-600",    labelColor: "text-red-800",    subColor: "text-red-600/80",    trendBg: "bg-red-100",    trendColor: "text-red-600"    },
  blue:   { bg: "bg-blue-50",   iconBg: "bg-blue-100",   iconColor: "text-blue-600",   valueColor: "text-blue-700",   labelColor: "text-blue-800",   subColor: "text-blue-600/80",   trendBg: "bg-blue-100",   trendColor: "text-blue-700"   },
  yellow: { bg: "bg-yellow-50", iconBg: "bg-yellow-100", iconColor: "text-yellow-600", valueColor: "text-yellow-700", labelColor: "text-yellow-800", subColor: "text-yellow-600/80", trendBg: "bg-yellow-100", trendColor: "text-yellow-700" },
};

const KpiCard = memo(function KpiCard({ label, value, sub, icon, colorKey, trendLabel, onClick }: {
  label: string; value: string; sub?: string; icon: React.ReactNode; colorKey: string; trendLabel?: string; onClick?: () => void;
}) {
  const t = KPI_THEMES[colorKey] || KPI_THEMES.blue;
  const clickable = typeof onClick === "function";
  return (
    <div onClick={onClick} className={["rounded-2xl p-6 transition-all duration-200", t.bg, clickable ? "cursor-pointer hover:-translate-y-0.5 hover:brightness-[0.97]" : ""].join(" ")}>
      <div className="mb-4 flex items-start justify-between">
        <div className={["flex h-11 w-11 items-center justify-center rounded-xl", t.iconBg].join(" ")}>
          <span className={t.iconColor}>{icon}</span>
        </div>
        {trendLabel && (
          <div className={["flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", t.trendBg, t.trendColor].join(" ")}>
            <ArrowUpRight className="h-3 w-3" />{trendLabel}
          </div>
        )}
      </div>
      <div className={["text-4xl font-bold leading-none tracking-tight", t.valueColor].join(" ")}>{value}</div>
      <div className={["mt-2 text-sm font-semibold", t.labelColor].join(" ")}>{label}</div>
      {sub && <div className={["mt-0.5 text-xs", t.subColor].join(" ")}>{sub}</div>}
    </div>
  );
});

/* --- Insight Card --------------------------------------------------------- */

const InsightCard = memo(function InsightCard({ severity, title, body, href }: {
  severity: "high" | "medium" | "info"; title: string; body: string; href?: string;
}) {
  const cfg = {
    high:   { wrap: "border border-red-100 bg-red-50/70",    icon: <AlertTriangle className="h-4 w-4 text-red-500" />,   badge: "text-red-500 font-bold text-xs",   badgeText: "HIGH"   },
    medium: { wrap: "border border-amber-100 bg-amber-50/60", icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, badge: "text-amber-600 font-bold text-xs", badgeText: "MEDIUM" },
    info:   { wrap: "border border-blue-100 bg-blue-50/50",   icon: <Sparkles className="h-4 w-4 text-blue-500" />,      badge: "text-blue-600 font-bold text-xs",  badgeText: "INFO"   },
  }[severity];

  return (
    <div className={["rounded-xl p-4", cfg.wrap].join(" ")}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 shrink-0">{cfg.icon}</div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-800">{title}</span>
            <span className={cfg.badge}>{cfg.badgeText}</span>
          </div>
          <p className="text-xs leading-relaxed text-gray-600">{body}</p>
          {href && (
            <a href={href} className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">
              View details <ChevronRight className="h-3 w-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
});

/* --- Project Row ---------------------------------------------------------- */

const ProjectRow = memo(function ProjectRow({ p, ragMap }: { p: any; ragMap: Map<string, { rag: RagLetter; health: number }> }) {
  const router = useRouter();
  const code = projectCodeLabel(p?.project_code);
  const pid = String(p?.id || "").trim();
  const ragData = ragMap.get(pid);
  const health = ragData ? clamp01to100(ragData.health) : null;
  const rag = ragData?.rag || null;
  const client = safeStr(p?.client_name).trim();
  const dotColor = rag ? ragDotColor(rag) : "#d1d5db";
  const ragLabel = rag === "G" ? "Green" : rag === "A" ? "Amber" : rag === "R" ? "Red" : "Unscored";
  const ragLogic = rag === "G" ? `Health >= 85% (${health}%). Delivery signals are strong.` : rag === "A" ? `Health 70-84% (${health}%). Some signals need attention.` : rag === "R" ? `Health < 70% (${health}%). Significant delivery risk.` : "No health score calculated yet for this project.";

  return (
    <div
      role="button" tabIndex={0}
      onClick={() => { if (pid) router.push(`/projects/${encodeURIComponent(pid)}`); }}
      onKeyDown={(e) => e.key === "Enter" && pid && router.push(`/projects/${encodeURIComponent(pid)}`)}
      className="group flex w-full cursor-pointer items-center gap-4 border-b border-gray-50 px-6 py-4 text-left transition-colors hover:bg-gray-50 last:border-0"
    >
      <div className="group/rag relative shrink-0" onClick={(e) => e.stopPropagation()}>
        <div className="h-3 w-3 cursor-help rounded-full ring-2 ring-transparent group-hover/rag:ring-offset-1" style={{ background: dotColor, boxShadow: `0 0 0 2px ${dotColor}22` }} />
        <div className="pointer-events-none absolute left-5 top-1/2 z-50 w-64 -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-3 text-left opacity-0 transition-opacity duration-150 group-hover/rag:opacity-100" style={{ boxShadow: "0 8px 24px rgba(0,0,0,0.13)" }}>
          <div className="mb-1.5 flex items-center gap-2">
            <div className="h-3 w-3 shrink-0 rounded-full" style={{ background: dotColor }} />
            <span className="text-xs font-bold text-gray-900">{ragLabel}{health != null ? ` -- ${health}%` : ""}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">{ragLogic}</p>
          <div className="mt-2 border-t border-gray-100 pt-2 text-[10px] text-gray-400">
            Thresholds: <span className="font-semibold text-green-600">Green &gt;= 85%</span> - <span className="font-semibold text-amber-600">Amber 70-84%</span> - <span className="font-semibold text-red-500">Red &lt; 70%</span>
          </div>
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold text-gray-800 transition-colors group-hover:text-blue-600">{p?.title || "Project"}</div>
        {client && <div className="mt-0.5 text-xs text-gray-400">{client}</div>}
      </div>
      {code && <div className="shrink-0 whitespace-nowrap rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-400">{code}</div>}
      <div className="flex w-32 shrink-0 items-center gap-2.5">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div className="h-full rounded-full" style={{ width: `${health ?? 0}%`, background: dotColor, transition: "width 0.6s ease" }} />
        </div>
        <span className="w-8 text-right text-xs font-bold text-gray-600">{health != null ? `${health}%` : "--"}</span>
      </div>
      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300 transition-colors group-hover:text-gray-500" />
    </div>
  );
});

/* --- Milestone Card ------------------------------------------------------- */

const MilestoneCard = memo(function MilestoneCard({ item, onClick }: { item: DueDigestItem; onClick: () => void }) {
  const overdue = isOverdue(item.dueDate);
  const daysLeft = item.dueDate ? Math.ceil((new Date(item.dueDate).getTime() - Date.now()) / 86400000) : null;
  const statusCfg = overdue
    ? { badge: "bg-red-100 text-red-600 border border-red-200", text: "Overdue" }
    : daysLeft != null && daysLeft <= 5
      ? { badge: "bg-amber-100 text-amber-600 border border-amber-200", text: "At Risk" }
      : { badge: "bg-green-100 text-green-600 border border-green-200", text: "On Track" };
  const initials = item.ownerLabel ? item.ownerLabel.split(" ").map((w: string) => w[0]).slice(0, 2).join("").toUpperCase() : null;
  const avatarColors = ["bg-blue-100 text-blue-700", "bg-purple-100 text-purple-700", "bg-green-100 text-green-700", "bg-orange-100 text-orange-700", "bg-pink-100 text-pink-700"];
  const avatarColor = initials ? avatarColors[initials.charCodeAt(0) % avatarColors.length] : avatarColors[0];
  const projectCode = safeStr(item.meta?.project_code || item.meta?.project_human_id || "").trim();
  const projectName = safeStr(item.meta?.project_name || item.meta?.project_title || "").trim();

  return (
    <button type="button" onClick={onClick} className="w-full rounded-xl border border-gray-100 bg-white p-4 text-left transition-all hover:border-gray-200 hover:shadow-sm">
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <span className="line-clamp-1 flex-1 text-sm font-semibold text-gray-800">{item.title}</span>
        <span className={["shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[10px] font-semibold", statusCfg.badge].join(" ")}>{statusCfg.text}</span>
      </div>
      {(projectCode || projectName) && (
        <div className="mb-1.5 flex items-center gap-1.5">
          {projectCode && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono font-bold text-gray-400">{projectCode}</span>}
          {projectName && <span className="truncate text-[11px] text-gray-400">{projectName}</span>}
        </div>
      )}
      <div className="mb-3 flex items-center gap-1 text-xs text-gray-400">
        <Clock3 className="h-3 w-3" />
        {overdue ? "Overdue" : daysLeft != null && daysLeft > 0 ? `${daysLeft} days remaining` : "Due soon"}
      </div>
      <div className="flex items-center justify-between">
        {initials ? (
          <div className="flex items-center gap-2">
            <div className={["flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold", avatarColor].join(" ")}>{initials}</div>
            <span className="text-xs text-gray-500">{item.ownerLabel}</span>
          </div>
        ) : <div />}
        <span className="text-xs text-gray-400">{dueDateLabel(item.dueDate)}</span>
      </div>
    </button>
  );
});

/* --- Recent Win Card ------------------------------------------------------ */

const RecentWinCard = memo(function RecentWinCard({ win, onClick }: { win: RecentWin; onClick: () => void }) {
  const icon = winTypeIcon(win.type);
  const dateLabel = win.date ? new Date(win.date + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) : "";
  const typeLabel = (win.type ?? "other").charAt(0).toUpperCase() + (win.type ?? "other").slice(1).replace(/_/g, " ");

  return (
    <button type="button" onClick={onClick} className="w-full rounded-xl border border-green-100 bg-green-50/40 p-3.5 text-left transition-all hover:border-green-200 hover:bg-green-50/80 hover:shadow-sm">
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 shrink-0 text-lg leading-none">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="line-clamp-2 text-sm font-semibold leading-snug text-gray-800">{win.title}</div>
          {(win.project_code || win.project_name) && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {win.project_code && <span className="rounded border border-gray-100 bg-white/80 px-1.5 py-0.5 text-[10px] font-mono font-bold text-gray-400">{win.project_code}</span>}
              {win.project_name && <span className="truncate text-[11px] text-gray-400">{win.project_name}</span>}
              {(win as any).pm_name && <span className="truncate text-[11px] text-blue-400">{(win as any).pm_name}</span>}
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between">
            <span className="text-[11px] font-semibold text-green-600">{typeLabel}</span>
            {dateLabel && <span className="text-[11px] text-gray-400">{dateLabel}</span>}
          </div>
        </div>
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-400" />
      </div>
    </button>
  );
});

/* --- Last Updated --------------------------------------------------------- */

const LastUpdated = memo(function LastUpdated({ iso }: { iso: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => {
    function tick() { setLabel(iso ? timeAgo(iso) : ""); }
    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso || !label) return null;
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      <RefreshCw className="h-3 w-3" />
      <span>Updated {label}</span>
    </div>
  );
});

/* --- Filter Drawer -------------------------------------------------------- */

const CheckboxList = memo(function CheckboxList({ label, items, selected, onToggle, emptyText }: {
  label: string; items: { id: string; name: string; sub?: string }[]; selected: string[]; onToggle: (id: string) => void; emptyText: string;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => items.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())), [items, search]);

  return (
    <div>
      <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">{label}</div>
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-gray-400" />
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${label.toLowerCase()}...`} className="w-full bg-transparent text-xs outline-none placeholder:text-gray-400" />
          {search && <button type="button" onClick={() => setSearch("")} className="shrink-0 text-gray-300 hover:text-gray-500"><X className="h-3 w-3" /></button>}
        </div>
        <div className="max-h-44 overflow-y-auto">
          {items.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">{emptyText}</div>
          ) : filtered.length === 0 ? (
            <div className="px-3 py-3 text-xs text-gray-400">No match</div>
          ) : (
            filtered.map((item) => {
              const checked = selected.includes(item.id);
              return (
                <button key={item.id} type="button" onClick={() => onToggle(item.id)} className={["flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors", checked ? "bg-blue-50/60" : "hover:bg-gray-50"].join(" ")}>
                  <div className={["flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-all", checked ? "border-blue-500 bg-blue-500" : "border-gray-300 bg-white"].join(" ")}>
                    {checked && <svg width="9" height="7" viewBox="0 0 9 7" fill="none"><path d="M1 3.5l2.5 2.5L8 1" stroke="white" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className={["truncate text-sm", checked ? "font-semibold text-gray-900" : "text-gray-700"].join(" ")}>{item.name}</div>
                    {item.sub && <div className="truncate text-[11px] text-gray-400">{item.sub}</div>}
                  </div>
                </button>
              );
            })
          )}
        </div>
        {selected.length > 0 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-3 py-2">
            <span className="text-[11px] text-gray-400">{selected.length} selected</span>
            <button type="button" onClick={() => selected.forEach((id) => onToggle(id))} className="text-[11px] font-semibold text-red-500 hover:text-red-600">Clear</button>
          </div>
        )}
      </div>
    </div>
  );
});

function FilterDrawer({ open, onClose, filters, onApply, onClear, projectOptions, pmOptions, deptOptions, searchInputRef }: {
  open: boolean; onClose: () => void; filters: PortfolioFilters; onApply: (next: PortfolioFilters) => void; onClear: () => void;
  projectOptions: ProjectOption[]; pmOptions: { id: string; name: string }[]; deptOptions: { value: string; label: string }[]; searchInputRef: React.RefObject<HTMLInputElement>;
}) {
  const [local, setLocal] = useState<PortfolioFilters>(filters);
  useEffect(() => { if (open) setLocal(filters); }, [open, filters]);

  const toggle = (key: keyof PortfolioFilters, value: string) => {
    setLocal((prev) => {
      const arr = (prev[key] as string[] | undefined) ?? [];
      const exists = arr.includes(value);
      const nextArr = exists ? arr.filter((x) => x !== value) : [...arr, value];
      return { ...prev, [key]: nextArr.length ? nextArr : undefined };
    });
  };

  const activeCount = (local.projectId?.length ?? 0) + (local.projectManagerId?.length ?? 0) + (local.department?.length ?? 0) + (local.q?.trim() ? 1 : 0);

  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[60] bg-black/30" onClick={onClose} />
          <m.div initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={{ duration: 0.18 }} className="fixed right-0 top-0 z-[70] flex h-full w-full max-w-[420px] flex-col border-l border-gray-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-5 py-4">
              <div>
                <div className="font-semibold text-gray-900">Filters</div>
                <div className="text-xs text-gray-500">Filter portfolio by project and ownership</div>
              </div>
              <button className="flex h-9 w-9 items-center justify-center rounded-full ring-1 ring-gray-200 hover:bg-gray-50" onClick={onClose} aria-label="Close"><X className="h-4 w-4 text-gray-600" /></button>
            </div>
            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-400">Search</div>
                <div className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5">
                  <Search className="h-4 w-4 shrink-0 text-gray-400" />
                  <input ref={searchInputRef} value={local.q ?? ""} onChange={(e) => setLocal((p) => ({ ...p, q: e.target.value }))} placeholder="Project name, code, PM, department..." className="w-full bg-transparent text-sm outline-none placeholder:text-gray-400" />
                  {local.q && <button type="button" onClick={() => setLocal((p) => ({ ...p, q: undefined }))} className="text-gray-300 hover:text-gray-500"><X className="h-4 w-4" /></button>}
                </div>
              </div>
              <CheckboxList label="Projects" items={projectOptions.slice(0, 50).map((p) => ({ id: p.id, name: p.name, sub: p.code ?? undefined }))} selected={local.projectId ?? []} onToggle={(id) => toggle("projectId", id)} emptyText="No projects available" />
              <CheckboxList label="Project Manager" items={pmOptions.map((pm) => ({ id: pm.id, name: pm.name }))} selected={local.projectManagerId ?? []} onToggle={(id) => toggle("projectManagerId", id)} emptyText="No project managers found" />
              <CheckboxList label="Department" items={deptOptions.map((d) => ({ id: d.value, name: d.label }))} selected={local.department ?? []} onToggle={(id) => toggle("department", id)} emptyText="No departments found" />
            </div>
            <div className="border-t border-gray-200 bg-gray-50/60 p-4">
              {activeCount > 0 && (
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-xs text-gray-500"><span className="font-semibold text-gray-900">{activeCount}</span> filter{activeCount !== 1 ? "s" : ""} active</span>
                  <button type="button" onClick={onClear} className="text-xs font-semibold text-red-500 hover:text-red-600">Clear all</button>
                </div>
              )}
              <div className="flex gap-2">
                <button type="button" onClick={onClose} className="h-10 flex-1 rounded-xl border border-gray-300 bg-white text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50">Cancel</button>
                <button type="button" onClick={() => onApply(local)} className="h-10 flex-1 rounded-xl bg-gray-900 text-sm font-semibold text-white transition-colors hover:bg-gray-800">Apply filters</button>
              </div>
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
}

/* --- Main ----------------------------------------------------------------- */

export default function HomePage({
  data,
  executiveBriefing,
}: {
  data: HomeData;
  executiveBriefing?: BriefingData | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  const ok = data?.ok === true;
  const projects = ok ? data.projects : [];
  const rag = ok ? data.rag || [] : [];

  const searchParamString = sp?.toString() || "";
  const urlFilters = useMemo(() => searchParamsToFilters(new URLSearchParams(searchParamString)), [searchParamString]);
  const filterKey = useMemo(() => stableFilterKey(urlFilters), [urlFilters]);
  const filtersActive = useMemo(() => hasActiveFilters(urlFilters), [urlFilters]);

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOpenViaSearch, setDrawerOpenViaSearch] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const openDrawerFocusSearch = useCallback(() => {
    setDrawerOpenViaSearch(true);
    setDrawerOpen(true);
    setTimeout(() => { searchInputRef.current?.focus(); }, 200);
  }, []);

  const applyFilters = useCallback((next: PortfolioFilters) => {
    const params = filtersToSearchParams(next);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`, { scroll: false });
  }, [router, pathname]);

  const clearFilters = useCallback(() => { router.replace(pathname, { scroll: false }); }, [router, pathname]);

  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const debouncedWindowDays = useDebounced(windowDays, 300);
  const numericWindowDays = useMemo<7 | 14 | 30 | 60>(() => normalizeWindowDays(debouncedWindowDays), [debouncedWindowDays]);

  const [phData, setPhData] = useState<PortfolioHealthApi | null>(null);
  const [phPrevScore] = useState<number | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);
  const [milestonesDueLive, setMilestonesDueLive] = useState<number | null>(null);
  const [raidPanel, setRaidPanel] = useState<RaidPanel | null>(null);
  const [raidLoading, setRaidLoading] = useState(false);
  const [dueWindowDays, setDueWindowDays] = useState<7 | 14 | 30>(14);
  const [dueLoading, setDueLoading] = useState(false);
  const [dueItems, setDueItems] = useState<DueDigestItem[]>([]);
  const [dueUpdatedAt, setDueUpdatedAt] = useState<string>("");
  const [fpSummary, setFpSummary] = useState<FinancialPlanSummary | null>(null);
  const [fpLoading, setFpLoading] = useState(false);
  const [resourceWeeks, setResourceWeeks] = useState<ResourceWeek[]>([]);
  const [resourceLoading, setResourceLoading] = useState(true);
  const [recentWins, setRecentWins] = useState<RecentWin[]>([]);
  const [winsLoading, setWinsLoading] = useState(true);

  //  Change 1: briefingData state
 const [briefingData, setBriefingData] = useState<any | null>(
  (data as any)?.briefing ?? null
);

  const projectOptions = useMemo<ProjectOption[]>(() => {
    return (Array.isArray(projects) ? projects : [])
      .map((p: any) => ({ id: String(p?.id || "").trim(), name: safeStr(p?.title || "Project").trim(), code: projectCodeLabel(p?.project_code) || null }))
      .filter((p) => p.id)
      .sort((a, b) => (a.code || a.name).localeCompare(b.code || b.name));
  }, [projects]);

  const pmOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of (Array.isArray(projects) ? projects : []) as any[]) {
      const name = safeStr(p?.project_manager || p?.pm_name || p?.manager_name || p?.project_manager_name || p?.manager || p?.pm || p?.owner_name).trim();
      const id = safeStr(p?.project_manager_id || p?.pm_user_id || p?.manager_id || p?.project_manager_user_id || p?.owner_id).trim();
      if (!name) continue;
      map.set(id || name, name);
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [projects]);

  const deptOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of (Array.isArray(projects) ? projects : []) as any[]) {
      const d = safeStr(p?.department).trim();
      if (d) set.add(d);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b)).map((d) => ({ value: d, label: d }));
  }, [projects]);

  const derivedApiFilters = useMemo(() => deriveApiFilters(urlFilters, projectOptions), [urlFilters, projectOptions]);
  const apiFilterSnapshot = useMemo(() => stableFilterKey(derivedApiFilters), [derivedApiFilters]);

  const filteredProjectsClient = useMemo(() => {
    const rows = Array.isArray(projects) ? [...projects] : [];
    const f = urlFilters;
    const q = safeStr(f.q).trim().toLowerCase();
    const idSet = new Set((f.projectId ?? []).map((s) => String(s).trim()).filter(Boolean));
    const nameNeedles = (f.projectName ?? []).map((s) => safeStr(s).trim().toLowerCase()).filter(Boolean);
    const codeNeedles = (f.projectCode ?? []).map((s) => safeStr(s).trim().toLowerCase()).filter(Boolean);
    const pmSet = new Set((f.projectManagerId ?? []).map((s) => String(s).trim()).filter(Boolean));
    const deptNeedles = (f.department ?? []).map((s) => safeStr(s).trim().toLowerCase()).filter(Boolean);

    return rows.filter((p: any) => {
      const pid = safeStr(p?.id).trim();
      const title = safeStr(p?.title).toLowerCase();
      const code = projectCodeLabel(p?.project_code).toLowerCase();
      const dept = safeStr(p?.department).toLowerCase().trim();
      const pm = safeStr(p?.project_manager_id).trim();
      const pmName = safeStr(p?.project_manager).toLowerCase().trim();
      if (idSet.size && !idSet.has(pid)) return false;
      if (nameNeedles.length && !nameNeedles.some((n) => title.includes(n))) return false;
      if (codeNeedles.length && !codeNeedles.some((c) => code.includes(c))) return false;
      if (pmSet.size && !(pmSet.has(pm) || pmSet.has(pmName))) return false;
      if (deptNeedles.length && (!dept || !deptNeedles.some((d) => dept.includes(d)))) return false;
      if (q) { const hay = `${title} ${code} ${dept} ${pmName}`.trim(); if (!hay.includes(q)) return false; }
      return true;
    });
  }, [projects, filterKey]);

  const activeProjects = useMemo(() => {
    const truthy = (v: any) => v === true || v === "true" || v === 1 || v === "1";
    return (Array.isArray(filteredProjectsClient) ? filteredProjectsClient : []).filter((p: any) => {
      if (p?.deleted_at || p?.deletedAt) return false;
      if (truthy(p?.is_deleted) || truthy(p?.deleted)) return false;
      if (truthy(p?.is_archived) || truthy(p?.archived)) return false;
      if (p?.archived_at) return false;
      if (p?.is_active === false || p?.active === false) return false;
      const st = [p?.status, p?.lifecycle_state, p?.state, p?.phase].map((v: any) => String(v ?? "").toLowerCase().trim()).find(Boolean) || "";
      if (!st) return true;
      return !["closed", "cancel", "deleted", "archive", "inactive", "complete", "on_hold", "paused", "suspended"].some((k) => st.includes(k));
    });
  }, [filteredProjectsClient]);

  const sortedProjects = useMemo(
    () => [...activeProjects].sort((a: any, b: any) => {
      const ac = projectCodeLabel(a?.project_code);
      const bc = projectCodeLabel(b?.project_code);
      const an = Number(ac); const bn = Number(bc);
      const aNum = Number.isFinite(an) && ac !== "";
      const bNum = Number.isFinite(bn) && bc !== "";
      if (aNum && bNum && an !== bn) return an - bn;
      if (ac && bc && ac !== bc) return ac.localeCompare(bc);
      return safeStr(a?.title).toLowerCase().localeCompare(safeStr(b?.title).toLowerCase());
    }),
    [activeProjects],
  );

  const ragMap = useMemo(() => {
    const m2 = new Map<string, { rag: RagLetter; health: number }>();
    for (const it of rag || []) {
      if (it?.project_id) m2.set(String(it.project_id), { rag: it.rag as RagLetter, health: Number(it.health) });
    }
    return m2;
  }, [rag]);

  const mergedRagMap = useMemo(() => {
    const merged = new Map(ragMap);
    if (phData?.ok && phData.projectScores) {
      for (const [pid, { score, rag: liveRag }] of Object.entries(phData.projectScores)) {
        merged.set(pid, { rag: liveRag, health: score });
      }
    }
    return merged;
  }, [ragMap, phData]);

  const ragAgg = useMemo(() => calcRagAgg(rag as any, activeProjects as any), [rag, activeProjects]);

  const liveRagCounts = useMemo(() => {
    let g = 0, a = 0, r = 0;
    for (const p of activeProjects as any[]) {
      const pid = String(p?.id || "").trim();
      const entry = mergedRagMap.get(pid);
      if (!entry) continue;
      if (entry.rag === "G") g++;
      else if (entry.rag === "A") a++;
      else if (entry.rag === "R") r++;
    }
    return { g, a, r };
  }, [activeProjects, mergedRagMap]);

  /* -- Single dashboard-summary effect ------------------------------------ */

  useEffect(() => {
    if (!ok) return;
    let cancelled = false;
    const controller = new AbortController();

    setResourceLoading(true);
    setWinsLoading(true);
    setInsightsLoading(true);
    setFpLoading(true);
    setDueLoading(true);
    setRaidLoading(true);

    const idleId = runIdle(() => {
      (async () => {
        try {
          const r = await fetch("/api/home/dashboard-summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            cache: "no-store",
            signal: controller.signal,
            body: JSON.stringify({ days: numericWindowDays, dueWindowDays, filters: derivedApiFilters }),
          });

          const j: DashboardSummaryResponse = await r.json().catch(() => ({ ok: false, error: "Bad JSON" }));

          if (cancelled || !j?.ok) {
            if (!cancelled) {
              setInsights([]);
              setResourceWeeks([]);
              setRecentWins([]);
              setFpSummary(null);
              setDueItems([]);
              setRaidPanel(null);
              setMilestonesDueLive(0);
              //  Change 3a: reset on error
              setBriefingData(null);
            }
            return;
          }

          const nextPh        = j.portfolioHealth ?? null;
          const nextInsights  = orderBriefingInsights(Array.isArray(j.insights) ? j.insights : []);
          const nextFp        = j.financialPlan ?? null;
          const nextDueItems  = normalizeDueItemsFromEvent(j.due ?? null);
          const nextRaid      = normalizeRaidPanel(j.raidPanel, numericWindowDays);
          const nextWeeks     = normalizeWeeks(j.resourceActivity);
          const nextWins      = normalizeWins(j.recentWins);
          const nextMilestones = normalizeMilestonesDueCount(j.milestonesDue);

          if (cancelled) return;

          setPhData(nextPh);
          setInsights(nextInsights);
          setFpSummary(nextFp);
          setDueItems(nextDueItems);
          setRaidPanel(nextRaid);
          setResourceWeeks(nextWeeks);
          setRecentWins(nextWins);
          setMilestonesDueLive(nextMilestones);
          setDueUpdatedAt(safeStr(j.generated_at).trim() || new Date().toISOString());

          //  Change 2: wire executive briefing from API response
          const executiveBriefingFromApi =
            (j as any).executiveBriefing ||
            (j as any).aiBriefing?.executive_briefing ||
            (j as any).aiBriefing?.briefing ||
            null;
          setBriefingData(executiveBriefingFromApi);

        } catch {
          if (!cancelled) {
            setInsights([]);
            setResourceWeeks([]);
            setRecentWins([]);
            setFpSummary(null);
            setDueItems([]);
            setRaidPanel(null);
            setMilestonesDueLive(0);
            //  Change 3b: reset on catch
            setBriefingData(null);
          }
        } finally {
          if (!cancelled) {
            setResourceLoading(false);
            setWinsLoading(false);
            setInsightsLoading(false);
            setFpLoading(false);
            setDueLoading(false);
            setRaidLoading(false);
          }
        }
      })();
    });

    return () => {
      cancelled = true;
      controller.abort();
      if (typeof window !== "undefined" && typeof (window as any).cancelIdleCallback === "function") {
        (window as any).cancelIdleCallback(idleId);
      } else {
        window.clearTimeout(idleId);
      }
    };
  }, [ok, numericWindowDays, dueWindowDays, apiFilterSnapshot]);

  /* -- Derived values ----------------------------------------------------- */

  const apiScore = phData?.ok
    ? clamp01to100((phData as any).score != null ? (phData as any).score : (phData as any).portfolio_health)
    : null;

  const phScoreForUi = apiScore != null && apiScore > 0 ? apiScore : null;
  const phRag = scoreToRag(phScoreForUi ?? 0);
  const phDelta = phPrevScore != null && phScoreForUi != null ? phScoreForUi - phPrevScore : null;

  const raidDueTotal = useMemo(() => {
    if (!raidPanel) return 0;
    const typedAvailable = raidPanel.risk_due != null || raidPanel.issue_due != null || raidPanel.dependency_due != null || raidPanel.assumption_due != null;
    if (typedAvailable) return num(raidPanel.risk_due) + num(raidPanel.issue_due) + num(raidPanel.dependency_due) + num(raidPanel.assumption_due);
    return num(raidPanel.due_total);
  }, [raidPanel]);

  const openRisksValue = raidPanel ? raidDueTotal : null;
  const raidHighSeverity = num(raidPanel?.risk_hi) + num(raidPanel?.issue_hi);

  const fpHasData = fpSummary?.ok === true;
  const fpPortfolioPre = fpHasData ? (fpSummary as any).portfolio : null;
  const fpVariancePct = fpHasData ? (fpSummary as any).variance_pct ?? fpPortfolioPre?.variance_pct ?? fpPortfolioPre?.variancePct ?? fpPortfolioPre?.variance : null;
  const fpVarianceNum = fpVariancePct != null && Number.isFinite(Number(fpVariancePct)) ? Math.round(Number(fpVariancePct) * 10) / 10 : null;
  const fpRag = fpHasData ? (((fpSummary as any).rag || fpPortfolioPre?.rag) as RagLetter) ?? null : null;
  const fpCurrency = fpHasData ? safeStr((fpSummary as any).currency || fpPortfolioPre?.currency).trim() || "\u00a3" : "\u00a3";
  const fpPortfolio = fpPortfolioPre;

  const fpBudgetRaw = fpHasData ? (() => {
    const s = fpSummary as any; const p = fpPortfolio ?? {};
    const nested = p.totalBudget ?? p.total_budget ?? p.approvedBudget ?? p.approved_budget ?? p.totalApprovedBudget ?? p.budgeted ?? p.budget;
    if (nested != null && Number(nested) > 0) return nested;
    const topLevel = s.total_approved_budget ?? s.approved_budget ?? s.total_budget ?? s.budget_total ?? s.budgeted ?? s.total_budgeted ?? s.budget ?? s.plan_budget ?? s.total_plan_budget ?? s.approved;
    if (topLevel != null) return topLevel;
    for (const [k, v] of Object.entries(s)) { const kl = k.toLowerCase(); if ((kl.includes("budget") || kl.includes("approved")) && Number.isFinite(Number(v)) && Number(v) > 0) return v; }
    for (const [k, v] of Object.entries(p)) { const kl = k.toLowerCase(); if ((kl.includes("budget") || kl.includes("approved")) && Number.isFinite(Number(v)) && Number(v) > 0) return v; }
    return undefined;
  })() : undefined;

  const fpSpentRaw = fpHasData ? (() => {
    const s = fpSummary as any; const p = fpPortfolio ?? {};
    const nested = p.totalActual ?? p.total_actual ?? p.totalSpent ?? p.total_spent ?? p.actualSpent ?? p.actual_spent ?? p.actuals ?? p.spent;
    if (nested != null) return nested;
    const topLevel = s.total_spent ?? s.actual_spent ?? s.spent_total ?? s.total_actual ?? s.actual ?? s.spent ?? s.total_actuals ?? s.actuals_total;
    if (topLevel != null) return topLevel;
    for (const [k, v] of Object.entries(p)) { const kl = k.toLowerCase(); if ((kl.includes("spent") || kl.includes("actual")) && Number.isFinite(Number(v)) && Number(v) >= 0) return v; }
    return undefined;
  })() : undefined;

  const fpTotalBudget: number | null = fpBudgetRaw != null && Number.isFinite(Number(fpBudgetRaw)) ? Number(fpBudgetRaw) : null;
  const fpTotalSpent: number | null = fpSpentRaw != null && Number.isFinite(Number(fpSpentRaw)) ? Number(fpSpentRaw) : null;

  function formatBudget(n: number, currency: string): string {
    const abs = Math.abs(n);
    const prefix = currency.length === 1 ? currency : "";
    const suffix = currency.length > 1 ? ` ${currency}` : "";
    if (abs >= 1_000_000) return `${prefix}${(n / 1_000_000).toFixed(1)}M${suffix}`;
    if (abs >= 1_000) return `${prefix}${(n / 1_000).toFixed(0)}k${suffix}`;
    return `${prefix}${n.toFixed(0)}${suffix}`;
  }

  const fpValueLabel = fpTotalBudget != null ? formatBudget(fpTotalBudget, fpCurrency) : fpLoading ? "..." : "--";
  const fpSubLabel = fpHasData
    ? fpTotalSpent != null
      ? `${formatBudget(fpTotalSpent, fpCurrency)} spent${fpVarianceNum != null ? ` - ${fpVarianceNum > 0 ? "+" : ""}${fpVarianceNum}% variance` : ""}`
      : `Budget ${fpRag === "G" ? "on track" : fpRag === "A" ? "watch" : "over"}`
    : "total portfolio budget";
  const fpTrendLabel = fpVarianceNum != null && fpVarianceNum !== 0 ? `${fpVarianceNum > 0 ? "+" : ""}${fpVarianceNum}%` : undefined;

  const phColorKey = phRag === "G" ? "green" : phRag === "A" ? "amber" : "red";
  const fpColorKey = !fpHasData ? "blue" : fpRag === "G" ? "green" : fpRag === "A" ? "amber" : "red";
  const allDueItems = dueItems.slice(0, 8);
  const displayRagCounts = phData?.ok ? liveRagCounts : { g: ragAgg.g, a: ragAgg.a, r: ragAgg.r };

  if (!ok) {
    return (
      <div className="grid min-h-screen place-items-center bg-gray-50 p-10">
        <div className="max-w-lg rounded-2xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="text-xl font-bold text-gray-900">Dashboard Error</div>
          <div className="mt-2 text-gray-500">{(data as any).error}</div>
        </div>
      </div>
    );
  }

  return (
    <LazyMotion features={domAnimation}>
      <FilterDrawer
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerOpenViaSearch(false); }}
        filters={urlFilters}
        onApply={(next) => { applyFilters(next); setDrawerOpen(false); setDrawerOpenViaSearch(false); }}
        onClear={() => { clearFilters(); setDrawerOpen(false); setDrawerOpenViaSearch(false); }}
        projectOptions={projectOptions}
        pmOptions={pmOptions}
        deptOptions={deptOptions}
        searchInputRef={searchInputRef}
      />

      <div className="min-h-screen" style={{ background: "#f8fafc" }}>
        <header className="sticky top-0 z-30 border-b border-gray-100 bg-white" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }}>
          <div className="mx-auto flex h-14 max-w-screen-2xl items-center justify-between gap-4 px-6">
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-600">
                <Layers className="h-4 w-4 text-white" />
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="text-base font-bold text-gray-900">Organisation Portfolio</span>
                <span className="hidden text-xs text-gray-400 md:block">
                  Enterprise project portfolio overview{filtersActive ? ` - filtered (${activeProjects.length})` : ""}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-1 rounded-xl bg-gray-100 p-1 sm:flex">
                {([7, 14, 30, 60] as const).map((d) => (
                  <button key={d} type="button" onClick={() => setWindowDays(d)}
                    className={["rounded-lg px-3 py-1.5 text-xs font-semibold transition-all", windowDays === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"].join(" ")}>
                    {d}d
                  </button>
                ))}
              </div>

              {dueUpdatedAt && <LastUpdated iso={dueUpdatedAt} />}
              <div className="mx-1 h-5 w-px bg-gray-200" />
              <PortfolioAskDrawer />

              <button type="button" onClick={openDrawerFocusSearch}
                className={["flex h-9 w-9 items-center justify-center rounded-xl border transition-colors", drawerOpenViaSearch ? "border-gray-900 bg-gray-900" : "border-gray-200 bg-white hover:bg-gray-50"].join(" ")}
                aria-label="Search" title="Search">
                <Search className={["h-4 w-4", drawerOpenViaSearch ? "text-white" : "text-gray-700"].join(" ")} />
              </button>

              <button type="button" onClick={() => { setDrawerOpenViaSearch(false); setDrawerOpen((v) => !v); }}
                className={["flex h-9 w-9 items-center justify-center rounded-xl border transition-colors", (drawerOpen && !drawerOpenViaSearch) || filtersActive ? "border-gray-900 bg-gray-900" : "border-gray-200 bg-white hover:bg-gray-50"].join(" ")}
                aria-label="Filter" title="Filter">
                <SlidersHorizontal className={["h-4 w-4", (drawerOpen && !drawerOpenViaSearch) || filtersActive ? "text-white" : "text-gray-700"].join(" ")} />
              </button>

              <button type="button"
                onClick={() => {
                  const rows = (activeProjects as any[]).map((p) => ({ code: projectCodeLabel((p as any)?.project_code), title: safeStr((p as any)?.title), client: safeStr((p as any)?.client_name), department: safeStr((p as any)?.department), project_manager: safeStr((p as any)?.project_manager) }));
                  const header = ["code", "title", "client", "department", "project_manager"];
                  const esc = (s: any) => `"${safeStr(s).replace(/"/g, '""')}"`;
                  const csv = [header.join(","), ...rows.map((r) => header.map((k) => esc((r as any)[k])).join(","))].join("\n");
                  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
                  const a = document.createElement("a");
                  const stamp = new Date().toISOString().slice(0, 10);
                  a.href = URL.createObjectURL(blob);
                  a.download = `portfolio-projects-${stamp}.csv`;
                  document.body.appendChild(a);
                  a.click();
                  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 250);
                }}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white transition-colors hover:bg-gray-50"
                aria-label="Export" title="Export CSV">
                <Download className="h-4 w-4 text-gray-700" />
              </button>

              <NotificationBell />

              <button type="button" onClick={() => router.push("/settings")}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-gray-200 bg-white transition-colors hover:bg-gray-50"
                aria-label="Settings" title="Settings">
                <Settings className="h-4 w-4 text-gray-700" />
              </button>
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-screen-2xl space-y-5 px-6 py-6">
          {filtersActive && (
            <div className="flex items-center justify-between gap-3 rounded-2xl border border-gray-100 bg-white px-4 py-3" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div className="min-w-0 text-xs text-gray-500">
                <span className="font-semibold text-gray-700">Active filters:</span>{" "}
                <span className="truncate">
                  {urlFilters.q ? `q="${urlFilters.q}" ` : ""}
                  {urlFilters.projectId?.length ?? 0 ? `- Projects ${urlFilters.projectId!.length} ` : ""}
                  {urlFilters.projectCode?.length ?? 0 ? `- Codes ${urlFilters.projectCode!.length} ` : ""}
                  {urlFilters.projectManagerId?.length ?? 0 ? `- PM ${urlFilters.projectManagerId!.length} ` : ""}
                  {urlFilters.department?.length ?? 0 ? `- Dept ${urlFilters.department!.length} ` : ""}
                </span>
              </div>
              <button onClick={clearFilters} className="rounded-xl bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 transition-colors hover:bg-gray-200 hover:text-gray-900">Clear all</button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KpiCard label="Portfolio Health" value={phScoreForUi == null ? "..." : `${phScoreForUi}%`} sub={`${displayRagCounts.g} Green - ${displayRagCounts.a} Amber - ${displayRagCounts.r} Red`} icon={<Activity className="h-5 w-5" />} colorKey={phScoreForUi == null ? "blue" : phColorKey} trendLabel={phDelta != null && phDelta !== 0 ? `${Math.abs(Math.round(phDelta))}` : undefined} onClick={() => router.push(appendFiltersToUrl("/insights", urlFilters))} />
            <KpiCard label="Open Risks" value={openRisksValue == null ? "..." : `${openRisksValue}`} sub="high priority" icon={<AlertTriangle className="h-5 w-5" />} colorKey="amber" trendLabel={raidHighSeverity > 0 ? `${raidHighSeverity}` : undefined} onClick={() => router.push(appendFiltersToUrl(`/insights?tab=raid&days=${numericWindowDays}`, urlFilters))} />
            <KpiCard label="Milestones Due" value={milestonesDueLive == null ? "..." : `${milestonesDueLive}`} sub={`next ${windowDays === "all" ? "60" : windowDays} days`} icon={<Clock3 className="h-5 w-5" />} colorKey="blue" onClick={() => router.push(appendFiltersToUrl(`/milestones?days=${numericWindowDays}`, urlFilters))} />
            <KpiCard label="Budget Health" value={fpValueLabel} sub={fpSubLabel} icon={<DollarSign className="h-5 w-5" />} colorKey={fpColorKey} trendLabel={fpTrendLabel} onClick={() => router.push("/budget")} />
          </div>

          {/*  Change 4: ExecutiveBriefingCard with briefingData state */}
          <ExecutiveBriefingCard data={briefingData} liveRagCounts={liveRagCounts} />

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-white p-6 lg:col-span-2" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-gray-900">Resource Activity</h3>
                  <p className="mt-0.5 text-xs text-gray-400">Week-on-week capacity vs demand (FTE) - {windowDays === "all" ? "60" : windowDays} days</p>
                </div>
                <div className="mt-1 flex items-center gap-4 text-xs text-gray-400">
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#93c5fd" }} />Capacity</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#34d399" }} />Allocated</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "#a78bfa", opacity: 0.8 }} />Pipeline</span>
                </div>
              </div>
              <ResourceActivityChart weeks={resourceWeeks.length > 0 ? resourceWeeks : undefined} days={numericWindowDays} loading={resourceLoading && resourceWeeks.length === 0} />
            </div>

            <div className="rounded-2xl border border-gray-100 bg-white p-6" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
              <div className="mb-4 flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-100"><Sparkles className="h-4 w-4 text-purple-600" /></div>
                <h3 className="flex-1 font-semibold text-gray-900">AI Insights</h3>
                <button onClick={() => router.push(appendFiltersToUrl("/insights", urlFilters))} className="text-xs font-medium text-blue-600 hover:text-blue-700">View all</button>
              </div>
              <div className="space-y-3">
                {insightsLoading ? (
                  Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-50" />)
                ) : insights.length === 0 ? (
                  <div className="py-10 text-center"><CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-gray-200" /><p className="text-sm text-gray-400">No active insights</p></div>
                ) : (
                  insights.slice(0, 4).map((x) => <InsightCard key={x.id} severity={x.severity} title={x.title} body={x.body} href={fixInsightHref(x, windowDays)} />)
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white px-6 py-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-violet-500">Governance Intelligence</div>
                <h3 className="mt-1 text-base font-semibold text-gray-900">Control Center</h3>
                <p className="mt-1 max-w-2xl text-sm text-gray-500">Open the governance intelligence centre for approvals, control signals, oversight, and delivery decision support.</p>
              </div>
              <button type="button" onClick={() => router.push("/approvals")}
                className="inline-flex items-center gap-2 self-start rounded-2xl border border-violet-200 bg-violet-50 px-5 py-3 text-sm font-semibold text-violet-700 transition-colors hover:border-violet-300 hover:bg-violet-100">
                <ShieldCheck className="h-4 w-4" />Control Center<ArrowUpRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-4 lg:col-span-2">
              {(phData?.ok ? liveRagCounts.g + liveRagCounts.a + liveRagCounts.r : ragAgg.scored) > 0 && (
                <div className="rounded-2xl bg-white px-6 py-5" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)", border: "1px solid #f3f4f6" }}>
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-900">Project Health (RAG Status)</h3>
                    <button onClick={() => router.push(appendFiltersToUrl("/projects", urlFilters))} className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700">View all <ChevronRight className="h-3 w-3" /></button>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { rag: "G" as RagLetter, count: displayRagCounts.g, icon: <CheckCircle2 className="h-4 w-4 text-green-600" />, label: "Green",  threshold: ">= 85% health", from: "#f0fdf4", border: "#dcfce7" },
                      { rag: "A" as RagLetter, count: displayRagCounts.a, icon: <AlertTriangle className="h-4 w-4 text-amber-600" />, label: "Amber", threshold: "70-84% health", from: "#fffbeb", border: "#fef3c7" },
                      { rag: "R" as RagLetter, count: displayRagCounts.r, icon: <AlertTriangle className="h-4 w-4 text-red-500" />,   label: "Red",   threshold: "< 70% health",  from: "#fef2f2", border: "#fecaca" },
                    ].map(({ rag: r, count, icon, label, threshold, from, border }) => {
                      const total = displayRagCounts.g + displayRagCounts.a + displayRagCounts.r;
                      return (
                        <div key={r} className="cursor-pointer rounded-xl p-4 transition-all hover:brightness-[0.97]" style={{ background: from, border: `1px solid ${border}` }}
                          onClick={() => router.push(appendFiltersToUrl(`/insights?rag=${r}&days=${numericWindowDays}`, urlFilters))}>
                          <div className="mb-2 flex items-center gap-2">
                            {icon}
                            <span className="text-xs font-bold uppercase tracking-wider" style={{ color: r === "G" ? "#15803d" : r === "A" ? "#92400e" : "#991b1b" }}>{label}</span>
                          </div>
                          <div className="mb-1 text-3xl font-bold leading-none" style={{ color: r === "G" ? "#15803d" : r === "A" ? "#b45309" : "#dc2626" }}>{count}</div>
                          <div className="mt-0.5 text-xs" style={{ color: r === "G" ? "#16a34a" : r === "A" ? "#d97706" : "#ef4444", opacity: 0.8 }}>{total > 0 ? `${Math.round((count / total) * 100)}% of total` : ""}</div>
                          <div className="mt-2 text-[10px] font-semibold" style={{ color: r === "G" ? "#166534" : r === "A" ? "#92400e" : "#991b1b", opacity: 0.7 }}>{threshold}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div className="flex items-center justify-between border-b border-gray-50 px-6 py-4">
                  <div>
                    <h3 className="font-semibold text-gray-900">Active Projects</h3>
                    <p className="mt-0.5 text-xs text-gray-400">{activeProjects.length} projects</p>
                  </div>
                  <span className="pr-12 text-xs text-gray-400">Health</span>
                </div>
                {sortedProjects.slice(0, 9).map((p: any, i) => <ProjectRow key={String(p.id || i)} p={p} ragMap={mergedRagMap} />)}
                {sortedProjects.length === 0 && <div className="py-14 text-center text-sm text-gray-400">No active projects</div>}
                {sortedProjects.length > 9 && (
                  <div className="border-t border-gray-50 px-6 py-3 text-center">
                    <button onClick={() => router.push(appendFiltersToUrl("/projects", urlFilters))} className="text-sm font-medium text-blue-600 hover:text-blue-700">View all {activeProjects.length} projects</button>
                  </div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div className="flex items-center gap-3 border-b border-gray-50 px-5 py-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50"><Calendar className="h-4 w-4 text-blue-500" /></div>
                  <h3 className="flex-1 font-semibold text-gray-900">Upcoming Milestones</h3>
                  <div className="flex items-center gap-0.5 rounded-lg bg-gray-100 p-0.5">
                    {([7, 14, 30] as const).map((d) => (
                      <button key={d} type="button" onClick={() => setDueWindowDays(d)}
                        className={["rounded-md px-2 py-1 text-[11px] font-semibold transition-all", dueWindowDays === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"].join(" ")}>
                        {d}d
                      </button>
                    ))}
                  </div>
                  <button onClick={() => router.push(appendFiltersToUrl(`/milestones?days=${dueWindowDays}`, urlFilters))} className="ml-1 flex items-center gap-0.5 text-xs font-medium text-blue-600 hover:text-blue-700">All <ChevronRight className="h-3 w-3" /></button>
                </div>
                <div className="space-y-2.5 p-4">
                  {dueLoading ? (
                    Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-24 animate-pulse rounded-xl bg-gray-50" />)
                  ) : allDueItems.length === 0 ? (
                    <div className="py-8 text-center">
                      <CheckCircle2 className="mx-auto mb-2 h-7 w-7 text-gray-200" />
                      <p className="text-sm text-gray-400">Nothing due in {dueWindowDays} days</p>
                      <button onClick={() => router.push(appendFiltersToUrl(`/milestones?days=${dueWindowDays}`, urlFilters))} className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700">View milestone list</button>
                    </div>
                  ) : (
                    allDueItems.map((it, i) => (
                      <MilestoneCard key={`${it.title}-${i}`} item={it} onClick={() => {
                        const href = safeStr(it?.link).trim();
                        if (href && !href.includes("/raid") && !href.includes("/risks")) router.push(href);
                        else router.push(appendFiltersToUrl(`/milestones?days=${dueWindowDays}`, urlFilters));
                      }} />
                    ))
                  )}
                  {dueItems.length > 8 && (
                    <button onClick={() => router.push(appendFiltersToUrl(`/milestones?days=${dueWindowDays}`, urlFilters))} className="mt-1 w-full border-t border-gray-50 py-2 text-center text-xs font-medium text-blue-600 hover:text-blue-700">
                      View all {dueItems.length} milestones
                    </button>
                  )}
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white" style={{ boxShadow: "0 1px 3px rgba(0,0,0,0.05)" }}>
                <div className="flex items-center gap-3 border-b border-gray-50 px-5 py-4">
                  <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-green-50"><Trophy className="h-4 w-4 text-green-500" /></div>
                  <h3 className="flex-1 font-semibold text-gray-900">Recent Wins</h3>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-semibold text-gray-400">Last 7 days</span>
                  <button onClick={() => router.push(appendFiltersToUrl("/success-stories", urlFilters))} className="text-xs font-medium text-blue-600 hover:text-blue-700">View all</button>
                </div>
                <div className="space-y-2.5 p-4">
                  {winsLoading ? (
                    Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-gray-50" />)
                  ) : recentWins.length === 0 ? (
                    <div className="py-8 text-center">
                      <Trophy className="mx-auto mb-1.5 h-6 w-6 text-gray-200" />
                      <p className="text-sm text-gray-400">No milestones completed in the last 7 days</p>
                      <p className="mt-1 text-xs text-gray-300">Completed milestones appear here</p>
                    </div>
                  ) : (
                    recentWins.map((win) => (
                      <RecentWinCard key={win.id} win={win} onClick={() => {
                        if (win.link) router.push(win.link);
                        else router.push(appendFiltersToUrl("/success-stories", urlFilters));
                      }} />
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="h-8" />
        </main>
      </div>
    </LazyMotion>
  );
}