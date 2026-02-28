import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function normSlug(x: unknown) {
  const raw = safeStr(x);
  try {
    return decodeURIComponent(raw).trim().toLowerCase();
  } catch {
    return raw.trim().toLowerCase();
  }
}

function fmtUpdated(x: unknown) {
  const s = safeStr(x);
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  content: string | null;
  updated_at: string | null;
  is_published: boolean;
  category_id: string | null;
  governance_categories?: { id: string; slug: string; name: string } | null;
};

export default async function GovernanceArticlePage({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>;
}) {
  const p = await Promise.resolve(params as any);
  const slug = normSlug(p?.slug);

  if (!slug) return notFound();

  const supabase = await createClient();

  // NOTE: Keep auth fetch out of prod logs; RLS should allow published KB reads if desired.
  // If you need diagnosis, add ?debug=1 and re-enable logging intentionally.
  const { data: article, error } = await supabase
    .from("governance_articles")
    .select(
      `
      id,
      slug,
      title,
      summary,
      content,
      updated_at,
      is_published,
      category_id,
      governance_categories:category_id (
        id,
        slug,
        name
      )
    `
    )
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) {
    // Fail loudly (server error) because blank KB pages are unacceptable in prod
    throw new Error(`Failed to load governance article: ${error.message}`);
  }

  if (!article) return notFound();

  const a = article as unknown as ArticleRow;

  const categoryName = safeStr(a?.governance_categories?.name);
  const categorySlug = safeStr(a?.governance_categories?.slug);

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 16px" }}>
      <div style={{ marginBottom: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
        <Link href="/governance" style={{ textDecoration: "none" }}>
          ← Back to Governance Hub
        </Link>

        {/* Optional convenience links */}
        <span style={{ opacity: 0.5 }}>•</span>
        <Link
          href={`/governance?ask=help&article=${encodeURIComponent(a.slug)}`}
          style={{ textDecoration: "none" }}
          title="Ask Aliena about this article"
        >
          Ask Aliena →
        </Link>
      </div>

      <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: "0 0 8px" }}>{a.title}</h1>

      {a.summary ? (
        <p style={{ fontSize: 16, opacity: 0.85, margin: "0 0 18px" }}>{a.summary}</p>
      ) : null}

      <div style={{ fontSize: 14, opacity: 0.65, marginBottom: 22 }}>
        {categoryName ? (
          <span>
            {categorySlug ? (
              <Link
                href={`/governance?cat=${encodeURIComponent(categorySlug)}`}
                style={{ textDecoration: "none" }}
                title={`View all in ${categoryName}`}
              >
                {categoryName}
              </Link>
            ) : (
              <span>{categoryName}</span>
            )}
          </span>
        ) : null}

        {a.updated_at ? (
          <span>
            {categoryName ? " • " : ""}
            Updated {fmtUpdated(a.updated_at)}
          </span>
        ) : null}
      </div>

      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 16 }}>{a.content ?? ""}</div>

      {/* Enterprise touch: CTA footer */}
      <div
        style={{
          marginTop: 28,
          borderTop: "1px solid rgba(0,0,0,0.08)",
          paddingTop: 18,
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          opacity: 0.9,
        }}
      >
        <div style={{ fontSize: 13, opacity: 0.7 }}>
          Use this as your delivery standard. Need controls / audit evidence / escalation triggers?
        </div>
        <Link
          href={`/governance?ask=help&article=${encodeURIComponent(a.slug)}`}
          style={{
            textDecoration: "none",
            border: "1px solid rgba(0,0,0,0.15)",
            borderRadius: 10,
            padding: "8px 10px",
            fontSize: 13,
          }}
        >
          Ask Aliena (this article) →
        </Link>
      </div>
    </div>
  );
}