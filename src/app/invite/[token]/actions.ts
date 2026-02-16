"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function extractProjectId(data: any): string {
  // allow: "uuid" | { project_id } | [{ project_id }]
  if (typeof data === "string") return data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const v = (data as any).project_id ?? (data as any).projectId ?? "";
    return typeof v === "string" ? v : "";
  }
  if (Array.isArray(data) && data[0]) {
    const v = (data[0] as any).project_id ?? (data[0] as any).projectId ?? "";
    return typeof v === "string" ? v : "";
  }
  return "";
}

export async function acceptInviteAction(formData: FormData) {
  const token = safeParam(formData.get("token")).trim();
  if (!token) redirect("/");

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(authErr.message)}`);
  }
  if (!auth?.user) {
    redirect(`/login?next=${encodeURIComponent(`/invite/${encodeURIComponent(token)}`)}`);
  }

  // Atomic accept (DB must enforce: pending + not expired + email match (optional) + mark accepted)
  const { data, error } = await supabase.rpc("rpc_accept_project_invite_by_token", {
    p_token: token,
  });

  if (error) {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(error.message)}`);
  }

  const projectId = extractProjectId(data).trim();
  if (!projectId || !isUuid(projectId)) {
    redirect(
      `/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(
        "Invite accepted but no valid project was returned."
      )}`
    );
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/members`);
  revalidatePath(`/projects`);

  redirect(`/projects/${projectId}?accepted=1`);
}
