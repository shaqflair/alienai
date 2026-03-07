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

    // Accept orgId from query param, fall back to active org
    const qOrgId = req.nextUrl.searchParams.get("orgId")?.trim() ?? "";
    const activeOrgId = qOrgId || (await getActiveOrgId().catch(() => null));
    if (!activeOrgId) return jsonErr("No active organisation", 400);

    // Confirm caller is a member of this org
    const { data: callerMem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", activeOrgId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (!callerMem?.role) return jsonErr("Not a member of this organisation", 403);

    // Fetch active members with their profile
    const { data: rows, error } = await supabase
      .from("organisation_members")
      .select(`
        user_id,
        job_title,
        profiles:user_id (
          full_name,
          display_name,
          email
        )
      `)
      .eq("organisation_id", activeOrgId)
      .is("removed_at", null)
      .order("user_id", { ascending: true })
      .limit(500);

    if (error) return jsonErr(error.message, 500);

    const members = (rows ?? []).map((r: any) => {
      const p = r.profiles as any;
      const name =
        ss(p?.full_name).trim()    ||
        ss(p?.display_name).trim() ||
        ss(p?.email).trim()        ||
        ss(r.user_id).slice(0, 8);
      const email = ss(p?.email).trim();

      return {
        user_id:   ss(r.user_id),
        name,
        email,
        job_title: ss(r.job_title).trim(),
      };
    }).filter((m: any) => m.user_id);

    return jsonOk({ members });
  } catch (e: any) {
    console.error("[GET /api/org/members]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}