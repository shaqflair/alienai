// src/app/projects/[id]/artifacts/[artifactId]/DiffPanel.tsx
"use client";

import ArtifactDiffExperience from "@/components/artifacts/diff/ArtifactDiffExperience";
import type { ArtifactDiff } from "@/lib/artifacts/diff/types";

export type AuditHint = {
  artifact_id: string;
  happened_at: string;
  actor_id: string | null;
  summary: string | null;
  table_name: string | null;
  action: string | null;
};

export type ApprovalHint = {
  artifact_id: string;
  happened_at: string;
  actor_id: string | null;
  summary: string | null;
};

export default function DiffPanel({
  diff,
  sameVersion,
  versionA,
  versionB,
  auditHints,
  approvalHints,
}: {
  diff: ArtifactDiff | null;
  sameVersion: boolean;
  versionA: { id: string; label: string; updated_at?: string | null } | null;
  versionB: { id: string; label: string; updated_at?: string | null } | null;
  auditHints: AuditHint[];
  approvalHints: ApprovalHint[];
}) {
  return (
    <ArtifactDiffExperience
      diff={diff}
      sameVersion={sameVersion}
      versionA={versionA}
      versionB={versionB}
      auditHints={auditHints}
      approvalHints={approvalHints}
    />
  );
}
