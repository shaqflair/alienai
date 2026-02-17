import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(error: string, status = 400, extra?: any) {
  return NextResponse.json({ ok: false, error, ...(extra ? { extra } : {}) }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    // 1) Require signed-in user (we verify invite email belongs to them)
    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const token = safeStr(body?.token).trim();
    if (!token) return err("Missing token", 400);

    const myEmail = safeLower(auth.user.email);
    if (!myEmail) return err("User email missing", 400);

    // 2) Service-role client (bypasses RLS) for invite lookup + writes
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return err("Server misconfigured (missing service role env)", 500);

    const admin = createAdminClient(url, serviceKey);

    // 3) Lookup invite by token
    const { data: inv, error: invErr } = await admin
      .from("organisation_invites")
      .select("id, organisation_id, email, role, status")
      .eq("token", token)
      .maybeSingle();

    if (invErr) return err(invErr.message, 400);
    if (!inv) return err("Invite not found", 404);
    if (inv.status !== "pending") return err(`Invite is ${inv.status}`, 400);

    const invEmail = safeLower(inv.email);
    if (invEmail && invEmail !== myEmail) {
      return err("Invite email mismatch", 403, { inviteEmail: inv.email, userEmail: auth.user.email });
    }

    const organisationId = safeStr(inv.organisation_id).trim();
    const roleRaw = safeStr(inv.role).trim().toLowerCase();
    const role = (roleRaw === "admin" ? "admin" : "member") as "admin" | "member";

    // 4) Upsert membership (idempotent)
    const { error: upErr } = await admin
      .from("organisation_members")
      .upsert(
        { organisation_id: organisationId, user_id: auth.user.id, role, removed_at: null },
        { onConflict: "organisation_id,user_id" }
      );

    if (upErr) return err(upErr.message, 400);

    // 5) Mark invite accepted
    const { error: accErr } = await admin
      .from("organisation_invites")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: auth.user.id,
      })
      .eq("id", inv.id);

    if (accErr) return err(accErr.message, 400);

    return ok({ accepted: true, organisation_id: organisationId, role });
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}

