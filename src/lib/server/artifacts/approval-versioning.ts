import "server-only";

import {
  createApprovalApprovedSnapshot,
  createApprovalSubmissionSnapshot,
} from "@/lib/server/artifacts/collaboration";

export async function snapshotArtifactForApprovalSubmission(params: {
  artifactId: string;
  approvalChainId?: string | null;
  editSessionId?: string | null;
}) {
  return createApprovalSubmissionSnapshot(params);
}

export async function snapshotArtifactForApprovalApproved(params: {
  artifactId: string;
  approvalChainId?: string | null;
}) {
  return createApprovalApprovedSnapshot(params);
}