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
      .from("exec_approval_bottlenecks")
      .select(
        "approver_label, approver_user_id, approver_group_id, open_steps, breached_steps, at_risk_steps, blocker_score, evidence, computed_at"
      )
      .order("blocker_score", { ascending: false })
      .limit(10);

    if (error) throw new Error(error.message);

    // Provide an executive-grade narrative from data (not opinion)
    const top = (data ?? [])[0];
    const narrative = top
      ? `${top.approver_label} is the primary portfolio bottleneck (score ${top.blocker_score}). ` +
        `${top.open_steps} open approvals, ${top.at_risk_steps} at risk, ${top.breached_steps} breached.`
      : "No bottlenecks detected.";

    return jsonOk({ narrative, top: data ?? [] });
  } catch (e: any) {
    return jsonErr("Failed to calculate blockers", 500, { message: e?.message });
  }
}
