// src/app/projects/page.tsx
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import CreateProjectModal from "./_components/CreateProjectModal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Project = {
  id: string;
  title: string;
  project_code: string | null;
  colour: string | null;
  status: string | null;
  resource_status: string | null;
  start_date: string | null;
  finish_date: string | null;
  created_at: string;
  pm_name: string | null;
};

function formatDate(d: string | null | undefined) {
  if (!d) return null;
  try {
    return new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  } catch {
    return d;
  }
}

// ✅ Always use UUID so all sub-pages (members, approvals, artifacts) work correctly.
function projectRef(p: Project) {
  return p.id;
}

async function setProjectStatus(formData: FormData) {
  "use server";
  const supabase = await createClient();
  const {
    data: { user },
    error: uErr,
  } = await supabase.auth.getUser();
  if (uErr) throw uErr;
  if (!user) redirect("/login");

  const projectId = (formData.get("project_id") as string) || "";
  const status = (formData.get("status") as string) || "";
  const next = (formData.get("next") as string) || "/projects";

  if (!projectId || !["active", "closed"].includes(status)) redirect(next);

  const { error } = await supabase.from("projects").update({ status }).eq("id", projectId);
  if (error) throw error;

  redirect(next);
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string; sort?: string; q?: string; debug?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) redirect("/login");

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) redirect("/settings?err=no_active_org");

  // ✅ IMPORTANT:
  // - We list "my projects" by membership
  // - AND we hard-scope to the ACTIVE ORG to prevent cross-org bleed
  // - AND we ignore removed memberships by checking removed_at (more robust than is_active quirks)
  const { data: memberRows, error: memErr } = await supabase
    .from("project_members")
    .select("project_id, role, removed_at")
    .eq("user_id", user.id)
    .is("removed_at", null)
    .limit(20000);

  if (memErr) throw memErr;

  const memberProjectIds = (memberRows ?? []).map((r: any) => String(r?.project_id || "").trim()).filter(Boolean);
  const roleMap = Object.fromEntries((memberRows ?? []).map((r: any) => [String(r.project_id), r.role]));

  let projects: Project[] = [];

  if (memberProjectIds.length > 0) {
    const { data: pData, error: pErr } = await supabase
      .from("projects")
      .select("id, title, project_code, colour, status, resource_status, start_date, finish_date, created_at, organisation_id, deleted_at")
      .in("id", memberProjectIds)
      .eq("organisation_id", activeOrgId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(20000);

    if (pErr) throw pErr;

    projects = (pData ?? []).map((p: any) => ({
      id: String(p.id),
      title: String(p.title ?? "Untitled project"),
      project_code: p.project_code ?? null,
      colour: p.colour ?? null,
      status: p.status ?? null,
      resource_status: p.resource_status ?? null,
      start_date: p.start_date ?? null,
      finish_date: p.finish_date ?? null,
      created_at: String(p.created_at),
      pm_name: null,
    }));
  }

  const sp = (await searchParams) ?? {};
  const filter = (sp.filter ?? "Active").trim();
  const sortMode = (sp.sort ?? "Newest").trim();
  const query = (sp.q ?? "").trim().toLowerCase();
  const debug = String(sp.debug ?? "").trim() === "1";

  const filtered = projects
    .filter((p) => {
      const st = (p.status ?? "active").toLowerCase();
      if (filter === "Active") return st !== "closed";
      if (filter === "Closed") return st === "closed";
      return true;
    })
    .filter((p) => !query || p.title.toLowerCase().includes(query) || (p.project_code ?? "").toLowerCase().includes(query))
    .sort((a, b) => {
      if (sortMode === "A-Z") return a.title.localeCompare(b.title);
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const activeCt = projects.filter((p) => (p.status ?? "active").toLowerCase() !== "closed").length;
  const closedCt = projects.filter((p) => (p.status ?? "").toLowerCase() === "closed").length;

  // Optional server logs for “why do I see X projects?”
  if (debug) {
    console.log("PROJECTS_PAGE_DEBUG_v2", {
      userId: user.id,
      activeOrgId,
      memberRows: memberRows?.length ?? 0,
      memberProjectIds: memberProjectIds.length,
      projectsLoaded: projects.length,
      filter,
      sortMode,
      query,
    });
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=DM+Mono:wght@400;500&display=swap');
        *, *::before, *::after { box-sizing: border-box; }

        .pl-action:hover  { background: #f1f5f9 !important; border-color: #cbd5e1 !important; }
        .pl-row:hover     { box-shadow: 0 2px 12px rgba(0,0,0,0.06); border-color: #cbd5e1 !important; }
        .pl-filter:hover  { background: #f1f5f9 !important; }
        .pl-close:hover   { background: #fef9c3 !important; }
        .pl-input:focus   { border-color: #06b6d4 !important; outline: none; box-shadow: 0 0 0 3px rgba(6,182,212,0.1); }
        .pl-sec-btn:hover { background: #f1f5f9 !important; }
        .pl-debug { font-family: 'DM Mono', ui-monospace, monospace; }
      `}</style>

      <main
        style={{
          minHeight: "100vh",
          background: "#f8fafc",
          fontFamily: "'DM Sans', -apple-system, sans-serif",
          color: "#0f172a",
        }}
      >
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 32px 60px" }}>
          {/* ── Header ── */}
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 24, gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
              <div style={{ width: 42, height: 42, borderRadius: 12, background: "#e0f7fa", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                  <path stroke="#06b6d4" strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </div>
              <div>
                <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0, letterSpacing: "-.5px" }}>Projects</h1>
                <p style={{ fontSize: 13, color: "#64748b", margin: "3px 0 0" }}>Your portfolio entry point — search, filter, and jump into governance.</p>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <Link
                href="/artifacts"
                className="pl-sec-btn"
                style={{
                  background: "white",
                  color: "#0f172a",
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "9px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: "pointer",
                  textDecoration: "none",
                  display: "inline-flex",
                  alignItems: "center",
                }}
              >
                Global artifacts
              </Link>
              <CreateProjectModal activeOrgId={activeOrgId ?? ""} userId={user.id} />
            </div>
          </div>

          {/* ── Optional debug strip ── */}
          {debug && (
            <div
              className="pl-debug"
              style={{
                marginBottom: 14,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid #e2e8f0",
                background: "white",
                fontSize: 12,
                color: "#64748b",
              }}
            >
              <div>debug=1</div>
              <div>activeOrgId: {activeOrgId}</div>
              <div>memberRows: {memberRows?.length ?? 0} • memberProjectIds: {memberProjectIds.length} • projectsLoaded: {projects.length}</div>
            </div>
          )}

          {/* ── Stats strip ── */}
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: "wrap" }}>
            {[
              { label: "Total", value: projects.length, colour: "#06b6d4" },
              { label: "Active", value: activeCt, colour: "#10b981" },
              { label: "Closed", value: closedCt, colour: "#94a3b8" },
            ].map((s) => (
              <div key={s.label} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 14px", background: "white", border: "1px solid #e2e8f0", borderRadius: 10, fontSize: 13, color: "#64748b" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: s.colour, display: "inline-block" }} />
                <span style={{ fontWeight: 700, color: "#0f172a", marginRight: 2 }}>{s.value}</span>
                {s.label}
              </div>
            ))}
          </div>

          {/* ── Toolbar (server-driven via URL params) ── */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
            {/* Filter */}
            <div style={{ display: "flex", gap: 4 }}>
              {["Active", "Closed", "All"].map((f) => (
                <Link
                  key={f}
                  href={`/projects?filter=${f}&sort=${sortMode}&q=${encodeURIComponent(query)}${debug ? "&debug=1" : ""}`}
                  className={filter === f ? "" : "pl-filter"}
                  style={{
                    background: filter === f ? "#06b6d4" : "white",
                    border: `1px solid ${filter === f ? "#06b6d4" : "#e2e8f0"}`,
                    borderRadius: 8,
                    padding: "7px 14px",
                    fontSize: 13,
                    fontWeight: filter === f ? 700 : 500,
                    color: filter === f ? "white" : "#64748b",
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  {f}
                </Link>
              ))}
            </div>

            {/* Search */}
            <form method="get" action="/projects" style={{ position: "relative", flex: 1, maxWidth: 300 }}>
              <input type="hidden" name="filter" value={filter} />
              <input type="hidden" name="sort" value={sortMode} />
              {debug && <input type="hidden" name="debug" value="1" />}
              <svg style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", pointerEvents: "none" }} width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="8" stroke="#94a3b8" strokeWidth="2" />
                <path d="m21 21-4.35-4.35" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" />
              </svg>
              <input
                name="q"
                defaultValue={query}
                placeholder="Search projects…"
                className="pl-input"
                style={{
                  width: "100%",
                  border: "1px solid #e2e8f0",
                  borderRadius: 8,
                  padding: "8px 10px 8px 30px",
                  fontSize: 13,
                  background: "white",
                  fontFamily: "inherit",
                }}
              />
            </form>

            {/* Sort */}
            <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
              {["Newest", "A-Z"].map((s) => (
                <Link
                  key={s}
                  href={`/projects?filter=${filter}&sort=${s}&q=${encodeURIComponent(query)}${debug ? "&debug=1" : ""}`}
                  className={sortMode === s ? "" : "pl-filter"}
                  style={{
                    background: sortMode === s ? "#06b6d4" : "white",
                    border: `1px solid ${sortMode === s ? "#06b6d4" : "#e2e8f0"}`,
                    borderRadius: 8,
                    padding: "7px 14px",
                    fontSize: 13,
                    fontWeight: sortMode === s ? 700 : 500,
                    color: sortMode === s ? "white" : "#64748b",
                    textDecoration: "none",
                    display: "inline-block",
                  }}
                >
                  {s}
                </Link>
              ))}
            </div>
          </div>

          <p style={{ fontSize: 13, color: "#94a3b8", fontWeight: 500, margin: "0 0 10px" }}>
            {filtered.length} project{filtered.length !== 1 ? "s" : ""}
          </p>

          {/* ── Project list ── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map((p) => {
              const ref = projectRef(p);
              const colour = p.colour ?? "#06b6d4";
              const dateRange =
                p.start_date && p.finish_date ? `${formatDate(p.start_date)} — ${formatDate(p.finish_date)}` : p.start_date ? `From ${formatDate(p.start_date)}` : null;
              const isActive = (p.status ?? "active").toLowerCase() !== "closed";

              return (
                <div
                  key={p.id}
                  className="pl-row"
                  style={{
                    background: "white",
                    border: "1px solid #e2e8f0",
                    borderRadius: 14,
                    padding: "16px 20px",
                    display: "flex",
                    alignItems: "center",
                    gap: 14,
                    transition: "box-shadow 0.15s, border-color 0.15s",
                  }}
                >
                  {/* Colour dot */}
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: colour, flexShrink: 0 }} />

                  {/* Info */}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 5, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                      <Link href={`/projects/${ref}`} style={{ fontSize: 15, fontWeight: 700, color: "#0f172a", textDecoration: "none" }} className="pl-action">
                        {p.title}
                      </Link>
                      {p.project_code && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            background: "#f1f5f9",
                            color: "#64748b",
                            borderRadius: 6,
                            padding: "2px 7px",
                            border: "1px solid #e2e8f0",
                            fontFamily: "'DM Mono', monospace",
                          }}
                        >
                          {p.project_code}
                        </span>
                      )}
                      <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 7px", background: isActive ? "#dcfce7" : "#f1f5f9", color: isActive ? "#15803d" : "#64748b" }}>
                        {isActive ? "Active" : "Closed"}
                      </span>
                      {p.resource_status === "pipeline" && (
                        <span style={{ fontSize: 11, fontWeight: 700, borderRadius: 6, padding: "2px 7px", background: "rgba(124,58,237,0.08)", color: "#7c3aed", border: "1px solid rgba(124,58,237,0.2)" }}>
                          Pipeline
                        </span>
                      )}
                    </div>

                    <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span>
                        PM: <span style={{ color: p.pm_name ? "#0f172a" : "#06b6d4" }}>{p.pm_name ?? "Unassigned"}</span>
                      </span>
                      <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#cbd5e1", display: "inline-block" }} />
                      <span>Created {formatDate(p.created_at)}</span>
                      {roleMap[p.id] && (
                        <>
                          <span style={{ width: 3, height: 3, borderRadius: "50%", background: "#cbd5e1", display: "inline-block" }} />
                          <span style={{ textTransform: "capitalize" }}>{String(roleMap[p.id])}</span>
                        </>
                      )}
                    </div>

                    {dateRange && (
                      <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", alignItems: "center" }}>
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ marginRight: 4, opacity: 0.5, flexShrink: 0 }}>
                          <rect x="3" y="4" width="18" height="18" rx="2" stroke="#64748b" strokeWidth="2" />
                          <path d="M16 2v4M8 2v4M3 10h18" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
                        </svg>
                        {dateRange}
                      </div>
                    )}
                  </div>

                  {/* ── Action buttons — all real links ── */}
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0, flexWrap: "wrap" }}>
                    <Link
                      href={`/projects/${ref}`}
                      className="pl-action"
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#475569", textDecoration: "none", background: "white" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="#64748b" strokeWidth="2" />
                        <path d="M12 8v4l3 3" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Overview
                    </Link>

                    <Link
                      href={`/projects/${ref}/artifacts`}
                      className="pl-action"
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#475569", textDecoration: "none", background: "white" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="#64748b" strokeWidth="2" />
                        <path d="M14 2v6h6" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Artifacts
                    </Link>

                    <Link
                      href={`/projects/${ref}/members`}
                      className="pl-action"
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#475569", textDecoration: "none", background: "white" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <circle cx="9" cy="7" r="4" stroke="#64748b" strokeWidth="2" />
                        <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                      Members
                    </Link>

                    <Link
                      href={`/projects/${ref}/approvals`}
                      className="pl-action"
                      style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 11px", border: "1px solid #e2e8f0", borderRadius: 8, fontSize: 12, fontWeight: 500, color: "#475569", textDecoration: "none", background: "white" }}
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                        <polyline points="20 6 9 17 4 12" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      Approvals
                    </Link>

                    {/* Close/Reopen */}
                    <form action={setProjectStatus} style={{ display: "contents" }}>
                      <input type="hidden" name="project_id" value={p.id} />
                      <input type="hidden" name="status" value={isActive ? "closed" : "active"} />
                      <input type="hidden" name="next" value="/projects" />
                      <button
                        type="submit"
                        className="pl-close"
                        style={{
                          padding: "6px 14px",
                          border: `1px solid ${isActive ? "#fde68a" : "#e2e8f0"}`,
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 700,
                          color: isActive ? "#92400e" : "#475569",
                          background: isActive ? "#fffbeb" : "white",
                          cursor: "pointer",
                          fontFamily: "inherit",
                        }}
                      >
                        {isActive ? "Close" : "Reopen"}
                      </button>
                    </form>

                    {/* ⋮ menu — links to project settings */}
                    <Link
                      href={`/projects/${ref}`}
                      style={{ padding: "6px 8px", border: "1px solid #e2e8f0", borderRadius: 8, background: "white", display: "flex", alignItems: "center", color: "#64748b", textDecoration: "none" }}
                      className="pl-action"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="5" r="1.5" fill="#64748b" />
                        <circle cx="12" cy="12" r="1.5" fill="#64748b" />
                        <circle cx="12" cy="19" r="1.5" fill="#64748b" />
                      </svg>
                    </Link>
                  </div>
                </div>
              );
            })}

            {filtered.length === 0 && (
              <div style={{ textAlign: "center", padding: "48px 0", color: "#94a3b8", fontSize: 14 }}>
                {projects.length === 0 ? <>No projects yet.</> : "No projects match your filters."}
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}