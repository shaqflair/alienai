"use server";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export async function setActiveOrgAction(formData: FormData) {
  const orgId = String(formData.get("org_id") ?? "").trim();
  if (!orgId) return;

  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw new Error(sbErrText(authErr));
  if (!auth?.user) redirect("/login");

  const { data: member, error } = await sb
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", auth.user.id)
    .eq("organisation_id", orgId)
    .maybeSingle();

  if (error) throw new Error(sbErrText(error));
  if (!member) throw new Error("You are not a member of that organisation.");

  cookies().set("active_org_id", orgId, {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });

  redirect("/settings");
}
