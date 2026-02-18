import "server-only";
import { createClient } from "@/utils/supabase/server";

export async function requirePlatformAdmin() {
  const sb = await createClient();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Not authenticated");

  const { data: row, error } = await sb
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!row) throw new Error("Forbidden");

  return { user: auth.user };
}
