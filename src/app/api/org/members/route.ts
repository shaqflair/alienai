// FILE: src/app/api/org/members/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type OrgRole = "owner" | "admin" | "member";

function jsonOk(data: Record<string, any> = {}, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(error: string, status = 400, extra?: Record<string, any>) {
  const res = NextResponse.json({ ok: false, error, ...(extra || {}) }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ss(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqueStrings(values: unknown[]) {
  return Array.from(new Set((values ?? []).map((v) => ss(v).trim()).filter(Boolean)));
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(x || "").trim()
  );
}

function normalizeRole(x: unknown): OrgRole {
  const v = ss(x).trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const userId = ss(auth.user.id).trim();
    if (!userId || !isUuid(userId)) return jsonErr("Invalid authenticated user", 401);

    const qOrgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? "";
    const activeOrgId = qOrgId || (await getActiveOrgId().catch(() => null)) || "";

    if (!activeOrgId) return jsonErr("No active organisation", 400);
    if (!isUuid(activeOrgId)) return jsonErr("Invalid organisation id", 400);

    const { data: callerMem, error: callerErr } = await supabase
      .from("organisation_members")
      .select("role, removed_at")
      .eq("organisation_id", activeOrgId)
      .eq("user_id", userId)
      .is("removed_at", null)
      .maybeSingle();

    if (callerErr) return jsonErr(callerErr.message, 500);
    if (!callerMem?.role) return jsonErr("Not a member of this organisation", 403);

    const callerRole = normalizeRole(callerMem.role);

    const { data: members, error: membErr } = await supabase
      .from("organisation_members")
      .select("user_id, job_title, role")
      .eq("organisation_id", activeOrgId)
      .is("removed_at", null)
      .order("user_id")
      .limit(500);

    if (membErr) return jsonErr(membErr.message, 500);
    if (!members?.length) {
      return jsonOk({
        organisation_id: activeOrgId,
        caller_role: callerRole,
        members: [],
      });
    }

    const userIds = uniqueStrings(members.map((m: any) => m.user_id));
    const profileClient = getAdminClient() ?? supabase;

    // Keep this aligned with actual columns in profiles.
    const selectCols = "id, user_id, full_name, email, avatar_url, department, job_title";

    const [{ data: profilesByUserId, error: byUserErr }, { data: profilesById, error: byIdErr }] =
      await Promise.all([
        profileClient.from("profiles").select(selectCols).in("user_id", userIds),
        profileClient.from("profiles").select(selectCols).in("id", userIds),
      ]);

    if (byUserErr) {
      console.warn("[GET /api/org/members] profiles by user_id lookup failed:", byUserErr.message);
    }
    if (byIdErr) {
      console.warn("[GET /api/org/members] profiles by id lookup failed:", byIdErr.message);
    }

    const profileMap = new Map<string, any>();

    for (const p of [...(profilesByUserId ?? []), ...(profilesById ?? [])]) {
      const pid = ss(p?.id).trim();
      const puid = ss(p?.user_id).trim();
      if (pid) profileMap.set(pid, p);
      if (puid) profileMap.set(puid, p);
    }

    const result = (members ?? [])
      .map((m: any) => {
        const memberUserId = ss(m?.user_id).trim();
        if (!memberUserId) return null;

        const p = profileMap.get(memberUserId) ?? {};

        const fullName = ss(p?.full_name).trim();
        const email = ss(p?.email).trim();
        const membershipJobTitle = ss(m?.job_title).trim();
        const profileJobTitle = ss(p?.job_title).trim();
        const jobTitle = membershipJobTitle || profileJobTitle || null;
        const role = normalizeRole(m?.role);

        const name = fullName || email || memberUserId.slice(0, 8);

        return {
          user_id: memberUserId,
          full_name: fullName || null,
          name,
          email: email || null,
          avatar_url: ss(p?.avatar_url).trim() || null,
          department: ss(p?.department).trim() || null,
          job_title: jobTitle,
          role,
        };
      })
      .filter(Boolean) as Array<{
      user_id: string;
      full_name: string | null;
      name: string;
      email: string | null;
      avatar_url: string | null;
      department: string | null;
      job_title: string | null;
      role: OrgRole;
    }>;

    result.sort((a, b) => a.name.localeCompare(b.name));

    return jsonOk({
      organisation_id: activeOrgId,
      caller_role: callerRole,
      members: result,
    });
  } catch (e: any) {
    console.error("[GET /api/org/members]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}