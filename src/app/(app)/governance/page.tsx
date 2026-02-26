// src/app/(app)/governance/page.tsx
// Governance Knowledge Base — hub listing page
import "server-only";

import GovernanceHubClient from "@/components/governance/GovernanceHubClient";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export const metadata = {
  title: "Governance Hub | Aliena",
  description:
    "Delivery governance framework, roles, approvals, change control, and RAID discipline.",
};

export default async function GovernancePage() {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("governance_articles")
    .select("id,slug,title,summary,category,updated_at,content")
    .eq("is_published", true)
    .order("title", { ascending: true });

  if (error) {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("Governance hub load failed:", error);
    }
  }

  return <GovernanceHubClient scope="global" articles={Array.isArray(data) ? data : []} />;
}