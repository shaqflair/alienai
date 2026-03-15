import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const { artifactId } = await params;
    const projectId = safeStr(req.nextUrl.searchParams.get("projectId"));
    const limit     = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100)));

    if (!artifactId || !projectId) {
      return NextResponse.json({ ok: false, error: "Missing artifactId or projectId" }, { status: 400 });
    }

    // Membership gate - ensure user belongs to the project
    const { data: mem } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth.user.id)
      .eq("is_active", true)
      .maybeSingle();

    if (!mem) {
      return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    // Fetch audit log entries
    const { data: rows, error: auditErr } = await supabase
      .from("artifact_audit_log")
      .select("id, action, actor_id, before, after, created_at")
      .eq("artifact_id", artifactId)
      .eq("project_id",  projectId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (auditErr) {
      return NextResponse.json({ ok: false, error: auditErr.message }, { status: 500 });
    }

    const entries = rows ?? [];

    // Enrich with actor names
    const actorIds = Array.from(new Set(
      entries.map(r => safeStr((r as any).actor_id)).filter(Boolean)
    ));

    const nameMap: Record<string, string> = {};
    if (actorIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", actorIds);

      for (const p of profiles ?? []) {
        const uid = safeStr((p as any).user_id);
        nameMap[uid] = safeStr((p as any).full_name || (p as any).email || "Unknown");
      }
    }

    const enriched = entries.map(r => ({
      id:         safeStr((r as any).id),
      action:     safeStr((r as any).action),
      actor_id:   safeStr((r as any).actor_id) || null,
      actor_name: nameMap[safeStr((r as any).actor_id)] ?? null,
      before:     (r as any).before  ?? null,
      after:      (r as any).after   ?? null,
      created_at: safeStr((r as any).created_at),
    }));

    return NextResponse.json({ ok: true, entries: enriched });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
