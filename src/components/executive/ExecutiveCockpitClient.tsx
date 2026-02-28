// src/components/executive/ExecutiveCockpitClient.tsx
// Rebuilt: signal-rich cockpit tiles with crystal design system.
// All tiles degrade gracefully to a count if structured data is not present.
//
// Fixes applied:
//   ✅ FIX-ECC1: URL paths corrected — three endpoints were missing /approvals/ prefix
//   ✅ FIX-ECC2: SlaRadarBody reads item.breached / item.at_risk (route returns booleans, not sla_state)
//   ✅ FIX-ECC3: PendingApprovalsBody reads sla_status || sla_state (cache column is sla_status)
//   ✅ FIX-ECC4: MicroList age derived from timestamps (submitted_at/created_at/computed_at/updated_at/etc.)
//   ✅ FIX-ECC5: Add Governance Brain as primary/fallback signal source (/api/ai/governance-brain)
//
// Additional hardening:
//   ✅ FIX-ECC6: Brain SLA tile prefers approvals overdue_steps / breached_by_type.approvals over total breached_total
//   ✅ FIX-ECC7: Brain risk fallback uses health.projects[].signals (raid_high/raid_overdue) when available
//   ✅ FIX-ECC8: Stable footer labels (avoid split(" ").pop() weirdness)
//   ✅ FIX-ECC9: Align list rendering keys with API payloads (project_name vs project_title, etc.)
//   ✅ FIX-ECC10: WhoBlockingBody renders task-style rows correctly (title/project_name) when not aggregated
//   ✅ FIX-ECC11: Tiles clickable → opens a governance drawer with top items + deep links (bestHref resolver)
//
// NEW fixes requested:
//   ✅ FIX-ECC12: Never show UUIDs (user:uuid) — resolve person label to name/email only
//   ✅ FIX-ECC13: Risk signal “corrupted HTML” hardened — detect HTML responses and show clean error
//   ✅ FIX-ECC14: Remove “Scope: ORG” labels (tile + drawer)

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
} from "lucide-react";
import { LazyMotion, domAnimation, m, AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";

// --- TYPES --------------------------------------------------------------------

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

function firstOrg(brain: BrainResp | null) {
  const org = brain?.orgs && Array.isArray(brain.orgs) ? brain.orgs[0] : null;
  return org;
}

function isErr(x: any): x is ApiErr {
  return !!x && typeof x === "object" && typeof x.error === "string";
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function safeNum(x: any, fb = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fb;
}
function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: any) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isHtmlLike(text: string, contentType?: string | null) {
  const t = (text || "").trim().toLowerCase();
  if ((contentType || "").toLowerCase().includes("text/html")) return true;
  if (t.startsWith("<!doctype html") || t.startsWith("<html") || t.includes("<head") || t.includes("<body"))
    return true;
  return false;
}

function stripHtml(s: string) {
  const raw = safeStr(s);
  if (!raw) return "";
  // remove tags + collapse whitespace
  return raw
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
  // if it was HTML-ish and stripping nuked meaning, fall back:
  if (!cleaned || cleaned.length < 3) return "Request failed";
  // keep it short (avoid dumping pages into UI)
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

  // ✅ FIX-ECC13: detect HTML responses early (common when route 404s or throws)
  if (isHtmlLike(text, contentType)) {
    if (!res.ok) throw new Error(`Endpoint error (${res.status})`);
    throw new Error("Invalid response (expected JSON)");
  }

  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // Non-HTML but still not JSON
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
  if (r.status === "fulfilled") return r.value as any;
  return errPayload((r.reason?.message || String(r.reason)) || fallbackMsg);
}

function extractList(payload: any, preferredKeys: string[] = ["items"]): any[] {
  if (!payload || typeof payload !== "object") return [];
  for (const k of preferredKeys) {
    const v = (payload as any)[k];
    if (Array.isArray(v)) return v;
  }
  const candidates = ["items", "pending", "rows", "blockers", "breaches", "signals"];
  for (const k of candidates) {
    const v = (payload as any)[k];
    if (Array.isArray(v)) return v;
  }
  const data = (payload as any).data;
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    for (const k of preferredKeys) {
      const v = (data as any)[k];
      if (Array.isArray(v)) return v;
    }
    for (const k of candidates) {
      const v = (data as any)[k];
      if (Array.isArray(v)) return v;
    }
  }
  return [];
}

