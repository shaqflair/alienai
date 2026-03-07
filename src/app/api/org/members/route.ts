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
  return Array.from(new Set((values ?? []).map((v) => ss(v).trim()).filter(Boolean)));
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) return null;

  return createAdminClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const qOrgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? "";
    const activeOrgId = qOrgId || (await getActiveOrgId().catch(() => null));
    if (!activeOrgId) return jsonErr("No active organisation", 400);

    const { data: callerMem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", activeOrgId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!callerMem?.role) return jsonErr("Not a member of this organisation", 403);

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
    const profileClient = getAdminClient() ?? supabase;

    // IMPORTANT:
    // Only select columns you confirmed exist in your profiles table.
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

    const result = members
      .map((m: any) => {
        const userId = ss(m.user_id).trim();
        const p = profileMap.get(userId) ?? {};

        const fullName = ss(p.full_name).trim();
        const email = ss(p.email).trim();
        const jobTitle = ss(m.job_title).trim() || ss(p.job_title).trim();
        const role = ss(m.role).trim();

        const name = fullName || email || userId.slice(0, 8);

        return {
          user_id: userId,
          full_name: fullName || null,
          name,
          email: email || null,
          avatar_url: ss(p.avatar_url).trim() || null,
          department: ss(p.department).trim() || null,
          job_title: jobTitle || null,
          role: role || null,
        };
      })
      .filter((m: any) => m.user_id);

    result.sort((a: any, b: any) => ss(a.name).localeCompare(ss(b.name)));

    return jsonOk({ members: result });
  } catch (e: any) {
    console.error("[GET /api/org/members]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}