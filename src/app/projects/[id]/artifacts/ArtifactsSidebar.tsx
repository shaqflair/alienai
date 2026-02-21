// src/app/projects/[id]/artifacts/ArtifactsSidebar.tsx
import "server-only";

import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import {
  ArtifactsSidebarClient,
  type SidebarItem,
  type Role,
} from "./ArtifactsSidebarClient";

/**
 * ArtifactsSidebar (Server Component)
 * - Resolves project from route param (UUID or human code like P-00001 or "00001")
 * - Fetches artifacts list for sidebar navigation
 * - Resolves the user's role on the project
 * - Builds the SidebarItem[] shape the client component expects
 *
 * ✅ Change Requests legacy mapping:
 * - Any Change-like artifact types display as "Change Requests"
 * - And route to legacy: /projects/[id]/change
 */

/* ═══════════════════════════════════════════════════════════════
   ARTIFACT TYPE REGISTRY
   Defines every known artifact type, its display label, group,
   and create/edit permissions by role.
═══════════════════════════════════════════════════════════════ */

type ArtifactTypeDef = {
  key: string;        // canonical uppercase key e.g. "PROJECT_CHARTER"
  label: string;      // human-readable label
  ui_kind: string;    // same as key unless overridden
  ownerCanCreate: boolean;
  editorCanCreate: boolean;
  ownerCanEdit: boolean;
  editorCanEdit: boolean;
};

const ARTIFACT_TYPE_REGISTRY: ArtifactTypeDef[] = [
  // Plan group
  { key: "PROJECT_CHARTER",      label: "Project Charter",      ui_kind: "PROJECT_CHARTER",      ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "STAKEHOLDER_REGISTER", label: "Stakeholder Register", ui_kind: "STAKEHOLDER_REGISTER", ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "WBS",                  label: "WBS",                  ui_kind: "WBS",                  ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "SCHEDULE",             label: "Schedule",             ui_kind: "SCHEDULE",             ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "DESIGN",               label: "Design",               ui_kind: "DESIGN",               ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "REQUIREMENTS",         label: "Requirements",         ui_kind: "REQUIREMENTS",         ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "WEEKLY_REPORT",        label: "Weekly Report",        ui_kind: "WEEKLY_REPORT",        ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  // Control group
  { key: "RAID",                 label: "RAID Log",             ui_kind: "RAID",                 ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "CHANGE_REQUESTS",      label: "Change Requests",      ui_kind: "CHANGE_REQUESTS",      ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  // Close group
  { key: "LESSONS_LEARNED",      label: "Lessons Learned",      ui_kind: "LESSONS_LEARNED",      ownerCanCreate: true,  editorCanCreate: true,  ownerCanEdit: true,  editorCanEdit: true  },
  { key: "CLOSURE_REPORT",       label: "Closure Report",       ui_kind: "CLOSURE_REPORT",       ownerCanCreate: true,  editorCanCreate: false, ownerCanEdit: true,  editorCanEdit: false },
];

const REGISTRY_BY_KEY = new Map(ARTIFACT_TYPE_REGISTRY.map((d) => [d.key, d]));

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */

const PROJECT_COLS =
  "id,title,project_code,organisation_id,client_name,created_at";

const PROJECT_FALLBACK_SOURCES: Array<{
  table: string;
  select: string;
  filterById?: string;
  filterByCode?: string;
}> = [
  {
    table: "my_projects",
    select:
      "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "projects_members",
    select:
      "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "project_members",
    select:
      "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "project_users",
    select:
      "id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "id",
    filterByCode: "project_code",
  },
  {
    table: "project_memberships",
    select:
      "project_id,title,project_code,organisation_id,client_name,created_at,user_id,removed_at",
    filterById: "project_id",
    filterByCode: "project_code",
  },
];

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */

function safeStr(x: unknown): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}
function safeLower(x: unknown) {
  return safeStr(x).toLowerCase();
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim(),
  );
}

function normalizeProjectRef(projectParam: string) {
  const raw = safeStr(projectParam);
  if (!raw || raw === "undefined" || raw === "null") return "";
  return raw;
}

function extractDigits(raw: string): string | null {
  const s = safeStr(raw).toUpperCase();
  const m = s.match(/(\d{1,10})/);
  if (!m?.[1]) return null;
  const digits = m[1];
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

  const m = up.match(/^P-(\d{1,10})$/);
  if (m?.[1]) {
    out.add(m[1]);
    out.add(String(Number(m[1])));
  }

  return Array.from(out).filter(Boolean);
}

function displayProjectCode(project_code: unknown) {
  const s = safeStr(project_code);
  if (!s) return null;
  if (/^P-\d+$/i.test(s)) return s.toUpperCase();
  const digits = extractDigits(s);
  if (digits) return `P-${digits.padStart(5, "0")}`;
  return s;
}

/* ═══════════════════════════════════════════════════════════════
   CHANGE REQUESTS (legacy mapping)
═══════════════════════════════════════════════════════════════ */

