"use server";

import "server-only";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { migrateCharterAnyToV2 } from "@/lib/charter/migrate-to-v2";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * Canonical stored shape (what goes into artifacts.content_json)
 * Must include version/type for reliable v2 detection.
 */
type CharterV2Stored = {
  version: 2;
  type: "project_charter";
  meta: Record<string, any>;
  sections: any[];
};

function toStoredCharterV2(x: any): CharterV2Stored {
  // already canonical
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

  // common v2 library shape: { meta, sections, legacy_raw? }
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

export async function migrateProjectCharterToV2(args: { projectId: string; artifactId: string }) {
  const projectId = safeParam(args.projectId);
  const artifactId = safeParam(args.artifactId);
  if (!projectId || !artifactId) throw new Error("Missing ids");

  const supabase = await createClient();

  // Auth (normal client)
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) throw new Error("Unauthorized");

  // Enforce membership + role using RLS-protected client
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
  if (!canEdit) throw new Error("Forbidden (viewers cannot migrate)");

  // Admin client for cross-table read/write (if your RLS blocks some columns)
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
    .select("id, project_id, type, content, content_json, approval_status, is_locked")
    .eq("id", artifactId)
    .maybeSingle();

  if (error) throw new Error(`[artifacts.select] ${error.code} ${error.message}`);
  if (!artifact) throw new Error("Artifact not found");
  if (String(artifact.project_id) !== projectId) throw new Error("Project mismatch");

  // Optional: don't migrate if locked/submitted/approved/rejected
  const approvalStatus = String((artifact as any).approval_status ?? "draft").toLowerCase();
  const isLocked = !!(artifact as any).is_locked;
  const canWriteStatus = approvalStatus === "draft" || approvalStatus === "changes_requested";
  if (isLocked || !canWriteStatus) {
    throw new Error("Artifact is locked or not editable in current status");
  }

  const raw = (artifact as any).content_json ?? (artifact as any).content ?? null;

  // migrateCharterAnyToV2 may return various shapes; canonicalize it for storage
  const migrated = migrateCharterAnyToV2({ raw, projectTitleFallback });
  const v2Stored = toStoredCharterV2(migrated);

  // IMPORTANT: artifacts.content is NOT NULL => never write null
  const { error: upErr } = await admin
    .from("artifacts")
    .update({
      content_json: v2Stored,
      // optional: clear legacy to force all exports use content_json
      content: "",
    })
    .eq("id", artifactId)
    .eq("project_id", projectId);

  if (upErr) throw new Error(`[artifacts.update] ${upErr.code} ${upErr.message}`);

  revalidatePath(`/projects/${projectId}/artifacts/${artifactId}`);
  revalidatePath(`/projects/${projectId}/artifacts`);
  revalidatePath(`/projects/${projectId}`);

  // Return canonical (useful for client to setDoc)
  return v2Stored;
}
