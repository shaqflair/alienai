import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

import AppHeader from "@/components/AppHeader";
import { acceptInvitesForCurrentUser } from "@/app/actions/accept-invites";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AlienAI",
  description: "AI-powered project governance",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Auto-claim any pending project invites for this user
  await acceptInvitesForCurrentUser();

  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {/* Global header with avatar, org switcher, role badge, logout */}
        <AppHeader />

        {/* Main content */}
        <main>{children}</main>
      </body>
    </html>
  );
}
