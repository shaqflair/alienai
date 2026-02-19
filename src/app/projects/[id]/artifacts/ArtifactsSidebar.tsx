// src/app/projects/[id]/artifacts/ArtifactsSidebar.tsx
import "server-only";

import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

/**
 * ArtifactsSidebar
 * - Server component
 * - Resolves project from route param (UUID or human code like P-00001 or "00001")
 * - Fetches artifacts list for sidebar navigation
 *
 * ✅ Fix: project_code is TEXT in your schema
 * - Resolve by: id (uuid) OR project_code (text variants: "10001", "P-10001", "P-00001")
 * - Keep fallback sources for membership views/tables
 */

const PROJECT_COLS = "id,title,project_code,organisation_id,client_name,created_at";
const PROJECT_FALLBACK_SOURCES: Array<{
  table: string;
  select: string;
  filterById?: string;
  filterByCode?: string;
}> = [
  {
    table: "my_projects",
    select: "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "projects_members",
    select: "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "project_members",
    select: "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "project_users",
    select: "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "project_memberships",
    select: "project_id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "project_id",
    filterByCode: "project_code",
  },
];

function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function safeLower(x: any) {
  return safeStr(x).toLowerCase();
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function normalizeProjectRef(projectParam: string) {
  const raw = safeStr(projectParam);
  if (!raw) return "";
  if (raw === "undefined" || raw === "null") return "";
  return raw;
}

function extractDigits(raw: string): string | null {
  const s = safeStr(raw).toUpperCase();
  const m = s.match(/(\d{1,10})/);
  if (!m) return null;
  const digits = m[1];
  if (!digits) return null;
  // remove leading zeros safely (but keep at least one digit)
  const norm = String(Number(digits));
  return norm && norm !== "NaN" ? norm : digits.replace(/^0+/, "") || "0";
}

function projectCodeVariants(raw: string): string[] {
  const out = new Set<string>();
  const s = safeStr(raw);
  if (s) out.add(s);
  const up = s.toUpperCase();
  if (up) out.add(up);

  const digits = extractDigits(s);
  if (digits) {
    out.add(digits);
    out.add(`P-${digits}`);
    out.add(`P-${digits.padStart(5, "0")}`);
  }

  // also if user passed "P-00001", include "00001" and "1"
  const m = up.match(/^P-(\d{1,10})$/);
  if (m?.[1]) {
    out.add(m[1]);
    out.add(String(Number(m[1])));
  }

  return Array.from(out).filter(Boolean);
}

/* ---------------- logging ---------------- */

function shapeErr(err: any) {
  if (!err) return {};
  if (typeof err === "string") return { message: err };
  const out: any = {};
  if (typeof err?.message === "string") out.message = err.message;
  if (typeof err?.code === "string") out.code = err.code;
  if (typeof err?.details === "string") out.details = err.details;
  if (typeof err?.hint === "string") out.hint = err.hint;
  if (typeof err?.status === "number") out.status = err.status;
  return out;
}

function logSbError(tag: string, err: any, extra?: any) {
  const shaped = { ...shapeErr(err), ...(extra || {}) };
  console.error(tag, shaped);
  console.error(`${tag} (raw)`, err);
}

function displayProjectCode(project_code: any) {
  const s = safeStr(project_code);
  if (!s) return "—";
  // display friendly: if already "P-xxxxx" keep it, else prefix with P-
  if (/^P-\d+$/i.test(s)) return s.toUpperCase();
  const digits = extractDigits(s);
  if (digits) return `P-${digits.padStart(5, "0")}`;
  return s;
}

function displayArtifactTitle(a: any) {
  const t = safeStr(a?.title);
  if (t) return t;

  // fallback to effective type (more stable than raw type)
  const eff = safeStr(a?.effective_type || a?.artifact_type || a?.type);
  return eff || "Artifact";
}

/* ---------------- project resolve (robust + TEXT project_code) ---------------- */

async function selectFirst(
  sb: any,
  table: string,
  select: string,
  filterCol: string,
  filterVal: any
) {
  const { data, error } = await sb.from(table).select(select).eq(filterCol, filterVal).limit(1);
  const row = Array.isArray(data) && data.length ? data[0] : null;
  return { row, error, count: Array.isArray(data) ? data.length : 0 };
}

async function resolveProject(sb: any, projectParam: string) {
  const raw = normalizeProjectRef(projectParam);

  const debugBase: any = {
    projectParam,
    raw,
    looksUuid: looksLikeUuid(raw),
    codeVariants: projectCodeVariants(raw),
  };

  if (!raw) {
    return { data: null as any, error: new Error("Missing project id"), debug: debugBase };
  }

  // 1) UUID direct
  if (looksLikeUuid(raw)) {
    const r = await selectFirst(sb, "projects", PROJECT_COLS, "id", raw);
    if (r.error)
      return { data: null as any, error: r.error, debug: { ...debugBase, stage: "projects:id:error" } };
    if (r.row) return { data: r.row, error: null, debug: { ...debugBase, stage: "projects:id:ok" } };

    // fallback membership sources by id
    for (const src of PROJECT_FALLBACK_SOURCES) {
      if (!src.filterById) continue;
      const rr = await selectFirst(sb, src.table, src.select, src.filterById, raw);
      if (rr.error) continue;
      if (rr.row)
        return { data: rr.row, error: null, debug: { ...debugBase, stage: `${src.table}:${src.filterById}:ok` } };
    }

    return {
      data: null as any,
      error: new Error("Project not found (or no access via RLS)"),
      debug: { ...debugBase, stage: "not_found_uuid" },
    };
  }

  // 2) project_code TEXT variants
  const variants = projectCodeVariants(raw);

  for (const v of variants) {
    const r = await selectFirst(sb, "projects", PROJECT_COLS, "project_code", v);
    if (r.error)
      return { data: null as any, error: r.error, debug: { ...debugBase, stage: "projects:code:error", v } };
    if (r.row) return { data: r.row, error: null, debug: { ...debugBase, stage: "projects:code:ok", v } };
  }

  // fallback membership sources by code variants
  for (const src of PROJECT_FALLBACK_SOURCES) {
    if (!src.filterByCode) continue;

    for (const v of variants) {
      const rr = await selectFirst(sb, src.table, src.select, src.filterByCode, v);
      if (rr.error) continue;
      if (rr.row)
        return {
          data: rr.row,
          error: null,
          debug: { ...debugBase, stage: `${src.table}:${src.filterByCode}:ok`, v },
        };
    }
  }

  return {
    data: null as any,
    error: new Error("Project not found (or no access via RLS)"),
    debug: { ...debugBase, stage: "not_found_code_text" },
  };
}

/* ---------------- artifacts query (simple + safe) ---------------- */

async function queryArtifacts(sb: any, projectUuid: string) {
  // Robust select for legacy rows where artifact_type is null or type differs.
  const select = "id,title,type,artifact_type,is_current,created_at,approval_status,deleted_at";

  const { data, error } = await sb
    .from("artifacts")
    .select(select)
    .eq("project_id", projectUuid)
    .is("deleted_at", null)
    .eq("is_current", true)
    .order("created_at", { ascending: true });

  const list = Array.isArray(data) ? data : [];

  const normalized = list.map((a: any) => ({
    ...a,
    // “effective type” is what the UI should treat as canonical for routing/labels
    effective_type: (a?.artifact_type || a?.type || "").toString(),
  }));

  return { list: normalized, error };
}

/* ---------------- status helpers ---------------- */

function isSubmittedArtifact(a: any) {
  const s = safeLower(a?.approval_status);
  if (!s) return false; // treat null/empty as Draft
  if (s === "draft") return false;
  // anything else implies it has been submitted into a workflow
  return true;
}

function StatusPill({ submitted }: { submitted: boolean }) {
  return (
    <span
      className={[
        "shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        submitted
          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
          : "border-gray-200 bg-gray-50 text-gray-600",
      ].join(" ")}
    >
      {submitted ? "Submitted" : "Draft"}
    </span>
  );
}

export default async function ArtifactsSidebar({ projectId }: { projectId: string }) {
  const sb = await createClient();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) redirect("/login");
  if (!auth?.user) redirect("/login");

  const resolved = await resolveProject(sb, projectId);
  const project = resolved.data;
  const projErr = resolved.error;

  if (projErr || !project) {
    logSbError(
      "[ArtifactsSidebar] Project resolve error",
      projErr || new Error("resolveProject returned no project"),
      resolved?.debug
    );
    notFound();
  }

  const projectUuid = safeStr(project.id) || safeStr((project as any).project_id);
  if (!projectUuid) {
    logSbError("[ArtifactsSidebar] Project resolved but missing uuid", new Error("Missing project uuid"), {
      projectId,
      resolvedKeys: Object.keys(project || {}),
      debug: resolved?.debug,
    });
    notFound();
  }

  const projectTitle = safeStr(project.title) || "Project";
  const projectCodeHuman = displayProjectCode((project as any).project_code);

  const { list, error: artErr } = await queryArtifacts(sb, projectUuid);
  if (artErr) logSbError("[ArtifactsSidebar] Artifacts query error", artErr, { projectUuid, projectId });

  return (
    <aside className="w-[320px] shrink-0 border-r border-gray-200 bg-white">
      <div className="p-4 border-b border-gray-200">
        <div className="text-xs text-gray-500">Project</div>
        <div className="mt-1 text-sm font-semibold text-gray-900">{projectTitle}</div>
        <div className="mt-1 text-xs text-gray-500 font-mono">{projectCodeHuman}</div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Link
            href={`/projects/${projectId}/artifacts`}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs hover:bg-gray-50"
          >
            Artifact Board
          </Link>

          <Link
            href={`/projects/${projectId}/artifacts/new`}
            className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs hover:bg-gray-50"
          >
            New Artifact
          </Link>
        </div>
      </div>

      <div className="p-3">
        <div className="text-xs font-semibold text-gray-600 px-2 pb-2">Items</div>

        {list.length ? (
          <nav className="space-y-1">
            {list.map((a: any) => {
              const id = String(a.id);
              const title = displayArtifactTitle(a);
              const type = safeStr((a as any).effective_type || a.artifact_type || a.type) || "—";
              const submitted = isSubmittedArtifact(a);

              return (
                <Link
                  key={id}
                  href={`/projects/${projectId}/artifacts/${id}`}
                  className="block rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 px-3 py-2"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">{title}</div>
                      <div className="mt-1 text-[11px] text-gray-500 font-mono truncate">{type}</div>
                    </div>

                    <StatusPill submitted={submitted} />
                  </div>
                </Link>
              );
            })}
          </nav>
        ) : (
          <div className="px-2 py-3 text-sm text-gray-500">No artifacts yet (or you don’t have access).</div>
        )}
      </div>
    </aside>
  );
}
