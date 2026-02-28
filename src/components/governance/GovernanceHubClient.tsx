// src/components/governance/GovernanceHubClient.tsx
// Enterprise upgrade:
// ✅ Ask Aliena supports KB context injection via ?ask=help&article=<slug>
// ✅ "Ask about this" uses scope:"kb" + articleSlug
// ✅ Project scope continues to send scope + projectId
// ✅ Cards remain DB-driven with safe fallback
// ✅ NEW: Governance Brain snapshot (org-scoped signals) surfaced in hub header

"use client";

import React, { useMemo, useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Shield,
  Users,
  FileCheck,
  GitBranch,
  AlertTriangle,
  Sparkles,
  BarChart3,
  Search,
  ChevronRight,
  X,
  Loader2,
  AlertCircle,
  ExternalLink,
  MessageSquareText,
  Brain,
  Activity,
  Flame,
  Clock3,
} from "lucide-react";

type HubScope = "global" | "project";
type AdvisorScope = "global" | "project" | "kb";

type GovernanceArticleSummary = {
  id: string;
  slug: string;
  title: string;
  summary?: string | null;
  category?: string | null;
  category_name?: string | null;
  updated_at?: string | null;
  content?: unknown;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

function iconForSlug(slug: string) {
  const s = safeLower(slug);
  if (s === "delivery-governance-framework") return <Shield className="h-5 w-5" />;
  if (s === "roles-ownership") return <Users className="h-5 w-5" />;
  if (s === "approvals-decision-control") return <FileCheck className="h-5 w-5" />;
  if (s === "change-control") return <GitBranch className="h-5 w-5" />;
  if (s === "risk-raid-discipline") return <AlertTriangle className="h-5 w-5" />;
  if (s === "ai-assistance") return <Sparkles className="h-5 w-5" />;
  if (s === "executive-oversight") return <BarChart3 className="h-5 w-5" />;
  return <Shield className="h-5 w-5" />;
}

type Card = {
  key: string; // slug
  title: string;
  icon: React.ReactNode;
  summary: string;
  bullets: string[];
  ctas?: Array<{ label: string; href: (projectId: string) => string }>;
};

type AdvisorResult = {
  answer: string;
  confidence: number; // 0..1
  key_drivers: string[];
  blockers: Array<{
    kind:
      | "approval"
      | "risk"
      | "issue"
      | "assumption"
      | "dependency"
      | "change"
      | "milestone"
      | "task"
      | "artifact"
      | "unknown"
      | string;
    title: string;
    entity_id: string;
    age_days?: number;
    severity?: number;
    next_action: string;
  }>;
  today_actions: Array<{
    priority: 1 | 2 | 3 | 4 | 5 | number;
    action: string;
    owner_suggestion?: string;
    why: string;
  }>;
  recommended_routes: Array<{
    label: string;
    href: string;
  }>;
  data_requests: string[];
};

function fmtConfidence(x: any) {
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  const pct = Math.round(Math.max(0, Math.min(1, n)) * 100);
  return `${pct}%`;
}

function kindLabel(k: string) {
  const kk = safeLower(k);
  if (!kk) return "Item";
  if (kk === "approval") return "Approval";
  if (kk === "risk") return "Risk";
  if (kk === "issue") return "Issue";
  if (kk === "assumption") return "Assumption";
  if (kk === "dependency") return "Dependency";
  if (kk === "change") return "Change";
  if (kk === "milestone") return "Milestone";
  if (kk === "task") return "Task";
  if (kk === "artifact") return "Artifact";
  return kk.charAt(0).toUpperCase() + kk.slice(1);
}

// Try to extract bullets from JSON content {sections:[{bullets:[]}]}
function bulletsFromContent(content: unknown, max = 5): string[] {
  try {
    if (!content || typeof content !== "object") return [];
    const c: any = content;
    const secs = Array.isArray(c?.sections) ? c.sections : [];
    const all: string[] = [];
    for (const s of secs) {
      const bs = Array.isArray(s?.bullets) ? s.bullets : [];
      for (const b of bs) {
        const t = safeStr(b).trim();
        if (t) all.push(t);
        if (all.length >= max) return all.slice(0, max);
      }
    }
    return all.slice(0, max);
  } catch {
    return [];
  }
}

/* =======================
   Governance Brain (client types)
======================= */

type BrainScope = "active" | "all";

type GovernanceBrainResponse = {
  ok: boolean;
  scope: BrainScope;
  generated_at: string;
  config?: {
    approval_sla_days: number;
    change_sla_days: number;
    idle_days: number;
  };
  rollup?: {
    org_count: number;
    portfolio_score_avg: number;
    overdue_approvals: number;
    breached_total: number;
    blocked_projects: number;
  };
  orgs?: Array<{
    org_id: string;
    org_name?: string;
    approvals?: {
      overdue_steps: number;
      total_pending_steps: number;
      oldest_pending_days: number;
      top_blockers?: Array<{ label: string; count: number; overdue_count: number; oldest_days: number }>;
    };
    sla?: { breached_total: number; breached_by_type?: Record<string, number> };
    blockers?: { projects_blocked: number };
    health?: {
      portfolio_score: number;
      portfolio_rag: "G" | "A" | "R";
      projects?: Array<{
        project_id: string;
        project_code?: string;
        project_title: string;
        score: number;
        rag: "G" | "A" | "R";
        signals?: Record<string, any>;
      }>;
    };
    ai_summary?: string;
  }>;
  error?: string;
};

function ragPill(rag?: string) {
  const r = safeLower(rag);
  if (r === "g" || r === "green") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (r === "a" || r === "amber") return "border-amber-200 bg-amber-50 text-amber-800";
  if (r === "r" || r === "red") return "border-red-200 bg-red-50 text-red-800";
  return "border-neutral-200 bg-neutral-50 text-neutral-700";
}

export default function GovernanceHubClient({
  scope,
  projectId,
  articles,
}: {
  scope: HubScope;
  projectId?: string;
  articles?: GovernanceArticleSummary[];
}) {
  const params = useParams();
  const searchParams = useSearchParams();

  const pidFromParams = safeStr((params as any)?.id).trim();
  const pidProp = safeStr(projectId).trim();
  const pid = scope === "project" ? (pidProp || pidFromParams) : "";

  // URL deep-link: ?ask=help&article=<slug>
  const urlAsk = safeLower(searchParams?.get("ask"));
  const urlArticle = safeLower(searchParams?.get("article") || searchParams?.get("kb") || "");

  const [query, setQuery] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");
  const [kbArticleSlug, setKbArticleSlug] = useState<string>("");

  // Ask Aliena state
  const [askLoading, setAskLoading] = useState(false);
  const [askError, setAskError] = useState<string>("");
  const [askAnswer, setAskAnswer] = useState<string>("");
  const [askResult, setAskResult] = useState<AdvisorResult | null>(null);

  // Governance Brain state
  const [brainLoading, setBrainLoading] = useState(false);
  const [brainError, setBrainError] = useState<string>("");
  const [brain, setBrain] = useState<GovernanceBrainResponse | null>(null);

  // ✅ Keep in sync with URL (not just mount)
  useEffect(() => {
    const wantsAsk = urlAsk === "help" || urlAsk === "1" || urlAsk === "true";
    const slug = urlArticle ? clamp(urlArticle, 200) : "";
    if (wantsAsk) {
      if (slug) setKbArticleSlug(slug);
      setAskOpen(true);
      setAskError("");
    }
    // If URL removes ask flag, we do not auto-close (user may be mid-answer).
    // That keeps UX stable.
  }, [urlAsk, urlArticle]);

  const fallbackCards: Card[] = useMemo(
    () => [
      {
        key: "delivery-governance-framework",
        title: "Aliena Delivery Governance Framework™",
        icon: <Shield className="h-5 w-5" />,
        summary: "The operating model that makes delivery visible, controlled, auditable, and continuity-safe.",
        bullets: [
          "Pillar 1: Structured Ownership (no single point of failure)",
          "Pillar 2: Controlled Decision-Making (approvals + audit trail)",
          "Pillar 3: Transparent Change Control (cost/scope/schedule discipline)",
          "Pillar 4: Continuous Risk Intelligence (RAID discipline + escalation)",
          "Pillar 5: Executive Visibility & Confidence (portfolio truth in seconds)",
        ],
      },
      {
        key: "roles-ownership",
        title: "Roles & Ownership",
        icon: <Users className="h-5 w-5" />,
        summary: "Assign delivery roles correctly so projects remain resilient, secure, and board-safe.",
        bullets: [
          "Always maintain 2+ Owners (continuity best practice)",
          "Editors can update artifacts; Viewers are read-only",
          "Approvers must be members + included in the approval chain",
          "Use delegation / holiday cover for uninterrupted approvals",
        ],
        ctas: [{ label: "Go to project members", href: (p) => `/projects/${encodeURIComponent(p)}` }],
      },
      {
        key: "approvals-decision-control",
        title: "Approvals & Decision Control",
        icon: <FileCheck className="h-5 w-5" />,
        summary: "Sequential approval chains, delegation, SLA awareness, and a traceable decision history.",
        bullets: [
          "Draft → Submitted → In Review → Approved / Changes Requested / Rejected",
          "Add approvers in order (Reviewer → Commercial → Sponsor, etc.)",
          "Delegate during absences; prevent bottlenecks",
          "Decisions remain auditable (who/when/what)",
        ],
        ctas: [
          { label: "Open approvals inbox", href: (p) => `/projects/${encodeURIComponent(p)}/approvals/inbox` },
          { label: "Open approvals timeline", href: (p) => `/projects/${encodeURIComponent(p)}/approvals/timeline` },
        ],
      },
      {
        key: "change-control",
        title: "Change Control",
        icon: <GitBranch className="h-5 w-5" />,
        summary: "No hidden scope drift. All cost/scope/schedule changes must be raised and approved.",
        bullets: [
          "Raise change for cost, scope, schedule, or commercial impact",
          "Submit to the configured approval chain",
          "Link changes to delivery impact and actions",
          "Close changes with outcomes recorded",
        ],
        ctas: [{ label: "Open change board", href: (p) => `/projects/${encodeURIComponent(p)}/change` }],
      },
      {
        key: "risk-raid-discipline",
        title: "Risk & RAID Discipline",
        icon: <AlertTriangle className="h-5 w-5" />,
        summary: "Delivery risk is never invisible. RAID is the single source of operational truth.",
        bullets: [
          "Risk = potential future problem; Issue = active problem",
          "Assumptions & dependencies must be explicit and reviewed",
          "Update cadence: weekly minimum for active delivery",
          "Escalate high-severity items for executive visibility",
        ],
        ctas: [{ label: "Open RAID log", href: (p) => `/projects/${encodeURIComponent(p)}/raid` }],
      },
      {
        key: "ai-assistance",
        title: "AI Assistance",
        icon: <Sparkles className="h-5 w-5" />,
        summary: "AI supports governance (drafts + signals). Humans remain accountable for decisions.",
        bullets: [
          "AI drafts charters/reports; you approve and submit",
          "AI flags approval bottlenecks & delivery risk signals",
          "AI suggests RAID items and mitigations (review before applying)",
          "AI helps produce executive-ready summaries",
        ],
      },
      {
        key: "executive-oversight",
        title: "Executive Oversight",
        icon: <BarChart3 className="h-5 w-5" />,
        summary: "Boards want truth fast: portfolio health, financial exposure, bottlenecks, and risk signals.",
        bullets: [
          "Portfolio health (RAG) and trend direction",
          "Approval delays + SLA breach visibility",
          "Change pipeline value and exposure",
          "Top risks across projects + escalations",
        ],
      },
    ],
    []
  );

  const cards: Card[] = useMemo(() => {
    const list = Array.isArray(articles) ? articles : [];
    if (!list.length) return fallbackCards;

    const ctasBySlug: Record<string, Card["ctas"]> = {
      "roles-ownership": [{ label: "Go to project members", href: (p) => `/projects/${encodeURIComponent(p)}` }],
      "approvals-decision-control": [
        { label: "Open approvals inbox", href: (p) => `/projects/${encodeURIComponent(p)}/approvals/inbox` },
        { label: "Open approvals timeline", href: (p) => `/projects/${encodeURIComponent(p)}/approvals/timeline` },
      ],
      "change-control": [{ label: "Open change board", href: (p) => `/projects/${encodeURIComponent(p)}/change` }],
      "risk-raid-discipline": [{ label: "Open RAID log", href: (p) => `/projects/${encodeURIComponent(p)}/raid` }],
    };

    return list
      .filter((a) => safeStr(a.slug).trim())
      .map((a) => {
        const slug = safeStr(a.slug).trim();
        const title = safeStr(a.title).trim() || slug;
        const summary = safeStr(a.summary).trim();
        const bullets = bulletsFromContent(a.content, 5);

        return {
          key: slug,
          title,
          icon: iconForSlug(slug),
          summary: summary || "Governance guidance and operating standards.",
          bullets: bullets.length ? bullets : ["Open the article to view full guidance."],
          ctas: ctasBySlug[slug],
        };
      });
  }, [articles, fallbackCards]);

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return cards;
    return cards.filter((c) => {
      const blob = `${c.title}\n${c.summary}\n${c.bullets.join("\n")}`.toLowerCase();
      return blob.includes(q);
    });
  }, [cards, q]);

  const title = "Delivery Governance";
  const subtitle =
    scope === "project"
      ? "Powered by the Aliena Delivery Governance Framework™ — standards and guidance for controlled, auditable delivery."
      : "Powered by the Aliena Delivery Governance Framework™ — platform standards, guidance and AI assistance for enterprise delivery.";

  const projectLabel =
    scope === "project"
      ? pid
        ? looksLikeUuid(pid)
          ? "Project"
          : pid
        : "Project"
      : null;

  const openAsk = useCallback((opts?: { kbSlug?: string; seed?: string }) => {
    setAskOpen(true);
    setAskError("");

    const kb = safeLower(opts?.kbSlug || "");
    if (kb) setKbArticleSlug(kb);

    const seed = safeStr(opts?.seed || "").trim();
    if (seed) setAskText(seed);
  }, []);

  const clearAsk = useCallback(() => {
    setAskText("");
    setAskError("");
    setAskAnswer("");
    setAskResult(null);
    setKbArticleSlug("");
  }, []);

  const effectiveAdvisorScope: AdvisorScope = useMemo(() => {
    if (safeLower(kbArticleSlug)) return "kb";
    return scope === "project" ? "project" : "global";
  }, [kbArticleSlug, scope]);

  const doAsk = useCallback(
    async (textOverride?: string) => {
      const question = clamp(safeStr(textOverride ?? askText).trim(), 1200);
      if (!question) {
        setAskError("Type a question first.");
        return;
      }

      if (effectiveAdvisorScope === "project" && !pid) {
        setAskError("Project context is missing.");
        return;
      }

      if (effectiveAdvisorScope === "kb" && !safeLower(kbArticleSlug)) {
        setAskError("KB article context is missing.");
        return;
      }

      setAskLoading(true);
      setAskError("");

      try {
        const payload: any = {
          scope: effectiveAdvisorScope,
          question,
          mode: "advisor",
        };

        if (effectiveAdvisorScope === "project") payload.projectId = pid;
        if (effectiveAdvisorScope === "kb") payload.articleSlug = kbArticleSlug;

        const res = await fetch("/api/ai/governance-advisor", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });

        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.ok) {
          const msg = safeStr(json?.error) || `Request failed (${res.status})`;
          setAskError(msg);
          setAskAnswer("");
          setAskResult(null);
          return;
        }

        const ans = safeStr(json?.answer);
        setAskAnswer(ans);

        const r = json?.result as AdvisorResult | undefined;
        if (r && typeof r === "object" && safeStr((r as any).answer)) setAskResult(r);
        else setAskResult(null);
      } catch (e: any) {
        setAskError(safeStr(e?.message) || "Failed to reach advisor.");
        setAskAnswer("");
        setAskResult(null);
      } finally {
        setAskLoading(false);
      }
    },
    [askText, pid, effectiveAdvisorScope, kbArticleSlug]
  );

  const suggested = useMemo(
    () => [
      "Is this project safe?",
      "What should I do today?",
      "Who is blocking delivery?",
      "Why is approval stuck?",
      "When should I raise a change?",
      "What governance gaps should I fix this week?",
    ],
    []
  );

  const kbContextBadge = useMemo(() => {
    const slug = safeLower(kbArticleSlug);
    if (!slug) return null;
    const match = cards.find((c) => safeLower(c.key) === slug);
    return match ? match.title : slug;
  }, [kbArticleSlug, cards]);

  // ✅ When reading KB from project hub, preserve return path
  const readHref = useCallback(
    (slug: string) => {
      const s = encodeURIComponent(slug);
      if (scope === "project" && pid) {
        return `/governance/${s}?from=project&pid=${encodeURIComponent(pid)}`;
      }
      return `/governance/${s}?from=hub`;
    },
    [scope, pid]
  );

  /* =======================
     Governance Brain fetch
  ======================= */

  const loadBrain = useCallback(async () => {
    setBrainLoading(true);
    setBrainError("");

    try {
      const res = await fetch("/api/ai/governance-brain?scope=active", {
        method: "GET",
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      const json = (await res.json().catch(() => null)) as GovernanceBrainResponse | null;

      if (!res.ok || !json || json.ok !== true) {
        setBrain(null);
        setBrainError(safeStr((json as any)?.error) || `Brain request failed (${res.status})`);
        return;
      }

      setBrain(json);
      setBrainError("");
    } catch (e: any) {
      setBrain(null);
      setBrainError(safeStr(e?.message) || "Failed to load Governance Brain.");
    } finally {
      setBrainLoading(false);
    }
  }, []);

  useEffect(() => {
    // Lightweight signals panel: load once on entry, refresh button provided.
    loadBrain();
  }, [loadBrain]);

  const brainOrg = useMemo(() => {
    const orgs = Array.isArray(brain?.orgs) ? brain!.orgs! : [];
    return orgs.length ? orgs[0] : null;
  }, [brain]);

  const brainProject = useMemo(() => {
    if (scope !== "project" || !pid || !brainOrg?.health?.projects?.length) return null;
    const hit = brainOrg.health.projects.find((p) => safeStr(p.project_id) === pid);
    return hit || null;
  }, [scope, pid, brainOrg]);

  const worstProjects = useMemo(() => {
    const list = brainOrg?.health?.projects ?? [];
    if (!Array.isArray(list) || !list.length) return [];
    return [...list].sort((a, b) => Number(a.score) - Number(b.score)).slice(0, 3);
  }, [brainOrg]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
      {/* Header */}
      <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            {scope === "project" && pid ? (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <Link href={`/projects/${encodeURIComponent(pid)}`} className="hover:text-neutral-700 transition-colors">
                  {projectLabel}
                </Link>
                <span className="text-neutral-300">/</span>
                <Link
                  href={`/projects/${encodeURIComponent(pid)}/artifacts`}
                  className="hover:text-neutral-700 transition-colors"
                >
                  Artifacts
                </Link>
                <span className="text-neutral-300">/</span>
                <span className="text-neutral-700 font-medium">Delivery Governance</span>
              </div>
            ) : null}

            <div className="flex items-center gap-2">
              <BookOpen className="h-5 w-5 text-neutral-700" />
              <h1 className="text-xl font-semibold tracking-tight text-neutral-900">{title}</h1>
            </div>
            <p className="mt-1 text-sm text-neutral-600">{subtitle}</p>

            {scope === "project" && pid ? <p className="mt-2 text-xs text-neutral-500">Project context enabled</p> : null}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
              onClick={() => openAsk()}
            >
              <Sparkles className="h-4 w-4" />
              Ask Aliena
            </button>
          </div>
        </div>

        {/* Governance Brain Snapshot */}
        <div className="mt-4 rounded-2xl border border-neutral-200 bg-white p-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-neutral-200 bg-white text-neutral-800">
                  <Brain className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-neutral-900">Governance Brain</div>
                  <div className="text-xs text-neutral-500">
                    {brainOrg?.org_name ? (
                      <>
                        Org: <span className="font-medium text-neutral-700">{brainOrg.org_name}</span>
                      </>
                    ) : (
                      <>Org-scoped governance signals</>
                    )}
                    {brain?.generated_at ? (
                      <span className="ml-2 text-neutral-400">• Updated {new Date(brain.generated_at).toLocaleString()}</span>
                    ) : null}
                  </div>
                </div>
              </div>

              {brainError ? (
                <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5" />
                    <div className="min-w-0">{brainError}</div>
                  </div>
                </div>
              ) : null}

              {!brainError && brainLoading ? (
                <div className="mt-3 flex items-center gap-2 text-sm text-neutral-600">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading signals…
                </div>
              ) : null}

              {!brainError && !brainLoading && brainOrg ? (
                <>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] ${ragPill(
                        brainOrg.health?.portfolio_rag
                      )}`}
                      title="Portfolio RAG"
                    >
                      <Activity className="h-3.5 w-3.5" />
                      Portfolio {brainOrg.health?.portfolio_rag ?? "—"} • {brainOrg.health?.portfolio_score ?? "—"}
                    </span>

                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-700"
                      title="Overdue approval steps"
                    >
                      <Clock3 className="h-3.5 w-3.5 text-neutral-500" />
                      Overdue approvals{" "}
                      <span className="font-semibold text-neutral-900">{brainOrg.approvals?.overdue_steps ?? 0}</span>
                    </span>

                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-700"
                      title="Total SLA breaches across approvals/tasks/WBS/RAID/changes"
                    >
                      <Flame className="h-3.5 w-3.5 text-neutral-500" />
                      Breaches{" "}
                      <span className="font-semibold text-neutral-900">{brainOrg.sla?.breached_total ?? 0}</span>
                    </span>

                    <span
                      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-700"
                      title="Projects blocked across approvals/tasks/WBS/RAID/changes"
                    >
                      <AlertTriangle className="h-3.5 w-3.5 text-neutral-500" />
                      Blocked projects{" "}
                      <span className="font-semibold text-neutral-900">{brainOrg.blockers?.projects_blocked ?? 0}</span>
                    </span>

                    {scope === "project" && pid && brainProject ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-[11px] ${ragPill(
                          brainProject.rag
                        )}`}
                        title="This project's governance health score"
                      >
                        <Shield className="h-3.5 w-3.5" />
                        This project {brainProject.rag} • {brainProject.score}
                      </span>
                    ) : null}
                  </div>

                  {safeStr(brainOrg.ai_summary) ? (
                    <div className="mt-3 text-sm text-neutral-700">{safeStr(brainOrg.ai_summary)}</div>
                  ) : null}

                  {!!worstProjects.length ? (
                    <div className="mt-3 rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                      <div className="text-xs font-semibold text-neutral-600">Most at-risk projects</div>
                      <div className="mt-2 space-y-2">
                        {worstProjects.map((p) => (
                          <div
                            key={p.project_id}
                            className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-neutral-900">
                                {safeStr(p.project_title) || "Untitled project"}
                              </div>
                              <div className="text-xs text-neutral-500">
                                {p.project_code ? <span className="mr-2">{p.project_code}</span> : null}
                                <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] ${ragPill(p.rag)}`}>
                                  {p.rag} • {p.score}
                                </span>
                              </div>
                            </div>

                            {looksLikeUuid(p.project_id) ? (
                              <Link
                                href={`/projects/${encodeURIComponent(p.project_id)}/artifacts`}
                                className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                                title="Open project artifacts"
                              >
                                Open <ChevronRight className="h-4 w-4 text-neutral-400" />
                              </Link>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <Link
                      href="/executive"
                      className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                    >
                      Open Executive Cockpit <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
                    </Link>
                    <Link
                      href="/approvals"
                      className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                    >
                      Approvals Centre <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
                    </Link>
                  </div>
                </>
              ) : null}
            </div>

            <div className="shrink-0 flex items-center gap-2">
              <button
                type="button"
                onClick={loadBrain}
                disabled={brainLoading}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50 disabled:opacity-60"
              >
                {brainLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Refresh
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search governance guidance…"
            className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
          />
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {scope === "project" && pid ? (
            <>
              <Link
                href={`/projects/${encodeURIComponent(pid)}/artifacts`}
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Back to Artifacts
              </Link>
              <Link
                href="/governance"
                className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                View global governance
              </Link>
            </>
          ) : (
            <Link
              href="/"
              className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
            >
              Home
            </Link>
          )}
        </div>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 gap-4">
        {filtered.map((card) => (
          <div key={card.key} className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm hover:bg-neutral-50">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl border border-neutral-200 bg-white p-2 text-neutral-700">{card.icon}</div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-neutral-900">{card.title}</h2>
                  <p className="mt-1 text-sm text-neutral-600">{card.summary}</p>

                  {scope === "project" && pid && card.ctas?.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {card.ctas.map((c, idx) => (
                        <Link
                          key={`${card.key}:${idx}`}
                          href={c.href(pid)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                        >
                          {c.label}
                          <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
                        </Link>
                      ))}
                    </div>
                  ) : null}

                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        openAsk({
                          kbSlug: card.key,
                          seed: `Using the "${card.title}" standard — what controls and audit evidence should be in place?`,
                        })
                      }
                      className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      title="Ask Aliena using this article as the governing standard"
                    >
                      <MessageSquareText className="h-3.5 w-3.5 text-neutral-500" />
                      Ask about this
                    </button>

                    <Link
                      href={readHref(card.key)}
                      className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                      title="Read the full guidance"
                    >
                      Read
                      <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
                    </Link>
                  </div>
                </div>
              </div>

              <Link
                href={readHref(card.key)}
                className="hidden md:inline-flex items-center gap-1 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                aria-label={`Read ${card.title}`}
              >
                Open <ChevronRight className="h-4 w-4" />
              </Link>
            </div>

            <ul className="mt-4 space-y-2">
              {card.bullets.map((b, i) => (
                <li key={i} className="text-sm text-neutral-700">
                  <span className="mr-2 text-neutral-400">•</span>
                  {b}
                </li>
              ))}
            </ul>

            <div className="mt-4 md:hidden">
              <Link
                href={readHref(card.key)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
              >
                Read
                <ChevronRight className="h-4 w-4 text-neutral-400" />
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
        <p className="text-sm text-neutral-700">
          <span className="font-semibold">Next (Phase 2):</span> project-aware governance signals (health score, missing
          approval chains, stale RAID, overdue approvals) + Ask Aliena answers connected to this framework.
        </p>
      </div>

      {/* Ask Aliena panel */}
      {askOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/30" onClick={() => setAskOpen(false)} />
          <div className="absolute right-0 top-0 h-full w-full max-w-md bg-white border-l border-neutral-200 shadow-xl">
            <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-neutral-700" />
                <div className="text-sm font-semibold text-neutral-900">Ask Aliena</div>
              </div>
              <button
                type="button"
                onClick={() => setAskOpen(false)}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg border border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-4">
              <div className="text-xs text-neutral-600">
                This advisor uses governance data (where available) to give executive-ready, actionable guidance.
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-700">
                  Scope:{" "}
                  <span className="font-semibold">
                    {effectiveAdvisorScope === "kb" ? "KB" : effectiveAdvisorScope === "project" ? "Project" : "Global"}
                  </span>
                </span>

                {effectiveAdvisorScope === "project" ? (
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-700">
                    Context: <span className="font-semibold">{pid ? "Enabled" : "Missing"}</span>
                  </span>
                ) : null}

                {effectiveAdvisorScope === "kb" ? (
                  <span className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-[11px] text-neutral-700">
                    Article: <span className="font-semibold">{kbContextBadge ?? "Selected"}</span>
                  </span>
                ) : null}

                {safeLower(kbArticleSlug) ? (
                  <button
                    type="button"
                    onClick={() => {
                      setKbArticleSlug("");
                      setAskAnswer("");
                      setAskResult(null);
                      setAskError("");
                    }}
                    className="rounded-full border border-neutral-200 bg-white px-3 py-1 text-[11px] text-neutral-700 hover:bg-neutral-50"
                    title="Remove KB context and return to Project/Global scope"
                  >
                    Clear KB context
                  </button>
                ) : null}
              </div>

              <div className="rounded-xl border border-neutral-200 bg-white p-3">
                <textarea
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  placeholder="Ask: Is this project safe? What controls must be in place? What evidence do we need for audit?"
                  className="min-h-[110px] w-full resize-none bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                />
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={clearAsk}
                    className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
                    disabled={askLoading}
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => doAsk()}
                    disabled={askLoading}
                    className="inline-flex items-center justify-center gap-2 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800 disabled:opacity-60"
                  >
                    {askLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                    Ask
                  </button>
                </div>
              </div>

              {askError ? (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5" />
                    <div className="min-w-0">{askError}</div>
                  </div>
                </div>
              ) : null}

              {(askAnswer || askResult) && !askError ? (
                <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-neutral-500">Aliena’s guidance</div>
                      {askResult?.confidence != null ? (
                        <div className="mt-1 text-xs text-neutral-500">
                          Confidence:{" "}
                          <span className="font-medium text-neutral-700">
                            {fmtConfidence(askResult.confidence) ?? "—"}
                          </span>
                        </div>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setAskAnswer("");
                        setAskResult(null);
                      }}
                      className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
                      disabled={askLoading}
                    >
                      Clear result
                    </button>
                  </div>

                  <div className="mt-3 whitespace-pre-wrap text-sm text-neutral-900">
                    {safeStr(askResult?.answer || askAnswer)}
                  </div>

                  {askResult?.key_drivers?.length ? (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-neutral-500">Key drivers</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {askResult.key_drivers.slice(0, 10).map((d, idx) => (
                          <span
                            key={`drv:${idx}`}
                            className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1.5 text-xs text-neutral-700"
                          >
                            {d}
                          </span>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {askResult?.blockers?.length ? (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-neutral-500">Blockers</div>
                      <div className="mt-2 space-y-2">
                        {askResult.blockers.slice(0, 6).map((b, idx) => (
                          <div key={`blk:${idx}`} className="rounded-xl border border-neutral-200 bg-white p-3">
                            <div className="text-xs text-neutral-500">
                              {kindLabel(b.kind)}
                              {typeof b.age_days === "number" ? (
                                <span className="ml-2 text-neutral-400">• {b.age_days}d</span>
                              ) : null}
                              {typeof b.severity === "number" ? (
                                <span className="ml-2 text-neutral-400">• Sev {b.severity}</span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 text-sm font-medium text-neutral-900">{b.title}</div>
                            <div className="mt-1 text-sm text-neutral-700">
                              <span className="font-medium">Next:</span> {b.next_action}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {askResult?.today_actions?.length ? (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-neutral-500">Today’s actions</div>
                      <div className="mt-2 space-y-2">
                        {askResult.today_actions
                          .slice(0, 6)
                          .sort((a, b) => Number(a.priority) - Number(b.priority))
                          .map((a, idx) => (
                            <div key={`act:${idx}`} className="rounded-xl border border-neutral-200 bg-neutral-50 p-3">
                              <div className="text-xs text-neutral-500">
                                Priority {a.priority}
                                {a.owner_suggestion ? <span className="ml-2 text-neutral-400">• {a.owner_suggestion}</span> : null}
                              </div>
                              <div className="mt-0.5 text-sm font-medium text-neutral-900">{a.action}</div>
                              <div className="mt-1 text-sm text-neutral-700">{a.why}</div>
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}

                  {askResult?.recommended_routes?.length ? (
                    <div className="mt-4">
                      <div className="text-xs font-semibold text-neutral-500">Recommended next clicks</div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {askResult.recommended_routes.slice(0, 6).map((r, idx) => (
                          <Link
                            key={`rr:${idx}`}
                            href={r.href}
                            className="inline-flex items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 hover:bg-neutral-50"
                          >
                            {r.label}
                            <ExternalLink className="h-3.5 w-3.5 text-neutral-400" />
                          </Link>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {askResult?.data_requests?.length ? (
                    <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3">
                      <div className="text-xs font-semibold text-amber-800">To be more accurate, I need:</div>
                      <ul className="mt-2 space-y-1">
                        {askResult.data_requests.slice(0, 6).map((x, idx) => (
                          <li key={`dr:${idx}`} className="text-xs text-amber-800">
                            <span className="mr-2 text-amber-600">•</span>
                            {x}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="text-xs font-semibold text-neutral-500">Suggested</div>
                <div className="flex flex-wrap gap-2">
                  {suggested.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setAskText(s);
                        doAsk(s);
                      }}
                      disabled={askLoading}
                      className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 disabled:opacity-60"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>

              {effectiveAdvisorScope === "project" ? (
                <div className="text-[11px] text-neutral-500">Project-aware answers enabled {pid && looksLikeUuid(pid) ? "(ID hidden)" : ""}.</div>
              ) : effectiveAdvisorScope === "kb" ? (
                <div className="text-[11px] text-neutral-500">KB-aware answers: grounded in the selected governance article.</div>
              ) : (
                <div className="text-[11px] text-neutral-500">Global scope: best-practice guidance + platform governance patterns.</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}