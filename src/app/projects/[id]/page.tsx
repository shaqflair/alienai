// FILE: src/app/projects/[id]/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { fetchProjectResourceData, projectWeekPeriods } from "./_lib/resource-data";
import ProjectResourcePanel from "./_components/ProjectResourcePanel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "";
}
function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s || "").trim());
}
function isMissingColumnError(errMsg: string, col: string) {
  const m = String(errMsg || "").toLowerCase();
  const c = String(col || "").toLowerCase();
  return (
    (m.includes("column") && m.includes(c) && m.includes("does not exist")) ||
    (m.includes("could not find") && m.includes(c)) ||
    (m.includes("unknown column") && m.includes(c))
  );
}
function isInvalidInputSyntaxError(err: any) {
  return String(err?.code || "").trim() === "22P02";
}

const RESERVED = new Set(["artifacts", "changes", "change", "members", "approvals", "lessons", "raid", "schedule", "wbs"]);

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try {
    v = decodeURIComponent(v);
  } catch {}
  v = v.trim();
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];
  return v;
}

const HUMAN_COL_CANDIDATES = ["project_human_id", "human_id", "project_code", "code", "slug", "reference", "ref"] as const;

async function resolveProjectUuidFast(supabase: any, identifier: string, organisationId: string) {
  const raw = safeStr(identifier).trim();
  if (!raw) return { projectUuid: null as string | null, project: null as any };

  // If UUID provided: verify later via org-bound project fetch.
  if (looksLikeUuid(raw)) return { projectUuid: raw, project: null as any };

  const normalized = normalizeProjectIdentifier(raw);

  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("organisation_id", organisationId)
      .eq(col, normalized)
      .maybeSingle();

    if (error) {
      if (isMissingColumnError(error.message, col)) continue;
      if (isInvalidInputSyntaxError(error)) continue;
      throw error;
    }
    if (data?.id) return { projectUuid: String(data.id), project: data };
  }

  return { projectUuid: null as string | null, project: null as any };
}

function bestProjectRole(rows: Array<{ role?: string | null }> | null | undefined) {
  const roles = (rows ?? []).map((r) => String(r?.role ?? "").toLowerCase()).filter(Boolean);
  if (!roles.length) return "";
  if (roles.includes("owner")) return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

function flashText(msg: string | undefined, conflicts: string | undefined) {
  if (!msg) return null;
  if (msg === "allocated") {
    const c = conflicts ? parseInt(conflicts) : 0;
    return c > 0 ? `✓ Allocated — ${c} conflict week${c > 1 ? "s" : ""} flagged` : "✓ Resource allocated successfully";
  }
  if (msg === "allocation_removed") return "Allocation removed.";
  if (msg === "week_removed") return "Week removed.";
  if (msg === "week_updated") return "Week updated.";
  if (msg === "converted_to_confirmed") return "✓ Project converted to Confirmed — now live on the capacity heatmap.";
  return null;
}

function formatDate(d: string | null | undefined) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  try {
    return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000);
  } catch {
    return null;
  }
}

async function getOrgMembership(supabase: any, organisationId: string, userId: string) {
  // Returns: { isMember, isAdmin, role }
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role, is_active, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    // If table doesn't exist in a given env, degrade safely (treat as not a member)
    if (String(error?.message || "").toLowerCase().includes("does not exist")) {
      return { isMember: false, isAdmin: false, role: "" };
    }
    throw error;
  }

  const active =
    typeof data?.is_active === "boolean"
      ? data.is_active
      : data?.removed_at == null;

  const role = String(data?.role ?? "").toLowerCase();
  const isMember = Boolean(active) && Boolean(role);
  const isAdmin = Boolean(active) && (role === "admin" || role === "owner");
  return { isMember, isAdmin, role };
}

