import "server-only";

import { Suspense } from "react";
import ArtifactsClientPage from "./ArtifactsClientPage";

export const dynamic = "force-dynamic";

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gray-50/50">
          <div className="sticky top-0 z-50 bg-white border-b border-[#00B8DB] shadow-sm">
            <div className="mx-auto max-w-7xl px-6 py-4">
              <div className="flex items-center justify-between">
                <div className="h-6 w-48 rounded bg-gray-100" />
                <div className="h-9 w-40 rounded bg-gray-100" />
              </div>
            </div>
          </div>

          <div className="mx-auto max-w-7xl px-6 py-8 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="bg-white rounded-xl border p-5 shadow-sm border-[#00B8DB]">
                  <div className="h-4 w-28 bg-gray-100 rounded" />
                  <div className="mt-3 h-8 w-16 bg-gray-100 rounded" />
                </div>
              ))}
            </div>

            <div className="bg-white rounded-xl border border-[#00B8DB] p-12 text-center shadow-sm">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-gray-100 mb-4" />
              <p className="text-gray-500">Loading artifacts…</p>
            </div>
          </div>
        </div>
      }
    >
      <ArtifactsClientPage />
    </Suspense>
  );
}