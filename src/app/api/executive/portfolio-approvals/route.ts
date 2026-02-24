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

    // auth (exec cockpit is member-gated by RLS)
    const { data: u, error: ue } = await supabase.auth.getUser();
    if (ue || !u?.user) return jsonErr("Unauthorized", 401);

    const { data, error } = await supabase
      .from("exec_portfolio_approval_heatmap_mv")
      .select("project_id, computed_at, open_approvals, breached, at_risk, ok, rag")
      .order("breached", { ascending: false });

    if (error) throw new Error(error.message);

    // enrich with project meta
    const projectIds = (data ?? []).map((x: any) => x.project_id);
    const { data: projects } = await supabase
      .from("projects")
      .select("id, project_code, title")
      .in("id", projectIds);

    const meta = new Map<string, any>();
    for (const p of projects ?? []) meta.set(p.id, p);

    const items = (data ?? []).map((row: any) => ({
      ...row,
      project_code: meta.get(row.project_id)?.project_code ?? null,
      project_title: meta.get(row.project_id)?.title ?? null,
    }));

    return jsonOk({ items });
  } catch (e: any) {
    return jsonErr("Failed to load portfolio approvals", 500, { message: e?.message });
  }
}
