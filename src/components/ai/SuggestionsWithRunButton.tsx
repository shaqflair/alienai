"use client";

import React, { useState } from "react";
import AiSuggestionsPanel from "@/components/ai/AiSuggestionsPanel";
import RunOrchestratorButton from "@/components/ai/RunOrchestratorButton";

export default function SuggestionsWithRunButton(props: {
  projectId: string;
  title?: string;
  limit?: number;
  targetArtifactType?: string;
}) {
  const { projectId, title = "AI Suggestions (Proposed)", limit = 20, targetArtifactType } = props;
  const [nonce, setNonce] = useState(0);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          Run the orchestrator to convert new <span className="font-mono">artifact_events</span> into suggestions.
        </div>

        <RunOrchestratorButton
          onRan={() => setNonce((x) => x + 1)}
          label="Run AI analysis"
        />
      </div>

      <AiSuggestionsPanel
        key={nonce} // forces refresh after run
        projectId={projectId}
        title={title}
        limit={limit}
        targetArtifactType={targetArtifactType}
      />
    </div>
  );
}
