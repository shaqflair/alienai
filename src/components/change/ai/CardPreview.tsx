"use client";
import React from "react";

type PreviewData = {
  timeline?: { label: string; value: string }[];
  affected?: { type: "wbs" | "schedule" | "artifact"; label: string; right?: string }[];
  alternatives?: { label: string; note: string }[];
};

export default function CardPreview({
  open,
  onClose,
  data,
}: {
  open: boolean;
  onClose: () => void;
  data?: PreviewData;
}) {
  if (!open) return null;

  const tl = data?.timeline ?? [
    { label: "Created", value: "Today" },
    { label: "Due", value: "In 7 days" },
  ];
  const affected = data?.affected ?? [
    { type: "wbs", label: "WBS: Network cutover tasks", right: "4 items" },
    { type: "schedule", label: "Schedule: Milestone M3", right: "+2 days" },
  ];
  const alts = data?.alternatives ?? [
    { label: "Option A: Fast-track", note: "Add 1 engineer for 2 days. Low cost, medium risk." },
    { label: "Option B: De-scope", note: "Remove non-critical feature. Zero schedule impact." },
  ];

  return (
    <div className="aiPreview" role="region" aria-label="Card preview">
      <div className="aiPreviewHead">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="aiPill">Preview</span>
          <span style={{ color: "rgba(255,255,255,0.72)", fontSize: 12 }}>Context without leaving board</span>
        </div>
        <button className="aiBubbleBtn" style={{ width: 30, height: 30 }} onClick={onClose} title="Close preview">
          ×
        </button>
      </div>

      <div className="aiPreviewBody">
        <div className="aiMiniList">
          {tl.map((x, i) => (
            <div className="aiMiniItem" key={i}>
              <div className="aiMiniLeft">
                <span className="aiPill">{x.label}</span>
                <span className="aiTiny">{x.value}</span>
              </div>
            </div>
          ))}
        </div>

        <div>
          <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 12, marginBottom: 8 }}>
            Linked artifacts / affected items
          </div>
          <div className="aiMiniList">
            {affected.map((x, i) => (
              <div className="aiMiniItem" key={i}>
                <div className="aiMiniLeft">
                  <span className="aiPill">{x.type.toUpperCase()}</span>
                  <span className="aiTiny">{x.label}</span>
                </div>
                <span style={{ color: "rgba(255,255,255,0.60)", fontSize: 12 }}>{x.right ?? ""}</span>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div style={{ color: "rgba(255,255,255,0.82)", fontSize: 12, marginBottom: 8 }}>AI alternatives</div>
          <div className="aiMiniList">
            {alts.map((x, i) => (
              <div className="aiMiniItem" key={i}>
                <div className="aiMiniLeft" style={{ minWidth: 0 }}>
                  <span className="aiPill">{x.label}</span>
                  <span className="aiTiny" title={x.note}>
                    {x.note}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
