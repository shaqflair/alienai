"use client";

import React from "react";
import Link from "next/link";

export default function ArtifactError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const isApprovalChainError =
    error?.message?.toLowerCase().includes("approval chain") ||
    error?.message?.toLowerCase().includes("already has an active");

  return (
    <main className="mx-auto w-full max-w-2xl px-6 py-16 text-center space-y-6">
      <h1 className="text-2xl font-semibold text-gray-950">
        {isApprovalChainError ? "Approval Already In Progress" : "Something went wrong"}
      </h1>

      <p className="text-sm text-gray-600 max-w-md mx-auto">
        {isApprovalChainError
          ? "A previous approval submission is still being processed. Wait a moment, then try again."
          : "An unexpected error occurred loading this artifact."}
      </p>

      {error?.message && (
        <p className="text-xs text-gray-400 font-mono bg-gray-50 rounded-xl px-4 py-3 text-left break-words">
          {error.message}
        </p>
      )}

      <div className="flex items-center justify-center gap-3">
        <button
          onClick={reset}
          className="px-4 py-2 rounded-xl bg-black text-white text-sm font-medium hover:opacity-90"
        >
          Try again
        </button>
        <Link
          href=".."
          className="px-4 py-2 rounded-xl border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
        >
          Back to Artifacts
        </Link>
      </div>
    </main>
  );
}
