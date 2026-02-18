// src/components/AppHeader.tsx
import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import UserMenu from "@/components/auth/UserMenu";
import AppNavLinks from "@/components/nav/AppNavLinks";

type OrgRow = {
  organisation_id: string | null;
  role: "admin" | "member";
  organisations: { id: string; name: string } | null;
};

function pickInitials(label: string) {
  const clean = (label || "").trim();
  if (!clean) return "U";
  const parts = clean.split(/\s+/).slice(0, 2);
  const letters = parts.map((p) => p[0]?.toUpperCase()).join("");
  return letters || "U";
}

/* -----------------------------
   ?LIEN? Wordmark – : white + cyan A & I
------------------------------ */
function AlienWordmark() {
  return (
    <span className="select-none whitespace-nowrap text-xl md:text-2xl font-black tracking-[0.35em]">
      <span className="text-[#00d4ff] drop-shadow-[0_0_12px_rgba(0,212,255,0.7)]">?</span>
      <span className="text-white">L</span>
      <span className="text-[#00d4ff] drop-shadow-[0_0_12px_rgba(0,212,255,0.7)]">I</span>
      <span className="text-white">?N</span>
      <span className="text-white">?</span>
    </span>
  );
}

/* -----------------------------
   Brand Logo (IMG – no next/image)
------------------------------ */
function BrandLogo() {
  return (
    <img
      src="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
      alt="Aliena logo"
      className="h-8 w-auto object-contain rounded shadow-md shadow-cyan-900/30"
    />
  );
}

export default async function AppHeader() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Palantir Foundry-style header shell (dark, glass-like, cyan accents)
  const HeaderShell = ({ children }: { children: React.ReactNode }) => {
    return (
      <header className="sticky top-0 z-50 border-b border-[#334155] bg-[#0f172a] text-[#e2e8f0] font-['Inter','system-ui',sans-serif]">
        {/* Subtle nebula/cyan overlay */}
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-[#0f172a] via-[#1e293b]/60 to-[#334155]/40" />
        {/* Very faint top glow */}
        <div className="pointer-events-none absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_20%_0%,rgba(0,212,255,0.25),transparent_50%)]" />

        <div className="relative mx-auto w-full max-w-none px-6 h-14 flex items-center justify-between">
          {children}
        </div>

        {/* Thin cyan accent line at bottom */}
        <div className="relative h-[1px] bg-gradient-to-r from-transparent via-[#00d4ff]/40 to-transparent" />
      </header>
    );
  };

  // Public header (logged out)
  if (!user) {
    return (
      <HeaderShell>
        {/* LEFT: logo + wordmark */}
        <Link href="/projects" className="flex items-center gap-4 shrink-0">
          <BrandLogo />
          <AlienWordmark />
        </Link>

        {/* CENTER: empty on logged-out */}
        <div className="flex-1" />

        {/* RIGHT: login button */}
        <div className="ml-auto shrink-0">
          <Link
            className="rounded-md border border-[#334155] bg-[#1e293b]/80 px-4 py-1.5 text-sm text-[#e2e8f0] hover:bg-[#1e293b] hover:border-[#00d4ff]/50 transition"
            href="/login"
          >
            Log in
          </Link>
        </div>
      </HeaderShell>
    );
  }

  const { data: orgRows, error: orgErr } = await supabase
    .from("organisation_members")
    .select(
      `
      organisation_id,
      role,
      organisations:organisations (
        id,
        name
      )
    `
    )
    .eq("user_id", user.id);

  const displayName =
    (user.user_metadata?.full_name as string | undefined) ?? user.email ?? "Account";
  const initials = pickInitials(displayName);

  // Fail gracefully
  if (orgErr) {
    return (
      <HeaderShell>
        <Link href="/projects" className="flex items-center gap-4 shrink-0">
          <BrandLogo />
          <AlienWordmark />
        </Link>

        <div className="flex-1 flex items-center justify-center">
          <AppNavLinks />
        </div>

        <div className="ml-auto shrink-0">
          <UserMenu
            email={user.email ?? ""}
            displayName={displayName}
            initials={initials}
            memberships={[]}
            activeOrgId={null}
            activeOrgName={null}
            activeRole={null}
          />
        </div>
      </HeaderShell>
    );
  }

  const memberships = ((orgRows ?? []) as OrgRow[])
    .map((r) => {
      if (!r.organisations?.id) return null;
      return {
        orgId: r.organisations.id,
        orgName: r.organisations.name,
        role: r.role,
      };
    })
    .filter(Boolean) as Array<{ orgId: string; orgName: string; role: "admin" | "member" }>;

  const cookieOrgId = await getActiveOrgId();
  const active = memberships.find((m) => m.orgId === cookieOrgId) ?? memberships[0] ?? null;

  return (
    <HeaderShell>
      {/* LEFT: logo + wordmark */}
      <Link href="/projects" className="flex items-center gap-4 shrink-0">
        <BrandLogo />
        <AlienWordmark />
      </Link>

      {/* CENTER: navigation */}
      <div className="flex-1 flex items-center justify-center">
        <AppNavLinks />
      </div>

      {/* RIGHT: user/org menu */}
      <div className="ml-auto shrink-0">
        <UserMenu
          email={user.email ?? ""}
          displayName={displayName}
          initials={initials}
          memberships={memberships}
          activeOrgId={active?.orgId ?? null}
          activeOrgName={active?.orgName ?? null}
          activeRole={active?.role ?? null}
        />
      </div>
    </HeaderShell>
  );
}
