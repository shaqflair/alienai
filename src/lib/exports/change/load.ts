import "server-only";
import { createClient } from "@/utils/supabase/server";

const CHANGE_TABLE = "change_requests";
const BUCKET = process.env.CHANGE_ATTACHMENTS_BUCKET || "change_attachments";

function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x);
}

function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  // Prefer removed_at model (if present)
  {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role, removed_at")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!memErr) {
      if (!mem) throw new Error("Forbidden");
      return { userId: auth.user.id, role: String((mem as any).role ?? "viewer") };
    }

    if (memErr && !looksMissingColumn(memErr)) {
      // fall through
    }
  }

  // Fallback: is_active model
  {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("role,is_active")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (memErr) throw new Error(memErr.message);
    if (!mem?.is_active) throw new Error("Forbidden");
    return { userId: auth.user.id, role: String((mem as any).role ?? "viewer") };
  }
}

/** Try to extract a nicer attachment filename if you store "prefix__filename.ext" */
function filenameFromStorageObjectName(objName: string) {
  const n = safeStr(objName);
  const idx = n.indexOf("__");
  return idx >= 0 ? n.slice(idx + 2) : n || "Attachment";
}

export async function loadChangeExportData(changeId: string) {
  const supabase = await createClient();

  // Auth (and keep userId for any later auditing if needed)
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  // Load change request
  const { data: cr, error } = await supabase
    .from(CHANGE_TABLE)
    .select("*")
    .eq("id", changeId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!cr) {
    const e = new Error("Change request not found");
    (e as any).status = 404;
    throw e;
  }

  const projectId = safeStr((cr as any).project_id);
  if (!projectId) throw new Error("Change request missing project_id");

  // ? Membership check (prevents exporting other project’s CRs)
  await requireAuthAndMembership(supabase, projectId);

  // Load project meta
  const { data: project, error: pErr } = await supabase
    .from("projects")
    .select("id, title, project_code, client_name, organisation_id, brand_primary_color")
    .eq("id", projectId)
    .maybeSingle();

  if (pErr) throw new Error(pErr.message);

  // Load organisation meta (best-effort)
  let organisation: any = null;
  const orgId = safeStr(project?.organisation_id);
  if (orgId) {
    const { data: org, error: oErr } = await supabase
      .from("organisations")
      .select("id, name, logo_url")
      .eq("id", orgId)
      .maybeSingle();
    if (!oErr) organisation = org;
  }

  // ? Attachments: align to your XLSX exporter storage path (change/{changeId})
  let attachments: Array<{ name: string; url: string }> = [];
  try {
    const { data: listed, error: listErr } = await supabase.storage.from(BUCKET).list(`change/${changeId}`, { limit: 100 });
    if (!listErr && listed?.length) {
      attachments = listed.map((o: any) => {
        const objPath = `change/${changeId}/${o.name}`;
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(objPath);
        return { name: filenameFromStorageObjectName(o.name), url: data.publicUrl };
      });
    }
  } catch {
    // ignore
  }

  // Branding (prefer org/project, fallback to CR fields if your schema has them)
  const branding = {
    orgName:
      safeStr(organisation?.name) ||
      safeStr((cr as any).org_name ?? (cr as any).organisation_name) ||
      null,
    clientName: safeStr(project?.client_name) || safeStr((cr as any).client_name) || null,
    logoUrl:
      safeStr(organisation?.logo_url) ||
      safeStr((cr as any).org_logo_url ?? (cr as any).logo_url) ||
      null,
    brandPrimaryColor: safeStr(project?.brand_primary_color) || null,
    projectCode: safeStr(project?.project_code) || null,
    projectTitle: safeStr(project?.title) || null,
  };

  return {
    cr: cr as Record<string, any>,
    attachments,
    branding,
    project,
    organisation,
  };
}
