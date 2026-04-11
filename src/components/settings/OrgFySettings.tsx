"use client";

import { useState } from "react";

const FY_OPTIONS = [
  { value: 1,  label: "Jan – Dec (Calendar year)" },
  { value: 4,  label: "Apr – Mar (UK standard)" },
  { value: 7,  label: "Jul – Jun" },
  { value: 10, label: "Oct – Sep" },
];

function fyLabel(start: number) {
  const now = new Date();
  const y = now.getMonth() + 1 >= start ? now.getFullYear() : now.getFullYear() - 1;
  if (start === 1) return String(y);
  return `${y}/${String(y + 1).slice(2)}`;
}

export default function OrgFySettings({
  initialFyStartMonth,
  isAdmin,
}: {
  initialFyStartMonth: number;
  isAdmin: boolean;
}) {
  const [fyStart, setFyStart]   = useState(initialFyStartMonth);
  const [saving,  setSaving]    = useState(false);
  const [saved,   setSaved]     = useState(false);
  const [error,   setError]     = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch("/api/org/fy-config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fyStartMonth: fyStart }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Save failed");
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e: any) {
      setError(String(e?.message ?? "Save failed"));
    } finally {
      setSaving(false);
    }
  }

  const currentFy = fyLabel(fyStart);
  const option = FY_OPTIONS.find(o => o.value === fyStart);

  return (
    <div className="rounded-xl border bg-white p-5 space-y-4">
      <div>
        <div className="font-medium">Financial Year Configuration</div>
        <div className="text-sm text-gray-500 mt-1">
          Sets the financial year start month used across Budget Intelligence, Monthly Phasing, and executive reporting.
        </div>
      </div>

      {isAdmin ? (
        <div className="space-y-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-gray-600 uppercase tracking-wide">
              FY start month
            </label>
            <select
              value={fyStart}
              onChange={e => { setFyStart(Number(e.target.value)); setSaved(false); }}
              className="w-full max-w-xs rounded-md border px-3 py-2 text-sm bg-white text-gray-900"
            >
              {FY_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-gray-400 font-mono">
              Current FY: <span className="font-semibold text-gray-700">FY {currentFy}</span>
              {" · "}
              <span className="text-gray-500">{option?.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving}
              className="rounded-md bg-black text-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save FY setting"}
            </button>
            {saved  && <span className="text-xs text-green-600 font-medium">✓ Saved — all dashboards will use this FY</span>}
            {error  && <span className="text-xs text-red-600">{error}</span>}
          </div>

          <div className="rounded-lg bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 space-y-1">
            <div className="font-semibold">This setting affects:</div>
            <ul className="list-disc list-inside space-y-0.5 text-blue-700">
              <li>Budget Intelligence — default FY selector</li>
              <li>Monthly Phasing — default FY selector</li>
              <li>Budget Health card — FY label</li>
              <li>Executive Briefing — financial year context</li>
            </ul>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
            <span className="font-medium">Current FY setting:</span>{" "}
            {option?.label ?? "Apr – Mar (UK standard)"}{" "}
            <span className="text-gray-400">(FY {currentFy})</span>
          </div>
          <div className="text-xs text-gray-400">Only owners and admins can change the FY setting.</div>
        </div>
      )}
    </div>
  );
}
