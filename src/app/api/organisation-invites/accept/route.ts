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
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function ok(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}

function err(error: string, status = 400, meta?: any) {
  return noStoreJson(
    { ok: false, error, ...(meta ? { meta } : {}) },
    status
  );
}

function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function safeLower(x: any) {
  return safeStr(x).trim().toLowerCase();
}

function isExpired(expiresAt: unknown): boolean {
  const s = safeStr(expiresAt).trim();
  if (!s) return false;
  const t = new Date(s).getTime();
  return Number.isFinite(t) && t < Date.now();
}

async function clearOtherPendingInvitesForEmail(
  admin: any,
  organisationId: string,
  email: string,
  acceptedInviteId: string
) {
  const { error } = await admin
    .from("organisation_invites")
    .update({ status: "revoked" })
    .eq("organisation_id", organisationId)
    .eq("email", email)
    .eq("status", "pending")
    .neq("id", acceptedInviteId);

  if (error) {
    throw new Error(error.message);
  }
}

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();

    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const token = safeStr(body?.token).trim();
    if (!token) return err("Missing token", 400);

    const myEmail = safeLower(auth.user.email);
    if (!myEmail) return err("User email missing", 400);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
      return err("Server misconfigured (missing service role env)", 500);
    }

    const admin = createAdminClient(url, serviceKey);

    const { data: inv, error: invErr } = await admin
      .from("organisation_invites")
      .select(
        `
        id,
        organisation_id,
        email,
        role,
        status,
        expires_at,
        accepted_at,
        accepted_by,
        organisations:organisation_id (
          name
        )
      `
      )
      .eq("token", token)
      .maybeSingle();

    if (invErr) return err(invErr.message, 400);
    if (!inv) return err("Invite not found", 404);

    const inviteStatus = safeStr(inv.status).trim().toLowerCase();
    const invEmail = safeLower(inv.email);
    const organisationId = safeStr(inv.organisation_id).trim();

    if (!organisationId) return err("Invite organisation missing", 400);

    if (inviteStatus === "revoked") {
      return err("This invite has been revoked.", 410);
    }

    if (isExpired(inv.expires_at)) {
      return err("This invite has expired.", 410);
    }

    if (invEmail && invEmail !== myEmail) {
      return err("Invite email mismatch", 403);
    }

    const roleRaw = safeStr(inv.role).trim().toLowerCase();
    const role = (roleRaw === "admin" ? "admin" : "member") as
      | "admin"
      | "member";

    const orgName =
      typeof inv.organisations?.name === "string"
        ? inv.organisations.name
        : null;

    if (inviteStatus !== "pending" && inviteStatus !== "accepted") {
      return err(`Invite is ${inviteStatus || "invalid"}`, 410);
    }

    const { data: existingMembership, error: membershipLookupErr } = await admin
      .from("organisation_members")
      .select("id, organisation_id, user_id, role, removed_at")
      .eq("organisation_id", organisationId)
      .eq("user_id", auth.user.id)
      .maybeSingle();

    if (membershipLookupErr) return err(membershipLookupErr.message, 400);

    if (existingMembership) {
      const { error: restoreMembershipErr } = await admin
        .from("organisation_members")
        .update({
          role,
          removed_at: null,
          email: auth.user.email ?? null,
        })
        .eq("id", existingMembership.id);

      if (restoreMembershipErr) {
        return err(restoreMembershipErr.message, 400);
      }
    } else {
      const { error: insertMembershipErr } = await admin
        .from("organisation_members")
        .insert({
          organisation_id: organisationId,
          user_id: auth.user.id,
          role,
          removed_at: null,
          email: auth.user.email ?? null,
        });

      if (insertMembershipErr) {
        return err(insertMembershipErr.message, 400);
      }
    }

    const { error: profileUpsertErr } = await admin.from("profiles").upsert(
      {
        id: auth.user.id,
        user_id: auth.user.id,
        email: auth.user.email ?? null,
        active_organisation_id: organisationId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" }
    );

    if (profileUpsertErr) {
      return err(profileUpsertErr.message, 400);
    }

    if (inviteStatus === "accepted") {
      return ok({
        accepted: true,
        already_accepted: true,
        organisation_id: organisationId,
        org_name: orgName,
        role,
      });
    }

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

    if (!upd) {
      return ok({
        accepted: true,
        already_accepted: true,
        organisation_id: organisationId,
        org_name: orgName,
        role,
      });
    }

    try {
      await clearOtherPendingInvitesForEmail(admin, organisationId, invEmail, inv.id);
    } catch (e: any) {
      return err(e?.message || "Failed to revoke duplicate pending invites", 400);
    }

    return ok({
      accepted: true,
      organisation_id: organisationId,
      org_name: orgName,
      role,
    });
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}