// ✅ FIX-ECC12: resolve person labels safely (never show UUIDs / "user:<uuid>")
function extractUserIdFromUserTag(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "";
  if (s.toLowerCase().startsWith("user:")) return s.slice(5).trim();
  return "";
}

function resolvePersonLabel(it: any): string {
  // Prefer explicit human-friendly fields first
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

  // If primary candidate is a uuid / user:uuid, try other candidates
  for (const c of candidates) {
    const uid = extractUserIdFromUserTag(c);
    if (uid && looksLikeUuid(uid)) continue;
    if (looksLikeUuid(c)) continue;
    if (c.toLowerCase().startsWith("user:")) {
      // non-uuid user tag (rare) → still avoid; continue searching
      continue;
    }
    return c;
  }

  // If no good label, but we have an email somewhere, show it
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

// ✅ FIX-ECC4: derive display age from a wider set of timestamp fields
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
  const raw = safeStr(href).trim();
  if (!raw) return "";
  return raw
    .replace(/\/RAID(\/|$)/g, "/raid$1")
    .replace(/\/WBS(\/|$)/g, "/wbs$1")
    .replace(/\/SCHEDULE(\/|$)/g, "/schedule$1")
    .replace(/\/CHANGE(\/|$)/g, "/change$1")
    .replace(/\/CHANGES(\/|$)/g, "/change$1")
    .replace(/\/CHANGE_REQUESTS(\/|$)/g, "/change$1")
    .replace(/\/ARTIFACTS(\/|$)/g, "/artifacts$1");
}

