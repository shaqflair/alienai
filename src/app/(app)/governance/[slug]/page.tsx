// src/app/(app)/governance/[slug]/page.tsx
import "server-only";
import Link from "next/link";
import { notFound } from "next/navigation";

/**
 * Replace this with your real source (DB, MDX, etc.)
 * For now this makes the page NOT blank and proves routing works.
 */
const ARTICLES: Record<string, { title: string; description?: string; body: string }> = {
  "delivery-governance-framework": {
    title: "Delivery Governance Framework",
    description: "Enterprise delivery governance model used in Aliena.",
    body: `This is a placeholder. Replace with real content.

This framework defines how projects are governed across the delivery lifecycle.

Includes:
• Stage gates
• RAID discipline
• Change control
• Approval workflows
• Executive reporting
• AI-assisted delivery assurance
`,
  },

  "change-management": {
    title: "Change Management",
    description: "How change requests are raised, reviewed, approved, and audited.",
    body: `This is a placeholder. Replace with real content.`,
  },

  "risk-management": {
    title: "Risk Management",
    description: "How risks are logged, assessed, mitigated, and escalated.",
    body: `This is a placeholder. Replace with real content.`,
  },
};

type PageProps = { params: { slug: string } };

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function GovernanceArticlePage({ params }: PageProps) {
  const slug = decodeURIComponent(params?.slug || "").trim();
  if (!slug) notFound();

  const article = ARTICLES[slug];

  // If you prefer your current “article not found” UI, render that instead of notFound()
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

  return (
    <div className="mx-auto max-w-3xl px-6 py-12">
      <div className="mb-8">
        <Link href="/governance" className="text-sm opacity-70 hover:opacity-100">
          ← Back to Governance Hub
        </Link>
      </div>

      <h1 className="text-3xl font-semibold">{article.title}</h1>
      {article.description ? (
        <p className="mt-2 text-base opacity-70">{article.description}</p>
      ) : null}

      <article className="prose prose-neutral dark:prose-invert mt-8 max-w-none">
        <p>{article.body}</p>
      </article>
    </div>
  );
}