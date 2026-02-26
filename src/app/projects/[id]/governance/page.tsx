import "server-only";

import GovernanceHubClient from "@/components/governance/GovernanceHubClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ProjectGovernancePage({
  params,
}: {
  params: { id: string };
}) {
  const projectId = typeof params?.id === "string" ? params.id : "";
  return <GovernanceHubClient scope="project" projectId={projectId} />;
}