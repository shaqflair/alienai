import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import OrgChartClient from "./_components/OrgChartClient";

export const dynamic  = "force-dynamic";
export const metadata = { title: "Org Chart | Aliena" };

function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }

export type OrgPerson = {
  userId:         string;
  fullName:       string;
  jobTitle:       string | null;
  department:     string | null;
  avatarUrl:      string | null;
  lineManagerId:  string | null;
  role:           string;
};

export default async function OrgChartPage() {
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) redirect("/login?next=/org-chart");

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) redirect("/?err=no_org");
  const organisationId = String(orgId);

  // Check membership
  const { data: mem } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (!mem) redirect("/");
  const myRole  = safeStr(mem.role).toLowerCase();
  const isAdmin = myRole === "admin" || myRole === "owner";

  // Load all members with profiles
  const { data: memberRows } = await supabase
    .from("organisation_members")
    .select("user_id, role")
    .eq("organisation_id", organisationId)
    .is("removed_at", null);

  const userIds = (memberRows ?? []).map((r: any) => safeStr(r.user_id)).filter(Boolean);
  const roleByUserId = new Map((memberRows ?? []).map((r: any) => [safeStr(r.user_id), safeStr(r.role)]));

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, job_title, department, avatar_url, line_manager_id")
    .in("user_id", userIds);

  const people: OrgPerson[] = (profiles ?? []).map((p: any) => ({
    userId:        safeStr(p.user_id),
    fullName:      safeStr(p.full_name) || safeStr(p.user_id),
    jobTitle:      p.job_title   ?? null,
    department:    p.department  ?? null,
    avatarUrl:     p.avatar_url  ?? null,
    lineManagerId: p.line_manager_id ?? null,
    role:          roleByUserId.get(safeStr(p.user_id)) ?? "member",
  }));

  return (
    <OrgChartClient
      people={people}
      myUserId={user.id}
      isAdmin={isAdmin}
      organisationId={organisationId}
    />
  );
}
