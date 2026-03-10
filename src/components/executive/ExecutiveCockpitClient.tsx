"use client";

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ArrowUpRight,
  Users,
  Layers,
  RefreshCw,
  ChevronRight,
  Target,
  BarChart2,
  CheckCheck,
  Flame,
  Clock3,
  X,
  Copy,
  Lock,
} from "lucide-react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import AIAssistantAvatar from "@/components/executive/AIAssistantAvatar";
import { portfolioGlobalCss } from "@/lib/ui/portfolioTheme";

/* ============================================================================
   Types
============================================================================ */

type ApiOk<T> = { ok?: boolean; orgId?: string; org_id?: string; scope?: string } & T;
type ApiErr = { ok?: boolean; error: string; message?: string };

type Payload =
  | ApiOk<{
      items?: any[];
      pending?: any[];
      data?: any;
      blockers?: any[];
      breaches?: any[];
      signals?: any[];
    }>
  | ApiErr;

type BrainResp = {
  ok: boolean;
  scope?: string;
  generated_at?: string;
  rollup?: any;
  orgs?: Array<{
    org_id: string;
    org_name?: string;
    approvals?: {
      total_pending_steps: number;
      unique_pending_items: number;
      overdue_steps: number;
      oldest_pending_days: number;
      blocked_projects: number;
      top_blockers: Array<{
        key: string;
        label: string;
        count: number;
        overdue_count: number;
        oldest_days: number;
      }>;
    };
    sla?: {
      breached_total: number;
      breached_by_type?: Record<string, number>;
    };
    blockers?: {
      projects_blocked: number;
      reasons?: Array<{ type: string; count: number }>;
    };
    health?: {
      portfolio_score: number;
      portfolio_rag: "G" | "A" | "R";
      projects?: Array<{
        project_id: string;
        project_code?: string;
        project_title: string;
        score: number;
        rag: "G" | "A" | "R";
        signals?: any;
      }>;
    };
    ai_summary?: string;
  }>;
};

type ToneKey = "indigo" | "amber" | "emerald" | "rose" | "cyan" | "slate";

type TileConfig = {
  id: string;
  label: string;
  short: string;
  icon: React.ReactNode;
  tone: ToneKey;
  count: number | null;
  error: string | null;
  href: string;
  items: any[];
  body: React.ReactNode;
};

/* ============================================================================
   Theme + styling system
============================================================================ */

const SURFACE = {
  page: "w-full",
  card:
    "relative overflow-hidden rounded-2xl min-h-[168px] flex flex-col text-left w-full",
  panel:
    "rounded-2xl border border-slate-200/70 bg-white/70",
  drawerPanel:
    "relative w-full max-w-[520px] h-full bg-white/85 border-l border-slate-200/70 flex flex-col",
  glassStrong:
    "backdrop-blur-[28px] supports-[backdrop-filter]:backdrop-blur-[28px]",
  glass:
    "backdrop-blur-[14px] supports-[backdrop-filter]:backdrop-blur-[14px]",
  glassSoft:
    "backdrop-blur-[10px] supports-[backdrop-filter]:backdrop-blur-[10px]",
};

const TONES: Record<
  ToneKey,
  {
    iconBg: string;
    iconGlow: string;
    orb: string;
    bar: string;
    glow: string;
    tint: string;
    badge: string;
    listDot: string;
  }
> = {
  indigo: {
    iconBg: "linear-gradient(135deg,#6366f1,#4f46e5)",
    iconGlow: "rgba(99,102,241,0.42)",
    orb: "rgba(99,102,241,0.06)",
    bar: "#6366f1",
    glow: "rgba(99,102,241,0.18)",
    tint: "rgba(99,102,241,0.03)",
    badge: "bg-indigo-50 border-indigo-200 text-indigo-700",
    listDot: "bg-indigo-400",
  },
  amber: {
    iconBg: "linear-gradient(135deg,#f59e0b,#d97706)",
    iconGlow: "rgba(245,158,11,0.42)",
    orb: "rgba(245,158,11,0.07)",
    bar: "#f59e0b",
    glow: "rgba(245,158,11,0.18)",
    tint: "rgba(245,158,11,0.03)",
    badge: "bg-amber-50 border-amber-200 text-amber-700",
    listDot: "bg-amber-400",
  },
  emerald: {
    iconBg: "linear-gradient(135deg,#10b981,#059669)",
    iconGlow: "rgba(16,185,129,0.42)",
    orb: "rgba(16,185,129,0.07)",
    bar: "#10b981",
    glow: "rgba(16,185,129,0.18)",
    tint: "rgba(16,185,129,0.03)",
    badge: "bg-emerald-50 border-emerald-200 text-emerald-700",
    listDot: "bg-emerald-400",
  },
  rose: {
    iconBg: "linear-gradient(135deg,#f43f5e,#e11d48)",
    iconGlow: "rgba(244,63,94,0.42)",
    orb: "rgba(244,63,94,0.06)",
    bar: "#f43f5e",
    glow: "rgba(244,63,94,0.18)",
    tint: "rgba(244,63,94,0.03)",
    badge: "bg-rose-50 border-rose-200 text-rose-700",
    listDot: "bg-rose-400",
  },
  cyan: {
    iconBg: "linear-gradient(135deg,#06b6d4,#0891b2)",
    iconGlow: "rgba(6,182,212,0.42)",
    orb: "rgba(6,182,212,0.06)",
    bar: "#06b6d4",
    glow: "rgba(6,182,212,0.18)",
    tint: "rgba(6,182,212,0.03)",
    badge: "bg-cyan-50 border-cyan-200 text-cyan-700",
    listDot: "bg-cyan-400",
  },
  slate: {
    iconBg: "linear-gradient(135deg,#64748b,#475569)",
    iconGlow: "rgba(100,116,139,0.38)",
    orb: "rgba(100,116,139,0.05)",
    bar: "#64748b",
    glow: "rgba(100,116,139,0.14)",
    tint: "rgba(100,116,139,0.025)",
    badge: "bg-slate-50 border-slate-200 text-slate-700",
    listDot: "bg-slate-400",
  },
};

