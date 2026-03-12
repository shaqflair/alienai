// FILE: src/app/api/organisation-members/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function json(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ok(data: any = {}, status = 200) {
  return json({ ok: true, ...data }, status);
}

function bad(error: string, status = 400, extra?: Record<string, any>) {
  return json({ ok: false, error, ...(extra || {}) }, status);
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

type OrgRole = "owner" | "admin" | "member";

function normalizeRole(x: unknown): OrgRole {
  const v = safeStr(x).trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
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

async function getActiveMembership(sb: any, organisationId: string, userId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("organisation_id, user_id, role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ?? null;
}

async function requireAdmin(sb: any, organisationId: string, userId: string) {
  const data = await getActiveMembership(sb, organisationId, userId);
  const role = normalizeRole(data?.role);
  return role === "admin" || role === "owner";
}

/* ---------------- PATCH: update role ---------------- */

export async function PATCH(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await sb.auth.getUser();

    if (authErr) return bad(authErr.message, 401);
    if (!user) return bad("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));

    const organisationId = safeStr((body as any)?.organisation_id).trim();
    const targetUserId = safeStr((body as any)?.user_id).trim();
    const nextRoleRaw = safeStr((body as any)?.role).trim().toLowerCase();

    if (!isUuid(organisationId)) return bad("Invalid organisation_id", 400);
    if (!isUuid(targetUserId)) return bad("Invalid user_id", 400);
    if (nextRoleRaw !== "admin" && nextRoleRaw !== "member") {
      return bad("Invalid role", 400);
    }

    const isAdmin = await requireAdmin(sb, organisationId, user.id);
    if (!isAdmin) return bad("Admin access required", 403);

    const target = await getActiveMembership(sb, organisationId, targetUserId);
    if (!target) return bad("Target member not found", 404);

    const targetRole = normalizeRole(target.role);
    if (targetRole === "owner") {
      return bad("Cannot change owner role. Use transfer ownership instead.", 400);
    }

    const nextRole = normalizeRole(nextRoleRaw);
    if (targetRole === nextRole) {
      return ok({ updated: true, unchanged: true, role: nextRole });
    }

    const { error } = await sb
      .from("organisation_members")
      .update({ role: nextRole })
      .eq("organisation_id", organisationId)
      .eq("user_id", targetUserId)
      .is("removed_at", null);

    if (error) return bad(sbErrText(error), 400);

    return ok({
      updated: true,
      organisation_id: organisationId,
      user_id: targetUserId,
      role: nextRole,
    });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}

/* ---------------- DELETE: remove member ---------------- */

export async function DELETE(req: Request) {
  try {
    const sb = await createClient();
    const {
      data: { user },
      error: authErr,
    } = await sb.auth.getUser();

    if (authErr) return bad(authErr.message, 401);
    if (!user) return bad("Not authenticated", 401);

    // Support both querystring delete calls and JSON body delete calls.
    const url = new URL(req.url);

    let body: Record<string, any> = {};
    try {
      body = await req.json();
    } catch {
      body = {};
    }

    const organisationId = safeStr(
      body.organisation_id ?? body.organisationId ?? url.searchParams.get("organisation_id") ?? url.searchParams.get("organisationId")
    ).trim();

    const targetUserId = safeStr(
      body.user_id ?? body.userId ?? url.searchParams.get("user_id") ?? url.searchParams.get("userId")
    ).trim();

    if (!isUuid(organisationId)) return bad("Invalid organisation_id", 400);
    if (!isUuid(targetUserId)) return bad("Invalid user_id", 400);

    if (targetUserId === user.id) {
      return bad("Cannot remove yourself. Use leave organisation instead.", 400);
    }

    const isAdmin = await requireAdmin(sb, organisationId, user.id);
    if (!isAdmin) return bad("Admin access required", 403);

    const target = await getActiveMembership(sb, organisationId, targetUserId);
    if (!target) return bad("Target member not found", 404);

    const targetRole = normalizeRole(target.role);
    if (targetRole === "owner") {
      return bad("Cannot remove the owner. Transfer ownership first.", 400);
    }

    const { error } = await sb
      .from("organisation_members")
      .update({ removed_at: new Date().toISOString() })
      .eq("organisation_id", organisationId)
      .eq("user_id", targetUserId)
      .is("removed_at", null);

    if (error) return bad(sbErrText(error), 400);

    return ok({
      removed: true,
      organisation_id: organisationId,
      user_id: targetUserId,
    });
  } catch (e: any) {
    return bad(e?.message || "Unknown error", 500);
  }
}