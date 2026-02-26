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

  const { data, error } = await supabase
    .from("governance_articles")
    .select("id,slug,title,summary,category,updated_at,content")
    .eq("is_published", true)
    .order("title", { ascending: true });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("Project governance hub load failed:", { error });
    }
  }

  return (
    <GovernanceHubClient
      scope="project"
      projectId={projectId}
      articles={Array.isArray(data) ? data : []}
    />
  );
}