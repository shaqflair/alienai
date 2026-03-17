// FILE: src/app/layout.tsx
//
// Root layout -- wraps all pages with the sidebar shell.
// The sidebar is only shown for authenticated users.
//
// ALIENA Enterprise Upgrade:
// Neon AI branding
// Custom favicon
// PWA install support
// Cosmic AI background
// Enterprise metadata

import type { Metadata } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import { createClient } from "@/utils/supabase/server";
import SidebarShell from "@/components/nav/SidebarShell";
import CosmosBackdrop from "@/components/ui/CosmosBackdrop";
import AppErrorBoundary from "@/components/system/AppErrorBoundary";
import "./globals.css";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    template: "%s | ALIENA",
    default: "ALIENA",
  },
  description: "ALIENA -- AI Governance & Delivery Intelligence Platform",

  icons: {
    icon: "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png",
    shortcut:
      "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png",
    apple:
      "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png",
  },

  openGraph: {
    title: "ALIENA",
    description: "AI Governance Intelligence Platform",
    images: [
      "https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png",
    ],
  },

  themeColor: "#0a0d14",
  manifest: "/manifest.json",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  let userName: string | null = null;
  let orgName: string | null = null;
  let activeProjectCount = 0;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      userName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name as string | undefined) ||
        user.email ||
        null;

      let orgId: string | null = null;

      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("active_organisation_id")
          .eq("id", user.id)
          .maybeSingle();

        orgId = (prof?.active_organisation_id as string | null) ?? null;
      } catch {
        // ignore
      }

      if (!orgId) {
        try {
          const { data: memRow } = await supabase
            .from("organisation_members")
            .select("organisation_id")
            .eq("user_id", user.id)
            .is("removed_at", null)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

          orgId = memRow?.organisation_id ?? null;
        } catch {
          // ignore
        }
      }

      if (orgId) {
        try {
          const { data: orgRow } = await supabase
            .from("organisations")
            .select("name")
            .eq("id", orgId)
            .maybeSingle();

          orgName = orgRow?.name ?? null;
        } catch {
          // ignore
        }

        try {
          const { count } = await supabase
            .from("projects")
            .select("id", { count: "exact", head: true })
            .eq("organisation_id", orgId)
            .is("deleted_at", null)
            .neq("lifecycle_status", "closed")
            .not("status", "ilike", "%closed%");

          activeProjectCount = count ?? 0;
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }

  return (
    <html lang="en" className={`${dmSans.variable} ${dmMono.variable}`}>
      <head>
        <meta name="theme-color" content="#0a0d14" />
        <link rel="manifest" href="/manifest.json" />
        <link
          rel="preload"
          href="https://bjsyepwyaghnnderckgk.supabase.co/storage/v1/object/public/Aliena/Futuristic%20cosmic%20eye%20logo.png"
          as="image"
        />
      </head>

      <body className="text-slate-100 antialiased font-sans bg-[#000810]">
        <CosmosBackdrop />

        <div className="relative z-10">
          <AppErrorBoundary>
            {userName ? (
              <SidebarShell
                userName={userName}
                orgName={orgName}
                projectCount={activeProjectCount}
              >
                {children}
              </SidebarShell>
            ) : (
              <>{children}</>
            )}
          </AppErrorBoundary>
        </div>
      </body>
    </html>
  );
}