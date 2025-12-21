import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

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

export default async function ArtifactsPage({
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

  const { data: artifacts, error: artErr } = await supabase
    .from("artifacts")
    .select("id,type,title,created_at,updated_at,is_locked,approved_by,rejected_by")
    .eq("project_id", projectId)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (artErr) throw artErr;

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}`}>
          ← Back to Project
        </Link>
        <div>
          Role: <span className="font-mono">{String((mem as any)?.role ?? "viewer")}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Artifacts — {project?.title ?? "Project"}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <Link className="underline" href={`/projects/${projectId}`}>
            Overview
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline font-medium" href={`/projects/${projectId}/artifacts`}>
            Artifacts
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/members`}>
            Members
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/approvals`}>
            Approvals
          </Link>
        </div>
        <p className="text-sm text-gray-600">Create and manage project documentation artifacts.</p>
      </header>

      <section className="border rounded-2xl bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
          <div className="font-medium">All artifacts</div>
          <Link className="text-sm underline" href={`/projects/${projectId}/artifacts/new`}>
            + New artifact
          </Link>
        </div>

        {(artifacts ?? []).length === 0 ? (
          <div className="p-5 text-sm text-gray-600">No artifacts yet.</div>
        ) : (
          <div className="divide-y">
            {(artifacts ?? []).map((a: any) => (
              <div key={a.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.title || a.type || "Untitled artifact"}</div>
                  <div className="text-xs text-gray-500">Updated: {fmtWhen(a.updated_at ?? a.created_at)}</div>
                  <div className="text-xs text-gray-600 mt-1">
                    Type: <span className="font-mono">{String(a.type ?? "—")}</span>
                    {"  "}•{"  "}
                    Status:{" "}
                    <span className="font-mono">
                      {a.approved_by ? "approved" : a.rejected_by ? "rejected" : a.is_locked ? "submitted" : "draft"}
                    </span>
                  </div>
                </div>

                <Link className="underline text-sm" href={`/projects/${projectId}/artifacts/${a.id}`}>
                  Open →
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
