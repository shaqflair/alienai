import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET() {
  try {
    const supabase = await createClient();
    const { data: u, error: ue } = await supabase.auth.getUser();
    if (ue || !u?.user) return jsonErr("Unauthorized", 401);

    const { data, error } = await supabase
      .from("exec_risk_signals")
      .select("project_id, project_code, signal_key, severity, title, summary, entities, evidence, computed_at")
      .eq("is_active", true)
      .order("computed_at", { ascending: false })
      .limit(50);

    if (error) throw new Error(error.message);

    return jsonOk({ items: data ?? [] });
  } catch (e: any) {
    return jsonErr("Failed to load risk signals", 500, { message: e?.message });
  }
}
