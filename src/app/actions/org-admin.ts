"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type Role = "owner" | "editor" | "viewer";

async function requireUser() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return { supabase, user };
}

async function requireOwner(supabase: any, userId: string, orgId: string) {
  const { data } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();

  if (!data || String(data.role).toLowerCase() !== "owner") {
    throw new Error("Owner permission required");
  }
}

export async function createOrganisation(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const { supabase, user } = await requireUser();

  const { data: org, error } = await supabase
    .from("organizations")
    .insert({ name, created_by: user.id })
    .select("id")
    .single();

  if (error) throw error;

  const { error: memErr } = await supabase
    .from("org_members")
    .insert({ org_id: org.id, user_id: user.id, role: "owner" });

  if (memErr) throw memErr;
}

export async function renameOrganisation(formData: FormData) {
  const orgId = String(formData.get("org_id") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!orgId || !name) return;

  const { supabase, user } = await requireUser();
  await requireOwner(supabase, user.id, orgId);

  const { error } = await supabase
    .from("organizations")
    .update({ name })
    .eq("id", orgId);

  if (error) throw error;
}

export async function inviteToOrganisation(formData: FormData) {
  const orgId = String(formData.get("org_id") ?? "");
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role") ?? "viewer").toLowerCase() as Role;

  if (!orgId || !email) return;
  if (!["owner", "editor", "viewer"].includes(role)) throw new Error("Invalid role");

  const { supabase, user } = await requireUser();
  await requireOwner(supabase, user.id, orgId);

  const { error } = await supabase
    .from("org_invites")
    .insert({
      org_id: orgId,
      email,
      role,
      invited_by: user.id,
      status: "pending",
    });

  if (error) throw error;
}
