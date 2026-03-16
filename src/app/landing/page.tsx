// src/app/landing/page.tsx
import type { Metadata } from "next";
import LandingPageClient from "@/components/landing/LandingPageClient";

export const metadata: Metadata = {
  title: "Aliena AI — The AI Governance Platform for Modern Programme Delivery",
  description:
    "Aliena AI unifies approvals, RAID, financial oversight, resource planning and executive reporting into one boardroom-grade AI governance platform.",
};

export default function LandingPage() {
  return <LandingPageClient />;
}