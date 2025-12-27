"use server";

import { createClient } from "@/utils/supabase/server";

export async function acceptInvitesForCurrentUser(opts?: { failFast?: boolean }) {
  const failFast = opts?.failFast ?? true;

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return { ok: false, claimed: 0, error: authErr.message };
  if (!auth?.user) return { ok: true, claimed: 0 };

  const emailRaw = (auth.user.email ?? "").trim();
  const email = emailRaw.toLowerCase();
  if (!email) return { ok: true, claimed: 0 };

  // NOTE: This assumes DB stores normalized lowercase email (recommended).
  // If not, consider moving this SELECT into a SECURITY DEFINER RPC that uses lower(email)=lower(jwt_email()).
  const { data: invites, error: invErr } = await supabase
    .from("project_invites")
    .select("project_id, expires_at, accepted_at, status, email")
    .eq("email", email)
    .is("accepted_at", null)
    .eq("status", "pending");

  if (invErr) {
    return { ok: false, claimed: 0, error: invErr.message };
  }

  const now = Date.now();

  const pending = (invites ?? []).filter((i) => {
    if (!i.project_id) return false;

    // extra defensive check: ensure this row really matches current user
    const rowEmail = String((i as any).email ?? "").trim().toLowerCase();
    if (rowEmail && rowEmail !== email) return false;

    if (i.expires_at) {
      const exp = new Date(i.expires_at as any).getTime();
      if (!Number.isNaN(exp) && exp <= now) return false;
    }
    return true;
  });

  if (pending.length === 0) return { ok: true, claimed: 0 };

  const projectIds = Array.from(new Set(pending.map((i) => i.project_id)));

  let claimed = 0;
  const errors: { projectId: string; error: string }[] = [];

  for (const projectId of projectIds) {
    const { error } = await supabase.rpc("rpc_accept_project_invite", {
      p_project_id: projectId,
    });

    if (error) {
      if (failFast) return { ok: false, claimed, error: error.message };
      errors.push({ projectId: String(projectId), error: error.message });
      continue;
    }

    claimed += 1;
  }

  if (errors.length) {
    return { ok: false, claimed, error: "Some invites failed to claim", errors };
  }

  return { ok: true, claimed };
}
