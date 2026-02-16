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

/**
 * GET /api/artifacts/audit?artifact_id=...
 * Returns grouped audit events for an artifact.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const artifact_id = url.searchParams.get("artifact_id");
    if (!artifact_id) return jsonErr("artifact_id is required", 400);

    const supabase = await createClient();

    // Pull latest rows (tune limit)
    const { data: rows, error } = await supabase
      .from("artifact_audit_log")
      .select(
        "id,artifact_id,project_id,actor_id,actor_email,action,section,action_label,summary,changed_columns,content_json_paths,request_id,route,created_at,before,after"
      )
      .eq("artifact_id", artifact_id)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return jsonErr(error.message, 500);

    // Group by request_id when present; fallback to minute-bucket
    const groups = new Map<string, any>();

    for (const r of rows ?? []) {
      const createdAt = new Date(r.created_at);
      const minuteBucket = `${createdAt.getUTCFullYear()}-${createdAt.getUTCMonth() + 1}-${createdAt.getUTCDate()}-${createdAt.getUTCHours()}-${createdAt.getUTCMinutes()}`;
      const key = r.request_id ? `req:${r.request_id}` : `min:${minuteBucket}`;

      if (!groups.has(key)) {
        groups.set(key, {
          group_key: key,
          created_at: r.created_at,
          actor_email: r.actor_email || null,
          actor_id: r.actor_id || null,
          action: "update",
          title: "Document updated",
          section: "general",
          summaries: [],
          items: [],
        });
      }

      const g = groups.get(key);
      // Choose best title/section (prefer non-general)
      if (r.section && r.section !== "general") g.section = r.section;
      if (r.action_label && r.action_label !== "Document updated") g.title = "Closure Report updated";

      if (r.summary) g.summaries.push(r.summary);

      g.items.push({
        id: r.id,
        created_at: r.created_at,
        section: r.section,
        action_label: r.action_label,
        summary: r.summary,
        changed_columns: r.changed_columns,
        content_json_paths: r.content_json_paths,
        before: r.before,
        after: r.after,
      });
    }

    // Convert to array + clean summaries
    const events = Array.from(groups.values())
      .map((g) => {
        const uniqSummaries = Array.from(new Set(g.summaries)).slice(0, 6);
        return {
          ...g,
          summaries: uniqSummaries,
          item_count: g.items.length,
        };
      })
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    return jsonOk({ events });
  } catch (e: any) {
    return jsonErr("Unexpected error", 500, { message: String(e?.message || e) });
  }
}
