"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Props = {
  projectId: string;
  winProbability: number | null;
  canEdit: boolean;
};

const PRESETS = [25, 50, 75, 90, 100];

function probColour(p: number) {
  if (p >= 90) return { text: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" };
  if (p >= 70) return { text: "#0369a1", bg: "#eff6ff", border: "#bfdbfe" };
  if (p >= 40) return { text: "#b45309", bg: "#fffbeb", border: "#fde68a" };
  return { text: "#b91c1c", bg: "#fef2f2", border: "#fecaca" };
}

export default function WinProbabilityEditor({ projectId, winProbability, canEdit }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState<string>(String(winProbability ?? 50));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = winProbability ?? 50;
  const col = probColour(current);

  async function save() {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 0 || num > 100) {
      setError("Enter a value between 0 and 100.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/projects/${projectId}/win-probability`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ win_probability: num }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j?.ok === false) throw new Error(j?.error || "Save failed");
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setValue(String(winProbability ?? 50));
    setEditing(false);
    setError(null);
  }

  if (!editing) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{
          display: "inline-flex", alignItems: "center", gap: 6,
          padding: "4px 10px", borderRadius: 20,
          background: col.bg, border: `1px solid ${col.border}`,
        }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: col.text, fontFamily: "monospace" }}>
            {current}%
          </span>
          <span style={{ fontSize: 11, color: col.text, opacity: 0.8 }}>win probability</span>
        </div>
        {canEdit && (
          <button
            onClick={() => setEditing(true)}
            style={{
              fontSize: 11, color: "#8b949e", background: "none",
              border: "none", cursor: "pointer", padding: "2px 6px",
              borderRadius: 6, fontFamily: "inherit",
            }}
          >
            Edit
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Preset buttons */}
      <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
        {PRESETS.map(p => (
          <button
            key={p}
            type="button"
            onClick={() => setValue(String(p))}
            style={{
              padding: "4px 10px", borderRadius: 16, fontSize: 12, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
              border: `1px solid ${value === String(p) ? probColour(p).border : "#e8ecf0"}`,
              background: value === String(p) ? probColour(p).bg : "white",
              color: value === String(p) ? probColour(p).text : "#57606a",
            }}
          >
            {p}%
          </button>
        ))}
        <span style={{ fontSize: 11, color: "#8b949e", marginLeft: 4 }}>or</span>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <input
            type="number"
            min={0}
            max={100}
            value={value}
            onChange={e => { setValue(e.target.value); setError(null); }}
            onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") cancel(); }}
            style={{
              width: 64, padding: "4px 8px", borderRadius: 8,
              border: `1px solid ${error ? "#fecaca" : "#e8ecf0"}`,
              fontSize: 13, fontFamily: "monospace", fontWeight: 700,
              color: "#0d1117", outline: "none",
            }}
            autoFocus
          />
          <span style={{ fontSize: 12, color: "#57606a" }}>%</span>
        </div>
      </div>

      {error && (
        <p style={{ fontSize: 11, color: "#b91c1c", margin: 0 }}>{error}</p>
      )}

      <div style={{ display: "flex", gap: 6 }}>
        <button
          onClick={cancel}
          style={{
            padding: "5px 12px", borderRadius: 7, border: "1px solid #e8ecf0",
            background: "white", color: "#57606a", fontSize: 12, fontWeight: 600,
            cursor: "pointer", fontFamily: "inherit",
          }}
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          style={{
            padding: "5px 14px", borderRadius: 7, border: "1px solid #0d1117",
            background: saving ? "#8b949e" : "#0d1117", color: "white",
            fontSize: 12, fontWeight: 700, cursor: saving ? "not-allowed" : "pointer",
            fontFamily: "inherit",
          }}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
