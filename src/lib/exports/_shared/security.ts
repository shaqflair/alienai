import "server-only";

export function looksMissingColumn(err: any) {
  const msg = String(err?.message || err || "").toLowerCase();
  return msg.includes("column") && msg.includes("does not exist");
}

/**
 * Membership check (tolerant to schema differences).
 * Uses removed_at when present; falls back to is_active.
 */
export async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  // preferred: removed_at path
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

  // fallback: is_active path
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