async function convertPipelineToConfirmed(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!user) redirect("/login");

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) redirect("/projects?err=no_active_org");

  const projectId = safeStr(formData.get("project_id")).trim();
  const returnTo = safeStr(formData.get("return_to")).trim() || "/projects";
  if (!projectId) redirect(`${returnTo}?err=missing_project_id`);

  // Ensure project is in active org (prevents cross-org updates)
  const { data: projRow, error: projErr } = await supabase
    .from("projects")
    .select("id, organisation_id, resource_status")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!projRow?.id || String(projRow.organisation_id) !== activeOrgId) redirect(`${returnTo}?err=forbidden`);

  // Member role OR org admin can convert
  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at, is_active")
    .eq("project_id", projectId)
    .eq("user_id", user.id)
    .is("removed_at", null);

  if (memErr) throw memErr;

  const myRole = bestProjectRole(memRows as any);
  const org = await getOrgMembership(supabase, activeOrgId, user.id);

  if (!(org.isAdmin || myRole === "owner" || myRole === "editor")) redirect(`${returnTo}?err=forbidden`);

  const { error: upErr } = await supabase
    .from("projects")
    .update({ resource_status: "confirmed" })
    .eq("id", projectId)
    .eq("resource_status", "pipeline");
  if (upErr) throw upErr;

  redirect(`${returnTo}?msg=converted_to_confirmed`);
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: { id?: string };
  searchParams?: { msg?: string; conflicts?: string; err?: string };
}) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) notFound();

  const rawId = safeParam(params?.id).trim();
  const sp = searchParams ?? {};
  if (!rawId) notFound();

  const lower = rawId.toLowerCase();
  if (RESERVED.has(lower)) redirect("/projects");

  // Resolve UUID within org (for human IDs); UUID verified by org-bound fetch below.
  const resolved = await resolveProjectUuidFast(supabase, rawId, activeOrgId);
  if (!resolved?.projectUuid) notFound();
  const projectUuid = String(resolved.projectUuid);

  // Fetch project WITH org constraint (UUID safety check)
  let project = resolved.project ?? null;
  if (!project) {
    const { data: p, error: pErr } = await supabase
      .from("projects")
      .select("id, organisation_id, title, project_code, colour, start_date, finish_date, resource_status, description")
      .eq("id", projectUuid)
      .eq("organisation_id", activeOrgId)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!p?.id) notFound();
    project = p;
  } else {
    if (String(project?.organisation_id ?? "") !== activeOrgId) notFound();
  }

  // ✅ ORG membership (this is the key fix for your 404)
  const org = await getOrgMembership(supabase, activeOrgId, auth.user.id);

  // Project membership
  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at, is_active")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .is("removed_at", null);

  if (memErr) throw memErr;

  const projectRole = bestProjectRole(memRows as any);

  // ✅ Allow: org member OR project member (admin handled inside org.isAdmin)
  const canSeeProject = org.isMember || Boolean(projectRole);
  if (!canSeeProject) notFound();

  const myRole = org.isAdmin && !projectRole ? "admin" : projectRole || (org.role || "viewer");
  const canEdit = org.isAdmin || myRole === "owner" || myRole === "editor";

  const [resourceData, changesResult, approvalsResult, membersResult, raidResult] = await Promise.allSettled([
    fetchProjectResourceData(projectUuid),
    supabase.from("changes").select("id, title, status, created_at, change_type").eq("project_id", projectUuid).order("created_at", { ascending: false }).limit(5),
    supabase.from("approvals").select("id, title, status, created_at").eq("project_id", projectUuid).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
    supabase.from("project_members").select("id, role, removed_at, is_active").eq("project_id", projectUuid).is("removed_at", null),
    supabase.from("raid_items").select("id, type, title, status, priority").eq("project_id", projectUuid).in("status", ["open", "active", "in_progress"]).order("priority", { ascending: false }).limit(20),
  ]);

  const resource = resourceData.status === "fulfilled" ? resourceData.value : null;
  const periods = resource ? projectWeekPeriods(resource.project.start_date, resource.project.finish_date) : [];
  const changes = changesResult.status === "fulfilled" ? changesResult.value.data ?? [] : [];
  const pendingApprovals = approvalsResult.status === "fulfilled" ? approvalsResult.value.data ?? [] : [];
  const members = membersResult.status === "fulfilled" ? membersResult.value.data ?? [] : [];
  const raidItems = raidResult.status === "fulfilled" ? raidResult.value.data ?? [] : [];

  const projectTitle = safeStr(project?.title ?? "Project") || "Project";
  const projectCode = safeStr(project?.project_code ?? "").trim();
  const projectColour = safeStr(project?.colour ?? "#00b8db");

  // ✅ Canonical URL ref = UUID
  const projectRefForUrls = projectUuid;

  const flash = flashText(sp?.msg, sp?.conflicts);
  const flashErr = sp?.err ? `Error: ${sp.err}` : null;
  const daysLeft = daysUntil(project?.finish_date);

  const risks = raidItems.filter((r: any) => r.type === "risk");
  const issues = raidItems.filter((r: any) => r.type === "issue");
  const actions = raidItems.filter((r: any) => r.type === "action");
  const decisions = raidItems.filter((r: any) => r.type === "decision");
  const totalMembers = members.length;
  const openRisks = risks.length;
  const openIssues = issues.length;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }
        .pp-nav-link { border-radius: 8px; padding: 7px 14px; font-size: 13px; font-weight: 600; text-decoration: none; border: 1.5px solid #e2e8f0; color: #475569; font-family: 'DM Sans', sans-serif; transition: all 0.15s; white-space: nowrap; }
        .pp-nav-link:hover { border-color: #00b8db; color: #00b8db; background: rgba(0,184,219,0.04); }
        .pp-nav-link.active { background: #00b8db; border-color: #00b8db; color: white; }
        .pp-card { background: white; border-radius: 12px; border: 1.5px solid #e2e8f0; box-shadow: 0 1px 4px rgba(0,0,0,0.04); }
        .pp-section-label { font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: #94a3b8; margin-bottom: 14px; display: flex; align-items: center; gap: 8px; }
        .pp-section-label::after { content: ''; flex: 1; height: 1px; background: #f1f5f9; }
        .stat-card { background: white; border-radius: 12px; border: 1.5px solid #e2e8f0; padding: 18px 20px; display: flex; flex-direction: column; gap: 4px; box-shadow: 0 1px 3px rgba(0,0,0,0.04); transition: border-color 0.15s; cursor: pointer; }
        .stat-card:hover { border-color: #cbd5e1; }
        .raid-quad { background: #f8fafc; border-radius: 10px; border: 1.5px solid #e2e8f0; padding: 16px; }
        .raid-quad-label { font-size: 10px; font-weight: 700; letter-spacing: 0.07em; text-transform: uppercase; margin-bottom: 10px; }
        .raid-item { font-size: 12px; color: #475569; padding: 6px 0; border-bottom: 1px solid #f1f5f9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .raid-item:last-child { border-bottom: none; }
        .activity-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid #f8fafc; }
        .activity-item:last-child { border-bottom: none; }
        .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 20px; font-size: 10px; font-weight: 700; white-space: nowrap; }
        @media (max-width: 900px) { .two-col { grid-template-columns: 1fr !important; } .four-col { grid-template-columns: repeat(2, 1fr) !important; } }
        @media (max-width: 560px) { .four-col { grid-template-columns: 1fr 1fr !important; } .raid-grid { grid-template-columns: 1fr 1fr !important; } }
      `}</style>

      <main style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ maxWidth: "1160px", margin: "0 auto", padding: "36px 28px" }}>
          {/* Top bar */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "24px", flexWrap: "wrap", gap: "10px" }}>
            <Link href="/projects" style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#64748b", textDecoration: "none", fontWeight: 500 }}>
              ← Projects
            </Link>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              {projectCode && (
                <span style={{ padding: "4px 10px", borderRadius: "20px", background: `${projectColour}15`, border: `1.5px solid ${projectColour}40`, borderLeft: `3px solid ${projectColour}`, fontSize: "12px", fontWeight: 700, fontFamily: "'DM Mono', monospace", color: projectColour }}>
                  {projectCode}
                </span>
              )}
              <span style={{ padding: "4px 10px", borderRadius: "20px", background: "#f1f5f9", border: "1px solid #e2e8f0", fontSize: "11px", color: "#64748b", fontWeight: 600, textTransform: "capitalize" }}>
                {myRole}
              </span>
              {project?.resource_status === "pipeline" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ padding: "4px 10px", borderRadius: "20px", background: "rgba(124,58,237,0.08)", border: "1.5px solid rgba(124,58,237,0.2)", fontSize: "11px", color: "#7c3aed", fontWeight: 700 }}>
                    ◎ Pipeline
                  </span>
                  {canEdit && (
                    <form action={convertPipelineToConfirmed}>
                      <input type="hidden" name="project_id" value={project.id} />
                      <input type="hidden" name="return_to" value={`/projects/${projectRefForUrls}`} />
                      <button type="submit" style={{ padding: "4px 12px", borderRadius: "20px", cursor: "pointer", background: "#00b8db", border: "1.5px solid #00b8db", fontSize: "11px", color: "white", fontWeight: 700, fontFamily: "inherit" }}>
                        ✓ Convert to confirmed
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Flash banners */}
          {flash && (
            <div style={{ marginBottom: "16px", padding: "11px 16px", borderRadius: "9px", background: "rgba(16,185,129,0.07)", border: "1.5px solid rgba(16,185,129,0.2)", fontSize: "13px", color: "#059669", fontWeight: 600 }}>
              {flash}
            </div>
          )}
          {flashErr && (
            <div style={{ marginBottom: "16px", padding: "11px 16px", borderRadius: "9px", background: "#fef2f2", border: "1px solid #fecaca", fontSize: "13px", color: "#dc2626", fontWeight: 600 }}>
              {flashErr}
            </div>
          )}

          {/* Header */}
          <header style={{ marginBottom: "28px" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "16px", marginBottom: "20px", flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                <div style={{ width: "4px", height: "40px", borderRadius: "2px", background: projectColour, flexShrink: 0 }} />
                <div>
                  <h1 style={{ fontSize: "26px", fontWeight: 800, color: "#0f172a", margin: 0, lineHeight: 1.2 }}>{projectTitle}</h1>
                  {(project?.start_date || project?.finish_date) && (
                    <p style={{ fontSize: "12px", color: "#94a3b8", margin: "4px 0 0", fontWeight: 500 }}>
                      {formatDate(project?.start_date)} → {formatDate(project?.finish_date)}
                      {daysLeft !== null && (
                        <span style={{ marginLeft: "10px", color: daysLeft < 0 ? "#ef4444" : daysLeft < 30 ? "#f59e0b" : "#10b981", fontWeight: 700 }}>
                          {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d remaining`}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </div>

              {canEdit && (
                <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                  <a
                    href={`/allocations/new?project_id=${projectUuid}&return_to=/projects/${projectRefForUrls}`}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px", background: projectColour, color: "white", fontSize: "12px", fontWeight: 700, textDecoration: "none" }}
                  >
                    + Allocate resource
                  </a>
                  <Link
                    href={`/projects/${projectRefForUrls}/artifacts`}
                    style={{ display: "inline-flex", alignItems: "center", gap: "6px", padding: "8px 14px", borderRadius: "8px", background: "white", color: "#475569", fontSize: "12px", fontWeight: 700, textDecoration: "none", border: "1.5px solid #e2e8f0" }}
                  >
                    + New artifact
                  </Link>
                </div>
              )}
            </div>

            <nav style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <Link className="pp-nav-link active" href={`/projects/${projectRefForUrls}`}>Overview</Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/artifacts`}>Artifacts</Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/changes`}>Changes</Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/approvals`}>
                Approvals
                {pendingApprovals.length > 0 && (
                  <span style={{ marginLeft: "6px", background: "#ef4444", color: "white", borderRadius: "20px", fontSize: "10px", fontWeight: 800, padding: "1px 6px" }}>
                    {pendingApprovals.length}
                  </span>
                )}
              </Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/members`}>Members</Link>
              <Link className="pp-nav-link" href="/heatmap" style={{ marginLeft: "auto" }}>Full heatmap →</Link>
            </nav>
          </header>

          {/* Summary stat cards */}
          <div className="four-col" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "28px" }}>
            <Link href={`/projects/${projectRefForUrls}/members`} style={{ textDecoration: "none" }}>
              <div className="stat-card">
                <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8" }}>Team</span>
                <span style={{ fontSize: "28px", fontWeight: 800, color: "#0f172a", lineHeight: 1.1 }}>{totalMembers}</span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>active member{totalMembers !== 1 ? "s" : ""}</span>
              </div>
            </Link>

            <Link href={`/projects/${projectRefForUrls}/raid`} style={{ textDecoration: "none" }}>
              <div className="stat-card" style={{ borderColor: openRisks > 0 ? "rgba(239,68,68,0.3)" : "#e2e8f0" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8" }}>Open Risks</span>
                <span style={{ fontSize: "28px", fontWeight: 800, color: openRisks > 0 ? "#ef4444" : "#0f172a", lineHeight: 1.1 }}>{openRisks}</span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>{openIssues} open issue{openIssues !== 1 ? "s" : ""}</span>
              </div>
            </Link>

            <Link href={`/projects/${projectRefForUrls}/approvals`} style={{ textDecoration: "none" }}>
              <div className="stat-card" style={{ borderColor: pendingApprovals.length > 0 ? "rgba(245,158,11,0.3)" : "#e2e8f0" }}>
                <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8" }}>Pending Approvals</span>
                <span style={{ fontSize: "28px", fontWeight: 800, color: pendingApprovals.length > 0 ? "#f59e0b" : "#0f172a", lineHeight: 1.1 }}>{pendingApprovals.length}</span>
                <span style={{ fontSize: "12px", color: "#64748b" }}>awaiting action</span>
              </div>
            </Link>

            <div className="stat-card">
              <span style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", color: "#94a3b8" }}>Finish Date</span>
              <span style={{ fontSize: "22px", fontWeight: 800, color: "#0f172a", lineHeight: 1.2, marginTop: "2px" }}>
                {project?.finish_date ? new Date(project.finish_date).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : "—"}
              </span>
              <span style={{ fontSize: "12px", color: daysLeft !== null && daysLeft < 0 ? "#ef4444" : daysLeft !== null && daysLeft < 30 ? "#f59e0b" : "#64748b" }}>
                {daysLeft !== null ? (daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d to go`) : "No date set"}
              </span>
            </div>
          </div>

          {/* Main two-column body */}
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: "20px", alignItems: "start" }}>
            {/* LEFT: Resource planning */}
            <div>
              <div className="pp-section-label">● Resource planning</div>
              {resource ? (
                <ProjectResourcePanel data={resource} periods={periods} />
              ) : (
                <div className="pp-card" style={{ padding: "32px", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>
                  Resource data unavailable. Run <code style={{ fontSize: "12px" }}>allocations_migration.sql</code> to enable.
                </div>
              )}
            </div>

            {/* RIGHT column */}
            <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              {/* Recent activity */}
              <div>
                <div className="pp-section-label">● Recent activity</div>
                <div className="pp-card" style={{ padding: "0 18px" }}>
                  {changes.length === 0 && pendingApprovals.length === 0 ? (
                    <div style={{ padding: "24px 0", textAlign: "center", color: "#94a3b8", fontSize: "13px" }}>No recent activity</div>
                  ) : (
                    <>
                      {pendingApprovals.slice(0, 2).map((a: any) => (
                        <div key={a.id} className="activity-item">
                          <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: "rgba(245,158,11,0.1)", border: "1.5px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", flexShrink: 0 }}>
                            ⏳
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{a.title}</p>
                            <p style={{ margin: "2px 0 0", fontSize: "11px", color: "#94a3b8" }}>Approval pending</p>
                          </div>
                        </div>
                      ))}
                      {changes.slice(0, 4).map((c: any) => {
                        const col = ({ approved: "#10b981", rejected: "#ef4444", pending: "#f59e0b", draft: "#94a3b8" } as any)[c.status] ?? "#64748b";
                        return (
                          <div key={c.id} className="activity-item">
                            <div style={{ width: "28px", height: "28px", borderRadius: "8px", background: `${col}15`, border: `1.5px solid ${col}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", flexShrink: 0 }}>
                              ⚡
                            </div>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <p style={{ margin: 0, fontSize: "12px", fontWeight: 600, color: "#0f172a", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.title}</p>
                              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                                <span className="badge" style={{ background: `${col}15`, color: col, border: `1px solid ${col}30` }}>
                                  {c.status}
                                </span>
                                <span style={{ fontSize: "11px", color: "#94a3b8" }}>{new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  )}
                  <div style={{ borderTop: "1px solid #f1f5f9", padding: "10px 0" }}>
                    <Link href={`/projects/${projectRefForUrls}/changes`} style={{ fontSize: "12px", color: "#00b8db", fontWeight: 600, textDecoration: "none" }}>
                      View all changes →
                    </Link>
                  </div>
                </div>
              </div>

              {/* Quick actions */}
              <div>
                <div className="pp-section-label">● Quick actions</div>
                <div className="pp-card" style={{ padding: "8px 18px" }}>
                  {[
                    { href: `/projects/${projectRefForUrls}/artifacts`, icon: "📄", label: "Artifacts" },
                    { href: `/projects/${projectRefForUrls}/changes`, icon: "⚡", label: "Changes" },
                    { href: `/projects/${projectRefForUrls}/approvals`, icon: "✅", label: `Approvals`, badge: pendingApprovals.length },
                    { href: `/projects/${projectRefForUrls}/members`, icon: "👥", label: `Members (${totalMembers})` },
                  ].map((item, i, arr) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        fontSize: "13px",
                        color: "#475569",
                        textDecoration: "none",
                        fontWeight: 600,
                        padding: "11px 0",
                        borderBottom: i < arr.length - 1 ? "1px solid #f8fafc" : "none",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span>{item.icon}</span>
                        <span>{item.label}</span>
                        {item.badge ? <span style={{ background: "#ef4444", color: "white", borderRadius: "20px", fontSize: "10px", fontWeight: 800, padding: "1px 6px" }}>{item.badge}</span> : null}
                      </span>
                      <span style={{ color: "#00b8db", fontSize: "14px" }}>→</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* RAID summary */}
          <div style={{ marginTop: "28px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "14px" }}>
              <div className="pp-section-label" style={{ marginBottom: 0, flex: 1 }}>
                ● RAID log
              </div>
              <Link href={`/projects/${projectRefForUrls}/raid`} style={{ fontSize: "12px", color: "#00b8db", fontWeight: 700, textDecoration: "none", whiteSpace: "nowrap", marginLeft: "16px" }}>
                View full RAID →
              </Link>
            </div>
            <div className="raid-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px" }}>
              {[
                { label: "🔴 Risks", items: risks, color: risks.length > 0 ? "#ef4444" : "#94a3b8", border: risks.length > 0 ? "rgba(239,68,68,0.2)" : "#e2e8f0" },
                { label: "🟡 Issues", items: issues, color: issues.length > 0 ? "#f59e0b" : "#94a3b8", border: issues.length > 0 ? "rgba(245,158,11,0.2)" : "#e2e8f0" },
                { label: "🔵 Actions", items: actions, color: "#3b82f6", border: "#e2e8f0" },
                { label: "🟣 Decisions", items: decisions, color: "#8b5cf6", border: "#e2e8f0" },
              ].map(({ label, items, color, border }) => (
                <div key={label} className="raid-quad" style={{ borderColor: border }}>
                  <div className="raid-quad-label" style={{ color }}>
                    {label} <span style={{ fontWeight: 400, opacity: 0.6 }}>({items.length})</span>
                  </div>
                  {items.length === 0 ? (
                    <p style={{ fontSize: "12px", color: "#cbd5e1", margin: 0 }}>None open</p>
                  ) : (
                    (items as any[]).slice(0, 3).map((item) => (
                      <div key={item.id} className="raid-item">
                        {item.title}
                      </div>
                    ))
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>
    </>
  );
}