// src/app/api/notifications/read-all/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const { data, error } = await supabase.rpc("mark_all_notifications_read");
    if (error) return jsonErr(error.message, 500);

    return jsonOk({ updated: Number(data || 0) });
  } catch (e: any) {
    return jsonErr(e?.message || "Unexpected error", 500);
  }
}

