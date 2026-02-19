import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function s(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function json(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id?: string }> }
) {
  const p = await params;
  const suggestionId = s(p?.id).trim();

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return json({ ok: false, error: authErr.message }, 401);
  if (!auth?.user) return json({ ok: false, error: "Unauthorized" }, 401);

  if (!suggestionId) return json({ ok: false, error: "Missing suggestion id" }, 400);

  // optional body (panel sends projectId/artifactId for context)
  const body = await req.json().catch(() => ({}));
  const projectId = s(body?.projectId).trim() || null;
  const artifactId = s(body?.artifactId).trim() || null;

  // ✅ Update suggestion status
  let q = supabase
    .from("ai_suggestions")
    .update({
      status: "applied",
      decided_at: new Date().toISOString(),
      rejected_at: null,
      ...(artifactId ? { artifact_id: artifactId } : {}),
    })
    .eq("id", suggestionId);

  // If projectId provided, keep it tight (safer with RLS variability)
  if (projectId) q = q.eq("project_id", projectId);

  const { error } = await q;
  if (error) return json({ ok: false, error: error.message }, 500);

  // ✅ Optional: record feedback (if table exists; best-effort)
  try {
    await supabase.from("ai_suggestion_feedback").insert({
      suggestion_id: suggestionId,
      actor_user_id: auth.user.id,
      action: "applied",
      note: null,
    });
  } catch {
    // ignore
  }

  return json({ ok: true });
}
