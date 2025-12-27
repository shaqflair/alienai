// src/app/projects/[id]/artifacts/actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x.trim() : "";
}

function derivedStatus(a: any) {
  const s = String(a?.approval_status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "changes_requested") return "changes_requested";
  if (s === "submitted") return "submitted";

  // fallback to legacy columns if present
  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";
  return "draft";
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Not authenticated");

  const userId = auth.user.id;

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) throw new Error("Not a project member");

  const role = String((mem as any)?.role ?? "viewer").toLowerCase();
  const canEditByRole = role === "owner" || role === "editor";

  return { userId, role, canEditByRole };
}

async function fetchArtifact(supabase: any, projectId: string, artifactId: string) {
  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select(
      "id, project_id, user_id, type, title, content, content_json, is_locked, approval_status, approved_by, rejected_by, is_current"
    )
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw error;
  if (!artifact) throw new Error("Artifact not found");

  return artifact;
}

function assertEditable(canEditByRole: boolean, artifact: any) {
  const status = derivedStatus(artifact);
  const isEditable =
    canEditByRole && !artifact.is_locked && (status === "draft" || status === "changes_requested");

  if (!isEditable) {
    throw new Error("Artifact is not editable (locked or not in Draft/CR, or insufficient role).");
  }

  return status;
}

/**
 * Create artifact (used by /artifacts/new/page.tsx).
 * - Ensures one current artifact per (project_id, type) by redirecting to existing current if present.
 * - Only owner/editor can create.
 */
export async function createArtifact(formData: FormData) {
  const supabase = await createClient();

  const projectId = safeParam(formData.get("project_id"));
  const type = safeParam(formData.get("type"));
  const title = safeParam(formData.get("title")) || "";

  if (!projectId) throw new Error("Missing project_id");
  if (!type) throw new Error("Missing type");

  const { userId, canEditByRole } = await requireAuthAndMembership(supabase, projectId);
  if (!canEditByRole) throw new Error("You do not have permission to create artifacts for this project.");

  // If a current artifact already exists for this type, reuse it
  const { data: existing, error: exErr } = await supabase
    .from("artifacts")
    .select("id")
    .eq("project_id", projectId)
    .eq("type", type)
    .eq("is_current", true)
    .maybeSingle();

  if (exErr) throw exErr;

  if (existing?.id) {
    redirect(`/projects/${projectId}/artifacts/${existing.id}`);
  }

  const { data: created, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      user_id: userId,
      type,
      title: title || type,
      content: "",
      is_current: true,
      approval_status: "draft",
      status: "draft",
      is_locked: false,
    })
    .select("id")
    .single();

  if (insErr) throw insErr;
  if (!created?.id) throw new Error("Artifact insert succeeded but returned no id.");

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
  redirect(`/projects/${projectId}/artifacts/${created.id}`);
}

/**
 * Update artifact (SAFE: never overwrites missing fields with "").
 * IMPORTANT: Disabled inputs are not submitted; this prevents blank artifacts.
 */
export async function updateArtifact(formData: FormData) {
  const supabase = await createClient();

  const projectId = safeParam(formData.get("project_id"));
  const artifactId = safeParam(formData.get("artifact_id"));
  if (!projectId || !artifactId) throw new Error("Missing project_id/artifact_id");

  const { canEditByRole } = await requireAuthAndMembership(supabase, projectId);
  const artifact = await fetchArtifact(supabase, projectId, artifactId);
  assertEditable(canEditByRole, artifact);

  const titleRaw = formData.get("title");
  const contentRaw = formData.get("content");

  const patch: any = {
    updated_at: new Date().toISOString(),
  };

  // Only update fields that actually arrived in the form submission
  if (typeof titleRaw === "string") patch.title = titleRaw;
  if (typeof contentRaw === "string") patch.content = contentRaw;

  const keys = Object.keys(patch).filter((k) => k !== "updated_at");
  if (keys.length === 0) {
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
    return;
  }

  const { error } = await supabase
    .from("artifacts")
    .update(patch)
    .eq("id", artifactId)
    .eq("project_id", projectId);

  if (error) throw error;

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/**
 * Update artifact JSON content (for structured editors like Project Charter).
 * Requires: public.artifacts.content_json (jsonb) exists.
 */
export async function updateArtifactJson(formData: FormData) {
  const supabase = await createClient();

  const projectId = safeParam(formData.get("project_id"));
  const artifactId = safeParam(formData.get("artifact_id"));
  const contentJsonRaw = safeParam(formData.get("content_json"));

  if (!projectId || !artifactId) throw new Error("Missing project_id/artifact_id");
  if (!contentJsonRaw) throw new Error("Missing content_json");

  const { canEditByRole } = await requireAuthAndMembership(supabase, projectId);
  const artifact = await fetchArtifact(supabase, projectId, artifactId);
  assertEditable(canEditByRole, artifact);

  let parsed: any;
  try {
    parsed = JSON.parse(contentJsonRaw);
  } catch {
    throw new Error("content_json must be valid JSON.");
  }

  const { error } = await supabase
    .from("artifacts")
    .update({
      content_json: parsed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", artifactId)
    .eq("project_id", projectId);

  if (error) throw error;

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/**
 * Save structured JSON (alias).
 * NOTE: Keep one function in UI imports (recommended: use updateArtifactJson).
 */
export async function saveArtifactJson(formData: FormData) {
  // Keep as alias so older imports don’t break
  return updateArtifactJson(formData);
}

/**
 * Add a comment (approvers only, matches your UI).
 */
export async function addArtifactComment(formData: FormData) {
  const supabase = await createClient();

  const projectId = safeParam(formData.get("project_id"));
  const artifactId = safeParam(formData.get("artifact_id"));
  const action = safeParam(formData.get("action")) || "comment";
  const body = safeParam(formData.get("body"));

  if (!projectId || !artifactId) throw new Error("Missing project_id/artifact_id");
  if (!body.trim()) throw new Error("Comment body is required");

  const { userId } = await requireAuthAndMembership(supabase, projectId);

  // Approver gate (flat approvers v1)
  const { data: approverRow, error: apprErr } = await supabase
    .from("project_approvers")
    .select("project_id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();

  if (apprErr) throw apprErr;
  if (!approverRow) throw new Error("Only active approvers can comment.");

  const { error } = await supabase.from("artifact_comments").insert({
    project_id: projectId,
    artifact_id: artifactId,
    actor_user_id: userId,
    action,
    body,
  });

  if (error) throw error;

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}
