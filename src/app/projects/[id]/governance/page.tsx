// src/app/projects/[id]/governance/page.tsx
import "server-only";

import GovernanceHubClient from "@/components/governance/GovernanceHubClient";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default async function ProjectGovernancePage({
  params,
}: {
  params: { id: string };
}) {
  const projectId = safeStr(params?.id).trim();

  const supabase = await createClient();

  // DB-driven KB articles (published) + category join for label display
  const { data, error } = await supabase
    .from("governance_articles")
    .select(
      `
      id,
      slug,
      title,
      summary,
      updated_at,
      content,
      category_id,
      governance_categories!left (
        slug,
        name
      )
    `
    )
    .eq("is_published", true)
    .order("title", { ascending: true });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("Project governance hub load failed:", { error });
    }
  }

  const articles = (Array.isArray(data) ? data : []).map((a: any) => ({
    id: safeStr(a?.id),
    slug: safeStr(a?.slug),
    title: safeStr(a?.title),
    summary: a?.summary ?? null,
    updated_at: a?.updated_at ?? null,
    content: a?.content ?? null,
    // Optional labels (if your client wants them later)
    category: safeStr(a?.governance_categories?.slug) || null,
    category_name: safeStr(a?.governance_categories?.name) || null,
  }));

  return (
    <GovernanceHubClient
      scope="project"
      projectId={projectId}
      articles={articles}
    />
  );
}