"use client";

import React, { useEffect, useState } from "react";
import AiSuggestionCard from "@/components/ai/AiSuggestionCard";

type DbSuggestion = {
  id: string;
  project_id: string;

  source_event_id: string;
  target_artifact_id: string | null;
  target_artifact_type: string;

  suggestion_type: string; // e.g. "patch"
  patch: any | null;

  rationale: string | null;
  confidence: number | null;

  status: "proposed" | "suggested" | "accepted" | "dismissed";
  created_at: string;
  updated_at?: string;
  decided_at?: string | null;
  rejected_at?: string | null;
  actioned_by?: string | null;
};

export default function AiSuggestionsClient({
  projectId,
  canAct,
}: {
  projectId: string;
  canAct: boolean;
}) {
  const [status, setStatus] = useState<"suggested" | "accepted" | "dismissed">("suggested");
  const [rows, setRows] = useState<DbSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch(
        `/api/ai-suggestions?projectId=${encodeURIComponent(projectId)}&status=${encodeURIComponent(status)}`,
        { method: "GET" }
      );
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load suggestions");
      setRows(Array.isArray(json.suggestions) ? json.suggestions : []);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, status]);

  async function updateStatus(id: string, next: "accepted" | "dismissed") {
    const res = await fetch("/api/ai-suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, id, status: next }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Update failed");
    await load();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">AI Suggestions</h1>
          <p className="text-xs text-gray-500">Governance-safe recommendations stored in public.ai_suggestions.</p>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border px-3 py-2 text-sm"
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            disabled={loading}
          >
            <option value="suggested">Suggested</option>
            <option value="accepted">Accepted</option>
            <option value="dismissed">Dismissed</option>
          </select>

          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
            onClick={load}
            disabled={loading}
            type="button"
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {err ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div>
      ) : null}

      {loading ? (
        <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-600">No AI suggestions.</div>
      ) : (
        <div className="grid gap-3">
          {rows.map((s) => (
            <AiSuggestionCard
              key={s.id}
              suggestion={s}
              canAct={canAct && status === "suggested"}
              onAccept={async () => updateStatus(s.id, "accepted")}
              onDismiss={async () => updateStatus(s.id, "dismissed")}
            />
          ))}
        </div>
      )}
    </div>
  );
}