function extractProjectRefFromHref(href: string): string | null {
  const h = safeStr(href).trim();
  const m = h.match(/\/projects\/([^\/?#]+)/i);
  return m?.[1] ? String(m[1]) : null;
}

/**
 * ✅ Best-effort deep link resolver for drawer items.
 */
function bestHref(item: any, fallbackHref: string): string {
  const rawLink = safeStr(item?.link || item?.href || "").trim();
  const normalized = rawLink ? normalizeHref(rawLink) : "";
  if (normalized.startsWith("/")) return normalized;

  const meta = item?.meta ?? {};
  const projectRef =
    safeStr(meta?.project_human_id).trim() ||
    safeStr(meta?.project_code).trim() ||
    safeStr(item?.project_code).trim() ||
    safeStr(item?.project_name).trim() ||
    extractProjectRefFromHref(normalized) ||
    "";

  const kind = safeLower(item?.itemType || item?.kind || item?.type || "");

  const artifactId = safeStr(
    meta?.sourceArtifactId ||
      meta?.artifactId ||
      item?.artifact_id ||
      item?.artifactId ||
      ""
  ).trim();

  if (projectRef && artifactId && looksLikeUuid(artifactId)) {
    return `/projects/${projectRef}/artifacts/${artifactId}`;
  }

  if (projectRef) {
    if (kind.includes("milestone") || kind.includes("schedule")) return `/projects/${projectRef}/schedule`;
    if (kind.includes("work_item") || kind.includes("work item") || kind.includes("wbs"))
      return `/projects/${projectRef}/wbs`;
    if (kind.includes("raid") || kind.includes("risk") || kind.includes("issue") || kind.includes("dependency"))
      return `/projects/${projectRef}/raid`;
    if (kind.includes("change")) return `/projects/${projectRef}/change`;
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

// --- DESIGN SYSTEM -----------------------------------------------------------

type ToneKey = "indigo" | "amber" | "emerald" | "rose" | "cyan" | "slate";

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

// --- SKELETON -----------------------------------------------------------------

function TileSkeleton({ delay = 0 }: { delay?: number }) {
  return (
    <m.div
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="rounded-2xl border border-slate-100 bg-white/70 p-5 min-h-[168px] animate-pulse"
      style={{ backdropFilter: "blur(14px)" }}
    >
      <div className="flex items-start gap-3 mb-4">
        <div className="h-10 w-10 rounded-xl bg-slate-200/80 shrink-0" />
        <div className="flex-1 space-y-2 pt-1">
          <div className="h-3 bg-slate-200/80 rounded w-1/3" />
          <div className="h-8 bg-slate-100/80 rounded w-1/2" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="h-2.5 bg-slate-100/70 rounded w-full" />
        <div className="h-2.5 bg-slate-100/70 rounded w-4/5" />
        <div className="h-2.5 bg-slate-100/70 rounded w-3/5" />
      </div>
    </m.div>
  );
}

// --- DRAWER -------------------------------------------------------------------

function Drawer({
  open,
  onClose,
  title,
  subtitle,
  tone,
  items,
  fallbackHref,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  tone: ToneKey;
  items: any[];
  fallbackHref: string;
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

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <m.div
        initial={{ x: 520, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 520, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[520px] h-full bg-white/85 border-l border-slate-200/70 flex flex-col"
        style={{
          backdropFilter: "blur(18px) saturate(1.6)",
          boxShadow: "0 24px 80px rgba(0,0,0,0.15)",
        }}
      >
        <div className="px-5 py-4 border-b border-slate-200/70 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
              Governance Brain
            </div>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              <span className="text-[15px] font-bold text-slate-950 truncate">{title}</span>
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: acc.bar, boxShadow: `0 0 10px ${acc.glow}` }}
              />
            </div>
            {subtitle && (
              <div className="mt-1 text-[12px] text-slate-500 font-medium truncate">{subtitle}</div>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4 text-slate-600" />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-5">
          {!items.length ? (
            <div className="text-center py-10 text-sm text-slate-500">No items available</div>
          ) : (
            <div className="space-y-2.5">
              {items.slice(0, 25).map((it, idx) => {
                const label =
                  safeStr(it?.title) ||
                  safeStr(it?.name) ||
                  safeStr(it?.label) ||
                  safeStr(it?.project_title) ||
                  safeStr(it?.project_name) ||
                  "---";

                const sub =
                  safeStr(it?.project_name) ||
                  safeStr(it?.project_title) ||
                  safeStr(it?.sla_status || it?.sla_state || it?.state) ||
                  safeStr(it?.type) ||
                  safeStr(it?.itemType) ||
                  "";

                const due = safeStr(it?.dueDate || it?.due_date || "");
                const age = ageFromItem(it);
                const href = bestHref(it, fallbackHref);

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
                        <div className="text-[13px] font-semibold text-slate-900 truncate">{label}</div>
                        {(sub || due) && (
                          <div className="mt-1 text-[11px] text-slate-500 font-medium truncate">
                            {sub}
                            {sub && due ? " • " : ""}
                            {due ? `Due ${fmtUkDateOnly(due)}` : ""}
                          </div>
                        )}
                      </div>
                      {age && (
                        <div
                          className="shrink-0 text-[10px] text-slate-400 font-semibold"
                          style={{ fontFamily: "var(--font-mono, monospace)" }}
                        >
                          {age}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 flex items-center gap-2">
                      <a
                        href={href}
                        className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200/80 bg-white/80 px-3 py-2 text-[11px] font-bold text-slate-700 hover:bg-white transition-colors"
                      >
                        Open <ArrowUpRight className="h-3.5 w-3.5" />
                      </a>
                      <button
                        type="button"
                        onClick={() => {
                          const txt = `${label}${due ? ` — due ${fmtUkDateOnly(due)}` : ""}`;
                          navigator.clipboard?.writeText(txt);
                        }}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3 py-2 text-[11px] font-bold text-white hover:bg-indigo-700 transition-colors"
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

        <div className="p-5 border-t border-slate-200/70">
          <a
            href={fallbackHref}
            className="w-full inline-flex items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white/70 px-4 py-3 text-[12px] font-bold text-slate-700 hover:bg-white transition-colors"
            style={{ backdropFilter: "blur(10px)" }}
          >
            View full list <ChevronRight className="h-4 w-4" />
          </a>
        </div>
      </m.div>
    </div>
  );
}

// --- COCKPIT TILE -------------------------------------------------------------

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
  const hasData = count !== null && !error;

  return (
    <m.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-2xl min-h-[168px] flex flex-col text-left w-full"
      style={{
        background:
          "linear-gradient(145deg, rgba(255,255,255,0.99) 0%, rgba(250,252,255,0.97) 50%, rgba(248,250,255,0.96) 100%)",
        border: "1px solid rgba(255,255,255,0.96)",
        boxShadow: `0 1px 1px rgba(0,0,0,0.02), 0 4px 12px rgba(0,0,0,0.04), 0 16px 44px ${acc.glow}, 0 44px 88px ${acc.tint}, 0 0 0 1px rgba(226,232,240,0.75), 0 1px 0 rgba(255,255,255,1) inset`,
        backdropFilter: "blur(28px) saturate(1.9)",
      }}
    >
      <div
        className="absolute inset-0 rounded-2xl pointer-events-none"
        style={{
          background: "linear-gradient(135deg, rgba(255,255,255,0.68) 0%, transparent 62%)",
        }}
      />
      <div
        className="absolute top-0 inset-x-0 h-[1px] rounded-t-2xl"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(255,255,255,1) 20%, rgba(255,255,255,1) 80%, transparent)",
        }}
      />
      <div
        className="absolute top-0 inset-x-0 h-24 rounded-t-2xl pointer-events-none"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, transparent 100%)",
        }}
      />
      <div
        className="absolute -bottom-12 -right-12 w-40 h-40 rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(ellipse, ${acc.orb} 0%, transparent 65%)`,
          filter: "blur(2px)",
        }}
      />
      <div
        className="absolute left-0 top-5 bottom-5 w-[3px] rounded-r-full"
        style={{ background: acc.bar, boxShadow: `0 0 14px ${acc.glow}` }}
      />

      <div className="relative pl-4 p-5 flex flex-col h-full">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.18em] mb-2">{label}</p>
            {error ? (
              <div className="rounded-xl border border-rose-200/70 bg-rose-50/70 px-3 py-2 text-xs text-rose-700 mt-1">
                <AlertTriangle className="inline h-3.5 w-3.5 mr-1.5 -mt-0.5" />
                {cleanErrorMessage(error)}
              </div>
            ) : (
              <div className="flex items-end gap-3">
                <p
                  className="text-[38px] font-bold text-slate-950 leading-none tracking-tight"
                  style={{
                    fontFamily: "var(--font-mono, 'DM Mono', monospace)",
                    letterSpacing: "-0.025em",
                  }}
                >
                  {count === null ? (
                    <span className="inline-flex gap-1 items-center pb-2">
                      {[0, 120, 240].map((d) => (
                        <span
                          key={d}
                          className="h-1.5 w-1.5 rounded-full bg-slate-300 animate-bounce"
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
            className="shrink-0 flex items-center justify-center w-11 h-11 rounded-xl text-white"
            style={{
              background: acc.iconBg,
              boxShadow: `0 4px 16px ${acc.iconGlow}, 0 1px 0 rgba(255,255,255,0.22) inset`,
            }}
          >
            {icon}
          </div>
        </div>

        {hasData && children && <div className="mt-auto">{children}</div>}

        {href && hasData && (
          <div
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: acc.bar }}
          >
            View details
            <ArrowUpRight className="h-3 w-3" />
          </div>
        )}
      </div>
    </m.button>
  );
}

// --- MICRO LIST ---------------------------------------------------------------

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
    <div className="space-y-1.5 mt-3 pt-3 border-t border-slate-100/80">
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
            className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 bg-white/52 border border-slate-100/70 hover:bg-white/80 transition-all"
            style={{
              backdropFilter: "blur(8px)",
              boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
            }}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${acc.listDot}`} />
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-800 truncate">{label}</div>
              {sub && <div className="text-[10px] text-slate-400 truncate">{sub}</div>}
            </div>
            {age && (
              <div
                className="shrink-0 text-[10px] text-slate-400 font-medium"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
              >
                {age}
              </div>
            )}
          </m.div>
        );
      })}
    </div>
  );
}

// --- SEVERITY BAR -------------------------------------------------------------

function SeverityBar({ items }: { items: any[] }) {
  if (!items.length) return null;
  const high = items.filter((it) =>
    /high|critical|red|r/.test(safeStr(it?.severity || it?.level || it?.rag || "").toLowerCase())
  ).length;
  const medium = items.filter((it) =>
    /med|medium|amber|a|warn|at_risk/.test(safeStr(it?.severity || it?.level || it?.rag || "").toLowerCase())
  ).length;
  const low = items.length - high - medium;
  const total = items.length;

  return (
    <div className="mt-3 pt-3 border-t border-slate-100/80">
      <div className="h-1.5 w-full rounded-full overflow-hidden flex bg-slate-100/80 mb-2">
        {high > 0 && (
          <m.div
            initial={{ width: 0 }}
            animate={{ width: `${(high / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="h-full bg-rose-400 rounded-l-full"
            style={{ boxShadow: "0 0 6px rgba(244,63,94,0.35)" }}
          />
        )}
        {medium > 0 && (
          <m.div
            initial={{ width: 0 }}
            animate={{ width: `${(medium / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.3 }}
            className="h-full bg-amber-400"
          />
        )}
        {low > 0 && (
          <m.div
            initial={{ width: 0 }}
            animate={{ width: `${(low / total) * 100}%` }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="h-full bg-emerald-400 rounded-r-full"
          />
        )}
      </div>
      <div className="flex items-center gap-3 text-[10px] font-semibold">
        {high > 0 && <span className="text-rose-600">{high} critical</span>}
        {medium > 0 && <span className="text-amber-600">{medium} medium</span>}
        {low > 0 && <span className="text-emerald-600">{low} low</span>}
      </div>
    </div>
  );
}

// --- TILE BODIES --------------------------------------------------------------

function SlaRadarBody({ items }: { items: any[] }) {
  const breached = items.filter(
    (it) =>
      it?.breached === true ||
      /breach|overdue|breached|r/.test(safeStr(it?.sla_status || it?.sla_state || it?.state || "").toLowerCase())
  ).length;

  const atRisk = items.filter(
    (it) =>
      it?.at_risk === true ||
      /warn|at_risk|a/.test(safeStr(it?.sla_status || it?.sla_state || it?.state || "").toLowerCase())
  ).length;

  return (
    <div>
      <div className="flex items-center gap-2 mt-3">
        {breached > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[10px] font-bold text-rose-700">
            <Flame className="h-3 w-3" />
            {breached} breached
          </span>
        )}
        {atRisk > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-amber-200/70 bg-amber-50/80 px-2.5 py-1 text-[10px] font-bold text-amber-700">
            <Clock3 className="h-3 w-3" />
            {atRisk} at risk
          </span>
        )}
        {breached === 0 && atRisk === 0 && items.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200/70 bg-emerald-50/80 px-2.5 py-1 text-[10px] font-bold text-emerald-700">
            <CheckCheck className="h-3 w-3" />
            All within SLA
          </span>
        )}
      </div>

      <MicroList items={items} tone="cyan" labelKey="title" subKey="project_name" />
    </div>
  );
}

function WhoBlockingBody({ items }: { items: any[] }) {
  const structured = items.some((it) => typeof it?.count === "number" || typeof it?.pending_count === "number");

  if (structured) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100/80 space-y-2">
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
              className="flex items-center justify-between gap-2 rounded-xl px-3 py-2 bg-white/52 border border-slate-100/70"
              style={{ backdropFilter: "blur(8px)" }}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div className="h-6 w-6 rounded-lg bg-amber-50/80 border border-amber-200/60 flex items-center justify-center shrink-0">
                  <Users className="h-3 w-3 text-amber-600" />
                </div>
                <span className="text-xs font-semibold text-slate-800 truncate">{name}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className="text-[10px] font-bold text-amber-700 bg-amber-50/80 border border-amber-200/60 rounded-lg px-2 py-0.5"
                  style={{ fontFamily: "var(--font-mono, monospace)" }}
                >
                  {count}
                </span>
                {maxWait > 0 && <span className="text-[10px] text-slate-400 font-medium">{maxWait}d</span>}
              </div>
            </m.div>
          );
        })}
      </div>
    );
  }

  return <MicroList items={items} tone="amber" labelKey="title" subKey="project_name" />;
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
    const title = safeStr(it?.project_title || it?.project_name || it?.project?.title || it?.change?.project_title || pid);
    const p = byProject.get(pid) || { title, count: 0 };
    p.count++;
    byProject.set(pid, p);
  }
  const projectList = Array.from(byProject.entries())
    .map(([pid, p]) => ({ pid, ...p }))
    .sort((a, b) => b.count - a.count);

  return (
    <div className="mt-3 pt-3 border-t border-slate-100/80 space-y-1.5">
      {projectList.slice(0, 3).map((p, i) => (
        <m.div
          key={p.pid}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 + i * 0.06 }}
          className="flex items-center justify-between gap-2 rounded-xl px-2.5 py-2 bg-white/52 border border-slate-100/70"
          style={{ backdropFilter: "blur(8px)" }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-400 shrink-0" />
            <span className="text-xs font-semibold text-slate-800 truncate">{p.title}</span>
          </div>
          <span
            className="shrink-0 text-[10px] font-bold text-indigo-700 bg-indigo-50/80 border border-indigo-200/60 rounded-lg px-2 py-0.5"
            style={{ fontFamily: "var(--font-mono, monospace)" }}
          >
            {p.count}
          </span>
        </m.div>
      ))}
    </div>
  );
}

function BottlenecksBody({ items }: { items: any[] }) {
  const maxCount = items.length ? Math.max(...items.map((it) => safeNum(it?.pending_count || it?.count || 1))) : 1;
  return (
    <div className="mt-3 pt-3 border-t border-slate-100/80 space-y-2">
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
            className="relative overflow-hidden rounded-xl px-3 py-2 border border-slate-100/70 bg-white/52"
            style={{ backdropFilter: "blur(8px)" }}
          >
            <m.div
              initial={{ width: 0 }}
              animate={{ width: `${widthPct}%` }}
              transition={{ duration: 0.7, delay: 0.15 + i * 0.07 }}
              className="absolute left-0 top-0 bottom-0 rounded-l-xl opacity-[0.08] bg-slate-600"
            />
            <div className="relative flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Layers className="h-3 w-3 text-slate-400 shrink-0" />
                <span className="text-xs font-semibold text-slate-800 truncate">{label}</span>
              </div>
              <span
                className="shrink-0 text-[10px] font-bold text-slate-600"
                style={{ fontFamily: "var(--font-mono, monospace)" }}
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
    /breach|overdue|breached|r/.test(safeStr(it?.sla_status || it?.sla_state || it?.state || "").toLowerCase())
  ).length;

  return (
    <div>
      {overdue > 0 && (
        <div className="flex items-center gap-2 mt-3 mb-1">
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/70 bg-rose-50/80 px-2.5 py-1 text-[10px] font-bold text-rose-700">
            <Flame className="h-3 w-3" />
            {overdue} SLA breach{overdue !== 1 ? "es" : ""}
          </span>
        </div>
      )}

      <MicroList items={items} tone="emerald" labelKey="project_title" subKey="sla_status" ageKey="computed_at" />
    </div>
  );
}

// --- HEADER -------------------------------------------------------------------

function CockpitHeader({
  loading,
  onRefresh,
  lastRefreshed,
}: {
  loading: boolean;
  onRefresh: () => void;
  lastRefreshed: string;
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
    <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div
            className="flex h-11 w-11 items-center justify-center rounded-xl text-white"
            style={{
              background: "linear-gradient(135deg,#6366f1,#4f46e5)",
              boxShadow: "0 4px 16px rgba(99,102,241,0.38), 0 1px 0 rgba(255,255,255,0.22) inset",
            }}
          >
            <BarChart2 className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] font-bold text-indigo-600 mb-0.5">Live Signals</div>
            <h2 className="text-lg font-bold text-slate-950 leading-tight">Executive Cockpit</h2>
          </div>
        </div>
        <p className="text-sm text-slate-400 font-medium">Governance signals</p>
      </div>

      <div className="flex items-center gap-3">
        {label && (
          <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-medium">
            <RefreshCw className="h-3 w-3 opacity-60" />
            Updated {label}
          </div>
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex items-center gap-2 rounded-xl border border-slate-200/80 bg-white/72 px-4 py-2.5 text-sm text-slate-600 hover:bg-white/92 hover:text-slate-900 transition-all disabled:opacity-50"
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

// --- MAIN EXPORT --------------------------------------------------------------

export default function ExecutiveCockpitClient(_props: { orgId?: string } = {}) {
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

  // Drawer state
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [drawerTitle, setDrawerTitle] = React.useState("");
  const [drawerSubtitle, setDrawerSubtitle] = React.useState<string | undefined>(undefined);
  const [drawerTone, setDrawerTone] = React.useState<ToneKey>("indigo");
  const [drawerItems, setDrawerItems] = React.useState<any[]>([]);
  const [drawerHref, setDrawerHref] = React.useState<string>("/approvals");

  const openDrawer = React.useCallback((args: {
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
  }, []);

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
        fetchJson<Payload>("/api/executive/approvals/risk-signals", signal),
        fetchJson<Payload>("/api/executive/approvals/portfolio", signal),
        fetchJson<Payload>("/api/executive/approvals/bottlenecks", signal),
      ]);

      const pa = settledOrErr(paR, "Failed to load pending approvals");
      const wb = settledOrErr(wbR, "Failed to load who-blocking");
      const sla = settledOrErr(slaR, "Failed to load SLA radar");
      const rs = settledOrErr(rsR, "Failed to load risk signals");
      const port = settledOrErr(portR, "Failed to load portfolio approvals");
      const bott = settledOrErr(bottR, "Failed to load bottlenecks");

      setPendingApprovals(pa as any);
      setWhoBlocking(wb as any);
      setSlaRadar(sla as any);
      setRiskSignals(rs as any);
      setPortfolioApprovals(port as any);
      setBottlenecks(bott as any);
      setLastRefreshed(new Date().toISOString());

      const allFailed = isErr(pa) && isErr(wb) && isErr(sla) && isErr(rs) && isErr(port) && isErr(bott);

      if (allFailed) {
        const okBrain = !!brainResp && (brainResp as any)?.ok === true;
        if (!okBrain) setFatalError("All cockpit endpoints failed. Check your API routes.");
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setFatalError(e?.message ?? "Failed to load executive cockpit");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    const ac = new AbortController();
    load(ac.signal);
    return () => ac.abort();
  }, [load]);

  function getCount(p: Payload | null): number | null {
    if (!p) return null;
    if (isErr(p)) return null;
    return extractList(p).length;
  }
  function getItems(p: Payload | null, keys?: string[]): any[] {
    if (!p || isErr(p)) return [];
    return extractList(p, keys);
  }
  function getError(p: Payload | null): string | null {
    if (p && isErr(p)) return (p as ApiErr).message ?? (p as ApiErr).error;
    return null;
  }

  const paItems = getItems(pendingApprovals, ["items", "pending"]);
  const wbItems = getItems(whoBlocking, ["items", "blockers"]);
  const slaItems = getItems(slaRadar, ["items", "breaches"]);
  const rsItems = getItems(riskSignals, ["items", "signals"]);
  const portItems = getItems(portfolioApprovals);
  const bottItems = getItems(bottlenecks);

  // --- Governance Brain fallbacks --------------------------------------------

  const org = firstOrg(brain);

  const brainPendingCount = org?.approvals?.unique_pending_items ?? org?.approvals?.total_pending_steps ?? null;

  const brainWhoBlocking = Array.isArray(org?.approvals?.top_blockers)
    ? org!.approvals!.top_blockers.map((b: any) => ({
        name: b.label, // already human label
        label: b.label,
        count: safeNum(b.count),
        pending_count: safeNum(b.count),
        max_wait_days: safeNum(b.oldest_days),
        kind: "approvals_bottleneck",
      }))
    : [];

  const brainSlaApprovalsBreached =
    org?.sla?.breached_by_type && typeof org.sla.breached_by_type === "object"
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
    const byType =
      org?.sla?.breached_by_type && typeof org.sla.breached_by_type === "object" ? org.sla.breached_by_type : null;
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
    ? org!.health!.projects.slice(0, 25).map((p: any) => ({
        project_id: p.project_id,
        project_title: p.project_title,
        project_name: p.project_title,
        stage_key: `Score ${safeNum(p.score)} · ${safeStr(p.rag)}`,
        meta: { project_id: p.project_id, project_code: p.project_code, project_human_id: p.project_code },
        kind: "portfolio",
      }))
    : [];

  const brainRiskCount = (() => {
    const ps = Array.isArray(org?.health?.projects) ? org!.health!.projects : [];
    if (!ps.length) return null;
    let sum = 0;
    let saw = false;
    for (const p of ps) {
      const s = p?.signals;
      if (!s || typeof s !== "object") continue;
      const a = safeNum((s as any).high_raid, 0);
      const b = safeNum((s as any).overdue_raid, 0);
      if (a || b) saw = true;
      sum += a + b;
    }
    return saw ? sum : null;
  })();

  const brainBottlenecks = brainWhoBlocking;

  // --- TILE MODEL -------------------------------------------------------------

  function pickCount(primary: Payload | null, fallback: number | null): number | null {
    const c = getCount(primary);
    return c != null ? c : fallback;
  }

  const tiles = [
    {
      id: "pending",
      label: "Pending Approvals",
      short: "Pending",
      icon: <CheckCircle2 className="h-5 w-5" />,
      tone: "emerald" as ToneKey,
      count: pickCount(pendingApprovals, brainPendingCount),
      error: getError(pendingApprovals),
      href: "/approvals",
      items: paItems.length ? paItems : [],
      fallbackItems: brainPortfolioItems,
      body: paItems.length ? (
        <PendingApprovalsBody items={paItems} />
      ) : brainPortfolioItems.length ? (
        <MicroList items={brainPortfolioItems} tone="emerald" labelKey="project_title" subKey="stage_key" />
      ) : null,
    },
    {
      id: "blocking",
      label: "Who's Blocking",
      short: "Blocking",
      icon: <Users className="h-5 w-5" />,
      tone: "amber" as ToneKey,
      count: pickCount(whoBlocking, brainWhoBlocking.length ? brainWhoBlocking.length : null),
      error: getError(whoBlocking),
      href: "/approvals/bottlenecks",
      items: wbItems.length ? wbItems : brainWhoBlocking,
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
      tone: "cyan" as ToneKey,
      count: pickCount(slaRadar, brainSlaBreachedTotal),
      error: getError(slaRadar),
      href: "/approvals",
      items: slaItems.length ? slaItems : brainSlaSample,
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
      tone: "rose" as ToneKey,
      count: pickCount(riskSignals, brainRiskCount),
      error: getError(riskSignals),
      href: "/approvals",
      items: rsItems,
      body: rsItems.length ? <RiskSignalsBody items={rsItems} /> : null,
    },
    {
      id: "portfolio",
      label: "Portfolio Approvals",
      short: "Portfolio",
      icon: <Target className="h-5 w-5" />,
      tone: "indigo" as ToneKey,
      count: pickCount(portfolioApprovals, org?.health?.projects?.length ? org!.health!.projects!.length : null),
      error: getError(portfolioApprovals),
      href: "/approvals/portfolio",
      items: portItems.length ? portItems : brainPortfolioItems,
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
      tone: "slate" as ToneKey,
      count: pickCount(bottlenecks, brainBottlenecks.length ? brainBottlenecks.length : null),
      error: getError(bottlenecks),
      href: "/approvals/bottlenecks",
      items: bottItems.length ? bottItems : brainBottlenecks,
      body: bottItems.length ? (
        <BottlenecksBody items={bottItems} />
      ) : brainBottlenecks.length ? (
        <BottlenecksBody items={brainBottlenecks} />
      ) : null,
    },
  ];

  function onTileClick(t: (typeof tiles)[number]) {
    const list = Array.isArray(t.items) ? t.items : [];
    const fallbackList =
      (t as any).fallbackItems && Array.isArray((t as any).fallbackItems) ? (t as any).fallbackItems : [];
    const use = list.length ? list : fallbackList;

    if (use.length) {
      openDrawer({
        title: t.label,
        subtitle: undefined, // ✅ FIX-ECC14: remove scope label entirely
        tone: t.tone,
        items: use,
        href: t.href,
      });
      return;
    }

    if (t.href) router.push(t.href);
  }

  return (
    <LazyMotion features={domAnimation}>
      <div className="w-full">
        <CockpitHeader loading={loading} onRefresh={() => load()} lastRefreshed={lastRefreshed} />

        <AnimatePresence>
          {fatalError && (
            <m.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="mb-6 rounded-2xl border border-rose-200/80 bg-rose-50/82 p-4 flex items-start gap-3"
              style={{ backdropFilter: "blur(10px)" }}
            >
              <AlertTriangle className="h-5 w-5 text-rose-600 mt-0.5 shrink-0" />
              <div>
                <div className="text-sm font-bold text-rose-800 mb-1">Cockpit Error</div>
                <div className="text-sm text-rose-700">{fatalError}</div>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {loading
            ? Array.from({ length: 6 }).map((_, i) => <TileSkeleton key={i} delay={i * 0.055} />)
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

        {!loading && !fatalError && (
          <m.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45 }}
            className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200/70 bg-white/62 px-5 py-4"
            style={{
              backdropFilter: "blur(14px)",
              boxShadow: "0 1px 4px rgba(0,0,0,0.04), 0 1px 0 rgba(255,255,255,0.9) inset",
            }}
          >
            <div className="flex flex-wrap items-center gap-4 text-sm text-slate-500">
              {tiles.map((t) => (
                <div key={t.id} className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${TONES[t.tone].listDot}`} />
                  <span className="font-semibold text-slate-800">{t.count ?? "---"}</span>
                  <span className="font-medium text-[12px]">{(t as any).short ?? t.label}</span>
                </div>
              ))}
            </div>
            <a
              href="/approvals"
              className="flex items-center gap-1.5 text-xs font-bold text-indigo-600 hover:text-indigo-700 transition-colors uppercase tracking-wider"
            >
              Approvals Centre <ChevronRight className="h-3.5 w-3.5" />
            </a>
          </m.div>
        )}

        <AnimatePresence>
          {drawerOpen && (
            <Drawer
              open={drawerOpen}
              onClose={() => setDrawerOpen(false)}
              title={drawerTitle}
              subtitle={drawerSubtitle}
              tone={drawerTone}
              items={drawerItems}
              fallbackHref={drawerHref}
            />
          )}
        </AnimatePresence>
      </div>
    </LazyMotion>
  );
}