function cardShadow(tone: ToneKey) {
  const acc = TONES[tone];
  return `0 1px 1px rgba(0,0,0,0.02), 0 4px 12px rgba(0,0,0,0.04), 0 16px 44px ${acc.glow}, 0 44px 88px ${acc.tint}, 0 0 0 1px rgba(226,232,240,0.75), 0 1px 0 rgba(255,255,255,1) inset`;
}

/* ============================================================================
   Utilities
============================================================================ */

function firstOrg(brain: BrainResp | null) {
  return brain?.orgs && Array.isArray(brain.orgs) ? brain.orgs[0] : null;
}

function isErr(x: any): x is ApiErr {
  return !!x && typeof x === "object" && typeof x.error === "string";
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeNum(x: unknown, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isHtmlLike(text: string, contentType?: string | null) {
  const t = (text || "").trim().toLowerCase();
  if ((contentType || "").toLowerCase().includes("text/html")) return true;
  if (
    t.startsWith("<!doctype html") ||
    t.startsWith("<html") ||
    t.includes("<head") ||
    t.includes("<body")
  ) {
    return true;
  }
  return false;
}

function stripHtml(s: string) {
  return safeStr(s)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanErrorMessage(s: string) {
  const raw = safeStr(s).trim();
  if (!raw) return "Request failed";
  const cleaned = stripHtml(raw);
  if (!cleaned || cleaned.length < 3) return "Request failed";
  return cleaned.length > 140 ? `${cleaned.slice(0, 140)}…` : cleaned;
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
    },
    signal,
  });

  const contentType = res.headers.get("content-type");
  const text = await res.text();

  if (isHtmlLike(text, contentType)) {
    if (!res.ok) throw new Error(`Endpoint error (${res.status})`);
    throw new Error("Invalid response (expected JSON)");
  }

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new Error(`Endpoint error (${res.status})`);
    throw new Error("Invalid JSON response");
  }

  if (!res.ok) {
    const msg =
      (json && (json.message || json.error)) ||
      (text ? text.slice(0, 200) : "") ||
      `Request failed (${res.status})`;
    throw new Error(cleanErrorMessage(msg));
  }

  return json as T;
}

function errPayload(msg: string): ApiErr {
  return { error: cleanErrorMessage(msg) };
}

function settledOrErr<T>(r: PromiseSettledResult<T>, fallbackMsg: string): T | ApiErr {
  if (r.status === "fulfilled") return r.value as T;
  return errPayload((r.reason?.message || String(r.reason)) || fallbackMsg);
}

function extractList(payload: any, preferredKeys: string[] = ["items"]): any[] {
  if (!payload || typeof payload !== "object") return [];

  for (const key of preferredKeys) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
  }

  const candidates = ["items", "pending", "rows", "blockers", "breaches", "signals"];
  for (const key of candidates) {
    const value = payload?.[key];
    if (Array.isArray(value)) return value;
  }

  const data = payload?.data;
  if (Array.isArray(data)) return data;

  if (data && typeof data === "object") {
    for (const key of preferredKeys) {
      const value = data?.[key];
      if (Array.isArray(value)) return value;
    }
    for (const key of candidates) {
      const value = data?.[key];
      if (Array.isArray(value)) return value;
    }
  }

  return [];
}

function resolvePersonLabel(it: any): string {
  const candidates = [
    it?.display_name,
    it?.full_name,
    it?.name,
    it?.label,
    it?.approver_name,
    it?.approver_label,
    it?.user_name,
    it?.email,
    it?.user_email,
    it?.approver_email,
  ]
    .map((v) => safeStr(v).trim())
    .filter(Boolean);

  for (const c of candidates) {
    const maybeUid = c.toLowerCase().startsWith("user:") ? c.slice(5).trim() : c;
    if (looksLikeUuid(maybeUid)) continue;
    if (c.toLowerCase().startsWith("user:")) continue;
    return c;
  }

  const emailish = candidates.find((c) => c.includes("@") && c.includes("."));
  if (emailish) return emailish;

  return "Unknown user";
}

