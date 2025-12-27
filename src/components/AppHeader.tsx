// src/components/AppHeader.tsx
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import UserMenu from "@/components/auth/UserMenu";

type OrgRow = {
  org_id: string;
  role: "owner" | "editor" | "viewer";
  organizations: { id: string; name: string } | null;
};

function pickInitials(label: string) {
  const clean = (label || "").trim();
  if (!clean) return "U";
  const parts = clean.split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase()).join("");
  return letters || "U";
}

export default async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Public header state
  if (!user) {
    return (
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/projects" className="font-semibold text-lg">
          AlienAI
        </Link>
        <Link className="rounded-md border px-3 py-1 text-sm hover:bg-gray-100" href="/login">
          Log in
        </Link>
      </header>
    );
  }

  // Fetch org memberships (RLS-safe)
  const { data: orgRows, error: orgErr } = await supabase
    .from("org_members")
    .select(
      `
      org_id,
      role,
      organizations:organizations (
        id,
        name
      )
    `
    )
    .eq("user_id", user.id);

  if (orgErr) {
    // Fail gracefully; still show user menu without org switcher
    const displayName =
      (user.user_metadata?.full_name as string | undefined) ??
      user.email ??
      "Account";

    return (
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Link href="/projects" className="font-semibold text-lg">
          AlienAI
        </Link>
        <UserMenu
          email={user.email ?? ""}
          displayName={displayName}
          initials={pickInitials(displayName)}
          memberships={[]}
          activeOrgId={null}
          activeOrgName={null}
          activeRole={null}
        />
      </header>
    );
  }

  const memberships = ((orgRows ?? []) as OrgRow[])
    .map((r) => {
      if (!r.organizations) return null;
      return { orgId: r.organizations.id, orgName: r.organizations.name, role: r.role };
    })
    .filter(Boolean) as Array<{ orgId: string; orgName: string; role: "owner" | "editor" | "viewer" }>;

  // Active org from cookie (fallback to first membership)
  const cookieOrgId = await getActiveOrgId();
  const active = memberships.find((m) => m.orgId === cookieOrgId) ?? memberships[0] ?? null;

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ??
    user.email ??
    "Account";

  const initials = pickInitials(displayName);

  return (
    <header className="flex items-center justify-between border-b px-6 py-3">
      <Link href="/projects" className="font-semibold text-lg">
        AlienAI
      </Link>

      <UserMenu
        email={user.email ?? ""}
        displayName={displayName}
        initials={initials}
        memberships={memberships}
        activeOrgId={active?.orgId ?? null}
        activeOrgName={active?.orgName ?? null}
        activeRole={active?.role ?? null}
      />
    </header>
  );
}
