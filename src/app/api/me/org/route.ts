import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const orgIdFromUrl = url.searchParams.get("orgId")?.trim() || null;

  // Fetch user's preferred active org from their profile
  const { data: profile, error: pErr } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", u.user.id)
    .maybeSingle();

  if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 });

  // Fetch all valid, non-removed memberships for the user
  const { data: mem, error: mErr } = await supabase
    .from("organisation_members")
    .select("organisation_id, role, removed_at, created_at")
    .eq("user_id", u.user.id)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });

  const membershipOrgIds = (mem ?? []).map((x: any) => x.organisation_id);

  /**
   * Resolve Active Org ID priority:
   * 1. Explicit ?orgId parameter (if member)
   * 2. Profile active_organisation_id (if member)
   * 3. First available membership (oldest)
   */
  const activeOrgId =
    (orgIdFromUrl && membershipOrgIds.includes(orgIdFromUrl) ? orgIdFromUrl : null) ||
    (profile?.active_organisation_id && membershipOrgIds.includes(profile.active_organisation_id)
      ? profile.active_organisation_id
      : null) ||
    membershipOrgIds[0] ||
    null;

  return NextResponse.json({
    ok: true,
    activeOrgId,
    memberships: mem ?? [],
  });
}
