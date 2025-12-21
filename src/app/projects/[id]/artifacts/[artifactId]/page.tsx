import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { submitArtifact, updateArtifact } from "../actions";

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

function statusPill(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return { label: "✅ Approved", cls: "bg-green-50 border-green-200 text-green-800" };
  if (s === "rejected") return { label: "❌ Rejected", cls: "bg-red-50 border-red-200 text-red-800" };
  if (s === "submitted") return { label: "🟡 Submitted", cls: "bg-yellow-50 border-yellow-200 text-yellow-800" };
  return { label: "📝 Draft", cls: "bg-gray-50 border-gray-200 text-gray-800" };
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

  // Gate: must be a member
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

  // Load artifact
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select(
      "id, project_id, user_id, type, title, content, created_at, updated_at, is_locked, locked_at, locked_by, approved_by, rejected_by"
    )
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (artErr) throw artErr;
  if (!artifact) notFound();

  const status = derivedStatus(artifact);
  const pill = statusPill(status);

  const isLocked = !!artifact.is_locked;
  const isEditable = canEdit && !isLocked && status === "draft";

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
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${pill.cls}`}>
            {pill.label}
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
          {artifact.locked_at ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">Submitted: {fmtWhen(String(artifact.locked_at))}</span>
            </>
          ) : null}
        </div>
      </header>

      {/* Actions */}
      <section className="border rounded-2xl bg-white p-5 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          {isEditable
            ? "You can edit this draft."
            : isLocked
              ? "This artifact is submitted (locked). Edits are disabled."
              : "View-only."}
        </div>

        {canEdit && status === "draft" ? (
          <form action={submitArtifact}>
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <button
              type="submit"
              className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm"
            >
              Submit for approval
            </button>
          </form>
        ) : null}
      </section>

      {/* Editor */}
      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Content</div>
          {!isEditable ? <div className="text-xs text-gray-500">Read-only</div> : null}
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
              disabled={!isEditable}
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Content</span>
            <textarea
              name="content"
              rows={14}
              defaultValue={String(artifact.content ?? "")}
              className="border rounded-xl px-3 py-2 font-mono text-sm"
              disabled={!isEditable}
            />
          </label>

          {isEditable ? (
            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save changes
            </button>
          ) : null}
        </form>
      </section>
    </main>
  );
}
