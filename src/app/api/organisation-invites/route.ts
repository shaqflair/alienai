import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import crypto from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type InviteRole = "admin" | "member";

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

function bad(error: string, status = 400, meta?: any) {
  return noStoreJson({ ok: false, error, ...(meta ? { meta } : {}) }, status);
}

function safeStr(x: any): string {
  return typeof x === "string" ? x : "";
}

function normalizeEmail(x: any): string {
  return safeStr(x).trim().toLowerCase();
}

function normalizeRole(x: any): InviteRole {
  return safeStr(x).trim().toLowerCase() === "admin" ? "admin" : "member";
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

async function requireAuthedUser() {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();

  if (authErr) {
    return {
      sb,
      user: null as any,
      response: bad(sbErr(authErr), 401),
    };
  }

  if (!auth?.user) {
    return {
      sb,
      user: null as any,
      response: bad("Not authenticated", 401),
    };
  }

  return {
    sb,
    user: auth.user,
    response: null as Response | null,
  };
}

async function ensureActiveMembership(
  sb: any,
  organisationId: string,
  userId: string,
  email: string,
  role: InviteRole
) {
  const { data: existingMembership, error: membershipLookupError } = await sb
    .from("organisation_members")
    .select("id, organisation_id, user_id, role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (membershipLookupError) {
    throw new Error(sbErr(membershipLookupError));
  }

  if (existingMembership && !existingMembership.removed_at) {
    return {
      action: "already-member" as const,
      membership: existingMembership,
    };
  }

  if (existingMembership && existingMembership.removed_at) {
    const { data: restoredMembership, error: restoreError } = await sb
      .from("organisation_members")
      .update({
        removed_at: null,
        role,
        email,
      })
      .eq("id", existingMembership.id)
      .select("id, organisation_id, user_id, role, removed_at")
      .single();

    if (restoreError) {
      throw new Error(sbErr(restoreError));
    }

    return {
      action: "restored" as const,
      membership: restoredMembership,
    };
  }

  const { data: insertedMembership, error: insertMembershipError } = await sb
    .from("organisation_members")
    .insert({
      organisation_id: organisationId,
      user_id: userId,
      role,
      email,
    })
    .select("id, organisation_id, user_id, role, removed_at")
    .single();

  if (insertMembershipError) {
    throw new Error(sbErr(insertMembershipError));
  }

  return {
    action: "added" as const,
    membership: insertedMembership,
  };
}

async function revokePendingInvitesForEmail(
  sb: any,
  organisationId: string,
  email: string
) {
  const { data, error } = await sb
    .from("organisation_invites")
    .update({ status: "revoked" })
    .eq("organisation_id", organisationId)
    .eq("email", email)
    .eq("status", "pending")
    .select("id, email, status");

  if (error) {
    throw new Error(sbErr(error));
  }

  return data ?? [];
}

async function removeMembershipForEmail(
  sb: any,
  organisationId: string,
  email: string
) {
  const { data: profile, error: profileErr } = await sb
    .from("profiles")
    .select("user_id, active_organisation_id")
    .eq("email", email)
    .maybeSingle();

  if (profileErr) {
    throw new Error(sbErr(profileErr));
  }

  const userId = safeStr(profile?.user_id).trim();
  if (!userId) {
    return {
      removed: false,
      user_id: null,
      membership: null,
      cleared_active_org: false,
    };
  }

  const { data: membership, error: membershipErr } = await sb
    .from("organisation_members")
    .update({
      removed_at: new Date().toISOString(),
    })
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .or("removed_at.is.null")
    .select("id, organisation_id, user_id, role, removed_at")
    .maybeSingle();

  if (membershipErr) {
    throw new Error(sbErr(membershipErr));
  }

  let clearedActiveOrg = false;

  if (
    membership &&
    safeStr(profile?.active_organisation_id).trim() === organisationId
  ) {
    const { error: clearProfileErr } = await sb
      .from("profiles")
      .update({
        active_organisation_id: null,
        line_manager_id: null,
      })
      .eq("user_id", userId);

    if (clearProfileErr) {
      throw new Error(sbErr(clearProfileErr));
    }

    clearedActiveOrg = true;
  }

  return {
    removed: Boolean(membership),
    user_id: userId,
    membership: membership ?? null,
    cleared_active_org: clearedActiveOrg,
  };
}

async function sendInviteOrLoginLink(
  admin: any,
  email: string,
  redirectTo: string
) {
  const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
  });

  if (!inviteErr) {
    return { mode: "invite" as const };
  }

  const msg = safeStr(inviteErr.message).toLowerCase();

  if (
    msg.includes("already been registered") ||
    msg.includes("already registered") ||
    msg.includes("user already registered")
  ) {
    const { data: linkData, error: linkErr } =
      await admin.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      });

    if (linkErr) {
      throw new Error(linkErr.message);
    }

    return {
      mode: "magiclink" as const,
      actionLink: linkData?.properties?.action_link ?? null,
      emailOtp: linkData?.properties?.email_otp ?? null,
      hashedToken: linkData?.properties?.hashed_token ?? null,
    };
  }

  throw new Error(inviteErr.message);
}

