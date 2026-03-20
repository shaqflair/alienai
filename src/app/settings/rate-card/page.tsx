import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { loadRateCard } from "./rate-card-actions";
import RateCardManager from "./RateCardManager";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function RateCardPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const orgId = await getActiveOrgId();
  if (!orgId) redirect("/settings");

  // Check admin
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const role = String(mem?.role ?? "").toLowerCase();
  const isAdmin = role === "admin" || role === "owner";

  const entries = await loadRateCard(orgId);

  // Load org name
  const { data: org } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", orgId)
    .maybeSingle();

  return (
    <div style={{ maxWidth: 900, margin: "0 auto", padding: "32px 24px", fontFamily: "'DM Sans', -apple-system, sans-serif" }}>
      <RateCardManager
        orgId={orgId}
        orgName={String((org as any)?.name || "Your Organisation")}
        initialEntries={entries}
        isAdmin={isAdmin}
      />
    </div>
  );
}
