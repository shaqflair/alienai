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
 *
 * ✅ Resolves project from route param (UUID or human code like P-00001)
 * ✅ Fetches current artifacts and builds SidebarItem[] for the client
 * ✅ IMPORTANT: all hrefs are built using the resolved *UUID* to avoid 404s / server crashes
 *
 * ✅ CHANGE REQUESTS: always route to /projects/:uuid/change (board),
 *    never to an artifact living-document page.
 */

type ArtifactTypeDef = {
  key: string;
  dbType: string;
  label: string;
  group: "Plan" | "Control" | "Close";
  legacyRoute?: string;
};

const ARTIFACT_TYPE_REGISTRY: ArtifactTypeDef[] = [
  // Plan
  { key: "PROJECT_CHARTER", dbType: "project_charter", label: "Project Charter", group: "Plan" },
  { key: "STAKEHOLDER_REGISTER", dbType: "stakeholder_register", label: "Stakeholder Register", group: "Plan" },
  { key: "WBS", dbType: "wbs", label: "WBS", group: "Plan" },
  { key: "SCHEDULE", dbType: "schedule", label: "Schedule", group: "Plan" },
  { key: "WEEKLY_REPORT", dbType: "weekly_report", label: "Weekly Report", group: "Plan" },
  // Control
  { key: "RAID", dbType: "raid", label: "RAID Log", group: "Control", legacyRoute: "raid" },

  // ✅ IMPORTANT: Change Requests is a board route (change_requests table),
  // not a living-document artifact view.
  { key: "CHANGE", dbType: "change", label: "Change Requests", group: "Control" },
    // Close
  { key: "LESSONS_LEARNED", dbType: "lessons_learned", label: "Lessons Learned", group: "Close", legacyRoute: "lessons" },
  { key: "PROJECT_CLOSURE_REPORT", dbType: "project_closure_report", label: "Closure Report", group: "Close" },
];

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */

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

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
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

function displayProjectCode(project_code: any) {
  const s = safeStr(project_code);
  if (!s) return null;
  if (/^P-\d+$/i.test(s)) return s.toUpperCase();
  const digits = extractDigits(s);
  if (digits) return `P-${digits.padStart(5, "0")}`;
  return s;
}

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

/* ── project resolve ── */

async function selectFirst(sb: any, table: string, select: string, filterCol: string, filterVal: any) {
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

  if (!raw) return { data: null as any, error: new Error("Missing project id"), debug: debugBase };

  if (looksLikeUuid(raw)) {
    const r = await selectFirst(sb, "projects", PROJECT_COLS, "id", raw);
    if (r.error) return { data: null as any, error: r.error, debug: { ...debugBase, stage: "projects:id:error" } };
    if (r.row) return { data: r.row, error: null, debug: { ...debugBase, stage: "projects:id:ok" } };

    for (const src of PROJECT_FALLBACK_SOURCES) {
      if (!src.filterById) continue;
      const rr = await selectFirst(sb, src.table, src.select, src.filterById, raw);
      if (rr.error) continue;
      if (rr.row) return { data: rr.row, error: null, debug: { ...debugBase, stage: `${src.table}:${src.filterById}:ok` } };
    }

    return {
      data: null as any,
      error: new Error("Project not found (or no access via RLS)"),
      debug: { ...debugBase, stage: "not_found_uuid" },
    };
  }

  const variants = projectCodeVariants(raw);

  for (const v of variants) {
    const r = await selectFirst(sb, "projects", PROJECT_COLS, "project_code", v);
    if (r.error) return { data: null as any, error: r.error, debug: { ...debugBase, stage: "projects:code:error", v } };
    if (r.row) return { data: r.row, error: null, debug: { ...debugBase, stage: "projects:code:ok", v } };
  }

  for (const src of PROJECT_FALLBACK_SOURCES) {
    if (!src.filterByCode) continue;
    for (const v of variants) {
      const rr = await selectFirst(sb, src.table, src.select, src.filterByCode, v);
      if (rr.error) continue;
      if (rr.row) return { data: rr.row, error: null, debug: { ...debugBase, stage: `${src.table}:${src.filterByCode}:ok`, v } };
    }
  }

  return {
    data: null as any,
    error: new Error("Project not found (or no access via RLS)"),
    debug: { ...debugBase, stage: "not_found_code_text" },
  };
}

