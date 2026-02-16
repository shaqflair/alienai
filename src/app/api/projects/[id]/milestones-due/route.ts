import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function clampDays(x: string | null, fallback = 30) {
  const n = Number(x);
  if (!Number.isFinite(n)) return fallback;
  const allowed = new Set([7, 14, 30, 60]);
  return allowed.has(n) ? n : fallback;
}

function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();

  // ✅ Next.js 16: params is async
  const { id: projectId } = await params;

  if (!projectId) {
    return NextResponse.json({ ok: false, error: "Missing project id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const days = clampDays(url.searchParams.get("days"), 30);

  const { data, error } = await supabase.rpc("get_schedule_milestones_kpis", {
    p_project_id: projectId,
    p_window_days: days,
  });

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const row = Array.isArray(data) ? data[0] : data;
  const planned = num(row?.planned);

  return NextResponse.json({ ok: true, days, count: planned });
}
