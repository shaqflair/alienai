import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get("token");
    if (!token) {
      return NextResponse.json({ ok: false, error: "Token required" }, { status: 400 });
    }

    const sb = await createClient();

    // Fetch invite + org name in one query
    const { data: invite, error } = await sb
      .from("organisation_invites")
      .select("role, status, organisation_id, organisations(name)")
      .eq("token", token)
      .maybeSingle();

    if (error || !invite) {
      return NextResponse.json({ ok: false, error: "Invite not found" }, { status: 404 });
    }

    if (invite.status === "revoked") {
      return NextResponse.json({ ok: false, error: "This invite has been revoked" }, { status: 410 });
    }

    if (invite.status === "accepted") {
      return NextResponse.json({ ok: false, error: "This invite has already been accepted" }, { status: 410 });
    }

    const org = invite.organisations as any;

    return NextResponse.json({
      ok:       true,
      role:     invite.role      ?? "member",
      org_name: org?.name        ?? "your organisation",
    });

  } catch (err: unknown) {
    console.error("invite preview error:", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}