function isChangeRequestsType(t: unknown) {
  const s = safeLower(t);
  return (
    s === "change_requests" ||
    s === "change_request" ||
    s === "change requests" ||
    s === "change request" ||
    s === "change_log" ||
    s === "change log" ||
    s === "kanban" ||
    s === "change_register" ||
    s === "change register" ||
    s === "change"
  );
}

function normalizeArtifactTypeKey(t: unknown): string {
  const s = safeStr(t).toUpperCase();
  if (!s) return "";
  if (isChangeRequestsType(t)) return "CHANGE_REQUESTS";
  return s;
}

function artifactHref(
  projectParam: string,
  artifactId: string,
  rawType: unknown,
) {
  if (isChangeRequestsType(rawType))
    return `/projects/${projectParam}/change`;
  return `/projects/${projectParam}/artifacts/${artifactId}`;
}

/* ═══════════════════════════════════════════════════════════════
   LOGGING
═══════════════════════════════════════════════════════════════ */

function shapeErr(err: unknown): Record<string, unknown> {
  if (!err) return {};
  if (typeof err === "string") return { message: err };
  const e = err as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof e?.message === "string") out.message = e.message;
  if (typeof e?.code === "string") out.code = e.code;
  if (typeof e?.details === "string") out.details = e.details;
  if (typeof e?.hint === "string") out.hint = e.hint;
  if (typeof e?.status === "number") out.status = e.status;
  return out;
}

function logSbError(tag: string, err: unknown, extra?: Record<string, unknown>) {
  console.error(tag, { ...shapeErr(err), ...(extra || {}) });
}

/* ═══════════════════════════════════════════════════════════════
   PROJECT RESOLUTION
═══════════════════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function selectFirst(
  sb: any,
  table: string,
  select: string,
  filterCol: string,
  filterVal: unknown,
) {
  const { data, error } = await sb
    .from(table)
    .select(select)
    .eq(filterCol, filterVal)
    .limit(1);
  const row = Array.isArray(data) && data.length ? data[0] : null;
  return { row, error, count: Array.isArray(data) ? data.length : 0 };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveProject(sb: any, projectParam: string) {
  const raw = normalizeProjectRef(projectParam);
  const debugBase = {
    projectParam,
    raw,
    looksUuid: looksLikeUuid(raw),
    codeVariants: projectCodeVariants(raw),
  };

  if (!raw) {
    return {
      data: null,
      error: new Error("Missing project id"),
      debug: debugBase,
    };
  }

  if (looksLikeUuid(raw)) {
    const r = await selectFirst(sb, "projects", PROJECT_COLS, "id", raw);
    if (r.error)
      return { data: null, error: r.error, debug: { ...debugBase, stage: "projects:id:error" } };
    if (r.row)
      return { data: r.row, error: null, debug: { ...debugBase, stage: "projects:id:ok" } };

    for (const src of PROJECT_FALLBACK_SOURCES) {
      if (!src.filterById) continue;
      const rr = await selectFirst(sb, src.table, src.select, src.filterById, raw);
      if (rr.error) continue;
      if (rr.row)
        return {
          data: rr.row,
          error: null,
          debug: { ...debugBase, stage: `${src.table}:${src.filterById}:ok` },
        };
    }

    return {
      data: null,
      error: new Error("Project not found (or no access via RLS)"),
      debug: { ...debugBase, stage: "not_found_uuid" },
    };
  }

  const variants = projectCodeVariants(raw);

  for (const v of variants) {
    const r = await selectFirst(sb, "projects", PROJECT_COLS, "project_code", v);
    if (r.error)
      return {
        data: null,
        error: r.error,
        debug: { ...debugBase, stage: "projects:code:error", v },
      };
    if (r.row)
      return { data: r.row, error: null, debug: { ...debugBase, stage: "projects:code:ok", v } };
  }

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
    data: null,
    error: new Error("Project not found (or no access via RLS)"),
    debug: { ...debugBase, stage: "not_found_code_text" },
  };
}

/* ═══════════════════════════════════════════════════════════════
   ROLE RESOLUTION
═══════════════════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveRole(sb: any, projectUuid: string, userId: string): Promise<Role> {
  // Try the most common membership tables; return the first match.
  const ROLE_SOURCES = [
    { table: "project_memberships", projectCol: "project_id", userCol: "user_id", roleCol: "role" },
    { table: "project_members",     projectCol: "id",         userCol: "user_id", roleCol: "role" },
    { table: "projects_members",    projectCol: "id",         userCol: "user_id", roleCol: "role" },
    { table: "project_users",       projectCol: "id",         userCol: "user_id", roleCol: "role" },
  ];

  for (const src of ROLE_SOURCES) {
    try {
      const { data, error } = await sb
        .from(src.table)
        .select(src.roleCol)
        .eq(src.projectCol, projectUuid)
        .eq(src.userCol, userId)
        .limit(1);

      if (error) continue; // table might not exist, try next
      if (Array.isArray(data) && data.length > 0) {
        const raw = safeLower(data[0]?.[src.roleCol]);
        if (raw === "owner" || raw === "editor" || raw === "viewer") return raw;
        // Treat admin / manager as owner-equivalent
        if (raw === "admin" || raw === "manager") return "owner";
        return "editor"; // default for any recognised membership
      }
    } catch {
      // table doesn't exist — continue
    }
  }

  // Fallback: check if user is the project creator
  try {
    const { data } = await sb
      .from("projects")
      .select("created_by")
      .eq("id", projectUuid)
      .limit(1);
    if (Array.isArray(data) && data[0]?.created_by === userId) return "owner";
  } catch {
    // column might not exist
  }

  return "unknown";
}

/* ═══════════════════════════════════════════════════════════════
   ARTIFACTS QUERY
═══════════════════════════════════════════════════════════════ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function queryArtifacts(sb: any, projectUuid: string) {
  const select =
    "id,title,type,artifact_type,is_current,created_at,approval_status,deleted_at,is_locked";

  const { data, error } = await sb
    .from("artifacts")
    .select(select)
    .eq("project_id", projectUuid)
    .is("deleted_at", null)
    .eq("is_current", true)
    .order("created_at", { ascending: true });

  const list = Array.isArray(data) ? data : [];
  return { list, error };
}

/* ═══════════════════════════════════════════════════════════════
   BUILD SidebarItem[] FROM REGISTRY + DB ARTIFACTS
═══════════════════════════════════════════════════════════════ */

