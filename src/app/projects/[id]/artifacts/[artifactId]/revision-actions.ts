"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * Creates a NEW artifact row as the next revision of the current artifact.
 * Requires Postgres function:
 * public.create_artifact_revision(p_project_id uuid, p_artifact_id uuid, p_actor_id uuid) returns uuid
 */
export async function createArtifactRevision(args: { projectId: string; artifactId: string }) {
  const projectId = safeParam(args.projectId);
  const artifactId = safeParam(args.artifactId);
  if (!projectId || !artifactId) throw new Error("Missing ids");

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Unauthorized");

  // owner/editor only
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw memErr;

  const role = String((mem as any)?.role ?? "viewer").toLowerCase();
  if (!(role === "owner" || role === "editor")) throw new Error("Forbidden");

  const { data, error } = await supabase.rpc("create_artifact_revision", {
    p_project_id: projectId,
    p_artifact_id: artifactId,
    p_actor_id: auth.user.id,
  });

  if (error) throw new Error(`[rpc.create_artifact_revision] ${error.code} ${error.message}`);

  const newArtifactId = String(data ?? "");
  if (!newArtifactId) throw new Error("No new artifact id returned.");

  revalidatePath(`/projects/${projectId}/artifacts`);
  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/artifacts/${newArtifactId}`);

  return { ok: true, newArtifactId };
}
