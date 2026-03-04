// src/app/milestones/page.tsx
import { Suspense } from "react";
import MilestonesClient from "./MilestonesClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function MilestonesPage() {
  return (
    <Suspense fallback={null}>
      <MilestonesClient />
    </Suspense>
  );
}