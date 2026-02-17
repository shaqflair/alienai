// src/app/api/ai/suggestions/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

export async function GET(req: Request) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 401 });
  if (!auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const projectId = safeStr(url.searchParams.get("project_id"));
  const artifactId = safeStr(url.searchParams.get("artifact_id"));
  const sectionKey = safeStr(url.searchParams.get("section_key"));
  const status = safeStr(url.searchParams.get("status")) || "proposed";

  if (!projectId) return NextResponse.json({ error: "project_id is required" }, { status: 400 });

  let q = supabase
    .from("ai_suggestions")
    .select("*")
    .eq("project_id", projectId)
    .eq("status", status)
    .order("created_at", { ascending: false });

  if (artifactId) q = q.eq("artifact_id", artifactId);
  if (sectionKey) q = q.eq("section_key", sectionKey);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ suggestions: data ?? [] });
}

export async function PATCH(req: Request) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) return NextResponse.json({ error: authErr.message }, { status: 401 });
  if (!auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const suggestionId = safeStr(body?.suggestion_id);
  const action = safeStr(body?.action); // applied | dismissed | explained
  const note = safeStr(body?.note);

  if (!suggestionId) return NextResponse.json({ error: "suggestion_id is required" }, { status: 400 });
  if (!["applied", "dismissed", "explained"].includes(action)) {
    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  }

  // record feedback
  const fb = await supabase.from("ai_suggestion_feedback").insert({
    suggestion_id: suggestionId,
    actor_user_id: auth.user.id,
    action,
    note: note || null,
  });

  if (fb.error) return NextResponse.json({ error: fb.error.message }, { status: 500 });

  // update suggestion status if applied/dismissed
  if (action === "applied" || action === "dismissed") {
    const { error } = await supabase
      .from("ai_suggestions")
      .update({ status: action === "applied" ? "applied" : "dismissed" })
      .eq("id", suggestionId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