export async function GET(req: Request) {
  const { sb, response } = await requireAuthedUser();
  if (response) return response;

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

export async function POST(req: Request) {
  const { sb, user, response } = await requireAuthedUser();
  if (response) return response;

  const body = await req.json().catch(() => ({}));

  const organisation_id = safeStr(body?.organisation_id).trim();
  const email = normalizeEmail(body?.email);
  const role = normalizeRole(body?.role);
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

  let origin: string;
  try {
    origin = requireOrigin();
  } catch (e: any) {
    return bad(e.message, 500);
  }

  if (isResend) {
    const { data: existingPendingInvite, error: pendingLookupError } = await sb
      .from("organisation_invites")
      .select("id")
      .eq("organisation_id", organisation_id)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

    if (pendingLookupError) return bad(sbErr(pendingLookupError), 400);
    if (!existingPendingInvite) {
      return bad("No pending invite found for this email.", 404);
    }

    const newToken = token64();
    const expiresAt = expiresAt7Days();

    const { error: resendUpdateError } = await sb
      .from("organisation_invites")
      .update({
        token: newToken,
        expires_at: expiresAt,
        role,
      })
      .eq("id", existingPendingInvite.id);

    if (resendUpdateError) return bad(sbErr(resendUpdateError), 400);

    const inviteNext = `/organisations/invite/${encodeURIComponent(newToken)}`;
    const redirectTo = `${origin}/auth/reset?next=${encodeURIComponent(inviteNext)}`;

    try {
      const delivery = await sendInviteOrLoginLink(admin, email, redirectTo);

      return ok({
        invited: true,
        resent: true,
        email,
        role,
        delivery_mode: delivery.mode,
      });
    } catch (e: any) {
      return bad(sbErr(e), 400);
    }
  }

  const { data: profile, error: profileLookupError } = await sb
    .from("profiles")
    .select("id, user_id, email, full_name")
    .eq("email", email)
    .maybeSingle();

  if (profileLookupError) {
    return bad(sbErr(profileLookupError), 400);
  }

  const existingUserId =
    safeStr(profile?.user_id).trim() || safeStr(profile?.id).trim();

  if (existingUserId) {
    try {
      const membershipResult = await ensureActiveMembership(
        sb,
        organisation_id,
        existingUserId,
        email,
        role
      );

      await revokePendingInvitesForEmail(sb, organisation_id, email);

      if (membershipResult.action === "already-member") {
        return bad("User is already a member of this organisation.", 409);
      }

      return ok({
        invited: false,
        direct_member_add: true,
        restored: membershipResult.action === "restored",
        added: membershipResult.action === "added",
        email,
        role,
        membership: membershipResult.membership,
        message:
          membershipResult.action === "restored"
            ? "Existing registered user was restored to the organisation."
            : "Existing registered user was added directly to the organisation.",
      });
    } catch (e: any) {
      return bad(sbErr(e), 400);
    }
  }

  const { data: existingPendingInvite, error: existingPendingInviteError } =
    await sb
      .from("organisation_invites")
      .select("id, token, expires_at, role, status")
      .eq("organisation_id", organisation_id)
      .eq("email", email)
      .eq("status", "pending")
      .maybeSingle();

  if (existingPendingInviteError) {
    return bad(sbErr(existingPendingInviteError), 400);
  }

  let inviteToken = existingPendingInvite?.token || token64();
  const expiresAt = expiresAt7Days();

  if (existingPendingInvite?.id) {
    const { error: updatePendingInviteError } = await sb
      .from("organisation_invites")
      .update({
        token: inviteToken,
        expires_at: expiresAt,
        role,
      })
      .eq("id", existingPendingInvite.id);

    if (updatePendingInviteError) {
      return bad(sbErr(updatePendingInviteError), 400);
    }
  } else {
    const { error: revokeOldError } = await sb
      .from("organisation_invites")
      .update({ status: "revoked" })
      .eq("organisation_id", organisation_id)
      .eq("email", email)
      .eq("status", "pending");

    if (revokeOldError) {
      return bad(sbErr(revokeOldError), 400);
    }

    const { error: insertInviteError } = await sb
      .from("organisation_invites")
      .insert({
        organisation_id,
        email,
        role,
        token: inviteToken,
        invited_by: user.id,
        status: "pending",
        expires_at: expiresAt,
      });

    if (insertInviteError) {
      if (safeStr((insertInviteError as any)?.code) === "23505") {
        return bad("An invite is already pending for this email.", 409);
      }
      return bad(sbErr(insertInviteError), 400);
    }
  }

  const inviteNext = `/organisations/invite/${encodeURIComponent(inviteToken)}`;
  const redirectTo = `${origin}/auth/reset?next=${encodeURIComponent(inviteNext)}`;

  try {
    const delivery = await sendInviteOrLoginLink(admin, email, redirectTo);

    return ok({
      invited: true,
      email,
      role,
      reused_pending: Boolean(existingPendingInvite?.id),
      delivery_mode: delivery.mode,
    });
  } catch (e: any) {
    return bad(sbErr(e), 400);
  }
}

export async function PATCH(req: Request) {
  const { sb, response } = await requireAuthedUser();
  if (response) return response;

  const body = await req.json().catch(() => ({}));

  const id = safeStr(body?.id).trim();
  const status = safeStr(body?.status).trim().toLowerCase();
  const revokeAllForEmail = Boolean(body?.revoke_all_for_email);
  const removeMember = Boolean(body?.remove_member);

  if (!id || !isUuid(id)) return bad("Invalid id", 400);
  if (status !== "revoked") return bad("Invalid status", 400);

  const { data: inviteRow, error: inviteLookupError } = await sb
    .from("organisation_invites")
    .select("id, organisation_id, email, status")
    .eq("id", id)
    .maybeSingle();

  if (inviteLookupError) return bad(sbErr(inviteLookupError), 400);
  if (!inviteRow) return bad("Invite not found.", 404);

  let revokedRows: any[] = [];
  let removedMembership:
    | {
        removed: boolean;
        user_id: string | null;
        membership: any;
        cleared_active_org: boolean;
      }
    | undefined;

  try {
    if (revokeAllForEmail) {
      revokedRows = await revokePendingInvitesForEmail(
        sb,
        inviteRow.organisation_id,
        normalizeEmail(inviteRow.email)
      );
    } else {
      const { data, error } = await sb
        .from("organisation_invites")
        .update({ status: "revoked" })
        .eq("id", id)
        .eq("status", "pending")
        .select("id, email, status");

      if (error) return bad(sbErr(error), 400);
      revokedRows = data ?? [];

      if (!revokedRows.length && inviteRow.status !== "pending") {
        return bad("Invite not found or not pending.", 404);
      }
    }

    if (removeMember) {
      removedMembership = await removeMembershipForEmail(
        sb,
        inviteRow.organisation_id,
        normalizeEmail(inviteRow.email)
      );
    }
  } catch (e: any) {
    return bad(sbErr(e), 400);
  }

  return ok({
    invite: {
      id: inviteRow.id,
      organisation_id: inviteRow.organisation_id,
      email: inviteRow.email,
      status: "revoked",
    },
    revoked_count: revokedRows.length,
    revoked_invites: revokedRows,
    membership_removed: removedMembership?.removed ?? false,
    removed_membership: removedMembership?.membership ?? null,
    cleared_active_org: removedMembership?.cleared_active_org ?? false,
  });
}