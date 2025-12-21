import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createArtifact } from "../actions";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export default async function NewArtifactPage({
  params,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const projectId = safeParam(p?.id);
  if (!projectId) notFound();

  // Gate: must be a member
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!mem) notFound();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}/artifacts`}>
          ← Back to Artifacts
        </Link>
        <div>
          Role: <span className="font-mono">{String((mem as any)?.role ?? "viewer")}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">New artifact — {project?.title ?? "Project"}</h1>
        <p className="text-sm text-gray-600">
          Create a draft artifact, then we’ll take you to the editor page.
        </p>
      </header>

      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <form action={createArtifact} className="grid gap-4">
          <input type="hidden" name="project_id" value={projectId} />

          <label className="grid gap-2">
            <span className="text-sm font-medium">Artifact type</span>
            <select name="type" required className="border rounded-xl px-3 py-2" defaultValue="">
              <option value="" disabled>
                Select…
              </option>
              <option value="Executive Report">Executive Report</option>
              <option value="PID">PID</option>
              <option value="RAID Log">RAID Log</option>
              <option value="SoW">SoW</option>
              <option value="Change Request">Change Request</option>
            </select>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input
              name="title"
              placeholder="e.g. PID — Test10"
              className="border rounded-xl px-3 py-2"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Initial content (optional)</span>
            <textarea
              name="content"
              rows={6}
              placeholder="Optional starter notes…"
              className="border rounded-xl px-3 py-2"
            />
          </label>

          <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
            Create artifact
          </button>
        </form>
      </section>
    </main>
  );
}
