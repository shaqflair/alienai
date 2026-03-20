// src/app/projects/[id]/artifacts/actions.ts
"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { ARTIFACT_TYPES, type ArtifactType } from "@/lib/artifact-types";
import { auditFinancialPlanSave } from "@/lib/audit/financial-plan-audit";

/* =========================
   Constants
========================= */

const BOARD_MANAGEABLE_TYPES = new Set([
  "PROJECT_CHARTER",
  "PROJECT_CLOSURE_REPORT",
  "SCHEDULE",
]);

/* =========================
   Helpers
========================= */

function isArtifactType(x: string): x is ArtifactType {
  return (ARTIFACT_TYPES as readonly string[]).includes(x);
}

function isBoardManageableType(type: string): boolean {
  return BOARD_MANAGEABLE_TYPES.has(String(type ?? "").trim().toUpperCase());
}

function toArtifactType(raw: string): string {
  return raw.toLowerCase();
}

function isFinancialPlanType(type: string): boolean {
  const t = String(type ?? "").toLowerCase().trim();
  return t === "financial_plan" || t === "financial plan";
}

function normStr(x: any) {
  return String(x ?? "").trim();
}

function throwDb(error: any, label: string): never {
  const code    = error?.code    ?? "";
  const msg     = error?.message ?? "";
  const hint    = error?.hint    ?? "";
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

async function requireRole(
  supabase: any,
  projectId: string,
  allowed: Array<"owner" | "editor" | "viewer">
) {
  const { data, error } = await supabase.rpc("get_effective_project_role", {
    p_project_id: projectId,
  });
  if (error) throwDb(error, "rpc.get_effective_project_role");

  const row  = Array.isArray(data) ? data[0] : data;
  const role = String(row?.effective_role ?? "").toLowerCase();

  if (!allowed.includes(role as any)) {
    throw new Error(`Access denied. Required: ${allowed.join(" or ")}.`);
  }
  return role as "owner" | "editor" | "viewer";
}

async function loadArtifact(supabase: any, artifactId: string) {
  const { data, error } = await supabase
    .from("artifacts")
    .select(
      "id,project_id,type,artifact_type,title,content,content_json,version,approval_status,is_locked,created_at,updated_at,parent_artifact_id,root_artifact_id,is_current,is_baseline,revision_reason,revision_type"
    )
    .eq("id", artifactId)
    .single();

  if (error) throwDb(error, "artifacts.loadArtifact");
  if (!data)  throw new Error("Artifact not found");
  return data as any;
}

async function auditBestEffort(
  supabase: any,
  input: {
    project_id:       string;
    artifact_id:      string | null;
    actor_user_id:    string;
    actor_email?:     string | null;
    action:           string;
    from_status?:     string | null;
    to_status?:       string | null;
    from_is_current?: boolean | null;
    to_is_current?:   boolean | null;
    meta?:            any;
  }
) {
  try {
    const { error } = await supabase.from("artifact_audit").insert({
      project_id:      input.project_id,
      artifact_id:     input.artifact_id,
      actor_user_id:   input.actor_user_id,
      actor_email:     input.actor_email     ?? null,
      action:          input.action,
      from_status:     input.from_status     ?? null,
      to_status:       input.to_status       ?? null,
      from_is_current: input.from_is_current ?? null,
      to_is_current:   input.to_is_current   ?? null,
      meta:            input.meta            ?? {},
    });
    void error;
  } catch {
    // ignore
  }
}

async function snapshotToVersionsBestEffort(
  supabase: any,
  args: {
    artifactId:  string;
    projectId:   string;
    contentJson: any;
    userId:      string | null;
  }
) {
  // Writes a snapshot to artifact_versions on every meaningful save.
  // Uses a checksum to avoid duplicate entries when content hasn't changed.
  // Never throws — snapshot failure must never block the actual save.
  try {
    const { data: art } = await supabase
      .from("artifacts")
      .select("type, artifact_type, version, title")
      .eq("id", args.artifactId)
      .maybeSingle();

    const { data: proj } = await supabase
      .from("projects")
      .select("organisation_id")
      .eq("id", args.projectId)
      .maybeSingle();

    const orgId    = (proj as any)?.organisation_id ?? null;
    const artType  = String((art as any)?.artifact_type ?? (art as any)?.type ?? "").toLowerCase();
    const version  = Number((art as any)?.version ?? 1);
    const title    = String((art as any)?.title ?? "");

    // Simple checksum: length + first 64 chars base64 encoded
    const snapshotStr = JSON.stringify(args.contentJson ?? {});
    const checksum = snapshotStr.length.toString(16) + "-" +
      Buffer.from(snapshotStr.slice(0, 64)).toString("base64").replace(/[^a-z0-9]/gi, "").slice(0, 16);

    // Only write if content changed since last snapshot
    const { data: lastVer } = await supabase
      .from("artifact_versions")
      .select("checksum")
      .eq("artifact_id", args.artifactId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if ((lastVer as any)?.checksum === checksum) return; // no change

    await supabase.from("artifact_versions").insert({
      artifact_id:     args.artifactId,
      project_id:      args.projectId,
      organisation_id: orgId,
      artifact_type:   artType,
      artifact_status: "draft",
      title:           title || null,
      version_no:      version,
      source:          "editor_save",
      snapshot:        args.contentJson ?? {},
      checksum,
      created_by:      args.userId,
      created_at:      new Date().toISOString(),
    });
  } catch {
    // best-effort — never block the save
  }
}

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

function canEditArtifactRow(a: any) {
  const st = String(a?.approval_status ?? "draft").toLowerCase();
  if (Boolean(a?.is_locked)) return { ok: false, reason: "Artifact is locked." };
  if (!(st === "draft" || st === "changes_requested"))
    return { ok: false, reason: "Only Draft / Changes Requested can be edited." };
  if (!Boolean(a?.is_current)) return { ok: false, reason: "Only current version can be edited." };
  return { ok: true as const, status: st };
}

/* =========================
   CREATE
========================= */

export async function createArtifact(formData: FormData) {
  const projectId = normStr(formData.get("project_id"));
  const rawType   = normStr(formData.get("type")).toUpperCase();
  const content   = String(formData.get("content") ?? "");

  if (!projectId) throw new Error("Missing project_id");
  if (!rawType)   throw new Error("Missing type");
  if (!isArtifactType(rawType)) throw new Error("Invalid artifact type");
  if (!isBoardManageableType(rawType)) {
    throw new Error(
      `Artifact type "${rawType}" cannot be created from the board. Only Project Charter, Project Closure Report, and Schedule can be created here.`
    );
  }

  const { supabase, user } = await requireUser();
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const { data: existing, error: exErr } = await supabase
    .from("artifacts")
    .select("id,content,version,root_artifact_id,approval_status,content_json")
    .eq("project_id", projectId)
    .eq("type", rawType)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();

  if (exErr) throwDb(exErr, "artifacts.create.checkExistingCurrent");

  if (existing?.id) {
    const rootId = String(existing.root_artifact_id ?? existing.id);
    const nextV  = await nextVersionForRoot(supabase, rootId, Number(existing.version ?? 1));

    await demoteCurrentForProjectType(supabase, projectId, rawType);

    const { data: inserted, error: insErr } = await supabase
      .from("artifacts")
      .insert({
        project_id:         projectId,
        user_id:            user.id,
        type:               rawType,
        artifact_type:      toArtifactType(rawType),
        content:            content || (existing.content ?? ""),
        content_json:       existing.content_json ?? null,
        approval_status:    "draft",
        is_locked:          false,
        version:            nextV,
        is_current:         true,
        is_baseline:        false,
        root_artifact_id:   rootId,
        parent_artifact_id: existing.id,
        revision_type:      "revise",
        revision_reason:    "New draft created",
        updated_at:         new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insErr) throwDb(insErr, "artifacts.create.insertRevision");

    await auditBestEffort(supabase, {
      project_id:      projectId,
      artifact_id:     inserted.id,
      actor_user_id:   user.id,
      actor_email:     user.email,
      action:          "create_revision_from_current",
      from_status:     String(existing.approval_status ?? "draft"),
      to_status:       "draft",
      from_is_current: true,
      to_is_current:   true,
      meta: { type: rawType, from_artifact_id: existing.id, to_artifact_id: inserted.id, version: nextV },
    });

    revalidatePath(`/projects/${projectId}/artifacts`);
    return inserted.id as string;
  }

  await demoteCurrentForProjectType(supabase, projectId, rawType);

  const { data: inserted, error } = await supabase
    .from("artifacts")
    .insert({
      project_id:       projectId,
      user_id:          user.id,
      type:             rawType,
      artifact_type:    toArtifactType(rawType),
      content,
      content_json:     null,
      approval_status:  "draft",
      is_locked:        false,
      version:          1,
      is_current:       true,
      is_baseline:      false,
      root_artifact_id: null,
      parent_artifact_id: null,
      updated_at:       new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) throwDb(error, "artifacts.create.insert");

  const { error: upErr } = await supabase
    .from("artifacts").update({ root_artifact_id: inserted.id }).eq("id", inserted.id);
  if (upErr) throwDb(upErr, "artifacts.create.backfill_root");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     inserted.id,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "create_artifact",
    from_status:     null,
    to_status:       "draft",
    from_is_current: null,
    to_is_current:   true,
    meta: { type: rawType, version: 1 },
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  return inserted.id as string;
}

/* =========================
   UPDATE (text save)
========================= */

export async function updateArtifact(formData: FormData) {
  const artifactId = normStr(formData.get("artifact_id"));
  const projectId  = normStr(formData.get("project_id"));
  const content    = String(formData.get("content") ?? "");

  if (!artifactId) throw new Error("Missing artifact_id");
  if (!projectId)  throw new Error("Missing project_id");

  const { supabase, user } = await requireUser();
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const a    = await loadArtifact(supabase, artifactId);
  if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const edit = canEditArtifactRow(a);
  if (!edit.ok) throw new Error(edit.reason);

  const { error } = await supabase
    .from("artifacts")
    .update({ content, updated_at: new Date().toISOString() })
    .eq("id", artifactId);

  if (error) throwDb(error, "artifacts.update");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     artifactId,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "update_content",
    from_status:     edit.status,
    to_status:       edit.status,
    from_is_current: Boolean(a.is_current),
    to_is_current:   Boolean(a.is_current),
    meta: { before_len: String(a.content ?? "").length, after_len: content.length },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   UPDATE JSON
========================= */

export async function updateArtifactJson(formData: FormData) {
  const projectId  = normStr(formData.get("project_id"));
  const artifactId = normStr(formData.get("artifact_id"));
  const jsonStr    = normStr(formData.get("content_json"));

  if (!projectId)  throw new Error("Missing project_id");
  if (!artifactId) throw new Error("Missing artifact_id");
  if (!jsonStr)    throw new Error("Missing content_json");

  const { supabase, user } = await requireUser();
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const a    = await loadArtifact(supabase, artifactId);
  if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const edit = canEditArtifactRow(a);
  if (!edit.ok) throw new Error(edit.reason);

  let parsed: any;
  try { parsed = JSON.parse(jsonStr); }
  catch { throw new Error("content_json must be valid JSON."); }

  const { error } = await supabase
    .from("artifacts")
    .update({ content_json: parsed, updated_at: new Date().toISOString() })
    .eq("id", artifactId);

  if (error) throwDb(error, "artifacts.updateArtifactJson");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     artifactId,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "update_content_json",
    from_status:     edit.status,
    to_status:       edit.status,
    from_is_current: Boolean(a.is_current),
    to_is_current:   Boolean(a.is_current),
    meta: { json_bytes: jsonStr.length },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   DIFF DATA
========================= */

export async function getArtifactDiff(artifactId: string) {
  const { supabase } = await requireUser();

  const a         = await loadArtifact(supabase, artifactId);
  const projectId = String(a.project_id ?? "");
  await requireRole(supabase, projectId, ["owner", "editor", "viewer"]);

  const rootId = String(a.root_artifact_id ?? a.id);

  const { data: baseRows } = await supabase
    .from("artifacts")
    .select("id,content,version")
    .eq("root_artifact_id", rootId)
    .eq("is_baseline", true)
    .limit(1);

  const baseline = (baseRows ?? [])[0] as any;

  let parent: any = null;
  if (a.parent_artifact_id) {
    const { data: p } = await supabase
      .from("artifacts").select("id,content,version").eq("id", a.parent_artifact_id).single();
    parent = p ?? null;
  }

  return {
    artifact: { id: a.id, content: a.content ?? "", version: a.version ?? null },
    baseline: baseline ? { id: baseline.id, content: baseline.content ?? "", version: baseline.version ?? null } : null,
    parent:   parent   ? { id: parent.id,   content: parent.content   ?? "", version: parent.version   ?? null } : null,
  };
}

/* =========================
   AI GENERATION (placeholder)
========================= */

export async function generateArtifactAI(formData: FormData) {
  const projectId  = normStr(formData.get("project_id"));
  const artifactId = normStr(formData.get("artifact_id"));
  const prompt     = String(formData.get("prompt") ?? "").trim();

  if (!projectId)  throw new Error("Missing project_id");
  if (!artifactId) throw new Error("Missing artifact_id");

  const { supabase, user } = await requireUser();
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const a    = await loadArtifact(supabase, artifactId);
  if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const edit = canEditArtifactRow(a);
  if (!edit.ok) throw new Error(edit.reason);

  const stamp  = new Date().toISOString();
  const before = String(a.content ?? "");
  const after  = before + `\n\n---\nAI Draft (${stamp})\n` + (prompt ? `Prompt: ${prompt}\n\n` : "") + "[AI output placeholder]\n";

  const { error } = await supabase
    .from("artifacts")
    .update({ content: after, updated_at: new Date().toISOString() })
    .eq("id", artifactId);

  if (error) throwDb(error, "artifacts.generateArtifactAI.update");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     artifactId,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "generate_ai",
    from_status:     edit.status,
    to_status:       edit.status,
    from_is_current: Boolean(a.is_current),
    to_is_current:   Boolean(a.is_current),
    meta: { prompt: prompt || null, before_len: before.length, after_len: after.length },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   REVISE (Create Revision)
========================= */

export async function reviseArtifact(formData: FormData) {
  const artifactId      = normStr(formData.get("artifact_id"));
  const revision_reason = normStr(formData.get("revision_reason")) || "Revision created";
  const revision_type   = normStr(formData.get("revision_type"))   || "material";

  if (!artifactId) throw new Error("Missing artifact_id");

  const { supabase, user } = await requireUser();

  const src       = await loadArtifact(supabase, artifactId);
  const projectId = String(src.project_id ?? "");
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const rootId = String(src.root_artifact_id ?? src.id);
  const nextV  = await nextVersionForRoot(supabase, rootId, Number(src.version ?? 1));

  await demoteCurrentForProjectType(supabase, projectId, String(src.type ?? ""));

  const { data: inserted, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id:         projectId,
      user_id:            user.id,
      type:               src.type,
      artifact_type:      src.artifact_type ?? toArtifactType(String(src.type ?? "")),
      content:            src.content      ?? "",
      content_json:       src.content_json ?? null,
      approval_status:    "draft",
      is_locked:          false,
      root_artifact_id:   rootId,
      parent_artifact_id: src.id,
      version:            nextV,
      is_current:         true,
      is_baseline:        false,
      revision_reason,
      revision_type,
      updated_at:         new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr) throwDb(insErr, "artifacts.revise.insert");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     inserted.id,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "create_revision",
    from_status:     String(src.approval_status ?? "draft"),
    to_status:       "draft",
    from_is_current: Boolean(src.is_current),
    to_is_current:   true,
    meta: { from: src.id, to: inserted.id, version: nextV, revision_type, revision_reason },
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  return inserted.id as string;
}

/* =========================
   RESTORE VERSION
========================= */

export async function restoreArtifactVersion(formData: FormData) {
  const projectId = normStr(formData.get("project_id"));
  const targetId  = normStr(formData.get("target_artifact_id"));
  const reason    = normStr(formData.get("reason")) || "Restored a previous version";

  if (!projectId) throw new Error("Missing project_id");
  if (!targetId)  throw new Error("Missing target_artifact_id");

  const { supabase, user } = await requireUser();
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const target = await loadArtifact(supabase, targetId);
  if (String(target.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  const type   = String(target.type ?? "");
  const rootId = String(target.root_artifact_id ?? target.id);
  const nextV  = await nextVersionForRoot(supabase, rootId, Number(target.version ?? 1));

  await demoteCurrentForProjectType(supabase, projectId, type);

  const { data: inserted, error: insErr } = await supabase
    .from("artifacts")
    .insert({
      project_id:         projectId,
      user_id:            user.id,
      type,
      artifact_type:      target.artifact_type ?? toArtifactType(type),
      content:            target.content      ?? "",
      content_json:       target.content_json ?? null,
      approval_status:    "draft",
      is_locked:          false,
      version:            nextV,
      is_current:         true,
      is_baseline:        false,
      root_artifact_id:   rootId,
      parent_artifact_id: target.id,
      revision_type:      "restore",
      revision_reason:    reason,
      updated_at:         new Date().toISOString(),
    })
    .select("id")
    .single();

  if (insErr) throwDb(insErr, "artifacts.restore.insert");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     inserted.id,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "restore_version",
    from_status:     String(target.approval_status ?? "draft"),
    to_status:       "draft",
    from_is_current: Boolean(target.is_current),
    to_is_current:   true,
    meta: { restored_from: target.id, to: inserted.id, version: nextV, reason },
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  return inserted.id as string;
}

/* =========================
   SUBMIT (lock + set submitted)
========================= */

export async function lockArtifact(artifactId: string) {
  if (!artifactId) throw new Error("Missing artifactId");

  const { supabase, user } = await requireUser();

  const a         = await loadArtifact(supabase, artifactId);
  const projectId = String(a.project_id ?? "");
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const st = String(a.approval_status ?? "draft").toLowerCase();
  if (!Boolean(a.is_current))   throw new Error("Only current version can be submitted.");
  if (Boolean(a.is_locked))     throw new Error("Already locked/submitted.");
  if (!(st === "draft" || st === "changes_requested"))
    throw new Error("Only Draft / Changes Requested can be submitted.");

  const { error } = await supabase
    .from("artifacts")
    .update({ is_locked: true, approval_status: "submitted", updated_at: new Date().toISOString() })
    .eq("id", artifactId);

  if (error) throwDb(error, "artifacts.lockArtifact");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     artifactId,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "submit_for_approval",
    from_status:     st,
    to_status:       "submitted",
    from_is_current: Boolean(a.is_current),
    to_is_current:   Boolean(a.is_current),
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   APPROVE (promote baseline)
========================= */

export async function approveArtifact(artifactId: string) {
  if (!artifactId) throw new Error("Missing artifactId");

  const { supabase, user } = await requireUser();

  const a         = await loadArtifact(supabase, artifactId);
  const projectId = String(a.project_id ?? "");
  await requireRole(supabase, projectId, ["owner"]);

  const st = String(a.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Only submitted artifacts can be approved.");

  const rootId = String(a.root_artifact_id ?? a.id);

  const { error: unsetErr } = await supabase
    .from("artifacts").update({ is_baseline: false })
    .eq("root_artifact_id", rootId).eq("is_baseline", true);
  if (unsetErr) throwDb(unsetErr, "artifacts.approveArtifact.unsetBaseline");

  const { error } = await supabase
    .from("artifacts")
    .update({ approval_status: "approved", is_locked: true, is_baseline: true, is_current: true, updated_at: new Date().toISOString() })
    .eq("id", artifactId);
  if (error) throwDb(error, "artifacts.approveArtifact");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     artifactId,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "approve",
    from_status:     st,
    to_status:       "approved",
    from_is_current: Boolean(a.is_current),
    to_is_current:   true,
    meta: { promote_baseline: true, root_id: rootId },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   REJECT -> changes_requested
========================= */

export async function rejectArtifact(artifactId: string, reason: string) {
  if (!artifactId) throw new Error("Missing artifactId");

  const { supabase, user } = await requireUser();

  const a         = await loadArtifact(supabase, artifactId);
  const projectId = String(a.project_id ?? "");
  await requireRole(supabase, projectId, ["owner"]);

  const st = String(a.approval_status ?? "").toLowerCase();
  if (st !== "submitted") throw new Error("Only submitted artifacts can be rejected.");

  const msg = normStr(reason) || "Changes required";

  const { error } = await supabase
    .from("artifacts")
    .update({ approval_status: "changes_requested", is_locked: false, revision_reason: msg, revision_type: "review", updated_at: new Date().toISOString() })
    .eq("id", artifactId);
  if (error) throwDb(error, "artifacts.rejectArtifact");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     artifactId,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "reject",
    from_status:     st,
    to_status:       "changes_requested",
    from_is_current: Boolean(a.is_current),
    to_is_current:   Boolean(a.is_current),
    meta: { reason: msg },
  });

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   SET CURRENT
========================= */

export async function setArtifactCurrent(args: { projectId: string; artifactId: string }) {
  const projectId  = normStr(args?.projectId);
  const artifactId = normStr(args?.artifactId);

  if (!projectId)  throw new Error("Missing project_id");
  if (!artifactId) throw new Error("Missing artifact_id");

  const { supabase, user } = await requireUser();
  await requireRole(supabase, projectId, ["owner", "editor"]);

  const a = await loadArtifact(supabase, artifactId);
  if (String(a.project_id ?? "") !== projectId) throw new Error("Project mismatch");

  await demoteCurrentForProjectType(supabase, projectId, String(a.type ?? ""));

  const { error } = await supabase
    .from("artifacts")
    .update({ is_current: true, updated_at: new Date().toISOString() })
    .eq("id", artifactId);
  if (error) throwDb(error, "artifacts.setArtifactCurrent");

  await auditBestEffort(supabase, {
    project_id:      projectId,
    artifact_id:     artifactId,
    actor_user_id:   user.id,
    actor_email:     user.email,
    action:          "set_current",
    from_is_current: Boolean(a.is_current),
    to_is_current:   true,
  });

  revalidatePath(`/projects/${projectId}/artifacts`);
  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
}

/* =========================
   CREATE REVISION (wrapper)
========================= */

export async function createArtifactRevision(args: {
  artifactId:      string;
  projectId?:      string;
  revisionReason?: string;
  revisionType?:   string;
}): Promise<{ newArtifactId: string }> {
  const fd = new FormData();
  fd.set("artifact_id",     normStr(args?.artifactId));
  fd.set("revision_reason", normStr(args?.revisionReason) || "Revision created");
  fd.set("revision_type",   normStr(args?.revisionType)   || "material");

  const newArtifactId = await reviseArtifact(fd);
  return { newArtifactId };
}

/* =========================
   UPDATE JSON ARGS (wrapper — revalidates page)
   Also snapshots to artifact_versions so History works in the
   Weekly Report editor (and any other JSON-based editor).
========================= */

export async function updateArtifactJsonArgs(args: {
  projectId:   string;
  artifactId:  string;
  contentJson: any;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const fd = new FormData();
    fd.set("project_id",   normStr(args?.projectId));
    fd.set("artifact_id",  normStr(args?.artifactId));
    fd.set("content_json", JSON.stringify(args?.contentJson ?? {}));

    await updateArtifactJson(fd);

    // Snapshot to artifact_versions — best-effort, never blocks save
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    await snapshotToVersionsBestEffort(supabase, {
      artifactId:  normStr(args?.artifactId),
      projectId:   normStr(args?.projectId),
      contentJson: args?.contentJson ?? {},
      userId:      auth?.user?.id ?? null,
    });

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Save failed" };
  }
}

/* =========================
   UPDATE JSON SILENT
   Used by the Financial Plan editor (debounced auto-save).
   Skips revalidatePath to avoid router refresh during typing.
   Writes a diff-based entry to artifact_audit_log for Financial Plans.
========================= */

export async function updateArtifactJsonSilent(args: {
  projectId:   string;
  artifactId:  string;
  contentJson: any;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return { ok: false, error: "Unauthorized" };

    const pId = normStr(args?.projectId);
    const aId = normStr(args?.artifactId);

    // Fetch current state BEFORE overwriting (for diff + type check)
    const { data: existing } = await supabase
      .from("artifacts")
      .select("content_json, type, artifact_type")
      .eq("id", aId)
      .maybeSingle();

    const beforeJson = (existing as any)?.content_json ?? null;
    const rawType    = String((existing as any)?.type ?? (existing as any)?.artifact_type ?? "");
    const isFinPlan  = isFinancialPlanType(rawType);

    // Write the save
    const { error } = await supabase
      .from("artifacts")
      .update({
        content_json: args.contentJson ?? {},
        updated_at:   new Date().toISOString(),
      })
      .eq("id", aId);

    if (error) return { ok: false, error: error.message };

    // Financial plan audit — non-blocking
    if (isFinPlan && pId && aId && auth.user.id) {
      void auditFinancialPlanSave({
        projectId:  pId,
        artifactId: aId,
        actorId:    auth.user.id,
        beforeJson,
        afterJson:  args.contentJson,
        useAdmin:   true,
      });
    }

    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Save failed" };
  }
}

/* =========================
   CLONE ARTIFACT
========================= */

export async function cloneArtifact(
  formData: FormData
): Promise<{ ok: boolean; newArtifactId?: string; error?: string }> {
  try {
    const projectRef = normStr(formData.get("projectId"));
    const artifactId = normStr(formData.get("artifactId"));
    if (!projectRef) throw new Error("Missing projectId");
    if (!artifactId) throw new Error("Missing artifactId");

    const { supabase, user } = await requireUser();
    await requireRole(supabase, projectRef, ["owner", "editor"]);

    const src = await loadArtifact(supabase, artifactId);

    if (!isBoardManageableType(String(src.type ?? ""))) {
      return {
        ok: false,
        error: `Artifact type "${src.type}" cannot be cloned. Only Project Charter, Project Closure Report, and Schedule can be cloned.`,
      };
    }

    const rootId = String(src.root_artifact_id ?? src.id);
    const nextV  = await nextVersionForRoot(supabase, rootId, Number(src.version ?? 1));

    await demoteCurrentForProjectType(supabase, projectRef, String(src.type ?? ""));

    const { data: inserted, error: insErr } = await supabase
      .from("artifacts")
      .insert({
        project_id:         projectRef,
        user_id:            user.id,
        type:               src.type,
        artifact_type:      src.artifact_type ?? toArtifactType(String(src.type ?? "")),
        content:            src.content      ?? "",
        content_json:       src.content_json ?? null,
        approval_status:    "draft",
        is_locked:          false,
        version:            nextV,
        is_current:         true,
        is_baseline:        false,
        root_artifact_id:   rootId,
        parent_artifact_id: src.id,
        revision_type:      "clone",
        revision_reason:    "Cloned",
        updated_at:         new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insErr) throw insErr;

    revalidatePath(`/projects/${projectRef}/artifacts`);
    return { ok: true, newArtifactId: inserted.id };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Clone failed" };
  }
}

/* =========================
   DELETE DRAFT ARTIFACT
========================= */

export async function deleteDraftArtifact(args: {
  artifactId: string;
  projectId:  string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const { supabase, user } = await requireUser();
    await requireRole(supabase, normStr(args?.projectId), ["owner", "editor"]);

    const a = await loadArtifact(supabase, normStr(args?.artifactId));
    if (String(a.project_id ?? "") !== normStr(args?.projectId)) {
      return { ok: false, error: "Project mismatch" };
    }

    if (!isBoardManageableType(String(a.type ?? ""))) {
      return {
        ok: false,
        error: `Artifact type "${a.type}" cannot be deleted. Only Project Charter, Project Closure Report, and Schedule drafts can be deleted.`,
      };
    }

    const st      = String(a.approval_status ?? "draft").toLowerCase();
    const isDraft = st === "" || st === "draft" || st === "new";
    if (!isDraft || Boolean(a.is_locked) || Boolean(a.is_baseline)) {
      return { ok: false, error: "Only unlocked draft artifacts can be deleted." };
    }

    const { error } = await supabase
      .from("artifacts")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", normStr(args?.artifactId));

    if (error) return { ok: false, error: error.message };

    await auditBestEffort(supabase, {
      project_id:      normStr(args?.projectId),
      artifact_id:     normStr(args?.artifactId),
      actor_user_id:   user.id,
      actor_email:     user.email,
      action:          "delete_draft",
      from_status:     st,
      to_status:       "deleted",
      from_is_current: Boolean(a.is_current),
      to_is_current:   false,
    });

    revalidatePath(`/projects/${args.projectId}/artifacts`);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Delete failed" };
  }
}

/* =========================
   RENAME ARTIFACT TITLE
========================= */

export async function renameArtifactTitle(formData: FormData): Promise<void>;
export async function renameArtifactTitle(args: {
  artifactId: string;
  projectId:  string;
  title:      string;
}): Promise<{ ok: boolean; error?: string }>;
export async function renameArtifactTitle(
  input: FormData | { artifactId: string; projectId: string; title: string }
): Promise<void | { ok: boolean; error?: string }> {
  try {
    let artifactId: string;
    let projectId:  string;
    let title:      string;

    if (input instanceof FormData) {
      artifactId = normStr(input.get("artifact_id"));
      projectId  = normStr(input.get("project_id"));
      title      = normStr(input.get("title"));
    } else {
      artifactId = normStr(input.artifactId);
      projectId  = normStr(input.projectId);
      title      = normStr(input.title);
    }

    const { supabase } = await requireUser();
    await requireRole(supabase, projectId, ["owner", "editor"]);

    const { error } = await supabase
      .from("artifacts")
      .update({ title, updated_at: new Date().toISOString() })
      .eq("id", artifactId);

    if (error) {
      if (input instanceof FormData) throw new Error(error.message);
      return { ok: false, error: error.message };
    }

    revalidatePath(`/projects/${projectId}/artifacts`);
    revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);

    if (!(input instanceof FormData)) return { ok: true };
  } catch (e: any) {
    if (!(input instanceof FormData)) return { ok: false, error: e?.message ?? "Rename failed" };
    throw e;
  }
}

/* =========================
   SET ARTIFACT CURRENT ACTION (alias)
========================= */

export async function setArtifactCurrentAction(args: {
  projectId:  string;
  artifactId: string;
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await setArtifactCurrent(args);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message ?? "Failed to set current" };
  }
}