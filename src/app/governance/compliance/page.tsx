import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ComplianceDashboard from "@/components/ComplianceDashboard";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Governance Compliance | Aliena",
  description: "Organisation-wide governance compliance dashboard",
};

function safeStr(x: any) { return typeof x === "string" ? x.trim() : x == null ? "" : String(x); }

export default async function GovernanceCompliancePage({
  searchParams,
}: {
  searchParams: { orgId?: string };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/governance/compliance");

  // Only admins can access — fetch their admin memberships
  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, organisations(id, name)")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .eq("role", "admin");

  if (!memberships?.length) {
    // Not an admin of any org
    redirect("/projects");
  }

  const orgId = safeStr(searchParams.orgId || (memberships[0] as any)?.organisation_id);
  const orgs  = memberships.map((m: any) => ({
    id:   safeStr(m.organisation_id),
    name: safeStr(m.organisations?.name || "Organisation"),
  }));

  return <ComplianceDashboard orgId={orgId} orgs={orgs} />;
}
