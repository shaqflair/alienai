import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Issue = {
  severity: "warning";
  type: "duplicate_title_in_category" | "missing_category";
  title: string;
  detail: string;
  rows: any[];
};

function normTitle(x: unknown) {
  return String(x ?? "").trim().toLowerCase();
}

function normCat(x: unknown) {
  const s = String(x ?? "").trim();
  return s.length ? s : null;
}

export async function GET() {
  const supabase = await createClient();

  // Pull only what we need (published KB articles)
  const { data, error } = await supabase
    .from("governance_articles")
    .select("slug,title,category,is_published")
    .eq("is_published", true);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  const rows = (data ?? []).map((r) => ({
    slug: r.slug,
    title: r.title ?? "",
    category: normCat(r.category),
  }));

  const issues: Issue[] = [];

  // (2) Missing category (null/blank)
  const missingCategory = rows
    .filter((r) => !r.category)
    .map((r) => ({ slug: r.slug, title: r.title }));

  if (missingCategory.length) {
    issues.push({
      severity: "warning",
      type: "missing_category",
      title: "Uncategorised published articles",
      detail: "These articles have category null/blank. Assign a category to keep navigation clean.",
      rows: missingCategory,
    });
  }

  // (1) Duplicate titles in the same category (published)
  // Group by category + normalised title
  const dupMap = new Map<string, { category: string; title: string; slugs: string[] }>();

  for (const r of rows) {
    if (!r.category) continue; // skip uncategorised (they’re already flagged above)
    const key = `${r.category}::${normTitle(r.title)}`;
    const entry = dupMap.get(key) ?? { category: r.category, title: r.title, slugs: [] };
    entry.slugs.push(r.slug);
    dupMap.set(key, entry);
  }

  const duplicateTitles = Array.from(dupMap.values())
    .filter((x) => x.slugs.length > 1)
    .sort((a, b) => b.slugs.length - a.slugs.length)
    .map((x) => ({
      category: x.category,
      title: x.title,
      occurrences: x.slugs.length,
      slugs: x.slugs.sort(),
    }));

  if (duplicateTitles.length) {
    issues.push({
      severity: "warning",
      type: "duplicate_title_in_category",
      title: "Duplicate titles in the same category",
      detail: "Two or more published articles share the same title within a category (confusing in navigation + search).",
      rows: duplicateTitles,
    });
  }

  const warning = issues.length;

  return NextResponse.json({
    ok: true,
    summary: {
      status: warning > 0 ? "warning" : "ok",
      counts: { warning, total: warning },
    },
    issues,
  });
}