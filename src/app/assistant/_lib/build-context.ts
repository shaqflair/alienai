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
  personName:   string;
  projectTitle: string;
  weekStart:    string;
  daysAllocated: number;
  capacityDays:  number;
  utilisationPct: number;
};

type UtilisationCtx = {
  personName:   string;
  department:   string | null;
  avgUtil:      number;
  peakUtil:     number;
  totalAllocDays: number;
};

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

/**
 * Fetches and aggregates all relevant data for an organisation to provide
 * the AI with enough context to answer resource management questions.
 */
export async function buildAssistantContext(organisationId: string): Promise<AssistantContext> {
  const sb = await createClient();

  const today = new Date().toISOString().slice(0, 10);
  // Define a rolling window: 8 weeks back (history) to 26 weeks forward (forecast)
  const dateFrom = new Date(Date.now() - 56  * 86400000).toISOString().slice(0, 10);
  const dateTo   = new Date(Date.now() + 182 * 86400000).toISOString().slice(0, 10);

  const [orgRes, peopleRes, projectsRes, allocRes] = await Promise.all([
    sb.from("organisations").select("name").eq("id", organisationId).maybeSingle(),
    sb.from("profiles").select("user_id, full_name, job_title, department, employment_type, capacity_days").eq("organisation_id", organisationId).is("removed_at", null),
    sb.from("projects").select("id, title, project_code, resource_status, start_date, finish_date, win_probability").eq("organisation_id", organisationId).is("deleted_at", null).order("start_date", { ascending: true }),
    sb.from("allocations").select(`
        id, days_allocated, week_start_date, person_id, project_id,
        projects:projects!allocations_project_id_fkey(title, project_code, organisation_id),
        profiles:profiles!allocations_person_id_fkey(full_name, department, capacity_days)
      `).gte("week_start_date", dateFrom).lte("week_start_date", dateTo),
  ]);

  const orgName = safeStr(orgRes.data?.name) || "Unknown org";
  const peopleRaw   = peopleRes.data   ?? [];
  const projectsRaw = projectsRes.data ?? [];
  const allocRaw    = allocRes.data    ?? [];

  // Filter allocations to ensure they belong to this org (security check)
  const orgAllocations = allocRaw.filter((a: any) => a.projects?.organisation_id === organisationId);

  const people: PersonCtx[] = peopleRaw.map((p: any) => ({
    id:          safeStr(p.user_id),
    name:        safeStr(p.full_name) || "Unknown",
    jobTitle:    p.job_title  ?? null,
    department:  p.department ?? null,
    type:        safeStr(p.employment_type) || "full_time",
    capacityDaysPerWeek: Number(p.capacity_days) || 5,
  }));

  const personById = new Map(people.map(p => [p.id, p]));

  const projects: ProjectCtx[] = projectsRaw.map((p: any) => ({
    id:        safeStr(p.id),
    title:     safeStr(p.title),
    code:      p.project_code ?? null,
    status:    safeStr(p.resource_status) || "confirmed",
    startDate: p.start_date  ?? null,
    endDate:   p.finish_date ?? null,
    winPct:    p.win_probability ?? null,
  }));

  const allocations: AllocationCtx[] = orgAllocations.map((a: any) => {
    const capacityDays = Number(a.profiles?.capacity_days) || 5;
    const daysAllocated = Number(a.days_allocated) || 0;
    return {
      personName:    safeStr(a.profiles?.full_name) || "Unknown",
      projectTitle:  safeStr(a.projects?.title)     || "Unknown project",
      weekStart:     safeStr(a.week_start_date),
      daysAllocated,
      capacityDays,
      utilisationPct: capacityDays > 0 ? Math.round((daysAllocated / capacityDays) * 100) : 0,
    };
  });

  // Calculate Utilisation summaries
  const personAllocMap = new Map<string, { total: number; peak: number; count: number; name: string; dept: string | null }>();

  for (const a of orgAllocations) {
    const personId  = safeStr(a.person_id);
    const cap       = Number(a.profiles?.capacity_days) || 5;
    const days      = Number(a.days_allocated)          || 0;
    const util      = cap > 0 ? Math.round((days / cap) * 100) : 0;
    const name      = safeStr(a.profiles?.full_name) || personById.get(personId)?.name || "Unknown";
    const dept      = a.profiles?.department ?? null;

    if (!personAllocMap.has(personId)) {
      personAllocMap.set(personId, { total: 0, peak: 0, count: 0, name, dept });
    }
    const entry = personAllocMap.get(personId)!;
    entry.total += util;
    entry.peak   = Math.max(entry.peak, util);
    entry.count++;
  }

  const utilisation: UtilisationCtx[] = Array.from(personAllocMap.entries()).map(([personId, v]) => ({
    personName:     v.name,
    department:     v.dept,
    avgUtil:        v.count > 0 ? Math.round(v.total / v.count) : 0,
    peakUtil:       v.peak,
    totalAllocDays: orgAllocations
      .filter((a: any) => a.person_id === personId)
      .reduce((sum: number, a: any) => sum + (Number(a.days_allocated) || 0), 0),
  }));

  return { orgName, today, people, projects, allocations, utilisation };
}

/**
 * Transforms the structured data into a natural language System Prompt.
 */
export function formatSystemPrompt(ctx: AssistantContext): string {
  const { orgName, today, people, projects, allocations, utilisation } = ctx;

  const confirmedProjects  = projects.filter(p => p.status === "confirmed");
  const overAllocated      = utilisation.filter(u => u.peakUtil > 100);
  const upcoming           = allocations.filter(a => a.weekStart >= today);

  const allocatedPeopleNow = new Set(upcoming.map(a => a.personName));
  const freeNow = people.filter(p => !allocatedPeoplePeopleNow.has(p.name));

  return `You are ResForce AI for ${orgName}. Today: ${today}.
Provide data-driven staffing insights using the context below. 

=== TEAM ===
${people.map(p => `- ${p.name} (${p.jobTitle || "No title"}), Dept: ${p.department || "N/A"}`).join("\n")}

=== PROJECTS ===
${confirmedProjects.map(p => `- ${p.title} (${p.startDate} to ${p.endDate})`).join("\n")}

=== BOTTLENECKS ===
Over-allocated: ${overAllocated.map(u => `${u.personName} (Peak ${u.peakUtil}%)`).join(", ") || "None"}

=== BENCH (Next 4 Weeks) ===
Available: ${freeNow.map(p => p.name).join(", ") || "None"}

=== DETAILED ALLOCATIONS ===
${allocations.slice(0, 100).map(a => `${a.personName} | ${a.projectTitle} | ${a.weekStart} | ${a.daysAllocated}d`).join("\n")}
`;
}
