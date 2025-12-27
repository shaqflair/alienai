"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { sendProjectInviteEmail } from "@/lib/email/sendProjectInvite";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function normalizeEmail(x: unknown): string {
  return safeParam(x).trim().toLowerCase();
}

function isEmail(x: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(x);
}

function requireOrigin() {
  const origin =
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL;

  if (!origin) {
    throw new Error(
      "Missing APP_ORIGIN (recommended) or NEXT_PUBLIC_APP_ORIGIN/NEXT_PUBLIC_APP_URL in env"
    );
  }
  return origin.replace(/\/+$/, "");
}

type Role = "owner" | "editor" | "viewer";

export async function inviteMemberAction(formData: FormData) {
  const supabase = await createClient();

  // Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const projectId = safeParam(formData.get("projectId"));
  const email = normalizeEmail(formData.get("email"));
  const role = (safeParam(formData.get("role")) || "viewer").toLowerCase() as Role;

  if (!projectId) redirect("/projects");

  if (!email || !isEmail(email)) {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(
        "Enter a valid email."
      )}`
    );
  }

  // Owner-only (UX check; RLS should also enforce)
  const { data: me, error: meErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (meErr) {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(meErr.message)}`
    );
  }

  const myRole = String(me?.role ?? "viewer").toLowerCase();
  if (myRole !== "owner") {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(
        "Only project owners can invite members."
      )}`
    );
  }

  // Prevent self-invite
  if ((auth.user.email ?? "").toLowerCase() === email) {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(
        "You cannot invite yourself."
      )}`
    );
  }

  // Throttle: avoid rapid resend clicks that trigger provider filtering
  const { data: recentInvite, error: recentErr } = await supabase
    .from("project_invites")
    .select("created_at")
    .eq("project_id", projectId)
    .eq("email", email)
    .eq("status", "pending")
    .is("accepted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (recentErr) {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(
        recentErr.message
      )}`
    );
  }

  if (recentInvite?.created_at) {
    const ageMs = Date.now() - new Date(recentInvite.created_at).getTime();
    if (!Number.isNaN(ageMs) && ageMs < 60_000) {
      redirect(
        `/projects/${projectId}/members/invite?error=${encodeURIComponent(
          "Invite was sent recently. Please wait a minute and try again."
        )}`
      );
    }
  }

  // Create / ensure invite exists (handle "already invited" nicely)
  const { error: insErr } = await supabase.from("project_invites").insert({
    project_id: projectId,
    email,
    role,
    invited_by: auth.user.id,
  });

  // If it's a unique constraint error, we continue (we'll just resend).
  // Postgres unique violation is 23505.
  const code = String((insErr as any)?.code ?? "");
  if (insErr && code !== "23505") {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(insErr.message)}`
    );
  }

  // Fetch project title for email (optional but nice)
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("title")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr) {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(projErr.message)}`
    );
  }

  // Mint/return token via your RPC (source of truth)
  const { data: tokData, error: tokErr } = await supabase.rpc(
    "rpc_invite_project_member_token",
    {
      p_project_id: projectId,
      p_email: email,
      p_role: role,
    }
  );

  if (tokErr) {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(tokErr.message)}`
    );
  }

  const token = typeof tokData === "string" ? tokData : "";
  if (!token) {
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(
        "Invite token was not returned."
      )}`
    );
  }

  const origin = requireOrigin();
  const inviteUrl = `${origin}/invite/${encodeURIComponent(token)}`;

  // Send email
  try {
    await sendProjectInviteEmail({
      to: email,
      projectTitle: project?.title || "a project",
      inviterEmail: auth.user.email ?? null,
      inviteUrl,
    });
  } catch (e: any) {
    // Invite exists, but email failed — surface a clear message
    redirect(
      `/projects/${projectId}/members/invite?error=${encodeURIComponent(
        `Invite created but email failed: ${e?.message ?? "Unknown error"}`
      )}`
    );
  }

  // Ensure members page shows the new invite immediately
  revalidatePath(`/projects/${projectId}/members`);
  revalidatePath(`/projects/${projectId}/members/invite`);

  redirect(`/projects/${projectId}/members?invited=1`);
}
