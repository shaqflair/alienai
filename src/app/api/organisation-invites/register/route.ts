import "server-only";
import { NextResponse } from "next/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any)              { return NextResponse.json({ ok: true,  ...data }); }
function fail(error: string, s=400) { return NextResponse.json({ ok: false, error }, { status: s }); }
function safeStr(x: any)            { return typeof x === "string" ? x.trim() : ""; }
function safeLower(x: any)          { return safeStr(x).toLowerCase(); }

export async function POST(req: Request) {
  try {
    const body     = await req.json().catch(() => ({}));
    const token    = safeStr(body?.token);
    const email    = safeLower(body?.email);
    const password = safeStr(body?.password);

    if (!token)                      return fail("Missing invite token", 400);
    if (!email)                      return fail("Missing email", 400);
    if (!password)                   return fail("Missing password", 400);
    if (password.length < 8)         return fail("Password must be at least 8 characters", 400);

    const url        = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey)         return fail("Server misconfigured", 500);

    const admin = createAdminClient(url, serviceKey);

    // ── 1. Validate invite token ───────────────────────────────────────
    const { data: inv, error: invErr } = await admin
      .from("organisation_invites")
      .select("id, organisation_id, email, role, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (invErr || !inv)           return fail("Invite not found or invalid", 404);
    if (inv.status !== "pending") return fail(`Invite is already ${inv.status}`, 400);
    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      return fail("Invite has expired", 400);
    }

    // ── 2. Check email matches invite ──────────────────────────────────
    const invEmail = safeLower(inv.email);
    if (invEmail && invEmail !== email) {
      return fail("This invite was sent to a different email address", 403);
    }

    // ── 3. Check if user already exists ───────────────────────────────
    // NOTE: listUsers is paginated — for large user bases consider a DB lookup instead.
    const { data: existing } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existingUser = existing?.users?.find(u => safeLower(u.email) === email);
    if (existingUser) {
      // 409 → client redirects them to login
      return fail("An account with this email already exists. Please sign in instead.", 409);
    }

    // ── 4. Create user via admin API ───────────────────────────────────
    // email_confirm: true bypasses the confirmation email entirely.
    // The user can sign in with password immediately after this call.
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createErr || !created?.user) {
      return fail(createErr?.message || "Failed to create account", 400);
    }

    const userId         = created.user.id;
    const organisationId = safeStr(inv.organisation_id);
    const role           = (safeLower(inv.role) === "admin" ? "admin" : "member") as "admin" | "member";

    // ── 5. Add to organisation ─────────────────────────────────────────
    const { error: memErr } = await admin
      .from("organisation_members")
      .upsert(
        { organisation_id: organisationId, user_id: userId, role, removed_at: null },
        { onConflict: "organisation_id,user_id" }
      );

    if (memErr) {
      // Rollback: delete the user we just created so they can retry
      await admin.auth.admin.deleteUser(userId);
      return fail(memErr.message, 400);
    }

    // ── 6. Mark invite accepted ────────────────────────────────────────
    const { error: accErr } = await admin
      .from("organisation_invites")
      .update({
        status:      "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      })
      .eq("id", inv.id)
      .eq("status", "pending");

    if (accErr) {
      // Non-fatal — membership was created successfully, just log
      console.error("Failed to mark invite accepted:", accErr.message);
    }

    // ── 7. Return success ──────────────────────────────────────────────
    // Do NOT use generateLink here — it requires an absolute redirectTo URL
    // and causes broken redirects. Instead, the client signs in directly
    // using signInWithPassword (email_confirm: true means it works immediately).
    return ok({
      created:         true,
      organisation_id: organisationId,
      role,
    });

  } catch (e: any) {
    console.error("register route error:", e);
    return fail(e?.message || "Unexpected error", 500);
  }
}