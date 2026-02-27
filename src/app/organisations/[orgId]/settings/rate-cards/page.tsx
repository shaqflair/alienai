import "server-only";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getResourceRates, getOrgMembersForPicker } from "@/app/actions/resource-rates";
import RateCardTab from "@/components/settings/RateCardTab";

export const runtime   = "nodejs";
export const dynamic   = "force-dynamic";
export const revalidate = 0;

type Props = {
  params: { orgId: string };
};

export default async function RateCardsPage({ params }: Props) {
  const { orgId } = params;
  const supabase  = await createClient();

  // Auth check
  const { data: { user }, error: authErr } = await supabase.auth.getUser();
  if (authErr || !user) redirect("/login");

  // Check membership + role
  const { data: membership, error: memErr } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr || !membership) notFound();

  const isAdmin = membership.role === "admin" || membership.role === "owner";

  // Fetch data in parallel
  const [rates, members] = await Promise.all([
    getResourceRates(orgId),
    getOrgMembersForPicker(orgId),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      {/* Breadcrumb / back link */}
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <a href={`/organisations/${orgId}/settings`} className="hover:text-gray-800 transition-colors">
          Organisation settings
        </a>
        <span>/</span>
        <span className="text-gray-800 font-medium">Rate Cards</span>
      </div>

      <RateCardTab
        organisationId={orgId}
        rates={rates}
        members={members}
        isAdmin={isAdmin}
      />
    </main>
  );
}