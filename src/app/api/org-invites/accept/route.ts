import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";

const COOKIE_NAME = "active_org_id";

async function sha256Hex(input: string): Promise<string> {
  const buf = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token") ?? "";

  // No token → go to login
  if (!token) {
    return NextResponse.redirect(new URL("/login", url.origin));
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Must be logged in to accept invite
  if (!user) {
    const next = `/api/org-invites/accept?token=${encodeURIComponent(token)}`;
    return NextResponse.redirect(
      new URL(`/login?next=${encodeURIComponent(next)}`, url.origin)
    );
  }

  const tokenHash = await sha256Hex(token);

  // Find invite by token hash
  const { data: invite, error } = await supabase
    .from("org_invites")
    .select("id, org_id, email, role, status, expires_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();

  if (error || !invite) {
    return NextResponse.redirect(new URL("/projects?invite=invalid", url.origin));
  }

  // Check status + expiry
  const now = Date.now();
  const exp = new Date(invite.expires_at).getTime();

  if (invite.status !== "pending" || Number.isNaN(exp) || exp < now) {
    return NextResponse.redirect(new URL("/projects?invite=expired", url.origin));
  }

  // Ensure email matches logged-in user
  const myEmail = (user.email ?? "").toLowerCase();
  if (invite.email.toLowerCase() !== myEmail) {
    return NextResponse.redirect(
      new URL("/projects?invite=email-mismatch", url.origin)
    );
  }

  // Add membership (idempotent)
  const { error: memErr } = await supabase
    .from("org_members")
    .upsert(
      {
        org_id: invite.org_id,
        user_id: user.id,
        role: invite.role,
      },
      { onConflict: "org_id,user_id" }
    );

  if (memErr) {
    return NextResponse.redirect(new URL("/projects?invite=failed", url.origin));
  }

  // Mark invite accepted + invalidate token
  await supabase
    .from("org_invites")
    .update({
      status: "accepted",
      accepted_at: new Date().toISOString(),
      accepted_by: user.id,
      token_hash: null,
    })
    .eq("id", invite.id);

  // Set active org cookie
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, invite.org_id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });

  return NextResponse.redirect(
    new URL("/projects?invite=accepted", url.origin)
  );
}
