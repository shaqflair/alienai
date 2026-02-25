import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

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

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

type OrgRole = "owner" | "admin" | "member";

/* =========================
   Support / permission helpers
========================= */

async function isPlatformAdmin(sb: any, userId: string) {
  const { data, error } = await sb
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data?.user_id;
}

async function hasOrgSupportSession(
  sb: any,
  userId: string,
  organisationId: string,
  requireWrite: boolean
) {
  const { data, error } = await sb
    .from("support_sessions")
    .select("id, mode, expires_at, revoked_at")
    .eq("platform_admin_user_id", userId)
    .eq("organisation_id", organisationId)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data?.id) return false;

  if (requireWrite) return String(data.mode || "").toLowerCase() === "write";
  return true;
}

async function requireOrgOwnerOrAdminOrSupport(
  sb: any,
  userId: string,
  organisationId: string,
  requireWrite: boolean
) {
  // 1) Normal org membership check (owner/admin)
  const { data: mem, error: memErr } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);

  const role = String(mem?.role || "").toLowerCase();
  if (role === "owner" || role === "admin") return;

  // 2) Support-mode fallback (platform admin + active support session)
  const pa = await isPlatformAdmin(sb, userId);
  if (!pa) throw new Error("Forbidden");

  const allowed = await hasOrgSupportSession(sb, userId, organisationId, requireWrite);
  if (!allowed) throw new Error(requireWrite ? "Support write session required" : "Support session required");
}

/* =========================
   Helpers
========================= */

function normRole(x: any): OrgRole {
  const v = String(x || "").trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

async function getActiveMembership(sb: any, organisationId: string, userId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("organisation_id, user_id, role, removed_at, created_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

async function getOwnerUserId(sb: any, organisationId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", organisationId)
    .is("removed_at", null)
    .eq("role", "owner")
    .maybeSingle();

  if (error) throw error;
  return safeStr(data?.user_id).trim();
}

/* =========================
   Handlers
========================= */

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return err("Not authenticated", 401);

  const url = new URL(req.url);
  const organisationId = safeStr(url.searchParams.get("organisationId")).trim();
  if (!organisationId) return err("Missing organisationId", 400);
  if (!isUuid(organisationId)) return err("Invalid organisationId", 400);

  try {
    // list members => allow org owner/admin OR support session (read ok)
    await requireOrgOwnerOrAdminOrSupport(sb, auth.user.id, organisationId, false);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // Only active members by default (single-owner governance + soft remove)
  const { data, error } = await sb
    .from("organisation_members")
    .select("id, organisation_id, user_id, role, created_at, removed_at")
    .eq("organisation_id", organisationId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (error) return err(error.message, 400);
  return ok({ items: data ?? [] });
}

export async function PATCH(req: Request) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return err("Not authenticated", 401);

  const body = await req.json().catch(() => ({}));
  const organisationId = safeStr(body?.organisation_id).trim();
  const targetUserId = safeStr(body?.user_id).trim();
  const newRole = normRole(body?.role);

  if (!organisationId || !targetUserId) return err("Missing organisation_id or user_id", 400);
  if (!isUuid(organisationId) || !isUuid(targetUserId)) return err("Invalid organisation_id or user_id", 400);

  // IMPORTANT: ownership is transferred only via RPC in settings page, not here
  if (newRole === "owner") return err("Cannot assign owner via members API. Use ownership transfer.", 400);

  try {
    // role change = write
    await requireOrgOwnerOrAdminOrSupport(sb, auth.user.id, organisationId, true);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // Target must be an active member
  let target: any = null;
  try {
    target = await getActiveMembership(sb, organisationId, targetUserId);
  } catch (e: any) {
    return err(e?.message || "Failed to load target membership", 400);
  }
  if (!target) return err("Target user is not an active member of this organisation", 404);

  const targetRole = normRole(target.role);

  // Never allow demoting the owner (single-owner)
  if (targetRole === "owner") return err("Cannot change the organisation owner role here. Transfer ownership instead.", 400);

  const { data, error } = await sb
    .from("organisation_members")
    .update({ role: newRole })
    .eq("organisation_id", organisationId)
    .eq("user_id", targetUserId)
    .is("removed_at", null)
    .select("id, organisation_id, user_id, role, removed_at")
    .single();

  if (error) return err(error.message, 400);
  return ok({ member: data });
}

export async function DELETE(req: Request) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return err("Not authenticated", 401);

  const url = new URL(req.url);
  const organisationId = safeStr(url.searchParams.get("organisationId")).trim();
  const targetUserId = safeStr(url.searchParams.get("userId")).trim();
  if (!organisationId || !targetUserId) return err("Missing organisationId or userId", 400);
  if (!isUuid(organisationId) || !isUuid(targetUserId)) return err("Invalid organisationId or userId", 400);

  try {
    // removal = write
    await requireOrgOwnerOrAdminOrSupport(sb, auth.user.id, organisationId, true);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // Target must be active
  let target: any = null;
  try {
    target = await getActiveMembership(sb, organisationId, targetUserId);
  } catch (e: any) {
    return err(e?.message || "Failed to load target membership", 400);
  }
  if (!target) return err("Target user is not an active member of this organisation", 404);

  const targetRole = normRole(target.role);

  // Protect the single owner (cannot be removed)
  if (targetRole === "owner") {
    return err("Cannot remove the organisation owner. Transfer ownership first.", 400);
  }

  // Soft-remove membership (keep audit trail)
  const { error } = await sb
    .from("organisation_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("organisation_id", organisationId)
    .eq("user_id", targetUserId)
    .is("removed_at", null);

  if (error) return err(error.message, 400);
  return ok({ removed: true });
}