/* ── role resolve ── */

async function resolveRoleBestEffort(sb: any, projectUuid: string, userId: string): Promise<Role> {
  // Default to viewer if anything fails (never break sidebar render)
  let role: Role = "viewer";

  try {
    const { data, error } = await sb
      .from("project_members")
      .select("role,is_active")
      .eq("project_id", projectUuid)
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();

    if (!error && data) {
      const r = safeStr((data as any).role).toLowerCase();
      if (r === "owner" || r === "editor" || r === "viewer") role = r as Role;
    }
  } catch {
    // ignore
  }

  return role;
}

/* ── artifacts query ── */

async function queryArtifacts(sb: any, projectUuid: string) {
  const select = "id,title,type,artifact_type,is_current,created_at,approval_status,deleted_at,is_locked";
  const { data, error } = await sb
    .from("artifacts")
    .select(select)
    .eq("project_id", projectUuid)
    .is("deleted_at", null)
    .eq("is_current", true)
    .order("created_at", { ascending: true });

  return { list: Array.isArray(data) ? data : [], error };
}

/* ── build SidebarItem[] ── */
/**
 * IMPORTANT: use projectUuid for all href routes.
 * Many pages still assume /projects/[id] is a UUID.
 */
function buildSidebarItems(dbArtifacts: any[], projectUuid: string): SidebarItem[] {
  const byDbType = new Map<string, any>();

  for (const a of dbArtifacts) {
    const t = safeStr(a?.artifact_type || a?.type).toLowerCase();
    if (!t) continue;

    // ✅ Ignore legacy "change" artifacts so we don't treat them as living-docs in the UI.
    // Change Requests must always route to the board/workspace.
    if (t === "change" || t === "change_request" || t === "change_requests") continue;

    if (!byDbType.has(t)) byDbType.set(t, a);
  }

  return ARTIFACT_TYPE_REGISTRY.map((def) => {
    const dbTypeLower = safeStr(def.dbType).toLowerCase();

    // ✅ Change Requests: ALWAYS route to change workspace, never an artifact doc
    if (dbTypeLower === "change") {
      return {
        key: def.key,
        label: def.label,
        ui_kind: def.key,
        current: null,
        href: `/change?projectId=${projectUuid}`,
        canCreate: false,
        canEdit: true,
      };
    }

    // ✅ Other legacy board routes (RAID, Lessons legacy etc)
    if (def.legacyRoute) {
      return {
        key: def.key,
        label: def.label,
        ui_kind: def.key,
        current: null,
        href: `/projects/${projectUuid}/${def.legacyRoute}`,
        canCreate: false,
        canEdit: true,
      };
    }

    const artifact = byDbType.get(dbTypeLower) ?? null;

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
      ? `/projects/${projectUuid}/artifacts/${artifact.id}`
      : `/projects/${projectUuid}/artifacts/new?type=${def.dbType}`;

    return {
      key: def.key,
      label: def.label,
      ui_kind: def.key,
      current,
      href,
      canCreate: true,
      canEdit: true,
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
  if (!projectUuid || !looksLikeUuid(projectUuid)) {
    logSbError(
      "[ArtifactsSidebar] Project resolved but missing/invalid uuid",
      new Error("Missing/invalid uuid"),
      { projectId, projectUuid, resolvedKeys: Object.keys(project || {}), debug: resolved?.debug }
    );
    notFound();
  }

  const projectTitle = safeStr(project.title) || "Project";
  const projectCodeHuman = displayProjectCode((project as any).project_code);

  const { list, error: artErr } = await queryArtifacts(sb, projectUuid);
  if (artErr) logSbError("[ArtifactsSidebar] Artifacts query error", artErr, { projectUuid, projectId });

  // ✅ Build hrefs with UUID so every page works consistently
  const items = buildSidebarItems(list, projectUuid);

  // ✅ Real role (best effort), not hardcoded
  const role: Role = await resolveRoleBestEffort(sb, projectUuid, auth.user.id);

  return (
    <ArtifactsSidebarClient
      items={items}
      role={role}
      projectId={projectUuid}         // UUID (routing key)
      projectHumanId={projectId}      // whatever was in the URL (display/debug)
      projectName={projectTitle}
      projectCode={projectCodeHuman}
    />
  );
}