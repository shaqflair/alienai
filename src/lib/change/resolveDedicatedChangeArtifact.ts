// src/lib/change/resolveDedicatedChangeArtifact.ts
import "server-only";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuidLike(v: unknown): boolean {
  const s = safeStr(v).trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

function isMissingColumnMessage(msg: string, col: string) {
  const m = safeStr(msg).toLowerCase();
  const c = safeStr(col).toLowerCase();
  return m.includes("column") && m.includes(c);
}

function isMissingRelationMessage(msg: string) {
  const m = safeStr(msg).toLowerCase();
  return m.includes("relation") && m.includes("does not exist");
}

async function hasColumn(supabase: any, table: string, column: string) {
  try {
    const { error } = await supabase.from(table).select(column).limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function loadChangeRowSafe(
  supabase: any,
  changeId: string
): Promise<{
  id: string;
  project_id: string;
  artifact_id: string | null;
  title: string;
  organisation_id?: string | null;
  organization_id?: string | null;
} | null> {
  try {
    const { data, error } = await supabase
      .from("change_requests")
      .select("id, project_id, artifact_id, title")
      .eq("id", changeId)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: safeStr((data as any)?.id).trim(),
      project_id: safeStr((data as any)?.project_id).trim(),
      artifact_id: safeStr((data as any)?.artifact_id).trim() || null,
      title: safeStr((data as any)?.title).trim() || "Change Request",
    };
  } catch {
    return null;
  }
}

async function loadProjectMetaSafe(
  supabase: any,
  projectId: string
): Promise<{
  ownerUserId: string | null;
  organisationId: string | null;
} | null> {
  try {
    const first = await supabase
      .from("projects")
      .select("created_by, owner_id, user_id, organisation_id")
      .eq("id", projectId)
      .maybeSingle();

    if (!first.error && first.data) {
      return {
        ownerUserId:
          safeStr((first.data as any)?.created_by).trim() ||
          safeStr((first.data as any)?.owner_id).trim() ||
          safeStr((first.data as any)?.user_id).trim() ||
          null,
        organisationId: safeStr((first.data as any)?.organisation_id).trim() || null,
      };
    }

    if (
      first.error &&
      !isMissingColumnMessage(first.error.message, "organisation_id")
    ) {
      return null;
    }

    const second = await supabase
      .from("projects")
      .select("created_by, owner_id, user_id, organization_id")
      .eq("id", projectId)
      .maybeSingle();

    if (second.error || !second.data) return null;

    return {
      ownerUserId:
        safeStr((second.data as any)?.created_by).trim() ||
        safeStr((second.data as any)?.owner_id).trim() ||
        safeStr((second.data as any)?.user_id).trim() ||
        null,
      organisationId: safeStr((second.data as any)?.organization_id).trim() || null,
    };
  } catch {
    return null;
  }
}

async function getArtifactByIdSafe(
  supabase: any,
  artifactId: string
): Promise<{
  id: string;
  type: string | null;
  title: string | null;
  project_id: string | null;
} | null> {
  const id = safeStr(artifactId).trim();
  if (!id) return null;

  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select("id, type, title, project_id")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;

    return {
      id: safeStr((data as any)?.id).trim(),
      type: safeStr((data as any)?.type).trim() || null,
      title: safeStr((data as any)?.title).trim() || null,
      project_id: safeStr((data as any)?.project_id).trim() || null,
    };
  } catch {
    return null;
  }
}

async function countOtherChangesLinkedToArtifact(
  supabase: any,
  artifactId: string,
  changeId: string
): Promise<number> {
  const aid = safeStr(artifactId).trim();
  const cid = safeStr(changeId).trim();
  if (!aid || !cid) return 0;

  try {
    const { data, error } = await supabase
      .from("change_requests")
      .select("id")
      .eq("artifact_id", aid);

    if (error || !Array.isArray(data)) return 0;

    return data.filter((r: any) => safeStr(r?.id).trim() !== cid).length;
  } catch {
    return 0;
  }
}

async function tryAttachArtifactToChange(
  supabase: any,
  changeId: string,
  artifactId: string
): Promise<boolean> {
  try {
    const { error } = await supabase
      .from("change_requests")
      .update({ artifact_id: artifactId })
      .eq("id", changeId);

    return !error;
  } catch {
    return false;
  }
}

async function tryCreateArtifact(
  supabase: any,
  payload: Record<string, any>
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .insert(payload)
      .select("id")
      .single();

    if (!error && data?.id) return String(data.id);
  } catch {}
  return null;
}

