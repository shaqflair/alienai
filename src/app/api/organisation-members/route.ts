import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

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

async function hasOrgSupportSession(sb: any, userId: string, organisationId: string, requireWrite: boolean) {
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
    // list members = “manage” action => allow org owner/admin OR support session (read ok)
    await requireOrgOwnerOrAdminOrSupport(sb, auth.user.id, organisationId, false);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  const { data, error } = await sb
    .from("organisation_members")
    .select("id, organisation_id, user_id, role, created_at, removed_at")
    .eq("organisation_id", organisationId)
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
  const userId = safeStr(body?.user_id).trim();
  const role = safeStr(body?.role).trim().toLowerCase() as "admin" | "member";

  if (!organisationId || !userId) return err("Missing organisation_id or user_id", 400);
  if (!isUuid(organisationId) || !isUuid(userId)) return err("Invalid organisation_id or user_id", 400);
  if (!(role === "admin" || role === "member")) return err("Invalid role", 400);

  try {
    // role change = write
    await requireOrgOwnerOrAdminOrSupport(sb, auth.user.id, organisationId, true);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // Prevent demoting the last org owner/admin (stronger than “admin only”)
  if (role === "member") {
    const { data: target, error: tErr } = await sb
      .from("organisation_members")
      .select("role, removed_at")
      .eq("organisation_id", organisationId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();

    if (tErr) return err(tErr.message, 400);

    const targetRole = String(target?.role || "").toLowerCase();
    if (targetRole === "owner" || targetRole === "admin") {
      const { count, error: cErr } = await sb
        .from("organisation_members")
        .select("*", { count: "exact", head: true })
        .eq("organisation_id", organisationId)
        .is("removed_at", null)
        .in("role", ["owner", "admin"]);

      if (cErr) return err(cErr.message, 400);
      if ((count ?? 0) <= 1) return err("Cannot demote the last owner/admin", 400);
    }
  }

  const { data, error } = await sb
    .from("organisation_members")
    .update({ role })
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
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
  const userId = safeStr(url.searchParams.get("userId")).trim();
  if (!organisationId || !userId) return err("Missing organisationId or userId", 400);
  if (!isUuid(organisationId) || !isUuid(userId)) return err("Invalid organisationId or userId", 400);

  try {
    // removal = write
    await requireOrgOwnerOrAdminOrSupport(sb, auth.user.id, organisationId, true);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // Prevent removing the last owner/admin
  const { data: target, error: tErr } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (tErr) return err(tErr.message, 400);

  const targetRole = String(target?.role || "").toLowerCase();
  if (targetRole === "owner" || targetRole === "admin") {
    const { count, error: cErr } = await sb
      .from("organisation_members")
      .select("*", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .is("removed_at", null)
      .in("role", ["owner", "admin"]);

    if (cErr) return err(cErr.message, 400);
    if ((count ?? 0) <= 1) return err("Cannot remove the last owner/admin", 400);
  }

  const { error } = await sb
    .from("organisation_members")
    .delete()
    .eq("organisation_id", organisationId)
    .eq("user_id", userId);

  if (error) return err(error.message, 400);
  return ok({ removed: true });
}
