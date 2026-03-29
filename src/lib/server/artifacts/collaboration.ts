import "server-only";

import crypto from "node:crypto";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const ARTIFACT_LOCK_TTL_SECONDS = 120;
export const ARTIFACT_LOCK_REFRESH_SECONDS = 45;

type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json }
  | Json[];

export type ArtifactLockInfo = {
  sessionId: string;
  artifactId: string;
  userId: string;
  editorName: string | null;
  acquiredAt: string;
  lastHeartbeatAt: string;
  expiresAt: string;
  isMine: boolean;
  isExpired: boolean;
};

export type ArtifactLockState = {
  artifactId: string;
  title: string;
  status: string;
  artifactType: string;
  projectId: string;
  organisationId: string;
  currentDraftRev: number;
  currentVersionNo: number;
  canEditByStatus: boolean;
  activeLock: ArtifactLockInfo | null;
  readOnlyReason: string | null;
};

export type AcquireLockResult =
  | {
      ok: true;
      artifact: ArtifactLockState;
      lock: ArtifactLockInfo;
    }
  | {
      ok: false;
      artifact: ArtifactLockState;
      reason: "locked_by_other" | "approval_locked" | "not_found" | "forbidden";
    };

export type RefreshLockResult =
  | { ok: true; lock: ArtifactLockInfo }
  | { ok: false; reason: "expired" | "not_owner" | "not_found" };

export type ReleaseLockResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_owner" };

export type SaveDraftInput = {
  artifactId: string;
  title: string;
  content: Json;
  sessionId: string;
  clientDraftRev: number;
  autosave?: boolean;
  summary?: string | null;
};

export type SaveDraftResult =
  | {
      ok: true;
      currentDraftRev: number;
      updatedAt: string;
    }
  | {
      ok: false;
      reason:
        | "not_found"
        | "not_owner"
        | "stale_revision"
        | "approval_locked"
        | "invalid_payload";
      serverDraftRev?: number;
      message: string;
    };

export type CreateVersionInput = {
  artifactId: string;
  source:
    | "manual_save"
    | "autosave_checkpoint"
    | "submitted_for_approval"
    | "approved"
    | "restored"
    | "system";
  summary?: string | null;
  approvalChainId?: string | null;
  editSessionId?: string | null;
};

export type CreateVersionResult = {
  id: string;
  versionNo: number;
  createdAt: string;
};

function plusSecondsIso(seconds: number) {
  return new Date(Date.now() + seconds * 1000).toISOString();
}

function isApprovalLockedStatus(status: string | null | undefined) {
  const s = String(status || "").trim().toLowerCase();
  return (
    s === "submitted" ||
    s === "submitted_for_approval" ||
    s === "pending_approval" ||
    s === "in_review" ||
    s === "awaiting_approval" ||
    s === "approved"
  );
}

function normalizeJson(value: unknown): Json {
  if (value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(normalizeJson);
  if (typeof value === "object") {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeJson(v);
    }
    return out;
  }
  return String(value);
}

async function getCurrentUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user) return null;
  return data.user;
}

async function getCurrentUserDisplayName(userId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("full_name, email")
    .eq("id", userId)
    .maybeSingle();

  return (
    data?.full_name ||
    data?.email ||
    "Another editor"
  );
}

async function releaseExpiredSessionsForArtifact(artifactId: string) {
  const admin = createAdminClient();
  await admin
    .from("artifact_edit_sessions")
    .update({
      released_at: new Date().toISOString(),
      release_reason: "expired",
    })
    .eq("artifact_id", artifactId)
    .is("released_at", null)
    .lte("expires_at", new Date().toISOString());
}

async function readArtifactBase(artifactId: string) {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("artifacts")
    .select(
      `
      id,
      title,
      status,
      artifact_type,
      project_id,
      organisation_id,
      current_draft_rev,
      current_version_no
    `
    )
    .eq("id", artifactId)
    .maybeSingle();

  if (error || !data) return null;
  return data;
}

