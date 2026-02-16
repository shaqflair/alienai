import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import ScheduleGanttEditorLazy from "@/components/editors/schedule/ScheduleGanttEditorLazy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export default async function ProjectSchedulePage({
  params,
}: {
  params: { id: string };
}) {
  const projectId = params.id;
  const supabase = await createClient();

  // ---- Auth check ----
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // ---- Fetch project metadata (lightweight) ----
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id,name,project_code,start_date,finish_date")
    .eq("id", projectId)
    .single();

  if (projectErr || !project) {
    redirect("/projects");
  }

  // ---- Fetch schedule artifact (ONLY schedule; no WBS fetching here) ----
  const { data: artifact, error: artifactErr } = await supabase
    .from("artifacts")
    .select("id,content_json,read_only")
    .eq("project_id", projectId)
    .eq("type", "schedule")
    .maybeSingle();

  if (artifactErr || !artifact?.id) {
    redirect(`/projects/${projectId}`);
  }

  const artifactId = artifact.id;
  const initialJson = artifact.content_json ?? null;
  const readOnly = !!artifact.read_only;

  return (
    <ScheduleGanttEditorLazy
      projectId={projectId}
      artifactId={artifactId}
      initialJson={initialJson}
      readOnly={readOnly}
      projectTitle={project.name}
      projectStartDate={safeStr(project.start_date)}
      projectFinishDate={safeStr(project.finish_date)}
      // ✅ IMPORTANT: keep WBS null so the server does not block.
      // The editor will fetch on-demand when user clicks "Import WBS".
      latestWbsJson={null}
    />
  );
}
