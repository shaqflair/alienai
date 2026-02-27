import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import AskAlienaDrawer from "@/components/governance/AskAlienaDrawer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function decodeSlug(x: unknown) {
  return decodeURIComponent(safeStr(x)).trim();
}

function fmtUpdated(x: unknown) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

function normalizeNewlines(s: string) {
  // prevent SSR/CSR mismatch (CRLF vs LF)
  return s.replace(/\r\n?/g, "\n");
}

/* ---------------- fallback KB ----------------
   These match the fallback cards in GovernanceHubClient.tsx.
   They prevent 404s while DB seeding is incomplete.
------------------------------------------------ */

const FALLBACK_ARTICLES: Record<
  string,
  { title: string; summary?: string; content: string; related?: string[] }
> = {
  "delivery-governance-framework": {
    title: "Aliena Delivery Governance Framework™",
    summary:
      "The operating model that makes delivery visible, controlled, auditable, and continuity-safe.",
    content: normalizeNewlines(`
## What this is
A practical governance operating model for delivery assurance — designed for audit-ready, board-safe delivery.

## The 5 pillars
1) **Structured Ownership**
- Maintain continuity (2+ owners where possible)
- Clear accountability for decisions and artefact ownership

2) **Controlled Decision-Making**
- Approval chains by artefact / change type
- Delegation / holiday cover to prevent bottlenecks
- Full audit trail (who/when/what)

3) **Transparent Change Control**
- No hidden scope drift
- Change requests for cost, scope, schedule, or commercial impact
- Decision and rationale recorded

4) **Continuous Risk Intelligence (RAID)**
- Risks, issues, assumptions, dependencies maintained and reviewed
- Weekly update cadence for active delivery
- Escalation thresholds for executive visibility

5) **Executive Visibility & Confidence**
- Portfolio truth in seconds
- Bottlenecks, SLA breaches, exposure, and risk signals surfaced early

## Evidence and audit readiness
- Approved artefacts + timeline of decisions
- Change log with outcomes
- RAID history with owners, dates, mitigations
`),
    related: [
      "roles-ownership",
      "approvals-decision-control",
      "change-control",
      "risk-raid-discipline",
      "executive-oversight",
    ],
  },

  "roles-ownership": {
    title: "Roles & Ownership",
    summary:
      "Assign delivery roles correctly so projects remain resilient, secure, and board-safe.",
    content: normalizeNewlines(`
## Core roles
- **Owners**: continuity + accountable for the artefact/project governance state
- **Editors**: can update artefacts
- **Viewers**: read-only
- **Approvers**: defined per chain step (user or group)

## Non-negotiables
- Prefer **2+ owners** (avoid single points of failure)
- Approvers must be **members** and included in the **approval chain**
- Use **delegation / holiday cover** to maintain flow

## Evidence
- Membership list with roles
- Approval chain + approver assignment
- Delegation records (who covered who, when)
`),
    related: ["approvals-decision-control", "delivery-governance-framework"],
  },

  "approvals-decision-control": {
    title: "Approvals & Decision Control",
    summary:
      "Sequential approval chains, delegation, SLA awareness, and traceable decision history.",
    content: normalizeNewlines(`
## Approval lifecycle
- Draft → Submitted → In Review → Approved / Changes Requested / Rejected

## Best-practice chain structure
- Reviewer (quality)
- Commercial (cost/contract)
- Sponsor (final decision)

## Avoiding bottlenecks
- Define SLAs per step (or operational expectations)
- Ensure alternates exist via delegation / group membership
- Keep chains small, ordered, and explicit

## Evidence
- Approval timeline (events)
- Step decisions + timestamps + actor
- Requests-for-changes and re-submissions recorded
`),
    related: ["roles-ownership", "delivery-governance-framework"],
  },

  "change-control": {
    title: "Change Control",
    summary:
      "No hidden scope drift. All cost/scope/schedule changes must be raised and approved.",
    content: normalizeNewlines(`
## When to raise a change
Raise a change when there is **cost**, **scope**, **schedule**, or **commercial** impact.

## What good looks like
- Clear change statement (what is changing)
- Impact assessment (cost / schedule / risk)
- Options and recommendation
- Approval chain appropriate to authority level

## Closure
- Record decision + rationale
- Track implementation actions
- Capture outcomes at closure

## Evidence
- Change request record + approvals
- Impact assessment artefacts / attachments
- Implementation outcome notes
`),
    related: ["risk-raid-discipline", "approvals-decision-control", "delivery-governance-framework"],
  },

  "risk-raid-discipline": {
    title: "Risk & RAID Discipline",
    summary:
      "Delivery risk is never invisible. RAID is the single source of operational truth.",
    content: normalizeNewlines(`
## Definitions
- **Risk**: potential future problem
- **Issue**: active problem
- **Assumption**: believed true, must be validated
- **Dependency**: external reliance that can block delivery

## Cadence
- Weekly updates minimum for active delivery
- Escalate high severity items early

## Evidence
- RAID log history (owner, date, changes)
- Mitigations linked to actions
- Executive escalations recorded
`),
    related: ["change-control", "executive-oversight", "delivery-governance-framework"],
  },

  "ai-assistance": {
    title: "AI Assistance",
    summary:
      "AI supports governance (drafts + signals). Humans remain accountable for decisions.",
    content: normalizeNewlines(`
## Where AI helps
- Drafting (charters, reports, summaries)
- Surfacing signals (approval bottlenecks, risk patterns)
- Suggesting RAID items and mitigations

## Guardrails
- Humans approve before submit
- AI outputs are advisory; accountability remains with owners/sponsors
- Audit trail remains authoritative

## Evidence
- AI suggestions reviewed/accepted by humans
- Decision trail on submitted artefacts
`),
    related: ["executive-oversight", "delivery-governance-framework"],
  },

  "executive-oversight": {
    title: "Executive Oversight",
    summary:
      "Boards want truth fast: portfolio health, exposure, bottlenecks, and risk signals.",
    content: normalizeNewlines(`
## What execs need
- Portfolio health (RAG + trends)
- Approval delays / SLA breaches
- Change exposure and value at risk
- Top risks across projects

## What good looks like
- Single place to see blockers
- Drill-through to evidence (artefacts, approvals, RAID, change)
- Clear ownership and next actions

## Evidence
- Dashboard views with drill-through links
- Approval and change histories
- Risk signals tied back to underlying items
`),
    related: ["approvals-decision-control", "risk-raid-discipline", "delivery-governance-framework"],
  },
};

