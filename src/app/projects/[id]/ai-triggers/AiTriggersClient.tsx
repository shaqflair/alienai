"use client";

import React, { useEffect, useMemo, useState } from "react";
import AiTriggerEditorModal from "./AiTriggerEditorModal";

type AiTrigger = {
  id: string;
  project_id: string | null;
  trigger_artifact: string;
  event_type: string;
  event_example: string;
  ai_intent: string;
  ai_steps: string[];
  affected_artifacts: string[];
  pm_benefit: string;
  governance_value: string;
  severity: "info" | "warning" | "critical";
  auto_execute: boolean;
  explain_why: string;
  explain_data_used: string[];
  is_enabled: boolean;
};

function safeArray(v: any): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  return [];
}

export default function AiTriggersClient({ projectId, canEdit }: { projectId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<AiTrigger[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [filterArtifact, setFilterArtifact] = useState<string>("all");
  const [editing, setEditing] = useState<AiTrigger | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch(`/api/ai-triggers?projectId=${encodeURIComponent(projectId)}`);
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Failed to load triggers");

      const items = Array.isArray(json.triggers) ? json.triggers : [];
      const mapped: AiTrigger[] = items.map((t: any) => ({
        id: String(t.id ?? ""),
        project_id: t.project_id ? String(t.project_id) : null,
        trigger_artifact: String(t.trigger_artifact ?? ""),
        event_type: String(t.event_type ?? ""),
        event_example: String(t.event_example ?? ""),
        ai_intent: String(t.ai_intent ?? ""),
        ai_steps: safeArray(t.ai_steps),
        affected_artifacts: safeArray(t.affected_artifacts),
        pm_benefit: String(t.pm_benefit ?? ""),
        governance_value: String(t.governance_value ?? ""),
        severity: (String(t.severity ?? "info") as any),
        auto_execute: Boolean(t.auto_execute ?? false),
        explain_why: String(t.explain_why ?? ""),
        explain_data_used: safeArray(t.explain_data_used),
        is_enabled: Boolean(t.is_enabled ?? true),
      }));

      setRows(mapped);
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const artifacts = useMemo(() => {
    const set = new Set<string>();
    rows.forEach((r) => r.trigger_artifact && set.add(r.trigger_artifact));
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    if (filterArtifact === "all") return rows;
    return rows.filter((r) => r.trigger_artifact === filterArtifact);
  }, [rows, filterArtifact]);

  async function saveOne(payload: any) {
    const res = await fetch("/api/ai-triggers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId, items: [payload] }),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) throw new Error(json?.error || "Save failed");
  }

  async function toggleEnabled(row: AiTrigger) {
    if (!canEdit) return;
    try {
      await saveOne({ ...row, is_enabled: !row.is_enabled });
      await load();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">AI Governance Triggers</h1>
          <div className="text-xs text-gray-500">Define what AI does, when it does it, and why.</div>
        </div>

        <div className="flex items-center gap-2">
          <select
            className="rounded-lg border px-3 py-2 text-sm"
            value={filterArtifact}
            onChange={(e) => setFilterArtifact(e.target.value)}
            disabled={loading}
          >
            <option value="all">All artifacts</option>
            {artifacts.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>

          {canEdit ? (
            <button
              className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700"
              type="button"
              onClick={() =>
                setEditing({
                  id: "",
                  project_id: projectId,
                  trigger_artifact: "",
                  event_type: "",
                  event_example: "",
                  ai_intent: "",
                  ai_steps: [],
                  affected_artifacts: [],
                  pm_benefit: "",
                  governance_value: "",
                  severity: "info",
                  auto_execute: false,
                  explain_why: "",
                  explain_data_used: [],
                  is_enabled: true,
                })
              }
            >
              + New Trigger
            </button>
          ) : null}

          <button
            className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 disabled:opacity-60"
            type="button"
            onClick={load}
            disabled={loading}
          >
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>

      {err ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

      <div className="overflow-auto rounded-xl border">
        <table className="min-w-[1100px] w-full text-sm">
          <thead className="bg-gray-50 text-xs text-gray-600">
            <tr className="border-b">
              <th className="px-3 py-2 text-left">Artifact</th>
              <th className="px-3 py-2 text-left">Event</th>
              <th className="px-3 py-2 text-left">Intent</th>
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Enabled</th>
              {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id || `${r.trigger_artifact}-${r.event_type}`} className="border-t">
                <td className="px-3 py-2 font-medium">{r.trigger_artifact || "—"}</td>
                <td className="px-3 py-2">{r.event_type || "—"}</td>
                <td className="px-3 py-2 text-gray-600 max-w-[540px] truncate">{r.ai_intent || "—"}</td>
                <td className="px-3 py-2">{r.severity}</td>
                <td className="px-3 py-2">
                  <input type="checkbox" checked={!!r.is_enabled} disabled={!canEdit} onChange={() => toggleEnabled(r)} />
                </td>
                {canEdit ? (
                  <td className="px-3 py-2 text-right">
                    <button className="rounded-lg border px-2 py-1 text-xs hover:bg-gray-50" type="button" onClick={() => setEditing(r)}>
                      Edit
                    </button>
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing ? (
        <AiTriggerEditorModal
          projectId={projectId}
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}