function timeAgo(iso: string) {
  if (!iso) return "";
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return `${Math.floor(d)}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function ageFromItem(it: any): string {
  const ts =
    it?.submitted_at ??
    it?.created_at ??
    it?.computed_at ??
    it?.updated_at ??
    it?.requested_at ??
    it?.requestedAt ??
    null;

  if (!ts) return "";
  return timeAgo(safeStr(ts));
}

function fmtUkDateOnly(iso: string) {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;

  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(d);
  } catch {
    return iso;
  }
}

function normalizeHref(href: string) {
  return safeStr(href)
    .trim()
    .replace(/\/RAID(\/|$)/g, "/raid$1")
    .replace(/\/WBS(\/|$)/g, "/wbs$1")
    .replace(/\/SCHEDULE(\/|$)/g, "/schedule$1")
    .replace(/\/CHANGE(\/|$)/g, "/change$1")
    .replace(/\/CHANGES(\/|$)/g, "/change$1")
    .replace(/\/CHANGE_REQUESTS(\/|$)/g, "/change$1")
    .replace(/\/ARTIFACTS(\/|$)/g, "/artifacts$1");
}

function extractProjectRefFromHref(href: string): string | null {
  const m = safeStr(href).trim().match(/\/projects\/([^\/?#]+)/i);
  return m?.[1] ? String(m[1]) : null;
}

function bestHref(item: any, fallbackHref: string): string {
  const rawLink = safeStr(item?.href || item?.link || "").trim();
  const normalized = rawLink ? normalizeHref(rawLink) : "";

  if (normalized.startsWith("/")) return normalized;

  const meta = item?.meta ?? {};
  const projectUuid =
    safeStr(meta?.project_id).trim() || safeStr(item?.project_id).trim() || "";
  const projectHuman =
    safeStr(meta?.project_human_id).trim() ||
    safeStr(meta?.project_code).trim() ||
    safeStr(item?.project_code).trim() ||
    "";

  const projectRef = projectUuid || projectHuman || extractProjectRefFromHref(normalized) || "";
  const kind = safeLower(item?.itemType || item?.kind || item?.type || "");
  const artifactId = safeStr(
    meta?.sourceArtifactId || meta?.artifactId || item?.artifact_id || item?.artifactId || ""
  ).trim();

  if (projectRef && artifactId && looksLikeUuid(artifactId)) {
    const qs = new URLSearchParams();
    qs.set("artifactId", artifactId);

    if (kind.includes("milestone") || kind.includes("schedule")) qs.set("panel", "schedule");
    else if (kind.includes("work_item") || kind.includes("wbs")) qs.set("panel", "wbs");
    else if (kind.includes("change")) qs.set("panel", "change");

    return `/projects/${projectRef}/artifacts?${qs.toString()}`;
  }

  if (projectRef) {
    if (kind.includes("milestone") || kind.includes("schedule")) {
      return `/projects/${projectRef}/artifacts?panel=schedule`;
    }
    if (kind.includes("work_item") || kind.includes("wbs")) {
      return `/projects/${projectRef}/artifacts?panel=wbs`;
    }
    if (
      kind.includes("raid") ||
      kind.includes("risk") ||
      kind.includes("issue") ||
      kind.includes("dependency")
    ) {
      return `/projects/${projectRef}/raid`;
    }
    if (kind.includes("change")) return `/projects/${projectRef}/change`;
    return `/projects/${projectRef}`;
  }

  if (
    kind.includes("approval") ||
    kind.includes("approver") ||
    kind.includes("bottleneck") ||
    kind.includes("blocking")
  ) {
    return "/approvals/bottlenecks";
  }

  return fallbackHref || "/approvals";
}

function extractProjectId(item: any): string {
  return safeStr(item?.meta?.project_id).trim() || safeStr(item?.project_id).trim() || "";
}

function getPayloadCount(p: Payload | null): number | null {
  if (!p || isErr(p)) return null;
  return extractList(p).length;
}

function getPayloadItems(p: Payload | null, keys?: string[]): any[] {
  if (!p || isErr(p)) return [];
  return extractList(p, keys);
}

function getPayloadError(p: Payload | null): string | null {
  if (p && isErr(p)) return p.message ?? p.error;
  return null;
}

function pickCount(primary: Payload | null, fallback: number | null): number | null {
  const primaryCount = getPayloadCount(primary);
  if (primaryCount == null) return fallback;
  if (primaryCount === 0 && (fallback ?? 0) > 0) return fallback;
  return primaryCount;
}

function pickItems(primary: any[], fallback: any[]): any[] {
  if (primary.length) return primary;
  if (fallback.length) return fallback;
  return [];
}

/* ============================================================================
   Skeleton
============================================================================ */

function TileSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl border border-slate-100 bg-white/70 p-5 min-h-[168px] animate-pulse backdrop-blur-[14px]"
    >
      <div className="mb-4 flex items-start gap-3">
        <div className="h-10 w-10 shrink-0 rounded-xl bg-slate-200/80" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 w-1/3 rounded bg-slate-200/80" />
          <div className="h-8 w-1/2 rounded bg-slate-100/80" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-2.5 w-full rounded bg-slate-100/70" />
        <div className="h-2.5 w-4/5 rounded bg-slate-100/70" />
        <div className="h-2.5 w-3/5 rounded bg-slate-100/70" />
      </div>
    </m.div>
  );
}

/* ============================================================================
   Drawer
============================================================================ */

function Drawer({
  open,
  onClose,
  title,
  subtitle,
  tone,
  items,
  fallbackHref,
  memberProjectIds,
  isAdmin,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  tone: ToneKey;
  items: any[];
  fallbackHref: string;
  memberProjectIds: string[];
  isAdmin: boolean;
}) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && open) onClose();
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const acc = TONES[tone];

  function canAccess(item: any): boolean {
    if (isAdmin) return true;
    const pid = extractProjectId(item);
    if (!pid || !looksLikeUuid(pid)) return true;
    return memberProjectIds.includes(pid);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />

      <m.div
        initial={{ x: 520, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 520, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className={SURFACE.drawerPanel}
        style={{
          backdropFilter: "blur(18px) saturate(1.6)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.15)",
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Governance Brain
            </div>
            <div className="mt-1 flex min-w-0 items-center gap-2">
              <span className="truncate text-[15px] font-bold text-slate-950">{title}</span>
              <span
                className="h-2 w-2 rounded-full"
                style={{
                  background: acc.bar,
                  boxShadow: `0 0 10px ${acc.glow}`,
                }}
              />
            </div>
            {subtitle ? (
              <div className="mt-1 truncate text-[12px] font-medium text-slate-500">
                {subtitle}
              </div>
            ) : null}
          </div>

          <button
            onClick={onClose}
            className="rounded-xl p-2 transition-colors hover:bg-slate-100"
            aria-label="Close"
          >
            <X className="h-4 w-4 text-slate-600" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {!items.length ? (
            <div className="py-10 text-center text-sm text-slate-500">No items available</div>
          ) : (
            <div className="space-y-2.5">
              {items.slice(0, 25).map((it, idx) => {
                const label = safeStr(
                  it?.title ||
                    it?.name ||
                    it?.label ||
                    it?.project_title ||
                    it?.project_name ||
                    "---"
                );

                const sub = safeStr(
                  it?.project_name ||
                    it?.project_title ||
                    it?.sla_status ||
                    it?.sla_state ||
                    it?.state ||
                    it?.type ||
                    it?.itemType ||
                    ""
                );

                const due = safeStr(it?.dueDate || it?.due_date || "");
                const age = ageFromItem(it);
                const href = bestHref(it, fallbackHref);
                const hasAccess = canAccess(it);

                return (
                  <div
                    key={idx}
                    className="rounded-2xl border border-slate-200/70 bg-white/70 px-4 py-3"
                    style={{
                      backdropFilter: "blur(10px)",
                      boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                    }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-slate-900">
                          {label}
                        </div>
                        {(sub || due) && (
                          <div className="mt-1 truncate text-[11px] font-medium text-slate-500">
                            {sub}
                            {sub && due ? " • " : ""}
                            {due ? `Due ${fmtUkDateOnly(due)}` : ""}
                          </div>
                        )}
                      </div>

                      {age ? (
                        <div
                          className="shrink-0 text-[10px] font-semibold text-slate-400"
                          style={{ fontFamily: "var(--mono)" }}
                        >
                          {age}
                        </div>
                      ) : null}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      {hasAccess ? (
                        <a
                          href={href}
                          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-[11px] font-bold text-slate-700 transition-colors hover:bg-white"
                        >
                          Open <ArrowUpRight className="h-3.5 w-3.5" />
                        </a>
                      ) : (
                        <div className="inline-flex flex-1 cursor-not-allowed select-none items-center justify-center gap-1.5 rounded-xl border border-slate-200/60 bg-slate-50/80 px-3 py-2 text-[11px] font-semibold text-slate-400">
                          <Lock className="h-3.5 w-3.5" />
                          No access — not a project member
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          const txt = `${label}${due ? ` — due ${fmtUkDateOnly(due)}` : ""}`;
                          navigator.clipboard?.writeText(txt);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-bold text-white transition-colors hover:bg-indigo-700"
                        title="Copy reminder"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        Copy
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border-t border-slate-200/70 p-5">
          <a
            href={fallbackHref}
            className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-[12px] font-bold text-slate-700 transition-colors hover:bg-white"
            style={{ backdropFilter: "blur(10px)" }}
          >
            View full list <ChevronRight className="h-4 w-4" />
          </a>
        </div>
      </m.div>
    </div>
  );
}

/* ============================================================================
   Cockpit Tile
============================================================================ */

function CockpitTile({
  label,
  count,
  icon,
  tone,
  error,
  children,
  href,
  delay = 0,
  onClick,
}: {
  label: string;
  count: number | null;
  icon: React.ReactNode;
  tone: ToneKey;
  error?: string | null;
  children?: React.ReactNode;
  href?: string;
  delay?: number;
  onClick?: () => void;
}) {
  const acc = TONES[tone];

  return (
    <m.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className={SURFACE.card}
      style={{
        background:
          "linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(250,252,255,0.97) 50%, rgba(248,250,255,0.96) 100%)",
        border: "1px solid rgba(255,255,255,0.96)",
        boxShadow: cardShadow(tone),
        backdropFilter: "blur(28px) saturate(1.9)",
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 rounded-2xl"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,255,255,0.68) 0%, transparent 62%)",
        }}
      />
      <div
        className="absolute inset-x-0 top-0 h-[1px] rounded-t-2xl"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,1) 20%, rgba(255,255,255,1) 80%, transparent)",
        }}
      />
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-24 rounded-t-2xl"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, transparent 100%)",
        }}
      />
      <div
        className="pointer-events-none absolute -bottom-12 -right-12 h-40 w-40 rounded-full"
        style={{
          background: `radial-gradient(ellipse, ${acc.orb} 0%, transparent 65%)`,
          filter: "blur(2px)",
        }}
      />
      <div
        className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full"
        style={{
          background: acc.bar,
          boxShadow: `0 0 14px ${acc.glow}`,
        }}
      />

      <div className="relative flex h-full flex-col p-5 pl-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              {label}
            </p>

            {error ? (
              <div className="mt-1 rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-700">
                <AlertTriangle className="mr-1.5 inline h-3.5 w-3.5 -mt-0.5" />
                {cleanErrorMessage(error)}
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <p
                  className="text-[38px] font-bold leading-none tracking-tight text-slate-950"
                  style={{
                    fontFamily: "var(--mono)",
                    letterSpacing: "-0.025em",
                  }}
                >
                  {count === null ? (
                    <span className="inline-flex items-center gap-1 pb-2">
                      {[0, 120, 240].map((d) => (
                        <span
                          key={d}
                          className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300"
                          style={{ animationDelay: `${d}ms` }}
                        />
                      ))}
                    </span>
                  ) : (
                    count
                  )}
                </p>
              </div>
            )}
          </div>

          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
            style={{
              background: acc.iconBg,
              boxShadow: `0 4px 16px ${acc.iconGlow}, 0 1px 0 rgba(255,255,255,0.22) inset`,
            }}
          >
            {icon}
          </div>
        </div>

        {count !== null && !error && children ? <div className="mt-auto">{children}</div> : null}

        {href && count !== null && !error ? (
          <div
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: acc.bar }}
          >
            View details <ArrowUpRight className="h-3 w-3" />
          </div>
        ) : null}
      </div>
    </m.button>
  );
}

/* ============================================================================
   Micro helpers
============================================================================ */

function MicroList({
  items,
  tone,
  labelKey = "title",
  subKey,
  ageKey,
}: {
  items: any[];
  tone: ToneKey;
  labelKey?: string;
  subKey?: string;
  ageKey?: string;
}) {
  const acc = TONES[tone];
  if (!items.length) return null;

  return (
    <div className="mt-3 space-y-1.5 border-t border-slate-100/80 pt-3">
      {items.slice(0, 3).map((it, i) => {
        const label = safeStr(
          it?.[labelKey] ||
            it?.title ||
            it?.name ||
            it?.label ||
            it?.project_title ||
            it?.project_name ||
            "---"
        );
        const sub = subKey ? safeStr(it?.[subKey]) : "";
        const age = ageKey ? timeAgo(safeStr(it?.[ageKey])) : ageFromItem(it);

        return (
          <m.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="flex items-center gap-2.5 rounded-xl border border-slate-100/70 bg-white/52 px-2.5 py-2 transition-all hover:bg-white/80"
            style={{
              backdropFilter: "blur(8px)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${acc.listDot}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-slate-800">{label}</div>
              {sub ? <div className="truncate text-[10px] text-slate-400">{sub}</div> : null}
            </div>
            {age ? (
              <div
                className="shrink-0 text-[10px] font-medium text-slate-400"
                style={{ fontFamily: "var(--mono)" }}
              >
                {age}
              </div>
            ) : null}
          </m.div>
        );
      })}
    </div>
  );
}

function SeverityBar({ items }: { items: any[] }) {
  if (!items.length) return null;

  const high = items.filter((it) =>
    /high|critical|red|r/.test(safeLower(it?.severity || it?.level || it?.rag || ""))
  ).length;

  const medium = items.filter((it) =>
    /med|medium|amber|a|warn|at_risk/.test(
      safeLower(it?.severity || it?.level || it?.rag || "")
    )
  ).length;

  const low = items.length - high - medium;
  const total = items.length;

  return (
    <div className="mt-3 border-t border-slate-100/80 pt-3">
      <div className="mb-2 flex h-1.5 w-full overflow-hidden rounded-full bg-slate-100/80">
        {high > 0 ? (
          <m.div
            initial={{ width: 0 }}
            animate={{ width: `${(high / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="h-full rounded-l-full bg-rose-400"
            style={{ boxShadow: "0 0 6px rgba(244,63,94,0.35)" }}
          />
        ) : null}

        {medium > 0 ? (
          <m.div
            initial={{ width: 0 }}
            animate={{ width: `${(medium / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="h-full bg-amber-400"
          />
        ) : null}

        {low > 0 ? (
          <m.div
            initial={{ width: 0 }}
            animate={{ width: `${(low / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="h-full rounded-r-full bg-emerald-400"
          />
        ) : null}
      </div>

      <div className="flex items-center gap-3 text-[10px] font-semibold">
        {high > 0 ? <span className="text-rose-600">{high} critical</span> : null}
        {medium > 0 ? <span className="text-amber-600">{medium} medium</span> : null}
        {low > 0 ? <span className="text-emerald-600">{low} low</span> : null}
      </div>
    </div>
  );
}

/* ============================================================================
   Tile bodies
============================================================================ */

function SlaRadarBody({ items }: { items: any[] }) {
  const breached = items.filter(
    (it) =>
      it?.breached === true ||
      /breach|overdue|breached|r/.test(
        safeLower(it?.sla_status || it?.sla_state || it?.state || "")
      )
  ).length;

  const atRisk = items.filter(
    (it) =>
      it?.at_risk === true ||
      /warn|at_risk|a/.test(safeLower(it?.sla_status || it?.sla_state || it?.state || ""))
  ).length;

  return (
    <div>
      <div className="mt-3 flex items-center gap-2">
        {breached > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[10px] font-bold text-rose-700">
            <Flame className="h-3 w-3" /> {breached} breached
          </span>
        ) : null}

        {atRisk > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/70 bg-amber-50/80 px-2.5 py-1 text-[10px] font-bold text-amber-700">
            <Clock3 className="h-3 w-3" /> {atRisk} at risk
          </span>
        ) : null}

        {breached === 0 && atRisk === 0 && items.length > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
            <CheckCheck className="h-3 w-3" /> All within SLA
          </span>
        ) : null}
      </div>

      <MicroList items={items} tone="cyan" labelKey="title" subKey="project_name" />
    </div>
  );
}