type PageProps = {
  params: { slug: string };
};

type CatRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  icon: string | null;
};

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  content: any; // text or json
  category_id: string | null;
  updated_at: string | null;
  is_published: boolean;
};

/* ---------------- page ---------------- */

export default async function GovernanceArticlePage({ params }: PageProps) {
  const slugRaw = decodeSlug(params?.slug);
  if (!slugRaw) return notFound();

  const slug = slugRaw.toLowerCase();

  // 0) If DB isn't seeded yet for this slug, serve fallback (no 404)
  const fallback = FALLBACK_ARTICLES[slug];

  const supabase = await createClient();

  // 1) Load article from DB (authoritative)
  const { data: article, error: aErr } = await supabase
    .from("governance_articles")
    .select("id,slug,title,summary,content,category_id,updated_at,is_published")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle<ArticleRow>();

  if (aErr) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Unable to load governance article</h1>
        <p className="mt-2 text-sm opacity-70">
          A data error occurred while fetching this guidance page.
        </p>

        <div className="mt-6 rounded-lg border bg-white/60 p-4 text-sm dark:bg-white/5">
          <div className="font-medium">Error</div>
          <div className="mt-1 break-words opacity-80">{safeStr(aErr.message)}</div>
        </div>

        <Link
          href="/governance"
          className="mt-6 inline-flex rounded-md border px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
        >
          Back to Governance Hub
        </Link>
      </div>
    );
  }

  // 2) If DB doesn't have it, fall back to built-in guidance (if available)
  if (!article) {
    if (!fallback) {
      return (
        <div className="mx-auto max-w-3xl px-6 py-16">
          <h1 className="text-2xl font-semibold">Governance article not found</h1>
          <p className="mt-2 text-sm opacity-70">This guidance page doesn’t exist.</p>
          <Link
            href="/governance"
            className="mt-6 inline-flex rounded-md border px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            Back to Governance Hub
          </Link>
        </div>
      );
    }

    const title = fallback.title;
    const summary = fallback.summary ?? "";
    const contentText = fallback.content;

    const relatedSlugs = Array.isArray(fallback.related) ? fallback.related : [];
    const related = relatedSlugs
      .filter((s) => s && s !== slug)
      .slice(0, 6)
      .map((s) => ({
        slug: s,
        title: FALLBACK_ARTICLES[s]?.title ?? s,
      }));

    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Link href="/governance" className="text-sm opacity-70 hover:opacity-100">
            ← Back to Governance Hub
          </Link>
          <div className="text-xs opacity-70">
            <span className="rounded-full border px-2 py-1">Framework guidance</span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
          <aside className="rounded-2xl border bg-white/60 p-4 shadow-sm backdrop-blur dark:bg-white/5">
            <div className="mb-3 text-sm font-medium">Knowledge Base</div>

            <Link
              href="/governance"
              className="mb-3 inline-flex w-full items-center justify-between rounded-xl border bg-white/70 px-3 py-2 text-sm shadow-sm hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
            >
              <span>Browse all guidance</span>
              <span className="text-xs opacity-70">→</span>
            </Link>

            <div className="mt-5 rounded-xl border bg-white/70 p-3 dark:bg-white/5">
              <div className="text-xs font-medium opacity-70">Ask Aliena</div>
              <div className="mt-1 text-sm opacity-80">
                Get governance guidance tailored to this article.
              </div>
              <div className="mt-3">
                <AskAlienaDrawer
                  articleSlug={slug}
                  articleTitle={title}
                  triggerClassName="inline-flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                  triggerLabel={`Ask about “${title}” →`}
                />
              </div>
            </div>

            {related.length ? (
              <div className="mt-5">
                <div className="mb-2 text-xs font-medium opacity-70">Related guidance</div>
                <div className="space-y-2">
                  {related.map((r) => (
                    <Link
                      key={r.slug}
                      href={`/governance/${encodeURIComponent(r.slug)}`}
                      className="block rounded-xl border bg-white/70 px-3 py-2 text-sm hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
                    >
                      <div className="truncate font-medium">{r.title}</div>
                      <div className="mt-0.5 text-xs opacity-60">{r.slug}</div>
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>

          <main>
            <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur dark:bg-white/5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
                  {summary ? (
                    <p className="mt-3 max-w-3xl text-base leading-relaxed opacity-80">
                      {summary}
                    </p>
                  ) : null}

                  <div className="mt-5 flex flex-wrap items-center gap-2">
                    <span className="rounded-lg border bg-white/60 px-2.5 py-1 text-xs opacity-80 dark:bg-white/5">
                      Built-in article
                    </span>
                    <span className="rounded-lg border bg-white/60 px-2.5 py-1 text-xs opacity-80 dark:bg-white/5">
                      Slug: {slug}
                    </span>
                  </div>
                </div>

                <div className="shrink-0">
                  <AskAlienaDrawer
                    articleSlug={slug}
                    articleTitle={title}
                    triggerClassName="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                    triggerLabel="Ask Aliena →"
                  />
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-2xl border bg-white/60 p-6 shadow-sm backdrop-blur dark:bg-white/5">
              <article className="prose prose-neutral dark:prose-invert max-w-none">
                <div className="whitespace-pre-wrap">{contentText}</div>
              </article>
            </div>
          </main>
        </div>
      </div>
    );
  }

  // 3) DB article rendering (existing behaviour, plus safer content formatting)
  const title = safeStr(article.title);
  const summary = safeStr(article.summary);

  const contentText =
    typeof article.content === "string"
      ? normalizeNewlines(article.content)
      : article.content
      ? normalizeNewlines(JSON.stringify(article.content, null, 2))
      : "";

  const updated = fmtUpdated(article.updated_at);

  // 4) Load categories
  const { data: catsRaw } = await supabase
    .from("governance_categories")
    .select("id,slug,name,description,sort_order,icon,is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const categories: CatRow[] = Array.isArray(catsRaw) ? (catsRaw as CatRow[]) : [];

  const activeCategory =
    article.category_id && categories.length
      ? categories.find((c) => c.id === article.category_id) ?? null
      : null;

  // 5) In-category nav
  let inCategory: { id: string; slug: string; title: string; updated_at: string | null }[] =
    [];

  if (article.category_id) {
    const { data: inCatRaw } = await supabase
      .from("governance_articles")
      .select("id,slug,title,updated_at,category_id")
      .eq("is_published", true)
      .eq("category_id", article.category_id)
      .order("title", { ascending: true });

    inCategory = Array.isArray(inCatRaw)
      ? (inCatRaw as any[]).map((x) => ({
          id: safeStr(x.id),
          slug: safeStr(x.slug),
          title: safeStr(x.title),
          updated_at: x.updated_at ?? null,
        }))
      : [];
  }

  const currentSlug = safeStr(article.slug);
  const idx = inCategory.findIndex((x) => x.slug === currentSlug);
  const prev = idx > 0 ? inCategory[idx - 1] : null;
  const next = idx >= 0 && idx < inCategory.length - 1 ? inCategory[idx + 1] : null;

  // 6) Related
  let related: { slug: string; title: string; updated_at: string | null }[] = [];
  if (article.category_id) {
    related = inCategory
      .filter((x) => x.slug !== currentSlug)
      .slice(0, 6)
      .map((x) => ({ slug: x.slug, title: x.title, updated_at: x.updated_at }));
  } else {
    const { data: relRaw } = await supabase
      .from("governance_articles")
      .select("slug,title,updated_at")
      .eq("is_published", true)
      .order("updated_at", { ascending: false })
      .limit(6);

    related = Array.isArray(relRaw)
      ? (relRaw as any[])
          .filter((x) => safeStr(x.slug) !== currentSlug)
          .map((x) => ({
            slug: safeStr(x.slug),
            title: safeStr(x.title),
            updated_at: x.updated_at ?? null,
          }))
      : [];
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/governance" className="text-sm opacity-70 hover:opacity-100">
          ← Back to Governance Hub
        </Link>

        <div className="flex items-center gap-2 text-xs">
          {activeCategory ? (
            <Link
              href={`/governance?cat=${encodeURIComponent(activeCategory.slug)}`}
              className="rounded-full border px-2 py-1 opacity-80 hover:opacity-100"
              title="View category"
            >
              {activeCategory.name}
            </Link>
          ) : null}
          {updated ? (
            <span className="rounded-full border px-2 py-1 opacity-70">Updated {updated}</span>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[300px_1fr]">
        <aside className="rounded-2xl border bg-white/60 p-4 shadow-sm backdrop-blur dark:bg-white/5">
          <div className="mb-3 text-sm font-medium">Knowledge Base</div>

          <Link
            href="/governance"
            className="mb-3 inline-flex w-full items-center justify-between rounded-xl border bg-white/70 px-3 py-2 text-sm shadow-sm hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <span>Browse all guidance</span>
            <span className="text-xs opacity-70">→</span>
          </Link>

          {categories.length ? (
            <div className="mt-2">
              <div className="mb-2 text-xs font-medium opacity-70">Categories</div>
              <div className="flex flex-col gap-1">
                {categories.map((c) => {
                  const isActive = activeCategory?.id === c.id;
                  return (
                    <Link
                      key={c.id}
                      href={`/governance?cat=${encodeURIComponent(c.slug)}`}
                      className={[
                        "rounded-lg px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10",
                        isActive ? "bg-black/5 dark:bg-white/10" : "",
                      ].join(" ")}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="truncate">{c.name}</span>
                        {isActive ? (
                          <span className="rounded-md border px-2 py-0.5 text-xs opacity-70">
                            Active
                          </span>
                        ) : null}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ) : null}

          {activeCategory && inCategory.length ? (
            <div className="mt-5">
              <div className="mb-2 text-xs font-medium opacity-70">
                In {activeCategory.name}
              </div>
              <div className="max-h-[320px] overflow-auto rounded-xl border bg-white/70 p-2 dark:bg-white/5">
                {inCategory.map((a) => {
                  const isCurrent = a.slug === currentSlug;
                  return (
                    <Link
                      key={a.id}
                      href={`/governance/${encodeURIComponent(a.slug)}`}
                      className={[
                        "block rounded-lg px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10",
                        isCurrent ? "bg-black/5 dark:bg-white/10" : "",
                      ].join(" ")}
                      title={a.title}
                    >
                      <div className="truncate font-medium">{a.title}</div>
                      {a.updated_at ? (
                        <div className="mt-0.5 text-xs opacity-60">
                          Updated {fmtUpdated(a.updated_at)}
                        </div>
                      ) : null}
                    </Link>
                  );
                })}
              </div>

              <div className="mt-3 grid grid-cols-1 gap-2">
                {prev ? (
                  <Link
                    href={`/governance/${encodeURIComponent(prev.slug)}`}
                    className="rounded-xl border bg-white/70 px-3 py-2 text-sm hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    <div className="text-xs opacity-70">Previous</div>
                    <div className="truncate font-medium">{prev.title}</div>
                  </Link>
                ) : null}

                {next ? (
                  <Link
                    href={`/governance/${encodeURIComponent(next.slug)}`}
                    className="rounded-xl border bg-white/70 px-3 py-2 text-sm hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    <div className="text-xs opacity-70">Next</div>
                    <div className="truncate font-medium">{next.title}</div>
                  </Link>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-5 rounded-xl border bg-white/70 p-3 dark:bg-white/5">
            <div className="text-xs font-medium opacity-70">Ask Aliena</div>
            <div className="mt-1 text-sm opacity-80">
              Get governance guidance tailored to this article.
            </div>

            <div className="mt-3">
              <AskAlienaDrawer
                articleSlug={currentSlug}
                articleTitle={title}
                triggerClassName="inline-flex w-full items-center justify-between rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                triggerLabel={`Ask about “${title}” →`}
              />
            </div>
          </div>
        </aside>

        <main>
          <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur dark:bg-white/5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
                {summary ? (
                  <p className="mt-3 max-w-3xl text-base leading-relaxed opacity-80">
                    {summary}
                  </p>
                ) : null}

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border bg-white/60 px-2.5 py-1 text-xs opacity-80 dark:bg-white/5">
                    KB Article
                  </span>
                  <span className="rounded-lg border bg-white/60 px-2.5 py-1 text-xs opacity-80 dark:bg-white/5">
                    Slug: {currentSlug}
                  </span>
                </div>
              </div>

              <div className="shrink-0">
                <AskAlienaDrawer
                  articleSlug={currentSlug}
                  articleTitle={title}
                  triggerClassName="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                  triggerLabel="Ask Aliena →"
                />
              </div>
            </div>
          </div>

          <div className="mt-6 rounded-2xl border bg-white/60 p-6 shadow-sm backdrop-blur dark:bg-white/5">
            <article className="prose prose-neutral dark:prose-invert max-w-none">
              {contentText ? <div className="whitespace-pre-wrap">{contentText}</div> : <p />}
            </article>
          </div>

          {related.length ? (
            <div className="mt-6 rounded-2xl border bg-white/60 p-5 shadow-sm backdrop-blur dark:bg-white/5">
              <div className="mb-3 text-sm font-medium">Related guidance</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {related.map((r) => (
                  <Link
                    key={r.slug}
                    href={`/governance/${encodeURIComponent(r.slug)}`}
                    className="rounded-xl border bg-white/70 p-4 shadow-sm hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
                  >
                    <div className="truncate font-semibold">{r.title}</div>
                    {r.updated_at ? (
                      <div className="mt-1 text-xs opacity-70">
                        Updated {fmtUpdated(r.updated_at)}
                      </div>
                    ) : null}
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
