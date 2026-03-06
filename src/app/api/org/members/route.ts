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

  // First get org members
  const { data: orgMembers, error: omErr } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", orgId);

  if (omErr) return NextResponse.json({ error: omErr.message }, { status: 500 });
  if (!orgMembers?.length) return NextResponse.json({ members: [] });

  const userIds = orgMembers.map((m: any) => m.user_id);

  // Then get profiles for those users
  const { data: profiles, error: pErr } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .in("id", userIds);

  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const members = (profiles ?? []).map((p: any) => ({
    user_id: p.id,
    name:  p.full_name ?? "",
    email: p.email    ?? "",
  }));

  return NextResponse.json({ members });
}
