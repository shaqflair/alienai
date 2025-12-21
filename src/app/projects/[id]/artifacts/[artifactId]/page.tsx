import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { updateArtifact } from "../actions";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function fmtWhen(x: string | null) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(x);
  }
}

function derivedStatus(a: any) {
  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";
  return "draft";
}

export default async function ArtifactDetailPage({
  params,
}: {
  params: { id?: string; artifactId?: string } | Promise<{ id?: string; artifactId?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const projectId = safeParam(p?.id);
  const artifactId = safeParam(p?.artifactId);
  if (!projectId || !artifactId) notFound();

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!mem) notFound();

  const myRole = String((mem as any)?.role ?? "viewer").toLowerCase();
  const canEdit = myRole === "owner" || myRole === "editor";

  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, user_id, type, title, content, created_at, updated_at, is_locked, approved_by, rejected_by")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (artErr) throw artErr;
  if (!artifact) notFound();

  const status = derivedStatus(artifact);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}/artifacts`}>
          ← Back to Artifacts
        </Link>
        <div className="flex items-center gap-3">
          <span>
            Role: <span className="font-mono">{myRole}</span>
          </span>
          <span className="opacity-40">•</span>
          <span>
            Status: <span className="font-mono">{status}</span>
          </span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{artifact.title || artifact.type || "Artifact"}</h1>
        <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded border px-2 py-0.5 bg-gray-50">
            Type: <span className="ml-1 font-mono">{String(artifact.type ?? "—")}</span>
          </span>
          <span className="opacity-40">•</span>
          <span className="text-xs">Updated: {fmtWhen(artifact.updated_at ?? artifact.created_at)}</span>
        </div>
      </header>

      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Edit</div>
          {!canEdit ? <div className="text-xs text-gray-500">View-only (viewer)</div> : null}
        </div>

        <form action={updateArtifact} className="grid gap-4">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="artifact_id" value={artifactId} />

          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input
              name="title"
              defaultValue={String(artifact.title ?? "")}
              className="border rounded-xl px-3 py-2"
              disabled={!canEdit}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Content</span>
            <textarea
              name="content"
              rows={14}
              defaultValue={String(artifact.content ?? "")}
              className="border rounded-xl px-3 py-2 font-mono text-sm"
              disabled={!canEdit}
            />
          </label>

          {canEdit ? (
            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save changes
            </button>
          ) : null}
        </form>
      </section>
    </main>
  );
}
