// src/app/projects/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

import { createProject } from "./actions";

import ProjectsHeader from "./_components/ProjectsHeader";
import ProjectsResults from "./_components/ProjectsResults";

import type { MemberProjectRow, ProjectListRow, FlashTone } from "./_lib/projects-utils";

type OrgMemberOption = {
  user_id: string;
  label: string;
  role?: string | null;
};

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function norm(x: unknown) {
  return safeStr(x).trim();
}

function qsSafe(params: Record<string, unknown>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    const s = String(v).trim();
    if (!s) continue;
    sp.set(k, s);
  }
  const out = sp.toString();
  return out ? `?${out}` : "";
}

type Banner = { tone: "success" | "warn" | "error"; msg: string } | null;

function inviteBanner(invite: unknown): Banner {
  const v = norm(invite).toLowerCase();
  if (!v) return null;
  if (v === "accepted") return { tone: "success", msg: "✅ You've joined the organisation." };
  if (v === "expired") return { tone: "warn", msg: "⚠️ Invite expired. Ask the owner to resend the invite." };
  if (v === "invalid") return { tone: "error", msg: "❌ Invite invalid or already used." };
  if (v === "email-mismatch") return { tone: "error", msg: "❌ Invite was sent to a different email. Sign in with the invited email." };
  if (v === "failed") return { tone: "error", msg: "❌ Invite acceptance failed. Please try again." };
  return null;
}

function flashFromQuery(err: unknown, msg: unknown): { tone: FlashTone; text: string } | null {
  const e = norm(err).toLowerCase();
  const m = norm(msg).toLowerCase();
  if (!e && !m) return null;
  if (e) {
    if (e === "delete_confirm") return { tone: "error", text: 'Type "DELETE" to confirm deletion.' };
    if (e === "delete_forbidden") return { tone: "error", text: "Only the project owner can delete a project." };
    if (e === "delete_blocked") return { tone: "warn", text: "Delete is blocked (protected artifacts). Use Abnormal close in the Delete modal." };
    if (e === "abnormal_confirm") return { tone: "error", text: 'Type "ABNORMAL" to confirm abnormal close.' };
    if (e === "no_permission") return { tone: "error", text: "You don't have permission to perform that action." };
    if (e === "missing_project") return { tone: "error", text: "Missing project id." };
    if (e === "missing_title") return { tone: "error", text: "Title is required." };
    if (e === "missing_start") return { tone: "error", text: "Start date is required." };
    if (e === "missing_org") return { tone: "error", text: "Organisation is required." };
    if (e === "bad_org") return { tone: "error", text: "Invalid organisation selected." };
    if (e === "bad_finish") return { tone: "error", text: "Finish date cannot be before start date." };
    if (e === "bad_pm") return { tone: "error", text: "Invalid project manager selected." };
    return { tone: "error", text: safeStr(err) };
  }
  if (m === "deleted") return { tone: "success", text: "Project deleted." };
  if (m === "closed") return { tone: "success", text: "Project closed. It is now read-only." };
  if (m === "reopened") return { tone: "success", text: "Project reopened. Editing is enabled." };
  if (m === "renamed") return { tone: "success", text: "Project renamed." };
  if (m === "abnormally_closed") return { tone: "success", text: "Project abnormally closed (audit trail kept)." };
  return { tone: "info", text: safeStr(msg) };
}

function displayNameFromUser(user: any) {
  const full = (user?.user_metadata?.full_name as string | undefined) || (user?.user_metadata?.name as string | undefined) || "";
  return (full || user?.email || "Account").toString();
}

function formatMemberLabel(row: any): string {
  const p = row?.profiles || row?.profile || row?.user_profile || row?.users || row?.user || null;
  const full = safeStr(p?.full_name || p?.name).trim();
  const email = safeStr(p?.email).trim();
  const base = full || email || safeStr(row?.user_id).slice(0, 8);
  const role = safeStr(row?.role).trim();
  return role ? `${base} (${role})` : base;
}

