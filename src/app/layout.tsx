// FILE: src/app/layout.tsx
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import AppHeader from "@/components/AppHeader";
import SidebarShell from "@/components/nav/SidebarShell";
import { createClient } from "@/utils/supabase/server";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ALIENA",
  description: "AI-powered project governance",
  icons: {
    icon: "/favicon.ico",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Fetch user + org name for sidebar — fail gracefully
  let userName: string | null = null;
  let orgName:  string | null = null;

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      userName =
        (user.user_metadata?.full_name as string | undefined) ||
        (user.user_metadata?.name     as string | undefined) ||
        user.email ||
        null;

      try {
        const { data: memRow } = await supabase
          .from("organisation_members")
          .select("organisations:organisations!organisation_members_organisation_id_fkey(name)")
          .eq("user_id", user.id)
          .is("removed_at", null)
          .limit(1)
          .maybeSingle();

        orgName = (memRow?.organisations as any)?.name ?? null;
      } catch {}
    }
  } catch {}

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <AppHeader />
        <SidebarShell userName={userName} orgName={orgName}>
          {children}
        </SidebarShell>
      </body>
    </html>
  );
}