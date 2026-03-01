import "server-only";

import { notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import GovernanceKbArticleClient, {
  GovernanceArticleClientModel,
  GovernanceArticleNav,
} from "@/components/governance/GovernanceKbArticleClient";

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

type ArticleRow = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
  content: unknown | null;
  updated_at: string | null;
  is_published: boolean;
};

type NavRow = { slug: string; title: string; summary: string | null };

function toNav(r: any): GovernanceArticleNav {
  if (!r) return null;
  const slug = safeStr(r.slug).trim();
  const title = safeStr(r.title).trim();
  if (!slug || !title) return null;
  return { slug, title, summary: r.summary ?? null };
}

export default async function GovernanceArticlePage({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>;
}) {
  const p = await Promise.resolve(params as any);
  const slug = normSlug(p?.slug);
  if (!slug) return notFound();

  const supabase = await createClient();

  const { data: article, error } = await supabase
    .from("governance_articles")
    .select("id,slug,title,summary,content,updated_at,is_published")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) throw new Error(`Failed to load governance article: ${error.message}`);
  if (!article) return notFound();

  const a = article as unknown as ArticleRow;

  const clientArticle: GovernanceArticleClientModel = {
    id: safeStr(a.id),
    slug: safeStr(a.slug),
    title: safeStr(a.title) || safeStr(a.slug),
    summary: a.summary ?? null,
    updated_at: a.updated_at ?? null,
    content: a.content ?? null,
  };

  // Prev/Next ordering by title (stable & simple)
  let nav: { prev: GovernanceArticleNav; next: GovernanceArticleNav } | undefined = undefined;
  try {
    const { data: allRaw } = await supabase
      .from("governance_articles")
      .select("slug,title,summary")
      .eq("is_published", true)
      .order("title", { ascending: true });

    const all = Array.isArray(allRaw) ? (allRaw as NavRow[]) : [];
    const idx = all.findIndex((r) => safeStr(r.slug).trim().toLowerCase() === slug);
    if (idx >= 0) {
      nav = { prev: toNav(all[idx - 1] ?? null), next: toNav(all[idx + 1] ?? null) };
    }
  } catch {
    // nav optional
  }

  return <GovernanceKbArticleClient article={clientArticle} nav={nav} />;
}