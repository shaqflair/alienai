import "server-only";
import { createClient } from "@/utils/supabase/server";
import { safeStr } from "./utils";

type SupabaseServerClient = ReturnType<typeof createClient> extends Promise<infer T> ? T : any;

export async function requireUser(supabase: SupabaseServerClient) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

/**
 * Membership check
 * Assumes you have RLS policies that allow selecting project_members for members.
 * If you also have a Postgres function like is_project_member(project_id), swap to RPC.
 */
export async function requireProjectMember(supabase: SupabaseServerClient, projectId: string) {
  const pid = safeStr(projectId).trim();
  if (!pid) throw new Error("Missing project id");

  await requireUser(supabase);

  // Try to use project_members table (common)
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id")
    .eq("project_id", pid)
    .limit(1);

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) throw new Error("Forbidden");
}

/**
 * Optional helper: resolve project_id for an artifact id
 * (useful when export routes receive only artifact_id)
 */
export async function resolveProjectIdForArtifact(supabase: SupabaseServerClient, artifactId: string) {
  const aid = safeStr(artifactId).trim();
  if (!aid) return null;

  const { data, error } = await supabase
    .from("artifacts")
    .select("project_id")
    .eq("id", aid)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data?.project_id ?? null;
}
