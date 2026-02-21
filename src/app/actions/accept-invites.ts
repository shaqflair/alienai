"use server";

import { createClient } from "@/utils/supabase/server";

export async function acceptInvitesForCurrentUser() {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return { ok: false, claimed: 0, error: authErr.message };
  if (!auth?.user) return { ok: true, claimed: 0 };

  const { data, error } = await supabase.rpc("rpc_claim_project_invites_for_me");

  if (error) return { ok: false, claimed: 0, error: error.message };

  // data is jsonb -> comes back as object
  const claimed = Number((data as any)?.claimed ?? 0);
  const projects = (data as any)?.projects ?? [];

  return { ok: true, claimed, projects };
}
