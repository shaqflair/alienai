"use client";

import React, { useMemo } from "react";
import Link from "next/link";
import {
  Shield,
  Users,
  FileCheck,
  GitBranch,
  AlertTriangle,
  Sparkles,
  BarChart3,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import AskAlienaDrawer from "@/components/governance/AskAlienaDrawer";

type GovernanceArticleSection = {
  heading?: string;
  body?: string[];
  bullets?: string[];
};

export type GovernanceArticleNav =
  | {
      slug: string;
      title: string;
      summary?: string | null;
    }
  | null;

export type GovernanceArticleClientModel = {
  id: string;
  slug: string;
  title: string;
  summary?: string | null;
  updated_at?: string | null;
  content?: unknown;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isoDateOnly(x: unknown) {
  const s = safeStr(x).trim();
  if (!s) return "";
  const d = s.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : s;
}

function iconForSlug(slug: string) {
  const s = safeStr(slug).trim().toLowerCase();

  // Core governance pillars
  if (s === "delivery-governance-framework") return <Shield className="h-5 w-5" />;
  if (s === "roles-ownership") return <Users className="h-5 w-5" />;
  if (s === "approvals-decision-control") return <FileCheck className="h-5 w-5" />;
  if (s === "change-control") return <GitBranch className="h-5 w-5" />;
  if (s === "risk-raid-discipline") return <AlertTriangle className="h-5 w-5" />;
  if (s === "ai-assistance") return <Sparkles className="h-5 w-5" />;
  if (s === "executive-oversight") return <BarChart3 className="h-5 w-5" />;

  // ✅ Finance KB (minimal integration)
  // Covers:
  // - "financial-governance"
  // - "finance-overview"
  // - "finance-resources-tab", etc.
  // - any future "finance-*" articles
  if (s === "financial-governance") return <BarChart3 className="h-5 w-5" />;
  if (s === "finance-overview") return <BarChart3 className="h-5 w-5" />;
  if (s.startsWith("finance-")) return <BarChart3 className="h-5 w-5" />;

  return <Shield className="h-5 w-5" />;
}

function extractSections(content: unknown): GovernanceArticleSection[] | null {
  if (!content) return null;

  if (typeof content === "object") {
    const c: any = content;
    if (Array.isArray(c?.sections)) return c.sections as GovernanceArticleSection[];
  }

  const text = safeStr(content).trim();
  if (!text) return null;

  const paras = text
    .split(/\n{2,}/g)
    .map((p) => p.trim())
    .filter(Boolean);

  return [
    {
      heading: "",
      body: paras,
      bullets: [],
    },
  ];
}

export default function GovernanceKbArticleClient({
  article,
  nav,
}: {
  article: GovernanceArticleClientModel;
  nav?: { prev: GovernanceArticleNav; next: GovernanceArticleNav };
}) {
  const icon = useMemo(() => iconForSlug(article.slug), [article.slug]);
  const updated = useMemo(() => isoDateOnly(article.updated_at), [article.updated_at]);
  const sections = useMemo(() => extractSections(article.content) ?? [], [article.content]);

  const prev = nav?.prev ?? null;
  const next = nav?.next ?? null;

  const deliveryFrameworkSlug = "delivery-governance-framework";
  const deliveryFrameworkHref = `/governance/${encodeURIComponent(deliveryFrameworkSlug)}`;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6 md:py-10">
      {/* Top actions */}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href="/governance"
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Governance
          </Link>

          {/* ✅ Delivery Governance link on article pages */}
          <Link
            href={deliveryFrameworkHref}
            className="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
            title="Open the Delivery Governance Framework standard"
          >
            <Shield className="h-4 w-4" />
            Delivery Governance
          </Link>

          {/* ✅ Ask Aliena opens drawer (no redirect) */}
          <AskAlienaDrawer
            scope="kb"
            articleSlug={article.slug}
            articleTitle={article.title}
            triggerLabel="Ask Aliena"
            triggerClassName="inline-flex items-center gap-2 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          />
        </div>

        {updated ? (
          <div className="text-xs text-neutral-500">
            Updated <span className="font-medium text-neutral-700">{updated}</span>
          </div>
        ) : null}
      </div>

      {/* Header */}
      <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl border border-neutral-200 bg-white p-2 text-neutral-700">
            {icon}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
              {article.title}
            </h1>
            {article.summary ? (
              <p className="mt-1 text-sm text-neutral-600">{article.summary}</p>
            ) : null}

            {/* Small utility row (optional but helpful) */}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={deliveryFrameworkHref}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                title="Delivery governance standard"
              >
                Delivery Governance <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
              </Link>

              <button
                type="button"
                onClick={() => {
                  // Deep-link share anchor: /governance/<slug>?ask=help&article=<slug>
                  try {
                    const url = new URL(window.location.href);
                    url.searchParams.set("ask", "help");
                    url.searchParams.set("article", article.slug);
                    window.history.replaceState({}, "", url.toString());
                  } catch {
                    // ignore
                  }
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-neutral-200 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-neutral-50"
                title="Attach ?ask=help&article=... to the URL for sharing"
              >
                Share Ask link <ChevronRight className="h-3.5 w-3.5 text-neutral-400" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="mt-4 space-y-4">
        {sections.length ? (
          sections.map((s, idx) => (
            <div
              key={`${article.slug}:sec:${idx}`}
              className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm"
            >
              {safeStr(s.heading).trim() ? (
                <h2 className="text-base font-semibold text-neutral-900">{s.heading}</h2>
              ) : null}

              <div className="mt-2 space-y-2">
                {(s.body || []).map((p, i) => (
                  <p key={i} className="text-sm text-neutral-700">
                    {p}
                  </p>
                ))}
              </div>

              {s.bullets?.length ? (
                <ul className="mt-3 space-y-2">
                  {s.bullets.map((b, i) => (
                    <li key={i} className="text-sm text-neutral-700">
                      <span className="mr-2 text-neutral-400">•</span>
                      {b}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))
        ) : (
          <div className="rounded-2xl border border-neutral-200 bg-white p-5 shadow-sm text-sm text-neutral-700">
            This article has no content yet.
          </div>
        )}
      </div>

      {/* Prev / Next */}
      {(prev || next) && (
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {prev ? (
            <Link
              href={`/governance/${encodeURIComponent(prev.slug)}`}
              className="group rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm hover:bg-neutral-50"
            >
              <div className="text-xs font-semibold text-neutral-500">Previous</div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-neutral-900">
                    {prev.title}
                  </div>
                  {prev.summary ? (
                    <div className="mt-1 line-clamp-2 text-xs text-neutral-600">
                      {prev.summary}
                    </div>
                  ) : null}
                </div>
                <ChevronRight className="h-4 w-4 rotate-180 text-neutral-300 group-hover:text-neutral-400" />
              </div>
            </Link>
          ) : (
            <div className="hidden sm:block" />
          )}

          {next ? (
            <Link
              href={`/governance/${encodeURIComponent(next.slug)}`}
              className="group rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm hover:bg-neutral-50"
            >
              <div className="text-xs font-semibold text-neutral-500">Next</div>
              <div className="mt-1 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-neutral-900">
                    {next.title}
                  </div>
                  {next.summary ? (
                    <div className="mt-1 line-clamp-2 text-xs text-neutral-600">
                      {next.summary}
                    </div>
                  ) : null}
                </div>
                <ChevronRight className="h-4 w-4 text-neutral-300 group-hover:text-neutral-400" />
              </div>
            </Link>
          ) : null}
        </div>
      )}
    </div>
  );
}