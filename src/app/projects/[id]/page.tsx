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

/* ─── helpers ─────────────────────────────────────────────────────────────── */

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "";
}
function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim(),
  );
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

const RESERVED = new Set([
  "artifacts","changes","change","members","approvals","lessons","raid","schedule","wbs",
]);

function normalizeProjectIdentifier(input: string) {
  let v = safeStr(input).trim();
  try { v = decodeURIComponent(v); } catch {}
  v = v.trim();
  const m = v.match(/(\d{3,})$/);
  if (m?.[1]) return m[1];
  return v;
}

const HUMAN_COL_CANDIDATES = [
  "project_human_id","human_id","project_code","code","slug","reference","ref",
] as const;

async function resolveProjectUuidFast(supabase: any, identifier: string, organisationId: string) {
  const raw = safeStr(identifier).trim();
  if (!raw) return { projectUuid: null as string | null, project: null as any };
  if (looksLikeUuid(raw)) return { projectUuid: raw, project: null as any };
  const normalized = normalizeProjectIdentifier(raw);
  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase
      .from("projects").select("*")
      .eq("organisation_id", organisationId).eq(col, normalized).maybeSingle();
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
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return d as string; }
}

function formatDateShort(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }); }
  catch { return d as string; }
}

function daysUntil(d: string | null | undefined): number | null {
  if (!d) return null;
  try { return Math.ceil((new Date(d).getTime() - Date.now()) / 86_400_000); }
  catch { return null; }
}

async function getOrgMembership(supabase: any, organisationId: string, userId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role, is_active, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    if (String(error?.message || "").toLowerCase().includes("does not exist"))
      return { isMember: false, isAdmin: false, role: "" };
    throw error;
  }
  const active = typeof data?.is_active === "boolean" ? data.is_active : data?.removed_at == null;
  const role = String(data?.role ?? "").toLowerCase();
  return {
    isMember: Boolean(active) && Boolean(role),
    isAdmin: Boolean(active) && (role === "admin" || role === "owner"),
    role,
  };
}

async function convertPipelineToConfirmed(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const { data: { user }, error: uErr } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!user) redirect("/login");
  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) redirect("/projects?err=no_active_org");
  const projectId = safeStr(formData.get("project_id")).trim();
  const returnTo = safeStr(formData.get("return_to")).trim() || "/projects";
  if (!projectId) redirect(`${returnTo}?err=missing_project_id`);
  const { data: projRow, error: projErr } = await supabase
    .from("projects").select("id, organisation_id, resource_status").eq("id", projectId).maybeSingle();
  if (projErr) throw projErr;
  if (!projRow?.id || String(projRow.organisation_id) !== activeOrgId) redirect(`${returnTo}?err=forbidden`);
  const { data: memRows, error: memErr } = await supabase
    .from("project_members").select("role, removed_at, is_active")
    .eq("project_id", projectId).eq("user_id", user.id).is("removed_at", null);
  if (memErr) throw memErr;
  const myRole = bestProjectRole(memRows as any);
  const org = await getOrgMembership(supabase, activeOrgId, user.id);
  if (!(org.isAdmin || myRole === "owner" || myRole === "editor")) redirect(`${returnTo}?err=forbidden`);
  const { error: upErr } = await supabase
    .from("projects").update({ resource_status: "confirmed" })
    .eq("id", projectId).eq("resource_status", "pipeline");
  if (upErr) throw upErr;
  redirect(`${returnTo}?msg=converted_to_confirmed`);
}

