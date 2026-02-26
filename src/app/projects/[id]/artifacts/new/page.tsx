// src/app/projects/[id]/artifacts/new/page.tsx  — FIXED v2
// Fixes:
//   ✅ Server error on /artifacts/new — was crashing due to role gate being too strict
//   ✅ Added FINANCIAL_PLAN to normalizeArtifactTypeParam
//   ✅ canCreate now allows "member" role (was blocking valid users with notFound)
//   ✅ Better error boundary around artifact_definitions fetch
//   ✅ Handles missing artifact_definitions table gracefully

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

function isMissingTableError(errMsg: string) {
  const m = String(errMsg || "").toLowerCase();
  return (
    m.includes("does not exist") ||
    m.includes("relation") ||
    m.includes("undefined table")
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
 * ✅ FIXED: Added FINANCIAL_PLAN and financial_plan normalization
 * Also handles lowercase variants that come from ?type= param
 */
function normalizeArtifactTypeParam(raw: unknown) {
  const s = safeStr(raw).trim();
  if (!s) return "";

  const up = s.toUpperCase().trim();
  const t = up.replace(/\s+/g, "_");

  // ✅ Financial Plan (was missing — caused 22P02 enum error on redirect)
  if (
    t === "FINANCIAL_PLAN" ||
    t === "FINANCIALPLAN" ||
    t === "FINANCE" ||
    t === "BUDGET" ||
    t === "BUDGET_PLAN" ||
    t === "FINANCIAL"
  ) return "FINANCIAL_PLAN";

  if (t === "STATUS_DASHBOARD") return "PROJECT_CLOSURE_REPORT";
  if (t === "PID" || t === "PROJECTCHARTER" || t === "PROJECT_CHARTER") return "PROJECT_CHARTER";
  if (t === "STAKEHOLDERS" || t === "STAKEHOLDER") return "STAKEHOLDER_REGISTER";
  if (t === "WORK_BREAKDOWN_STRUCTURE" || t === "WORKBREAKDOWN") return "WBS";
  if (t === "SCHEDULE_ROADMAP" || t === "SCHEDULE_ROAD_MAP" || t === "ROADMAP" || t === "GANTT") return "SCHEDULE";
  if (t === "CHANGE_REQUEST" || t === "CHANGE_REQUESTS" || t === "CHANGE_LOG" || t === "KANBAN") return "CHANGE_REQUESTS";
  if (t === "RAID_LOG" || t === "RAID_REGISTER" || t === "RAID") return "RAID";
  if (t === "LESSONS" || t === "RETRO" || t === "RETROSPECTIVE" || t === "LESSONS_LEARNED") return "LESSONS_LEARNED";
  if (t === "CLOSURE_REPORT" || t === "CLOSEOUT" || t === "PROJECT_CLOSEOUT") return "PROJECT_CLOSURE_REPORT";
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

  // 2) Human id candidates
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
   Fallback artifact types (used if artifact_definitions table is missing/empty)
========================================================= */

const FALLBACK_TYPES = [
  { value: "PROJECT_CHARTER", label: "Project Charter" },
  { value: "FINANCIAL_PLAN", label: "Financial Plan" },
  { value: "STAKEHOLDER_REGISTER", label: "Stakeholder Register" },
  { value: "RAID", label: "RAID Log" },
  { value: "WBS", label: "Work Breakdown Structure" },
  { value: "SCHEDULE", label: "Schedule / Roadmap" },
  { value: "CHANGE_REQUESTS", label: "Change Requests" },
  { value: "WEEKLY_REPORT", label: "Weekly Report" },
  { value: "LESSONS_LEARNED", label: "Lessons Learned" },
  { value: "PROJECT_CLOSURE_REPORT", label: "Project Closure Report" },
];

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

  const { id } = await params;
  const projectIdentifier = safeParam(id);
  if (!projectIdentifier || projectIdentifier === "undefined" || projectIdentifier === "null") notFound();

  const { project, humanCol } = await resolveProjectByIdentifier(supabase, projectIdentifier);
  if (!project?.id) notFound();

  const projectUuid = String(project.id);

  const projectHumanId =
    humanCol && safeStr((project as any)[humanCol]).trim()
      ? safeStr((project as any)[humanCol]).trim()
      : projectIdentifier;

  const sp = (await (searchParams as any)) ?? {};
  const preTypeRaw = safeParam(sp.type);
  const preType = normalizeArtifactTypeParam(preTypeRaw);

  // ✅ FIXED: Gate — must be org member
  const mem = await requireOrgMembershipForProject(supabase, project, auth.user.id);
  if (!mem) notFound();

  const myRole = safeLower(mem.role);

  // ✅ FIXED: "member" role can now create artifacts (was notFound() before)
  // Only truly block viewers/guests if you have those roles
  const BLOCKED_ROLES = ["viewer", "guest", "readonly", "read_only"];
  if (BLOCKED_ROLES.includes(myRole)) notFound();

  // ✅ FIXED: Fetch artifact_definitions with graceful fallback
  let TYPES: { value: string; label: string }[] = [];

  try {
    const { data: defs, error: defsErr } = await supabase
      .from("artifact_definitions")
      .select("key,label,is_active,sort_order")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });

    if (defsErr) {
      // If table doesn't exist, use fallback — don't crash
      if (isMissingTableError(defsErr.message)) {
        console.warn("[NewArtifactPage] artifact_definitions table not found, using fallback types");
        TYPES = FALLBACK_TYPES;
      } else {
        throw defsErr;
      }
    } else {
      TYPES =
        (defs ?? []).map((d: any) => ({
          value: normalizeArtifactTypeParam(d?.key),
          label: safeStr(d?.label ?? d?.key),
        })) ?? [];

      // ✅ If DB returned nothing, use fallback
      if (TYPES.length === 0) {
        TYPES = FALLBACK_TYPES;
      }

      // ✅ Ensure FINANCIAL_PLAN is always present
      if (!TYPES.some(t => t.value === "FINANCIAL_PLAN")) {
        TYPES.push({ value: "FINANCIAL_PLAN", label: "Financial Plan" });
      }
    }
  } catch (err) {
    console.error("[NewArtifactPage] Failed to load artifact_definitions:", err);
    TYPES = FALLBACK_TYPES;
  }

  const validPreType = TYPES.some((t) => t.value === preType) ? preType : "";

  const canManage = ["admin", "owner", "editor"].includes(myRole);
  const projectTitle = safeStr(project?.title ?? project?.name ?? "Project");

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline hover:text-gray-700 transition-colors" href={`/projects/${projectHumanId}/artifacts`}>
          ← Back to Artifacts
        </Link>
        <div className="flex items-center gap-3">
          <span>
            Role: <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">{myRole}</span>
          </span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">
          New artifact — {projectTitle}
        </h1>
        <p className="text-sm text-gray-600">
          Create a draft artifact, then we'll take you to the editor page.
        </p>

        {preTypeRaw && preTypeRaw !== preType && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
            Note: Normalised type from{" "}
            <span className="font-mono">{JSON.stringify(preTypeRaw)}</span> →{" "}
            <span className="font-mono">{JSON.stringify(preType)}</span>
          </p>
        )}
      </header>

      <section className="border rounded-2xl bg-white p-6 space-y-4 shadow-sm">
        <form
          action={async (fd) => {
            "use server";
            await createArtifact(fd);
          }}
          className="grid gap-4"
        >
          {/* Always submit UUID to server action */}
          <input type="hidden" name="project_id" value={projectUuid} />
          <input type="hidden" name="project_human_id" value={projectHumanId} />

          <label className="grid gap-2">
            <span className="text-sm font-medium">Artifact type</span>
            <select
              name="type"
              required
              className="border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
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
            <p className="text-xs text-gray-500">
              Types are driven by <code className="bg-gray-100 px-1 rounded">artifact_definitions</code>.
              Query param <code className="bg-gray-100 px-1 rounded">?type=</code> is normalised to a canonical key.
            </p>
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input
              name="title"
              placeholder="e.g. Financial Plan — FY2025/26"
              className="border rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </label>

          <button
            type="submit"
            className="w-fit px-6 py-2 rounded-xl bg-black text-white text-sm font-medium hover:bg-gray-800 transition-colors"
          >
            Create artifact
          </button>
        </form>
      </section>

      {/* Debug info in dev only */}
      {process.env.NODE_ENV === "development" && (
        <details className="text-xs text-gray-400 border rounded-xl p-4">
          <summary className="cursor-pointer font-medium">Debug info</summary>
          <pre className="mt-2 overflow-auto">
            {JSON.stringify({ projectUuid, projectHumanId, myRole, canManage, preTypeRaw, preType, validPreType, typeCount: TYPES.length }, null, 2)}
          </pre>
        </details>
      )}
    </main>
  );
}