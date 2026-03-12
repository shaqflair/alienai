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
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: Record<string, any> = {}, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}

function err(error: string, status = 400, extra?: Record<string, any>) {
  return noStoreJson({ ok: false, error, ...(extra || {}) }, status);
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeLower(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function normaliseInviteRole(x: unknown): "admin" | "member" {
  const r = safeLower(x);
  return r === "admin" ? "admin" : "member";
}

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();

    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Not authenticated", 401);

    const userId = safeStr(auth.user.id).trim();
    const myEmail = safeLower(auth.user.email);

    if (!userId || !isUuid(userId)) return err("Invalid authenticated user", 401);
    if (!myEmail) return err("User email missing", 400);

    const body = await req.json().catch(() => ({}));
    const token = safeStr((body as any)?.token).trim();

    if (!token) return err("Missing token", 400);

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !serviceKey) {
      return err("Server misconfigured (missing service role env)", 500);
    }

    const admin = createAdminClient(url, serviceKey);

    const { data: inv, error: invErr } = await admin
      .from("organisation_invites")
      .select(
        "id, organisation_id, email, role, status, expires_at, accepted_at, accepted_by"
      )
      .eq("token", token)
      .maybeSingle();

    if (invErr) return err(invErr.message, 400);
    if (!inv) return err("Invite not found", 404);

    const organisationId = safeStr(inv.organisation_id).trim();
    if (!organisationId || !isUuid(organisationId)) {
      return err("Invite is linked to an invalid organisation", 400);
    }

    const invEmail = safeLower(inv.email);
    if (invEmail && invEmail !== myEmail) {
      return err("Invite email mismatch", 403);
    }

    if (inv.expires_at && new Date(inv.expires_at).getTime() < Date.now()) {
      return err("Invite expired", 400);
    }

    const role = normaliseInviteRole(inv.role);

    // Idempotent path:
    // If invite is already accepted, still make sure membership exists and
    // the user's active org is switched correctly.
    if (safeLower(inv.status) === "accepted") {
      const { data: existingMember, error: existingMemberErr } = await admin
        .from("organisation_members")
        .select("organisation_id, user_id, role, removed_at")
        .eq("organisation_id", organisationId)
        .eq("user_id", userId)
        .is("removed_at", null)
        .maybeSingle();

      if (existingMemberErr) return err(existingMemberErr.message, 400);

      if (!existingMember) {
        const { error: restoreErr } = await admin
          .from("organisation_members")
          .upsert(
            {
              organisation_id: organisationId,
              user_id: userId,
              role,
              removed_at: null,
            },
            { onConflict: "organisation_id,user_id" }
          );

        if (restoreErr) return err(restoreErr.message, 400);
      }

      const { error: profileErr } = await admin
        .from("profiles")
        .update({ active_organisation_id: organisationId })
        .eq("user_id", userId);

      if (profileErr) {
        return err("Invite was accepted, but failed to switch active organisation", 500, {
          organisation_id: organisationId,
        });
      }

      return ok({
        accepted: true,
        already_accepted: true,
        organisation_id: organisationId,
        role,
      });
    }

    if (safeLower(inv.status) !== "pending") {
      return err(`Invite is ${safeStr(inv.status) || "not usable"}`, 400);
    }

    // Ensure membership exists before marking the invite as accepted.
    // This prevents "accepted" invites with no actual org membership.
    const { error: upErr } = await admin
      .from("organisation_members")
      .upsert(
        {
          organisation_id: organisationId,
          user_id: userId,
          role,
          removed_at: null,
        },
        { onConflict: "organisation_id,user_id" }
      );

    if (upErr) return err(upErr.message, 400);

    // Set the user's active organisation immediately after membership creation.
    // This is critical for org-scoped dashboards and portfolio queries.
    const { error: profileErr } = await admin
      .from("profiles")
      .update({ active_organisation_id: organisationId })
      .eq("user_id", userId);

    if (profileErr) {
      return err("Membership created, but failed to switch active organisation", 500, {
        organisation_id: organisationId,
      });
    }

    const { data: upd, error: accErr } = await admin
      .from("organisation_invites")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        accepted_by: userId,
      })
      .eq("id", inv.id)
      .eq("status", "pending")
      .select("id")
      .maybeSingle();

    if (accErr) return err(accErr.message, 400);

    // If another request accepted it first, treat it as success as long as
    // membership and active org were already completed above.
    if (!upd) {
      return ok({
        accepted: true,
        race_recovered: true,
        organisation_id: organisationId,
        role,
      });
    }

    return ok({
      accepted: true,
      organisation_id: organisationId,
      role,
    });
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}