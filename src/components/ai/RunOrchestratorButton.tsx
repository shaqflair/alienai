"use client";

import React, { useState } from "react";

type RunResult = {
  ok: boolean;
  processed?: number;
  failed?: number;
  last_event_id?: string | null;
  error?: string;
};

export default function RunOrchestratorButton(props: {
  className?: string;
  onRan?: (result: RunResult) => void; // optional callback to refresh UI
  label?: string;
}) {
  const { className = "", onRan, label = "Run AI analysis" } = props;
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setErr(null);
    setMsg(null);

    try {
      const res = await fetch("/api/orchestrator/run", { method: "POST" });
      const json = (await res.json()) as RunResult;

      if (!res.ok || !json?.ok) {
        throw new Error(json?.error || "Orchestrator run failed");
      }

      const processed = Number(json.processed ?? 0);
      const failed = Number(json.failed ?? 0);
      setMsg(`Done: processed ${processed}, failed ${failed}`);
      onRan?.(json);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50 disabled:opacity-60"
        title="Runs the orchestrator and generates new AI suggestions"
      >
        {loading ? "Running..." : label}
      </button>

      {msg ? <span className="text-xs text-gray-600">{msg}</span> : null}
      {err ? <span className="text-xs text-red-700">{err}</span> : null}
    </div>
  );
}