function isClosedProject(p: any) {
  const lifecycle = safeStr(p?.lifecycle_status).trim().toLowerCase();
  const status = safeStr(p?.status).trim().toLowerCase();
  if (lifecycle === "closed") return true;
  if (status.includes("closed")) return true;
  if (status.includes("complete")) return true;
  return false;
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?:
    | Promise<{ invite?: string; q?: string; view?: string; sort?: string; filter?: string; err?: string; msg?: string; pid?: string; }>
    | { invite?: string; q?: string; view?: string; sort?: string; filter?: string; err?: string; msg?: string; pid?: string; };
}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent("/projects")}`);

  const sp = (await (searchParams as any)) ?? {};
  const banner = inviteBanner((sp as any)?.invite);
  const q = norm((sp as any)?.q);
  const view = norm((sp as any)?.view) === "grid" ? "grid" : "list";
  const sort = norm((sp as any)?.sort) === "title_asc" ? "title_asc" : "created_desc";
  const filterRaw = norm((sp as any)?.filter).toLowerCase();
  const filter: "active" | "closed" | "all" = filterRaw === "closed" ? "closed" : filterRaw === "all" ? "all" : "active";
  const err = norm((sp as any)?.err);
  const msg = norm((sp as any)?.msg);
  const pid = norm((sp as any)?.pid);
  const flash = flashFromQuery(err, msg);
  const userId = user.id;

  const { data, error } = await supabase
    .from("project_members")
    .select(`
      project_id,
      role,
      projects:projects!project_members_project_id_fkey (
        id, title, project_code, start_date, finish_date, created_at, organisation_id,
        status, lifecycle_status, closed_at, deleted_at, project_manager_id,
        project_manager:profiles!projects_project_manager_id_fkey (
          user_id, full_name, email
        )
      )
    `)
    .eq("user_id", userId)
    .is("projects.deleted_at", null)
    .order("created_at", { foreignTable: "projects", ascending: false });

  if (error) {
    return (
      <main style={{ minHeight: "100vh", background: "#f8fafc", fontFamily: "'DM Sans', sans-serif" }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "48px 24px" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#0f172a" }}>Projects</h1>
          <p style={{ marginTop: "12px", fontSize: "14px", color: "#ef4444" }}>Error: {error.message}</p>
        </div>
      </main>
    );
  }

  const rows: ProjectListRow[] = ((data ?? []) as unknown as MemberProjectRow[])
    .map((r) => {
      if (!r.projects) return null;
      const pmName =
        safeStr((r.projects as any)?.project_manager?.full_name).trim() ||
        safeStr((r.projects as any)?.project_manager?.email).trim() ||
        null;
      return {
        id: r.projects.id,
        title: r.projects.title,
        project_code: r.projects.project_code,
        start_date: r.projects.start_date,
        finish_date: r.projects.finish_date,
        created_at: r.projects.created_at,
        organisation_id: r.projects.organisation_id,
        status: r.projects.status ?? "active",
        myRole: r.role ?? "viewer",
        lifecycle_status: (r.projects as any)?.lifecycle_status ?? null,
        closed_at: (r.projects as any)?.closed_at ?? null,
        project_manager_id: (r.projects as any)?.project_manager_id ?? null,
        project_manager_name: pmName,
      } as any;
    })
    .filter(Boolean) as ProjectListRow[];

  const orgIds = Array.from(new Set(rows.map((r) => String(r.organisation_id || "")).filter(Boolean)));
  const orgAdminSet = new Set<string>();

  if (orgIds.length) {
    const { data: memRows } = await supabase
      .from("organisation_members")
      .select("organisation_id, role")
      .eq("user_id", userId)
      .in("organisation_id", orgIds);
    for (const m of memRows ?? []) {
      const oid = String((m as any)?.organisation_id || "");
      const role = String((m as any)?.role || "").toLowerCase();
      if (oid && role === "admin") orgAdminSet.add(oid);
    }
  }

  const lifecycleFiltered = (() => {
    if (filter === "all") return rows;
    if (filter === "closed") return rows.filter((p: any) => isClosedProject(p));
    return rows.filter((p: any) => !isClosedProject(p));
  })();

  const textFiltered = (() => {
    if (!q) return lifecycleFiltered;
    const nq = q.toLowerCase();
    return lifecycleFiltered.filter((p) => {
      const hay = `${safeStr(p.title)} ${safeStr((p as any).project_code ?? "")} ${safeStr(p.id)}`.toLowerCase();
      return hay.includes(nq);
    });
  })();

  const sorted = (() => {
    const arr = [...textFiltered];
    if (sort === "title_asc") {
      arr.sort((a, b) => safeStr(a.title).localeCompare(safeStr(b.title)));
    } else {
      arr.sort((a, b) => safeStr((b as any).created_at).localeCompare(safeStr((a as any).created_at)));
    }
    return arr;
  })();

  const inviteParam = norm((sp as any)?.invite);
  const dismissHref = `/projects${qsSafe({ invite: inviteParam || undefined, q: q || undefined, sort, view, filter })}`;

  const panelGlow = ""; // passed as prop but we'll handle styling in page
  const cookieOrgId = await getActiveOrgId().catch(() => null);
  const activeOrgId = (cookieOrgId && String(cookieOrgId)) || (orgIds[0] ? String(orgIds[0]) : "");
  const canCreate = !!activeOrgId;

  const { data: orgRow } = activeOrgId
    ? await supabase.from("organisations").select("id,name").eq("id", activeOrgId).maybeSingle()
    : { data: null as any };

  const activeOrgName = safeStr(orgRow?.name).trim();

  const { data: orgMemberRows } = activeOrgId
    ? await supabase
        .from("organisation_members")
        .select(`user_id, role, profiles:profiles ( user_id, full_name, email )`)
        .eq("organisation_id", activeOrgId)
        .is("removed_at", null)
        .order("role", { ascending: true })
    : { data: [] as any[] };

  const pmOptions: OrgMemberOption[] = (orgMemberRows ?? [])
    .map((r: any) => ({ user_id: String(r?.user_id || ""), label: formatMemberLabel(r), role: (r?.role as string | null) ?? null }))
    .filter((x) => !!x.user_id);

  const ownerLabel = displayNameFromUser(user);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&family=DM+Mono:wght@400;500&display=swap');

        .pp-root {
          font-family: 'DM Sans', sans-serif;
          min-height: 100vh;
          background: #f8fafc;
          color: #0f172a;
        }

        .pp-inner {
          max-width: 1100px;
          margin: 0 auto;
          padding: 48px 28px;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }

        .pp-create-panel {
          background: white;
          border-radius: 18px;
          border: 1.5px solid #e2e8f0;
          box-shadow: 0 2px 16px rgba(0,184,219,0.08), 0 1px 4px rgba(0,0,0,0.04);
          overflow: hidden;
        }

        .pp-create-header {
          padding: 24px 28px 20px;
          border-bottom: 1px solid #f1f5f9;
          background: linear-gradient(135deg, rgba(0,184,219,0.04) 0%, transparent 60%);
        }

        .pp-create-title {
          font-size: 16px;
          font-weight: 700;
          color: #0f172a;
          margin: 0 0 4px;
        }

        .pp-create-desc {
          font-size: 13px;
          color: #94a3b8;
          margin: 0;
          line-height: 1.5;
        }

        .pp-org-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          margin-top: 10px;
          padding: 4px 10px;
          border-radius: 20px;
          background: #f0fdff;
          border: 1px solid #bae6f0;
          font-size: 12px;
          color: #0e7490;
          font-weight: 500;
        }

        .pp-org-tag strong { font-weight: 700; }

        .pp-create-body {
          padding: 24px 28px 28px;
        }

        .pp-field-label {
          display: block;
          font-size: 12.5px;
          font-weight: 700;
          color: #475569;
          letter-spacing: 0.02em;
          margin-bottom: 6px;
          text-transform: uppercase;
        }

        .pp-owner-display {
          padding: 10px 14px;
          border-radius: 8px;
          background: #f8fafc;
          border: 1.5px solid #e2e8f0;
          font-size: 14px;
          color: #334155;
          font-weight: 500;
        }

        .pp-input, .pp-select {
          width: 100%;
          padding: 10px 14px;
          border-radius: 8px;
          border: 1.5px solid #e2e8f0;
          background: white;
          font-size: 14px;
          font-family: 'DM Sans', sans-serif;
          color: #0f172a;
          outline: none;
          transition: all 0.15s ease;
          box-sizing: border-box;
        }

        .pp-input::placeholder { color: #cbd5e1; }

        .pp-input:focus, .pp-select:focus {
          border-color: #00B8DB;
          box-shadow: 0 0 0 3px rgba(0,184,219,0.12);
        }

        .pp-field-hint {
          font-size: 11.5px;
          color: #94a3b8;
          margin-top: 5px;
          line-height: 1.4;
        }

        .pp-form-grid {
          display: grid;
          gap: 18px;
          max-width: 640px;
        }

        .pp-form-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        @media (max-width: 600px) {
          .pp-form-row { grid-template-columns: 1fr; }
        }

        .pp-submit-btn {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          padding: 10px 24px;
          border-radius: 9px;
          background: #00B8DB;
          color: white;
          font-size: 14px;
          font-weight: 700;
          font-family: 'DM Sans', sans-serif;
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 0 2px 12px rgba(0,184,219,0.3);
          letter-spacing: 0.01em;
        }

        .pp-submit-btn:hover:not(:disabled) {
          background: #00a0bf;
          box-shadow: 0 4px 16px rgba(0,184,219,0.4);
          transform: translateY(-1px);
        }

        .pp-submit-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          box-shadow: none;
        }

        .pp-warn-banner {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 12px 16px;
          border-radius: 9px;
          background: #fffbeb;
          border: 1px solid #fde68a;
          color: #92400e;
          font-size: 13px;
          font-weight: 500;
        }

        .pp-results-section {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .pp-section-label {
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: #94a3b8;
        }
      `}</style>

      <main className="pp-root">
        <div className="pp-inner">
          {/* Header (unchanged component) */}
          <ProjectsHeader banner={banner} flash={flash} dismissHref={dismissHref} />

          {/* Create Project Panel */}
          <div className="pp-create-panel">
            <div className="pp-create-header">
              <h2 className="pp-create-title">Create a Project</h2>
              <p className="pp-create-desc">
                Enterprise setup — define ownership and delivery lead for governance and reporting.
              </p>
              <div className="pp-org-tag">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                  <polyline points="9 22 9 12 15 12 15 22"/>
                </svg>
                Active organisation: <strong>{activeOrgName || "Not set"}</strong>
              </div>
            </div>

            <div className="pp-create-body">
              {!canCreate && (
                <div className="pp-warn-banner" style={{ marginBottom: "20px" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  You don't have an active organisation. Select one first, then create a project.
                </div>
              )}

              <form action={createProject} className="pp-form-grid">
                <input type="hidden" name="organisation_id" value={activeOrgId} />

                <div>
                  <label className="pp-field-label">Project owner</label>
                  <div className="pp-owner-display">{ownerLabel}</div>
                  <p className="pp-field-hint">Accountable governance lead — auto-set to you.</p>
                </div>

                <div>
                  <label className="pp-field-label" htmlFor="pp-title">Project name</label>
                  <input
                    id="pp-title"
                    name="title"
                    placeholder="e.g. Project Venus"
                    required
                    className="pp-input"
                  />
                </div>

                <div>
                  <label className="pp-field-label" htmlFor="pp-pm">Project manager</label>
                  <select id="pp-pm" name="project_manager_id" defaultValue="" className="pp-select">
                    <option value="">Unassigned</option>
                    {pmOptions.map((m) => (
                      <option key={m.user_id} value={m.user_id}>{m.label}</option>
                    ))}
                  </select>
                  <p className="pp-field-hint">Assign now or later — used for delivery accountability.</p>
                </div>

                <div className="pp-form-row">
                  <div>
                    <label className="pp-field-label" htmlFor="pp-start">Start date</label>
                    <input id="pp-start" name="start_date" type="date" required className="pp-input" />
                  </div>
                  <div>
                    <label className="pp-field-label" htmlFor="pp-finish">Finish date</label>
                    <input id="pp-finish" name="finish_date" type="date" className="pp-input" />
                  </div>
                </div>

                <div>
                  <button type="submit" disabled={!canCreate} className="pp-submit-btn">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                    Create project
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Results section */}
          <div className="pp-results-section">
            <div className="pp-section-label">Your projects</div>
            <ProjectsResults
              rows={sorted}
              view={view}
              q={q}
              sort={sort}
              filter={filter}
              pid={pid}
              err={err}
              msg={msg}
              orgAdminOrgIds={Array.from(orgAdminSet)}
              baseHrefForDismiss={dismissHref}
              panelGlow={panelGlow}
            />
          </div>
        </div>
      </main>
    </>
  );
}