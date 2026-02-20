import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

/* =========================================================
   Helpers
========================================================= */

function ok(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

function err(message: string, status = 400, meta?: any) {
  const res = NextResponse.json(
    { ok: false, error: message, ...(meta ? { meta } : {}) },
    { status }
  );
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

const DEV = process.env.NODE_ENV === "development";

/* =========================================================
   POST — create test notification (safe for prod)
========================================================= */

export async function POST() {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();

  if (authErr || !auth?.user) {
    return err("Not authenticated", 401, {
      authErr: authErr?.message || null,
    });
  }

  const userId = auth.user.id;

  // ======================================================
  // Env sanity check (prevents silent failures in prod)
  // ======================================================

  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "";

  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !hasServiceKey) {
    return err("Missing Supabase service configuration", 500, {
      hasUrl: Boolean(url),
      hasServiceKey,
      expected: [
        "SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
      ],
    });
  }

  // ======================================================
  // Optional: pick any active project membership
  // ======================================================

  const { data: mem, error: memErr } = await sb
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();

  if (memErr) {
    if (DEV) console.error("[notifications.test] membership read error:", memErr);
    return err("Failed to resolve project membership", 500);
  }

  const project_id = mem?.project_id ?? null;

  // ======================================================
  // Insert notification via service role
  // ======================================================

  const svc = createServiceClient();

  const { data: inserted, error: insErr } = await svc
    .from("notifications")
    .insert([
      {
        user_id: userId,
        project_id,
        artifact_id: null,
        type: "system",
        title: "System notification",
        body: "Notification pipeline operational.",
        link: project_id ? `/projects/${project_id}` : "/projects",
        is_read: false,
        actor_user_id: userId,
        metadata: { source: "system_check" },
      },
    ])
    .select("id,user_id,project_id,type,title,is_read,created_at")
    .single();

  if (insErr) {
    if (DEV) console.error("[notifications.test] insert error:", insErr);

    return err("Notification insert failed", 500, {
      message: insErr.message,
      code: (insErr as any)?.code || null,
      hint: (insErr as any)?.hint || null,
    });
  }

  return ok({ inserted });
}