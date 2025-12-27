import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createArtifact } from "../actions";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export default async function NewArtifactPage({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string }>;
  searchParams?: Promise<{ type?: string }> | { type?: string };
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // ✅ Next.js 16: params is async
  const { id } = await params;
  const projectId = safeParam(id);
  if (!projectId || projectId === "undefined" || projectId === "null") notFound();

  const sp = (await searchParams) ?? {};
  const preType = safeParam(sp.type);

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
  const canCreate = myRole === "owner" || myRole === "editor";
  if (!canCreate) notFound();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;

  // ✅ Types driven by artifact_definitions
  const { data: defs, error: defsErr } = await supabase
    .from("artifact_definitions")
    .select("key,label,is_active,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });
  if (defsErr) throw defsErr;

  const TYPES =
    (defs ?? []).map((d: any) => ({
      value: String(d.key),
      label: String(d.label ?? d.key),
    })) ?? [];

  // Only preselect if it's valid
  const validPreType = TYPES.some((t) => t.value === preType) ? preType : "";

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}/artifacts`}>
          ← Back to Artifacts
        </Link>
        <div>
          Role: <span className="font-mono">{myRole}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          New artifact — {project?.title ?? "Project"}
        </h1>
        <p className="text-sm text-gray-600">
          Create a draft artifact, then we’ll take you to the editor page.
        </p>
      </header>

      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <form action={createArtifact} className="grid gap-4">
          <input type="hidden" name="project_id" value={projectId} />

          <label className="grid gap-2">
            <span className="text-sm font-medium">Artifact type</span>
            <select
              name="type"
              required
              className="border rounded-xl px-3 py-2"
              defaultValue={validPreType}
            >
              <option value="" disabled>
                Select…
              </option>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <div className="text-xs text-gray-500">
              Types are driven by <code>artifact_definitions</code>.
            </div>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input
              name="title"
              placeholder="e.g. Project Charter — My project"
              className="border rounded-xl px-3 py-2"
            />
          </label>

          <button
            type="submit"
            className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm"
          >
            Create artifact
          </button>
        </form>
      </section>
    </main>
  );
}