function buildSidebarItems(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dbArtifacts: any[],
  role: Role,
  projectParam: string,
): SidebarItem[] {
  // Index DB artifacts by their canonical type key.
  // If multiple artifacts share a type, keep the first (is_current=true already filtered).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const byType = new Map<string, any>();
  for (const a of dbArtifacts) {
    const rawType = safeStr(a?.artifact_type || a?.type);
    const key = normalizeArtifactTypeKey(rawType);
    if (key && !byType.has(key)) byType.set(key, a);
  }

  const isOwner = role === "owner";
  const isEditor = role === "editor";

  return ARTIFACT_TYPE_REGISTRY.map((def) => {
    const artifact = byType.get(def.key) ?? null;

    const canCreate = isOwner
      ? def.ownerCanCreate
      : isEditor
        ? def.editorCanCreate
        : false;

    const canEdit = isOwner
      ? def.ownerCanEdit
      : isEditor
        ? def.editorCanEdit
        : false;

    const current = artifact
      ? {
          id: String(artifact.id),
          title: safeStr(artifact.title) || null,
          approval_status: safeStr(artifact.approval_status) || "draft",
          is_locked: Boolean(artifact.is_locked),
          deleted_at: safeStr(artifact.deleted_at) || null,
        }
      : null;

    const href = artifact
      ? artifactHref(projectParam, String(artifact.id), safeStr(artifact.artifact_type || artifact.type))
      : `/projects/${projectParam}/artifacts/new?type=${def.key.toLowerCase()}`;

    return {
      key: def.key,
      label: def.label,
      ui_kind: def.ui_kind,
      current,
      href,
      canCreate,
      canEdit,
    };
  });
}

/* ═══════════════════════════════════════════════════════════════
   EXPORTED SERVER COMPONENT
═══════════════════════════════════════════════════════════════ */

export default async function ArtifactsSidebar({
  projectId,
  currentArtifactId,
}: {
  projectId: string;
  currentArtifactId?: string;
}) {
  const sb = await createClient();

  // ── Auth ──
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth?.user) redirect("/login");

  const userId = auth.user.id;

  // ── Project ──
  const resolved = await resolveProject(sb, projectId);
  const project = resolved.data;

  if (resolved.error || !project) {
    logSbError(
      "[ArtifactsSidebar] Project resolve error",
      resolved.error || new Error("resolveProject returned no project"),
      resolved.debug as Record<string, unknown>,
    );
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectUuid = safeStr((project as any).id) || safeStr((project as any).project_id);
  if (!projectUuid) {
    logSbError("[ArtifactsSidebar] Project resolved but missing uuid", new Error("Missing uuid"), {
      projectId,
      resolvedKeys: Object.keys(project || {}),
    });
    notFound();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectTitle = safeStr((project as any).title) || "Project";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const projectCodeHuman = displayProjectCode((project as any).project_code);

  // ── Role ──
  const role = await resolveRole(sb, projectUuid, userId);

  // ── Artifacts ──
  const { list, error: artErr } = await queryArtifacts(sb, projectUuid);
  if (artErr) logSbError("[ArtifactsSidebar] Artifacts query error", artErr, { projectUuid });

  // ── Build the sidebar items ──
  const items = buildSidebarItems(list, role, projectId);

  return (
    <ArtifactsSidebarClient
      items={items}
      role={role}
      projectId={projectUuid}
      projectHumanId={projectId}
      projectName={projectTitle}
      projectCode={projectCodeHuman}
    />
  );
}