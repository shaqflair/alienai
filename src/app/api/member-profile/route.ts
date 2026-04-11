import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function safeText(x: unknown) {
  return typeof x === "string" ? x.trim() : "";
}

export const runtime = "nodejs";

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });

    const { user_id, full_name, job_title, line_manager_id } = body;

    if (!safeText(user_id))    return NextResponse.json({ ok: false, error: "user_id required" },  { status: 400 });
    if (!safeText(full_name))  return NextResponse.json({ ok: false, error: "full_name required" }, { status: 400 });

    const sb = await createClient();

    // Verify caller is authenticated
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

    // Find a shared org to verify caller has admin/owner permission over this user
    const { data: myMems } = await sb
      .from("organisation_members")
      .select("organisation_id, role")
      .eq("user_id", user.id)
      .is("removed_at", null);

    const myOrgIds = (myMems ?? [])
      .filter((m: any) => m.role === "admin" || m.role === "owner")
      .map((m: any) => String(m.organisation_id));

    if (!myOrgIds.length) {
      return NextResponse.json({ ok: false, error: "No admin permissions" }, { status: 403 });
    }

    // Verify target user is in one of those orgs
    const { data: targetMem } = await sb
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", safeText(user_id))
      .in("organisation_id", myOrgIds)
      .is("removed_at", null)
      .limit(1)
      .maybeSingle();

    if (!targetMem) {
      return NextResponse.json({ ok: false, error: "Target user not found in your organisation" }, { status: 403 });
    }

    // Update the profile
    const patch: Record<string, unknown> = {
      full_name:       safeText(full_name),
      job_title:       safeText(job_title) || null,
      line_manager_id: safeText(line_manager_id) || null,
    };

    const { error } = await sb
      .from("profiles")
      .update(patch)
      .eq("user_id", safeText(user_id));

    if (error) {
      console.error("member-profile PATCH error:", error);
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("member-profile route error:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
