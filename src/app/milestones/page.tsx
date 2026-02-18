// src/app/milestones/page.tsx
import "server-only";

import { Suspense } from "react";
import MilestonesClient from "./MilestonesClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-500">Loading milestones…</div>}>
      <MilestonesClient />
    </Suspense>
  );
}
