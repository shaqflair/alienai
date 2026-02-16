// src/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions.ts
"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import type { CharterV2 } from "@/lib/charter/charter-v2";
import { migrateCharterAnyToV2 } from "@/lib/charter/migrate-to-v2";

// ✅ NEW: event emitter
import { emitArtifactEvent } from "@/lib/events/publisher";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * Canonical stored shape (what goes into artifacts.content_json)
 * MUST include version + type so editor reliably detects v2.
 */
type CharterV2Stored = {
  version: 2;
  type: "project_charter";
  meta: Record<string, any>;
  sections: any[];
};

function toStoredCharterV2(x: any): CharterV2Stored {
  // canonical client payload
  if (
    x &&
    typeof x === "object" &&
    Number((x as any).version) === 2 &&
    String((x as any).type ?? "").toLowerCase() === "project_charter" &&
    Array.isArray((x as any).sections)
  ) {
    return {
      version: 2,
      type: "project_charter",
      meta: (x as any).meta && typeof (x as any).meta === "object" ? (x as any).meta : {},
      sections: (x as any).sections ?? [],
    };
  }

  // library shape { meta, sections, legacy_raw? }
  if (x && typeof x === "object" && Array.isArray((x as any).sections)) {
    return {
      version: 2,
      type: "project_charter",
      meta: (x as any).meta && typeof (x as any).meta === "object" ? (x as any).meta : {},
      sections: (x as any).sections ?? [],
    };
  }

  return { version: 2, type: "project_charter", meta: {}, sections: [] };
}

/**
 * ✅ Detect whether the stored charter has a Stakeholders section
 * We use this to decide whether to trigger the stakeholder suggestion pipeline.
 */
function hasStakeholdersSection(stored: CharterV2Stored) {
  const sections = Array.isArray(stored?.sections) ? stored.sections : [];
  return sections.some((s: any) => {
    const key = String(s?.key ?? "").trim().toLowerCase();
    const title = String(s?.title ?? "").trim().toLowerCase();
    return key === "stakeholders" || title.includes("stakeholder");
  });
}

/**
 * ✅ Base URL for server-side fetch to our own API routes
 * - Uses NEXT_PUBLIC_APP_URL if set (recommended)
 * - Falls back to VERCEL_URL on Vercel
 * - Falls back to localhost for local dev
 */
function baseUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://localhost:3000";
}

/**
 * ✅ Forward trigger to AI events route (kept small, never throws)
 * This is the “2.1 Emit an event when Charter Stakeholders section saves”.
 */
