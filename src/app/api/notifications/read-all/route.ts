// src/app/api/notifications/read-all/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error: message, ...(meta ? { meta } : {}) }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function POST() {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Unauthorized", 401);

    // ✅ Mark all unread as read (no need to select rows back)
    const { error } = await supabase
      .from("notifications")
      .update({
        is_read: true,
        // ✅ If your table has updated_at, keep this (harmless if column doesn't exist? -> would error).
        // updated_at: new Date().toISOString(),
      })
      .eq("user_id", auth.user.id)
      .eq("is_read", false);

    if (error) return err(error.message, 500);

    // We intentionally don't return row IDs (faster, safer)
    return ok({ updated: true });
  } catch (e: any) {
    return err(e?.message || "Unexpected error", 500);
  }
}