function WhoBlockingBody({ items }: { items: any[] }) {
  const structured = items.some(
    (it) => typeof it?.count === "number" || typeof it?.pending_count === "number"
  );

  if (!structured) {
    return <MicroList items={items} tone="amber" labelKey="title" subKey="project_name" />;
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100/80 pt-3">
      {items.slice(0, 3).map((it, i) => {
        const name = resolvePersonLabel(it);
        const count = safeNum(it?.count || it?.pending_count);
        const maxWait = safeNum(it?.max_wait_days || it?.max_age_days || 0);

        return (
          <m.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="flex items-center justify-between gap-2 rounded-xl border border-slate-100/70 bg-white/52 px-3 py-2"
            style={{ backdropFilter: "blur(8px)" }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border border-amber-200/60 bg-amber-50/80">
                <Users className="h-3 w-3 text-amber-600" />
              </div>
              <span className="truncate text-xs font-semibold text-slate-800">{name}</span>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <span
                className="rounded-lg border border-amber-200/60 bg-amber-50/80 px-2 py-0.5 text-[10px] font-bold text-amber-700"
                style={{ fontFamily: "var(--mono)" }}
              >
                {count}
              </span>
              {maxWait > 0 ? (
                <span className="text-[10px] font-medium text-slate-400">{maxWait}d</span>
              ) : null}
            </div>
          </m.div>
        );
      })}
    </div>
  );
}

function RiskSignalsBody({ items }: { items: any[] }) {
  return (
    <div>
      <SeverityBar items={items} />
      <MicroList items={items} tone="rose" labelKey="title" subKey="project_name" />
    </div>
  );
}

function PortfolioApprovalsBody({ items }: { items: any[] }) {
  const byProject = new Map<string, { title: string; count: number }>();

  for (const it of items) {
    const pid = safeStr(it?.project_id || it?.project?.id || "unknown");
    const title = safeStr(
      it?.project_title ||
        it?.project_name ||
        it?.project?.title ||
        it?.change?.project_title ||
        pid
    );

    const existing = byProject.get(pid) || { title, count: 0 };
    existing.count += 1;
    byProject.set(pid, existing);
  }

  const projectList = Array.from(byProject.entries())
    .map(([pid, value]) => ({ pid, ...value }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="mt-3 space-y-1.5 border-t border-slate-100/80 pt-3">
      {projectList.slice(0, 3).map((p, i) => (
        <m.div
          key={p.pid}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 + i * 0.06 }}
          className="flex items-center justify-between gap-2 rounded-xl border border-slate-100/70 bg-white/52 px-2.5 py-2"
          style={{ backdropFilter: "blur(8px)" }}
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-indigo-400" />
            <span className="truncate text-xs font-semibold text-slate-800">{p.title}</span>
          </div>

          <span
            className="shrink-0 rounded-lg border border-indigo-200/60 bg-indigo-50/80 px-2 py-0.5 text-[10px] font-bold text-indigo-700"
            style={{ fontFamily: "var(--mono)" }}
          >
            {p.count}
          </span>
        </m.div>
      ))}
    </div>
  );
}

