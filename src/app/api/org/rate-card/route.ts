import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(d: any) {
  const res = NextResponse.json({ ok: true, ...d });
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

    const orgId    = req.nextUrl.searchParams.get("orgId")?.trim()    ?? "";
    const userId   = req.nextUrl.searchParams.get("userId")?.trim()   ?? "";

    if (!orgId)  return jsonErr("orgId is required");
    if (!userId) return jsonErr("userId is required");

    // 1. Person-specific rate
    const { data: personal } = await supabase
      .from("v_resource_rates_latest")
      .select("rate_type, rate, currency, resource_type, role_label")
      .eq("organisation_id", orgId)
      .eq("user_id", userId)
      .order("effective_from", { ascending: false })
      .limit(1);

    if (personal?.[0]) {
      return jsonOk({ match: personal[0] });
    }

    // 2. Role-based fallback — need user's job_title to match role_label
    const { data: profile } = await supabase
      .from("profiles")
      .select("job_title")
      .eq("user_id", userId)
      .maybeSingle();

    const jobTitle = ss(profile?.job_title).trim().toLowerCase();

    if (jobTitle) {
      const { data: roleRates } = await supabase
        .from("v_resource_rates_latest")
        .select("rate_type, rate, currency, resource_type, role_label")
        .eq("organisation_id", orgId)
        .is("user_id", null)
        .order("effective_from", { ascending: false });

      const match = (roleRates ?? []).find(
        (r: any) => ss(r.role_label).toLowerCase() === jobTitle
      );

      if (match) return jsonOk({ match });
    }

    return jsonOk({ match: null });
  } catch (e: any) {
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}