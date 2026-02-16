import "server-only";

import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/**
 * Ensures parameters are treated as strings to avoid runtime errors.
 */
function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * Resolves the highest permission level if multiple roles are present.
 * Priority: owner > editor > viewer.
 */
function bestProjectRole(rows: Array<{ role?: string | null }> | null | undefined) {
  const roles = (rows ?? [])
    .map((r) => String(r?.role ?? "").toLowerCase())
    .filter(Boolean);

  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

/**
 * Server-side data fetcher for the individual project dashboard.
 * Performs parallel requests for membership and project metadata.
 */
export async function loadProjectHome(params: Promise<{ id?: string }>) {
  const supabase = await createClient();

  // 1. Authenticate user
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // 2. Resolve Project ID from dynamic route params
  const { id } = await params;
  const projectId = safeParam(id).trim();
  if (!projectId) notFound();

  // 3. Parallel fetch: Membership (for RBAC) and Project Metadata
  const [memRes, projRes] = await Promise.all([
    supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id),

    supabase
      .from("projects")
      .select("id, title, project_code")
      .eq("id", projectId)
      .single(),
  ]);

  // 4. Error handling
  if (memRes.error) throw memRes.error;
  if (projRes.error) {
    // If project doesn't exist or user has no access via RLS
    if (projRes.error.code === "PGRST116") notFound(); 
    throw projRes.error;
  }

  // 5. Authorisation check
  const myRole = bestProjectRole(memRes.data as any);
  if (!myRole) notFound(); // User is not a member of this project

  return {
    projectId,
    myRole,
    project: projRes.data as { id: string; title: string; project_code: string | number | null },
  };
}
