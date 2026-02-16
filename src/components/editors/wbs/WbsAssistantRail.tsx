"use client";

import React, { useEffect, useMemo, useState } from "react";

type AssistantPayload = {
  acceptance_criteria: string;
  risks: string[];
  checklist: string[];
  deliverables: string[];
  raci: Array<{ role: string; suggested: string }>;
};

type SelectedRow = {
  id: string;
  code?: string;
  deliverable: string;
  description?: string;
  acceptance_criteria?: string;
  tags?: string[];
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default function WbsAssistantRail({
  projectId,
  readOnly,
  selectedRow,
  onEnsureArtifact,
  onUpdateRow,
  onAppendDescription,
  onExpandChildren,
  onMessage,
}: {
  projectId: string;
  readOnly: boolean;
  selectedRow: SelectedRow | null;
  onEnsureArtifact: () => Promise<string>;
  onUpdateRow: (rowId: string, patch: { acceptance_criteria?: string }) => void;
  onAppendDescription: (rowId: string, block: string) => void;
  onExpandChildren: (rowId: string) => void;
  onMessage: (text: string) => void;
}) {
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistant, setAssistant] = useState<AssistantPayload | null>(null);

  const [assistantDone, setAssistantDone] = useState<{
    acceptance: boolean;
    checklist: boolean;
    deliverables: boolean;
    risks: boolean;
    raci: boolean;
  }>({ acceptance: false, checklist: false, deliverables: false, risks: false, raci: false });

  useEffect(() => {
    setAssistantDone({ acceptance: false, checklist: false, deliverables: false, risks: false, raci: false });
    setAssistant(null);
  }, [selectedRow?.id]);

  const selectedLabel = useMemo(() => {
    if (!selectedRow) return "";
    return selectedRow.deliverable || "(untitled)";
  }, [selectedRow]);

  async function loadAssistant() {
    if (!selectedRow) return;
    setAssistantLoading(true);
    setAssistant(null);

    try {
      const artifactId = await onEnsureArtifact();
      if (!artifactId) {
        onMessage("⛔ Missing artifactId");
        return;
      }

      const resp = await fetch(`/api/ai/wbs/assist`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          artifactId,
          row: {
            id: selectedRow.id,
            deliverable: selectedRow.deliverable,
            description: safeStr(selectedRow.description),
            tags: selectedRow.tags ?? [],
          },
        }),
      });

      const j = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(j?.error || `Assistant failed (${resp.status})`);

      setAssistant(j?.assistant ?? null);
    } catch (e: any) {
      onMessage(`⛔ ${e?.message ?? "Assistant failed"}`);
    } finally {
      setAssistantLoading(false);
    }
  }

  if (!selectedRow) {
    return <div className="text-sm text-gray-600">Select any row to get AI suggestions.</div>;
  }

  return (
    <div className="space-y-4">
      <div className="text-sm">
        <div className="text-gray-500">Selected</div>
        <div className="font-medium text-gray-900">{selectedLabel}</div>
        <div className="text-xs text-gray-500 mt-0.5">
          Code: <span className="font-mono">{selectedRow.code || "—"}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          disabled={readOnly || assistantLoading}
          onClick={loadAssistant}
        >
          {assistantLoading ? "Loading…" : "Generate guidance"}
        </button>

        <button
          type="button"
          className="px-4 py-2 text-sm font-medium rounded-lg border border-gray-300 hover:bg-gray-50 disabled:opacity-50 transition-colors"
          disabled={readOnly}
          onClick={() => onExpandChildren(selectedRow.id)}
        >
          ✨ Expand children
        </button>
      </div>

      {!assistant ? (
        <div className="text-sm text-gray-600">Click "Generate guidance" to see suggestions.</div>
      ) : (
        <div className="space-y-4">
          <div className="border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">Acceptance criteria</div>
              {!assistantDone.acceptance ? (
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs bg-gray-800 text-white rounded-md hover:bg-gray-900 disabled:opacity-50"
                  disabled={readOnly}
                  onClick={() => {
                    onUpdateRow(selectedRow.id, { acceptance_criteria: assistant.acceptance_criteria });
                    setAssistantDone((p) => ({ ...p, acceptance: true }));
                    onMessage("✅ Acceptance criteria applied");
                  }}
                >
                  Apply
                </button>
              ) : (
                <span className="text-xs text-emerald-700 font-medium">Applied ✓</span>
              )}
            </div>
            <pre className="text-xs text-gray-700 whitespace-pre-wrap font-sans">{assistant.acceptance_criteria || "—"}</pre>
          </div>

          <SectionAppend
            title="Checklist"
            items={assistant.checklist}
            done={assistantDone.checklist}
            onDone={() => setAssistantDone((p) => ({ ...p, checklist: true }))}
            readOnly={readOnly}
            onAppend={() => {
              const block = assistant.checklist.map((x) => `- ${x}`).join("\n");
              const next = `Checklist:\n${block}\n`;
              onAppendDescription(selectedRow.id, next);
              onMessage("✅ Checklist appended");
            }}
          />

          <SectionAppend
            title="Deliverables"
            items={assistant.deliverables}
            done={assistantDone.deliverables}
            onDone={() => setAssistantDone((p) => ({ ...p, deliverables: true }))}
            readOnly={readOnly}
            onAppend={() => {
              const block = assistant.deliverables.map((x) => `- ${x}`).join("\n");
              const next = `Deliverables:\n${block}\n`;
              onAppendDescription(selectedRow.id, next);
              onMessage("✅ Deliverables appended");
            }}
          />

          <SectionAppend
            title="Risks"
            items={assistant.risks}
            done={assistantDone.risks}
            onDone={() => setAssistantDone((p) => ({ ...p, risks: true }))}
            readOnly={readOnly}
            onAppend={() => {
              const block = assistant.risks.map((x) => `- ${x}`).join("\n");
              const next = `Risks:\n${block}\n`;
              onAppendDescription(selectedRow.id, next);
              onMessage("✅ Risks appended");
            }}
          />

          <div className="border rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="font-medium text-sm">RACI hints</div>
              {!assistantDone.raci ? (
                <button
                  type="button"
                  className="px-2.5 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
                  disabled={readOnly}
                  onClick={() => {
                    const lines = assistant.raci.map((x) => `${x.role}: ${x.suggested}`);
                    const block = lines.map((x) => `- ${x}`).join("\n");
                    const next = `RACI hints:\n${block}\n`;
                    onAppendDescription(selectedRow.id, next);
                    setAssistantDone((p) => ({ ...p, raci: true }));
                    onMessage("✅ RACI appended");
                  }}
                >
                  Append
                </button>
              ) : (
                <span className="text-xs text-emerald-700 font-medium">Done ✓</span>
              )}
            </div>
            {assistant.raci.length > 0 ? (
              <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
                {assistant.raci.map((item, i) => (
                  <li key={i}>
                    <span className="font-medium">{item.role}:</span> {item.suggested}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="text-xs text-gray-500">No RACI suggestions</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SectionAppend({
  title,
  items,
  done,
  onDone,
  readOnly,
  onAppend,
}: {
  title: string;
  items: string[];
  done: boolean;
  onDone: () => void;
  readOnly: boolean;
  onAppend: () => void;
}) {
  return (
    <div className="border rounded-xl p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="font-medium text-sm">{title}</div>
        {!done ? (
          <button
            type="button"
            className="px-2.5 py-1 text-xs border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
            disabled={readOnly}
            onClick={() => {
              onAppend();
              onDone();
            }}
          >
            Append
          </button>
        ) : (
          <span className="text-xs text-emerald-700 font-medium">Done ✓</span>
        )}
      </div>
      {items.length > 0 ? (
        <ul className="text-sm text-gray-700 list-disc pl-5 space-y-1">
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      ) : (
        <div className="text-xs text-gray-500">No {title.toLowerCase()} items</div>
      )}
    </div>
  );
}
