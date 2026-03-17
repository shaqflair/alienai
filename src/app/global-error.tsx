// src/app/global-error.tsx
"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[GlobalError]", error);

    fetch("/api/platform/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "global_error",
        severity: "critical",
        source: "src/app/global-error.tsx",
        title: "Global application crash",
        message: error?.message || "Unknown global error",
        route: typeof window !== "undefined" ? window.location.pathname : null,
        metadata: {
          digest: error?.digest ?? null,
          stack: error?.stack ?? null,
          href: typeof window !== "undefined" ? window.location.href : null,
          ts: new Date().toISOString(),
        },
      }),
    }).catch(() => {});
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen bg-[#000810] text-white antialiased">
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="w-full max-w-xl rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-2xl">
            <div className="flex items-center gap-3 mb-5">
              <div className="h-12 w-12 rounded-2xl bg-red-500/15 border border-red-400/20 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-400" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Something went wrong</h1>
                <p className="text-sm text-white/60">ALIENA hit an unexpected application error.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-sm text-white/80">
                {error?.message || "An unexpected error occurred."}
              </p>
              {error?.digest && (
                <p className="mt-2 text-xs text-white/40">Ref: {error.digest}</p>
              )}
            </div>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 transition-colors"
              >
                <RefreshCw className="h-4 w-4" />
                Try again
              </button>

              <button
                type="button"
                onClick={() => (window.location.href = "/")}
                className="rounded-2xl border border-white/15 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/5 transition-colors"
              >
                Go home
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}