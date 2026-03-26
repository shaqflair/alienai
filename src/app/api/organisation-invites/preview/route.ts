// src/app/api/organisation-invites/preview/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function ok(data: any, status = 200) {
  return json({ ok: true, ...data }, status);
}

function bad(error: string, status = 400) {
  return json({ ok: false, error }, status);
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export async function GET(req: NextRequest) {
  try {
    const token = safeStr(req.nextUrl.searchParams.get("token")).trim();

    if (!token) {
      return bad("Token required", 400);
    }

    const sb = await createClient();

    const { data: invite, error } = await sb
      .from("organisation_invites")
      .select(
        `
          id,
          email,
          role,
          status,
          invited_by,
          accepted_at,
          expires_at,
          organisation_id,
          organisations(name)
        `
      )
      .eq("token", token)
      .maybeSingle();

    if (error) {
      return bad(error.message, 400);
    }

    if (!invite) {
      return bad("Invite not found", 404);
    }

    const status = safeStr(invite.status).trim().toLowerCase();
    const expiresAt = safeStr((invite as any).expires_at).trim();
    const nowIso = new Date().toISOString();

    if (status === "revoked") {
      return bad("This invite has been revoked.", 410);
    }

    if (status === "accepted") {
      return bad("This invite has already been accepted.", 410);
    }

    if (status !== "pending") {
      return bad("This invite is no longer available.", 410);
    }

    if (expiresAt && expiresAt < nowIso) {
      return bad("This invite has expired.", 410);
    }

    let invitedByName: string | undefined;

    const invitedBy = safeStr((invite as any).invited_by).trim();
    if (invitedBy) {
      const { data: inviterProfile } = await sb
        .from("profiles")
        .select("full_name, email")
        .eq("user_id", invitedBy)
        .maybeSingle();

      const fullName = safeStr(inviterProfile?.full_name).trim();
      const email = safeStr(inviterProfile?.email).trim();

      invitedByName = fullName || email || undefined;
    }

    const org = (invite as any).organisations as { name?: string } | null;

    return ok({
      role: safeStr(invite.role).trim() || "member",
      org_name: safeStr(org?.name).trim() || "your organisation",
      invited_by: invitedByName,
      email: safeStr((invite as any).email).trim() || undefined,
      expires_at: expiresAt || undefined,
    });
  } catch (err: unknown) {
    console.error("invite preview error:", err);
    return bad("Server error", 500);
  }
}