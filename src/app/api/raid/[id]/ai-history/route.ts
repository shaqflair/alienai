import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raidId = safeStr(id).trim();
  if (!raidId) return jsonErr("Missing id", 400);

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("raid_ai_runs")
    .select("id,created_at,actor_user_id,model,version,ai_quality,ai,inputs,project_id,raid_item_id")
    .eq("raid_item_id", raidId)
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) return jsonErr(error.message, 400);

  return jsonOk({ runs: data ?? [] });
}