async function readActiveSession(artifactId: string) {
  const admin = createAdminClient();
  const { data } = await admin
    .from("artifact_edit_sessions")
    .select(
      `
      id,
      artifact_id,
      user_id,
      editor_name,
      acquired_at,
      last_heartbeat_at,
      expires_at
    `
    )
    .eq("artifact_id", artifactId)
    .is("released_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("last_heartbeat_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return data || null;
}

function buildLockState(params: {
  artifact: {
    id: string;
    title: string | null;
    status: string | null;
    artifact_type: string | null;
    project_id: string;
    organisation_id: string;
    current_draft_rev: number | null;
    current_version_no: number | null;
  };
  activeSession: any | null;
  currentUserId: string | null;
}): ArtifactLockState {
  const { artifact, activeSession, currentUserId } = params;
  const canEditByStatus = !isApprovalLockedStatus(artifact.status);

  const activeLock: ArtifactLockInfo | null = activeSession
    ? {
        sessionId: activeSession.id,
        artifactId: artifact.id,
        userId: activeSession.user_id,
        editorName: activeSession.editor_name || null,
        acquiredAt: activeSession.acquired_at,
        lastHeartbeatAt: activeSession.last_heartbeat_at,
        expiresAt: activeSession.expires_at,
        isMine: !!currentUserId && activeSession.user_id === currentUserId,
        isExpired:
          new Date(activeSession.expires_at).getTime() <= Date.now(),
      }
    : null;

  let readOnlyReason: string | null = null;
  if (!canEditByStatus) readOnlyReason = "This artifact is locked by approval status.";
  else if (activeLock && !activeLock.isMine) {
    readOnlyReason = `Locked by ${activeLock.editorName || "another editor"}.`;
  }

  return {
    artifactId: artifact.id,
    title: artifact.title || "",
    status: artifact.status || "draft",
    artifactType: artifact.artifact_type || "",
    projectId: artifact.project_id,
    organisationId: artifact.organisation_id,
    currentDraftRev: Number(artifact.current_draft_rev || 0),
    currentVersionNo: Number(artifact.current_version_no || 0),
    canEditByStatus,
    activeLock,
    readOnlyReason,
  };
}

export async function getArtifactCollaborationState(
  artifactId: string
): Promise<ArtifactLockState | null> {
  await releaseExpiredSessionsForArtifact(artifactId);

  const user = await getCurrentUser();
  const artifact = await readArtifactBase(artifactId);
  if (!artifact) return null;

  const activeSession = await readActiveSession(artifactId);
  return buildLockState({
    artifact,
    activeSession,
    currentUserId: user?.id || null,
  });
}

export async function acquireArtifactLock(
  artifactId: string
): Promise<AcquireLockResult> {
  await releaseExpiredSessionsForArtifact(artifactId);

  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      artifact: {
        artifactId,
        title: "",
        status: "",
        artifactType: "",
        projectId: "",
        organisationId: "",
        currentDraftRev: 0,
        currentVersionNo: 0,
        canEditByStatus: false,
        activeLock: null,
        readOnlyReason: "Authentication required.",
      },
      reason: "forbidden",
    };
  }

  const artifact = await readArtifactBase(artifactId);
  if (!artifact) {
    return {
      ok: false,
      artifact: {
        artifactId,
        title: "",
        status: "",
        artifactType: "",
        projectId: "",
        organisationId: "",
        currentDraftRev: 0,
        currentVersionNo: 0,
        canEditByStatus: false,
        activeLock: null,
        readOnlyReason: "Artifact not found.",
      },
      reason: "not_found",
    };
  }

  const activeSession = await readActiveSession(artifactId);
  const artifactState = buildLockState({
    artifact,
    activeSession,
    currentUserId: user.id,
  });

  if (!artifactState.canEditByStatus) {
    return {
      ok: false,
      artifact: artifactState,
      reason: "approval_locked",
    };
  }

  if (activeSession && activeSession.user_id !== user.id) {
    return {
      ok: false,
      artifact: artifactState,
      reason: "locked_by_other",
    };
  }

  const admin = createAdminClient();

  if (activeSession && activeSession.user_id === user.id) {
    const expiresAt = plusSecondsIso(ARTIFACT_LOCK_TTL_SECONDS);
    const { data: refreshed } = await admin
      .from("artifact_edit_sessions")
      .update({
        last_heartbeat_at: new Date().toISOString(),
        expires_at: expiresAt,
      })
      .eq("id", activeSession.id)
      .select(
        `
        id,
        artifact_id,
        user_id,
        editor_name,
        acquired_at,
        last_heartbeat_at,
        expires_at
      `
      )
      .single();

    const lock: ArtifactLockInfo = {
      sessionId: refreshed!.id,
      artifactId: refreshed!.artifact_id,
      userId: refreshed!.user_id,
      editorName: refreshed!.editor_name || null,
      acquiredAt: refreshed!.acquired_at,
      lastHeartbeatAt: refreshed!.last_heartbeat_at,
      expiresAt: refreshed!.expires_at,
      isMine: true,
      isExpired: false,
    };

    return {
      ok: true,
      artifact: buildLockState({
        artifact,
        activeSession: refreshed,
        currentUserId: user.id,
      }),
      lock,
    };
  }

  const editorName = await getCurrentUserDisplayName(user.id);
  const sessionKey = crypto.randomUUID();
  const expiresAt = plusSecondsIso(ARTIFACT_LOCK_TTL_SECONDS);

  const { data: created, error } = await admin
    .from("artifact_edit_sessions")
    .insert({
      artifact_id: artifact.id,
      project_id: artifact.project_id,
      organisation_id: artifact.organisation_id,
      user_id: user.id,
      editor_name: editorName,
      session_key: sessionKey,
      last_heartbeat_at: new Date().toISOString(),
      expires_at: expiresAt,
      metadata: {},
    })
    .select(
      `
      id,
      artifact_id,
      user_id,
      editor_name,
      acquired_at,
      last_heartbeat_at,
      expires_at
    `
    )
    .single();

  if (error || !created) {
    const latestState = await getArtifactCollaborationState(artifactId);
    return {
      ok: false,
      artifact:
        latestState ||
        buildLockState({
          artifact,
          activeSession,
          currentUserId: user.id,
        }),
      reason: "locked_by_other",
    };
  }

  const lock: ArtifactLockInfo = {
    sessionId: created.id,
    artifactId: created.artifact_id,
    userId: created.user_id,
    editorName: created.editor_name || null,
    acquiredAt: created.acquired_at,
    lastHeartbeatAt: created.last_heartbeat_at,
    expiresAt: created.expires_at,
    isMine: true,
    isExpired: false,
  };

  return {
    ok: true,
    artifact: buildLockState({
      artifact,
      activeSession: created,
      currentUserId: user.id,
    }),
    lock,
  };
}

