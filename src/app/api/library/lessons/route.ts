import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

export async function GET(req: Request) {
  const sb = await createClient();

  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401);
  if (!auth?.user) return jsonErr("Not authenticated", 401);

  const url = new URL(req.url);
  const q = safeStr(url.searchParams.get("q")).trim();
  const tag = safeStr(url.searchParams.get("tag")).trim();
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || 50)));

  let query = sb
    .from("lessons_learned")
    .select(
      [
        "id",
        "project_id",
        "category",
        "description",
        "action_for_future",
        "created_at",
        "status",
        "impact",
        "severity",
        "project_stage",
        "ai_generated",
        "ai_summary",
        "is_published",
        "published_at",
        "library_tags",
        // embed project title (FK: lessons_learned.project_id -> projects.id)
        "projects:projects(id,title,organisation_id)",
      ].join(",")
    )
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(limit);

  if (q) query = query.ilike("description", `%${q}%`);
  if (tag) query = query.contains("library_tags", [tag]);

  const { data, error } = await query;
  if (error) return jsonErr(error.message, 400);

  return jsonOk({ items: data ?? [] });
}
