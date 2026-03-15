import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export type ApprovalCommentType =
  | "approve"
  | "request_changes"
  | "reject"
  | "resubmit"
  | "general";

export async function addApprovalComment(
  supabase: SupabaseClient,
  args: {
    organisationId?: string | null;
    projectId: string;
    artifactId: string;
    chainId?: string | null;
    stepId?: string | null;
    authorUserId: string;
    commentType: ApprovalCommentType;
    body?: string | null;
    isPrivate?: boolean;
  }
) {
  const body = safeStr(args.body).trim();
  if (!body) return;

  const payload = {
    organisation_id: args.organisationId ?? null,
    project_id: args.projectId,
    artifact_id: args.artifactId,
    chain_id: args.chainId ?? null,
    step_id: args.stepId ?? null,
    author_user_id: args.authorUserId,
    comment_type: args.commentType,
    body,
    is_private: Boolean(args.isPrivate),
  };

  const { error } = await supabase.from("approval_comments").insert(payload);
  if (error) {
    throw new Error(`approval_comments.insert failed: ${error.message}`);
  }
}