export async function refreshArtifactLock(
  artifactId: string,
  sessionId: string
): Promise<RefreshLockResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: "not_owner" };

  await releaseExpiredSessionsForArtifact(artifactId);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("artifact_edit_sessions")
    .select(
      `
      id,
      artifact_id,
      user_id,
      editor_name,
      acquired_at,
      last_heartbeat_at,
      expires_at,
      released_at
    `
    )
    .eq("id", sessionId)
    .maybeSingle();

  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.user_id !== user.id) return { ok: false, reason: "not_owner" };
  if (existing.released_at) return { ok: false, reason: "expired" };
  if (new Date(existing.expires_at).getTime() <= Date.now()) {
    await admin
      .from("artifact_edit_sessions")
      .update({
        released_at: new Date().toISOString(),
        release_reason: "expired",
      })
      .eq("id", sessionId);
    return { ok: false, reason: "expired" };
  }

  const expiresAt = plusSecondsIso(ARTIFACT_LOCK_TTL_SECONDS);
  const { data: updated } = await admin
    .from("artifact_edit_sessions")
    .update({
      last_heartbeat_at: new Date().toISOString(),
      expires_at: expiresAt,
    })
    .eq("id", sessionId)
    .select(
      `
      id,
      artifact_id,
      user_id,
      editor_name,
      acquired_at,
      last_heartbeat_at,
      expires_at
    `
    )
    .single();

  return {
    ok: true,
    lock: {
      sessionId: updated!.id,
      artifactId: updated!.artifact_id,
      userId: updated!.user_id,
      editorName: updated!.editor_name || null,
      acquiredAt: updated!.acquired_at,
      lastHeartbeatAt: updated!.last_heartbeat_at,
      expiresAt: updated!.expires_at,
      isMine: true,
      isExpired: false,
    },
  };
}

