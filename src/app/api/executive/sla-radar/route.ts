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
      .from("exec_approval_cache")
      .select(
        "project_id, project_code, project_title, artifact_id, artifact_type, artifact_title, step_id, stage_key, step_title, approver_label, due_at, sla_status, hours_to_due, hours_overdue"
      )
      .in("sla_status", ["at_risk", "breached", "overdue_undecided"])
      .order("hours_overdue", { ascending: false });

    if (error) throw new Error(error.message);

    const counts = {
      at_risk: (data ?? []).filter((x: any) => x.sla_status === "at_risk").length,
      breached: (data ?? []).filter((x: any) => x.sla_status === "breached").length,
      overdue_undecided: (data ?? []).filter((x: any) => x.sla_status === "overdue_undecided").length,
    };

    return jsonOk({
      headline: `${counts.at_risk + counts.breached + counts.overdue_undecided} approvals at risk/breached`,
      counts,
      items: data ?? [],
    });
  } catch (e: any) {
    return jsonErr("Failed to load SLA radar", 500, { message: e?.message });
  }
}
