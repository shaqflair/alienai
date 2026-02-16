"use client";

import React, { useState } from "react";

function toLines(x: any): string[] {
  if (Array.isArray(x)) return x.map((v) => String(v)).filter(Boolean);
  return String(x ?? "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

function linesToText(arr: any): string {
  return toLines(arr).join("\n");
}

export default function AiTriggerEditorModal({
  projectId,
  initial,
  onClose,
  onSaved,
}: {
  projectId: string;
  initial: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [v, setV] = useState<any>({
    ...initial,
    ai_steps_text: linesToText(initial.ai_steps),
    affected_artifacts_text: linesToText(initial.affected_artifacts),
    explain_data_used_text: linesToText(initial.explain_data_used),
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const payload = {
        ...v,
        ai_steps: toLines(v.ai_steps_text),
        affected_artifacts: toLines(v.affected_artifacts_text),
        explain_data_used: toLines(v.explain_data_used_text),
      };

      const res = await fetch("/api/ai-triggers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, items: [payload] }),
      });

      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) throw new Error(json?.error || "Save failed");

      onSaved();
    } catch (e: any) {
      setErr(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-[820px] rounded-2xl bg-white p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{v.id ? "Edit AI Trigger" : "New AI Trigger"}</h2>
            <div className="text-xs text-gray-500">Keep triggers explainable and auditable.</div>
          </div>
          <button className="rounded-lg border px-3 py-1.5 text-sm hover:bg-gray-50" onClick={onClose} type="button">
            Close
          </button>
        </div>

        {err ? <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{err}</div> : null}

        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <div className="text-xs text-gray-600 mb-1">Trigger Artifact</div>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={v.trigger_artifact ?? ""} onChange={(e) => setV({ ...v, trigger_artifact: e.target.value })} />
          </label>

          <label className="text-sm">
            <div className="text-xs text-gray-600 mb-1">Event Type</div>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={v.event_type ?? ""} onChange={(e) => setV({ ...v, event_type: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">Event Example</div>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={v.event_example ?? ""} onChange={(e) => setV({ ...v, event_example: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">AI Intent</div>
            <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} value={v.ai_intent ?? ""} onChange={(e) => setV({ ...v, ai_intent: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">AI Steps (one per line)</div>
            <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={4} value={v.ai_steps_text ?? ""} onChange={(e) => setV({ ...v, ai_steps_text: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">Affected Artifacts (one per line)</div>
            <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} value={v.affected_artifacts_text ?? ""} onChange={(e) => setV({ ...v, affected_artifacts_text: e.target.value })} />
          </label>

          <label className="text-sm">
            <div className="text-xs text-gray-600 mb-1">Severity</div>
            <select className="w-full rounded-lg border px-3 py-2 text-sm bg-white" value={v.severity ?? "info"} onChange={(e) => setV({ ...v, severity: e.target.value })}>
              <option value="info">info</option>
              <option value="warning">warning</option>
              <option value="critical">critical</option>
            </select>
          </label>

          <label className="text-sm">
            <div className="text-xs text-gray-600 mb-1">Enabled</div>
            <select className="w-full rounded-lg border px-3 py-2 text-sm bg-white" value={String(v.is_enabled ?? true)} onChange={(e) => setV({ ...v, is_enabled: e.target.value === "true" })}>
              <option value="true">true</option>
              <option value="false">false</option>
            </select>
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">Why AI suggested this</div>
            <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} value={v.explain_why ?? ""} onChange={(e) => setV({ ...v, explain_why: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">Explain: Data used (one per line)</div>
            <textarea className="w-full rounded-lg border px-3 py-2 text-sm" rows={3} value={v.explain_data_used_text ?? ""} onChange={(e) => setV({ ...v, explain_data_used_text: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">PM Benefit</div>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={v.pm_benefit ?? ""} onChange={(e) => setV({ ...v, pm_benefit: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">Governance Value</div>
            <input className="w-full rounded-lg border px-3 py-2 text-sm" value={v.governance_value ?? ""} onChange={(e) => setV({ ...v, governance_value: e.target.value })} />
          </label>

          <label className="text-sm md:col-span-2">
            <div className="text-xs text-gray-600 mb-1">Auto Execute</div>
            <select className="w-full rounded-lg border px-3 py-2 text-sm bg-white" value={String(v.auto_execute ?? false)} onChange={(e) => setV({ ...v, auto_execute: e.target.value === "true" })}>
              <option value="false">false (suggest only)</option>
              <option value="true">true (auto-run)</option>
            </select>
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50" onClick={onClose} type="button">
            Cancel
          </button>
          <button className="rounded-lg bg-blue-600 px-3 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-60" disabled={saving} onClick={save} type="button">
            {saving ? "Saving…" : "Save Trigger"}
          </button>
        </div>
      </div>
    </div>
  );
}