export async function releaseArtifactLock(
  artifactId: string,
  sessionId: string,
  releaseReason = "released"
): Promise<ReleaseLockResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, reason: "not_owner" };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from("artifact_edit_sessions")
    .select("id, artifact_id, user_id, released_at")
    .eq("id", sessionId)
    .eq("artifact_id", artifactId)
    .maybeSingle();

  if (!existing) return { ok: false, reason: "not_found" };
  if (existing.user_id !== user.id) return { ok: false, reason: "not_owner" };

  await admin
    .from("artifact_edit_sessions")
    .update({
      released_at: new Date().toISOString(),
      release_reason: releaseReason,
    })
    .eq("id", sessionId);

  return { ok: true };
}

export async function saveArtifactDraft(
  input: SaveDraftInput
): Promise<SaveDraftResult> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      reason: "not_owner",
      message: "Authentication required.",
    };
  }

  const title = String(input.title || "").trim();
  const content = normalizeJson(input.content);

  if (!title) {
    return {
      ok: false,
      reason: "invalid_payload",
      message: "Title is required.",
    };
  }

  const admin = createAdminClient();

  await releaseExpiredSessionsForArtifact(input.artifactId);

  const { data: artifact } = await admin
    .from("artifacts")
    .select(
      `
      id,
      status,
      current_draft_rev,
      current_version_no
    `
    )
    .eq("id", input.artifactId)
    .maybeSingle();

  if (!artifact) {
    return {
      ok: false,
      reason: "not_found",
      message: "Artifact not found.",
    };
  }

  if (isApprovalLockedStatus(artifact.status)) {
    return {
      ok: false,
      reason: "approval_locked",
      message: "Artifact is locked while under approval.",
      serverDraftRev: Number(artifact.current_draft_rev || 0),
    };
  }

  const { data: session } = await admin
    .from("artifact_edit_sessions")
    .select("id, user_id, expires_at, released_at")
    .eq("id", input.sessionId)
    .eq("artifact_id", input.artifactId)
    .maybeSingle();

  if (!session) {
    return {
      ok: false,
      reason: "not_owner",
      message: "No active edit session found.",
      serverDraftRev: Number(artifact.current_draft_rev || 0),
    };
  }

  if (session.user_id !== user.id) {
    return {
      ok: false,
      reason: "not_owner",
      message: "Edit lock is owned by another user.",
      serverDraftRev: Number(artifact.current_draft_rev || 0),
    };
  }

  if (
    session.released_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    return {
      ok: false,
      reason: "not_owner",
      message: "Edit lock expired. Re-acquire the lock.",
      serverDraftRev: Number(artifact.current_draft_rev || 0),
    };
  }

  const serverDraftRev = Number(artifact.current_draft_rev || 0);
  if (Number(input.clientDraftRev) !== serverDraftRev) {
    return {
      ok: false,
      reason: "stale_revision",
      message:
        "Your draft is stale. Another save happened before this autosave.",
      serverDraftRev,
    };
  }

  const newDraftRev = serverDraftRev + 1;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("artifacts")
    .update({
      title,
      content,
      current_draft_rev: newDraftRev,
      updated_at: nowIso,
      updated_by: user.id,
      last_saved_by: user.id,
    })
    .eq("id", input.artifactId);

  if (updateError) {
    return {
      ok: false,
      reason: "invalid_payload",
      message: updateError.message,
      serverDraftRev,
    };
  }

  await admin
    .from("artifact_edit_sessions")
    .update({
      last_heartbeat_at: nowIso,
      expires_at: plusSecondsIso(ARTIFACT_LOCK_TTL_SECONDS),
    })
    .eq("id", input.sessionId);

  return {
    ok: true,
    currentDraftRev: newDraftRev,
    updatedAt: nowIso,
  };
}

