import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function bestProjectRole(rows: Array<{ role?: string | null }> | null | undefined) {
  const roles = (rows ?? [])
    .map((r) => String(r?.role ?? "").toLowerCase())
    .filter(Boolean);

  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

export default async function ProjectPage({
  params,
}: {
  // ✅ Next.js 16: params can be a Promise in some routes
  params: Promise<{ id?: string }> | { id?: string };
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // ✅ always unwrap safely
  const p = await Promise.resolve(params as any);
  const projectId = safeParam(p?.id).trim();
  if (!projectId) notFound();

  // ✅ Duplicate-safe gating: fetch rows (no maybeSingle)
  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id);

  if (memErr) throw memErr;

  const myRole = bestProjectRole(memRows as any);
  if (!myRole) notFound(); // not a member

  // ✅ Project title (id is unique, so single() is fine)
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .single();

  if (projErr) throw projErr;

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href="/projects">
          ← Back to Projects
        </Link>
        <div>
          Role: <span className="font-mono">{myRole}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{project?.title ?? "Project"}</h1>
        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <Link className="underline font-medium" href={`/projects/${projectId}`}>
            Overview
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/artifacts`}>
            Artifacts
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/approvals`}>
            Approvals
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/members`}>
            Members
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/change`}>
            Change Control
          </Link>
        </div>
        <p className="text-sm text-gray-600">
          Project home is back. Next we’ll wire up artifacts navigation end-to-end.
        </p>
      </header>

      <section className="border rounded-2xl bg-white p-5 space-y-2">
        <div className="font-medium">Quick links</div>
        <div className="text-sm text-gray-600">
          Go to{" "}
          <Link className="underline" href={`/projects/${projectId}/artifacts`}>
            Artifacts
          </Link>{" "}
          to create and manage documentation.
        </div>
      </section>
    </main>
  );
}
