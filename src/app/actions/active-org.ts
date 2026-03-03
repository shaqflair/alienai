"use server";
// src/app/actions/active-org.ts

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

const COOKIE_NAME = "active_org_id";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function setActiveOrg(formData: FormData) {
  const orgId = safeStr(formData.get("orgId")).trim();
  const nextPath = safeStr(formData.get("nextPath")).trim() || "/projects";

  if (!orgId) redirect(nextPath);

  const supabase = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr || !user) redirect("/login");

  // ✅ validate membership via organisation_members
  const { data: membership, error: memErr } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (memErr || !membership) redirect(nextPath);

  // ✅ cookies() is async-typed in some Next builds -> awaiting is safe
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, orgId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  redirect(nextPath);
}

export async function clearActiveOrg(nextPath: string = "/projects") {
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
  redirect(nextPath);
}