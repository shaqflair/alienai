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

  const { data, error } = await supabase
    .from("organisation_members")
    .select("user_id, profiles(full_name, email)")
    .eq("organisation_id", orgId)
    .is("removed_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const members = (data ?? []).map((m: any) => ({
    user_id: m.user_id,
    name:  m.profiles?.full_name ?? "",
    email: m.profiles?.email    ?? "",
  }));

  return NextResponse.json({ members });
}
