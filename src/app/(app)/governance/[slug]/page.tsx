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

function normSlug(x: unknown) {
  return decodeURIComponent(safeStr(x)).trim().toLowerCase();
}

function fmtUpdated(x: unknown) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
  });
}

function normalizeNewlines(s: string) {
  // prevent SSR/CSR mismatch (CRLF vs LF)
  return s.replace(/\r\n?/g, "\n");
}

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
  content: string | null;
  category_id: string | null;
  updated_at: string | null;
  is_published: boolean;
};

/* ---------------- page ---------------- */

export default async function GovernanceArticlePage({ params }: PageProps) {
  const slug = normSlug(params?.slug);
  if (!slug) return notFound();

  const supabase = await createClient();

  // 1) Load article
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

  if (!article) {
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

  const title = safeStr(article.title);
  const summary = safeStr(article.summary);
  const content = normalizeNewlines(safeStr(article.content));
  const updated = fmtUpdated(article.updated_at);

  // 2) Load categories (for sidebar)
  const { data: catsRaw } = await supabase
    .from("governance_categories")
    .select("id,slug,name,description,sort_order,icon,is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const categories: CatRow[] = Array.isArray(catsRaw) ? (catsRaw as CatRow[]) : [];

  // Determine active category
  const activeCategory =
    article.category_id && categories.length
      ? categories.find((c) => c.id === article.category_id) ?? null
      : null;

  // 3) Load articles in same category (for in-category nav + prev/next)
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

  const idx = inCategory.findIndex((x) => x.slug === slug);
  const prev = idx > 0 ? inCategory[idx - 1] : null;
  const next = idx >= 0 && idx < inCategory.length - 1 ? inCategory[idx + 1] : null;

  // 4) Related (fallback): if no category_id, show “recent” published
  let related: { slug: string; title: string; updated_at: string | null }[] = [];
  if (article.category_id) {
    related = inCategory
      .filter((x) => x.slug !== slug)
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
          .filter((x) => safeStr(x.slug) !== slug)
          .map((x) => ({
            slug: safeStr(x.slug),
            title: safeStr(x.title),
            updated_at: x.updated_at ?? null,
          }))
      : [];
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Top bar */}
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
        {/* Sidebar */}
        <aside className="rounded-2xl border bg-white/60 p-4 shadow-sm backdrop-blur dark:bg-white/5">
          <div className="mb-3 text-sm font-medium">Knowledge Base</div>

          <Link
            href="/governance"
            className="mb-3 inline-flex w-full items-center justify-between rounded-xl border bg-white/70 px-3 py-2 text-sm shadow-sm hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
          >
            <span>Browse all guidance</span>
            <span className="text-xs opacity-70">→</span>
          </Link>

          {/* Categories */}
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

          {/* In-category navigation */}
          {activeCategory && inCategory.length ? (
            <div className="mt-5">
              <div className="mb-2 text-xs font-medium opacity-70">
                In {activeCategory.name}
              </div>
              <div className="max-h-[320px] overflow-auto rounded-xl border bg-white/70 p-2 dark:bg-white/5">
                {inCategory.map((a) => {
                  const isCurrent = a.slug === slug;
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

              {/* Prev/Next */}
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

          {/* Ask Aliena (drawer trigger) */}
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
        </aside>

        {/* Article */}
        <main>
          {/* Executive header card */}
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
                    Slug: {safeStr(article.slug)}
                  </span>
                </div>
              </div>

              {/* Header Ask Aliena */}
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

          {/* Body */}
          <div className="mt-6 rounded-2xl border bg-white/60 p-6 shadow-sm backdrop-blur dark:bg-white/5">
            <article className="prose prose-neutral dark:prose-invert max-w-none">
              {content ? <div className="whitespace-pre-wrap">{content}</div> : <p />}
            </article>
          </div>

          {/* Related */}
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