function BottlenecksBody({ items }: { items: any[] }) {
  const maxCount = items.length
    ? Math.max(...items.map((it) => safeNum(it?.pending_count || it?.count || 1)))
    : 1;

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100/80 pt-3">
      {items.slice(0, 3).map((it, i) => {
        const label = resolvePersonLabel(it);
        const count = safeNum(it?.pending_count || it?.count || 0);
        const widthPct = Math.max(8, (count / maxCount) * 100);

        return (
          <m.div
            key={i}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 + i * 0.06 }}
            className="relative overflow-hidden rounded-xl border border-slate-100/70 bg-white/52 px-3 py-2"
            style={{ backdropFilter: "blur(8px)" }}
          >
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${widthPct}%` }}
              transition={{ duration: 0.7, delay: 0.15 + i * 0.07 }}
              className="absolute left-0 top-0 bottom-0 rounded-l-xl bg-slate-600 opacity-[0.08]"
            />

            <div className="relative flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <Layers className="h-3 w-3 shrink-0 text-slate-400" />
                <span className="truncate text-xs font-semibold text-slate-800">{label}</span>
              </div>
              <span
                className="shrink-0 text-[10px] font-bold text-slate-600"
                style={{ fontFamily: "var(--mono)" }}
              >
                {count}
              </span>
            </div>
          </m.div>
        );
      })}
    </div>
  );
}

function PendingApprovalsBody({ items }: { items: any[] }) {
  const overdue = items.filter((it) =>
    /breach|overdue|breached|r/.test(
      safeLower(it?.sla_status || it?.sla_state || it?.state || "")
    )
  ).length;

  return (
    <div>
      {overdue > 0 ? (
        <div className="mb-1 mt-3 flex items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[10px] font-bold text-rose-700">
            <Flame className="h-3 w-3" /> {overdue} SLA breach{overdue !== 1 ? "es" : ""}
          </span>
        </div>
      ) : null}

      <MicroList
        items={items}
        tone="emerald"
        labelKey="project_title"
        subKey="sla_status"
        ageKey="computed_at"
      />
    </div>
  );
}

/* ============================================================================
   Header
============================================================================ */

function CockpitHeader({
  loading,
  onRefresh,
  lastRefreshed,
  onAskAliena,
}: {
  loading: boolean;
  onRefresh: () => void;
  lastRefreshed: string;
  onAskAliena: () => void;
}) {
  const [label, setLabel] = React.useState("");

  React.useEffect(() => {
    function tick() {
      setLabel(lastRefreshed ? timeAgo(lastRefreshed) : "");
    }

    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, [lastRefreshed]);

  return (
    <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="mb-2 flex items-center gap-3">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
            style={{
              background: "linear-gradient(135deg,#6366f1,#4f46e5)",
              boxShadow:
                "0 4px 16px rgba(99,102,241,0.38), 0 1px 0 rgba(255,255,255,0.22) inset",
            }}
          >
            <BarChart2 className="h-5 w-5" />
          </div>

          <div>
            <div className="mb-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-indigo-600">
              Live Signals
            </div>
            <h2 className="text-lg font-bold leading-tight text-slate-950">
              Executive Cockpit
            </h2>
          </div>
        </div>

        <p className="text-sm font-medium text-slate-400">Governance signals</p>
      </div>

      <div className="flex items-center gap-3">
        <AIAssistantAvatar
          label="Ask ΛLIΞNΛ — executive actions"
          onClick={onAskAliena}
        />

        {label ? (
          <div className="flex items-center gap-1.5 text-[10px] font-medium text-slate-400">
            <RefreshCw className="h-3 w-3 opacity-60" /> Updated {label}
          </div>
        ) : null}

        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/72 px-4 py-2.5 text-sm text-slate-600 transition-all hover:bg-white/92 hover:text-slate-900 disabled:opacity-50"
          style={{
            backdropFilter: "blur(10px)",
            boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
          }}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
    </div>
  );
}

/* ============================================================================
   Main
============================================================================ */

export default function ExecutiveCockpitClient({
  orgId: _orgId,
  memberProjectIds = [],
  isAdmin = false,
}: {
  orgId?: string;
  memberProjectIds?: string[];
  isAdmin?: boolean;
} = {}) {
  const router = useRouter();

  const [loading, setLoading] = React.useState(true);
  const [lastRefreshed, setLastRefreshed] = React.useState("");

  const [brain, setBrain] = React.useState<BrainResp | null>(null);
  const [pendingApprovals, setPendingApprovals] = React.useState<Payload | null>(null);
  const [whoBlocking, setWhoBlocking] = React.useState<Payload | null>(null);
  const [slaRadar, setSlaRadar] = React.useState<Payload | null>(null);
  const [riskSignals, setRiskSignals] = React.useState<Payload | null>(null);
  const [portfolioApprovals, setPortfolioApprovals] = React.useState<Payload | null>(null);
  const [bottlenecks, setBottlenecks] = React.useState<Payload | null>(null);
  const [fatalError, setFatalError] = React.useState<string | null>(null);

  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerTitle, setDrawerTitle] = React.useState("");
  const [drawerSubtitle, setDrawerSubtitle] = React.useState<string | undefined>(undefined);
  const [drawerTone, setDrawerTone] = React.useState<ToneKey>("indigo");
  const [drawerItems, setDrawerItems] = React.useState<any[]>([]);
  const [drawerHref, setDrawerHref] = React.useState("/approvals");

  const openDrawer = React.useCallback(
    (args: {
      title: string;
      subtitle?: string;
      tone: ToneKey;
      items: any[];
      href: string;
    }) => {
      setDrawerTitle(args.title);
      setDrawerSubtitle(args.subtitle);
      setDrawerTone(args.tone);
      setDrawerItems(Array.isArray(args.items) ? args.items : []);
      setDrawerHref(args.href || "/approvals");
      setDrawerOpen(true);
    },
    []
  );

  const openAskAliena = React.useCallback(() => {
    const curated = [
      {
        kind: "ask",
        title: "Ask: What is blocking delivery?",
        project_name: "Approvals bottlenecks",
        href: "/approvals/bottlenecks",
        meta: {},
      },
      {
        kind: "ask",
        title: "Ask: Which approvals are overdue?",
        project_name: "Approvals centre",
        href: "/approvals",
        meta: {},
      },
      {
        kind: "ask",
        title: "Ask: What risks need exec attention?",
        project_name: "Risk signals",
        href: "/approvals",
        meta: {},
      },
      {
        kind: "ask",
        title: "Open Governance Hub",
        project_name: "Knowledge base + Ask",
        href: "/governance?ask=help",
        meta: {},
      },
    ];

    openDrawer({
      title: "Ask ΛLIΞNΛ",
      subtitle: "Executive actions, insights and deep links",
      tone: "cyan",
      items: curated,
      href: "/governance?ask=help",
    });
  }, [openDrawer]);

  const load = React.useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setFatalError(null);

    setBrain(null);
    setPendingApprovals(null);
    setWhoBlocking(null);
    setSlaRadar(null);
    setRiskSignals(null);
    setPortfolioApprovals(null);
    setBottlenecks(null);

    try {
      let brainResp: BrainResp | null = null;

      try {
        brainResp = await fetchJson<BrainResp>("/api/ai/governance-brain", signal);
      } catch {
        brainResp = null;
      }

      setBrain(brainResp);

      const [paR, wbR, slaR, rsR, portR, bottR] = await Promise.allSettled([
        fetchJson<Payload>("/api/executive/approvals/pending?limit=200", signal),
        fetchJson<Payload>("/api/executive/approvals/who-blocking", signal),
        fetchJson<Payload>("/api/executive/approvals/sla-radar", signal),
        fetchJson<Payload>("/api/executive/risk-signals", signal),
        fetchJson<Payload>("/api/executive/approvals/portfolio", signal),
        fetchJson<Payload>("/api/executive/approvals/bottlenecks", signal),
      ]);

      const pa = settledOrErr(paR, "Failed to load pending approvals");
      const wb = settledOrErr(wbR, "Failed to load who-blocking");
      const sla = settledOrErr(slaR, "Failed to load SLA radar");
      const rs = settledOrErr(rsR, "Failed to load risk signals");
      const port = settledOrErr(portR, "Failed to load portfolio approvals");
      const bott = settledOrErr(bottR, "Failed to load bottlenecks");

      setPendingApprovals(pa as Payload);
      setWhoBlocking(wb as Payload);
      setSlaRadar(sla as Payload);
      setRiskSignals(rs as Payload);
      setPortfolioApprovals(port as Payload);
      setBottlenecks(bott as Payload);
      setLastRefreshed(new Date().toISOString());

      if (
        isErr(pa) &&
        isErr(wb) &&
        isErr(sla) &&
        isErr(rs) &&
        isErr(port) &&
        isErr(bott)
      ) {
        if (!brainResp || brainResp.ok !== true) {
          setFatalError("All cockpit endpoints failed. Check your API routes.");
        }
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setFatalError(e?.message ?? "Failed to load executive cockpit");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  const paItems = getPayloadItems(pendingApprovals, ["items", "pending"]);
  const wbItems = getPayloadItems(whoBlocking, ["items", "blockers"]);
  const slaItems = getPayloadItems(slaRadar, ["items", "breaches"]);
  const rsItems = getPayloadItems(riskSignals, ["items", "signals"]);
  const portItems = getPayloadItems(portfolioApprovals);
  const bottItems = getPayloadItems(bottlenecks);

  const org = firstOrg(brain);

  const brainPendingCount =
    org?.approvals?.unique_pending_items ?? org?.approvals?.total_pending_steps ?? null;

  const brainWhoBlocking = Array.isArray(org?.approvals?.top_blockers)
    ? org.approvals.top_blockers.map((b: any) => ({
        name: b.label,
        label: b.label,
        count: safeNum(b.count),
        pending_count: safeNum(b.count),
        max_wait_days: safeNum(b.oldest_days),
        kind: "approvals_bottleneck",
      }))
    : [];

  const brainSlaApprovalsBreached = org?.sla?.breached_by_type
    ? safeNum((org.sla.breached_by_type as any).approvals, 0)
    : null;

  const brainSlaBreachedTotal =
    brainSlaApprovalsBreached != null && brainSlaApprovalsBreached > 0
      ? brainSlaApprovalsBreached
      : org?.approvals?.overdue_steps != null
        ? safeNum(org.approvals.overdue_steps)
        : org?.sla?.breached_total != null
          ? safeNum(org.sla.breached_total)
          : null;

  const brainSlaSample = (() => {
    const byType = org?.sla?.breached_by_type ?? null;
    if (!byType) return [];

    return Object.entries(byType)
      .filter(([, v]) => safeNum(v) > 0)
      .sort((a, b) => safeNum(b[1]) - safeNum(a[1]))
      .slice(0, 10)
      .map(([k, v]) => ({
        title: k.replace(/_/g, " "),
        project_name: `${safeNum(v)} breach${safeNum(v) !== 1 ? "es" : ""}`,
        breached: true,
        kind: "sla",
      }));
  })();

  const brainPortfolioItems = Array.isArray(org?.health?.projects)
    ? org.health.projects.slice(0, 25).map((p: any) => ({
        project_id: p.project_id,
        project_title: p.project_title,
        project_name: p.project_title,
        stage_key: `Score ${safeNum(p.score)} · ${safeStr(p.rag)}`,
        meta: {
          project_id: p.project_id,
          project_code: p.project_code,
          project_human_id: p.project_code,
        },
        kind: "portfolio",
      }))
    : [];

  const brainRiskCount = (() => {
    const projects = Array.isArray(org?.health?.projects) ? org.health.projects : [];
    if (!projects.length) return null;

    let sum = 0;
    let saw = false;

    for (const p of projects) {
      const signals = p?.signals;
      if (!signals || typeof signals !== "object") continue;

      const highRaid = safeNum((signals as any).high_raid, 0);
      const overdueRaid = safeNum((signals as any).overdue_raid, 0);

      if (highRaid || overdueRaid) saw = true;
      sum += highRaid + overdueRaid;
    }

    return saw ? sum : null;
  })();

  const tiles: TileConfig[] = [
    {
      id: "pending",
      label: "Pending Approvals",
      short: "Pending",
      icon: <CheckCircle2 className="h-5 w-5" />,
      tone: "emerald",
      count: pickCount(pendingApprovals, brainPendingCount),
      error: getPayloadError(pendingApprovals),
      href: "/approvals",
      items: pickItems(paItems, brainPortfolioItems),
      body: paItems.length ? (
        <PendingApprovalsBody items={paItems} />
      ) : brainPortfolioItems.length ? (
        <MicroList
          items={brainPortfolioItems}
          tone="emerald"
          labelKey="project_title"
          subKey="stage_key"
        />
      ) : null,
    },
    {
      id: "blocking",
      label: "Who's Blocking",
      short: "Blocking",
      icon: <Users className="h-5 w-5" />,
      tone: "amber",
      count: pickCount(whoBlocking, brainWhoBlocking.length ? brainWhoBlocking.length : null),
      error: getPayloadError(whoBlocking),
      href: "/approvals/bottlenecks",
      items: pickItems(wbItems, brainWhoBlocking),
      body: wbItems.length ? (
        <WhoBlockingBody items={wbItems} />
      ) : brainWhoBlocking.length ? (
        <WhoBlockingBody items={brainWhoBlocking} />
      ) : null,
    },
    {
      id: "sla",
      label: "SLA Radar",
      short: "SLA",
      icon: <Clock3 className="h-5 w-5" />,
      tone: "cyan",
      count: pickCount(slaRadar, brainSlaBreachedTotal),
      error: getPayloadError(slaRadar),
      href: "/approvals",
      items: pickItems(slaItems, brainSlaSample),
      body: slaItems.length ? (
        <SlaRadarBody items={slaItems} />
      ) : brainSlaSample.length ? (
        <SlaRadarBody items={brainSlaSample} />
      ) : null,
    },
    {
      id: "risk",
      label: "Risk Signals",
      short: "Risks",
      icon: <AlertTriangle className="h-5 w-5" />,
      tone: "rose",
      count: pickCount(riskSignals, brainRiskCount),
      error: getPayloadError(riskSignals),
      href: "/approvals",
      items: pickItems(rsItems, []),
      body: rsItems.length ? <RiskSignalsBody items={rsItems} /> : null,
    },
    {
      id: "portfolio",
      label: "Portfolio Approvals",
      short: "Portfolio",
      icon: <Target className="h-5 w-5" />,
      tone: "indigo",
      count: pickCount(portfolioApprovals, org?.health?.projects?.length ?? null),
      error: getPayloadError(portfolioApprovals),
      href: "/approvals/portfolio",
      items: pickItems(portItems, brainPortfolioItems),
      body: portItems.length ? (
        <PortfolioApprovalsBody items={portItems} />
      ) : brainPortfolioItems.length ? (
        <PortfolioApprovalsBody items={brainPortfolioItems} />
      ) : null,
    },
    {
      id: "bottlenecks",
      label: "Bottlenecks",
      short: "Bottlenecks",
      icon: <Layers className="h-5 w-5" />,
      tone: "slate",
      count: pickCount(bottlenecks, brainWhoBlocking.length ? brainWhoBlocking.length : null),
      error: getPayloadError(bottlenecks),
      href: "/approvals/bottlenecks",
      items: pickItems(bottItems, brainWhoBlocking),
      body: bottItems.length ? (
        <BottlenecksBody items={bottItems} />
      ) : brainWhoBlocking.length ? (
        <BottlenecksBody items={brainWhoBlocking} />
      ) : null,
    },
  ];

  function onTileClick(tile: TileConfig) {
    if (tile.items.length) {
      openDrawer({
        title: tile.label,
        subtitle: undefined,
        tone: tile.tone,
        items: tile.items,
        href: tile.href,
      });
      return;
    }

    if (tile.href) router.push(tile.href);
  }

  return (
    <LazyMotion features={domAnimation}>
      <style>{portfolioGlobalCss()}</style>

      <div className={SURFACE.page}>
        <CockpitHeader
          loading={loading}
          onRefresh={() => load()}
          lastRefreshed={lastRefreshed}
          onAskAliena={openAskAliena}
        />

        <AnimatePresence>
          {fatalError ? (
            <m.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-6 flex items-start gap-3 rounded-2xl border border-rose-200/80 bg-rose-50/82 p-4"
              style={{ backdropFilter: "blur(10px)" }}
            >
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
              <div>
                <div className="mb-1 text-sm font-bold text-rose-800">Cockpit Error</div>
                <div className="text-sm text-rose-700">{fatalError}</div>
              </div>
            </m.div>
          ) : null}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => (
                <TileSkeleton key={i} delay={i * 0.055} />
              ))
            : tiles.map((tile, i) => (
                <CockpitTile
                  key={tile.id}
                  label={tile.label}
                  count={tile.count}
                  icon={tile.icon}
                  tone={tile.tone}
                  error={tile.error}
                  href={tile.href}
                  delay={i * 0.055}
                  onClick={() => onTileClick(tile)}
                >
                  {tile.body}
                </CockpitTile>
              ))}
        </div>

        {!loading && !fatalError ? (
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/62 px-5 py-4"
            style={{
              backdropFilter: "blur(14px)",
              boxShadow:
                "0 1px 4px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9) inset",
            }}
          >
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
              {tiles.map((tile) => (
                <div key={tile.id} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${TONES[tile.tone].listDot}`} />
                  <span className="font-semibold text-slate-800">{tile.count ?? "---"}</span>
                  <span className="text-[12px] font-medium">{tile.short}</span>
                </div>
              ))}
            </div>

            <a
              href="/approvals"
              className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-indigo-600 transition-colors hover:text-indigo-700"
            >
              Approvals Centre <ChevronRight className="h-3.5 w-3.5" />
            </a>
          </m.div>
        ) : null}

        <AnimatePresence>
          {drawerOpen ? (
            <Drawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              title={drawerTitle}
              subtitle={drawerSubtitle}
              tone={drawerTone}
              items={drawerItems}
              fallbackHref={drawerHref}
              memberProjectIds={memberProjectIds}
              isAdmin={isAdmin}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}