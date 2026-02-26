import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getGovernanceArticle } from "@/lib/governance/kb";
import GovernanceKbArticleClient from "@/components/governance/GovernanceKbArticleClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function GovernanceKbSlugPage({
  params,
}: {
  params: { slug: string };
}) {
  const slug = typeof params?.slug === "string" ? params.slug : "";
  const article = getGovernanceArticle(slug);

  if (!article) notFound();

  return (
    <div id="top" className="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-10">
      <div className="mb-6 flex flex-wrap items-center gap-2 text-xs text-neutral-500">
        <Link
          href="/governance"
          className="hover:text-neutral-700 transition-colors"
        >
          Governance
        </Link>
        <span className="text-neutral-300">/</span>
        <span className="text-neutral-700 font-medium">{article.title}</span>
      </div>

      <GovernanceKbArticleClient article={article} />
    </div>
  );
}