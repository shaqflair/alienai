// src/app/projects/[id]/artifacts/[artifactId]/charter-v2-actions.ts
"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import type { CharterV2 } from "@/lib/charter/charter-v2";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * Canonical stored shape (what goes into artifacts.content_json)
 * This MUST include version + type so the editor can reliably detect v2.
 */
type CharterV2Stored = {
  version: 2;
  type: "project_charter";
  meta: Record<string, any>;
  sections: any[];
};

function toStoredCharterV2(x: any): CharterV2Stored {
  // If client already sends canonical shape, accept it.
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

  // If client sends CharterV2 library shape: { meta, sections, legacy_raw? }
  if (x && typeof x === "object" && Array.isArray((x as any).sections)) {
    return {
      version: 2,
      type: "project_charter",
      meta: (x as any).meta && typeof (x as any).meta === "object" ? (x as any).meta : {},
      sections: (x as any).sections ?? [],
    };
  }

  // Worst case: blank
  return {
    version: 2,
    type: "project_charter",
    meta: {},
    sections: [],
  };
}

/**
 * ✅ Versioned save:
 * Instead of overwriting the row, we create a NEW revision row and flip is_current.
 *
 * Requires Postgres function:
 *   public.create_artifact_revision(p_project_id uuid, p_artifact_id uuid, p_title text, p_content text, p_content_json jsonb) returns uuid
 *
 * Returns:
 *   { ok:true, newArtifactId }
 */
export async function saveProjectCharterV2(args: {
  projectId: string;
  artifactId: string;
  charterV2: CharterV2 | any; // allow canonical too
  clearLegacyContent?: boolean;
}) {
  const projectId = safeParam(args.projectId);
  const artifactId = safeParam(args.artifactId);
  const clearLegacyContent = !!args.clearLegacyContent;

  if (!projectId || !artifactId) throw new Error("Missing projectId/artifactId");
  if (!args.charterV2 || typeof args.charterV2 !== "object") throw new Error("Missing charterV2 payload");

  const supabase = await createClient();

  // Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Unauthorized");

  // Membership gate (owner/editor only)
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) throw new Error("Not a project member");

  const role = String((mem as any)?.role ?? "viewer").toLowerCase();
  const canEdit = role === "owner" || role === "editor";
  if (!canEdit) throw new Error("Forbidden (viewers cannot save)");

  // Make sure artifact exists + belongs to project + is writable state
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select("id, project_id, type, title, content, approval_status, is_locked")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (artErr) throw artErr;
  if (!artifact) throw new Error("Artifact not found");

  // Prevent saving if locked/submitted etc.
  const approvalStatus = String((artifact as any).approval_status ?? "draft").toLowerCase();
  const isLocked = !!(artifact as any).is_locked;
  const canWriteStatus = approvalStatus === "draft" || approvalStatus === "changes_requested";
  if (isLocked || !canWriteStatus) {
    throw new Error("Artifact is locked or not editable in current status");
  }

  // IMPORTANT: because artifacts.content is NOT NULL, never set it to null.
  // For charter, we generally keep legacy content empty once on v2.
  const nextContent = clearLegacyContent ? "" : String((artifact as any).content ?? "");

  // ✅ Canonicalize to stored v2 shape ALWAYS
  const stored = toStoredCharterV2(args.charterV2);

  // ✅ Create a new revision row (atomic server-side)
  const { data: newId, error: rpcErr } = await supabase.rpc("create_artifact_revision", {
    p_project_id: projectId,
    p_artifact_id: artifactId,
    p_title: (artifact as any).title ?? null, // keep same title (rename uses separate action)
    p_content: nextContent,
    p_content_json: stored,
  });

  if (rpcErr) throw new Error(`[rpc.create_artifact_revision] ${rpcErr.code} ${rpcErr.message}`);

  const newArtifactId = String(newId ?? "");
  if (!newArtifactId) throw new Error("Revision save failed: missing new artifact id");

  // Revalidate lists + both pages (old and new)
  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts/${newArtifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
  revalidatePath(`/projects/${projectId}`);

  return { ok: true, newArtifactId };
}
