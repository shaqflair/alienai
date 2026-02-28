// src/app/(app)/governance/page.tsx
import "server-only";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import GovernanceSearchBox from "@/components/governance/GovernanceSearchBox";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Governance Hub | Aliena",
  description:
    "Delivery governance framework, roles, approvals, change control, and RAID discipline.",
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function firstStr(x: unknown) {
  if (Array.isArray(x)) return safeStr(x[0]);
  return safeStr(x);
}

function safeArr<T>(x: unknown) {
  return Array.isArray(x) ? (x as T[]) : [];
}

function normQuery(x: unknown) {
  const s = firstStr(x).trim();
  if (!s) return "";
  return s.length > 200 ? s.slice(0, 200) : s;
}

function normSlug(x: unknown) {
  return firstStr(x).trim().toLowerCase();
}

function fmtUpdated(x: unknown) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

type SearchParamsLike = Record<string, string | string[] | undefined> | Promise<Record<string, string | string[] | undefined>>;

type CatRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  sort_order: number;
  icon: string | null;
};

type CountRow = {
  category_id: string;
  category_slug: string;
  category_name: string;
  published_count: number;
};

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  category_id: string | null;
  updated_at: string | null;
};

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: SearchParamsLike;
}) {
  const sp = (await Promise.resolve(searchParams as any)) ?? {};
  const q = normQuery(sp.q);
  const cat = normSlug(sp.cat);

  const supabase = await createClient();

  // Categories
  const { data: catsRaw } = await supabase
    .from("governance_categories")
    .select("id,slug,name,description,sort_order,icon,is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const categories = safeArr<CatRow>(catsRaw);
  const activeCategory = cat ? categories.find((c) => c.slug === cat) ?? null : null;

  // Category counts (view) — safe fallback
  const countsByCatId = new Map<string, number>();
  try {
    const { data: countsRaw } = await supabase
      .from("v_governance_category_counts")
      .select("category_id,category_slug,category_name,published_count");

    const counts = safeArr<CountRow>(countsRaw);
    for (const r of counts) countsByCatId.set(r.category_id, Number(r.published_count) || 0);
  } catch {
    // ignore — fallback derived counts below
  }

  // Articles
  let articlesQ = supabase
    .from("governance_articles")
    .select("id,slug,title,summary,category_id,updated_at")
    .eq("is_published", true);

  if (activeCategory?.id) articlesQ = articlesQ.eq("category_id", activeCategory.id);

  if (q) {
    const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    articlesQ = articlesQ.or(`title.ilike.${like},summary.ilike.${like},content.ilike.${like}`);
  }

  const { data: artsRaw } = await articlesQ.order("title", { ascending: true });
  const articles = safeArr<ArticleRow>(artsRaw);

  // Fallback counts if view missing
  if (countsByCatId.size === 0) {
    for (const a of articles) {
      if (!a.category_id) continue;
      countsByCatId.set(a.category_id, (countsByCatId.get(a.category_id) ?? 0) + 1);
    }
  }

  const pageTitle = "Governance Knowledge Base";
  const pageSubtitle =
    "Boardroom-grade governance guidance: delivery discipline, approvals discipline, change control, RAID, and financial governance — all in one place.";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur dark:bg-white/5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{pageTitle}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed opacity-75">{pageSubtitle}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-lg border bg-white/60 px-2.5 py-1 opacity-80 dark:bg-white/5">
                Published: {articles.length}
              </span>
              {activeCategory ? (
                <span className="rounded-lg border bg-white/60 px-2.5 py-1 opacity-80 dark:bg-white/5">
                  Category: {activeCategory.name}
                </span>
              ) : null}
              {q ? (
                <span className="rounded-lg border bg-white/60 px-2.5 py-1 opacity-80 dark:bg-white/5">
                  Search: “{q}”
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              href="/governance?ask=help"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
              title="Ask Aliena about governance"
            >
              Ask Aliena →
            </Link>
          </div>
        </div>

        {/* Instant search (client) */}
        <div className="mt-5">
          <GovernanceSearchBox initialQ={q} categorySlug={activeCategory?.slug ?? null} />
          {q || activeCategory ? (
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <Link
                href="/governance"
                className="inline-flex rounded-lg border px-3 py-1.5 opacity-80 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
              >
                Clear filters
              </Link>
              {activeCategory ? (
                <Link
                  href="/governance"
                  className="inline-flex rounded-lg border px-3 py-1.5 opacity-80 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
                >
                  All categories
                </Link>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {/* Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <aside className="rounded-2xl border bg-white/60 p-4 shadow-sm backdrop-blur dark:bg-white/5">
          <div className="mb-3 text-sm font-medium">Categories</div>

          <div className="flex flex-col gap-1">
            <Link
              href="/governance"
              className={[
                "rounded-lg px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10",
                !activeCategory ? "bg-black/5 dark:bg-white/10" : "",
              ].join(" ")}
            >
              All guidance
            </Link>

            {categories.map((c) => {
              const isActive = activeCategory?.slug === c.slug;
              const href = `/governance?cat=${encodeURIComponent(c.slug)}`;
              const count = countsByCatId.get(c.id) ?? 0;

              return (
                <Link
                  key={c.id}
                  href={href}
                  className={[
                    "flex items-center justify-between rounded-lg px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10",
                    isActive ? "bg-black/5 dark:bg-white/10" : "",
                  ].join(" ")}
                >
                  <span className="truncate">{c.name}</span>
                  <span className="ml-3 rounded-md border px-2 py-0.5 text-xs opacity-75">
                    {count}
                  </span>
                </Link>
              );
            })}
          </div>

          <div className="mt-4 rounded-lg border bg-white/60 p-3 text-xs opacity-80 dark:bg-white/5">
            <div className="font-medium">Governance standard</div>
            <div className="mt-1 leading-relaxed">
              This KB is the operating model for delivery assurance, approvals discipline, and
              audit-ready governance inside Aliena.
            </div>
          </div>
        </aside>

        {/* Main */}
        <main className="rounded-2xl border bg-white/60 p-4 shadow-sm backdrop-blur dark:bg-white/5">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">Articles</div>
            <div className="text-xs opacity-70">
              {articles.length ? `${articles.length} result(s)` : "No results"}
            </div>
          </div>

          {articles.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {articles.map((a) => (
                <Link
                  key={a.id}
                  href={`/governance/${encodeURIComponent(a.slug)}`}
                  className="group rounded-xl border bg-white/70 p-4 shadow-sm transition hover:-translate-y-0.5 hover:bg-white/90 dark:bg-white/5 dark:hover:bg-white/10"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-base font-semibold">{safeStr(a.title)}</div>
                      {a.summary ? (
                        <div className="mt-1 line-clamp-2 text-sm opacity-75">
                          {safeStr(a.summary)}
                        </div>
                      ) : null}
                    </div>
                    <span className="shrink-0 rounded-lg border px-2 py-1 text-xs opacity-70 group-hover:opacity-90">
                      Open →
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs opacity-70">
                    {a.updated_at ? (
                      <span className="rounded-md border px-2 py-0.5">
                        Updated {fmtUpdated(a.updated_at)}
                      </span>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border bg-white/70 p-6 text-sm opacity-80 dark:bg-white/5">
              No articles matched your filters.
              <div className="mt-3 flex gap-2">
                <Link
                  href="/governance"
                  className="inline-flex rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  View all
                </Link>
                <Link
                  href="/governance?ask=help"
                  className="inline-flex rounded-lg border px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
                >
                  Ask Aliena
                </Link>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}