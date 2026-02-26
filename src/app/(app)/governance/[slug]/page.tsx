import "server-only";

import Link from "next/link";
import { notFound } from "next/navigation";
import { getGovernanceArticle, getGovernancePrevNext } from "@/lib/governance/kb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function GovernanceArticlePage({ params }: { params: { slug: string } }) {
  const slug = decodeURIComponent(String(params?.slug || "")).trim();
  const article = getGovernanceArticle(slug);

  if (!article) return notFound();

  const { prev, next } = getGovernancePrevNext(article.slug);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/governance" className="text-sm text-neutral-500 hover:text-neutral-900">
        ← Back to Governance Hub
      </Link>

      <h1 className="mt-4 text-2xl font-semibold">{article.title}</h1>
      <p className="mt-2 text-neutral-600">{article.summary}</p>

      <div className="mt-8 space-y-8">
        {article.sections.map((s, i) => (
          <section key={i}>
            <h2 className="text-lg font-semibold">{s.heading}</h2>

            {s.body?.map((p, idx) => (
              <p key={idx} className="mt-2 text-sm text-neutral-700">
                {p}
              </p>
            ))}

            {s.bullets?.length ? (
              <ul className="mt-3 list-disc pl-5 text-sm text-neutral-700 space-y-1">
                {s.bullets.map((b, idx) => (
                  <li key={idx}>{b}</li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>

      <div className="mt-12 flex justify-between text-sm">
        {prev ? (
          <Link href={`/governance/${prev.slug}`}>← {prev.title}</Link>
        ) : <div />}

        {next ? (
          <Link href={`/governance/${next.slug}`}>{next.title} →</Link>
        ) : null}
      </div>
    </div>
  );
}