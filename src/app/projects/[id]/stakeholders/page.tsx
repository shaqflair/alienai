import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import StakeholderRegisterClient from "@/components/stakeholders/StakeholderRegisterClient";

function safeParam(x: unknown): string {
  if (typeof x === "string") return x;
  if (Array.isArray(x) && typeof x[0] === "string") return x[0];
  return "";
}

export default async function StakeholderRegisterPage({
  params,
}: {
  params: { id?: string };
}) {
  const supabase = await createClient();

  // Auth gate
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(params?.id);
  if (!projectId || projectId === "undefined") notFound();

  // Membership gate
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

  // Project header
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr) throw projErr;
  if (!project) notFound();

  // Current stakeholder register artifact (if exists)
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, type, title, content_json, updated_at, created_at")
    .eq("project_id", projectId)
    .eq("type", "stakeholder_register")
    .eq("is_current", true)
    .maybeSingle();

  if (artErr) console.warn("[stakeholder_register.select]", artErr.message);

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}`}>
          ← Back to Project
        </Link>
        <span>
          Role: <span className="font-mono">{myRole}</span>
        </span>
      </div>

      {/* ✅ Project title is the headline */}
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-wide text-gray-500">Project</p>
        <h1 className="text-2xl font-semibold">
          {String((project as any).title ?? "")}
        </h1>
        <p className="text-sm text-gray-600">Stakeholder Register</p>
      </header>

      <StakeholderRegisterClient
        projectId={projectId}
        canEdit={canEdit}
        artifactId={artifact?.id ? String(artifact.id) : null}
        initialJson={(artifact as any)?.content_json ?? null}
      />
    </main>
  );
}
