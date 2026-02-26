// src/app/(app)/governance/page.tsx
// Governance Knowledge Base — hub listing page
import "server-only";
import GovernanceHubClient from "@/components/governance/GovernanceHubClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Governance Hub | Aliena",
  description:
    "Delivery governance framework, roles, approvals, change control, and RAID discipline.",
};

export default function GovernancePage() {
  return <GovernanceHubClient scope="global" />;
}