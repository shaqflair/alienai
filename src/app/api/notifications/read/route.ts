// src/app/api/notifications/read/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return jsonErr(authErr.message, 401);
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!isUuid(id)) return jsonErr("Invalid id", 400);

    // If you created the RPC earlier, use it:
    const { data, error } = await supabase.rpc("mark_notification_read", { p_notification_id: id });
    if (error) return jsonErr(error.message, 500);

    return jsonOk({ updated: Boolean(data) });
  } catch (e: any) {
    return jsonErr(e?.message || "Unexpected error", 500);
  }
}