export async function createArtifactVersionSnapshot(
  input: CreateVersionInput
): Promise<CreateVersionResult> {
  const user = await getCurrentUser();
  const admin = createAdminClient();

  const { data: artifact, error } = await admin
    .from("artifacts")
    .select(
      `
      id,
      project_id,
      organisation_id,
      artifact_type,
      status,
      title,
      content,
      current_version_no
    `
    )
    .eq("id", input.artifactId)
    .single();

  if (error || !artifact) {
    throw new Error("Artifact not found for version snapshot.");
  }

  const nextVersionNo = Number(artifact.current_version_no || 0) + 1;
  const snapshotPayload = {
    title: artifact.title || "",
    content: normalizeJson(artifact.content || {}),
    artifact_type: artifact.artifact_type || "",
    status: artifact.status || "",
    captured_at: new Date().toISOString(),
    source: input.source,
  };

  const checksum = crypto
    .createHash("sha256")
    .update(JSON.stringify(snapshotPayload))
    .digest("hex");

  const { data: created, error: insertError } = await admin
    .from("artifact_versions")
    .insert({
      artifact_id: artifact.id,
      project_id: artifact.project_id,
      organisation_id: artifact.organisation_id,
      artifact_type: artifact.artifact_type,
      artifact_status: artifact.status,
      title: artifact.title,
      version_no: nextVersionNo,
      source: input.source,
      snapshot: snapshotPayload,
      summary: input.summary || null,
      checksum,
      approval_chain_id: input.approvalChainId || null,
      edit_session_id: input.editSessionId || null,
      created_by: user?.id || null,
    })
    .select("id, version_no, created_at")
    .single();

  if (insertError || !created) {
    throw new Error(insertError?.message || "Failed to create version snapshot.");
  }

  const { error: updateArtifactError } = await admin
    .from("artifacts")
    .update({
      current_version_no: nextVersionNo,
      last_saved_version_id: created.id,
      updated_at: new Date().toISOString(),
      updated_by: user?.id || null,
      last_saved_by: user?.id || null,
    })
    .eq("id", artifact.id);

  if (updateArtifactError) {
    throw new Error(updateArtifactError.message);
  }

  return {
    id: created.id,
    versionNo: created.version_no,
    createdAt: created.created_at,
  };
}

export async function createApprovalSubmissionSnapshot(params: {
  artifactId: string;
  approvalChainId?: string | null;
  editSessionId?: string | null;
}) {
  return createArtifactVersionSnapshot({
    artifactId: params.artifactId,
    source: "submitted_for_approval",
    approvalChainId: params.approvalChainId || null,
    editSessionId: params.editSessionId || null,
    summary: "Immutable snapshot captured at approval submission.",
  });
}

export async function createApprovalApprovedSnapshot(params: {
  artifactId: string;
  approvalChainId?: string | null;
}) {
  return createArtifactVersionSnapshot({
    artifactId: params.artifactId,
    source: "approved",
    approvalChainId: params.approvalChainId || null,
    summary: "Immutable snapshot captured at final approval.",
  });
}
