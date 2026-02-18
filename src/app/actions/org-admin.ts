"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

type OrgRole = "owner" | "admin" | "member"; // align with DB (recommended)

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message; // Supabase/PostgREST
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr) throw new Error(sbErrText(authErr));
  if (!user) redirect("/login");
  return { supabase, user };
}

async function requireOrgAdmin(supabase: any, userId: string, organisationId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(sbErrText(error));

  const role = (String(data?.role ?? "").trim().toLowerCase() as OrgRole) || "member";
  if (!(role === "owner" || role === "admin")) {
    throw new Error("Admin permission required");
  }
}

export async function createOrganisation(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const { supabase, user } = await requireUser();

  // 1) create org
  const { data: org, error } = await supabase
    .from("organisations")
    .insert({ name, created_by: user.id })
    .select("id")
    .single();

  if (error) throw new Error(sbErrText(error));
  if (!org?.id) throw new Error("Failed to create organisation (missing id).");

  // 2) ensure creator is OWNER member (recommended)
  const { error: memErr } = await supabase.from("organisation_members").insert({
    organisation_id: org.id,
    user_id: user.id,
    role: "owner",
  });

  if (memErr) throw new Error(sbErrText(memErr));
}

export async function renameOrganisation(formData: FormData) {
  const organisationId = String(formData.get("org_id") ?? formData.get("organisation_id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!organisationId || !name) return;

  const { supabase, user } = await requireUser();
  await requireOrgAdmin(supabase, user.id, organisationId);

  const { error } = await supabase.from("organisations").update({ name }).eq("id", organisationId);
  if (error) throw new Error(sbErrText(error));
}

export async function inviteToOrganisation(_: FormData) {
  // Keep this as a normal Error (already safe)
  throw new Error("Invites are currently disabled. Use direct member add instead.");
}
