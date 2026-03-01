import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import OnboardingWizard from "./_components/OnboardingWizard";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Get started | ResForce" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  
  // 1. Authenticate the user
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    redirect("/login?next=/onboarding");
  }

  // 2. Guard: Skip if user already belongs to an organisation
  // We check the membership table to see if they are already part of a team.
  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .limit(1);

  if (memberships && memberships.length > 0) {
    // User is already set up, send them to the app home
    redirect("/?onboarding=skip");
  }

  // 3. Render the Client-Side Wizard
  return (
    <OnboardingWizard
      userEmail={user.email ?? ""}
      userName={user.user_metadata?.full_name ?? user.email ?? ""}
    />
  );
}
