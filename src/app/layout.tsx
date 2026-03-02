// FILE: src/app/layout.tsx
//
// Root layout -- wraps all pages with the sidebar shell.
// The sidebar is only shown for authenticated routes.
// Auth pages (/login, /signup, /invite/*, /auth/*) get no sidebar.

import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import { createClient } from "@/utils/supabase/server";
import Sidebar from "@/components/nav/Sidebar";
import "./globals.css";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  display: "swap",
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    template: "%s | ResForce",
    default:  "ResForce",
  },
  description: "Resource capacity management for enterprise delivery teams",
};

// Routes that should NOT show the sidebar
const AUTH_PREFIXES = [
  "/login",
  "/signup",
  "/auth",
  "/invite",
  "/reset-password",
  "/verify",
];

function isAuthRoute(pathname: string): boolean {
  return AUTH_PREFIXES.some(p => pathname.startsWith(p));
}

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let userName: string | null = null;
  let orgName:  string | null = null;
  let activeProjectCount: number = 0;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      userName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name     as string | undefined) ||
        user.email ||
        null;

      // Try to get active org name -- two-step to avoid FK hint issues
      try {
        const { data: memRow } = await supabase
          .from("organisation_members")
          .select("organisation_id")
          .eq("user_id", user.id)
          .is("removed_at", null)
          .limit(1)
          .maybeSingle();

        const orgId = memRow?.organisation_id ?? null;

        if (orgId) {
          const { data: orgRow } = await supabase
            .from("organisations")
            .select("name")
            .eq("id", orgId)
            .maybeSingle();

          orgName = orgRow?.name ?? null;

          // Count active (non-closed) projects for badge
          const { count } = await supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organisation_id", orgId)
            .is("deleted_at", null)
            .neq("lifecycle_status", "closed")
            .not("status", "ilike", "%closed%");

          activeProjectCount = count ?? 0;
        }
      } catch {}
    }
  } catch {}

  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`}>
      <body className="bg-[#0a0d14] text-slate-100 antialiased font-sans">
        <AppShell userName={userName} orgName={orgName} projectCount={activeProjectCount}>
          {children}
        </AppShell>
      </body>
    </html>
  );
}

/* =============================================================================
   AppShell -- server component wrapper
   Can't use usePathname here (server), so we use a client wrapper below.
============================================================================= */

function AppShell({
  children,
  userName,
  orgName,
  projectCount,
}: {
  children:     React.ReactNode;
  userName:     string | null;
  orgName:      string | null;
  projectCount: number;
}) {
  return (
    <SidebarShell userName={userName} orgName={orgName} projectCount={projectCount}>
      {children}
    </SidebarShell>
  );
}

/* =============================================================================
   SidebarShell -- the actual flex container
   Conditionally shows sidebar based on route.
============================================================================= */

import SidebarShell from "@/components/nav/SidebarShell";