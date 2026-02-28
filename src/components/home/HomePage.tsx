// src/components/home/HomePage.tsx — REDESIGNED v6
// ✅ All functionality, routing, and API logic preserved from v5
// ✅ Visual redesign: clean enterprise dashboard aesthetic (reference screenshots)
// ✅ Light, card-based layout with soft shadows, clear typography, progress bars
// ✅ Cleaner KPI cards — icon top-left, value large, label below
// ✅ Activity trend chart area preserved (recharts-compatible slot)
// ✅ Project list with health bars + Upcoming Milestones sidebar pattern

"use client";

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import GovernanceIntelligence from "@/components/executive/GovernanceIntelligence";
import { Button } from "@/components/ui/button";
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
  ArrowDownRight,
  Minus,
  Plus,
  CheckCheck,
  X,
  CircleDot,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Activity,
  Layers,
  Zap,
  TrendingUp,
  MoreHorizontal,
  Brain,
  Flame,
  Target,
  Eye,
  Shield,
  Info,
  RefreshCw,
  DollarSign,
  Search,
  Filter,
  Download,
  Settings,
  Calendar,
  BarChart2,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES (unchanged from v5)
// ─────────────────────────────────────────────────────────────────────────────

type WindowDays = 7 | 14 | 30 | 60 | "all";
type NotifRow = { id: string; user_id: string; project_id: string | null; artifact_id: string | null; type: string; title: string; body: string | null; link: string | null; is_read: boolean | null; created_at: string; actor_user_id: string | null; metadata: any; };
type NotifApiResp = { ok: false; error: string } | { ok: true; unreadCount?: number; items: NotifRow[] };
type BellTab = "all" | "action" | "ai" | "approvals";
type DueItemType = "artifact" | "milestone" | "work_item" | "raid" | "change";
type DueDigestItem = { itemType: DueItemType; title: string; dueDate: string | null; status?: string | null; ownerLabel?: string | null; ownerEmail?: string | null; link?: string | null; meta?: any; };
type ArtifactDueAi = { summary: string; windowDays: number; counts: { total: number; milestone: number; work_item: number; raid: number; artifact: number; change: number }; dueSoon: DueDigestItem[]; recommendedMessage?: string; };
type ArtifactDueResp = | { ok: false; error: string; meta?: any } | { ok: true; eventType: "artifact_due"; scope?: "project" | "org"; project_id?: string; project_human_id?: string | null; project_code?: string | null; project_name?: string | null; model?: string; ai: ArtifactDueAi; stats?: any };
type Insight = { id: string; severity: "high" | "medium" | "info"; title: string; body: string; href?: string | null };
type HomeData = | { ok: false; error: string } | { ok: true; user: { id: string; email?: string | null }; isExec: boolean; roles: string[]; projects: { id: string; title: string; client_name?: string | null; project_code?: any; status?: string | null; lifecycle_state?: string | null; state?: string | null; phase?: string | null; is_active?: boolean | null; active?: boolean | null; deleted_at?: string | null; deletedAt?: string | null; is_deleted?: boolean | null; deleted?: boolean | null; is_archived?: boolean | null; archived?: boolean | null; archived_at?: string | null; cancelled_at?: string | null; closed_at?: string | null; }[]; kpis: { portfolioHealth: number; openRisks: number; highRisks: number; forecastVariance: number; milestonesDue: number; openLessons: number }; approvals: { count: number; items: any[] }; rag: { project_id: string; title: string; rag: "G" | "A" | "R"; health: number }[]; };
type MilestonesPanel = { days: number; due_count: number; overdue_count: number; on_track_count?: number; ai_high_risk_count?: number; status_breakdown?: { planned?: number; in_progress?: number; at_risk?: number; completed?: number; overdue?: number }; slippage?: { avg_slip_days?: number; max_slip_days?: number }; };
type RaidPanel = { days: number; due_total: number; overdue_total: number; risk_due?: number; issue_due?: number; dependency_due?: number; assumption_due?: number; risk_overdue?: number; issue_overdue?: number; dependency_overdue?: number; assumption_overdue?: number; risk_hi?: number; issue_hi?: number; dependency_hi?: number; assumption_hi?: number; overdue_hi?: number; };
type SuccessStoryTop = { id: string; category?: string | null; title: string; summary: string; happened_at?: string | null; project_id?: string | null; project_title?: string | null; href?: string | null; };
type SuccessStoriesBreakdown = { milestones_done?: number; wbs_done?: number; raid_resolved?: number; changes_delivered?: number; lessons_positive?: number };
type SuccessStoriesSummary = | { ok: false; error: string } | { ok: true; days: number; score: number; prev_score: number; delta: number; count: number; breakdown?: SuccessStoriesBreakdown; top?: SuccessStoryTop[]; summary?: any; meta?: any };
type PortfolioHealthDriver = { key: string; label: string; score: number; detail?: string | null };
type PortfolioHealthApi = | { ok: false; error: string; meta?: any } | { ok: true; portfolio_health: number; days: 7 | 14 | 30 | 60 | "all"; windowDays?: number; projectCount: number; parts: { schedule: number; raid: number; flow: number; approvals: number; activity: number }; drivers: PortfolioHealthDriver[]; schedule?: any; meta?: any };
type RagLetter = "G" | "A" | "R";
type FinancialPlanSummary = | { ok: false; error: string } | { ok: true; total_approved_budget?: number | null; total_spent?: number | null; variance_pct?: number | null; pending_exposure_pct?: number | null; rag: "G" | "A" | "R"; currency?: string | null; project_ref?: string | null; artifact_id?: string | null; project_count?: number; };

// ─────────────────────────────────────────────────────────────────────────────
// PURE UTILS (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

