// src/app/actions/active-org.ts
"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

const COOKIE_NAME = "active_org_id";

export async function setActiveOrg(formData: FormData) {
  const orgId = String(formData.get("orgId") ?? "").trim();
  const nextPath = String(formData.get("nextPath") ?? "/projects").trim() || "/projects";

  if (!orgId) redirect(nextPath);

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // ✅ validate membership via organisation_members
  const { data: membership } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("organisation_id", orgId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) redirect(nextPath);

  // ✅ Next.js 16: cookies() is async-typed -> await it
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
