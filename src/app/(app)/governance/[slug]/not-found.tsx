// src/app/(app)/governance/[slug]/not-found.tsx
import "server-only";
import Link from "next/link";

export default function GovernanceNotFound() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="rounded-2xl border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">
          Governance article not found
        </h1>
        <p className="mt-2 text-sm text-neutral-600">
          The requested guidance page doesn’t exist (or the slug is invalid).
        </p>
        <div className="mt-4">
          <Link
            href="/governance"
            className="inline-flex items-center rounded-xl border border-neutral-200 bg-white px-3 py-2 text-sm font-medium text-neutral-800 hover:bg-neutral-50"
          >
            ← Back to Governance Hub
          </Link>
        </div>
      </div>
    </div>
  );
}