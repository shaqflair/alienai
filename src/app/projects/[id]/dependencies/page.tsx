// src/app/projects/[id]/dependencies/page.tsx
import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ProjectDependenciesTab from "@/components/projects/ProjectDependenciesTab";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: unknown): string { return typeof x === "string" ? x : x == null ? "" : String(x); }

export default async function DependenciesPage({ params }: { params: Promise<{ id?: string }> }) {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");

  const { id } = await params;
  const projectId = safeStr(id).trim();

  const { data: proj } = await supabase
    .from("projects")
    .select("id, title, project_code")
    .eq("id", projectId)
    .maybeSingle();

  const { data: mem } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  const role    = safeStr((mem as any)?.role).toLowerCase();
  const canEdit = role === "owner" || role === "editor";

  return (
    <div style={{ maxWidth: 1200, margin: "0 auto", padding: "24px 24px 80px" }}>
      <ProjectDependenciesTab
        projectId={projectId}
        projectTitle={safeStr(proj?.title)}
        canEdit={canEdit}
      />
    </div>
  );
}