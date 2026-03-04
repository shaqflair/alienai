// src/app/insights/ai-warning/page.tsx
import { Suspense } from "react";
import InsightsClient from "../InsightsClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <InsightsClient />
    </Suspense>
  );
}