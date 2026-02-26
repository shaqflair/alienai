"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
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
} from "lucide-react";

type Scope = "global" | "project";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

type Card = {
  key: string;
  title: string;
  icon: React.ReactNode;
  summary: string;
  bullets: string[];
  // optional project CTAs
  ctas?: Array<{ label: string; href: (projectId: string) => string }>;
};

export default function GovernanceHubClient({
  scope,
  projectId,
}: {
  scope: Scope;
  projectId?: string;
}) {
  const pid = safeStr(projectId).trim();
  const [query, setQuery] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [askText, setAskText] = useState("");

  const cards: Card[] = useMemo(
    () => [
      {
        key: "framework",
        title: "Aliena Delivery Governance Framework™",
        icon: <Shield className="h-5 w-5" />,
        summary:
          "The operating model that makes delivery visible, controlled, auditable, and continuity-safe.",
        bullets: [
          "Pillar 1: Structured Ownership (no single point of failure)",
          "Pillar 2: Controlled Decision-Making (approvals + audit trail)",
          "Pillar 3: Transparent Change Control (cost/scope/schedule discipline)",
          "Pillar 4: Continuous Risk Intelligence (RAID discipline + escalation)",
          "Pillar 5: Executive Visibility & Confidence (portfolio truth in seconds)",
        ],
      },
      {
        key: "roles",
        title: "Roles & Ownership",
        icon: <Users className="h-5 w-5" />,
        summary:
          "Assign delivery roles correctly so projects remain resilient, secure, and board-safe.",
        bullets: [
          "Always maintain 2+ Owners (continuity best practice)",
          "Editors can update artifacts; Viewers are read-only",
          "Approvers must be members + included in the approval chain",
          "Use delegation / holiday cover for uninterrupted approvals",
        ],
        ctas: [
          { label: "Go to project members", href: (p) => `/projects/${encodeURIComponent(p)}` },
          // if you have a dedicated members/settings page later, swap this CTA
        ],
      },
      {
        key: "approvals",
        title: "Approvals & Decision Control",
        icon: <FileCheck className="h-5 w-5" />,
        summary:
          "Sequential approval chains, delegation, SLA awareness, and a traceable decision history.",
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
        key: "change",
        title: "Change Control",
        icon: <GitBranch className="h-5 w-5" />,
        summary:
          "No hidden scope drift. All cost/scope/schedule changes must be raised and approved.",
        bullets: [
          "Raise change for cost, scope, schedule, or commercial impact",
          "Submit to the configured approval chain",
          "Link changes to delivery impact and actions",
          "Close changes with outcomes recorded",
        ],
        ctas: [{ label: "Open change board", href: (p) => `/projects/${encodeURIComponent(p)}/change` }],
      },
      {
        key: "raid",
        title: "Risk & RAID Discipline",
        icon: <AlertTriangle className="h-5 w-5" />,
        summary:
          "Delivery risk is never invisible. RAID is the single source of operational truth.",
        bullets: [
          "Risk = potential future problem; Issue = active problem",
          "Assumptions & dependencies must be explicit and reviewed",
          "Update cadence: weekly minimum for active delivery",
          "Escalate high-severity items for executive visibility",
        ],
        ctas: [{ label: "Open RAID log", href: (p) => `/projects/${encodeURIComponent(p)}/raid` }],
      },
      {
        key: "ai",
        title: "AI Assistance",
        icon: <Sparkles className="h-5 w-5" />,
        summary:
          "AI supports governance (drafts + signals). Humans remain accountable for decisions.",
        bullets: [
          "AI drafts charters/reports; you approve and submit",
          "AI flags approval bottlenecks & delivery risk signals",
          "AI suggests RAID items and mitigations (review before applying)",
          "AI helps produce executive-ready summaries",
        ],
      },
      {
        key: "executive",
        title: "Executive Oversight",
        icon: <BarChart3 className="h-5 w-5" />,
        summary:
          "Boards want truth fast: portfolio health, financial exposure, bottlenecks, and risk signals.",
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

  const q = query.trim().toLowerCase();
  const filtered = useMemo(() => {
    if (!q) return cards;
    return cards.filter((c) => {
      const blob = `${c.title}\n${c.summary}\n${c.bullets.join("\n")}`.toLowerCase();
      return blob.includes(q);
    });
  }, [cards, q]);

  const title = scope === "project" ? "Delivery Governance" : "Delivery Governance";
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

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
      {/* Header */}
      <div className="mb-6 rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            {/* Breadcrumbs (project scope) */}
            {scope === "project" && pid ? (
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                <Link
                  href={`/projects/${encodeURIComponent(pid)}`}
                  className="hover:text-neutral-700 transition-colors"
                >
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

            {/* Keep this executive-clean: show context but don’t scream UUID */}
            {scope === "project" && pid && looksLikeUuid(pid) ? (
              <p className="mt-2 text-xs text-neutral-500">
                Project context enabled
              </p>
            ) : null}
          </div>

          {/* Ask Aliena */}
          <button
            type="button"
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            onClick={() => setAskOpen(true)}
          >
            <Sparkles className="h-4 w-4" />
            Ask Aliena
          </button>
        </div>

        {/* Search */}
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2">
          <Search className="h-4 w-4 text-neutral-500" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search governance guidance…"
            className="w-full bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
          />
        </div>

        {/* Quick links */}
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
          <div
            key={card.key}
            className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm hover:bg-neutral-50"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-xl border border-neutral-200 bg-white p-2 text-neutral-700">
                  {card.icon}
                </div>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold text-neutral-900">{card.title}</h2>
                  <p className="mt-1 text-sm text-neutral-600">{card.summary}</p>

                  {/* Project CTAs */}
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
                </div>
              </div>
              <div className="hidden md:flex items-center gap-1 text-xs text-neutral-400">
                Read <ChevronRight className="h-4 w-4" />
              </div>
            </div>

            <ul className="mt-4 space-y-2">
              {card.bullets.map((b, i) => (
                <li key={i} className="text-sm text-neutral-700">
                  <span className="mr-2 text-neutral-400">•</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Phase 2 note */}
      <div className="mt-6 rounded-2xl border border-neutral-200 bg-white p-5">
        <p className="text-sm text-neutral-700">
          <span className="font-semibold">Next (Phase 2):</span> project-aware governance signals (health score, missing
          approval chains, stale RAID, overdue approvals) + Ask Aliena answers connected to this framework.
        </p>
      </div>

      {/* Ask Aliena panel shell (Phase 1 UI only) */}
      {askOpen && (
        <div className="fixed inset-0 z-50">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setAskOpen(false)}
          />
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

            <div className="p-4">
              <p className="text-xs text-neutral-600">
                Phase 2 will connect this panel to your governance knowledge base and (optionally) project data.
              </p>

              <div className="mt-3 rounded-xl border border-neutral-200 bg-white p-3">
                <textarea
                  value={askText}
                  onChange={(e) => setAskText(e.target.value)}
                  placeholder="Ask: How do I assign approvers? Why is approval stuck? How to raise a change?"
                  className="min-h-[110px] w-full resize-none bg-transparent text-sm text-neutral-900 outline-none placeholder:text-neutral-400"
                />
                <div className="mt-3 flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setAskText("")}
                    className="text-xs font-medium text-neutral-500 hover:text-neutral-700"
                  >
                    Clear
                  </button>
                  <button
                    type="button"
                    onClick={() => alert("Phase 2: AI answer coming soon.")}
                    className="inline-flex items-center justify-center rounded-lg bg-neutral-900 px-3 py-2 text-xs font-semibold text-white hover:bg-neutral-800"
                  >
                    Ask
                  </button>
                </div>
              </div>

              <div className="mt-4 space-y-2">
                <div className="text-xs font-semibold text-neutral-500">Suggested</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    "How do I add a new member?",
                    "How do I assign approvers?",
                    "Why is approval stuck?",
                    "When should I raise a change?",
                    "What’s the difference between risk and issue?",
                  ].map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setAskText(s)}
                      className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}