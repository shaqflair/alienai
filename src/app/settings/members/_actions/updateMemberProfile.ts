"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export type UpdateMemberInput = {
  targetUserId:    string;
  full_name:       string;
  job_title:       string;
  line_manager_id: string | null;
  org_role:        "owner" | "admin" | "member";
};

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function updateMemberProfile(
  input: UpdateMemberInput
): Promise<ActionResult> {
  try {
    const supabase = await createClient();

    // Verify caller is authenticated
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: "Not authenticated" };

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return { ok: false, error: "No active organisation" };

    // Verify caller is admin or owner
    const { data: myMem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", String(orgId))
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();

    const myRole = safeStr(myMem?.role).toLowerCase();
    if (myRole !== "admin" && myRole !== "owner") {
      return { ok: false, error: "Insufficient permissions" };
    }

    // Prevent demoting the last owner
    if (input.org_role !== "owner") {
      const { count } = await supabase
        .from("organisation_members")
        .select("id", { count: "exact", head: true })
        .eq("organisation_id", String(orgId))
        .eq("role", "owner")
        .is("removed_at", null);

      const { data: targetMem } = await supabase
        .from("organisation_members")
        .select("role")
        .eq("organisation_id", String(orgId))
        .eq("user_id", input.targetUserId)
        .is("removed_at", null)
        .maybeSingle();

      if (
        safeStr(targetMem?.role).toLowerCase() === "owner" &&
        (count ?? 0) <= 1
      ) {
        return { ok: false, error: "Cannot demote the last owner" };
      }
    }

    // 1. Update the profile
    const profilePatch: Record<string, unknown> = {
      full_name: input.full_name.trim(),
      job_title: input.job_title.trim() || null,
      line_manager_id: input.line_manager_id || null,
    };

    const { error: profErr } = await supabase
      .from("profiles")
      .update(profilePatch)
      .eq("user_id", input.targetUserId);

    if (profErr) {
      console.error("Profile update error:", profErr);
      return { ok: false, error: profErr.message };
    }

    // 2. Update the org role
    const { error: roleErr } = await supabase
      .from("organisation_members")
      .update({ role: input.org_role })
      .eq("organisation_id", String(orgId))
      .eq("user_id", input.targetUserId)
      .is("removed_at", null);

    if (roleErr) {
      console.error("Role update error:", roleErr);
      return { ok: false, error: roleErr.message };
    }

    revalidatePath("/settings/members");
    // Keep profiles table in sync so rate lookups work
  await supabase
    .from("profiles")
    .update({ job_title: input.job_title.trim() || null })
    .eq("user_id", input.user_id);

  return { ok: true };
  } catch (err: unknown) {
    console.error("updateMemberProfile error:", err);
    return { ok: false, error: "Unexpected error" };
  }
}
