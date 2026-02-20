// src/app/projects/[id]/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/* =========================================================
   small helpers
========================================================= */

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "";
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = String(col || "").toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}

function isInvalidInputSyntaxError(err: any) {
  return String(err?.code || "").trim() === "22P02";
}

const RESERVED = new Set([
  "artifacts",
  "changes",
  "change",
  "members",
  "approvals",
  "lessons",
  "raid",
  "schedule",
  "wbs",
]);

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();

  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];

  return v;
}

const HUMAN_COL_CANDIDATES = [
  "project_human_id",
  "human_id",
  "project_code",
  "code",
  "slug",
  "reference",
  "ref",
] as const;

async function resolveProjectUuidFast(supabase: any, identifier: string) {
  const raw = safeStr(identifier).trim();
  if (!raw) return { projectUuid: null as string | null, project: null as any, humanCol: null as string | null };

  if (looksLikeUuid(raw)) {
    return { projectUuid: raw, project: null as any, humanCol: null as string | null };
  }

  const normalized = normalizeProjectIdentifier(raw);

  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase.from("projects").select("*").eq(col, normalized).maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }

    if (data?.id) return { projectUuid: String(data.id), project: data, humanCol: col as string };
  }

  return { projectUuid: null as string | null, project: null as any, humanCol: null as string | null };
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

/* =========================================================
   page
========================================================= */

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id } = await params;
  const rawId = safeParam(id).trim();
  if (!rawId) notFound();

  const lower = rawId.toLowerCase();
  if (RESERVED.has(lower)) redirect("/projects");

  let resolved = await resolveProjectUuidFast(supabase, rawId);
  if (!resolved?.projectUuid) notFound();
  const projectUuid = String(resolved.projectUuid);

  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  if (memErr) throw memErr;

  const myRole = bestProjectRole(memRows as any);
  if (!myRole) notFound();

  let project = resolved.project ?? null;
  if (!project) {
    const { data: p } = await supabase
      .from("projects")
      .select("id,title,project_code")
      .eq("id", projectUuid)
      .maybeSingle();
    if (p?.id) project = p;
  }

  const projectTitle = safeStr(project?.title ?? "Project") || "Project";
  const projectCode = safeStr(project?.project_code ?? "").trim();
  const projectRefForUrls = rawId;

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">

        {/* Top Bar */}
        <div className="flex items-center justify-between">
          <Link href="/projects" className="rounded-lg border px-4 py-2 text-sm">
            ← Back to Projects
          </Link>

          <div className="flex items-center gap-3">
            {projectCode ? (
              <span className="rounded-full bg-blue-50 border px-3 py-1 text-xs font-medium">
                Project <span className="font-mono font-bold">{projectCode}</span>
              </span>
            ) : null}

            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs">
              Role: <span className="font-mono">{myRole}</span>
            </span>
          </div>
        </div>

        {/* Header */}
        <header className="space-y-4">
          <h1 className="text-3xl font-bold">{projectTitle}</h1>

          <nav className="flex flex-wrap gap-2">
            <Link className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white" href={`/projects/${projectRefForUrls}`}>Overview</Link>
            <Link className="rounded-lg border px-4 py-2 text-sm" href={`/projects/${projectRefForUrls}/artifacts`}>Artifacts</Link>
            <Link className="rounded-lg border px-4 py-2 text-sm" href={`/projects/${projectRefForUrls}/changes`}>Changes</Link>
            <Link className="rounded-lg border px-4 py-2 text-sm" href={`/projects/${projectRefForUrls}/approvals`}>Approvals</Link>
            <Link className="rounded-lg border px-4 py-2 text-sm" href={`/projects/${projectRefForUrls}/members`}>Members</Link>
          </nav>

          <p className="text-sm text-gray-500">
            Project home is back. Next we'll wire up artifacts navigation end-to-end.
          </p>
        </header>

        {/* Quick Links */}
        <section className="rounded-xl border p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500"></div>
            <h2 className="font-semibold">Quick links</h2>
          </div>

          <p className="text-sm text-gray-600">
            Go to{" "}
            <Link className="font-medium text-blue-600 hover:underline" href={`/projects/${projectRefForUrls}/artifacts`}>
              Artifacts
            </Link>{" "}
            to create and manage documentation.
          </p>
        </section>

      </div>
    </main>
  );
}