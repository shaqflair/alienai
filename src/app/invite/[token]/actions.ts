"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export async function acceptInviteAction(formData: FormData) {
  const token = safeParam(formData.get("token")).trim();
  if (!token) redirect("/");

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);

  // Atomic accept
  const { data, error } = await supabase.rpc("rpc_accept_project_invite_by_token", {
    p_token: token,
  });

  if (error) {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent(error.message)}`);
  }

  const projectId = String(data ?? "");
  if (!projectId) {
    redirect(`/invite/${encodeURIComponent(token)}?error=${encodeURIComponent("Invite accepted but no project returned.")}`);
  }

  revalidatePath(`/projects/${projectId}`);
  revalidatePath(`/projects/${projectId}/members`);
  revalidatePath(`/projects`);

  redirect(`/projects/${projectId}?accepted=1`);
}
