// src/app/(app)/governance/page.tsx
// Governance Knowledge Base — hub listing page (production, server-rendered)
import "server-only";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";

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

function safeArr<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

function normQuery(x: unknown) {
  const s = safeStr(x).trim();
  return s.length > 200 ? s.slice(0, 200) : s;
}

function normSlug(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function fmtUpdated(x: unknown) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit" });
}

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

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
  category_id: string | null;
  category: string | null; // legacy text (kept for safety)
  updated_at: string | null;
};

export default async function GovernancePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = (await searchParams) ?? {};
  const q = normQuery(sp.q);
  const cat = normSlug(sp.cat);

  const supabase = await createClient();

  // Categories (new model)
  const { data: catsRaw } = await supabase
    .from("governance_categories")
    .select("id,slug,name,description,sort_order,icon,is_active")
    .eq("is_active", true)
    .order("sort_order", { ascending: true })
    .order("name", { ascending: true });

  const categories = safeArr<CatRow>(catsRaw);

  // Resolve category filter → category_id
  const activeCategory = cat
    ? categories.find((c) => c.slug === cat) ?? null
    : null;

  // Fetch articles (published) — filter by category and/or query
  let articlesQ = supabase
    .from("governance_articles")
    .select("id,slug,title,summary,category_id,category,updated_at")
    .eq("is_published", true);

  if (activeCategory?.id) {
    articlesQ = articlesQ.eq("category_id", activeCategory.id);
  }

  if (q) {
    // Server-side search (ILIKE) — upgrade to FTS later
    const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
    articlesQ = articlesQ.or(
      `title.ilike.${like},summary.ilike.${like},content.ilike.${like}`
    );
  }

  const { data: artsRaw, error: artsErr } = await articlesQ.order("title", {
    ascending: true,
  });

  if (artsErr && process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.error("Governance hub load failed:", artsErr);
  }

  const articles = safeArr<ArticleRow>(artsRaw);

  // Compute category counts from the full published article set
  // (To keep it simple and RLS-safe, we compute counts from what we loaded.)
  const countsByCatId = new Map<string, number>();
  for (const a of articles) {
    if (!a.category_id) continue;
    countsByCatId.set(a.category_id, (countsByCatId.get(a.category_id) ?? 0) + 1);
  }

  const pageTitle = "Governance Knowledge Base";
  const pageSubtitle =
    "Boardroom-grade governance guidance: delivery discipline, approvals, change control, RAID, and financial governance — all in one place.";

  return (
    <div className="mx-auto max-w-7xl px-6 py-10">
      {/* Header */}
      <div className="mb-8 rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur dark:bg-white/5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">{pageTitle}</h1>
            <p className="mt-2 max-w-3xl text-sm leading-relaxed opacity-75">
              {pageSubtitle}
            </p>

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

        {/* Search bar (server-driven) */}
        <form className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            type="text"
            name="q"
            defaultValue={q}
            placeholder="Search governance guidance (e.g., “SLA breach”, “change approval”, “risk escalation”)…"
            className="w-full rounded-lg border bg-white/60 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/10 dark:bg-white/5 dark:focus:ring-white/10"
          />
          {activeCategory ? (
            <input type="hidden" name="cat" value={activeCategory.slug} />
          ) : null}
          <button
            type="submit"
            className="inline-flex shrink-0 items-center justify-center rounded-lg border px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            Search
          </button>
          {(q || activeCategory) ? (
            <Link
              href="/governance"
              className="inline-flex shrink-0 items-center justify-center rounded-lg border px-4 py-2 text-sm opacity-80 hover:opacity-100 hover:bg-black/5 dark:hover:bg-white/10"
            >
              Clear
            </Link>
          ) : null}
        </form>
      </div>

      {/* Layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[280px_1fr]">
        {/* Sidebar */}
        <aside <main className="relative rounded-2xl border bg-white/60 p-4 shadow-sm backdrop-blur dark:bg-white/5">
          <div className="mb-3 text-sm font-medium">Categories</div>

          <div className="flex flex-col gap-1">
            <Link
              href={q ? `/governance?q=${encodeURIComponent(q)}` : "/governance"}
              className={[
                "rounded-lg px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10",
                !activeCategory ? "bg-black/5 dark:bg-white/10" : "",
              ].join(" ")}
            >
              All guidance
            </Link>

            {categories.map((c) => {
              const isActive = activeCategory?.slug === c.slug;
              const href = q
                ? `/governance?cat=${encodeURIComponent(c.slug)}&q=${encodeURIComponent(q)}`
                : `/governance?cat=${encodeURIComponent(c.slug)}`;

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
              This KB is the operating model for delivery assurance, approvals discipline,
              and audit-ready governance inside Aliena.
            </div>
          </div>
        </aside>

        {/* Main */}
        <main <main className="relative rounded-2xl border bg-white/60 p-4 shadow-sm backdrop-blur dark:bg-white/5">
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
                      <div className="truncate text-base font-semibold">
                        {safeStr(a.title)}
                      </div>
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
                    {activeCategory ? (
                      <span className="rounded-md border px-2 py-0.5">
                        {activeCategory.name}
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