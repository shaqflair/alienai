import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import CompareVersionsClient from "./CompareVersionsClient";

function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

function safeChangeIdFromContentJson(cj: any): string | null {
  try {
    if (!cj) return null;
    const obj = typeof cj === "string" ? JSON.parse(cj) : cj;
    const v = obj?.changeId ?? obj?.change_id ?? null;
    const s = typeof v === "string" ? v.trim() : "";
    // very light validation (uuid-ish length); avoid crashing UX
    if (s && s.length >= 32) return s;
    return null;
  } catch {
    return null;
  }
}

export default async function CompareArtifactVersionsPage({
  params,
}: {
  params: Promise<{ id?: string; artifactId?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id, artifactId: aid } = await params;

  const projectId = safeParam(id);
  const artifactId = safeParam(aid);
  if (!projectId || !artifactId || projectId === "undefined" || artifactId === "undefined") notFound();

  // Project (for breadcrumb/title)
  const { data: project, error: projErr } = await supabase.from("projects").select("id, title").eq("id", projectId).maybeSingle();
  if (projErr) throw projErr;
  if (!project) notFound();

  // Current artifact (for type/title + default changeId)
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, title, type, root_artifact_id, content_json")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (artErr) throw artErr;
  if (!artifact) notFound();

  const rootId = (artifact as any).root_artifact_id ?? artifactId;

  // ✅ Load versions: (root_artifact_id = rootId) OR (id = rootId)
  const { data: versions, error: verErr } = await supabase
    .from("artifacts")
    .select("id, version, is_current, is_baseline, updated_at, created_at, approval_status, root_artifact_id")
    .eq("project_id", projectId)
    .or(`root_artifact_id.eq.${rootId},id.eq.${rootId}`)
    .order("version", { ascending: false })
    .order("updated_at", { ascending: false });

  if (verErr) throw verErr;

  const items =
    (versions ?? []).map((v: any) => ({
      id: String(v.id),
      version: Number(v.version ?? 0),
      is_current: !!v.is_current,
      is_baseline: !!v.is_baseline,
      approval_status: String(v.approval_status ?? "draft"),
      updated_at: String(v.updated_at ?? v.created_at ?? ""),
    })) ?? [];

  const defaultChangeId = safeChangeIdFromContentJson((artifact as any).content_json);

  return (
    <main className="mx-auto w-full max-w-none px-6 py-6 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <div className="flex items-center gap-2">
          <Link className="underline" href={`/projects/${projectId}/artifacts/${artifactId}`}>
            ← Back to artifact
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/artifacts`}>
            All artifacts
          </Link>
        </div>

        <div className="hidden md:block">
          Project: <span className="font-mono">{String((project as any).title ?? "—")}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Compare versions</h1>
        <div className="text-sm text-gray-600">
          Artifact:{" "}
          <span className="font-medium text-gray-900">
            {String((artifact as any).title ?? "") || String((artifact as any).type ?? "Artifact")}
          </span>
        </div>
      </header>

      <CompareVersionsClient
        projectId={projectId}
        artifactId={artifactId}
        versions={items}
        defaultChangeId={defaultChangeId}
      />
    </main>
  );
}
