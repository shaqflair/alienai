// src/app/projects/[id]/change/new/page.tsx
import "server-only";

import ChangeHeader from "@/components/change/ChangeHeader";
import ChangeForm from "@/components/change/ChangeForm";
import ChangeManagementBoard from "@/components/change/ChangeManagementBoard";


import { createClient } from "@/utils/supabase/server";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

export default async function ChangeCreatePage({ params }: { params: Promise<{ id?: string }> }) {
  const { id } = await params;
  const projectId = safeStr(id).trim();

  const supabase = await createClient();

  const { data: project } = await supabase
    .from("projects")
    .select("id,title,project_code,client_name")
    .eq("id", projectId)
    .maybeSingle();

  const projectTitle = safeStr(project?.title).trim();
  const projectCode = project?.project_code != null ? String(project.project_code) : "";
  const clientName = safeStr(project?.client_name).trim();

  const subtitleParts = [
    projectTitle ? projectTitle : "Create a new change request",
    projectCode ? `Project ${projectCode}` : "",
    projectId ? `ID ${projectId.slice(0, 8)}…` : "",
    clientName ? clientName : "",
  ].filter(Boolean);

  const subtitle = subtitleParts.join(" • ");

  return (
    <main className="crPage">
      <ChangeHeader
        title="New Change Request"
        subtitle={subtitle || "Create a new change request"}
        backHref={projectId ? `/projects/${projectId}/change` : "/projects"}
      />

      <ChangeForm
        mode="create"
        projectId={projectId}
        projectTitle={projectTitle}
        projectLabel={projectCode ? `Project ${projectCode}` : ""}
      />
    </main>
  );
}
