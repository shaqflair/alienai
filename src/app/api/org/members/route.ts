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

  // Step 1: get user_ids for this org
  const { data: orgMembers, error: e1 } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", orgId);

  if (e1) return NextResponse.json({ error: e1.message }, { status: 500 });
  if (!orgMembers?.length) return NextResponse.json({ members: [] });

  const userIds = orgMembers.map((m: any) => m.user_id);

  // Step 2: get profiles - try both id and user_id column names
  const { data: profiles, error: e2 } = await supabase
    .from("profiles")
    .select("*")
    .in("id", userIds);

  if (e2) {
    // Maybe the PK is user_id not id
    const { data: profiles2 } = await supabase
      .from("profiles")
      .select("*")
      .in("user_id", userIds);
    
    const members = (profiles2 ?? []).map((p: any) => ({
      user_id: p.user_id ?? p.id,
      name: p.full_name ?? p.name ?? p.display_name ?? "",
      email: p.email ?? "",
    }));
    return NextResponse.json({ members });
  }

  const members = (profiles ?? []).map((p: any) => ({
    user_id: p.id ?? p.user_id,
    name: p.full_name ?? p.name ?? p.display_name ?? "",
    email: p.email ?? "",
  }));

  return NextResponse.json({ members });
}
