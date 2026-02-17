import "server-only";
import { NextResponse, type NextRequest } from "next/server";
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

async function requireAdmin(sb: any, userId: string, organisationId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || String(data.role) !== "admin") throw new Error("Admin permission required");
}

export async function GET(req: Request) {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return err("Not authenticated", 401);

  const url = new URL(req.url);
  const organisationId = safeStr(url.searchParams.get("organisationId")).trim();
  if (!organisationId) return err("Missing organisationId", 400);

  // Admin can see all members; non-admin can still see themselves if you want.
  // We’ll require admin for list to keep it simple:
  try {
    await requireAdmin(sb, auth.user.id, organisationId);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  const { data, error } = await sb
    .from("organisation_members")
    .select("id, organisation_id, user_id, role, created_at")
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
  const role = safeStr(body?.role).trim() as "admin" | "member";

  if (!organisationId || !userId) return err("Missing organisation_id or user_id", 400);
  if (!(role === "admin" || role === "member")) return err("Invalid role", 400);

  try {
    await requireAdmin(sb, auth.user.id, organisationId);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // Prevent removing last admin by demoting the last admin
  if (role === "member") {
    const { count } = await sb
      .from("organisation_members")
      .select("*", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("role", "admin");

    if ((count ?? 0) <= 1) {
      // ensure the target is an admin
      const { data: target } = await sb
        .from("organisation_members")
        .select("role")
        .eq("organisation_id", organisationId)
        .eq("user_id", userId)
        .maybeSingle();
      if (target?.role === "admin") return err("Cannot demote the last admin", 400);
    }
  }

  const { data, error } = await sb
    .from("organisation_members")
    .update({ role })
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .select("id, organisation_id, user_id, role")
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

  try {
    await requireAdmin(sb, auth.user.id, organisationId);
  } catch (e: any) {
    return err(e?.message || "Forbidden", 403);
  }

  // prevent removing last admin
  const { data: target } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (target?.role === "admin") {
    const { count } = await sb
      .from("organisation_members")
      .select("*", { count: "exact", head: true })
      .eq("organisation_id", organisationId)
      .eq("role", "admin");

    if ((count ?? 0) <= 1) return err("Cannot remove the last admin", 400);
  }

  const { error } = await sb
    .from("organisation_members")
    .delete()
    .eq("organisation_id", organisationId)
    .eq("user_id", userId);

  if (error) return err(error.message, 400);
  return ok({ removed: true });
}

