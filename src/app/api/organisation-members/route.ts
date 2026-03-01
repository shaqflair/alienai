// FILE: src/app/api/organisation-members/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

function json(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function ok(data: any)               { return json({ ok: true,  ...data }); }
function bad(error: string, s = 400) { return json({ ok: false, error }, s); }
function safeStr(x: any): string     { return typeof x === "string" ? x : ""; }
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x||"").trim());
}

async function requireAdmin(sb: any, orgId: string, userId: string) {
  const { data } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();
  const role = safeStr(data?.role).toLowerCase();
  return role === "admin" || role === "owner";
}

// -- PATCH: update role ------------------------------------------------------
export async function PATCH(req: Request) {
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr) return bad(authErr.message, 401);
  if (!user)   return bad("Not authenticated", 401);

  const body           = await req.json().catch(() => ({}));
  const organisation_id = safeStr(body?.organisation_id).trim();
  const target_user_id  = safeStr(body?.user_id).trim();
  const role            = safeStr(body?.role).trim().toLowerCase();

  if (!isUuid(organisation_id)) return bad("Invalid organisation_id", 400);
  if (!isUuid(target_user_id))  return bad("Invalid user_id", 400);
  if (role !== "admin" && role !== "member") return bad("Invalid role", 400);

  const isAdmin = await requireAdmin(sb, organisation_id, user.id);
  if (!isAdmin) return bad("Admin access required", 403);

  // Cannot change owner role via this endpoint
  const { data: target } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisation_id)
    .eq("user_id", target_user_id)
    .is("removed_at", null)
    .maybeSingle();

  if (safeStr(target?.role).toLowerCase() === "owner")
    return bad("Cannot change owner role. Use transfer ownership instead.", 400);

  const { error } = await sb
    .from("organisation_members")
    .update({ role })
    .eq("organisation_id", organisation_id)
    .eq("user_id", target_user_id);

  if (error) return bad(error.message, 400);
  return ok({ updated: true, role });
}

// -- DELETE: remove member ---------------------------------------------------
export async function DELETE(req: Request) {
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr) return bad(authErr.message, 401);
  if (!user)   return bad("Not authenticated", 401);

  const body           = await req.json().catch(() => ({}));
  const organisation_id = safeStr(body?.organisation_id).trim();
  const target_user_id  = safeStr(body?.user_id).trim();

  if (!isUuid(organisation_id)) return bad("Invalid organisation_id", 400);
  if (!isUuid(target_user_id))  return bad("Invalid user_id", 400);

  // Cannot remove self
  if (target_user_id === user.id) return bad("Cannot remove yourself", 400);

  const isAdmin = await requireAdmin(sb, organisation_id, user.id);
  if (!isAdmin) return bad("Admin access required", 403);

  // Cannot remove owner
  const { data: target } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisation_id)
    .eq("user_id", target_user_id)
    .is("removed_at", null)
    .maybeSingle();

  if (safeStr(target?.role).toLowerCase() === "owner")
    return bad("Cannot remove the owner. Transfer ownership first.", 400);

  // Soft remove
  const { error } = await sb
    .from("organisation_members")
    .update({ removed_at: new Date().toISOString() })
    .eq("organisation_id", organisation_id)
    .eq("user_id", target_user_id);

  if (error) return bad(error.message, 400);
  return ok({ removed: true });
}