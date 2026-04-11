import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function json(data: unknown, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function bad(msg: string, status = 400) {
  return json({ ok: false, error: msg }, status);
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function normalizeLimit(x: string): number {
  const n = Number.parseInt(x || "8", 10);
  if (!Number.isFinite(n)) return 8;
  return Math.max(1, Math.min(10, n));
}

// GET /api/line-manager?q=searchterm&limit=8
// Returns active members in the same organisation only.
export async function GET(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await sb.auth.getUser();

  if (authErr || !user) return bad("Not authenticated", 401);

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) return bad("No active organisation", 400);

  const url = new URL(req.url);
  const q = safeStr(url.searchParams.get("q")).trim();
  const limit = normalizeLimit(safeStr(url.searchParams.get("limit")));

  const { data: members, error: membersErr } = await sb
    .from("organisation_members")
    .select("user_id, job_title, department")
    .eq("organisation_id", String(orgId))
    .is("removed_at", null);

  if (membersErr) return bad(membersErr.message, 400);

  const memberUserIds = Array.from(
    new Set(
      (members ?? [])
        .map((m: any) => safeStr(m?.user_id).trim())
        .filter((id) => id && id !== user.id)
    )
  );

  if (!memberUserIds.length) {
    return json({ ok: true, users: [] });
  }

  const { data: profiles, error: profilesErr } = await sb
    .from("profiles")
    .select("user_id, full_name, email")
    .in("user_id", memberUserIds)
    .eq("is_active", true);

  if (profilesErr) return bad(profilesErr.message, 400);

  const memberByUserId = new Map<string, any>(
    (members ?? []).map((m: any) => [safeStr(m?.user_id).trim(), m])
  );

  const needle = q.toLowerCase();

  const users = (profiles ?? [])
    .map((p: any) => {
      const userId = safeStr(p?.user_id).trim();
      const member = memberByUserId.get(userId);

      return {
        user_id: userId,
        full_name: safeStr(p?.full_name).trim() || safeStr(p?.email).trim() || "Unnamed user",
        job_title:
          typeof member?.job_title === "string" && member.job_title.trim()
            ? member.job_title.trim()
            : null,
        department:
          typeof member?.department === "string" && member.department.trim()
            ? member.department.trim()
            : null,
        email: safeStr(p?.email).trim() || null,
      };
    })
    .filter((u) => {
      if (!q) return true;
      const hay = [u.full_name, u.email || "", u.job_title || "", u.department || ""]
        .join(" ")
        .toLowerCase();
      return hay.includes(needle);
    })
    .sort((a, b) => a.full_name.localeCompare(b.full_name))
    .slice(0, limit);

  return json({ ok: true, users });
}

// PATCH /api/line-manager
// { target_user_id, manager_user_id | null }
export async function PATCH(req: Request) {
  const sb = await createClient();
  const {
    data: { user },
    error: authErr,
  } = await sb.auth.getUser();

  if (authErr || !user) return bad("Not authenticated", 401);

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) return bad("No active organisation", 400);

  const { data: myMembership, error: myMembershipErr } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", String(orgId))
    .eq("user_id", user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (myMembershipErr) return bad(myMembershipErr.message, 400);

  const myRole = safeStr(myMembership?.role).toLowerCase();
  const isAdmin = myRole === "admin" || myRole === "owner";

  const body = await req.json().catch(() => ({}));
  const targetUserId = safeStr(body?.target_user_id).trim();
  const managerUserId = safeStr(body?.manager_user_id).trim() || null;

  if (!isUuid(targetUserId)) return bad("Invalid target_user_id", 400);
  if (managerUserId && !isUuid(managerUserId)) return bad("Invalid manager_user_id", 400);
  if (targetUserId !== user.id && !isAdmin) return bad("Admin access required", 403);
  if (managerUserId === targetUserId) return bad("Cannot be your own manager", 400);

  const { data: targetMembership, error: targetMembershipErr } = await sb
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", String(orgId))
    .eq("user_id", targetUserId)
    .is("removed_at", null)
    .maybeSingle();

  if (targetMembershipErr) return bad(targetMembershipErr.message, 400);
  if (!targetMembership) return bad("Target user is not an active member of this organisation", 404);

  if (managerUserId) {
    const { data: managerMembership, error: managerMembershipErr } = await sb
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", String(orgId))
      .eq("user_id", managerUserId)
      .is("removed_at", null)
      .maybeSingle();

    if (managerMembershipErr) return bad(managerMembershipErr.message, 400);
    if (!managerMembership) return bad("Manager must be an active member of this organisation", 404);
  }

  const { error } = await sb
    .from("profiles")
    .update({ line_manager_id: managerUserId })
    .eq("user_id", targetUserId);

  if (error) return bad(error.message, 400);

  return json({
    ok: true,
    target_user_id: targetUserId,
    manager_user_id: managerUserId,
  });
}