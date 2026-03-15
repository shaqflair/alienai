import "server-only";

import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default async function ArtifactApprovalTimelineRedirectPage({
  params,
}: {
  params: Promise<{ id?: string; artifactId?: string }>;
}) {
  const p = await params;

  const id = safeStr(p?.id).trim();
  const artifactId = safeStr(p?.artifactId).trim();

  if (!id || !artifactId) {
    redirect("/projects");
  }

  redirect(
    `/projects/${encodeURIComponent(id)}/approvals/timeline?artifactId=${encodeURIComponent(artifactId)}`
  );
}
