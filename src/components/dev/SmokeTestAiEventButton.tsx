"use client";

import React, { useState } from "react";

export default function SmokeTestAiEventButton(props: { projectId: string; artifactId: string }) {
  const { projectId, artifactId } = props;

  const [busy, setBusy] = useState(false);

  async function run() {
    if (!projectId || !artifactId) {
      alert(JSON.stringify({ ok: false, error: "Missing projectId and/or artifactId" }, null, 2));
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/ai/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,               // ? REQUIRED
          artifactId,              // ? REQUIRED
          eventType: "smoke_test", // ? your API expects an eventType
          severity: "info",
          source: "ui",
          payload: {
            target_artifact_type: "stakeholder_register",
            note: "Smoke test from UI button",
          },
        }),
      });

      const json = await res.json().catch(() => null);
      alert(JSON.stringify({ status: res.status, json }, null, 2));
    } catch (e: any) {
      alert(JSON.stringify({ ok: false, error: String(e?.message ?? e) }, null, 2));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={run}
      disabled={busy}
      className="px-3 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm disabled:opacity-60"
      title="Dev: emit /api/ai/events"
    >
      {busy ? "Sending..." : "Smoke Test AI Event"}
    </button>
  );
}
