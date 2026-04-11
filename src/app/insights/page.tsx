// src/app/insights/page.tsx
import "server-only";

import { Suspense } from "react";
import InsightsClient from "./InsightsClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsClient />
    </Suspense>
  );
}
