import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = req.nextUrl.searchParams.get("orgId");
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  // Get org member user_ids
  const { data: orgMembers, error: e1 } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", orgId);

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!orgMembers?.length) return NextResponse.json({ members: [] });

  const userIds = orgMembers.map((m: any) => m.user_id);

  // profiles.user_id matches organisation_members.user_id (both reference auth.users.id)
  const { data: profiles, error: e2 } = await supabase
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", userIds);

  if (e2) return NextResponse.json({ error: e2.message }, { status: 500 });

  const members = (profiles ?? []).map((p: any) => ({
    user_id: p.user_id,
    name:  p.full_name ?? "",
    email: p.email    ?? "",
  }));

  return NextResponse.json({ members });
}
