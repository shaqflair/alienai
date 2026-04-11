import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(req: Request) {
  try {
    const supabase  = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const url   = new URL(req.url);
    const orgId = safeStr(url.searchParams.get("orgId")).trim();
    if (!orgId) return NextResponse.json({ ok: false, error: "Missing orgId" }, { status: 400 });

    // Verify membership
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", orgId)
      .eq("user_id", user.id)
      .is("removed_at", null)
      .maybeSingle();
      
    if (!mem) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

    // Attempt to fetch from the latest view first, fallback to the base table
    let roles: string[] = [];
    const searchTargets = ["v_resource_rates_latest", "resource_rates"];
    
    for (const table of searchTargets) {
      const { data, error } = await supabase
        .from(table)
        .select("role_label")
        .eq("organisation_id", orgId)
        .eq("rate_type", "day_rate")
        .is("user_id", null) // Filter for standard roles, not individual overrides
        .order("role_label");

      if (error) {
        console.error(`Error fetching from ${table}:`, error);
        continue;
      }

      if (data && data.length > 0) {
        roles = Array.from(new Set(
          data
            .map((r: any) => safeStr(r.role_label).trim())
            .filter(Boolean)
        )).sort();
        
        if (roles.length > 0) break;
      }
    }

    return NextResponse.json({ ok: true, roles });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Server error" }, { status: 500 });
  }
}
