import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import OnboardingWizard from "./_components/OnboardingWizard";
import ProfileSetupForm from "./_components/ProfileSetupForm";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Get started | Aliena" };

export default async function OnboardingPage() {
  const supabase = await createClient();

  // 1. Authenticate
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) {
    redirect("/login?next=/onboarding");
  }

  // 2. Check org membership
  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .limit(1);

  if (memberships && memberships.length > 0) {
    // User already belongs to an org.
    // Check if they have completed their profile (job_title is the signal).
    const { data: profile } = await supabase
      .from("profiles")
      .select("job_title, full_name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profile?.job_title) {
      // Profile complete -- go to dashboard
      // Use absolute path to avoid relative redirect resolving to /onboarding/
      redirect("/");
    }

    // Has org membership but no profile fields -- show profile setup
    const initialName = profile?.full_name || user.user_metadata?.full_name || user.email || "";
    return <ProfileSetupForm initialName={initialName} />;
  }

  // 3. No org yet -- show the original org creation wizard
  return (
    <OnboardingWizard
      userEmail={user.email ?? ""}
      userName={user.user_metadata?.full_name ?? user.email ?? ""}
    />
  );
}