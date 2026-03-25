import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import OnboardingWizard from "./_components/OnboardingWizard";
import ProfileSetupForm from "./_components/ProfileSetupForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Get started | Aliena" };

type OnboardingPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function first(v: string | string[] | undefined): string {
  if (Array.isArray(v)) return v[0] ?? "";
  return v ?? "";
}

function cleanParam(v: string): string {
  return v.trim();
}

export default async function OnboardingPage({ searchParams }: OnboardingPageProps) {
  const sp = (await searchParams) ?? {};
  const orgName = cleanParam(first(sp.org));
  const invitedRole = cleanParam(first(sp.role));

  const supabase = await createClient();

  // 1. Authenticate
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    const qs = new URLSearchParams();
    qs.set("next", "/onboarding");
    if (orgName) qs.set("org", orgName);
    if (invitedRole) qs.set("role", invitedRole);
    redirect(`/login?${qs.toString()}`);
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
      redirect("/");
    }

    // Has org membership but no profile fields — show profile setup
    const initialName =
      profile?.full_name ||
      user.user_metadata?.full_name ||
      user.email ||
      "";

    return (
      <ProfileSetupForm
        initialName={initialName}
        orgName={orgName || undefined}
        invitedRole={invitedRole || undefined}
      />
    );
  }

  // 3. No org yet — show original org creation wizard
  return (
    <OnboardingWizard
      userEmail={user.email ?? ""}
      userName={user.user_metadata?.full_name ?? user.email ?? ""}
    />
  );
}