// src/app/projects/[id]/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import { closeProject, deleteProject } from "../actions";

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

function shapeErr(err: any) {
  if (!err) return { kind: "empty", raw: err };
  if (err instanceof Error) return { kind: "Error", name: err.name, message: err.message, stack: err.stack };
  return {
    kind: typeof err,
    code: err?.code,
    message: err?.message,
    details: err?.details,
    hint: err?.hint,
    status: err?.status,
    raw: err,
  };
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

  // allow "P-100011" / "PRJ-100011" / etc -> "100011"
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

/**
 * UUID fast-path:
 * - if identifier is UUID, return it as projectUuid WITHOUT selecting projects
 * - only probe projects when identifier is human id
 */
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

  // fallback: try raw in common text cols (only if they exist)
  for (const col of ["slug", "reference", "ref", "code"] as const) {
    const { data, error } = await supabase.from("projects").select("*").eq(col, raw).maybeSingle();

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

function canEdit(role: string) {
  return role === "owner" || role === "editor";
}
function canDelete(role: string) {
  return role === "owner";
}

/* =========================================================
   page
========================================================= */

export default async function ProjectPage({
  params,
}: {
  // ✅ Next 16: treat params as Promise to avoid sync-dynamic-api errors
  params: Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id } = await params;
  const rawId = safeParam(id).trim();
  if (!rawId) notFound();

  // ✅ Guard: prevent /projects/artifacts etc becoming a "project id"
  const lower = rawId.toLowerCase();
  if (RESERVED.has(lower)) {
    redirect("/projects");
  }

  // ✅ Resolve UUID (supports UUID + P-00001 + numeric + other human cols)
  let resolved: { projectUuid: string | null; project: any; humanCol: string | null } | null = null;
  try {
    resolved = await resolveProjectUuidFast(supabase, rawId);
  } catch (e) {
    console.error("[ProjectPage] resolveProjectUuidFast error:", shapeErr(e), { rawId });
    notFound();
  }

  if (!resolved?.projectUuid) notFound();
  const projectUuid = String(resolved.projectUuid);

  // ✅ Membership gate using UUID only (prevents 22P02)
  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  if (memErr) throw memErr;

  const myRole = bestProjectRole(memRows as any);
  if (!myRole) notFound();

  // ✅ Project meta (best effort)
  let project = resolved.project ?? null;
  if (!project) {
    const { data: p, error: pErr } = await supabase
      .from("projects")
      .select("id,title,project_code")
      .eq("id", projectUuid)
      .maybeSingle();
    if (!pErr && p?.id) project = p;
  }

  const projectTitle = safeStr(project?.title ?? "Project") || "Project";
  const projectCode = safeStr(project?.project_code ?? "").trim();

  // ✅ This is the identifier we should keep using in URLs (so your human routes keep working)
  const projectRefForUrls = rawId;

  const allowClose = canEdit(myRole);
  const allowDelete = canDelete(myRole);

  return (
    <main className="min-h-screen bg-white">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Top Bar */}
        <div className="flex items-center justify-between">
          <Link
            href="/projects"
            className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
          >
            ← Back to Projects
          </Link>

          <div className="flex items-center gap-3">
            {projectCode ? (
              <span className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1.5 text-xs font-medium text-blue-700">
                Project <span className="font-mono font-bold">{projectCode}</span>
              </span>
            ) : null}

            <span className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-600">
              Role: <span className="font-mono text-gray-900">{myRole}</span>
            </span>
          </div>
        </div>

        {/* Header */}
        <header className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h1 className="text-3xl font-bold text-gray-900">{projectTitle}</h1>

            {/* ✅ Close / Delete are ACTIONS (not Links) */}
            <div className="flex items-center gap-2 justify-start sm:justify-end">
              <form action={closeProject}>
                <input type="hidden" name="project_id" value={projectUuid} />
                <button
                  type="submit"
                  disabled={!allowClose}
                  className={[
                    "rounded-lg border px-4 py-2 text-sm font-semibold transition",
                    allowClose
                      ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed",
                  ].join(" ")}
                  title={allowClose ? "Close project" : "You need owner/editor to close"}
                >
                  Close
                </button>
              </form>

              <form action={deleteProject}>
                <input type="hidden" name="project_id" value={projectUuid} />
                {/* uses your existing server action contract */}
                <input type="hidden" name="confirm" value="DELETE" />
                <button
                  type="submit"
                  disabled={!allowDelete}
                  className={[
                    "rounded-lg border px-4 py-2 text-sm font-semibold transition",
                    allowDelete
                      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
                      : "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed",
                  ].join(" ")}
                  title={allowDelete ? "Delete project" : "Only owner can delete"}
                >
                  Delete
                </button>
              </form>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2">
            <Link
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 transition-colors shadow-sm"
              href={`/projects/${projectRefForUrls}`}
            >
              Overview
            </Link>
            <Link
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
              href={`/projects/${projectRefForUrls}/artifacts`}
            >
              Artifacts
            </Link>
            <Link
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
              href={`/projects/${projectRefForUrls}/changes`}
            >
              Changes
            </Link>
            <Link
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
              href={`/projects/${projectRefForUrls}/approvals`}
            >
              Approvals
            </Link>
            <Link
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-400 transition-colors"
              href={`/projects/${projectRefForUrls}/members`}
            >
              Members
            </Link>
          </nav>

          <p className="text-sm text-gray-500">
            Project home is back. Next we&apos;ll wire up artifacts navigation end-to-end.
          </p>
        </header>

        {/* Quick Links Card */}
        <section className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-green-500"></div>
            <h2 className="font-semibold text-gray-900">Quick links</h2>
          </div>

          <p className="text-sm text-gray-600">
            Go to{" "}
            <Link
              className="font-medium text-blue-600 hover:text-blue-700 hover:underline"
              href={`/projects/${projectRefForUrls}/artifacts`}
            >
              Artifacts
            </Link>{" "}
            to create and manage documentation.
          </p>

          <div className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-500 font-mono">
            Resolved project UUID: {projectUuid}
          </div>
        </section>
      </div>
    </main>
  );
}
