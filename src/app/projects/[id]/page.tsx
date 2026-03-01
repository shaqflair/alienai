// FILE: src/app/projects/[id]/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { fetchProjectResourceData, projectWeekPeriods } from "./_lib/resource-data";
import ProjectResourcePanel from "./_components/ProjectResourcePanel";

/* =========================================================
   small helpers
========================================================= */

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : Array.isArray(x) ? String(x[0] ?? "") : "";
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
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
  "artifacts","changes","change","members",
  "approvals","lessons","raid","schedule","wbs",
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
  "project_human_id","human_id","project_code",
  "code","slug","reference","ref",
] as const;

async function resolveProjectUuidFast(supabase: any, identifier: string) {
  const raw = safeStr(identifier).trim();
  if (!raw) return { projectUuid: null as string | null, project: null as any };

  if (looksLikeUuid(raw)) {
    return { projectUuid: raw, project: null as any };
  }

  const normalized = normalizeProjectIdentifier(raw);

  for (const col of HUMAN_COL_CANDIDATES) {
    const { data, error } = await supabase
      .from("projects").select("*").eq(col, normalized).maybeSingle();
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
  const roles = (rows ?? [])
    .map(r => String(r?.role ?? "").toLowerCase()).filter(Boolean);
  if (!roles.length) return "";
  if (roles.includes("owner"))  return "owner";
  if (roles.includes("editor")) return "editor";
  if (roles.includes("viewer")) return "viewer";
  return roles[0] || "";
}

/* =========================================================
   Flash banner (msg= from allocation actions)
========================================================= */

function flashText(msg: string | undefined, conflicts: string | undefined) {
  if (!msg) return null;
  if (msg === "allocated") {
    const c = conflicts ? parseInt(conflicts) : 0;
    return c > 0
      ? `✓ Allocated — ${c} conflict week${c > 1 ? "s" : ""} flagged`
      : "✓ Resource allocated successfully";
  }
  if (msg === "allocation_removed") return "Allocation removed.";
  if (msg === "week_removed")       return "Week removed.";
  if (msg === "week_updated")       return "Week updated.";
  return null;
}

/* =========================================================
   page
========================================================= */

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params:        Promise<{ id?: string }>;
  searchParams?: Promise<{ msg?: string; conflicts?: string; err?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { id }   = await params;
  const sp        = (await searchParams) ?? {};
  const rawId     = safeParam(id).trim();
  if (!rawId) notFound();

  const lower = rawId.toLowerCase();
  if (RESERVED.has(lower)) redirect("/projects");

  const resolved = await resolveProjectUuidFast(supabase, rawId);
  if (!resolved?.projectUuid) notFound();
  const projectUuid = String(resolved.projectUuid);

  // Permission check
  const { data: memRows, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectUuid)
    .eq("user_id", auth.user.id)
    .eq("is_active", true);

  if (memErr) throw memErr;

  const myRole = bestProjectRole(memRows as any);
  if (!myRole) notFound();

  // Resolve basic project info
  let project = resolved.project ?? null;
  if (!project) {
    const { data: p } = await supabase
      .from("projects")
      .select("id, title, project_code, colour, start_date, finish_date, resource_status")
      .eq("id", projectUuid)
      .maybeSingle();
    if (p?.id) project = p;
  }

  const projectTitle      = safeStr(project?.title ?? "Project") || "Project";
  const projectCode       = safeStr(project?.project_code ?? "").trim();
  const projectColour     = safeStr(project?.colour ?? "#00b8db");
  const projectRefForUrls = rawId;

  // Flash
  const flash    = flashText(sp?.msg, sp?.conflicts);
  const flashErr = sp?.err ? `Error: ${sp.err}` : null;

  // Resource data — fetch in parallel, fail gracefully
  const [resourceData] = await Promise.allSettled([
    fetchProjectResourceData(projectUuid),
  ]);

  const resource = resourceData.status === "fulfilled" ? resourceData.value : null;
  const periods  = resource
    ? projectWeekPeriods(resource.project.start_date, resource.project.finish_date)
    : [];

  const canEdit = myRole === "owner" || myRole === "editor";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700&family=DM+Mono:wght@400;500&display=swap');

        .pp-nav-link {
          border-radius: 8px;
          padding: 7px 14px;
          font-size: 13px;
          font-weight: 600;
          text-decoration: none;
          border: 1.5px solid #e2e8f0;
          color: #475569;
          font-family: 'DM Sans', sans-serif;
          transition: all 0.15s;
          white-space: nowrap;
        }
        .pp-nav-link:hover {
          border-color: #00b8db;
          color: #00b8db;
          background: rgba(0,184,219,0.04);
        }
        .pp-nav-link.active {
          background: #00b8db;
          border-color: #00b8db;
          color: white;
        }
      `}</style>

      <main style={{
        minHeight: "100vh", background: "#f8fafc",
        fontFamily: "'DM Sans', sans-serif",
      }}>
        <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "40px 28px" }}>

          {/* ── Top bar ── */}
          <div style={{
            display: "flex", alignItems: "center",
            justifyContent: "space-between", marginBottom: "28px",
            flexWrap: "wrap", gap: "10px",
          }}>
            <Link href="/projects" style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              fontSize: "13px", color: "#64748b", textDecoration: "none",
              fontWeight: 500,
            }}>
              ← Projects
            </Link>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {projectCode && (
                <span style={{
                  padding: "4px 10px", borderRadius: "20px",
                  background: `${projectColour}15`,
                  border: `1.5px solid ${projectColour}40`,
                  borderLeft: `3px solid ${projectColour}`,
                  fontSize: "12px", fontWeight: 700,
                  fontFamily: "'DM Mono', monospace",
                  color: projectColour,
                }}>{projectCode}</span>
              )}
              <span style={{
                padding: "4px 10px", borderRadius: "20px",
                background: "#f1f5f9", border: "1px solid #e2e8f0",
                fontSize: "11px", color: "#64748b", fontWeight: 600,
                textTransform: "capitalize",
              }}>{myRole}</span>
              {project?.resource_status === "pipeline" && (
                <span style={{
                  padding: "4px 10px", borderRadius: "20px",
                  background: "rgba(124,58,237,0.08)",
                  border: "1.5px solid rgba(124,58,237,0.2)",
                  fontSize: "11px", color: "#7c3aed", fontWeight: 700,
                }}>◌ Pipeline</span>
              )}
            </div>
          </div>

          {/* ── Flash banners ── */}
          {flash && (
            <div style={{
              marginBottom: "16px", padding: "11px 16px",
              borderRadius: "9px", background: "rgba(16,185,129,0.07)",
              border: "1.5px solid rgba(16,185,129,0.2)",
              fontSize: "13px", color: "#059669", fontWeight: 600,
            }}>
              {flash}
            </div>
          )}
          {flashErr && (
            <div style={{
              marginBottom: "16px", padding: "11px 16px",
              borderRadius: "9px", background: "#fef2f2",
              border: "1px solid #fecaca",
              fontSize: "13px", color: "#dc2626", fontWeight: 600,
            }}>
              {flashErr}
            </div>
          )}

          {/* ── Header ── */}
          <header style={{ marginBottom: "24px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "16px" }}>
              <div style={{
                width: "4px", height: "36px", borderRadius: "2px",
                background: projectColour, flexShrink: 0,
              }} />
              <h1 style={{
                fontSize: "26px", fontWeight: 800,
                color: "#0f172a", margin: 0,
              }}>{projectTitle}</h1>
            </div>

            {/* Nav tabs */}
            <nav style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              <Link className="pp-nav-link active" href={`/projects/${projectRefForUrls}`}>
                Overview
              </Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/artifacts`}>
                Artifacts
              </Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/changes`}>
                Changes
              </Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/approvals`}>
                Approvals
              </Link>
              <Link className="pp-nav-link" href={`/projects/${projectRefForUrls}/members`}>
                Members
              </Link>
              <Link className="pp-nav-link" href="/heatmap" style={{ marginLeft: "auto" }}>
                ▦ Full heatmap →
              </Link>
            </nav>
          </header>

          {/* ── Quick links (existing section, unchanged) ── */}
          <section style={{
            borderRadius: "12px", border: "1.5px solid #e2e8f0",
            padding: "20px 22px", background: "white",
            boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <div style={{
                width: "8px", height: "8px", borderRadius: "50%", background: "#10b981",
              }} />
              <span style={{ fontSize: "14px", fontWeight: 700, color: "#0f172a" }}>Quick links</span>
            </div>
            <p style={{ fontSize: "13px", color: "#475569", margin: 0 }}>
              Go to{" "}
              <Link
                href={`/projects/${projectRefForUrls}/artifacts`}
                style={{ color: "#00b8db", fontWeight: 600, textDecoration: "none" }}
              >
                Artifacts
              </Link>{" "}
              to create and manage documentation.
              {canEdit && (
                <>
                  {" "}
                  <a
                    href={`/allocations/new?project_id=${projectUuid}&return_to=/projects/${projectRefForUrls}`}
                    style={{ color: "#00b8db", fontWeight: 600, textDecoration: "none" }}
                  >
                    Allocate a resource →
                  </a>
                </>
              )}
            </p>
          </section>

          {/* ── Resource planning sections ── */}
          {resource ? (
            <ProjectResourcePanel data={resource} periods={periods} />
          ) : (
            <div style={{
              marginTop: "24px", padding: "20px",
              borderRadius: "12px", border: "1.5px dashed #e2e8f0",
              background: "white", textAlign: "center",
              color: "#94a3b8", fontSize: "13px",
            }}>
              Resource data could not be loaded.
              Run the <code>allocations_migration.sql</code> migration to enable this section.
            </div>
          )}

        </div>
      </main>
    </>
  );
}