async function triggerCharterStakeholdersPipeline(args: {
  projectId: string;
  artifactId: string;
  saveSource: "autosave" | "manual_save" | "migration";
  previous_artifact_id?: string;
}) {
  try {
    await fetch(`${baseUrl()}/api/ai/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: args.projectId,
        artifactId: args.artifactId,
        eventType: "charter_stakeholders_updated",
        severity: "info",
        source: "app",
        payload: {
          target_artifact_type: "stakeholder_register",
          charterArtifactId: args.artifactId,
          saveSource: args.saveSource,
          previous_artifact_id: args.previous_artifact_id ?? undefined,
        },
      }),
    }).catch(() => null);
  } catch {
    // swallow: saves must never fail because of AI pipeline
  }
}

async function assertCanEdit(supabase: any, projectId: string, artifactId: string, userId: string) {
  // membership
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) throw new Error("Not a project member");

  const role = String((mem as any)?.role ?? "viewer").toLowerCase();
  if (!(role === "owner" || role === "editor")) throw new Error("Forbidden (viewers cannot save)");

  // artifact state
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, title, content, approval_status, is_locked, version")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (artErr) throw artErr;
  if (!artifact) throw new Error("Artifact not found");

  const approvalStatus = String((artifact as any).approval_status ?? "draft").toLowerCase();
  const isLocked = !!(artifact as any).is_locked;
  const canWriteStatus = approvalStatus === "draft" || approvalStatus === "changes_requested";
  if (isLocked || !canWriteStatus) throw new Error("Artifact is locked or not editable in current status");

  return artifact;
}

/**
 * ✅ AUTOSAVE (NO versioning):
 * Updates the CURRENT artifact row in-place.
 * - does NOT call create_artifact_revision
 */
export async function autosaveProjectCharterV2(args: {
  projectId: string;
  artifactId: string;
  charterV2: CharterV2 | any;
  clearLegacyContent?: boolean;
}) {
  const projectId = safeParam(args.projectId);
  const artifactId = safeParam(args.artifactId);
  const clearLegacyContent = !!args.clearLegacyContent;

  if (!projectId || !artifactId) throw new Error("Missing projectId/artifactId");
  if (!args.charterV2 || typeof args.charterV2 !== "object") throw new Error("Missing charterV2 payload");

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Unauthorized");

  const artifact = await assertCanEdit(supabase, projectId, artifactId, auth.user.id);

  const stored = toStoredCharterV2(args.charterV2);
  const nextContent = clearLegacyContent ? "" : String((artifact as any).content ?? "");

  const { error: updErr } = await supabase
    .from("artifacts")
    .update({
      content: nextContent, // NOT NULL
      content_json: stored,
      updated_at: new Date().toISOString(),
    })
    .eq("id", artifactId)
    .eq("project_id", projectId);

  if (updErr) throw new Error(`[artifacts.update(autosave)] ${updErr.code ?? ""} ${updErr.message}`);

  // ✅ Emit internal audit/event log (AUTOSAVE)
  await emitArtifactEvent({
    project_id: projectId,
    artifact_id: artifactId,
    artifact_type: "project_charter",
    action: "updated",
    payload: {
      source: "autosave",
      clearLegacyContent,
      changed: ["content_json"],
    },
    actor_user_id: auth.user.id,
  });

  // ✅ NEW (2.1): forward trigger to stakeholder suggestion pipeline
  if (hasStakeholdersSection(stored)) {
    await triggerCharterStakeholdersPipeline({
      projectId,
      artifactId,
      saveSource: "autosave",
    });
  }

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);

  return { ok: true, artifactId, version: Number((artifact as any).version ?? 1) };
}

/**
 * ✅ MANUAL SAVE (versioned):
 * Creates a NEW revision row via create_artifact_revision.
 * Hard guard: requires mode:"manual"
 */
export async function saveProjectCharterV2Manual(args: {
  mode: "manual"; // ✅ hard guard
  projectId: string;
  artifactId: string;
  charterV2: CharterV2 | any;
  clearLegacyContent?: boolean;
}) {
  const projectId = safeParam(args.projectId);
  const artifactId = safeParam(args.artifactId);
  const clearLegacyContent = !!args.clearLegacyContent;

  if (args.mode !== "manual") throw new Error("Blocked: versioned save requires mode:'manual'");
  if (!projectId || !artifactId) throw new Error("Missing projectId/artifactId");
  if (!args.charterV2 || typeof args.charterV2 !== "object") throw new Error("Missing charterV2 payload");

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Unauthorized");

  const artifact = await assertCanEdit(supabase, projectId, artifactId, auth.user.id);

  const nextContent = clearLegacyContent ? "" : String((artifact as any).content ?? "");
  const stored = toStoredCharterV2(args.charterV2);

  // ✅ requires your Postgres function create_artifact_revision
  const { data: newId, error: rpcErr } = await supabase.rpc("create_artifact_revision", {
    p_project_id: projectId,
    p_artifact_id: artifactId,
    p_title: (artifact as any).title ?? null,
    p_content: nextContent,
    p_content_json: stored,
  });

  if (rpcErr) throw new Error(`[rpc.create_artifact_revision] ${rpcErr.code} ${rpcErr.message}`);

  const newArtifactId = String(newId ?? "");
  if (!newArtifactId) throw new Error("Revision save failed: missing new artifact id");

  // ✅ Emit internal audit/event log (MANUAL SAVE)
  // Important: artifact_id should be the NEW revision id, because that's the new canonical row.
  await emitArtifactEvent({
    project_id: projectId,
    artifact_id: newArtifactId,
    artifact_type: "project_charter",
    action: "updated",
    payload: {
      source: "manual_save",
      clearLegacyContent,
      changed: ["content_json"],
      previous_artifact_id: artifactId,
    },
    actor_user_id: auth.user.id,
  });

  // ✅ NEW (2.1): forward trigger to stakeholder suggestion pipeline (use NEW revision id)
  if (hasStakeholdersSection(stored)) {
    await triggerCharterStakeholdersPipeline({
      projectId,
      artifactId: newArtifactId,
      saveSource: "manual_save",
      previous_artifact_id: artifactId,
    });
  }

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts/${newArtifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
  revalidatePath(`/projects/${projectId}`);

  return { ok: true, newArtifactId };
}

/**
 * ✅ MIGRATE current artifact row to v2 (in-place, no version)
 */
export async function migrateProjectCharterToV2(args: { projectId: string; artifactId: string }) {
  const projectId = safeParam(args.projectId);
  const artifactId = safeParam(args.artifactId);
  if (!projectId || !artifactId) throw new Error("Missing ids");

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Unauthorized");

  // RLS membership check
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) throw new Error("Not a project member");

  const role = String((mem as any)?.role ?? "viewer").toLowerCase();
  if (!(role === "owner" || role === "editor")) throw new Error("Forbidden (viewers cannot migrate)");

  const admin = createAdminClient();

  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, title")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr) throw new Error(`[projects.select] ${projErr.code} ${projErr.message}`);

  const projectTitleFallback = String(project?.title ?? "").trim();

  const { data: artifact, error } = await admin
    .from("artifacts")
    .select("id, project_id, content, content_json, approval_status, is_locked")
    .eq("id", artifactId)
    .maybeSingle();

  if (error) throw new Error(`[artifacts.select] ${error.code} ${error.message}`);
  if (!artifact) throw new Error("Artifact not found");
  if (String(artifact.project_id) !== projectId) throw new Error("Project mismatch");

  const approvalStatus = String((artifact as any).approval_status ?? "draft").toLowerCase();
  const isLocked = !!(artifact as any).is_locked;
  const canWriteStatus = approvalStatus === "draft" || approvalStatus === "changes_requested";
  if (isLocked || !canWriteStatus) throw new Error("Artifact is locked or not editable in current status");

  const raw = (artifact as any).content_json ?? (artifact as any).content ?? null;

  const migrated = migrateCharterAnyToV2({ raw, projectTitleFallback });
  const v2Stored = toStoredCharterV2(migrated);

  const { error: upErr } = await admin
    .from("artifacts")
    .update({
      content_json: v2Stored,
      content: "",
    })
    .eq("id", artifactId)
    .eq("project_id", projectId);

  if (upErr) throw new Error(`[artifacts.update] ${upErr.code} ${upErr.message}`);

  // ✅ Emit internal audit/event log (MIGRATION)
  await emitArtifactEvent({
    project_id: projectId,
    artifact_id: artifactId,
    artifact_type: "project_charter",
    action: "updated",
    payload: {
      source: "migration",
      changed: ["content_json"],
    },
    actor_user_id: auth.user.id,
  });

  // ✅ NEW: forward trigger to stakeholder suggestion pipeline on migration too
  if (hasStakeholdersSection(v2Stored)) {
    await triggerCharterStakeholdersPipeline({
      projectId,
      artifactId,
      saveSource: "migration",
    });
  }

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
  revalidatePath(`/projects/${projectId}`);

  return v2Stored;
}
