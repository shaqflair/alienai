// src/app/projects/[id]/artifacts/actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { ARTIFACT_TYPES, type ArtifactType } from "@/lib/artifact-types";

/* =========================
   Helpers
========================= */

function isArtifactType(x: string): x is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(x);
}

function normStr(x: any) {
  return String(x ?? "").trim();
}

function safeLower(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function throwDb(error: any, label: string): never {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  const hint = error?.hint ?? "";
  const details = error?.details ?? "";
  throw new Error(
    `[${label}] ${code} ${msg}${hint ? ` | hint: ${hint}` : ""}${details ? ` | details: ${details}` : ""}`
  );
}

async function requireUser() {
  const supabase = await createClient();
  const { data: auth, error } = await supabase.auth.getUser();
  if (error) throwDb(error, "auth.getUser");
  if (!auth?.user) redirect("/login");
  return { supabase, user: auth.user };
}

/**
 * ✅ Org-based access control (matches your NewArtifactPage gating):
 * projects.organisation_id + organisation_members
 */
async function requireOrgRoleForProject(
  supabase: any,
  projectId: string,
  allowed: Array<"admin" | "member" | "owner" | "editor" | "viewer">
) {
  // 1) load project org
  const { data: proj, error: pErr } = await supabase
    .from("projects")
    .select("id, organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (pErr) throwDb(pErr, "projects.loadForRole");
  if (!proj?.id) throw new Error("Project not found");
  const orgId = String(proj.organisation_id ?? "").trim();
  if (!orgId) throw new Error("Project missing organisation_id");

  // 2) membership in org
  const { data: auth } = await supabase.auth.getUser();
  const uid = auth?.user?.id;
  if (!uid) redirect("/login");

  const { data: mem, error: mErr } = await supabase
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", uid)
    .is("removed_at", null)
    .maybeSingle();

  if (mErr) throwDb(mErr, "organisation_members.require");
  if (!mem) throw new Error(`Access denied. Not a member of this organisation.`);

  const role = safeLower(mem.role || "member") as any;

  // Map org roles -> effective permissions.
  const effective =
    role === "admin" ? "owner" : role === "member" ? "editor" : (role as "owner" | "editor" | "viewer");

  if (!allowed.includes(effective as any) && !allowed.includes(role as any)) {
    throw new Error(`Access denied. Required: ${allowed.join(" or ")}.`);
  }

  return effective as "owner" | "editor" | "viewer";
}

async function loadArtifact(supabase: any, artifactId: string) {
  const { data, error } = await supabase
    .from("artifacts")
    .select(
      "id,project_id,type,title,content,content_json,version,approval_status,is_locked,created_at,updated_at,parent_artifact_id,root_artifact_id,is_current,is_baseline,revision_reason,revision_type,deleted_at"
    )
    .eq("id", artifactId)
    .single();

  if (error) throwDb(error, "artifacts.loadArtifact");
  if (!data) throw new Error("Artifact not found");
  return data as any;
}

/**
 * Best-effort audit (won't break app if table/policies differ).
 */
async function auditBestEffort(
  supabase: any,
  input: {
    project_id: string;
    artifact_id: string | null;
    actor_user_id: string;
    actor_email?: string | null;
    action: string;
    from_status?: string | null;
    to_status?: string | null;
    from_is_current?: boolean | null;
    to_is_current?: boolean | null;
    meta?: any;
  }
) {
  try {
    const { error } = await supabase.from("artifact_audit").insert({
      project_id: input.project_id,
      artifact_id: input.artifact_id,
      actor_user_id: input.actor_user_id,
      actor_email: input.actor_email ?? null,
      action: input.action,
      from_status: input.from_status ?? null,
      to_status: input.to_status ?? null,
      from_is_current: input.from_is_current ?? null,
      to_is_current: input.to_is_current ?? null,
      meta: input.meta ?? {},
    });
    void error;
  } catch {
    // ignore
  }
}

/**
 * DB constraint: one_current_per_project_type
 */
async function demoteCurrentForProjectType(supabase: any, projectId: string, type: string) {
  const { error } = await supabase
    .from("artifacts")
    .update({ is_current: false })
    .eq("project_id", projectId)
    .eq("type", type)
    .eq("is_current", true);

  if (error) throwDb(error, "artifacts.demoteCurrentForProjectType");
}

async function nextVersionForRoot(supabase: any, rootId: string, fallback = 1): Promise<number> {
  const { data, error } = await supabase
    .from("artifacts")
    .select("version")
    .eq("root_artifact_id", rootId)
    .order("version", { ascending: false })
    .limit(1);

  if (error) throwDb(error, "artifacts.nextVersionForRoot");

  const maxV = Number((data ?? [])[0]?.version ?? fallback);
  return (Number.isFinite(maxV) ? maxV : fallback) + 1;
}

function isWeeklyReportTypeServer(type: string) {
  return safeLower(type) === "weekly_report";
}

function isoDate(d: Date) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function defaultWeeklyReportModel() {
  const to = new Date();
  const from = new Date(to.getTime() - 6 * 24 * 60 * 60 * 1000);
  return {
    version: 1,
    period: { from: isoDate(from), to: isoDate(to) },
    summary: {
      rag: "green",
      headline: "Weekly delivery update",
      narrative: "Summary of progress, risks, and next steps.",
    },
    delivered: [],
    milestones: [],
    changes: [],
    raid: [],
    planNextWeek: [],
    resourceSummary: [],
    keyDecisions: [],
    blockers: [],
    metrics: {},
    meta: { generated_at: new Date().toISOString() },
  };
}

function canEditArtifactRow(a: any) {
  const type = safeLower(a?.type);
  const isWeekly = type === "weekly_report";

  if (Boolean(a?.deleted_at)) return { ok: false, reason: "Artifact is deleted." };
  if (Boolean(a?.is_locked)) return { ok: false, reason: "Artifact is locked." };

  // ✅ Treat NULL as "current" (only explicit false blocks)
  const isCurrent = a?.is_current !== false;
  if (!isCurrent) return { ok: false, reason: "Only current version can be edited." };

  // ✅ Weekly Report is a living doc (ignore approval status gating)
  if (isWeekly) return { ok: true as const, status: "living" as const };

  const st = String(a?.approval_status ?? "draft").toLowerCase();
  if (!(st === "draft" || st === "changes_requested"))
    return { ok: false, reason: "Only Draft / Changes Requested can be edited." };

  return { ok: true as const, status: st };
}

/* =========================
   CREATE
========================= */

export async function createArtifact(formData: FormData) {
  const projectId = normStr(formData.get("project_id"));
  const rawType = normStr(formData.get("type")).toUpperCase();
  const title = normStr(formData.get("title")) || "";
  const content = String(formData.get("content") ?? "");

  if (!projectId) throw new Error("Missing project_id");
  if (!rawType) throw new Error("Missing type");
  if (!isArtifactType(rawType)) throw new Error("Invalid artifact type");

  const { supabase, user } = await requireUser();
  await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

  const now = new Date().toISOString();
  const isWeekly = isWeeklyReportTypeServer(rawType);

  // Is there already a current artifact for this project + type?
  const { data: existing, error: exErr } = await supabase
    .from("artifacts")
    .select("id,content,version,root_artifact_id,approval_status,content_json,title")
    .eq("project_id", projectId)
    .eq("type", rawType)
    .eq("is_current", true)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (exErr) throwDb(exErr, "artifacts.create.checkExistingCurrent");

  // If exists -> create v+1 under same root
  if (existing?.id) {
    const rootId = String(existing.root_artifact_id ?? existing.id);
    const nextV = await nextVersionForRoot(supabase, rootId, Number(existing.version ?? 1));

    await demoteCurrentForProjectType(supabase, projectId, rawType);

    const seededWeeklyJson =
      existing.content_json && typeof existing.content_json === "object"
        ? existing.content_json
        : defaultWeeklyReportModel();

    const { data: inserted, error: insErr } = await supabase
      .from("artifacts")
      .insert({
        project_id: projectId,
        user_id: user.id,
        type: rawType,
        title: title || existing.title || rawType,

        // ✅ Weekly Report lives in content_json (keep content empty by default)
        content: isWeekly ? "" : content || (existing.content ?? ""),
        content_json: isWeekly ? seededWeeklyJson : (existing.content_json ?? null),

        approval_status: "draft",
        is_locked: false,
        version: nextV,
        is_current: true,
        is_baseline: false,
        root_artifact_id: rootId,
        parent_artifact_id: existing.id,
        revision_type: "revise",
        revision_reason: "New draft created",
        updated_at: now,
      })
      .select("id")
      .single();

    if (insErr) throwDb(insErr, "artifacts.create.insertRevision");

    await auditBestEffort(supabase, {
      project_id: projectId,
      artifact_id: inserted.id,
      actor_user_id: user.id,
      actor_email: user.email,
      action: "create_revision_from_current",
      from_status: String(existing.approval_status ?? "draft"),
      to_status: "draft",
      from_is_current: true,
      to_is_current: true,
      meta: {
        type: rawType,
        from_artifact_id: existing.id,
        to_artifact_id: inserted.id,
        version: nextV,
        seeded_weekly_json: isWeekly ? true : false,
      },
    });

    revalidatePath(`/projects/${projectId}/artifacts`);
    return inserted.id as string;
  }

  // Brand new root v1
  await demoteCurrentForProjectType(supabase, projectId, rawType);

  const weeklyJson = isWeekly ? defaultWeeklyReportModel() : null;

  const { data: inserted, error } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      user_id: user.id,
      type: rawType,
      title: title || rawType,

      // ✅ Weekly Report lives in content_json
      content: isWeekly ? "" : content,
      content_json: weeklyJson,

      approval_status: "draft",
      is_locked: false,
      version: 1,
      is_current: true,
      is_baseline: false,
      root_artifact_id: null,
      parent_artifact_id: null,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) throwDb(error, "artifacts.create.insert");

  // backfill root
  const { error: upErr } = await supabase.from("artifacts").update({ root_artifact_id: inserted.id }).eq("id", inserted.id);
  if (upErr) throwDb(upErr, "artifacts.create.backfill_root");

  await auditBestEffort(supabase, {
    project_id: projectId,
    artifact_id: inserted.id,
    actor_user_id: user.id,
    actor_email: user.email,
    action: "create_artifact",
    from_status: null,
    to_status: "draft",
    from_is_current: null,
    to_is_current: true,
    meta: { type: rawType, version: 1, seeded_weekly_json: isWeekly ? true : false },
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  return inserted.id as string;
}

/* =========================
   UPDATE (fallback text editor)
========================= */

export async function updateArtifact(formData: FormData) {
  const artifactId = normStr(formData.get("artifact_id"));
  const projectId = normStr(formData.get("project_id"));
  const title = normStr(formData.get("title"));
  const content = String(formData.get("content") ?? "");

  if (!artifactId) throw new Error("Missing artifact_id");
  if (!projectId) throw new Error("Missing project_id");

  const { supabase, user } = await requireUser();
  await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

  const a = await loadArtifact(supabase, artifactId);
  if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const edit = canEditArtifactRow(a);
  if (!edit.ok) throw new Error(edit.reason);

  const { error } = await supabase
    .from("artifacts")
    .update({ title: title || a.title || null, content, updated_at: new Date().toISOString() })
    .eq("id", artifactId);

  if (error) throwDb(error, "artifacts.update");

  await auditBestEffort(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_user_id: user.id,
    actor_email: user.email,
    action: "update_content",
    from_status: edit.status as any,
    to_status: edit.status as any,
    from_is_current: a?.is_current !== false,
    to_is_current: a?.is_current !== false,
    meta: { before_len: String(a.content ?? "").length, after_len: content.length },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   UPDATE JSON (Weekly / Charter etc.)
========================= */

export async function updateArtifactJson(formData: FormData) {
  const projectId = normStr(formData.get("project_id"));
  const artifactId = normStr(formData.get("artifact_id"));
  const jsonStr = normStr(formData.get("content_json"));

  if (!projectId) throw new Error("Missing project_id");
  if (!artifactId) throw new Error("Missing artifact_id");
  if (!jsonStr) throw new Error("Missing content_json");

  const { supabase, user } = await requireUser();
  await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

  const a = await loadArtifact(supabase, artifactId);
  if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const edit = canEditArtifactRow(a);
  if (!edit.ok) throw new Error(edit.reason);

  let parsed: any;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error("content_json must be valid JSON.");
  }

  const { error } = await supabase
    .from("artifacts")
    .update({
      content_json: parsed,
      updated_at: new Date().toISOString(),
    })
    .eq("id", artifactId);

  if (error) throwDb(error, "artifacts.updateArtifactJson");

  await auditBestEffort(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_user_id: user.id,
    actor_email: user.email,
    action: "update_content_json",
    from_status: edit.status as any,
    to_status: edit.status as any,
    from_is_current: a?.is_current !== false,
    to_is_current: a?.is_current !== false,
    meta: { json_bytes: jsonStr.length },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   REVISE / RESTORE / CURRENT
========================= */

export async function reviseArtifact(formData: FormData) {
  const artifactId = normStr(formData.get("artifact_id"));
  const revision_reason = normStr(formData.get("revision_reason")) || "Revision created";
  const revision_type = normStr(formData.get("revision_type")) || "material";

  if (!artifactId) throw new Error("Missing artifact_id");

  const { supabase, user } = await requireUser();

  const src = await loadArtifact(supabase, artifactId);
  const projectId = String(src.project_id ?? "");
  await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

  const rootId = String(src.root_artifact_id ?? src.id);
  const nextV = await nextVersionForRoot(supabase, rootId, Number(src.version ?? 1));

  await demoteCurrentForProjectType(supabase, projectId, String(src.type ?? ""));

  const isWeekly = isWeeklyReportTypeServer(String(src.type ?? ""));
  const seededWeeklyJson =
    src.content_json && typeof src.content_json === "object" ? src.content_json : defaultWeeklyReportModel();

  const { data: inserted, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      user_id: user.id,
      type: src.type,
      title: src.title ?? src.type,

      // ✅ Weekly Report lives in content_json
      content: isWeekly ? "" : (src.content ?? ""),
      content_json: isWeekly ? seededWeeklyJson : (src.content_json ?? null),

      approval_status: "draft",
      is_locked: false,
      root_artifact_id: rootId,
      parent_artifact_id: src.id,
      version: nextV,
      is_current: true,
      is_baseline: false,
      revision_reason,
      revision_type,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr) throwDb(insErr, "artifacts.revise.insert");

  await auditBestEffort(supabase, {
    project_id: projectId,
    artifact_id: inserted.id,
    actor_user_id: user.id,
    actor_email: user.email,
    action: "create_revision",
    from_status: String(src.approval_status ?? "draft"),
    to_status: "draft",
    from_is_current: src?.is_current !== false,
    to_is_current: true,
    meta: { from: src.id, to: inserted.id, version: nextV, revision_type, revision_reason, seeded_weekly_json: isWeekly },
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  return inserted.id as string;
}

export async function restoreArtifactVersion(formData: FormData) {
  const projectId = normStr(formData.get("project_id"));
  const targetId = normStr(formData.get("target_artifact_id"));
  const reason = normStr(formData.get("reason")) || "Restored a previous version";

  if (!projectId) throw new Error("Missing project_id");
  if (!targetId) throw new Error("Missing target_artifact_id");

  const { supabase, user } = await requireUser();
  await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

  const target = await loadArtifact(supabase, targetId);
  if (String(target.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const type = String(target.type ?? "");
  const rootId = String(target.root_artifact_id ?? target.id);
  const nextV = await nextVersionForRoot(supabase, rootId, Number(target.version ?? 1));

  await demoteCurrentForProjectType(supabase, projectId, type);

  const isWeekly = isWeeklyReportTypeServer(type);
  const seededWeeklyJson =
    target.content_json && typeof target.content_json === "object" ? target.content_json : defaultWeeklyReportModel();

  const { data: inserted, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id: projectId,
      user_id: user.id,
      type,
      title: target.title ?? type,

      // ✅ Weekly Report lives in content_json
      content: isWeekly ? "" : (target.content ?? ""),
      content_json: isWeekly ? seededWeeklyJson : (target.content_json ?? null),

      approval_status: "draft",
      is_locked: false,
      version: nextV,
      is_current: true,
      is_baseline: false,
      root_artifact_id: rootId,
      parent_artifact_id: target.id,
      revision_type: "restore",
      revision_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr) throwDb(insErr, "artifacts.restore.insert");

  await auditBestEffort(supabase, {
    project_id: projectId,
    artifact_id: inserted.id,
    actor_user_id: user.id,
    actor_email: user.email,
    action: "restore_version",
    from_status: String(target.approval_status ?? "draft"),
    to_status: "draft",
    from_is_current: target?.is_current !== false,
    to_is_current: true,
    meta: { restored_from: target.id, to: inserted.id, version: nextV, reason, seeded_weekly_json: isWeekly },
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  return inserted.id as string;
}

export async function setArtifactCurrent(args: { projectId: string; artifactId: string }) {
  const projectId = normStr(args?.projectId);
  const artifactId = normStr(args?.artifactId);
  if (!projectId) throw new Error("Missing projectId");
  if (!artifactId) throw new Error("Missing artifactId");

  const { supabase, user } = await requireUser();
  await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

  const a = await loadArtifact(supabase, artifactId);
  if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const type = String(a.type ?? "");
  if (!type) throw new Error("Artifact missing type");

  await demoteCurrentForProjectType(supabase, projectId, type);

  const { error } = await supabase
    .from("artifacts")
    .update({ is_current: true, updated_at: new Date().toISOString() })
    .eq("id", artifactId);

  if (error) throwDb(error, "artifacts.setArtifactCurrent");

  await auditBestEffort(supabase, {
    project_id: projectId,
    artifact_id: artifactId,
    actor_user_id: user.id,
    actor_email: user.email,
    action: "set_current",
    from_status: String(a.approval_status ?? "draft"),
    to_status: String(a.approval_status ?? "draft"),
    from_is_current: a?.is_current !== false,
    to_is_current: true,
    meta: { type },
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);

  // ✅ match client expectation
  return { ok: true };
}

/* =========================
   COMPAT WRAPPERS
========================= */

export async function createArtifactRevision(args: {
  projectId: string;
  artifactId: string;
  revisionReason?: string;
  revisionType?: string;
}) {
  const fd = new FormData();
  fd.set("artifact_id", normStr(args?.artifactId));
  fd.set("revision_reason", normStr(args?.revisionReason) || "Revision created");
  fd.set("revision_type", normStr(args?.revisionType) || "material");

  const newArtifactId = await reviseArtifact(fd);
  return { newArtifactId };
}

export async function updateArtifactJsonArgs(args: {
  projectId: string;
  artifactId: string;
  contentJson: any;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const fd = new FormData();
    fd.set("project_id", normStr(args?.projectId));
    fd.set("artifact_id", normStr(args?.artifactId));
    fd.set("content_json", JSON.stringify(args?.contentJson ?? {}));

    await updateArtifactJson(fd);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Save failed" };
  }
}

/* =========================
   BOARD ACTIONS (used by ArtifactBoardClient)
========================= */

export async function cloneArtifact(
  formData: FormData
): Promise<{ ok: boolean; newArtifactId?: string; error?: string }> {
  try {
    const projectId = normStr(formData.get("projectId"));
    const artifactId = normStr(formData.get("artifactId"));
    if (!projectId) throw new Error("Missing projectId");
    if (!artifactId) throw new Error("Missing artifactId");

    const { supabase, user } = await requireUser();
    await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

    const src = await loadArtifact(supabase, artifactId);
    if (String(src.project_id ?? "") !== projectId) throw new Error("Project mismatch");

    // Clone becomes a NEW revision under same root (and becomes current)
    const rootId = String(src.root_artifact_id ?? src.id);
    const nextV = await nextVersionForRoot(supabase, rootId, Number(src.version ?? 1));

    await demoteCurrentForProjectType(supabase, projectId, String(src.type ?? ""));

    const isWeekly = isWeeklyReportTypeServer(String(src.type ?? ""));
    const seededWeeklyJson =
      src.content_json && typeof src.content_json === "object" ? src.content_json : defaultWeeklyReportModel();

    const { data: inserted, error } = await supabase
      .from("artifacts")
      .insert({
        project_id: projectId,
        user_id: user.id,
        type: src.type,
        title: src.title ?? src.type,

        // ✅ Weekly Report lives in content_json
        content: isWeekly ? "" : (src.content ?? ""),
        content_json: isWeekly ? seededWeeklyJson : (src.content_json ?? null),

        approval_status: "draft",
        is_locked: false,
        root_artifact_id: rootId,
        parent_artifact_id: src.id,
        version: nextV,
        is_current: true,
        is_baseline: false,
        revision_type: "clone",
        revision_reason: "Cloned from previous version",
        updated_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (error) throwDb(error, "artifacts.clone.insert");

    revalidatePath(`/projects/${projectId}/artifacts`);
    return { ok: true, newArtifactId: inserted.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Clone failed" };
  }
}

export async function deleteDraftArtifact(
  formData: FormData
): Promise<{ ok: boolean; error?: string }> {
  try {
    const projectId = normStr(formData.get("projectId"));
    const artifactId = normStr(formData.get("artifactId"));
    if (!projectId) throw new Error("Missing projectId");
    if (!artifactId) throw new Error("Missing artifactId");

    const { supabase } = await requireUser();
    await requireOrgRoleForProject(supabase, projectId, ["owner", "editor", "admin"]);

    const a = await loadArtifact(supabase, artifactId);
    if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

    const st = String(a.approval_status ?? "draft").toLowerCase();
    if (st !== "draft") throw new Error("Only draft artifacts can be deleted.");
    if (Boolean(a.is_locked)) throw new Error("Cannot delete: artifact is locked.");
    if (Boolean(a.is_baseline)) throw new Error("Cannot delete: baseline artifact.");

    // Soft delete
    const { error } = await supabase
      .from("artifacts")
      .update({ deleted_at: new Date().toISOString(), is_current: false })
      .eq("id", artifactId);

    if (error) throwDb(error, "artifacts.deleteDraft");

    revalidatePath(`/projects/${projectId}/artifacts`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Delete failed" };
  }
}
