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
  const raw = safeStr(x).trim();
  if (!raw) return "";
  try {
    return decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

/* ---------------- page ---------------- */

export default async function GovernanceArticlePage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = normSlug(params?.slug);

  if (!slug) return notFound();

  const supabase = await createClient();

  const { data: article, error } = await supabase
    .from("governance_articles")
    .select("id,slug,title,summary,content,category,updated_at,is_published")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  // Don't silently convert real errors into "not found"
  if (error) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("Governance article fetch failed:", { slug, error });
    }
    throw error;
  }

  if (!article) return notFound();

  // Prev/Next based on published title ordering (stable + simple)
  const { data: allSlugs, error: listErr } = await supabase
    .from("governance_articles")
    .select("slug,title")
    .eq("is_published", true)
    .order("title", { ascending: true });

  if (listErr) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("Governance prev/next list failed:", { listErr });
    }
  }

  const items = Array.isArray(allSlugs) ? allSlugs : [];
  const idx = items.findIndex((x) => normSlug(x?.slug) === slug);
  const prev = idx > 0 ? items[idx - 1] : null;
  const next = idx >= 0 && idx < items.length - 1 ? items[idx + 1] : null;

  // Render content:
  // - If `content` is structured JSON: render sections
  // - Else treat as paragraphs split by blank lines
  let sections:
    | Array<{ heading?: string; body?: string[]; bullets?: string[] }>
    | null = null;

  if (article?.content && typeof article.content === "object") {
    const c: any = article.content;
    if (Array.isArray(c?.sections)) sections = c.sections;
  }

  const fallbackParagraphs =
    sections == null
      ? safeStr(article.content)
          .split(/\n{2,}/g)
          .map((p) => p.trim())
          .filter(Boolean)
      : [];

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/governance" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Back to Governance Hub
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{article.title}</h1>
      {article.summary ? <p className="mt-2 text-neutral-600">{article.summary}</p> : null}

      <div className="mt-8 space-y-8">
        {sections ? (
          sections.map((s, i) => (
            <section key={i}>
              {s?.heading ? <h2 className="text-lg font-semibold">{s.heading}</h2> : null}

              {Array.isArray(s?.body)
                ? s.body.map((p, idx2) => (
                    <p key={idx2} className="mt-2 text-sm text-neutral-700">
                      {p}
                    </p>
                  ))
                : null}

              {Array.isArray(s?.bullets) && s.bullets.length ? (
                <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-neutral-700">
                  {s.bullets.map((b, idx3) => (
                    <li key={idx3}>{b}</li>
                  ))}
                </ul>
              ) : null}
            </section>
          ))
        ) : (
          <section>
            {fallbackParagraphs.map((p, idx4) => (
              <p key={idx4} className="mt-2 text-sm text-neutral-700">
                {p}
              </p>
            ))}
          </section>
        )}
      </div>

      <div className="mt-12 flex justify-between text-sm">
        {prev ? (
          <Link href={`/governance/${encodeURIComponent(prev.slug)}`}>← {prev.title}</Link>
        ) : (
          <div />
        )}

        {next ? (
          <Link href={`/governance/${encodeURIComponent(next.slug)}`}>{next.title} →</Link>
        ) : null}
      </div>
    </div>
  );
}