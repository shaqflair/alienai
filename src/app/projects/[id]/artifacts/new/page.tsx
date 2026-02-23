// src/app/projects/[id]/artifacts/new/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createArtifact } from "../actions";

/* =========================================================
   utils
========================================================= */

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = col.toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
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
 * Normalize type query param so bad links like:
 *   ?type=PROJECT%20CHARTER
 * become:
 *   PROJECT_CHARTER
 *
 * This prevents Postgres 22P02 when the DB expects an enum value.
 */
function normalizeArtifactTypeParam(raw: unknown) {
  const s = safeStr(raw).trim();
  if (!s) return "";

  const up = s.toUpperCase().trim();
  const t = up.replace(/\s+/g, "_");

  // aliases / compatibility
  if (t === "STATUS_DASHBOARD") return "PROJECT_CLOSURE_REPORT";
  if (t === "PID" || t === "PROJECTCHARTER" || t === "PROJECT_CHARTER") return "PROJECT_CHARTER";

  if (t === "STAKEHOLDERS" || t === "STAKEHOLDER") return "STAKEHOLDER_REGISTER";
  if (t === "WORK_BREAKDOWN_STRUCTURE" || t === "WORKBREAKDOWN") return "WBS";
  if (t === "SCHEDULE_ROADMAP" || t === "SCHEDULE_ROAD_MAP" || t === "ROADMAP" || t === "GANTT") return "SCHEDULE";

  if (t === "CHANGE_REQUEST" || t === "CHANGE_REQUESTS" || t === "CHANGE_LOG" || t === "KANBAN") return "CHANGE_REQUESTS";

  if (t === "RAID_LOG" || t === "RAID_REGISTER" || t === "RAID") return "RAID";

  if (t === "LESSONS" || t === "RETRO" || t === "RETROSPECTIVE" || t === "LESSONS_LEARNED") return "LESSONS_LEARNED";

  if (t === "CLOSURE_REPORT" || t === "CLOSEOUT" || t === "PROJECT_CLOSEOUT") return "PROJECT_CLOSURE_REPORT";

  // ✅ Weekly Report
  if (t === "WEEKLY" || t === "WEEKLY_STATUS" || t === "WEEKLY_UPDATE" || t === "DELIVERY_REPORT") return "WEEKLY_REPORT";

  return t;
}

async function resolveProjectByIdentifier(supabase: any, identifier: string) {
  const id = safeStr(identifier).trim();
  if (!id) return { project: null as any, humanCol: null as string | null };

  // 1) UUID
  if (looksLikeUuid(id)) {
    const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    if (error) throw error;
    return { project: data ?? null, humanCol: null as string | null };
  }

  // 2) Human id candidates (project_code etc)
  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase.from("projects").select("*").eq(col, id).maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      throw error;
    }

    if (data?.id) return { project: data, humanCol: col as string };
  }

  return { project: null as any, humanCol: null as string | null };
}

/**
 * ✅ Membership via organisation_members + projects.organisation_id
 * Matches your new /api/ai/events model.
 */
async function requireOrgMembershipForProject(supabase: any, project: any, userId: string) {
  const orgId = safeStr(project?.organisation_id).trim();
  if (!orgId) return null;

  const { data: mem, error: memErr } = await supabase
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) return null;

  const role = safeLower((mem as any)?.role ?? "member");
  return { role };
}

/* =========================================================
   page
========================================================= */

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
  const projectIdentifier = safeParam(id);
  if (!projectIdentifier || projectIdentifier === "undefined" || projectIdentifier === "null") notFound();

  // ✅ resolve uuid OR human id (project_code)
  const { project, humanCol } = await resolveProjectByIdentifier(supabase, projectIdentifier);
  if (!project?.id) notFound();

  const projectUuid = String(project.id);

  const projectHumanId =
    humanCol && safeStr((project as any)[humanCol]).trim()
      ? safeStr((project as any)[humanCol]).trim()
      : projectIdentifier;

  const sp = (await (searchParams as any)) ?? {};
  const preTypeRaw = safeParam(sp.type);

  // ✅ normalize param to prevent enum 22P02
  const preType = normalizeArtifactTypeParam(preTypeRaw);

  // ✅ Gate: must be org member for the project's org
  const mem = await requireOrgMembershipForProject(supabase, project, auth.user.id);
  if (!mem) notFound();

  // Map org role -> create rights (adjust if you have admin/member)
  const myRole = safeLower(mem.role);
  const canCreate = myRole === "admin" || myRole === "owner" || myRole === "editor";
  if (!canCreate) notFound();

  // ✅ Types driven by artifact_definitions (canonical keys)
  const { data: defs, error: defsErr } = await supabase
    .from("artifact_definitions")
    .select("key,label,is_active,sort_order")
    .eq("is_active", true)
    .order("sort_order", { ascending: true });

  if (defsErr) throw defsErr;

  const TYPES =
    (defs ?? []).map((d: any) => ({
      value: normalizeArtifactTypeParam(d?.key), // ensure canonical
      label: safeStr(d?.label ?? d?.key),
    })) ?? [];

  // Only preselect if it's valid (after normalization)
  const validPreType = TYPES.some((t) => t.value === preType) ? preType : "";

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectHumanId}/artifacts`}>
          ← Back to Artifacts
        </Link>
        <div>
          Role: <span className="font-mono">{myRole}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          New artifact — {safeStr(project?.title ?? project?.name ?? "Project")}
        </h1>
        <p className="text-sm text-gray-600">Create a draft artifact, then we’ll take you to the editor page.</p>

        {preTypeRaw && preTypeRaw !== preType ? (
          <p className="text-xs text-amber-700">
            Note: Normalised type from <span className="font-mono">{JSON.stringify(preTypeRaw)}</span> →{" "}
            <span className="font-mono">{JSON.stringify(preType)}</span>
          </p>
        ) : null}
      </header>

      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <form action={async (fd) => { await createArtifact(fd); }} className="grid gap-4">
          {/* ✅ always submit UUID to server action */}
          <input type="hidden" name="project_id" value={projectUuid} />
          <input type="hidden" name="project_human_id" value={projectHumanId} />

          <label className="grid gap-2">
            <span className="text-sm font-medium">Artifact type</span>
            <select name="type" required className="border rounded-xl px-3 py-2" defaultValue={validPreType}>
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
              Types are driven by <code>artifact_definitions</code>. Query param <code>?type=</code> is normalised to a
              canonical key.
            </div>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input name="title" placeholder="e.g. Weekly Report — Week ending 16 Feb 2026" className="border rounded-xl px-3 py-2" />
          </label>

          <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
            Create artifact
          </button>
        </form>
      </section>
    </main>
  );
}
