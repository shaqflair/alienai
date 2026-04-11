import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import MembersClient from "./_components/MembersClient";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Members | Settings" };

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export type MemberRow = {
  user_id:         string;
  role:            "owner" | "admin" | "member";
  full_name:       string;
  email:           string;
  job_title:       string;
  line_manager_id: string | null;
  joined_at:       string | null;
  avatar_url:      string | null;
  isMe:            boolean;
};

export default async function SettingsMembersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/settings/members");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/settings?err=no_org");
  const organisationId = String(orgId);

  // Caller's role
  const { data: myMem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  const myRole  = (safeStr(myMem?.role).toLowerCase() || "member") as "owner" | "admin" | "member";
  const isAdmin = myRole === "admin" || myRole === "owner";

  // All active members
  const { data: memRows } = await supabase
    .from("organisation_members")
    .select("user_id, role, created_at")
    .eq("organisation_id", organisationId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  const userIds = (memRows ?? [])
    .map((r: any) => safeStr(r.user_id))
    .filter(Boolean);

  // Fetch profiles ? now including job_title and line_manager_id
  const profilesById = new Map<string, any>();
  if (userIds.length) {
    const { data: profs } = await supabase
      .from("profiles")
      .select("user_id, full_name, email, avatar_url, job_title, line_manager_id")
      .in("user_id", userIds);
    (profs ?? []).forEach((p: any) => profilesById.set(p.user_id, p));
  }

  const members: MemberRow[] = (memRows ?? []).map((r: any) => {
    const prof = profilesById.get(r.user_id) ?? {};
    return {
      user_id:         safeStr(r.user_id),
      role:            (safeStr(r.role).toLowerCase() || "member") as MemberRow["role"],
      full_name:       safeStr(prof.full_name) || safeStr(prof.email) || "Unknown User",
      email:           safeStr(prof.email),
      job_title:       safeStr(prof.job_title),
      line_manager_id: typeof prof.line_manager_id === "string" ? prof.line_manager_id : null,
      joined_at:       r.created_at ?? null,
      avatar_url:      safeStr(prof.avatar_url) || null,
      isMe:            r.user_id === user.id,
    };
  });

  return (
    <MembersClient
      members={members}
      myRole={myRole}
      isAdmin={isAdmin}
      organisationId={organisationId}
      myUserId={user.id}
    />
  );
}