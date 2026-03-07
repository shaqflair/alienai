// FILE: src/app/api/org/members/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(d: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...d }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function jsonErr(e: string, s = 400) {
  const res = NextResponse.json({ ok: false, error: e }, { status: s });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function ss(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqueStrings(values: any[]) {
  return Array.from(
    new Set(
      (values ?? [])
        .map((v) => ss(v).trim())
        .filter(Boolean),
    ),
  );
}

// Service-role client bypasses RLS so we can read all profiles
function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function fetchProfiles(profileClient: any, userIds: string[]) {
  const ids = uniqueStrings(userIds);
  if (!ids.length) return [];

  const baseSelect =
    "id, user_id, full_name, display_name, name, email, avatar_url, department, job_title";

  // Try lookup by profiles.user_id first
  const { data: byUserId, error: byUserIdErr } = await profileClient
    .from("profiles")
    .select(baseSelect)
    .in("user_id", ids);

  if (byUserIdErr) {
    console.warn("[GET /api/org/members] profiles by user_id lookup failed:", byUserIdErr.message);
  }

  // Then also lookup by profiles.id for schemas where profile PK == auth user id
  const { data: byId, error: byIdErr } = await profileClient
    .from("profiles")
    .select(baseSelect)
    .in("id", ids);

  if (byIdErr) {
    console.warn("[GET /api/org/members] profiles by id lookup failed:", byIdErr.message);
  }

  return [...(byUserId ?? []), ...(byId ?? [])];
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const qOrgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? "";
    const activeOrgId = qOrgId || (await getActiveOrgId().catch(() => null));
    if (!activeOrgId) return jsonErr("No active organisation", 400);

    // Confirm caller is a member
    const { data: callerMem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", activeOrgId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!callerMem?.role) return jsonErr("Not a member of this organisation", 403);

    // Step 1: fetch org members
    const { data: members, error: membErr } = await supabase
      .from("organisation_members")
      .select("user_id, job_title, role")
      .eq("organisation_id", activeOrgId)
      .is("removed_at", null)
      .order("user_id")
      .limit(500);

    if (membErr) return jsonErr(membErr.message, 500);
    if (!members?.length) return jsonOk({ members: [] });

    const userIds = uniqueStrings(members.map((m: any) => m.user_id));

    // Step 2: fetch profiles — use service-role client to bypass RLS
    // and support both profiles.user_id and profiles.id schemas
    const profileClient = getAdminClient() ?? supabase;
    const profiles = await fetchProfiles(profileClient, userIds);

    const profileMap = new Map<string, any>();

    for (const p of profiles ?? []) {
      const byUserId = ss(p?.user_id).trim();
      const byId = ss(p?.id).trim();

      if (byUserId && !profileMap.has(byUserId)) profileMap.set(byUserId, p);
      if (byId && !profileMap.has(byId)) profileMap.set(byId, p);
    }

    const result = members
      .map((m: any) => {
        const userId = ss(m.user_id).trim();
        const p: any = profileMap.get(userId) ?? {};

        const full_name =
          ss(p.full_name).trim() ||
          ss(p.display_name).trim() ||
          ss(p.name).trim() ||
          "";

        const email = ss(p.email).trim();
        const job_title = ss(m.job_title).trim() || ss(p.job_title).trim();

        const name = full_name || email || userId.slice(0, 8);

        return {
          user_id: userId,
          full_name,
          name,
          email,
          avatar_url: ss(p.avatar_url).trim() || null,
          department: ss(p.department).trim() || null,
          job_title: job_title || null,
          role: ss(m.role).trim(),
        };
      })
      .filter((m: any) => m.user_id);

    // Optional: nicer ordering in the picker
    result.sort((a: any, b: any) => {
      const an = ss(a.name).toLowerCase();
      const bn = ss(b.name).toLowerCase();
      return an.localeCompare(bn);
    });

    return jsonOk({ members: result });
  } catch (e: any) {
    console.error("[GET /api/org/members]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}