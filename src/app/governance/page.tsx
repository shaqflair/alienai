//src/app/governance/page.tsx
import "server-only";

import GovernanceHubClient from "@/components/governance/GovernanceHubClient";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function GovernancePage() {
  return <GovernanceHubClient scope="global" />;
}
