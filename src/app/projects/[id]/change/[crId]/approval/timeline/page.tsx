import "server-only";

import { redirect } from "next/navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default async function ChangeApprovalTimelineRedirectPage({
  params,
}: {
  params: Promise<{ id?: string; crId?: string }>;
}) {
  const p = await params;

  const id = safeStr(p?.id).trim();
  const crId = safeStr(p?.crId).trim();

  if (!id || !crId) {
    redirect("/projects");
  }

  redirect(
    `/projects/${encodeURIComponent(id)}/approvals/timeline?changeId=${encodeURIComponent(crId)}`
  );
}
