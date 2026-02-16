// src/app/members/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

export default async function MembersShortcutPage() {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) redirect("/login");

  const cookieStore = await cookies();
  const activeOrgId = cookieStore.get("active_org_id")?.value || "";

  if (activeOrgId) {
    redirect(`/organisations/${activeOrgId}/members`);
  }

  const { data: mem } = await supabase
    .from("organisation_members")
    .select("organisation_id, created_at")
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(1);

  const firstOrgId = Array.isArray(mem) && mem[0]?.organisation_id ? String(mem[0].organisation_id) : "";
  if (firstOrgId) redirect(`/organisations/${firstOrgId}/members`);

  redirect("/organisations");
}
