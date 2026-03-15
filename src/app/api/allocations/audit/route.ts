import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const projectId = safeStr(req.nextUrl.searchParams.get("projectId")).trim();
    const personId  = safeStr(req.nextUrl.searchParams.get("personId")).trim();
    const limit     = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100)));

    if (!projectId && !personId) {
      return NextResponse.json({ ok: false, error: "projectId or personId required" }, { status: 400 });
    }

    // Resolve org for membership gate
    let orgId: string | null = null;
    if (projectId) {
      const { data: proj } = await supabase.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
      orgId = proj?.organisation_id ? String(proj.organisation_id) : null;
    }

    if (orgId) {
      const { data: mem } = await supabase
        .from("organisation_members")
        .select("user_id")
        .eq("organisation_id", orgId)
        .eq("user_id", auth.user.id)
        .is("removed_at", null)
        .maybeSingle();
      if (!mem) return NextResponse.json({ ok: false, error: "Access denied" }, { status: 403 });
    }

    let query = supabase
      .from("allocation_audit_log")
      .select("id, action, actor_id, person_id, project_id, before, after, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (projectId) query = query.eq("project_id", projectId);
    if (personId)  query = query.eq("person_id",  personId);

    const { data: rows, error: auditErr } = await query;
    if (auditErr) return NextResponse.json({ ok: false, error: auditErr.message }, { status: 500 });

    const entries = rows ?? [];

    // Enrich with actor and person names
    const actorIds = Array.from(new Set(entries.map(r => safeStr((r as any).actor_id)).filter(Boolean)));
    const personIds = Array.from(new Set(entries.map(r => safeStr((r as any).person_id)).filter(Boolean)));
    const allIds = Array.from(new Set([...actorIds, ...personIds]));

    const nameMap: Record<string, string> = {};
    if (allIds.length > 0) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .in("user_id", allIds);
      for (const p of profiles ?? []) {
        nameMap[safeStr((p as any).user_id)] = safeStr((p as any).full_name || "Unknown");
      }
    }

    const enriched = entries.map(r => ({
      id:           safeStr((r as any).id),
      action:       safeStr((r as any).action),
      actor_id:     safeStr((r as any).actor_id) || null,
      actor_name:   nameMap[safeStr((r as any).actor_id)] ?? null,
      person_id:    safeStr((r as any).person_id) || null,
      person_name:  nameMap[safeStr((r as any).person_id)] ?? null,
      project_id:   safeStr((r as any).project_id) || null,
      before:       (r as any).before ?? null,
      after:        (r as any).after  ?? null,
      created_at:   safeStr((r as any).created_at),
    }));

    return NextResponse.json({ ok: true, entries: enriched });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal error" }, { status: 500 });
  }
}
