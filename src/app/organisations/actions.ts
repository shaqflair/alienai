"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

export async function createOrganisation(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) redirect("/login");

  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .insert({ name })
    .select("id")
    .single();

  if (orgErr) throw orgErr;

  const { error: memErr } = await sb
    .from("organisation_members")
    .insert({ organisation_id: org.id, user_id: auth.user.id, role: "admin" });

  if (memErr) throw memErr;

  redirect(`/organisations/${org.id}/settings`);
}
