// src/app/api/organisations/[id]/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function noStoreJson(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, status);
}

function err(error: string, status = 400, extra?: Record<string, any>) {
  return noStoreJson({ ok: false, error, ...(extra || {}) }, status);
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function sbErrText(e: any) {
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

/* ---------------- auth helpers ---------------- */

async function requireOrgOwner(sb: any, userId: string, organisationId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const role = safeStr(data?.role).trim().toLowerCase();
  if (role !== "owner") {
    throw new Error("Only the organisation owner can delete the organisation");
  }

  return { role: "owner" as const };
}

/* ---------------- handler ---------------- */

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const sb = await createClient();

    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Not authenticated", 401);

    const userId = safeStr(auth.user.id).trim();
    if (!userId || !isUuid(userId)) return err("Invalid authenticated user", 401);

    const resolvedParams = await params;
    const organisationId = safeStr(resolvedParams?.id).trim();

    if (!organisationId) return err("Missing organisation id", 400);
    if (!isUuid(organisationId)) return err("Invalid organisation id", 400);

    try {
      await requireOrgOwner(sb, userId, organisationId);
    } catch (e: any) {
      return err(e?.message || "Forbidden", 403);
    }

    // Read current active org before delete so we can clean profile context.
    const { data: profileRow, error: profileReadErr } = await sb
      .from("profiles")
      .select("user_id, active_organisation_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileReadErr) {
      return err(`Failed to read profile: ${sbErrText(profileReadErr)}`, 400);
    }

    const activeOrganisationId = safeStr(profileRow?.active_organisation_id).trim();

    // Delete org. Expect FK cascade to remove memberships/invites if configured.
    const { error: delErr } = await sb
      .from("organisations")
      .delete()
      .eq("id", organisationId);

    if (delErr) return err(sbErrText(delErr), 400);

    // If user was currently scoped to this org, clear active org to avoid stale context.
    if (activeOrganisationId === organisationId) {
      const { error: clearErr } = await sb
        .from("profiles")
        .update({ active_organisation_id: null })
        .eq("user_id", userId);

      if (clearErr) {
        return err(
          `Organisation deleted, but failed to clear active organisation: ${sbErrText(clearErr)}`,
          500,
          { deleted: true, organisation_id: organisationId, partial_success: true }
        );
      }
    }

    return ok({
      deleted: true,
      organisation_id: organisationId,
      active_organisation_cleared: activeOrganisationId === organisationId,
    });
  } catch (e: any) {
    return err(e?.message || "Unknown error", 500);
  }
}