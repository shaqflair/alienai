// src/app/api/allocations/audit/route.ts
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const dynamic = "force-dynamic";

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/** Format ISO date to UK format DD/MM/YYYY for display */
function toUkDate(iso: string): string {
  if (!iso) return iso;
  const parts = iso.split("T")[0].split("-");
  if (parts.length !== 3) return iso;
  return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

/** Fix corrupted arrow characters in stored summaries */
function fixSummary(summary: string | null | undefined): string | null {
  if (!summary) return summary ?? null;
  // Replace corrupted ? arrows with ->
  return summary.replace(/ \? /g, " -> ");
}

/** Apply UK date formatting and fix corrupted summaries in audit data */
function fixAuditData(data: any): any {
  if (!data || typeof data !== "object") return data;
  const fixed = { ...data };

  // Fix date fields
  for (const key of ["start_date", "end_date", "first_week", "last_week", "week"]) {
    if (fixed[key] && typeof fixed[key] === "string" && fixed[key].match(/^\d{4}-\d{2}-\d{2}/)) {
      fixed[key] = toUkDate(fixed[key]);
    }
  }

  // Fix corrupted summary
  if (fixed.summary) {
    fixed.summary = fixSummary(fixed.summary);
  }

  return fixed;
}

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    const projectId      = safeStr(req.nextUrl.searchParams.get("projectId")).trim();
    const personId       = safeStr(req.nextUrl.searchParams.get("personId")).trim();
    const organisationId = safeStr(req.nextUrl.searchParams.get("organisationId")).trim();
    const includeActed   = req.nextUrl.searchParams.get("includeActed") === "true";
    const limit          = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 100)));

    if (!projectId && !personId && !organisationId) {
      return NextResponse.json({ ok: false, error: "projectId, personId, or organisationId required" }, { status: 400 });
    }

    const admin = createAdminClient();

    let allEntries: any[] = [];

    // -- Primary query: by project / person / org -----------------------------
    {
      let q = admin
        .from("allocation_audit_log")
        .select("id, action, actor_id, person_id, project_id, before, after, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);

      if (projectId)      q = q.eq("project_id", projectId);
      if (personId)       q = q.eq("person_id",  personId);

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
      allEntries = rows ?? [];
    }

    // -- Secondary query: actions performed BY this person (as actor) ---------
    // This ensures PMs and admins see changes they made, even if they aren't
    // the allocated person themselves.
    if (personId && includeActed) {
      const existingIds = new Set(allEntries.map((r: any) => r.id));
      const { data: actedRows } = await admin
        .from("allocation_audit_log")
        .select("id, action, actor_id, person_id, project_id, before, after, created_at")
        .eq("actor_id", personId)
        .order("created_at", { ascending: false })
        .limit(limit);

      for (const row of actedRows ?? []) {
        if (!existingIds.has(row.id)) {
          allEntries.push(row);
        }
      }

      // Re-sort combined results
      allEntries.sort((a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    }

    // -- Enrich with names ----------------------------------------------------
    const actorIds  = Array.from(new Set(allEntries.map((r: any) => r.actor_id).filter(Boolean)));
    const personIds = Array.from(new Set(allEntries.map((r: any) => r.person_id).filter(Boolean)));

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

    const enriched = allEntries.slice(0, limit).map((r: any) => ({
      id:          safeStr(r.id),
      action:      safeStr(r.action),
      actor_id:    r.actor_id  ?? null,
      actor_name:  r.actor_id  ? (nameMap[safeStr(r.actor_id)]       ?? null) : null,
      person_id:   r.person_id ?? null,
      person_name: r.person_id ? (personNameMap[safeStr(r.person_id)] ?? null) : null,
      project_id:  r.project_id ?? null,
      before:      r.before ? fixAuditData(r.before) : null,
      after:       r.after  ? fixAuditData(r.after)  : null,
      created_at:  safeStr(r.created_at),
    }));

    return NextResponse.json({ ok: true, entries: enriched });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Internal error" }, { status: 500 });
  }
}