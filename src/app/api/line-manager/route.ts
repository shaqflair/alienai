import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function bad(msg: string, s = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: s });
}
function safeStr(x: unknown): string { return typeof x === "string" ? x : ""; }
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test((x || "").trim());
}
// GET /api/line-manager?q=searchterm&limit=8
// Used by ProfileSetupForm manager search during onboarding
export async function GET(req: Request) {
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return bad("Not authenticated", 401);
  const url   = new URL(req.url);
  const q     = (url.searchParams.get("q") || "").trim();
  const limit = Math.min(10, parseInt(url.searchParams.get("limit") || "8", 10));
  if (q.length < 2) return NextResponse.json({ ok: true, users: [] });
  const { data, error } = await sb
    .from("profiles")
    .select("user_id, full_name, job_title, department, email")
    .or(`full_name.ilike.%${q}%,email.ilike.%${q}%`)
    .eq("is_active", true)
    .neq("user_id", user.id)
    .order("full_name", { ascending: true })
    .limit(limit);
  if (error) return bad(error.message);
  return NextResponse.json({ ok: true, users: Array.isArray(data) ? data : [] });
}
// PATCH /api/line-manager  { target_user_id, manager_user_id | null }
export async function PATCH(req: Request) {
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return bad("Not authenticated", 401);
  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) return bad("No active organisation", 400);
  const { data: mem } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", String(orgId))
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();
  const myRole  = safeStr(mem?.role).toLowerCase();
  const isAdmin = myRole === "admin" || myRole === "owner";
  const body          = await req.json().catch(() => ({}));
  const targetUserId  = safeStr(body?.target_user_id).trim();
  const managerUserId = safeStr(body?.manager_user_id).trim() || null;
  if (!isUuid(targetUserId)) return bad("Invalid target_user_id", 400);
  if (managerUserId && !isUuid(managerUserId)) return bad("Invalid manager_user_id", 400);
  if (targetUserId !== user.id && !isAdmin) return bad("Admin access required", 403);
  if (managerUserId === targetUserId) return bad("Cannot be your own manager", 400);
  const { error } = await sb
    .from("profiles")
    .update({ line_manager_id: managerUserId })
    .eq("user_id", targetUserId);
  if (error) return bad(error.message, 400);
  return NextResponse.json({ ok: true, target_user_id: targetUserId, manager_user_id: managerUserId });
}