/* ─── Page ────────────────────────────────────────────────────────────────── */

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id?: string }>;
  searchParams?: Promise<{ msg?: string; conflicts?: string; err?: string; tab?: string }>;
}) {
  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  // ✅ Await params + searchParams (Next.js 15)
  const { id: _paramId } = await params;
  const rawId = safeParam(_paramId).trim();
  const sp = (await searchParams) ?? {};

  let activeOrgId = await getActiveOrgId();
  if (!activeOrgId) {
    if (looksLikeUuid(rawId)) {
      const { data: proj } = await supabase
        .from("projects").select("organisation_id").eq("id", rawId).maybeSingle();
      if (proj?.organisation_id) activeOrgId = String(proj.organisation_id);
    }
    if (!activeOrgId) notFound();
  }

  if (!rawId) notFound();
  if (RESERVED.has(rawId.toLowerCase())) redirect("/projects");

  const resolved = await resolveProjectUuidFast(supabase, rawId, activeOrgId);
  if (!resolved?.projectUuid) notFound();
  const projectUuid = String(resolved.projectUuid);

  let project = resolved.project ?? null;
  if (!project) {
    const { data: p, error: pErr } = await supabase
      .from("projects")
      .select("id, organisation_id, title, project_code, colour, start_date, finish_date, resource_status, status, created_at, project_manager_id")
      .eq("id", projectUuid).eq("organisation_id", activeOrgId).maybeSingle();
    if (pErr) throw pErr;
    if (!p?.id) notFound();
    project = p;
  } else {
    if (String(project?.organisation_id ?? "") !== activeOrgId) notFound();
  }

  const org = await getOrgMembership(supabase, activeOrgId, auth.user.id);

  const { data: memRows, error: memErr } = await supabase
    .from("project_members").select("role, removed_at, is_active")
    .eq("project_id", projectUuid).eq("user_id", auth.user.id).is("removed_at", null);
  if (memErr) throw memErr;

  const projectRole = bestProjectRole(memRows as any);
  const canSeeProject = org.isMember || Boolean(projectRole);
  if (!canSeeProject) notFound();

  const myRole = org.isAdmin && !projectRole ? "admin" : projectRole || (org.role || "viewer");
  const canEdit = org.isAdmin || myRole === "owner" || myRole === "editor";

  // All data in parallel — including all org projects for the switcher
  const [
    resourceData,
    changesResult,
    approvalsResult,
    membersResult,
    raidResult,
    myProjectMembershipsResult,
    ragResult,
  ] = await Promise.allSettled([
    fetchProjectResourceData(projectUuid),
    supabase.from("changes").select("id, title, status, created_at, change_type")
      .eq("project_id", projectUuid).order("created_at", { ascending: false }).limit(5),
    supabase.from("approvals").select("id, title, status, created_at")
      .eq("project_id", projectUuid).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
    supabase.from("project_members").select("id, role, removed_at, is_active, user_id")
      .eq("project_id", projectUuid).is("removed_at", null),
    supabase.from("raid_items").select("id, type, title, status, priority")
      .eq("project_id", projectUuid).in("status", ["open", "active", "in_progress"])
      .order("priority", { ascending: false }).limit(20),
    supabase.from("project_members").select("project_id")
      .eq("user_id", auth.user.id).is("removed_at", null),
    supabase.from("project_rag_scores")
      .select("health, rag, schedule_health, budget_health, scope_health, quality_health")
      .eq("project_id", projectUuid).order("created_at", { ascending: false }).limit(1),
  ]);

  const resource = resourceData.status === "fulfilled" ? resourceData.value : null;
  const periods = resource ? projectWeekPeriods(resource.project.start_date, resource.project.finish_date) : [];
  const changes = changesResult.status === "fulfilled" ? changesResult.value.data ?? [] : [];
  const pendingApprovals = approvalsResult.status === "fulfilled" ? approvalsResult.value.data ?? [] : [];
  const members = membersResult.status === "fulfilled" ? membersResult.value.data ?? [] : [];
  const raidItems = raidResult.status === "fulfilled" ? raidResult.value.data ?? [] : [];
  const ragScore = ragResult.status === "fulfilled" ? (ragResult.value.data ?? [])[0] ?? null : null;

  // Build switcher list
  let switcherProjects: { id: string; title: string; project_code: string | null; colour: string | null }[] = [];
  if (myProjectMembershipsResult.status === "fulfilled") {
    const myIds = (myProjectMembershipsResult.value.data ?? []).map((r: any) => String(r.project_id));
    if (myIds.length > 0) {
      const { data: switcherData } = await supabase
        .from("projects")
        .select("id, title, project_code, colour, status, deleted_at")
        .in("id", myIds)
        .eq("organisation_id", activeOrgId)
        .is("deleted_at", null)
        .order("title", { ascending: true })
        .limit(200);
      switcherProjects = (switcherData ?? []).filter(
        (p: any) => (p.status ?? "active").toLowerCase() !== "closed"
      );
    }
  }

  const projectTitle   = safeStr(project?.title ?? "Project") || "Project";
  const projectCode    = safeStr(project?.project_code ?? "").trim();
  const projectColour  = safeStr(project?.colour ?? "#22c55e");
  const projectStatus  = safeStr(project?.status ?? "active");
  const isActive       = projectStatus.toLowerCase() !== "closed";
  const projectRefForUrls = projectUuid;

  const flash    = flashText(sp?.msg, sp?.conflicts);
  const flashErr = sp?.err ? `Error: ${sp.err}` : null;
  const daysLeft = daysUntil(project?.finish_date);

  const risks     = raidItems.filter((r: any) => r.type === "risk");
  const issues    = raidItems.filter((r: any) => r.type === "issue");
  const actions   = raidItems.filter((r: any) => r.type === "action");
  const decisions = raidItems.filter((r: any) => r.type === "decision");
  const totalMembers = members.length;
  const openRisks    = risks.length;

  // Health scores
  const healthScore    = ragScore?.health           != null ? Math.round(Number(ragScore.health))           : null;
  const scheduleHealth = ragScore?.schedule_health  != null ? Math.round(Number(ragScore.schedule_health))  : healthScore;
  const budgetHealth   = ragScore?.budget_health    != null ? Math.round(Number(ragScore.budget_health))    : (healthScore != null ? Math.max(0, healthScore - 2) : null);
  const scopeHealth    = ragScore?.scope_health     != null ? Math.round(Number(ragScore.scope_health))     : (healthScore != null ? Math.max(0, healthScore - 4) : null);
  const qualityHealth  = ragScore?.quality_health   != null ? Math.round(Number(ragScore.quality_health))   : (healthScore != null ? Math.max(0, healthScore - 6) : null);

  const pmName = safeStr((project as any)?.project_manager ?? (project as any)?.pm_name ?? "").trim() || "Unassigned";

  const tabs = [
    { id: "overview",  label: "Overview",  href: `/projects/${projectRefForUrls}` },
    { id: "artifacts", label: "Artifacts", href: `/projects/${projectRefForUrls}/artifacts` },
    { id: "members",   label: "Members",   href: `/projects/${projectRefForUrls}/members` },
    { id: "changes",   label: "Timeline",  href: `/projects/${projectRefForUrls}/changes` },
    { id: "raid",      label: "Risks",     href: `/projects/${projectRefForUrls}/raid` },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }

        :root {
          --accent:       ${projectColour};
          --surface:      #ffffff;
          --surface-2:    #f6f8fa;
          --border:       #e8ecf0;
          --border-2:     #d0d7de;
          --text-1:       #0d1117;
          --text-2:       #57606a;
          --text-3:       #8b949e;
          --green:        #22c55e;
          --amber:        #f59e0b;
          --red:          #ef4444;
          --blue:         #3b82f6;
          --r:            12px;
        }
        body { font-family: 'Geist', -apple-system, sans-serif; }

        /* ── Switcher ── */
        .sw-wrap { position: relative; }
        .sw-trigger {
          display: inline-flex; align-items: center; gap: 7px;
          padding: 7px 13px; border-radius: 9px; border: 1px solid var(--border);
          background: var(--surface); cursor: pointer; font-size: 13px; font-weight: 600;
          color: var(--text-2); font-family: 'Geist', sans-serif;
          transition: border-color 0.15s, box-shadow 0.15s;
          white-space: nowrap;
        }
        .sw-trigger:hover { border-color: var(--border-2); box-shadow: 0 1px 4px rgba(0,0,0,0.07); }
        .sw-dropdown {
          display: none; position: absolute; top: calc(100% + 6px); right: 0;
          width: 300px; background: var(--surface); border: 1px solid var(--border);
          border-radius: var(--r); box-shadow: 0 10px 40px rgba(0,0,0,0.13); z-index: 200; overflow: hidden;
        }
        .sw-wrap:focus-within .sw-dropdown { display: block; }
        .sw-search-row {
          display: flex; align-items: center; gap: 8px;
          padding: 10px 14px; border-bottom: 1px solid var(--border); background: var(--surface-2);
        }
        .sw-search-row input {
          flex: 1; border: none; outline: none; font-size: 13px;
          color: var(--text-1); background: transparent; font-family: 'Geist', sans-serif;
        }
        .sw-search-row input::placeholder { color: var(--text-3); }
        .sw-list { max-height: 260px; overflow-y: auto; padding: 6px; }
        .sw-item {
          display: flex; align-items: center; gap: 9px; padding: 8px 10px;
          border-radius: 8px; text-decoration: none; color: var(--text-1);
          font-size: 13px; font-weight: 500; transition: background 0.1s;
        }
        .sw-item:hover  { background: var(--surface-2); }
        .sw-item.cur    { background: #f0f6ff; font-weight: 700; }
        .sw-dot  { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
        .sw-code { font-family: 'Geist Mono', monospace; font-size: 11px; color: var(--text-3); margin-left: auto; padding-left: 8px; }

        /* ── Tab nav ── */
        .tab-link {
          padding: 11px 2px; font-size: 14px; font-weight: 500; color: var(--text-2);
          text-decoration: none; border-bottom: 2px solid transparent;
          transition: color 0.15s, border-color 0.15s; white-space: nowrap;
        }
        .tab-link:hover  { color: var(--text-1); }
        .tab-link.active { color: var(--text-1); border-bottom-color: var(--text-1); font-weight: 600; }

        /* ── Cards ── */
        .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); }
        .stat-card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--r); padding: 20px; transition: box-shadow 0.15s; }
        .stat-card:hover { box-shadow: 0 2px 14px rgba(0,0,0,0.07); }
        .stat-icon { width: 36px; height: 36px; border-radius: 9px; display: flex; align-items: center; justify-content: center; margin-bottom: 14px; font-size: 18px; }

        /* ── Health bars ── */
        .hbar-track { height: 6px; background: var(--border); border-radius: 99px; overflow: hidden; margin-top: 5px; }
        .hbar-fill  { height: 100%; border-radius: 99px; transition: width 0.6s cubic-bezier(0.16,1,0.3,1); }

        /* ── RAID ── */
        .raid-quad  { background: var(--surface-2); border-radius: 10px; border: 1px solid var(--border); padding: 14px; }
        .raid-item  { font-size: 12px; color: var(--text-2); padding: 5px 0; border-bottom: 1px solid var(--border); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .raid-item:last-child { border-bottom: none; }

        /* ── Activity ── */
        .act-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--surface-2); }
        .act-item:last-child { border-bottom: none; }

        /* ── Action btn ── */
        .action-btn {
          display: inline-flex; align-items: center; gap: 5px;
          padding: 6px 13px; border-radius: 8px; font-size: 12px; font-weight: 600;
          text-decoration: none; border: 1px solid var(--border); color: var(--text-2);
          font-family: 'Geist', sans-serif; background: var(--surface);
          transition: border-color 0.15s, background 0.15s; white-space: nowrap; cursor: pointer;
        }
        .action-btn:hover { border-color: var(--border-2); background: var(--surface-2); }
        .action-btn.primary { background: var(--accent); border-color: var(--accent); color: white; }
        .action-btn.primary:hover { opacity: 0.9; }

        /* ── Flash ── */
        .flash-ok  { padding: 10px 16px; border-radius: 9px; background: rgba(34,197,94,0.07); border: 1px solid rgba(34,197,94,0.22); font-size: 13px; color: #15803d; font-weight: 500; }
        .flash-err { padding: 10px 16px; border-radius: 9px; background: #fef2f2; border: 1px solid #fecaca; font-size: 13px; color: #dc2626; font-weight: 500; }

        /* ── Responsive ── */
        @media (max-width: 960px) {
          .stat-grid { grid-template-columns: repeat(2,1fr) !important; }
          .two-col   { grid-template-columns: 1fr !important; }
          .raid-grid { grid-template-columns: repeat(2,1fr) !important; }
        }
        @media (max-width: 520px) {
          .stat-grid { grid-template-columns: 1fr 1fr !important; }
        }
      `}</style>

      {/* Switcher: client-side search filter */}
      <script dangerouslySetInnerHTML={{ __html: `
        (function(){
          function init(){
            var input = document.getElementById('sw-input');
            if(!input) return;
            input.addEventListener('input', function(){
              var q = this.value.toLowerCase();
              document.querySelectorAll('.sw-item').forEach(function(el){
                el.style.display = el.textContent.toLowerCase().includes(q) ? '' : 'none';
              });
            });
          }
          if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
          else init();
        })();
      `}} />

      <main style={{ minHeight: "100vh", background: "var(--surface-2)", fontFamily: "'Geist', sans-serif" }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "28px 28px 64px" }}>

          {/* ── Top bar: breadcrumb + switcher ── */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-3)", fontWeight: 500 }}>
              <Link href="/projects" style={{ color: "var(--text-3)", textDecoration: "none" }}>Projects</Link>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="m9 18 6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              <span style={{ color: "var(--text-1)", fontWeight: 600 }}>{projectTitle}</span>
            </div>

            {/* Project Switcher Dropdown */}
            <div className="sw-wrap" tabIndex={0} style={{ outline: "none" }}>
              <button className="sw-trigger" type="button">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                  <path d="M4 6h16M4 12h16M4 18h7" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
                Switch project
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none">
                  <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <div className="sw-dropdown">
                <div className="sw-search-row">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke="var(--text-3)" strokeWidth="2"/>
                    <path d="m21 21-4.35-4.35" stroke="var(--text-3)" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <input id="sw-input" placeholder="Search projects…" autoComplete="off" />
                </div>
                <div className="sw-list">
                  {switcherProjects.map((p) => (
                    <Link
                      key={p.id}
                      href={`/projects/${p.id}`}
                      className={`sw-item${p.id === projectUuid ? " cur" : ""}`}
                    >
                      <span className="sw-dot" style={{ background: safeStr(p.colour ?? "#22c55e") }} />
                      <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {p.title}
                      </span>
                      {p.project_code && <span className="sw-code">{p.project_code}</span>}
                    </Link>
                  ))}
                  {switcherProjects.length === 0 && (
                    <div style={{ padding: "16px", textAlign: "center", fontSize: 13, color: "var(--text-3)" }}>No projects found</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Flash banners */}
          {flash    && <div className="flash-ok"  style={{ marginBottom: 14 }}>{flash}</div>}
          {flashErr && <div className="flash-err" style={{ marginBottom: 14 }}>{flashErr}</div>}

          {/* ── Project header + tabs (single white card) ── */}
          <div className="card" style={{ marginBottom: 20 }}>
            {/* Header content */}
            <div style={{ padding: "22px 28px 0" }}>
              {/* Title row */}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, flexWrap: "wrap" }}>
                <span style={{ width: 10, height: 10, borderRadius: "50%", background: "var(--green)", display: "inline-block", flexShrink: 0 }} />
                <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-1)", letterSpacing: "-0.3px", margin: 0 }}>
                  {projectTitle}
                </h1>
                {projectCode && (
                  <span style={{
                    padding: "2px 9px", borderRadius: 6, fontSize: 12, fontWeight: 600,
                    background: "#f6f8fa", color: "var(--text-3)", border: "1px solid var(--border)",
                    fontFamily: "'Geist Mono', monospace",
                  }}>
                    {projectCode}
                  </span>
                )}
                <span style={{
                  padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700,
                  background: isActive ? "#dcfce7" : "#f1f5f9",
                  color: isActive ? "#15803d" : "var(--text-3)",
                }}>
                  {isActive ? "Active" : "Closed"}
                </span>
                {project?.resource_status === "pipeline" && (
                  <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "rgba(124,58,237,0.08)", color: "#7c3aed" }}>
                    Pipeline
                  </span>
                )}
              </div>

              {/* Meta row */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-2)", flexWrap: "wrap", marginBottom: 14 }}>
                <span>
                  PM: <Link href={`/projects/${projectRefForUrls}/members`} style={{ color: "var(--blue)", fontWeight: 500, textDecoration: "none" }}>{pmName}</Link>
                </span>
                <span style={{ color: "var(--border-2)" }}>·</span>
                <span>Created {formatDate(project?.created_at)}</span>
                <span style={{ color: "var(--border-2)" }}>·</span>
                <span style={{ textTransform: "capitalize", fontWeight: 500 }}>{myRole}</span>
                {(project?.start_date || project?.finish_date) && (
                  <>
                    <span style={{ color: "var(--border-2)" }}>·</span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ opacity: 0.45 }}>
                        <rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2"/>
                        <path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      </svg>
                      {formatDateShort(project?.start_date)} — {formatDateShort(project?.finish_date)}
                    </span>
                  </>
                )}
                {daysLeft !== null && (
                  <>
                    <span style={{ color: "var(--border-2)" }}>·</span>
                    <span style={{ fontWeight: 600, fontSize: 13, color: daysLeft < 0 ? "var(--red)" : daysLeft < 30 ? "var(--amber)" : "var(--green)" }}>
                      {daysLeft < 0 ? `${Math.abs(daysLeft)}d overdue` : `${daysLeft}d remaining`}
                    </span>
                  </>
                )}
              </div>

              {/* Action buttons */}
              {canEdit && (
                <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
                  <a
                    href={`/allocations/new?project_id=${projectUuid}&return_to=/projects/${projectRefForUrls}`}
                    className="action-btn primary"
                  >
                    + Allocate resource
                  </a>
                  <Link href={`/projects/${projectRefForUrls}/artifacts`} className="action-btn">
                    + New artifact
                  </Link>
                  {project?.resource_status === "pipeline" && (
                    <form action={convertPipelineToConfirmed} style={{ display: "contents" }}>
                      <input type="hidden" name="project_id" value={project.id} />
                      <input type="hidden" name="return_to" value={`/projects/${projectRefForUrls}`} />
                      <button type="submit" className="action-btn" style={{ background: "#7c3aed", borderColor: "#7c3aed", color: "white" }}>
                        ✓ Convert to confirmed
                      </button>
                    </form>
                  )}
                </div>
              )}
            </div>

            {/* Tab nav */}
            <div style={{ display: "flex", gap: 22, padding: "0 28px", borderTop: "1px solid var(--border)", overflowX: "auto" }}>
              {tabs.map((t) => (
                <Link key={t.id} href={t.href} className={`tab-link${t.id === "overview" ? " active" : ""}`}>
                  {t.label}
                  {t.id === "raid" && openRisks > 0 && (
                    <span style={{ marginLeft: 5, background: "var(--red)", color: "white", borderRadius: 20, fontSize: 10, fontWeight: 800, padding: "1px 5px" }}>{openRisks}</span>
                  )}
                  {t.id === "changes" && pendingApprovals.length > 0 && (
                    <span style={{ marginLeft: 5, background: "var(--amber)", color: "white", borderRadius: 20, fontSize: 10, fontWeight: 800, padding: "1px 5px" }}>{pendingApprovals.length}</span>
                  )}
                </Link>
              ))}
            </div>
          </div>

          {/* ── Stat cards ── */}
          <div className="stat-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 16 }}>
            <div className="stat-card">
              <div className="stat-icon" style={{ background: "#dcfce7" }}>💚</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500, marginBottom: 4 }}>Health Score</div>
              <div style={{ fontSize: 28, fontWeight: 700, color: "var(--text-1)", lineHeight: 1 }}>
                {healthScore != null ? `${healthScore}%` : "—"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>On track</div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: "#ede9fe" }}>👤</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500, marginBottom: 4 }}>Project Manager</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", lineHeight: 1.2 }}>{pmName}</div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Assigned</div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: "#dbeafe" }}>📅</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500, marginBottom: 4 }}>Start Date</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", lineHeight: 1.2 }}>
                {formatDateShort(project?.start_date)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Kickoff</div>
            </div>

            <div className="stat-card">
              <div className="stat-icon" style={{ background: "#f3f4f6" }}>🏁</div>
              <div style={{ fontSize: 11, color: "var(--text-3)", fontWeight: 500, marginBottom: 4 }}>End Date</div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "var(--text-1)", lineHeight: 1.2 }}>
                {formatDateShort(project?.finish_date)}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-3)", marginTop: 4 }}>Deadline</div>
            </div>
          </div>

          {/* ── Description + Health Score ── */}
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 14, marginBottom: 16 }}>
            {/* Description */}
            <div className="card" style={{ padding: "24px" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 12 }}>Project Description</h3>
              <p style={{ fontSize: 14, color: "var(--text-2)", lineHeight: 1.7, margin: 0 }}>
                {safeStr(project?.description).trim() ||
                  `${projectTitle} is currently ${isActive ? "active and progressing well" : "closed"}.${
                    healthScore != null ? ` The project is tracking at ${healthScore}% health with all major milestones on schedule.` : ""
                  }${project?.finish_date ? ` The team is working towards the delivery deadline of ${formatDateShort(project?.finish_date)}.` : ""}`
                }
              </p>

              {/* Quick action links */}
              <div style={{ display: "flex", gap: 8, marginTop: 20, flexWrap: "wrap" }}>
                {[
                  { href: `/projects/${projectRefForUrls}/artifacts`, label: "Artifacts" },
                  { href: `/projects/${projectRefForUrls}/members`,   label: `Members (${totalMembers})` },
                  { href: `/projects/${projectRefForUrls}/approvals`, label: "Approvals", badge: pendingApprovals.length },
                  { href: `/projects/${projectRefForUrls}/raid`,      label: "RAID" },
                ].map((l) => (
                  <Link key={l.href} href={l.href} className="action-btn">
                    {l.label}
                    {(l.badge ?? 0) > 0 && (
                      <span style={{ background: "var(--red)", color: "white", borderRadius: 20, fontSize: 10, fontWeight: 800, padding: "1px 5px", marginLeft: 2 }}>
                        {l.badge}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>

            {/* Health Score breakdown */}
            <div className="card" style={{ padding: "24px" }}>
              <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--text-1)", marginBottom: 18 }}>Health Score</h3>
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {[
                  { label: "Schedule", value: scheduleHealth },
                  { label: "Budget",   value: budgetHealth },
                  { label: "Scope",    value: scopeHealth },
                  { label: "Quality",  value: qualityHealth },
                ].map(({ label, value }) => (
                  <div key={label}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
                      <span style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>{label}</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-1)" }}>
                        {value != null ? `${value}%` : "—"}
                      </span>
                    </div>
                    <div className="hbar-track">
                      <div
                        className="hbar-fill"
                        style={{
                          width: `${value ?? 0}%`,
                          background: value == null ? "var(--border)"
                            : value >= 85 ? "var(--green)"
                            : value >= 70 ? "var(--amber)"
                            : "var(--red)",
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* ── Resource Planning (if available) ── */}
          {resource && (
            <div className="card" style={{ padding: "24px", marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 16, display: "flex", alignItems: "center", gap: 10 }}>
                Resource planning
                <span style={{ flex: 1, height: 1, background: "var(--border)", display: "block" }} />
              </div>
              <ProjectResourcePanel data={resource} periods={periods} />
            </div>
          )}

          {/* ── RAID + Recent Activity ── */}
          <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 14 }}>
            {/* RAID */}
            <div className="card" style={{ padding: "24px" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)" }}>
                  RAID log
                </span>
                <Link href={`/projects/${projectRefForUrls}/raid`} style={{ fontSize: 12, color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}>
                  View full RAID →
                </Link>
              </div>
              <div className="raid-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
                {[
                  { label: "Risks",     items: risks,     color: risks.length    > 0 ? "var(--red)"   : "var(--text-3)", border: risks.length    > 0 ? "rgba(239,68,68,0.2)"   : "var(--border)" },
                  { label: "Issues",    items: issues,    color: issues.length   > 0 ? "var(--amber)" : "var(--text-3)", border: issues.length   > 0 ? "rgba(245,158,11,0.2)"  : "var(--border)" },
                  { label: "Actions",   items: actions,   color: "var(--blue)",   border: "var(--border)" },
                  { label: "Decisions", items: decisions, color: "#8b5cf6",        border: "var(--border)" },
                ].map(({ label, items, color, border }) => (
                  <div key={label} className="raid-quad" style={{ borderColor: border }}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color, marginBottom: 8 }}>
                      {label} <span style={{ fontWeight: 400, opacity: 0.6 }}>({items.length})</span>
                    </div>
                    {items.length === 0 ? (
                      <p style={{ fontSize: 12, color: "#d0d7de", margin: 0 }}>None open</p>
                    ) : (
                      (items as any[]).slice(0, 3).map((item) => (
                        <div key={item.id} className="raid-item">{item.title}</div>
                      ))
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Recent Activity */}
            <div className="card" style={{ padding: "24px" }}>
              <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", marginBottom: 14 }}>
                Recent activity
              </div>
              <div>
                {changes.length === 0 && pendingApprovals.length === 0 ? (
                  <div style={{ padding: "20px 0", textAlign: "center", color: "var(--text-3)", fontSize: 13 }}>No recent activity</div>
                ) : (
                  <>
                    {pendingApprovals.slice(0, 2).map((a: any) => (
                      <div key={a.id} className="act-item">
                        <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>⏳</div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{a.title}</p>
                          <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 2, margin: 0 }}>Approval pending</p>
                        </div>
                      </div>
                    ))}
                    {changes.slice(0, 4).map((c: any) => {
                      const col = ({ approved: "#22c55e", rejected: "#ef4444", pending: "#f59e0b", draft: "#94a3b8" } as any)[c.status] ?? "#64748b";
                      return (
                        <div key={c.id} className="act-item">
                          <div style={{ width: 28, height: 28, borderRadius: 8, background: `${col}18`, border: `1px solid ${col}30`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>⚡</div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", margin: 0 }}>{c.title}</p>
                            <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 20, background: `${col}18`, color: col }}>{c.status}</span>
                              <span style={{ fontSize: 11, color: "var(--text-3)" }}>{new Date(c.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}</span>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </>
                )}
              </div>
              <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10, marginTop: 4 }}>
                <Link href={`/projects/${projectRefForUrls}/changes`} style={{ fontSize: 12, color: "var(--blue)", fontWeight: 600, textDecoration: "none" }}>
                  View all changes →
                </Link>
              </div>
            </div>
          </div>

        </div>
      </main>
    </>
  );
}