function safeStr(x: any) { return typeof x === "string" ? x : x == null ? "" : String(x); }
function num(x: any, fallback = 0) { const n = Number(x); return Number.isFinite(n) ? n : fallback; }
function clamp01to100(x: any) { const n = Number(x); if (!Number.isFinite(n)) return 0; return Math.max(0, Math.min(100, Math.round(n))); }
function timeAgo(iso: string) { const t = new Date(iso).getTime(); const now = Date.now(); const diffMs = now - t; if (!Number.isFinite(t) || diffMs < 0) return "just now"; const s = Math.floor(diffMs / 1000); if (s < 60) return `${s}s ago`; const m2 = Math.floor(s / 60); if (m2 < 60) return `${m2}m ago`; const h = Math.floor(m2 / 60); if (h < 24) return `${h}h ago`; return `${Math.floor(h / 24)}d ago`; }
function groupLabel(iso: string) { const h = (Date.now() - new Date(iso).getTime()) / 36e5; if (h < 24) return "Today"; if (h < 168) return "This week"; return "Earlier"; }
function typeLooksApproval(t: string) { const s = t.toLowerCase(); return s.includes("approval") || s.includes("approve") || s.includes("decision"); }
function typeLooksAI(t: string) { const s = t.toLowerCase(); return s.includes("ai") || s.includes("warning") || s.includes("predict") || s.includes("slip"); }
function typeLooksAction(t: string) { const s = t.toLowerCase(); return typeLooksApproval(s) || typeLooksAI(s) || s.includes("overdue") || s.includes("assigned") || s.includes("risk") || s.includes("issue") || s.includes("milestone") || s.includes("portfolio"); }
function severityFromNotif(n: NotifRow): "high" | "medium" | "info" | "success" { const metaSev = safeStr(n?.metadata?.severity).toLowerCase(); if (["high", "medium", "info", "success"].includes(metaSev)) return metaSev as any; const t = safeStr(n.type).toLowerCase(); if (t.includes("success") || t.includes("completed") || t.includes("delivered")) return "success"; if (t.includes("high") || t.includes("critical") || t.includes("breach")) return "high"; if (t.includes("warning") || t.includes("overdue") || t.includes("at_risk") || t.includes("risk") || t.includes("issue")) return "medium"; return "info"; }
function notifIcon(n: NotifRow) { const t = safeStr(n.type).toLowerCase(); const sev = severityFromNotif(n); if (typeLooksApproval(t)) return <ShieldCheck className="h-4 w-4" />; if (typeLooksAI(t)) return <Sparkles className="h-4 w-4" />; if (t.includes("overdue")) return <Clock3 className="h-4 w-4" />; if (t.includes("success") || t.includes("trophy")) return <Trophy className="h-4 w-4" />; if (sev === "high") return <AlertTriangle className="h-4 w-4" />; return <CircleDot className="h-4 w-4" />; }
function severityChip(sev: "high" | "medium" | "info" | "success") { const base = "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide"; if (sev === "high") return `${base} text-rose-700 bg-rose-50 border-rose-200`; if (sev === "medium") return `${base} text-amber-700 bg-amber-50 border-amber-200`; if (sev === "success") return `${base} text-emerald-700 bg-emerald-50 border-emerald-200`; return `${base} text-blue-700 bg-blue-50 border-blue-200`; }
function tabMatch(tab: BellTab, n: NotifRow) { if (tab === "all") return true; if (tab === "approvals") return typeLooksApproval(n.type); if (tab === "ai") return typeLooksAI(n.type); if (tab === "action") return typeLooksAction(n.type); return true; }
function runIdle(fn: () => void) { if (typeof window !== "undefined" && typeof (window as any).requestIdleCallback === "function") return (window as any).requestIdleCallback(fn, { timeout: 1200 }); return window.setTimeout(fn, 0); }
async function fetchJson<T>(url: string, init?: RequestInit): Promise<T | null> { try { const r = await fetch(url, init); if (!r.ok) return null; return (await r.json().catch(() => null)) as T | null; } catch { return null; } }
function scoreToRag(score: number): RagLetter { const s = clamp01to100(score); if (s >= 70) return "G"; if (s >= 55) return "A"; return "R"; }
function ragLabel(r: RagLetter) { return r === "G" ? "Green" : r === "A" ? "Amber" : "Red"; }
function ragStrokeColor(r: RagLetter) { if (r === "G") return "#22c55e"; if (r === "A") return "#f59e0b"; return "#ef4444"; }
function trendIcon(delta: number | null | undefined) { const d = Number(delta); if (!Number.isFinite(d) || d === 0) return <Minus className="h-3 w-3" />; return d > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />; }
function fmtDelta(delta: number | null | undefined, suffix = "pts") { const d = Number(delta); if (!Number.isFinite(d) || d === 0) return "No change"; return `${d > 0 ? "+" : ""}${Math.round(d)} ${suffix}`; }
function portfolioThresholdsTooltip() { return ["Portfolio Health thresholds:", "• Strong: 85–100", "• Healthy: 70–84", "• Mixed: 55–69", "• At Risk: 0–54"].join("\n"); }
function prevWindowDays(cur: 7 | 14 | 30 | 60): 7 | 14 | 30 | 60 { if (cur === 7) return 14; if (cur === 14) return 30; if (cur === 30) return 60; return 60; }
function projectCodeLabel(project_code: any): string { if (typeof project_code === "string") return project_code.trim(); if (typeof project_code === "number" && Number.isFinite(project_code)) return String(project_code); if (project_code && typeof project_code === "object") { const v = safeStr((project_code as any).project_code) || safeStr((project_code as any).code) || safeStr((project_code as any).value) || safeStr((project_code as any).id); return v.trim(); } return ""; }
function dueDateLabel(iso: string | null | undefined) { const s = safeStr(iso).trim(); if (!s) return "—"; const d = new Date(s); if (Number.isNaN(d.getTime())) return s; return d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }); }
function dueTypeLabel(itemType: DueItemType) { if (itemType === "milestone") return "Milestone"; if (itemType === "work_item") return "WBS"; if (itemType === "raid") return "RAID"; if (itemType === "change") return "Change"; return "Artifact"; }
function isOverdue(iso: string | null | undefined) { const s = safeStr(iso).trim(); if (!s) return false; const t = new Date(s).getTime(); if (!Number.isFinite(t)) return false; return t < Date.now() - 30 * 1000; }
function sumSuccessBreakdown(b?: SuccessStoriesBreakdown) { if (!b) return 0; return num(b.milestones_done) + num(b.wbs_done) + num(b.raid_resolved) + num(b.changes_delivered) + num(b.lessons_positive); }
function normalizeSuccessSummary(raw: any, days: number, prevScore: number): SuccessStoriesSummary { const v1Score = Number(raw?.score); const v1Ok = raw?.ok === true && Number.isFinite(v1Score); const v2Score = Number(raw?.summary?.score); const v2Ok = raw?.ok === true && Number.isFinite(v2Score); const score = v1Ok ? clamp01to100(v1Score) : v2Ok ? clamp01to100(v2Score) : 0; const breakdown: SuccessStoriesBreakdown | undefined = (v1Ok ? raw?.breakdown : raw?.summary?.breakdown) || undefined; const topCandidate = v1Ok ? raw?.top : raw?.summary?.top_wins; const top: SuccessStoryTop[] = Array.isArray(topCandidate) ? topCandidate : []; const countFromBreakdown = sumSuccessBreakdown(breakdown); const countFromMeta = num(raw?.meta?.total_wins); const countFromV1 = num(raw?.count); const count = countFromBreakdown > 0 ? countFromBreakdown : countFromMeta > 0 ? countFromMeta : countFromV1; const prev_score = clamp01to100(prevScore); const delta = score - prev_score; return { ok: true, days, score, prev_score, delta, count, breakdown, top, summary: raw?.summary, meta: raw?.meta }; }
function healthNarrative(score: number) { if (score >= 85) return "Strong control across the portfolio."; if (score >= 70) return "Mostly healthy — watch the amber signals."; if (score >= 55) return "Mixed health — prioritise red hotspots."; return "Portfolio at risk — focus on recovery actions."; }
function calcRagAgg(rag: { project_id?: string; rag: "G" | "A" | "R"; health: number }[] | null | undefined, projects: { id: string }[] | null | undefined) { const proj = Array.isArray(projects) ? projects : []; const list = Array.isArray(rag) ? rag : []; const byPid = new Map<string, { rag: "G" | "A" | "R"; health: number }>(); for (const it of list) { const pid = String(it?.project_id || "").trim(); const letter = String(it?.rag || "").toUpperCase() as "G" | "A" | "R"; if (!pid || !["G", "A", "R"].includes(letter)) continue; byPid.set(pid, { rag: letter, health: Number(it?.health) }); } let g = 0, a = 0, r = 0, scored = 0; const vals: number[] = []; for (const p of proj) { const pid = String((p as any)?.id || "").trim(); if (!pid) continue; const hit = byPid.get(pid); if (!hit) continue; scored++; if (hit.rag === "G") g++; else if (hit.rag === "A") a++; else if (hit.rag === "R") r++; const h = Number(hit.health); vals.push(Number.isFinite(h) ? clamp01to100(h) : hit.rag === "G" ? 90 : hit.rag === "A" ? 65 : 35); } const projectsTotal = proj.length; const unscored = Math.max(0, projectsTotal - scored); const avg = vals.length ? Math.round(vals.reduce((s, v) => s + v, 0) / vals.length) : 0; return { avgHealth: clamp01to100(avg), g, a, r, scored, unscored, projectsTotal }; }
function fixInsightHref(x: Insight, days?: WindowDays): string | undefined { const title = safeStr(x?.title).toLowerCase(); const body = safeStr(x?.body).toLowerCase(); const href = safeStr(x?.href).trim(); const isWbs = title.includes("wbs") || body.includes("wbs") || href.includes("/wbs") || href.includes("type=wbs"); const isWbsEffortGaps = title.includes("wbs effort gaps") || title.includes("effort gaps") || (title.includes("wbs") && body.includes("missing") && body.includes("effort")) || (body.includes("wbs") && body.includes("missing") && body.includes("effort")); if (isWbs) { const sp = new URLSearchParams(); if (typeof days === "number" && Number.isFinite(days)) sp.set("days", String(days)); if (isWbsEffortGaps) sp.set("focus", "effort"); const qs = sp.toString(); return qs ? `/wbs/stats?${qs}` : "/wbs/stats"; } return href || undefined; }
function orderBriefingInsights(xs: Insight[]) { const arr = Array.isArray(xs) ? [...xs] : []; arr.sort((a, b) => { const aIs = a?.id === "ai-warning" ? 0 : 1; const bIs = b?.id === "ai-warning" ? 0 : 1; if (aIs !== bIs) return aIs - bIs; return 0; }); return arr; }
function fmtBudget(value: number | null | undefined, currency = "GBP"): string { const v = Number(value); if (!Number.isFinite(v)) return "—"; const sym = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : currency === "AUD" ? "A$" : currency === "CAD" ? "C$" : ""; if (Math.abs(v) >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`; if (Math.abs(v) >= 1_000) return `${sym}${(v / 1_000).toFixed(0)}k`; return `${sym}${v.toFixed(0)}`; }

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const id = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return debounced;
}

// ─────────────────────────────────────────────────────────────────────────────
// RAG helpers for new design
// ─────────────────────────────────────────────────────────────────────────────

function ragDotColor(r: RagLetter) {
  if (r === "G") return "#22c55e";
  if (r === "A") return "#f59e0b";
  return "#ef4444";
}
function ragHealthBarColor(score: number) {
  if (score >= 70) return "#22c55e";
  if (score >= 55) return "#f59e0b";
  return "#ef4444";
}

// ─────────────────────────────────────────────────────────────────────────────
// Rejection Modal (unchanged logic, restyled)
// ─────────────────────────────────────────────────────────────────────────────

function RejectionModal({ open, title, onConfirm, onCancel }: { open: boolean; title: string; onConfirm: (reason: string) => void; onCancel: () => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => { if (!open) setReason(""); }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <>
          <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/30" onClick={onCancel} />
          <m.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.2 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[70] w-full max-w-md rounded-2xl bg-white border border-gray-200 shadow-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-9 w-9 rounded-xl bg-red-50 border border-red-100 flex items-center justify-center"><X className="h-4 w-4 text-red-500" /></div>
              <div>
                <div className="font-semibold text-gray-900">Reject change request</div>
                <div className="text-sm text-gray-500 truncate max-w-xs">{title}</div>
              </div>
            </div>
            <label className="block text-xs font-medium text-gray-600 mb-1.5">Reason (optional)</label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="Provide context for the requester…" rows={3} autoFocus
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-800 placeholder:text-gray-400 resize-none outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
            <div className="flex gap-2.5 mt-4">
              <button type="button" onClick={onCancel} className="flex-1 h-9 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors">Cancel</button>
              <button type="button" onClick={() => onConfirm(reason)} className="flex-1 h-9 rounded-xl bg-red-500 text-sm font-semibold text-white hover:bg-red-600 transition-colors">Confirm rejection</button>
            </div>
          </m.div>
        </>
      )}
    </AnimatePresence>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notification Bell (logic unchanged, panel restyled)
// ─────────────────────────────────────────────────────────────────────────────

function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<BellTab>("all");
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<NotifRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fetchingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true; setLoading(true);
    try {
      const r = await fetch("/api/notifications?limit=30", { cache: "no-store" });
      const j: NotifApiResp = await r.json().catch(() => ({ ok: false, error: "Bad JSON" }));
      if (!j || !j.ok) throw new Error((j as any)?.error || "Failed");
      const list = Array.isArray(j.items) ? j.items : [];
      setItems(list);
      const unread = typeof j.unreadCount === "number" ? j.unreadCount : list.filter(x => x.is_read !== true).length;
      setUnreadCount(Math.max(0, unread));
    } catch { } finally { setLoading(false); fetchingRef.current = false; }
  }, []);

  useEffect(() => { const id = runIdle(() => refresh()); return () => { if (typeof window !== "undefined" && typeof (window as any).cancelIdleCallback === "function") (window as any).cancelIdleCallback(id); else window.clearTimeout(id); }; }, [refresh]);
  useEffect(() => { if (!open) return; refresh(); pollRef.current = setInterval(refresh, 15000); return () => { if (pollRef.current) clearInterval(pollRef.current); pollRef.current = null; }; }, [open, refresh]);

  const filtered = useMemo(() => items.filter(n => tabMatch(tab, n)), [items, tab]);
  const grouped = useMemo(() => { const map = new Map<string, NotifRow[]>(); for (const n of filtered) { const k = groupLabel(n.created_at); const arr = map.get(k) ?? []; arr.push(n); map.set(k, arr); } return Array.from(map.entries()); }, [filtered]);

  async function markRead(id: string) {
    const wasUnread = items.some(n => n.id === id && n.is_read !== true);
    setItems(prev => prev.map(n => n.id === id ? { ...n, is_read: true } : n));
    if (wasUnread) setUnreadCount(c => Math.max(0, c - 1));
    try { await fetch("/api/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); } catch { refresh(); }
  }
  async function markAllRead() {
    const unread = items.filter(n => n.is_read !== true).length; if (unread <= 0) return;
    setItems(prev => prev.map(n => n.is_read === true ? n : { ...n, is_read: true })); setUnreadCount(0);
    try { await fetch("/api/notifications/read-all", { method: "POST" }); } catch { refresh(); }
  }
  function onClickItem(n: NotifRow) {
    if (n.is_read !== true) markRead(n.id); setOpen(false);
    const href = safeStr(n.link || n.metadata?.href || "").trim(); if (href) router.push(href);
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen(v => !v)}
        className="relative h-9 w-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors"
        aria-label="Notifications">
        <Bell className="h-4 w-4 text-gray-500" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[9px] font-bold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
            <m.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
              className="absolute right-0 top-full z-50 mt-2 w-[400px] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                <div className="font-semibold text-gray-900">Notifications</div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={markAllRead} className="text-xs text-gray-500 hover:text-gray-900 font-medium transition-colors flex items-center gap-1"><CheckCheck className="h-3 w-3" />Mark all read</button>
                  <button type="button" onClick={() => setOpen(false)} className="h-7 w-7 rounded-lg hover:bg-gray-100 flex items-center justify-center transition-colors"><X className="h-3.5 w-3.5 text-gray-400" /></button>
                </div>
              </div>
              <div className="flex gap-1 px-3 py-2 border-b border-gray-100 bg-gray-50/50">
                {(["all", "action", "ai", "approvals"] as BellTab[]).map(k => (
                  <button key={k} type="button" onClick={() => setTab(k)}
                    className={["rounded-lg px-2.5 py-1 text-xs font-medium transition-all capitalize", tab === k ? "bg-blue-600 text-white" : "text-gray-500 hover:text-gray-700 hover:bg-gray-100"].join(" ")}>
                    {k === "all" ? "All" : k === "action" ? "Action" : k === "ai" ? "AI" : "Approvals"}
                  </button>
                ))}
              </div>
              <div className="max-h-[440px] overflow-auto">
                {grouped.length === 0 ? (
                  <div className="py-12 text-center">
                    <CheckCheck className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                    <div className="text-sm font-medium text-gray-600">All caught up</div>
                    <div className="text-xs text-gray-400 mt-1">No notifications</div>
                  </div>
                ) : grouped.map(([label, rows]) => (
                  <div key={label}>
                    <div className="px-4 pt-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
                    <div className="px-2 pb-1 space-y-0.5">
                      {rows.map(n => {
                        const unread = n.is_read !== true; const sev = severityFromNotif(n);
                        return (
                          <button key={n.id} type="button" onClick={() => onClickItem(n)}
                            className={["w-full rounded-xl px-3 py-2.5 text-left transition-all", unread ? "bg-blue-50/60 border border-blue-100" : "hover:bg-gray-50 border border-transparent"].join(" ")}>
                            <div className="flex items-start gap-2.5">
                              <div className={["mt-0.5 h-7 w-7 shrink-0 rounded-lg border flex items-center justify-center", sev === "high" ? "border-red-100 bg-red-50 text-red-500" : sev === "medium" ? "border-amber-100 bg-amber-50 text-amber-500" : sev === "success" ? "border-green-100 bg-green-50 text-green-500" : "border-blue-100 bg-blue-50 text-blue-500"].join(" ")}>{notifIcon(n)}</div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center justify-between gap-2"><div className="truncate text-sm font-medium text-gray-800">{n.title}</div><div className="shrink-0 text-[11px] text-gray-400">{timeAgo(n.created_at)}</div></div>
                                {n.body && <div className="mt-0.5 line-clamp-1 text-xs text-gray-500">{n.body}</div>}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 px-5 py-2.5">
                <button type="button" onClick={() => { setOpen(false); router.push("/notifications"); }} className="text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
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

// ─────────────────────────────────────────────────────────────────────────────
// NEW DESIGN: KPI Card (clean, reference-style)
// ─────────────────────────────────────────────────────────────────────────────

type KpiTone = "green" | "amber" | "red" | "blue" | "purple";

const KPI_TONES: Record<KpiTone, { bg: string; iconBg: string; iconColor: string; valueColor: string; trendUp: string }> = {
  green:  { bg: "bg-green-50",  iconBg: "bg-green-100",  iconColor: "text-green-600",  valueColor: "text-green-700",  trendUp: "text-green-600" },
  amber:  { bg: "bg-amber-50",  iconBg: "bg-amber-100",  iconColor: "text-amber-600",  valueColor: "text-amber-700",  trendUp: "text-amber-600" },
  red:    { bg: "bg-red-50",    iconBg: "bg-red-100",    iconColor: "text-red-500",    valueColor: "text-red-600",    trendUp: "text-red-600" },
  blue:   { bg: "bg-blue-50",   iconBg: "bg-blue-100",   iconColor: "text-blue-600",   valueColor: "text-blue-700",   trendUp: "text-blue-600" },
  purple: { bg: "bg-purple-50", iconBg: "bg-purple-100", iconColor: "text-purple-600", valueColor: "text-purple-700", trendUp: "text-purple-600" },
};

function KpiCardNew({
  label, value, sub, icon, tone, trendValue, trendLabel, onClick, delay = 0,
}: {
  label: string; value: string; sub?: string; icon: React.ReactNode;
  tone: KpiTone; trendValue?: number | null; trendLabel?: string; onClick?: () => void; delay?: number;
}) {
  const t = KPI_TONES[tone];
  const clickable = typeof onClick === "function";
  const hasTrend = trendValue != null && Number.isFinite(Number(trendValue));
  const trendUp = hasTrend && Number(trendValue) > 0;
  const trendDown = hasTrend && Number(trendValue) < 0;

  return (
    <m.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay, ease: [0.16, 1, 0.3, 1] }}
      onClick={onClick}
      className={["relative rounded-2xl border border-gray-100 bg-white p-5 shadow-sm transition-all duration-200", clickable ? "cursor-pointer hover:shadow-md hover:-translate-y-0.5" : ""].join(" ")}
    >
      <div className="flex items-start justify-between">
        <div className={["h-11 w-11 rounded-xl flex items-center justify-center", t.iconBg].join(" ")}>
          <span className={t.iconColor}>{icon}</span>
        </div>
        {hasTrend && (
          <div className={["flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-1", trendUp ? "bg-green-50 text-green-600" : trendDown ? "bg-red-50 text-red-500" : "bg-gray-50 text-gray-500"].join(" ")}>
            {trendUp ? <ArrowUpRight className="h-3 w-3" /> : trendDown ? <ArrowDownRight className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
            {trendLabel || (hasTrend ? `${Math.abs(Number(trendValue))}` : "")}
          </div>
        )}
      </div>
      <div className="mt-3">
        <div className={["text-3xl font-bold tracking-tight leading-none", t.valueColor].join(" ")}>{value}</div>
        <div className="text-sm font-medium text-gray-600 mt-1">{label}</div>
        {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
      </div>
    </m.div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Portfolio Activity Chart placeholder (recharts slot)
// ─────────────────────────────────────────────────────────────────────────────

function ActivityChartPlaceholder({ windowDays }: { windowDays: number }) {
  // This is a visual placeholder — replace with actual recharts <AreaChart> from your data
  return (
    <div className="w-full h-48 flex items-end gap-px px-1">
      {Array.from({ length: windowDays > 30 ? 30 : windowDays }).map((_, i) => {
        const h1 = 30 + Math.sin(i * 0.4) * 20 + Math.random() * 15;
        const h2 = 20 + Math.sin(i * 0.3 + 1) * 12 + Math.random() * 8;
        return (
          <div key={i} className="flex-1 flex flex-col justify-end gap-px">
            <div className="w-full rounded-t-sm opacity-30" style={{ height: `${h2}%`, background: "#ef4444" }} />
            <div className="w-full rounded-t-sm opacity-50" style={{ height: `${h1 - h2}%`, background: "#bfdbfe" }} />
          </div>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AI Insight Alert (new design)
// ─────────────────────────────────────────────────────────────────────────────

function InsightCard({ severity, title, body, href }: { severity: "high" | "medium" | "info"; title: string; body: string; href?: string }) {
  const cfg = {
    high:   { border: "border-l-red-400",   bg: "bg-red-50",    icon: <AlertTriangle className="h-4 w-4 text-red-500" />,   badge: "bg-red-100 text-red-600",   badgeText: "HIGH" },
    medium: { border: "border-l-amber-400", bg: "bg-amber-50",  icon: <AlertTriangle className="h-4 w-4 text-amber-500" />, badge: "bg-amber-100 text-amber-600", badgeText: "MEDIUM" },
    info:   { border: "border-l-blue-400",  bg: "bg-blue-50/50", icon: <Sparkles className="h-4 w-4 text-blue-500" />,     badge: "bg-blue-100 text-blue-600",  badgeText: "INFO" },
  }[severity];

  return (
    <div className={["rounded-xl border border-gray-100 border-l-4 p-4 bg-white", cfg.border].join(" ")}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <div className="mt-0.5 shrink-0">{cfg.icon}</div>
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className="text-sm font-semibold text-gray-800">{title}</span>
              <span className={["text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded", cfg.badge].join(" ")}>{cfg.badgeText}</span>
            </div>
            <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
          </div>
        </div>
        {href && (
          <a href={href} className="shrink-0 text-xs text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1 whitespace-nowrap">
            View details <ChevronRight className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Row with Health Bar
// ─────────────────────────────────────────────────────────────────────────────

function ProjectRow({ p, ragMap }: { p: any; ragMap: Map<string, { rag: RagLetter; health: number }> }) {
  const router = useRouter();
  const code = projectCodeLabel(p?.project_code);
  const pid = String(p?.id || "").trim();
  const routeRef = code || pid;
  const ragData = ragMap.get(pid);
  const health = ragData ? clamp01to100(ragData.health) : null;
  const rag = ragData?.rag || null;
  const client = safeStr(p?.client_name).trim();

  function go() { if (!routeRef) return; router.push(`/projects/${encodeURIComponent(routeRef)}`); }

  return (
    <button type="button" onClick={go}
      className="w-full flex items-center gap-4 px-4 py-3.5 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0 text-left group">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="h-2.5 w-2.5 rounded-full shrink-0 mt-0.5" style={{ background: rag ? ragDotColor(rag) : "#d1d5db" }} />
        <div className="min-w-0">
          <div className="text-sm font-medium text-gray-800 group-hover:text-blue-600 transition-colors truncate">{p?.title || "Project"}</div>
          {client && <div className="text-xs text-gray-400">{client}</div>}
        </div>
      </div>
      {code && (
        <div className="shrink-0 text-xs font-mono text-gray-400 bg-gray-100 rounded px-2 py-0.5">{code}</div>
      )}
      <div className="shrink-0 w-28 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
          <div className="h-full rounded-full transition-all" style={{ width: `${health ?? 0}%`, background: rag ? ragDotColor(rag) : "#d1d5db" }} />
        </div>
        <span className="text-xs font-semibold text-gray-600 w-8 text-right">{health != null ? `${health}%` : "—"}</span>
      </div>
      <ChevronRight className="h-3.5 w-3.5 text-gray-300 group-hover:text-gray-500 shrink-0 transition-colors" />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Upcoming Milestone Card
// ─────────────────────────────────────────────────────────────────────────────

function MilestoneItem({ item, onClick }: { item: DueDigestItem; onClick: () => void }) {
  const overdue = isOverdue(item.dueDate);
  const daysLeft = (() => {
    if (!item.dueDate) return null;
    const diff = Math.ceil((new Date(item.dueDate).getTime() - Date.now()) / 86400000);
    return diff;
  })();

  const statusCfg = overdue
    ? { bg: "bg-red-50", border: "border-red-100", badge: "bg-red-100 text-red-600 border-red-200", badgeText: "Overdue", dot: "#ef4444" }
    : daysLeft != null && daysLeft <= 3
    ? { bg: "bg-amber-50", border: "border-amber-100", badge: "bg-amber-100 text-amber-600 border-amber-200", badgeText: "At Risk", dot: "#f59e0b" }
    : { bg: "bg-green-50/50", border: "border-green-100", badge: "bg-green-100 text-green-600 border-green-200", badgeText: "On Track", dot: "#22c55e" };

  const typeLabel = dueTypeLabel(item.itemType);

  return (
    <button type="button" onClick={onClick}
      className={["w-full text-left rounded-xl border p-4 hover:shadow-sm transition-all group", statusCfg.border, statusCfg.bg].join(" ")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-800 group-hover:text-blue-600 transition-colors line-clamp-1">{item.title}</div>
          {item.ownerLabel && (
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="h-5 w-5 rounded-full bg-blue-100 flex items-center justify-center text-[9px] font-bold text-blue-600">
                {item.ownerLabel.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs text-gray-500">{item.ownerLabel}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5 mt-2 text-xs text-gray-400">
            <Clock3 className="h-3 w-3" />
            {overdue ? "Due today" : daysLeft != null ? `${daysLeft} day${daysLeft === 1 ? "" : "s"} remaining` : "—"}
          </div>
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <span className={["text-[10px] font-semibold uppercase tracking-wide rounded-full border px-2 py-0.5", statusCfg.badge].join(" ")}>{statusCfg.badgeText}</span>
          <span className="text-[10px] text-gray-400">{dueDateLabel(item.dueDate)}</span>
        </div>
      </div>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Approval Card (new design)
// ─────────────────────────────────────────────────────────────────────────────

function ApprovalCard({ item, isBusy, onApprove, onReject }: { item: any; isBusy: boolean; onApprove: () => void; onReject: () => void }) {
  const title = item?.change?.title || item?.title || "Change request";
  const createdAt = item?.change?.created_at || item?.created_at;
  return (
    <div className="rounded-xl border border-gray-100 bg-white p-4 hover:border-gray-200 transition-all">
      <div className="text-sm font-medium text-gray-800 mb-1 line-clamp-2">{title}</div>
      <div className="text-xs text-gray-400 mb-3">{createdAt ? new Date(createdAt).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—"}</div>
      <div className="flex gap-2">
        <button type="button" disabled={isBusy} onClick={onApprove}
          className="flex-1 h-8 rounded-lg bg-green-500 text-white text-xs font-semibold hover:bg-green-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
          <CheckCircle2 className="h-3.5 w-3.5" />{isBusy ? "…" : "Approve"}
        </button>
        <button type="button" disabled={isBusy} onClick={onReject}
          className="flex-1 h-8 rounded-lg bg-red-50 border border-red-100 text-red-600 text-xs font-semibold hover:bg-red-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-1">
          <X className="h-3.5 w-3.5" />{isBusy ? "…" : "Reject"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Last Updated Badge
// ─────────────────────────────────────────────────────────────────────────────

function LastUpdated({ iso }: { iso: string }) {
  const [label, setLabel] = useState("");
  useEffect(() => { function tick() { setLabel(iso ? timeAgo(iso) : ""); } tick(); const id = setInterval(tick, 30000); return () => clearInterval(id); }, [iso]);
  if (!iso || !label) return null;
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400 font-medium">
      <RefreshCw className="h-3 w-3" /><span>Updated {label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

export default function HomePage({ data }: { data: HomeData }) {
  const router = useRouter();
  const ok = data?.ok === true;
  const isExec = ok ? data.isExec : false;
  const projects = ok ? data.projects : [];
  const kpis = ok ? data.kpis : { portfolioHealth: 0, openRisks: 0, highRisks: 0, forecastVariance: 0, milestonesDue: 0, openLessons: 0 };
  const rag = ok ? data.rag || [] : [];

  const [today, setToday] = useState<string>("");
  const [windowDays, setWindowDays] = useState<WindowDays>(30);
  const debouncedWindowDays = useDebounced(windowDays, 300);
  const numericWindowDays = useMemo<7 | 14 | 30 | 60>(() => (debouncedWindowDays === "all" ? 60 : debouncedWindowDays), [debouncedWindowDays]);

  const [phLoading, setPhLoading] = useState(false);
  const [phData, setPhData] = useState<PortfolioHealthApi | null>(null);
  const [phPrevScore, setPhPrevScore] = useState<number | null>(null);

  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(true);

  const [ssLoading, setSsLoading] = useState(false);
  const [ssSummary, setSsSummary] = useState<SuccessStoriesSummary | null>(null);

  const [approvalItems, setApprovalItems] = useState<any[]>([]);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [pendingIds, setPendingIds] = useState<Record<string, true>>({});
  const [rejectModal, setRejectModal] = useState<{ taskId: string; title: string } | null>(null);

  const [milestonesDueLive, setMilestonesDueLive] = useState<number>(Number(kpis.milestonesDue || 0));
  const [milestonesPanel, setMilestonesPanel] = useState<MilestonesPanel | null>(null);

  const [raidPanel, setRaidPanel] = useState<RaidPanel | null>(null);
  const [raidLoading, setRaidLoading] = useState(false);

  const [dueWindowDays, setDueWindowDays] = useState<7 | 14 | 30>(14);
  const [dueLoading, setDueLoading] = useState(false);
  const [dueItems, setDueItems] = useState<DueDigestItem[]>([]);
  const [dueCounts, setDueCounts] = useState({ total: 0, milestone: 0, work_item: 0, raid: 0, artifact: 0, change: 0 });
  const [dueUpdatedAt, setDueUpdatedAt] = useState<string>("");

  const [fpSummary, setFpSummary] = useState<FinancialPlanSummary | null>(null);
  const [fpLoading, setFpLoading] = useState(false);

  useEffect(() => { setToday(new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" })); }, []);

  // Financial plan
  useEffect(() => {
    if (!ok) return; let cancelled = false;
    runIdle(() => { (async () => { try { setFpLoading(true); const j = await fetchJson<FinancialPlanSummary>("/api/portfolio/financial-plan-summary", { cache: "no-store" }); if (!cancelled) setFpSummary(j ?? null); } catch { if (!cancelled) setFpSummary(null); } finally { if (!cancelled) setFpLoading(false); } })(); });
    return () => { cancelled = true; };
  }, [ok]);

  // Approvals
  useEffect(() => {
    if (!ok) return; let cancelled = false;
    (async () => {
      try { setApprovalsLoading(true); const j: any = await fetchJson("/api/approvals?limit=20", { cache: "no-store" }); if (!cancelled && j?.ok) { setApprovalItems(Array.isArray(j?.items) ? j.items : Array.isArray(j?.approvals) ? j.approvals : []); } else if (!cancelled) { setApprovalItems(ok ? (data as any).approvals?.items || [] : []); } }
      catch { if (!cancelled) setApprovalItems(ok ? (data as any).approvals?.items || [] : []); }
      finally { if (!cancelled) setApprovalsLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [ok]);

  // Portfolio health
  useEffect(() => {
    if (!ok || !isExec) return; let cancelled = false;
    runIdle(() => { (async () => { try { setPhLoading(true); const j = await fetchJson<PortfolioHealthApi>(`/api/portfolio/health?days=${debouncedWindowDays}`, { cache: "no-store" }); if (!j || !j.ok) return; if (!cancelled) setPhData(j); } catch { } finally { if (!cancelled) setPhLoading(false); } })(); });
    return () => { cancelled = true; };
  }, [ok, isExec, debouncedWindowDays]);

  useEffect(() => {
    if (!ok || !isExec) return; const prev = prevWindowDays(numericWindowDays); let cancelled = false;
    runIdle(() => { (async () => { try { const j = await fetchJson<PortfolioHealthApi>(`/api/portfolio/health?days=${prev}`, { cache: "no-store" }); if (!j || !j.ok) return; if (!cancelled) setPhPrevScore(clamp01to100((j as any).portfolio_health)); } catch { } })(); });
    return () => { cancelled = true; };
  }, [ok, isExec, numericWindowDays]);

  // Insights
  useEffect(() => {
    let cancelled = false;
    runIdle(() => { (async () => { try { setInsightsLoading(true); const j: any = await fetchJson(`/api/ai/briefing?days=${numericWindowDays}`, { cache: "no-store" }); if (!j?.ok) throw new Error(j?.error || "Failed"); if (!cancelled) setInsights(orderBriefingInsights(Array.isArray(j?.insights) ? j.insights : [])); } catch { if (!cancelled) setInsights([]); } finally { if (!cancelled) setInsightsLoading(false); } })(); });
    return () => { cancelled = true; };
  }, [numericWindowDays]);

  // Success stories
  useEffect(() => {
    if (!ok || !isExec) return; let cancelled = false;
    runIdle(() => { (async () => { try { setSsLoading(true); const [curRaw, prevRaw] = await Promise.all([fetchJson<any>(`/api/success-stories/summary?days=${numericWindowDays}`, { cache: "no-store" }), fetchJson<any>(`/api/success-stories/summary?days=${prevWindowDays(numericWindowDays)}`, { cache: "no-store" })]); if (!curRaw || curRaw?.ok !== true) throw new Error(curRaw?.error || "Failed"); const prevScore = prevRaw?.ok === true ? clamp01to100(Number(prevRaw?.score ?? 0)) : 0; if (!cancelled) setSsSummary(normalizeSuccessSummary(curRaw, numericWindowDays, prevScore)); } catch { if (!cancelled) setSsSummary(null); } finally { if (!cancelled) setSsLoading(false); } })(); });
    return () => { cancelled = true; };
  }, [ok, isExec, numericWindowDays]);

  // RAID
  useEffect(() => {
    if (!ok || !isExec) return; let cancelled = false;
    runIdle(() => { (async () => { try { setRaidLoading(true); const j: any = await fetchJson(`/api/portfolio/raid-panel?days=${numericWindowDays}`, { cache: "no-store" }); if (!j?.ok || !j?.panel) return; const p = j.panel; const riskDue = num(p?.risk_due); const issueDue = num(p?.issue_due); const depDue = num(p?.dependency_due); const assDue = num(p?.assumption_due); if (!cancelled) setRaidPanel({ days: num(p.days, numericWindowDays), due_total: riskDue + issueDue + depDue + assDue || num(p.due_total), overdue_total: num(p.overdue_total), risk_due: riskDue, issue_due: issueDue, dependency_due: depDue, assumption_due: assDue, risk_hi: num(p?.risk_hi), issue_hi: num(p?.issue_hi) }); } catch { } finally { if (!cancelled) setRaidLoading(false); } })(); });
    return () => { cancelled = true; };
  }, [ok, isExec, numericWindowDays]);

  // Due items
  useEffect(() => {
    if (!ok || !isExec) return; let cancelled = false;
    runIdle(() => { (async () => { try { setDueLoading(true); const j = await fetchJson<ArtifactDueResp>("/api/ai/events", { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ eventType: "artifact_due", windowDays: dueWindowDays }) }); if (!j || !j.ok) return; const ai = (j as any).ai as ArtifactDueAi; const list = Array.isArray(ai?.dueSoon) ? ai.dueSoon : []; const c = ai?.counts || ({} as any); const counts = { milestone: num(c.milestone), work_item: num(c.work_item), raid: num(c.raid), artifact: num(c.artifact), change: num(c.change), total: num(c.milestone) + num(c.work_item) + num(c.raid) + num(c.artifact) + num(c.change) }; const merged = list.slice().sort((a, b) => { const at = a?.dueDate ? new Date(a.dueDate).getTime() : Number.MAX_SAFE_INTEGER; const bt = b?.dueDate ? new Date(b.dueDate).getTime() : Number.MAX_SAFE_INTEGER; return at - bt; }).slice(0, 30).map(x => ({ ...x, title: safeStr(x?.title).trim() || "Untitled", link: safeStr(x?.link).trim() || null })); if (!cancelled) { setDueItems(merged); setDueCounts(counts); setDueUpdatedAt(new Date().toISOString()); } } catch { } finally { if (!cancelled) setDueLoading(false); } })(); });
    return () => { cancelled = true; };
  }, [ok, isExec, dueWindowDays]);

  const activeProjects = useMemo(() => {
    const arr = Array.isArray(projects) ? [...projects] : [];
    const norm = (v: any) => String(v ?? "").toLowerCase().trim();
    const truthy = (v: any) => v === true || v === "true" || v === 1 || v === "1";
    const isInactive = (p: any) => {
      if (p?.deleted_at || p?.deletedAt) return true; if (truthy(p?.is_deleted) || truthy(p?.deleted)) return true;
      if (truthy(p?.is_archived) || truthy(p?.archived)) return true; if (p?.archived_at) return true;
      if (p?.is_active === false) return true; if (p?.active === false) return true;
      const st = [p?.status, p?.lifecycle_state, p?.state, p?.phase].map(norm).find(Boolean) || "";
      if (!st) return false;
      return st.includes("closed") || st.includes("cancel") || st.includes("deleted") || st.includes("archive") || st.includes("inactive") || st.includes("complete") || st.includes("on_hold");
    };
    return arr.filter((p: any) => !isInactive(p));
  }, [projects]);

  const sortedProjects = useMemo(() => {
    const arr = [...activeProjects];
    arr.sort((a: any, b: any) => { const ac = projectCodeLabel(a?.project_code); const bc = projectCodeLabel(b?.project_code); const an = Number(ac); const bn = Number(bc); const aIsNum = Number.isFinite(an) && ac !== ""; const bIsNum = Number.isFinite(bn) && bc !== ""; if (aIsNum && bIsNum && an !== bn) return an - bn; if (ac && bc && ac !== bc) return ac.localeCompare(bc); return safeStr(a?.title).toLowerCase().localeCompare(safeStr(b?.title).toLowerCase()); });
    return arr;
  }, [activeProjects]);

  const ragMap = useMemo(() => {
    const m = new Map<string, { rag: RagLetter; health: number }>();
    for (const it of (rag || [])) { if (it?.project_id) m.set(String(it.project_id), { rag: it.rag, health: Number(it.health) }); }
    return m;
  }, [rag]);

  const ragAgg = useMemo(() => calcRagAgg(rag, activeProjects), [rag, activeProjects]);
  const uiActiveCount = activeProjects?.length || 0;
  const apiScore = phData?.ok ? clamp01to100(phData.portfolio_health) : null;
  const fallbackScore = ragAgg.scored ? ragAgg.avgHealth : clamp01to100(kpis.portfolioHealth);
  const portfolioScore = phLoading ? null : apiScore ?? fallbackScore;
  const phScoreForUi = clamp01to100(portfolioScore ?? fallbackScore);
  const phRag = scoreToRag(phScoreForUi);
  const phDelta = portfolioScore != null && phPrevScore != null ? Number(portfolioScore) - Number(phPrevScore) : null;

  const approvalCount = approvalItems.length;
  const byId = useMemo(() => { const m2 = new Map<string, any>(); for (const it of approvalItems) m2.set(String(it?.id || ""), it); return m2; }, [approvalItems]);

  const raidDueTotal = useMemo(() => { const r = num(raidPanel?.risk_due); const i = num(raidPanel?.issue_due); const d = num(raidPanel?.dependency_due); const a = num(raidPanel?.assumption_due); const sum = r + i + d + a; return sum > 0 ? sum : num(raidPanel?.due_total); }, [raidPanel]);

  const fpHasData = fpSummary?.ok === true;
  const fpVariancePct = fpHasData ? (fpSummary as any).variance_pct : null;
  const fpVarianceNum = fpVariancePct != null && Number.isFinite(Number(fpVariancePct)) ? Math.round(Number(fpVariancePct) * 10) / 10 : null;
  const fpVarianceLabel = fpVarianceNum != null ? fpVarianceNum === 0 ? "±0%" : `${fpVarianceNum > 0 ? "+" : ""}${fpVarianceNum}%` : "—";
  const fpRag = fpHasData ? (fpSummary as any).rag as RagLetter : null;

  const ssDisplayCount = ssSummary?.ok ? (sumSuccessBreakdown(ssSummary.breakdown) || num(ssSummary.count)) : 0;
  const ssDelta = ssSummary?.ok ? Number(ssSummary.delta) : null;

  async function decide(taskId: string, decision: "approve" | "reject", comment = "") {
    const item = byId.get(taskId); if (!item) return;
    setPendingIds(p => ({ ...p, [taskId]: true }));
    setApprovalItems(items => items.filter(x => String(x?.id || "") !== taskId));
    try { const r = await fetch("/api/approvals/decision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ approval_task_id: taskId, decision, comment }) }); const j = await r.json(); if (!j?.ok) throw new Error(j?.error || "Decision failed"); }
    catch (e: any) { setApprovalItems(items => { const exists = items.some(x => String(x?.id || "") === taskId); return exists ? items : [item, ...items]; }); alert(e?.message || "Decision failed"); }
    finally { setPendingIds(p => { const next = { ...p }; delete next[taskId]; return next; }); }
  }

  function viewHref(item: any) {
    const projectRef = safeStr(item?.project_code) || safeStr(item?.project_human_id) || safeStr(item?.project?.project_code) || safeStr(item?.project?.project_human_id) || safeStr(item?.project_id || item?.change?.project_id);
    const changeId = safeStr(item?.change_id || item?.change?.id);
    if (projectRef && changeId) return `/projects/${encodeURIComponent(projectRef)}/change/${encodeURIComponent(changeId)}`;
    return "";
  }

  const firstProjectRef = useMemo(() => {
    const fp = fpSummary && fpSummary.ok ? (fpSummary as any).project_ref : null;
    if (fp) return fp;
    const p = sortedProjects[0] as any;
    if (!p) return "";
    return projectCodeLabel(p?.project_code) || safeStr(p?.id);
  }, [fpSummary, sortedProjects]);

  function navigateToBudget() {
    if (fpHasData && (fpSummary as any).artifact_id) {
      router.push(`/projects/${firstProjectRef}/artifacts/${(fpSummary as any).artifact_id}?panel=intelligence`);
    } else if (firstProjectRef) {
      router.push(`/projects/${firstProjectRef}/artifacts/new?type=FINANCIAL_PLAN`);
    }
  }

  if (!ok) {
    return (
      <div className="min-h-screen bg-gray-50 grid place-items-center p-10">
        <div className="max-w-lg rounded-2xl border border-gray-200 bg-white p-10 shadow-sm">
          <div className="text-xl font-bold text-gray-900">Dashboard Error</div>
          <div className="mt-2 text-gray-500">{(data as any).error}</div>
        </div>
      </div>
    );
  }

  // ── Milestone items filtered to milestones only for the sidebar
  const milestoneDueItems = dueItems.filter(x => x.itemType === "milestone").slice(0, 5);
  const allUpcomingItems = dueItems.slice(0, 6);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        body { font-family: 'Plus Jakarta Sans', sans-serif !important; -webkit-font-smoothing: antialiased; }
        .mono { font-family: 'JetBrains Mono', monospace !important; }
      `}</style>

      <RejectionModal
        open={!!rejectModal}
        title={rejectModal?.title || ""}
        onConfirm={reason => { if (rejectModal) { decide(rejectModal.taskId, "approve" === "approve" ? "reject" : "reject", reason); decide(rejectModal.taskId, "reject", reason); setRejectModal(null); } }}
        onCancel={() => setRejectModal(null)}
      />

      <div className="min-h-screen bg-gray-50" style={{ fontFamily: "'Plus Jakarta Sans', sans-serif" }}>

        {/* ── Top Nav Bar ── */}
        <header className="sticky top-0 z-30 bg-white border-b border-gray-100 shadow-sm">
          <div className="max-w-screen-2xl mx-auto px-6 h-14 flex items-center justify-between gap-4">
            {/* Logo + Title */}
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-blue-600 flex items-center justify-center">
                <Layers className="h-4 w-4 text-white" />
              </div>
              <div className="flex items-center gap-2">
                <span className="font-bold text-gray-900">Portfolio Dashboard</span>
                <span className="hidden sm:block text-xs text-gray-400 font-medium">Enterprise project portfolio overview</span>
              </div>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-2">
              {/* Window selector */}
              <div className="flex items-center gap-1 p-1 rounded-xl bg-gray-100/80">
                {[7, 14, 30, 60].map(d => (
                  <button key={d} type="button" onClick={() => setWindowDays(d as WindowDays)}
                    className={["px-3 py-1.5 rounded-lg text-xs font-semibold transition-all", windowDays === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"].join(" ")}>
                    Last {d} days
                  </button>
                ))}
              </div>
              {dueUpdatedAt && <LastUpdated iso={dueUpdatedAt} />}
              <div className="h-5 w-px bg-gray-200" />
              <button className="h-9 w-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors"><Search className="h-4 w-4 text-gray-500" /></button>
              <button className="h-9 w-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors"><Filter className="h-4 w-4 text-gray-500" /></button>
              <button className="h-9 w-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors"><Download className="h-4 w-4 text-gray-500" /></button>
              <NotificationBell />
              <button className="h-9 w-9 rounded-xl border border-gray-200 bg-white flex items-center justify-center hover:bg-gray-50 transition-colors" onClick={() => router.push("/settings")}><Settings className="h-4 w-4 text-gray-500" /></button>
            </div>
          </div>
        </header>

        <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">

          {isExec ? (
            <>
              {/* ── KPI Cards Row ── */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Portfolio Health */}
                <KpiCardNew
                  label="Portfolio Health"
                  value={`${phScoreForUi}%`}
                  sub={`${ragAgg.g} Green · ${ragAgg.a} Amber · ${ragAgg.r} Red`}
                  icon={<Activity className="h-5 w-5" />}
                  tone={phRag === "G" ? "green" : phRag === "A" ? "amber" : "red"}
                  trendValue={phDelta}
                  trendLabel={phDelta != null ? `${Math.abs(Math.round(phDelta))}` : undefined}
                  onClick={() => router.push("/insights")}
                  delay={0}
                />

                {/* Open Risks */}
                <KpiCardNew
                  label="Open Risks"
                  value={raidLoading ? "…" : `${raidDueTotal || kpis.openRisks}`}
                  sub="high priority"
                  icon={<AlertTriangle className="h-5 w-5" />}
                  tone="amber"
                  trendValue={num(raidPanel?.risk_hi) + num(raidPanel?.issue_hi)}
                  trendLabel={`${num(raidPanel?.risk_hi) + num(raidPanel?.issue_hi)}`}
                  onClick={() => router.push(`/risks?days=${numericWindowDays}`)}
                  delay={0.05}
                />

                {/* Milestones Due */}
                <KpiCardNew
                  label="Milestones Due"
                  value={`${milestonesDueLive}`}
                  sub={`next ${windowDays === "all" ? "60" : windowDays} days`}
                  icon={<Clock3 className="h-5 w-5" />}
                  tone="blue"
                  trendValue={null}
                  onClick={() => router.push(`/milestones?days=${numericWindowDays}`)}
                  delay={0.1}
                />

                {/* Budget Health */}
                <KpiCardNew
                  label="Budget Health"
                  value={fpLoading ? "…" : fpVarianceLabel}
                  sub="variance"
                  icon={<DollarSign className="h-5 w-5" />}
                  tone={!fpHasData ? "blue" : fpRag === "G" ? "green" : fpRag === "A" ? "amber" : "red"}
                  trendValue={fpVarianceNum}
                  trendLabel={fpVarianceLabel}
                  onClick={navigateToBudget}
                  delay={0.15}
                />
              </div>

              {/* ── Main Content: Chart + AI Insights ── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Portfolio Activity Trend */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-semibold text-gray-900">Portfolio Activity Trend</h3>
                      <p className="text-xs text-gray-400 mt-0.5">Delivery activity across {windowDays === "all" ? "60" : windowDays} days</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ background: "#bfdbfe" }} />Active work</span>
                      <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm inline-block" style={{ background: "#fca5a5" }} />Risks/Issues</span>
                    </div>
                  </div>
                  <ActivityChartPlaceholder windowDays={numericWindowDays} />
                  {/* X-axis labels */}
                  <div className="flex justify-between text-[10px] text-gray-300 mt-1 px-1">
                    {(() => {
                      const labels: string[] = [];
                      const count = Math.min(numericWindowDays, 30);
                      const step = Math.max(1, Math.floor(count / 5));
                      for (let i = 0; i < count; i += step) {
                        const d = new Date(Date.now() - (count - i) * 86400000);
                        labels.push(d.toLocaleDateString(undefined, { month: "short", day: "numeric" }));
                      }
                      labels.push(new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" }));
                      return labels.map((l, i) => <span key={i}>{l}</span>);
                    })()}
                  </div>
                </div>

                {/* AI Insights Panel */}
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="h-8 w-8 rounded-xl bg-purple-100 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">AI Insights</h3>
                    </div>
                    <button onClick={() => router.push("/insights")} className="ml-auto text-xs text-blue-600 hover:text-blue-700 font-medium">View all</button>
                  </div>
                  <div className="space-y-2.5">
                    {insightsLoading ? (
                      Array.from({ length: 3 }).map((_, i) => (
                        <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
                      ))
                    ) : insights.length === 0 ? (
                      <div className="py-8 text-center">
                        <CheckCircle2 className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">No active insights</p>
                      </div>
                    ) : insights.slice(0, 4).map((x, i) => (
                      <m.div key={x.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}>
                        <InsightCard severity={x.severity} title={x.title} body={x.body} href={fixInsightHref(x, windowDays)} />
                      </m.div>
                    ))}
                  </div>
                </div>
              </div>

              {/* ── Governance Intelligence ── */}
              <GovernanceIntelligence days={numericWindowDays} />

              {/* ── Projects Table + Upcoming Milestones/Approvals ── */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                {/* Projects List */}
                <div className="lg:col-span-2 bg-white rounded-2xl border border-gray-100 shadow-sm">
                  <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-gray-50">
                    <div>
                      <h3 className="font-semibold text-gray-900">Active Projects</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{uiActiveCount} projects · sorted by code</p>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-400">
                      <span>Project</span>
                      <span className="w-28 text-center">Health</span>
                      <span className="w-4" />
                    </div>
                  </div>
                  <div>
                    {sortedProjects.slice(0, 8).map((p: any, i) => (
                      <m.div key={String(p.id || i)} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.04 * i }}>
                        <ProjectRow p={p} ragMap={ragMap} />
                      </m.div>
                    ))}
                    {sortedProjects.length > 8 && (
                      <div className="px-4 py-3 text-center border-t border-gray-50">
                        <button onClick={() => router.push("/projects")} className="text-sm text-blue-600 hover:text-blue-700 font-medium transition-colors">
                          View all {uiActiveCount} projects →
                        </button>
                      </div>
                    )}
                    {sortedProjects.length === 0 && (
                      <div className="py-12 text-center text-gray-400 text-sm">No active projects</div>
                    )}
                  </div>
                </div>

                {/* Right sidebar: Upcoming Milestones */}
                <div className="space-y-4">

                  {/* Upcoming Milestones */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="h-8 w-8 rounded-xl bg-blue-50 flex items-center justify-center">
                        <Calendar className="h-4 w-4 text-blue-500" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">Upcoming Milestones</h3>
                      </div>
                      <div className="flex items-center gap-1 p-0.5 rounded-lg bg-gray-100/80">
                        {[7, 14, 30].map(d => (
                          <button key={d} type="button" onClick={() => setDueWindowDays(d as any)}
                            className={["px-2 py-1 rounded-md text-[11px] font-semibold transition-all", dueWindowDays === d ? "bg-white text-gray-900 shadow-sm" : "text-gray-400 hover:text-gray-600"].join(" ")}>
                            {d}d
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-2">
                      {dueLoading ? (
                        Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-gray-50 animate-pulse" />)
                      ) : allUpcomingItems.length === 0 ? (
                        <div className="py-8 text-center">
                          <CheckCircle2 className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                          <p className="text-sm text-gray-400">Nothing due in {dueWindowDays}d</p>
                        </div>
                      ) : allUpcomingItems.map((it, i) => (
                        <m.div key={i} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: i * 0.05 }}>
                          <MilestoneItem item={it} onClick={() => { const href = safeStr(it?.link).trim(); if (href) router.push(href); }} />
                        </m.div>
                      ))}
                    </div>
                    {dueItems.length > 6 && (
                      <button onClick={() => router.push(`/milestones?days=${dueWindowDays}`)} className="mt-3 w-full text-xs text-blue-600 hover:text-blue-700 font-medium text-center transition-colors py-1">
                        View {dueItems.length - 6} more items →
                      </button>
                    )}
                  </div>

                  {/* Approvals */}
                  <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                    <div className="flex items-center gap-2.5 mb-4">
                      <div className="h-8 w-8 rounded-xl bg-green-50 flex items-center justify-center">
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                      </div>
                      <div className="flex-1">
                        <h3 className="font-semibold text-gray-900">Pending Approvals</h3>
                      </div>
                      {approvalCount > 0 && (
                        <span className="h-5 w-5 rounded-full bg-green-100 text-green-700 text-[11px] font-bold flex items-center justify-center">{approvalCount}</span>
                      )}
                    </div>
                    <div className="space-y-2.5">
                      {approvalsLoading ? (
                        Array.from({ length: 2 }).map((_, i) => <div key={i} className="h-20 rounded-xl bg-gray-50 animate-pulse" />)
                      ) : approvalItems.slice(0, 4).map((t: any) => {
                        const taskId = String(t?.id || "");
                        return (
                          <m.div key={taskId} initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                            <ApprovalCard
                              item={t}
                              isBusy={Boolean(pendingIds[taskId])}
                              onApprove={() => decide(taskId, "approve")}
                              onReject={() => setRejectModal({ taskId, title: t?.change?.title || t?.title || "Change request" })}
                            />
                          </m.div>
                        );
                      })}
                      {approvalItems.length === 0 && !approvalsLoading && (
                        <div className="py-6 text-center">
                          <CheckCheck className="h-6 w-6 text-gray-200 mx-auto mb-1.5" />
                          <p className="text-sm text-gray-400">No approvals pending</p>
                        </div>
                      )}
                      {approvalCount > 4 && (
                        <button onClick={() => router.push("/approvals")} className="w-full text-xs text-blue-600 hover:text-blue-700 font-medium text-center py-1 transition-colors">
                          View {approvalCount - 4} more →
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* ── Quick Stats Row ── */}
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {[
                  { label: "Active Projects",    value: `${uiActiveCount}`,                           color: "text-gray-800" },
                  { label: "Portfolio Score",     value: `${phScoreForUi}%`,                          color: phRag === "G" ? "text-green-600" : phRag === "A" ? "text-amber-600" : "text-red-500" },
                  { label: "Open Risks",          value: `${kpis.openRisks}`,                        color: "text-amber-600" },
                  { label: "Success Stories",     value: ssLoading ? "…" : `${ssDisplayCount}`,      color: "text-purple-600" },
                  { label: "Open Lessons",        value: `${kpis.openLessons}`,                      color: "text-blue-600" },
                ].map((stat, i) => (
                  <m.div key={stat.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}
                    className="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3.5 flex items-center justify-between">
                    <span className="text-sm text-gray-500 font-medium">{stat.label}</span>
                    <span className={["text-lg font-bold mono", stat.color].join(" ")}>{stat.value}</span>
                  </m.div>
                ))}
              </div>
            </>
          ) : (
            /* ── Non-exec personal view ── */
            <div className="space-y-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">My Day</h2>
                <p className="text-gray-500 mt-0.5">Focus and flow · {today}</p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <KpiCardNew label="My Approvals"  value={approvalsLoading ? "…" : `${approvalCount}`} icon={<CheckCircle2 className="h-5 w-5" />} tone="green"  delay={0}    onClick={() => router.push("/approvals")} />
                <KpiCardNew label="Open Lessons"  value={`${kpis.openLessons}`}                        icon={<Sparkles className="h-5 w-5" />}     tone="purple" delay={0.05} onClick={() => router.push("/lessons")} />
                <KpiCardNew label="RAID Due"       value={raidLoading ? "…" : `${raidDueTotal}`}       icon={<AlertTriangle className="h-5 w-5" />} tone="amber"  delay={0.1}  onClick={() => router.push(`/risks?days=${numericWindowDays}`)} />
              </div>
              {allUpcomingItems.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                  <h3 className="font-semibold text-gray-900 mb-4">My Upcoming Items</h3>
                  <div className="space-y-2">
                    {allUpcomingItems.map((it, i) => (
                      <MilestoneItem key={i} item={it} onClick={() => { const href = safeStr(it?.link).trim(); if (href) router.push(href); }} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="h-6" />
        </main>
      </div>
    </>
  );
}