"use client";

import React, { useState } from "react";

export function AiSuggestEffortButton(props: {
  itemId: string;
  itemName: string;
  onApply: (hours: number) => void;
}) {
  const { itemId, itemName, onApply } = props;
  const [loading, setLoading] = useState(false);

  return (
    <button
      className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold ring-1 ring-border hover:bg-muted disabled:opacity-60"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          const res = await fetch("/api/ai/wbs/suggest-effort", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ itemId, itemName }),
          });
          const j = await res.json();
          if (j?.ok && typeof j.hours === "number" && j.hours > 0) {
            onApply(j.hours);
          }
        } finally {
          setLoading(false);
        }
      }}
    >
      {loading ? "…" : "✨ AI suggest effort"}
    </button>
  );
}
