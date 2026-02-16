// src/lib/exports/wbs/fetch.ts
import "server-only";

import type { WbsItemRow } from "./types";
import { calculateProjectCode, safeLower, safeStr } from "./utils";

export class ExportError extends Error {
  constructor(public code: string, message: string, public statusCode: number = 400) {
    super(message);
    this.name = "ExportError";
  }
}

/**
 * Resolve projectId from artifactId (fixes "Project not found" when UI doesn't send projectId)
 */
export async function resolveProjectIdFromArtifact(supabase: any, artifactId: string): Promise<string> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("project_id")
    .eq("id", artifactId)
    .maybeSingle();

  if (error) throw new ExportError("DB_ERROR", error.message, 500);
  if (!data?.project_id) throw new ExportError("NOT_FOUND", "Artifact not found", 404);
  return String(data.project_id);
}

export async function verifyProjectAccess(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) throw new ExportError("UNAUTHORIZED", "Authentication required", 401);

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new ExportError("DB_ERROR", memErr.message, 500);
  if (!mem?.is_active) throw new ExportError("FORBIDDEN", "Access denied", 403);

  return { userId: auth.user.id, role: safeStr(mem.role) };
}

export async function fetchProjectData(supabase: any, projectId: string) {
  const { data: project, error } = await supabase
    .from("projects")
    .select("id, title, project_code, client_name, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new ExportError("DB_ERROR", error.message, 500);
  if (!project) throw new ExportError("NOT_FOUND", "Project not found", 404);

  let orgName = "";
  if (project.organisation_id) {
    const { data: org, error: orgErr } = await supabase
      .from("organisations")
      .select("name")
      .eq("id", project.organisation_id)
      .maybeSingle();
    if (!orgErr && org?.name) orgName = safeStr(org.name);
  }

  return {
    id: project.id,
    title: safeStr(project.title),
    code: calculateProjectCode(project.project_code),
    rawCode: project.project_code,
    client: safeStr(project.client_name),
    orgName,
    description: "",
  };
}

export async function fetchArtifactData(supabase: any, projectId: string, artifactId: string) {
  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select("id, project_id, title, type, artifact_type, created_at, updated_at")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw new ExportError("DB_ERROR", error.message, 500);
  if (!artifact) throw new ExportError("NOT_FOUND", "Artifact not found", 404);

  return {
    id: artifact.id,
    project_id: artifact.project_id,
    title: artifact.title,
    type: artifact.type,
    artifact_type: artifact.artifact_type,
    created_at: artifact.created_at,
    updated_at: artifact.updated_at,
  };
}

/* =========================
   Legacy payload helpers
========================= */

function coerceArtifactPayload(contentJson: any, contentText: any) {
  if (contentJson && typeof contentJson === "object") return contentJson;

  const s = typeof contentText === "string" ? contentText.trim() : "";
  if (!s) return {};

  try {
    const parsed = JSON.parse(s);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function extractLegacyRows(payload: any): any[] {
  const cj = payload && typeof payload === "object" ? payload : {};
  if (Array.isArray((cj as any).rows)) return (cj as any).rows;
  if (Array.isArray((cj as any).items)) return (cj as any).items;
  if (Array.isArray((cj as any).nodes)) return (cj as any).nodes;

  const content = (cj as any).content;
  if (content && typeof content === "object") {
    if (Array.isArray(content.rows)) return content.rows;
    if (Array.isArray(content.items)) return content.items;
    if (Array.isArray(content.nodes)) return content.nodes;
  }

  return [];
}

function normalizeTags(raw: unknown): any[] {
  if (raw == null) return [];
  if (Array.isArray(raw)) return raw.map((t) => safeStr(t)).filter(Boolean);

  const s = safeStr(raw).trim();
  if (!s) return [];
  return s
    .split(",")
    .map((x) => safeStr(x).trim())
    .filter(Boolean);
}

/**
 * IMPORTANT: Map legacy rows WITHOUT dropping `level`.
 * Your artifact content_json.rows includes `level` and that's what the UI is reflecting.
 */
function mapLegacyRow(r: any, idx: number, projectId: string, artifactId: string): WbsItemRow {
  const id = String(r?.id || r?.key || `legacy_${idx}`);

  const name =
    safeStr(r?.deliverable) ||
    safeStr(r?.name) ||
    safeStr(r?.title) ||
    safeStr(r?.summary) ||
    "Untitled";

  const statusRaw = safeLower(r?.status || r?.delivery_status || r?.state || "");
  const status =
    statusRaw === "done" || statusRaw === "complete" || statusRaw === "completed"
      ? "done"
      : statusRaw === "in_progress" || statusRaw === "inprogress" || statusRaw === "progress"
      ? "inprogress"
      : statusRaw === "blocked"
      ? "blocked"
      : "todo";

  return {
    id,
    project_id: projectId,
    parent_id: r?.parent_id ? String(r.parent_id) : r?.parentId ? String(r.parentId) : null,

    // preserve legacy level (critical)
    level: Number.isFinite(Number(r?.level)) ? Number(r.level) : null,

    name,
    description: r?.description ? safeStr(r.description) : null,
    estimated_effort:
      typeof r?.estimated_effort === "number"
        ? r.estimated_effort
        : typeof r?.effort_hours === "number"
        ? r.effort_hours
        : typeof r?.effort === "number"
        ? r.effort
        : null,

    // preserve S/M/L effort if provided
    effort: safeStr(r?.effort || "").trim() || null,

    status,
    sort_order: Number.isFinite(Number(r?.sort_order)) ? Number(r.sort_order) : idx,
    source_artifact_id: artifactId,
    due_date: safeStr(r?.due_date || r?.dueDate || r?.end_date || r?.end || "") || null,

    owner: safeStr(r?.owner || r?.owner_label || r?.assignee || r?.assignee_label || "") || null,
    predecessor: safeStr(r?.predecessor || r?.predecessors || r?.depends_on || "") || null,
    tags: normalizeTags(r?.tags ?? r?.labels ?? r?.tag_list),
    acceptance_criteria:
      safeStr(r?.acceptance_criteria || r?.acceptanceCriteria || r?.acceptance || r?.definition_of_done || "") ||
      null,

    source_row_id: safeStr(r?.source_row_id || "") || null,
  } as any;
}

/* =========================
   Main fetch
========================= */

export async function fetchWbsItems(supabase: any, projectId: string, artifactId: string) {
  // Load artifact + payload
  const { data: art, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, root_artifact_id, content_json, content")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (artErr) throw new ExportError("DB_ERROR", artErr.message, 500);
  if (!art) throw new ExportError("NOT_FOUND", "Artifact not found", 404);

  // 0) FIRST: if artifact has content_json.rows, use it (this is where your `level` is)
  const payload = coerceArtifactPayload(art.content_json, art.content);
  const legacyRows = extractLegacyRows(payload);

  if (Array.isArray(legacyRows) && legacyRows.length > 0) {
    const legacy = legacyRows
      .map((r: any, idx: number) => mapLegacyRow(r, idx, projectId, artifactId))
      .filter((x: any) => safeStr(x?.name).trim().length > 0);

    if (legacy.length) return legacy as any as WbsItemRow[];
  }

  const rootId = art.root_artifact_id ? String(art.root_artifact_id) : null;
  const idsToTry = [artifactId, rootId].filter(Boolean) as string[];

  // 1) Prefer wbs_items linked to this artifact OR its root artifact
  if (idsToTry.length) {
    const { data: linked, error: linkedErr } = await supabase
      .from("wbs_items")
      .select("*")
      .eq("project_id", projectId)
      .in("source_artifact_id", idsToTry)
      .order("sort_order", { ascending: true });

    if (linkedErr) throw new ExportError("DB_ERROR", linkedErr.message, 500);
    if (Array.isArray(linked) && linked.length > 0) return linked as any as WbsItemRow[];
  }

  // 2) Fallback: any wbs_items in the project
  const { data: all, error: allErr } = await supabase
    .from("wbs_items")
    .select("*")
    .eq("project_id", projectId)
    .order("sort_order", { ascending: true });

  if (allErr) throw new ExportError("DB_ERROR", allErr.message, 500);
  if (Array.isArray(all) && all.length > 0) return all as any as WbsItemRow[];

  return [];
}
