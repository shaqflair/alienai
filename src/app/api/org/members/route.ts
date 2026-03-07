// FILE: src/app/api/org/members/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
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

    // Step 1: fetch members
    const { data: members, error: membErr } = await supabase
      .from("organisation_members")
      .select("user_id, job_title, role")
      .eq("organisation_id", activeOrgId)
      .is("removed_at", null)
      .order("user_id")
      .limit(500);

    if (membErr) return jsonErr(membErr.message, 500);
    if (!members?.length) return jsonOk({ members: [] });

    const userIds = members.map((m: any) => m.user_id).filter(Boolean);

    // Step 2: profiles.id = auth uid — do NOT join on user_id column (may not exist)
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name, display_name, email, avatar_url, department, job_title")
      .in("id", userIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [p.id, p]));

    const result = members.map((m: any) => {
      const p: any = profileMap.get(m.user_id) ?? {};
      const full_name = ss(p.full_name).trim() || ss(p.display_name).trim() || "";
      const email     = ss(p.email).trim();
      const job_title = ss(m.job_title).trim() || ss(p.job_title).trim();
      const name      = full_name || email || ss(m.user_id).slice(0, 8);

      return {
        user_id:    ss(m.user_id),
        full_name,
        name,
        email,
        avatar_url: ss(p.avatar_url).trim() || null,
        department: ss(p.department).trim() || null,
        job_title:  job_title || null,
        role:       ss(m.role),
      };
    }).filter((m: any) => m.user_id);

    return jsonOk({ members: result });
  } catch (e: any) {
    console.error("[GET /api/org/members]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}