function buildContentStub(change: { id: string; title: string; project_id: string }) {
  return {
    version: 1,
    type: "change",
    change_request_id: change.id,
    title: change.title,
    project_id: change.project_id,
    sections: [],
  };
}

export async function ensureDedicatedArtifactIdForChangeRequest(
  supabase: any,
  cr: any
): Promise<string | null> {
  const changeId = safeStr(cr?.id).trim();
  const projectId = safeStr(cr?.project_id).trim();

  if (!changeId || !projectId) return null;

  const latestCr =
    (await loadChangeRowSafe(supabase, changeId)) || {
      id: changeId,
      project_id: projectId,
      artifact_id: safeStr(cr?.artifact_id).trim() || null,
      title: safeStr(cr?.title).trim() || "Change Request",
    };

  const currentArtifactId = safeStr(latestCr.artifact_id ?? cr?.artifact_id).trim();

  // 1) Reuse only if the currently linked artifact is already dedicated to THIS change.
  if (currentArtifactId) {
    const artifact = await getArtifactByIdSafe(supabase, currentArtifactId);
    const linkedElsewhere = await countOtherChangesLinkedToArtifact(
      supabase,
      currentArtifactId,
      changeId
    );

    const artifactType = safeStr(artifact?.type).trim().toLowerCase();
    const validType =
      artifactType === "change" ||
      artifactType === "change_request" ||
      artifactType === "change_requests";

    if (
      artifact?.id &&
      validType &&
      (!artifact.project_id || artifact.project_id === projectId) &&
      linkedElsewhere === 0
    ) {
      return artifact.id;
    }
  }

  // 2) NEVER scan project artifacts and "pick one".
  // That is exactly how multiple CRs got bound to one shared artifact.
  // From here onward we create a new dedicated artifact for this CR.

  const projectMeta = await loadProjectMetaSafe(supabase, projectId);
  const ownerUserId = safeStr(projectMeta?.ownerUserId).trim();

  if (!ownerUserId) return null;

  const organisationId = safeStr(projectMeta?.organisationId).trim() || null;
  const changeTitle = safeStr(latestCr.title).trim() || "Change Request";

  const supportsArtifactType = await hasColumn(supabase, "artifacts", "artifact_type");
  const supportsIsCurrent = await hasColumn(supabase, "artifacts", "is_current");
  const supportsSourceRecordId = await hasColumn(supabase, "artifacts", "source_record_id");
  const supportsOrganisationId = await hasColumn(supabase, "artifacts", "organisation_id");
  const supportsOrganizationId = !supportsOrganisationId
    ? await hasColumn(supabase, "artifacts", "organization_id")
    : false;
  const supportsContent = await hasColumn(supabase, "artifacts", "content");

  const base: Record<string, any> = {
    project_id: projectId,
    type: "change",
    title: changeTitle,
    status: "draft",
    user_id: ownerUserId,
  };

  if (supportsArtifactType) base.artifact_type = "change";
  if (supportsIsCurrent) base.is_current = true;
  if (supportsSourceRecordId) base.source_record_id = changeId;
  if (supportsOrganisationId && organisationId) base.organisation_id = organisationId;
  if (supportsOrganizationId && organisationId) base.organization_id = organisationId;
  if (supportsContent) base.content = buildContentStub({ id: changeId, title: changeTitle, project_id: projectId });

  const payloads: Record<string, any>[] = [
    { ...base },
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== "source_record_id")),
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== "artifact_type")),
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== "content")),
    {
      project_id: projectId,
      type: "change",
      title: changeTitle,
      status: "draft",
      user_id: ownerUserId,
    },
  ];

  let createdId: string | null = null;

  for (const payload of payloads) {
    createdId = await tryCreateArtifact(supabase, payload);
    if (createdId) break;
  }

  if (!createdId || !isUuidLike(createdId)) return null;

  const attached = await tryAttachArtifactToChange(supabase, changeId, createdId);
  if (!attached) return null;

  // 3) Final safety check: if somehow another CR is also linked to this artifact, fail closed.
  const linkedElsewhere = await countOtherChangesLinkedToArtifact(supabase, createdId, changeId);
  if (linkedElsewhere > 0) {
    return null;
  }

  return createdId;
}