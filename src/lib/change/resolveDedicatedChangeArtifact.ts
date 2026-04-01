// src/lib/change/resolveDedicatedChangeArtifact.ts
import "server-only";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function hasColumn(supabase: any, table: string, column: string) {
  try {
    const { error } = await supabase.from(table).select(column).limit(1);
    return !error;
  } catch {
    return false;
  }
}

async function loadChangeTitleSafe(supabase: any, changeId: string): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("change_requests")
      .select("title")
      .eq("id", changeId)
      .maybeSingle();

    if (!error) {
      return safeStr((data as any)?.title).trim() || "Change Request";
    }
  } catch {}
  return "Change Request";
}

async function loadProjectOwnerSafe(supabase: any, projectId: string): Promise<string | null> {
  try {
    const { data } = await supabase
      .from("projects")
      .select("created_by, owner_id, user_id")
      .eq("id", projectId)
      .maybeSingle();

    return (
      safeStr((data as any)?.created_by).trim() ||
      safeStr((data as any)?.owner_id).trim() ||
      safeStr((data as any)?.user_id).trim() ||
      null
    );
  } catch {
    return null;
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

export async function ensureDedicatedArtifactIdForChangeRequest(
  supabase: any,
  cr: any
): Promise<string | null> {
  const current = safeStr(cr?.artifact_id).trim();
  const projectId = safeStr(cr?.project_id).trim();
  const changeId = safeStr(cr?.id).trim();

  if (!projectId || !changeId) return null;

  // 1) existing linked artifact
  if (current) {
    try {
      const { data, error } = await supabase
        .from("artifacts")
        .select("id, type")
        .eq("id", current)
        .maybeSingle();

      if (!error && data?.id) {
        const type = safeStr((data as any)?.type).trim().toLowerCase();
        if (type === "change" || type === "change_request" || type === "change_requests") {
          return String(data.id);
        }
      }
    } catch {}
  }

  // 2) find existing per-project change artifact rows
  try {
    const { data, error } = await supabase
      .from("artifacts")
      .select("id, type, title, created_at")
      .eq("project_id", projectId)
      .in("type", ["change", "change_request", "change_requests"])
      .order("created_at", { ascending: false })
      .limit(25);

    if (!error && Array.isArray(data) && data.length) {
      const changeTitle = (await loadChangeTitleSafe(supabase, changeId)).toLowerCase();
      const exact = data.find((r: any) => safeStr(r?.title).trim().toLowerCase() === changeTitle);
      const fallback =
        exact || data.find((r: any) => safeStr(r?.type).trim().toLowerCase() === "change");

      if (fallback?.id) {
        const resolved = String(fallback.id);
        try {
          await supabase.from("change_requests").update({ artifact_id: resolved }).eq("id", changeId);
        } catch {}
        return resolved;
      }
    }
  } catch {}

  // 3) create a new dedicated artifact with minimal/fallback payloads
  const ownerUserId = await loadProjectOwnerSafe(supabase, projectId);
  if (!ownerUserId) return null;

  const changeTitle = await loadChangeTitleSafe(supabase, changeId);

  const supportsArtifactType = await hasColumn(supabase, "artifacts", "artifact_type");
  const supportsIsCurrent = await hasColumn(supabase, "artifacts", "is_current");
  const supportsSourceRecordId = await hasColumn(supabase, "artifacts", "source_record_id");

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

  const payloads: Record<string, any>[] = [
    { ...base },
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== "source_record_id")),
    Object.fromEntries(Object.entries(base).filter(([k]) => k !== "artifact_type")),
    {
      project_id: projectId,
      type: "change",
      title: changeTitle,
      status: "draft",
      user_id: ownerUserId,
    },
    {
      project_id: projectId,
      type: "change_requests",
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

  if (!createdId) return null;

  // 4) attach back to CR if possible
  try {
    await supabase.from("change_requests").update({ artifact_id: createdId }).eq("id", changeId);
  } catch {}

  return createdId;
}