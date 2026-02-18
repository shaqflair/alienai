import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(x ?? ""));
}

export async function POST(req: Request) {
  const supabase = await createClient();

  // ? Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return NextResponse.json({ ok: false, error: authErr.message }, { status: 401 });
  if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const projectId = safeStr(body?.projectId).trim();
  const artifactId = safeStr(body?.artifactId).trim();

  if (!projectId) return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
  if (!isUuid(projectId)) return NextResponse.json({ ok: false, error: "Invalid projectId" }, { status: 400 });
  if (artifactId && !isUuid(artifactId)) return NextResponse.json({ ok: false, error: "Invalid artifactId" }, { status: 400 });

  // ? Membership check
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) return NextResponse.json({ ok: false, error: memErr.message }, { status: 500 });
  if (!mem) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const nowIso = new Date().toISOString();

  // ? DB-allowed statuses only: proposed | suggested | applied | rejected
  let q = supabase
    .from("ai_suggestions")
    .update({
      status: "rejected",
      decided_at: nowIso,
      rejected_at: nowIso,
      actioned_by: auth.user.id,
    })
    .eq("project_id", projectId)
    .eq("suggestion_type", "ui_test")
    .in("status", ["proposed", "suggested"]); // actionable only

  if (artifactId) q = q.eq("artifact_id", artifactId);

  const { data, error } = await q.select("id,status");
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, cleaned: (data ?? []).length, rows: data ?? [] });
}
