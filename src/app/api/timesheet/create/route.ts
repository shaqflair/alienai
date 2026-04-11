import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

function toMonday(dateStr: string): string {
  const d = new Date(dateStr);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function bad(msg: string, s = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status: s });
}

export async function POST(req: Request) {
  const sb = await createClient();
  const { data: { user }, error: authErr } = await sb.auth.getUser();
  if (authErr || !user) return bad("Not authenticated", 401);

  const orgId = await getActiveOrgId().catch(() => null);
  if (!orgId) return bad("No active organisation", 400);

  const body      = await req.json().catch(() => ({}));
  const weekStart = toMonday(String(body?.week_start_date || new Date().toISOString().slice(0, 10)));

  // Upsert timesheet
  const { data: existing } = await sb
    .from("timesheets")
    .select("id, status")
    .eq("organisation_id", String(orgId))
    .eq("user_id", user.id)
    .eq("week_start_date", weekStart)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ ok: true, timesheetId: existing.id, status: existing.status });
  }

  const { data, error } = await sb
    .from("timesheets")
    .insert({
      organisation_id: String(orgId),
      user_id:         user.id,
      week_start_date: weekStart,
      status:          "draft",
    })
    .select("id")
    .single();

  if (error) return bad(error.message, 400);
  return NextResponse.json({ ok: true, timesheetId: data.id, status: "draft" });
}
