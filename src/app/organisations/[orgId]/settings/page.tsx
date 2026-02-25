async function requireOrgAdmin(sb: any, organisationId: string, userId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, role: null as any };

  const r = String(data.role || "").toLowerCase();
  return { ok: r === "admin" || r === "owner", role: data.role };
}