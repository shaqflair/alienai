"use client";
import React from "react";

export default function EmptyStateAI({
  laneLabel,
  onScan,
}: {
  laneLabel: string;
  onScan?: () => void;
}) {
  return (
    <div className="aiEmpty" role="note" aria-label="Empty state">
      <div className="aiEmptyTitle">No changes in {laneLabel}</div>
      <div className="aiEmptySub">
        No changes pending. Want AI to scan for emerging risks and suggest mitigations across linked artifacts?
      </div>
      {onScan && (
        <button className="aiEmptyBtn" onClick={onScan}>
          Run AI Scan
        </button>
      )}
    </div>
  );
}
