// src/app/api/allocations/audit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const projectId      = safeStr(req.nextUrl.searchParams.get("projectId")).trim();
    const personId       = safeStr(req.nextUrl.searchParams.get("personId")).trim();
    const organisationId = safeStr(req.nextUrl.searchParams.get("organisationId")).trim();
    const limit          = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100)));

    if (!projectId && !personId && !organisationId) {
      return NextResponse.json({ ok: false, error: "projectId, personId, or organisationId required" }, { status: 400 });
    }

    const admin = createAdminClient();

    let q = admin
      .from("allocation_audit_log")
      .select("id, action, actor_id, person_id, project_id, before, after, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (projectId)      q = q.eq("project_id", projectId);
    if (personId)       q = q.eq("person_id",  personId);

    // For org-wide query, filter by projects belonging to the org
    if (organisationId && !projectId && !personId) {
      const { data: projects } = await admin
        .from("projects")
        .select("id")
        .eq("organisation_id", organisationId)
        .is("deleted_at", null);

      const projectIds = (projects ?? []).map((p: any) => p.id);
      if (!projectIds.length) {
        return NextResponse.json({ ok: true, entries: [] });
      }
      q = q.in("project_id", projectIds);
    }

    const { data: rows, error } = await q;
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

    const entries = rows ?? [];

    // Enrich with actor + person names
    const actorIds  = Array.from(new Set(entries.map((r: any) => r.actor_id).filter(Boolean)));
    const personIds = Array.from(new Set(entries.map((r: any) => r.person_id).filter(Boolean)));

    const nameMap: Record<string, string> = {};
    if (actorIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", actorIds);
      for (const p of profiles ?? []) {
        nameMap[safeStr((p as any).user_id)] = safeStr((p as any).full_name || (p as any).email || "Unknown");
      }
    }

    const personNameMap: Record<string, string> = {};
    if (personIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", personIds);
      for (const p of profiles ?? []) {
        personNameMap[safeStr((p as any).user_id)] = safeStr((p as any).full_name || (p as any).email || "Unknown");
      }
    }

    const enriched = entries.map((r: any) => ({
      id:          safeStr(r.id),
      action:      safeStr(r.action),
      actor_id:    r.actor_id  ?? null,
      actor_name:  r.actor_id  ? (nameMap[safeStr(r.actor_id)]  ?? null) : null,
      person_id:   r.person_id ?? null,
      person_name: r.person_id ? (personNameMap[safeStr(r.person_id)] ?? null) : null,
      project_id:  r.project_id ?? null,
      before:      r.before ?? null,
      after:       r.after  ?? null,
      created_at:  safeStr(r.created_at),
    }));

    return NextResponse.json({ ok: true, entries: enriched });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal error" }, { status: 500 });
  }
}