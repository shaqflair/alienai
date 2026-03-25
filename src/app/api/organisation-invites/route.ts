// FILE: src/app/api/organisation-invites/route.ts

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";

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

function bad(error: string, status = 400) {
  return noStoreJson({ ok: false, error }, status);
}

function safeStr(x: any): string {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function token64() {
  return crypto.randomBytes(32).toString("hex");
}

function expiresAt7Days(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}

function sbErr(e: any): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function requireOrigin(): string {
  const o =
    process.env.APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL;

  if (!o) throw new Error("Missing APP_ORIGIN env var");
  return o.replace(/\/+$/, "");
}

//
// ───────────────────────────────────────────────────────────
// GET: list invites (UNCHANGED)
// ───────────────────────────────────────────────────────────
//

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();

  if (authErr) return bad(sbErr(authErr), 401);
  if (!auth?.user) return bad("Not authenticated", 401);

  const url = new URL(req.url);
  const organisationId = safeStr(url.searchParams.get("organisationId")).trim();

  if (!organisationId) return bad("Missing organisationId", 400);
  if (!isUuid(organisationId)) return bad("Invalid organisationId", 400);

  const { data, error } = await sb
    .from("organisation_invites")
    .select(
      "id, organisation_id, email, role, status, created_at, accepted_at, expires_at, token"
    )
    .eq("organisation_id", organisationId)
    .order("created_at", { ascending: false });

  if (error) return bad(sbErr(error), 403);

  return ok({ items: data ?? [] });
}

//
// ───────────────────────────────────────────────────────────
// POST: create invite + SUPABASE EMAIL
// ───────────────────────────────────────────────────────────
//

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();

  if (authErr) return bad(sbErr(authErr), 401);
  if (!auth?.user) return bad("Not authenticated", 401);

  const body = await req.json().catch(() => ({}));

  const organisation_id = safeStr(body?.organisation_id).trim();
  const email = safeStr(body?.email).trim().toLowerCase();
  const roleRaw = safeStr(body?.role).trim().toLowerCase();
  const role = (roleRaw === "admin" ? "admin" : "member") as
    | "admin"
    | "member";

  const isResend = Boolean(body?.resend);

  if (!organisation_id || !isUuid(organisation_id)) {
    return bad("Invalid organisation_id", 400);
  }

  if (!email || !email.includes("@")) {
    return bad("Valid email required", 400);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  if (!supabaseUrl || !serviceKey) {
    return bad("Server misconfigured", 500);
  }

  const admin = createAdminClient(supabaseUrl, serviceKey);

  let inviteId: string;
  let inviteToken: string;
  const expiresAt = expiresAt7Days();

  if (isResend) {
    const { data: existing } = await sb
      .from("organisation_invites")
      .select("id")
      .eq("organisation_id", organisation_id)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (!existing) {
      return bad("No pending invite found for this email.", 404);
    }

    const newToken = token64();

    const { error } = await sb
      .from("organisation_invites")
      .update({
        token: newToken,
        expires_at: expiresAt,
      })
      .eq("id", existing.id);

    if (error) return bad(sbErr(error), 400);

    inviteId = existing.id;
    inviteToken = newToken;
  } else {
    const newToken = token64();

    const { data, error } = await sb
      .from("organisation_invites")
      .insert({
        organisation_id,
        email,
        role,
        token: newToken,
        invited_by: auth.user.id,
        status: "pending",
        expires_at: expiresAt,
      })
      .select("id")
      .single();

    if (error) {
      if (safeStr((error as any)?.code) === "23505") {
        return bad("An invite is already pending for this email.", 409);
      }
      return bad(sbErr(error), 400);
    }

    inviteId = data.id;
    inviteToken = newToken;
  }

  let origin: string;
  try {
    origin = requireOrigin();
  } catch (e: any) {
    return bad(e.message, 500);
  }

  // 🔥 KEY CHANGE: Supabase invite flow
  const inviteNext = `/organisations/invite/${encodeURIComponent(inviteToken)}`;

  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/reset?next=${encodeURIComponent(inviteNext)}`,
  });

  if (inviteErr) {
    return bad(inviteErr.message, 400);
  }

  return ok({
    invited: true,
    email,
    role,
  });
}

//
// ───────────────────────────────────────────────────────────
// PATCH: revoke invite (UNCHANGED)
// ───────────────────────────────────────────────────────────
//

export async function PATCH(req: Request) {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();

  if (authErr) return bad(sbErr(authErr), 401);
  if (!auth?.user) return bad("Not authenticated", 401);

  const body = await req.json().catch(() => ({}));

  const id = safeStr(body?.id).trim();
  const status = safeStr(body?.status).trim().toLowerCase();

  if (!id || !isUuid(id)) return bad("Invalid id", 400);
  if (status !== "revoked") return bad("Invalid status", 400);

  const { data, error } = await sb
    .from("organisation_invites")
    .update({ status })
    .eq("id", id)
    .eq("status", "pending")
    .select("id, status")
    .maybeSingle();

  if (error) return bad(sbErr(error), 400);
  if (!data) return bad("Invite not found or not pending.", 404);

  return ok({ invite: data });
}