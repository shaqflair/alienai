// src/app/api/organisation-invites/accept/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function ok(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}
function err(error: string, status = 400) {
  return noStoreJson({ ok: false, error }, status);
}

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}
function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

export async function POST(req: Request) {
  try {
    // Require signed-in user
    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const token = safeStr(body?.token).trim();
    if (!token) return err("Missing token", 400);

    const myEmail = safeLower(auth.user.email);
    if (!myEmail) return err("User email missing", 400);

    // Service-role client (bypasses RLS)
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) return err("Server misconfigured (missing service role env)", 500);

    const admin = createAdminClient(url, serviceKey);

    // Lookup invite by token
    const { data: inv, error: invErr } = await admin
      .from("organisation_invites")
      .select("id, organisation_id, email, role, status, expires_at")
      .eq("token", token)
      .maybeSingle();

    if (invErr) return err(invErr.message, 400);
    if (!inv) return err("Invite not found", 404);
    if (inv.status !== "pending") return err(`Invite is ${inv.status}`, 400);

    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      return err("Invite expired", 400);
    }

    const invEmail = safeLower(inv.email);
    if (invEmail && invEmail !== myEmail) {
      return err("Invite email mismatch", 403);
    }

    const organisationId = safeStr(inv.organisation_id).trim();
    const roleRaw = safeStr(inv.role).trim().toLowerCase();
    const role = (roleRaw === "admin" ? "admin" : "member") as "admin" | "member";

    // Upsert membership (idempotent)
    const { error: upErr } = await admin
      .from("organisation_members")
      .upsert(
        { organisation_id: organisationId, user_id: auth.user.id, role, removed_at: null },
        { onConflict: "organisation_id,user_id" }
      );

    if (upErr) return err(upErr.message, 400);

    // Mark invite accepted (only if still pending)
    const { data: upd, error: accErr } = await admin
      .from("organisation_invites")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: auth.user.id,
      })
      .eq("id", inv.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (accErr) return err(accErr.message, 400);
    if (!upd) return err("Invite no longer pending", 409);

    return ok({ accepted: true, organisation_id: organisationId, role });
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}