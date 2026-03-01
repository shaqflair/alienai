// FILE: src/app/assistant/_lib/build-context.ts
import "server-only";
import { createClient } from "@/utils/supabase/server";

export type AssistantContext = {
  orgName:       string;
  today:         string;
  people:        PersonCtx[];
  projects:      ProjectCtx[];
  allocations:   AllocationCtx[];
  utilisation:   UtilisationCtx[];
};

type PersonCtx = {
  id:         string;
  name:       string;
  jobTitle:   string | null;
  department: string | null;
  type:       string;
  capacityDaysPerWeek: number;
};

type ProjectCtx = {
  id:          string;
  title:       string;
  code:        string | null;
  status:      string;
  startDate:   string | null;
  endDate:     string | null;
  winPct:      number | null;
};

type AllocationCtx = {
  personName:     string;
  projectTitle:   string;
  weekStart:      string;
  daysAllocated:  number;
  capacityDays:   number;
  utilisationPct: number;
};

type UtilisationCtx = {
  personName:     string;
  department:     string | null;
  avgUtil:        number;
  peakUtil:       number;
  totalAllocDays: number;
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export async function buildAssistantContext(organisationId: string): Promise<AssistantContext> {
  const sb = await createClient();

  const today   = new Date().toISOString().slice(0, 10);
  const dateFrom = new Date(Date.now() - 56  * 86400000).toISOString().slice(0, 10);
  const dateTo   = new Date(Date.now() + 182 * 86400000).toISOString().slice(0, 10);

  const [orgRes, membersRes, projectsRes, allocRes] = await Promise.all([
    // Org name
    sb.from("organisations")
      .select("name")
      .eq("id", organisationId)
      .maybeSingle(),

    // People via organisation_members + profiles join
    sb.from("organisation_members")
      .select("user_id, role, profiles:profiles!organisation_members_user_id_fkey(full_name, job_title, department, employment_type, capacity_days)")
      .eq("organisation_id", organisationId)
      .is("removed_at", null),

    // Active confirmed projects only for stats, but include pipeline for context
    sb.from("projects")
      .select("id, title, project_code, resource_status, start_date, finish_date, win_probability")
      .eq("organisation_id", organisationId)
      .is("deleted_at", null)
      .order("start_date", { ascending: true }),

    // Allocations with project + person info
    sb.from("allocations")
      .select(`
        id,
        days_allocated,
        week_start_date,
        person_id,
        project_id,
        projects:projects!allocations_project_id_fkey(title, project_code, organisation_id, resource_status),
        profiles:profiles!allocations_person_id_fkey(full_name, department, capacity_days)
      `)
      .gte("week_start_date", dateFrom)
      .lte("week_start_date", dateTo),
  ]);

  const orgName     = safeStr(orgRes.data?.name) || "Unknown org";
  const membersRaw  = membersRes.data  ?? [];
  const projectsRaw = projectsRes.data ?? [];
  const allocRaw    = allocRes.data    ?? [];

  // Build people from org_members
  const people: PersonCtx[] = membersRaw.map((m: any) => {
    const p = m.profiles ?? {};
    return {
      id:         safeStr(m.user_id),
      name:       safeStr(p.full_name) || "Unknown",
      jobTitle:   p.job_title  ?? null,
      department: p.department ?? null,
      type:       safeStr(p.employment_type) || "full_time",
      capacityDaysPerWeek: Number(p.capacity_days) || 5,
    };
  });

  const personById = new Map(people.map(p => [p.id, p]));

  // Build projects
  const projects: ProjectCtx[] = projectsRaw.map((p: any) => ({
    id:        safeStr(p.id),
    title:     safeStr(p.title),
    code:      p.project_code ?? null,
    status:    safeStr(p.resource_status) || "confirmed",
    startDate: p.start_date  ?? null,
    endDate:   p.finish_date ?? null,
    winPct:    p.win_probability ?? null,
  }));

  // Filter allocations to this org only
  const orgAllocations = allocRaw.filter((a: any) =>
    a.projects?.organisation_id === organisationId
  );

  // Build allocations context
  const allocations: AllocationCtx[] = orgAllocations.map((a: any) => {
    const capacityDays  = Number(a.profiles?.capacity_days) || 5;
    const daysAllocated = Number(a.days_allocated) || 0;
    return {
      personName:     safeStr(a.profiles?.full_name) || personById.get(safeStr(a.person_id))?.name || "Unknown",
      projectTitle:   safeStr(a.projects?.title) || "Unknown project",
      weekStart:      safeStr(a.week_start_date),
      daysAllocated,
      capacityDays,
      utilisationPct: capacityDays > 0 ? Math.round((daysAllocated / capacityDays) * 100) : 0,
    };
  });

  // Compute per-person utilisation
  const personAllocMap = new Map<string, { total: number; peak: number; count: number; name: string; dept: string | null; totalDays: number }>();

  for (const a of orgAllocations) {
    const personId = safeStr(a.person_id);
    const cap      = Number(a.profiles?.capacity_days) || 5;
    const days     = Number(a.days_allocated) || 0;
    const util     = cap > 0 ? Math.round((days / cap) * 100) : 0;
    const name     = safeStr(a.profiles?.full_name) || personById.get(personId)?.name || "Unknown";
    const dept     = a.profiles?.department ?? null;

    if (!personAllocMap.has(personId)) {
      personAllocMap.set(personId, { total: 0, peak: 0, count: 0, name, dept, totalDays: 0 });
    }
    const entry = personAllocMap.get(personId)!;
    entry.total    += util;
    entry.peak      = Math.max(entry.peak, util);
    entry.count    += 1;
    entry.totalDays += days;
  }

  const utilisation: UtilisationCtx[] = Array.from(personAllocMap.values()).map(v => ({
    personName:     v.name,
    department:     v.dept,
    avgUtil:        v.count > 0 ? Math.round(v.total / v.count) : 0,
    peakUtil:       v.peak,
    totalAllocDays: v.totalDays,
  }));

  return { orgName, today, people, projects, allocations, utilisation };
}

/* =============================================================================
   FORMAT CONTEXT AS SYSTEM PROMPT
============================================================================= */
export function formatSystemPrompt(ctx: AssistantContext): string {
  const { orgName, today, people, projects, allocations, utilisation } = ctx;

  // Only confirmed projects for staffing context
  const confirmedProjects = projects.filter(p => p.status === "confirmed");
  const pipelineProjects  = projects.filter(p => p.status === "pipeline");
  const overAllocated     = utilisation.filter(u => u.peakUtil > 100);
  const underUtilised     = utilisation.filter(u => u.avgUtil < 40 && u.avgUtil > 0);
  const highlyUtilised    = utilisation.filter(u => u.avgUtil >= 80 && u.avgUtil <= 100);

  const todayDate  = new Date(today);
  const fourWeeks  = new Date(todayDate.getTime() + 28 * 86400000).toISOString().slice(0, 10);
  const upcoming   = allocations.filter(a => a.weekStart >= today && a.weekStart <= fourWeeks);

  const allocatedPeopleNow = new Set(upcoming.map(a => a.personName));
  const freeNow = people.filter(p => !allocatedPeopleNow.has(p.name));

  return `You are ResForce AI, a resource management assistant for ${orgName}.
Today's date is ${today}.

You have access to real-time data about the organisation's team, projects, and allocations.
Always give specific, data-driven answers. Reference names, percentages, and dates.
Be concise but thorough. Format responses with clear sections when helpful.
If asked something you don't have data for, say so honestly.

=== TEAM (${people.length} people) ===
${people.map(p =>
  `- ${p.name} | ${p.jobTitle ?? "No title"} | ${p.department ?? "No dept"} | ${p.type} | ${p.capacityDaysPerWeek}d/week`
).join("\n") || "No people found"}

=== CONFIRMED PROJECTS (${confirmedProjects.length}) ===
${confirmedProjects.map(p =>
  `- ${p.title}${p.code ? ` [${p.code}]` : ""} | ${p.startDate ?? "?"} to ${p.endDate ?? "ongoing"}`
).join("\n") || "None"}

=== PIPELINE PROJECTS (${pipelineProjects.length}) ===
${pipelineProjects.map(p =>
  `- ${p.title}${p.code ? ` [${p.code}]` : ""} | Win: ${p.winPct ?? "?"}% | ${p.startDate ?? "?"} to ${p.endDate ?? "?"}`
).join("\n") || "None"}

=== UTILISATION SUMMARY ===
Over-allocated (peak > 100%): ${overAllocated.length > 0
  ? overAllocated.map(u => `${u.personName} (peak ${u.peakUtil}%, avg ${u.avgUtil}%)`).join(", ")
  : "None"}
Highly utilised (avg 80-100%): ${highlyUtilised.length > 0
  ? highlyUtilised.map(u => `${u.personName} (avg ${u.avgUtil}%)`).join(", ")
  : "None"}
Under-utilised (avg < 40%): ${underUtilised.length > 0
  ? underUtilised.map(u => `${u.personName} (avg ${u.avgUtil}%)`).join(", ")
  : "None"}

=== AVAILABILITY NEXT 4 WEEKS ===
No allocations: ${freeNow.length > 0 ? freeNow.map(p => p.name).join(", ") : "Everyone has allocations"}

Upcoming allocations (next 4 weeks):
${upcoming.slice(0, 60).map(a =>
  `- ${a.personName} on "${a.projectTitle}" | w/c ${a.weekStart} | ${a.daysAllocated}d (${a.utilisationPct}%)`
).join("\n") || "None"}

=== FULL ALLOCATION DATA (8 weeks back to 26 weeks forward) ===
${allocations.slice(0, 200).map(a =>
  `${a.personName} | ${a.projectTitle} | ${a.weekStart} | ${a.daysAllocated}d | ${a.utilisationPct}%`
).join("\n")}`;
}