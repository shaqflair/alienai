"use client";

import React from "react";
import type { Patch, Section } from "@/lib/ai/charter-ai";

export default function AISuggestionsDrawer(props: {
  open: boolean;
  title?: string;
  patch: Patch | null;
  onClose: () => void;
  onApplySuggestion: (section: Section) => void;
}) {
  const { open, title, patch, onClose, onApplySuggestion } = props;

  if (!open) return null;
  const isSug = patch?.kind === "suggestions";

  return (
    <div className="fixed inset-0 z-50">
      <button
        type="button"
        onClick={onClose}
        className="absolute inset-0 bg-black/30"
        aria-label="Close suggestions"
      />
      <aside className="absolute right-0 top-0 h-full w-full max-w-md bg-white shadow-xl border-l">
        <div className="p-4 border-b flex items-center justify-between">
          <div className="font-semibold">{title || "AI Suggestions"}</div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-50"
          >
            Close
          </button>
        </div>

        <div className="p-4 space-y-3">
          {!isSug ? (
            <div className="text-sm text-neutral-700">
              No suggestions available.
            </div>
          ) : (
            (patch.suggestions || []).map((sug) => (
              <div key={sug.id} className="rounded-xl border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-sm">{sug.label}</div>
                    <div className="text-xs text-neutral-500 mt-1">Applies only to this section.</div>
                  </div>
                  <button
                    type="button"
                    className="rounded-xl bg-black text-white px-3 py-2 text-xs hover:opacity-90"
                    onClick={() => onApplySuggestion(sug.section)}
                  >
                    Apply
                  </button>
                </div>

                <div className="mt-3 text-xs text-neutral-700 whitespace-pre-wrap">
                  {"table" in sug.section && sug.section.table ? (
                    <div className="text-neutral-600">Table suggestion (preview hidden). Click Apply to use.</div>
                  ) : (
                    (sug.section as any).bullets || ""
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
