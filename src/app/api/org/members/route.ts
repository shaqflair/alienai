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

  // Join organisation_members with profiles
  const { data, error } = await supabase
    .from("organisation_members")
    .select(`
      user_id,
      profiles!organisation_members_user_id_fkey (
        full_name,
        email
      )
    `)
    .eq("organisation_id", orgId);

  if (error) {
    // Fallback: try without foreign key hint
    const { data: data2, error: err2 } = await supabase
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", orgId);

    if (err2) return NextResponse.json({ error: err2.message }, { status: 500 });

    const userIds = (data2 ?? []).map((m: any) => m.user_id);
    if (!userIds.length) return NextResponse.json({ members: [] });

    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", userIds);

    const members = (profiles ?? []).map((p: any) => ({
      user_id: p.id,
      name: p.full_name ?? "",
      email: p.email ?? "",
    }));
    return NextResponse.json({ members });
  }

  const members = (data ?? []).map((m: any) => ({
    user_id: m.user_id,
    name: m.profiles?.full_name ?? "",
    email: m.profiles?.email ?? "",
  }));

  return NextResponse.json({ members });
}
