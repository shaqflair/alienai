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

type ManagerOption = {
  user_id: string;
  full_name: string;
  job_title: string | null;
  department: string | null;
};

export default async function OnboardingPage({
  searchParams,
}: OnboardingPageProps) {
  const sp = (await searchParams) ?? {};
  const orgName = cleanParam(first(sp.org));
  const invitedRole = cleanParam(first(sp.role));

  const supabase = await createClient();

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

  const { data: memberships } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, job_title, department, created_at")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .order("created_at", { ascending: false })
    .limit(1);

  if (memberships && memberships.length > 0) {
    const membership = memberships[0];
    const activeOrgId = membership.organisation_id as string;

    const { data: profile } = await supabase
      .from("profiles")
      .select(
        "user_id, full_name, job_title, department, employment_type, location, bio, line_manager_id"
      )
      .eq("user_id", user.id)
      .maybeSingle();

    const initialName =
      profile?.full_name || user.user_metadata?.full_name || user.email || "";

    const initialJobTitle = profile?.job_title || membership?.job_title || "";
    const initialDepartment =
      profile?.department || membership?.department || "";
    const initialEmploymentType =
      profile?.employment_type === "part_time" ||
      profile?.employment_type === "contractor"
        ? profile.employment_type
        : "full_time";
    const initialLocation = profile?.location || "";
    const initialBio = profile?.bio || "";
    const initialLineManagerId =
      typeof profile?.line_manager_id === "string" ? profile.line_manager_id : "";

    const { data: orgMembers } = await supabase
      .from("organisation_members")
      .select("user_id, job_title, department")
      .eq("organisation_id", activeOrgId)
      .is("removed_at", null);

    const managerUserIds = Array.from(
      new Set(
        (orgMembers ?? [])
          .map((m: any) => String(m.user_id || "").trim())
          .filter(Boolean)
      )
    );

    let managerProfiles: any[] = [];
    if (managerUserIds.length > 0) {
      const { data } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", managerUserIds);
      managerProfiles = data ?? [];
    }

    const profileByUserId = new Map<string, any>(
      managerProfiles.map((p: any) => [String(p.user_id), p])
    );

    const managerOptions: ManagerOption[] = (orgMembers ?? [])
      .map((m: any) => {
        const userId = String(m.user_id || "").trim();
        const p = profileByUserId.get(userId);
        return {
          user_id: userId,
          full_name: String(p?.full_name || "").trim() || "Unnamed user",
          job_title:
            typeof m?.job_title === "string" && m.job_title.trim()
              ? m.job_title.trim()
              : null,
          department:
            typeof m?.department === "string" && m.department.trim()
              ? m.department.trim()
              : null,
        };
      })
      .filter((m) => m.user_id && m.user_id !== user.id)
      .sort((a, b) => a.full_name.localeCompare(b.full_name));

    const departmentOptions = Array.from(
      new Set(
        (orgMembers ?? [])
          .map((m: any) =>
            typeof m?.department === "string" ? m.department.trim() : ""
          )
          .filter(Boolean)
      )
    ).sort((a, b) => a.localeCompare(b));

    const initialManager =
      managerOptions.find((m) => m.user_id === initialLineManagerId) ?? null;

    if (profile?.job_title && (membership?.job_title || membership?.department)) {
  redirect("/");
}
    return (
      <ProfileSetupForm
        initialName={initialName}
        initialJobTitle={initialJobTitle}
        initialDepartment={initialDepartment}
        initialEmploymentType={initialEmploymentType}
        initialLocation={initialLocation}
        initialBio={initialBio}
        initialManager={
          initialManager
            ? { id: initialManager.user_id, name: initialManager.full_name }
            : { id: "", name: "" }
        }
        managerOptions={managerOptions}
        departmentOptions={departmentOptions}
        orgName={orgName || undefined}
        invitedRole={invitedRole || undefined}
      />
    );
  }

  return (
    <OnboardingWizard
      userEmail={user.email ?? ""}
      userName={user.user_metadata?.full_name ?? user.email ?? ""}
    />
  );
}