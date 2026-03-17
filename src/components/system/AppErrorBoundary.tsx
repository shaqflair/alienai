"use client";

import React from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type State = { hasError: boolean; message: string };

export default class AppErrorBoundary extends React.Component<
  { children: React.ReactNode },
  State
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || "Unexpected UI error",
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[AppErrorBoundary]", error, info);

    // Auto-log to our internal platform events API
    fetch("/api/platform/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_type: "ui_error",
        severity: "critical",
        source: "src/components/system/AppErrorBoundary.tsx",
        title: "Client UI crashed",
        message: error?.message || "Unknown UI error",
        route: typeof window !== "undefined" ? window.location.pathname : null,
        metadata: {
          stack: error?.stack ?? null,
          componentStack: info?.componentStack ?? null,
          href: typeof window !== "undefined" ? window.location.href : null,
          ts: new Date().toISOString(),
        },
      }),
    }).catch((err) => {
        // Silently fail if logging itself fails to avoid infinite loops
        console.warn("Failed to log UI error to platform_events:", err);
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center px-6">
          <div className="w-full max-w-lg rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-2xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="h-11 w-11 rounded-2xl bg-red-500/15 border border-red-400/20 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-red-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white">UI crashed</h2>
                <p className="text-sm text-white/60">A rendering error occurred in the app shell.</p>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-white/80 font-mono">
              {this.state.message}
            </div>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 inline-flex items-center gap-2 rounded-2xl bg-cyan-500 px-4 py-2.5 text-sm font-semibold text-black hover:bg-cyan-400 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              Reload app
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}