import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";

function noStore(payload: any, status = 200) {
  const res = NextResponse.json(payload, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export type SearchResult = {
  id:       string;
  type:     "person" | "project" | "allocation" | "scenario";
  title:    string;
  subtitle: string;
  href:     string;
  meta?:    string;
  colour?:  string;
};

export async function GET(req: Request) {
  try {
    const sb = await createClient();
    const { data: { user }, error: authErr } = await sb.auth.getUser();
    if (authErr || !user) return noStore({ ok: false, error: "Not authenticated" }, 401);

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return noStore({ ok: false, error: "No active org" }, 400);

    const url   = new URL(req.url);
    const raw   = safeStr(url.searchParams.get("q")).trim();
    const query = raw.toLowerCase();

    if (!query || query.length < 2) {
      return noStore({ ok: true, results: [], query: raw });
    }

    const organisationId = String(orgId);
    const like = `%${query}%`;

    const [peopleRes, projectsRes, allocRes, scenarioRes] = await Promise.all([
      sb.from("profiles")
        .select("user_id, full_name, job_title, department, employment_type, skills")
        .eq("organisation_id", organisationId)
        .or(`full_name.ilike.${like},job_title.ilike.${like},department.ilike.${like}`)
        .limit(6),

      sb.from("projects")
        .select("id, title, project_code, resource_status, colour, start_date, finish_date, win_probability")
        .eq("organisation_id", organisationId)
        .is("deleted_at", null)
        .or(`title.ilike.${like},project_code.ilike.${like}`)
        .order("start_date", { ascending: false })
        .limit(6),

      sb.from("allocations")
        .select(`
          id,
          projects:projects!allocations_project_id_fkey(id, title, project_code, colour, organisation_id),
          profiles:profiles!allocations_person_id_fkey(user_id, full_name, job_title)
        `)
        .limit(100),

      sb.from("scenarios")
        .select("id, name, description, created_at")
        .eq("organisation_id", organisationId)
        .or(`name.ilike.${like},description.ilike.${like}`)
        .order("created_at", { ascending: false })
        .limit(4),
    ]);

    const results: SearchResult[] = [];

    // -- People
    for (const p of peopleRes.data ?? []) {
      const skills: string[] = Array.isArray(p.skills) ? p.skills : [];
      const skillMatch = skills.find(s => s.toLowerCase().includes(query));
      const parts = [safeStr(p.job_title), safeStr(p.department)].filter(Boolean);
      results.push({
        id:       safeStr(p.user_id),
        type:     "person",
        title:    safeStr(p.full_name) || "Unknown",
        subtitle: parts.join("  ") || "Team member",
        href:     `/people/${p.user_id}`,
        meta:     p.employment_type === "part_time" ? "Part-time" : p.employment_type === "contractor" ? "Contractor" : undefined,
      });
    }

    // -- Projects
    for (const p of projectsRes.data ?? []) {
      const start = p.start_date ? new Date(p.start_date).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : null;
      const end = p.finish_date ? new Date(p.finish_date).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : null;
      results.push({
        id:       safeStr(p.id),
        type:     "project",
        title:    safeStr(p.title) || "Untitled project",
        subtitle: [safeStr(p.project_code), (start && end ? `${start} - ${end}` : start ?? end ?? "")].filter(Boolean).join("  "),
        href:     `/projects/${p.id}`,
        meta:     p.resource_status === "confirmed" ? "Confirmed" : p.resource_status === "pipeline" ? `Pipeline ${p.win_probability ?? ""}%`.trim() : p.resource_status,
        colour:   safeStr(p.colour || "#00b8db"),
      });
    }

    // -- Allocations
    const seenAlloc = new Set<string>();
    for (const a of allocRes.data ?? []) {
      const proj = (a as any).projects;
      const person = (a as any).profiles;
      if (!proj || !person || proj.organisation_id !== organisationId) continue;
      if (!proj.title.toLowerCase().includes(query) && !person.full_name.toLowerCase().includes(query)) continue;

      const key = `${person.user_id}::${proj.id}`;
      if (seenAlloc.has(key)) continue;
      seenAlloc.add(key);
      if (seenAlloc.size > 5) break;

      results.push({
        id:       `alloc-${key}`,
        type:     "allocation",
        title:    `${person.full_name} on ${proj.title}`,
        subtitle: proj.project_code || proj.title,
        href:     `/projects/${proj.id}`,
        colour:   safeStr(proj.colour || "#00b8db"),
      });
    }

    // -- Scenarios
    for (const s of scenarioRes.data ?? []) {
      results.push({
        id:       safeStr(s.id),
        type:     "scenario",
        title:    safeStr(s.name) || "Scenario",
        subtitle: safeStr(s.description).slice(0, 60) || "What-if scenario",
        href:     `/scenarios`,
        meta:     new Date(s.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      });
    }

    const ORDER = { person: 0, project: 1, allocation: 2, scenario: 3 };
    results.sort((a, b) => ORDER[a.type] - ORDER[b.type]);

    return noStore({ ok: true, results: results.slice(0, 20), query: raw });
  } catch (e: any) {
    return noStore({ ok: false, error: e?.message ?? "Search failed" }, 500);
  }
}
