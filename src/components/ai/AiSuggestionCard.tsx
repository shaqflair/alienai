// src/components/ai/AiSuggestionCard.tsx
"use client";

import React, { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

type SuggestionStatus = "suggested" | "proposed" | "accepted" | "dismissed" | string;

export type AiSuggestion = {
  id: string;
  project_id: string;
  target_artifact_id: string | null;
  target_artifact_type: string | null;
  suggestion_type: string | null;
  rationale: string | null;
  confidence: number | null;
  status: SuggestionStatus;
  created_at: string;
  decided_at?: string | null;
  rejected_at?: string | null;
};

function pct(confidence: number | null | undefined) {
  const n = typeof confidence === "number" && isFinite(confidence) ? confidence : null;
  if (n === null) return null;
  // confidence might be 0..1 or 0..100 depending on your generator
  const v = n <= 1 ? n * 100 : n;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function statusLabel(s: SuggestionStatus) {
  const v = String(s ?? "").toLowerCase();
  if (v === "proposed") return "Suggested";
  if (v === "suggested") return "Suggested";
  if (v === "accepted") return "Accepted";
  if (v === "dismissed") return "Dismissed";
  return v ? v[0]?.toUpperCase() + v.slice(1) : "Unknown";
}

function statusVariant(s: SuggestionStatus): "default" | "secondary" | "outline" | "destructive" {
  const v = String(s ?? "").toLowerCase();
  if (v === "accepted") return "default";
  if (v === "dismissed") return "destructive";
  if (v === "suggested" || v === "proposed") return "secondary";
  return "outline";
}

export default function AiSuggestionCard({
  suggestion,
  canAct,
  onAccept,
  onDismiss,
}: {
  suggestion: AiSuggestion;
  canAct: boolean;
  onAccept: () => Promise<void> | void;
  onDismiss: () => Promise<void> | void;
}) {
  const [busy, setBusy] = useState<null | "accept" | "dismiss">(null);
  const conf = useMemo(() => pct(suggestion.confidence), [suggestion.confidence]);

  async function act(kind: "accept" | "dismiss") {
    try {
      setBusy(kind);
      if (kind === "accept") await onAccept();
      else await onDismiss();
    } finally {
      setBusy(null);
    }
  }

  const statusLower = String(suggestion.status || "").toLowerCase();

  return (
    <div className="rounded-2xl border bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={statusVariant(suggestion.status)}>{statusLabel(suggestion.status)}</Badge>
            {suggestion.target_artifact_type ? (
              <span className="text-xs text-muted-foreground">
                {suggestion.target_artifact_type}
                {suggestion.suggestion_type ? ` • ${suggestion.suggestion_type}` : ""}
              </span>
            ) : null}
          </div>

          {suggestion.rationale ? (
            <p className="mt-2 whitespace-pre-line text-sm text-gray-800">{suggestion.rationale}</p>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">No rationale provided.</p>
          )}
        </div>

        {conf !== null ? (
          <div className="shrink-0 text-right">
            <div className="text-xs text-muted-foreground">Confidence</div>
            <div className="text-sm font-semibold">{conf}%</div>
          </div>
        ) : null}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!canAct || busy !== null || statusLower === "accepted"}
          onClick={() => act("accept")}
        >
          {busy === "accept" ? "Accepting..." : "Accept"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          disabled={!canAct || busy !== null || statusLower === "dismissed"}
          onClick={() => act("dismiss")}
        >
          {busy === "dismiss" ? "Dismissing..." : "Dismiss"}
        </Button>
      </div>
    </div>
  );
}
