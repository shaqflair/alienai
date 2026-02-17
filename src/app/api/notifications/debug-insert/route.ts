import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

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
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth?.user) return err("Not authenticated", 401, { authErr: authErr?.message || null });

  // Quick env sanity (common reason inserts “do nothing”)
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const hasServiceKey = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);

  if (!url || !hasServiceKey) {
    return err("Missing Supabase service env vars", 500, {
      hasUrl: Boolean(url),
      hasServiceKey,
      expected: ["SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"],
    });
  }

  const userId = auth.user.id;

  // Pick any project membership (optional)
  const { data: mem, error: memErr } = await sb
    .from("project_members")
    .select("project_id")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(1)
    .maybeSingle();

  if (memErr) return err("Failed to read project membership", 500, { memErr: memErr.message });

  const project_id = mem?.project_id ?? null;

  const svc = createServiceClient();

  const { data: inserted, error: insErr } = await svc
    .from("notifications")
    .insert([
      {
        user_id: userId,
        project_id,
        artifact_id: null,
        type: "debug",
        title: "Debug notification",
        body: "If you can see this, inserts + reads are working.",
        link: project_id ? `/projects/${project_id}` : "/projects",
        is_read: false,
        actor_user_id: userId,
        metadata: { source: "debug-insert" },
      },
    ])
    .select("id,user_id,project_id,type,title,is_read,created_at")
    .single();

  if (insErr) {
    return err("Insert failed", 500, {
      message: insErr.message,
      code: (insErr as any).code || null,
      details: (insErr as any).details || null,
      hint: (insErr as any).hint || null,
    });
  }

  return ok({ inserted });
}

