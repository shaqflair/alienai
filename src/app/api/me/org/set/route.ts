import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: u } = await supabase.auth.getUser();
  if (!u?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const orgId = (body?.orgId || "").trim();
  if (!orgId) return NextResponse.json({ ok: false, error: "Missing orgId" }, { status: 400 });

  // Security Check: User must be an active member of the organization they are switching to
  const { data: mem, error: mErr } = await supabase
    .from("organisation_members")
    .select("id")
    .eq("user_id", u.user.id)
    .eq("organisation_id", orgId)
    .is("removed_at", null)
    .maybeSingle();

  if (mErr) return NextResponse.json({ ok: false, error: mErr.message }, { status: 500 });
  if (!mem) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  // Persist the selection to the user's profile
  const { error: upErr } = await supabase
    .from("profiles")
    .update({ active_organisation_id: orgId })
    .eq("user_id", u.user.id);

  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, activeOrgId: orgId });
}
