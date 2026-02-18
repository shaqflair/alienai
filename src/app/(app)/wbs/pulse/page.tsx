// src/app/(app)/wbs/pulse/page.tsx
import "server-only";

import { Suspense } from "react";
import WbsPulseClient from "./WbsPulseClient";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-[calc(100vh-64px)] bg-white text-gray-900 font-['Inter','system-ui',sans-serif]">
          <div className="mx-auto max-w-7xl px-6 py-10">
            <div className="rounded-xl border border-gray-200 bg-white p-10 text-gray-600 text-center">
              Loading WBS pulse…
            </div>
          </div>
        </div>
      }
    >
      <WbsPulseClient />
    </Suspense>
  );
}
