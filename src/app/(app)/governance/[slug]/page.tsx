//src/app(app)governance/[slug]/page.tsx
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

export default async function GovernanceArticlePage({
  params,
}: {
  params: { slug: string } | Promise<{ slug: string }>;
}) {
  console.log("GOVSLUG_PROD_FINGERPRINT_v1");

  const p = await Promise.resolve(params as any);
  const slug = normSlug(p?.slug);

  console.log("[governance][slug] HIT", { slug, raw: p?.slug });

  if (!slug) return notFound();

}
  const supabase = await createClient();

  // Diagnose session/RLS behaviour in prod
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  console.log("[governance][slug] AUTH", {
    hasUser: !!auth?.user,
    email: auth?.user?.email ?? null,
    userId: auth?.user?.id ?? null,
    authErr: authErr?.message ?? null,
  });

  const { data: article, error } = await supabase
    .from("governance_articles")
    .select("id,slug,title,summary,content,category,updated_at,is_published")
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();

  if (error) {
    console.error("[governance][slug] DB ERROR", { slug, error });
    throw new Error(`Failed to load governance article: ${error.message}`);
  }

  if (!article) {
    console.warn("[governance][slug] NOT FOUND", { slug });
    return notFound();
  }

  return (
    <div style={{ maxWidth: 980, margin: "0 auto", padding: "32px 16px" }}>
      <div style={{ marginBottom: 18 }}>
        <Link href="/governance" style={{ textDecoration: "none" }}>
          ← Back to Governance Hub
        </Link>
      </div>

      <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: "0 0 8px" }}>
        {article.title}
      </h1>

      {article.summary ? (
        <p style={{ fontSize: 16, opacity: 0.85, margin: "0 0 18px" }}>
          {article.summary}
        </p>
      ) : null}

      <div style={{ fontSize: 14, opacity: 0.65, marginBottom: 22 }}>
        {article.category ? <span>{article.category}</span> : null}
        {article.updated_at ? (
          <span>
            {article.category ? " • " : ""}
            Updated{" "}
            {new Date(article.updated_at).toLocaleString("en-GB", {
              year: "numeric",
              month: "short",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        ) : null}
      </div>

      <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: 16 }}>
        {article.content ?? ""}
      </div>
    </div>
  );
}