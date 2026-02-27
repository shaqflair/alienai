import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

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

/* ---------------- page ---------------- */

type PageProps = {
  params: Promise<{ slug: string }>;
};

export default async function GovernanceArticlePage({ params }: PageProps) {
  // ✅ Next.js 16: params is async
  const { slug: rawSlug } = await params;
  const slug = normSlug(rawSlug);
  if (!slug) return notFound();

  const supabase = await createClient();

  const { data: article, error } = await supabase
    .from("governance_articles")
    .select("id,slug,title,summary,content,category,updated_at,is_published")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  // Don’t hide real errors (RLS, schema, etc.)
  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-semibold">Unable to load governance article</h1>
        <p className="mt-2 text-sm opacity-70">
          A data error occurred while fetching this guidance page.
        </p>

        <div className="mt-6 rounded-lg border bg-white/60 p-4 text-sm dark:bg-white/5">
          <div className="font-medium">Error</div>
          <div className="mt-1 break-words opacity-80">{safeStr(error.message)}</div>
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
  const content = safeStr(article.content);
  const category = safeStr(article.category);
  const updated = fmtUpdated(article.updated_at);

  return (
    <div className="mx-auto max-w-5xl px-6 py-10">
      <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/governance" className="text-sm opacity-70 hover:opacity-100">
          ← Back to Governance Hub
        </Link>

        <div className="flex items-center gap-2 text-xs">
          {category ? (
            <span className="rounded-full border px-2 py-1 opacity-80">{category}</span>
          ) : null}
          {updated ? (
            <span className="rounded-full border px-2 py-1 opacity-70">Updated {updated}</span>
          ) : null}
        </div>
      </div>

      <div className="rounded-2xl border bg-white/70 p-6 shadow-sm backdrop-blur dark:bg-white/5">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        {summary ? (
          <p className="mt-3 max-w-3xl text-base leading-relaxed opacity-80">{summary}</p>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="rounded-lg border bg-white/60 px-2.5 py-1 text-xs opacity-80 dark:bg-white/5">
            KB Article
          </span>
          <span className="rounded-lg border bg-white/60 px-2.5 py-1 text-xs opacity-80 dark:bg-white/5">
            Slug: {safeStr(article.slug)}
          </span>

          <Link
            href={`/governance?ask=${encodeURIComponent(title)}`}
            className="ml-auto inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs hover:bg-black/5 dark:hover:bg-white/10"
            title="Ask Aliena about this article"
          >
            Ask Aliena →
          </Link>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border bg-white/60 p-6 shadow-sm backdrop-blur dark:bg-white/5">
        <article className="prose prose-neutral dark:prose-invert max-w-none">
          {content ? <pre className="whitespace-pre-wrap">{content}</pre> : <p />}
        </article>
      </div>
    </div>
  );
}