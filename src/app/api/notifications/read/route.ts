// src/app/api/notifications/read/route.ts
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

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr) return err(authErr.message, 401);
    if (!auth?.user) return err("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));
    const id = String(body?.id || "").trim();
    if (!isUuid(id)) return err("Invalid id", 400);

    // ✅ Update only if it's yours (and only if currently unread to avoid extra writes)
    const { data, error } = await supabase
      .from("notifications")
      .update({
        is_read: true,
        // If your table has updated_at, you can enable this:
        // updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", auth.user.id)
      .eq("is_read", false)
      .select("id")
      .maybeSingle();

    if (error) return err(error.message, 500);

    // If it was already read OR not found/not yours:
    // - We can treat "already read" as ok
    // - But "not yours / missing" should be 404 (cleaner)
    if (!data) {
      // check if it exists + belongs to user (optional, but gives correct semantics)
      const { data: existsRow, error: existsErr } = await supabase
        .from("notifications")
        .select("id,is_read", { head: false })
        .eq("id", id)
        .eq("user_id", auth.user.id)
        .maybeSingle();

      if (existsErr) return err(existsErr.message, 500);

      if (!existsRow) return err("Not found", 404);

      // It exists and is already read
      return ok({ updated: 0, alreadyRead: true });
    }

    return ok({ updated: 1 });
  } catch (e: any) {
    return err(e?.message || "Unexpected error", 500);
  }
}
