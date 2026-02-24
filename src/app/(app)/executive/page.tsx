// src/app/(app)/executive/page.tsx
import "server-only";

import ExecutiveCockpitClient from "@/components/executive/ExecutiveCockpitClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function ExecutivePage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6">
      <ExecutiveCockpitClient />
    </main>
  );
}