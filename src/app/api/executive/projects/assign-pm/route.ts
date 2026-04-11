// Assigns a PM to a project — writes project_manager_id

import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ss = (x: any) => typeof x === "string" ? x : x == null ? "" : String(x);

async function getOrgIds(supabase: any, userId: string) {
  const { data } = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(20);
  return Array.from(new Set((data ?? []).map((m: any) => ss(m?.organisation_id)).filter(Boolean)));
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user }, error } = await supabase.auth.getUser();
    if (error || !user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const { project_id, pm_user_id } = body;
    if (!project_id || !pm_user_id) return NextResponse.json({ ok: false, error: "missing_params" }, { status: 400 });

    // Verify the project belongs to one of the user's orgs
    const orgIds = await getOrgIds(supabase, user.id);
    const { data: proj } = await supabase
      .from("projects")
      .select("id, organisation_id")
      .eq("id", project_id)
      .single();

    if (!proj || !orgIds.includes(ss(proj.organisation_id))) {
      return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
    }

    const { error: upErr } = await supabase
      .from("projects")
      .update({ 
        project_manager_id: pm_user_id, 
        updated_at: new Date().toISOString() 
      })
      .eq("id", project_id);

    if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 });
    return NextResponse.json({ ok: true });

  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? String(e) }, { status: 500 });
  }
}
