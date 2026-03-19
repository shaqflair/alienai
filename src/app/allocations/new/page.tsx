// FILE: src/app/allocations/new/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import AllocateForm from "../_components/AllocateForm";
import type { PersonOption, ProjectOption } from "../_components/AllocateForm";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function norm(x: unknown) {
  return safeStr(x).trim();
}

function flashFromErr(err: string): string | null {
  if (!err) return null;
  const map: Record<string, string> = {
    missing_person:  "Please select a person.",
    missing_project: "Please select a project.",
    missing_start:   "Start date is required.",
    missing_end:     "End date is required.",
    bad_days:        "Days per week must be between 0.5 and 7.",
    bad_dates:       "End date cannot be before start date.",
    no_permission:   "You don't have permission to allocate on this project.",
  };
  return map[err] ?? err;
}

export default async function NewAllocationPage({
  searchParams,
}: {
  searchParams?: Promise<{
    project_id?: string;
    person_id?:  string;
    return_to?:  string;
    err?:        string;
  }> | {
    project_id?: string;
    person_id?:  string;
    return_to?:  string;
    err?:        string;
  };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/allocations/new")}`);

  const sp             = (await (searchParams as any)) ?? {};
  const defaultProject = norm(sp?.project_id);
  const defaultPerson  = norm(sp?.person_id);
  const returnTo       = norm(sp?.return_to) || "/heatmap";
  const err            = norm(sp?.err);
  const errorMsg       = flashFromErr(err);

  const orgId = await getActiveOrgId().catch(() => null);
  const activeOrgId = orgId ? String(orgId) : null;

  if (!activeOrgId) {
    redirect("/projects?err=missing_org");
  }

  const { data: orgData } = await supabase
    .from("organisations")
    .select("name")
    .eq("id", activeOrgId)
    .maybeSingle();
  const orgName = orgData?.name ?? activeOrgId.slice(0, 8) + "...";

  const { data: memberUserRows } = await supabase
    .from("organisation_members")
    .select("user_id")
    .eq("organisation_id", activeOrgId)
    .is("removed_at", null);

  const memberUserIds = (memberUserRows ?? []).map((r: any) => String(r.user_id)).filter(Boolean);

  const { data: profileRows } = memberUserIds.length > 0
    ? await supabase
        .from("profiles")
        .select("user_id, full_name, job_title, employment_type, default_capacity_days, department, is_active")
        .in("user_id", memberUserIds)
    : { data: [] };

  const people: PersonOption[] = (profileRows ?? [])
    .map((p: any) => {
      if (!p || p.is_active === false) return null;
      return {
        user_id:               String(p.user_id),
        full_name:             safeStr(p.full_name || p.email || p.user_id).trim(),
        job_title:             safeStr(p.job_title).trim() || null,
        employment_type:       safeStr(p.employment_type || "full_time"),
        default_capacity_days: parseFloat(String(p.default_capacity_days ?? 5)),
        department:            safeStr(p.department).trim() || null,
      } satisfies PersonOption;
    })
    .filter(Boolean) as PersonOption[];

  people.sort((a, b) => a.full_name.localeCompare(b.full_name));

  // Include resource_status so AllocateForm can detect pipeline projects
  const { data: projectRows } = await supabase
    .from("projects")
    .select("id, title, project_code, colour, start_date, finish_date, status, resource_status, lifecycle_status, deleted_at")
    .eq("organisation_id", activeOrgId)
    .is("deleted_at", null)
    .order("title", { ascending: true });

  const projects: ProjectOption[] = (projectRows ?? [])
    .filter((p: any) => {
      const lifecycle = safeStr(p.lifecycle_status).toLowerCase();
      const status    = safeStr(p.status).toLowerCase();
      return lifecycle !== "closed" && !status.includes("closed") && !status.includes("complete");
    })
    .map((p: any) => ({
      id:              String(p.id),
      title:           safeStr(p.title),
      project_code:    safeStr(p.project_code).trim() || null,
      colour:          safeStr(p.colour).trim() || null,
      start_date:      safeStr(p.start_date).trim() || null,
      finish_date:     safeStr(p.finish_date).trim() || null,
      resource_status: safeStr(p.resource_status).trim() || null,
    } satisfies ProjectOption));

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap"
        rel="stylesheet"
      />

      <main style={{ fontFamily: "'DM Sans', sans-serif", minHeight: "100vh", background: "#f8fafc", color: "#0f172a" }}>
        <div style={{ maxWidth: "760px", margin: "0 auto", padding: "48px 28px" }}>

          {/* Breadcrumb */}
          <nav style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#94a3b8", marginBottom: "24px" }}>
            <a href="/projects" style={{ color: "#00b8db", textDecoration: "none", fontWeight: 500 }}>Projects</a>
            <span>{">"}</span>
            {defaultProject ? (
              <>
                <a href={`/projects/${defaultProject}`} style={{ color: "#00b8db", textDecoration: "none", fontWeight: 500 }}>Project</a>
                <span>{">"}</span>
              </>
            ) : null}
            <span>Allocate resource</span>
          </nav>

          <div style={{ background: "white", borderRadius: "18px", border: "1.5px solid #e2e8f0", boxShadow: "0 2px 16px rgba(0,184,219,0.07), 0 1px 4px rgba(0,0,0,0.04)", overflow: "hidden" }}>

            {/* Header */}
            <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid #f1f5f9", background: "linear-gradient(135deg, rgba(0,184,219,0.04) 0%, transparent 60%)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{ width: "40px", height: "40px", borderRadius: "10px", background: "rgba(0,184,219,0.1)", border: "1px solid rgba(0,184,219,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px" }}>
                </div>
                <div>
                  <h1 style={{ fontSize: "17px", fontWeight: 800, color: "#0f172a", margin: 0, marginBottom: "3px" }}>
                    Allocate Resource
                  </h1>
                  <p style={{ fontSize: "13px", color: "#94a3b8", margin: 0 }}>
                    Assign a person to a project and auto-generate weekly allocation rows
                  </p>
                </div>
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: "20px", marginTop: "16px", paddingTop: "16px", borderTop: "1px solid #f1f5f9" }}>
                {[
                  { l: "People available", v: people.length },
                  { l: "Active projects",  v: projects.length },
                  { l: "Organisation",     v: orgName },
                ].map(s => (
                  <div key={s.l}>
                    <div style={{ fontSize: "10px", color: "#94a3b8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: "2px" }}>{s.l}</div>
                    <div style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a", fontFamily: "'DM Mono', monospace" }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Body */}
            <div style={{ padding: "28px" }}>
              {errorMsg && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "12px 16px", borderRadius: "9px", background: "#fef2f2", border: "1px solid #fecaca", color: "#dc2626", fontSize: "13px", fontWeight: 500, marginBottom: "20px" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="12" y1="8" x2="12" y2="12"/>
                    <line x1="12" y1="16" x2="12.01" y2="16"/>
                  </svg>
                  {errorMsg}
                </div>
              )}

              <AllocateForm
                people={people}
                projects={projects}
                defaultPersonId={defaultPerson}
                defaultProjectId={defaultProject}
                returnTo={returnTo}
                organisationId={activeOrgId}
              />
            </div>
          </div>

        </div>
      </main>
    </>
  );
}