// src/app/projects/_components/ProjectsResults.tsx
import "server-only";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { safeStr, fmtUkDate, type ProjectListRow } from "../_lib/projects-utils";
import ProjectsDangerButtonsClient, {
  type DeleteGuard,
} from "./ProjectsDangerButtonsClient";

function fmtDate(d?: any) {
  const s = safeStr(d).trim();
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtUkDate(s);
  const d10 = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d10)) return fmtUkDate(d10);
  return s.slice(0, 10) || "—";
}

function statusTone(status?: string, closed?: boolean) {
  if (closed)
    return {
      dot: "#94a3b8",
      badge: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
    };
  const s = String(status || "").toLowerCase();
  if (s.includes("cancel"))
    return {
      dot: "#f87171",
      badge: "bg-rose-50 text-rose-600 ring-1 ring-rose-200",
    };
  if (s.includes("hold") || s.includes("pause"))
    return {
      dot: "#fbbf24",
      badge: "bg-amber-50 text-amber-600 ring-1 ring-amber-200",
    };
  return {
    dot: "#00B8DB",
    badge: "bg-cyan-50 text-cyan-700 ring-1 ring-cyan-200",
  };
}

function pmLabel(p: ProjectListRow): string {
  const anyP = p as any;
  const label =
    safeStr(anyP?.project_manager_label).trim() ||
    safeStr(anyP?.project_manager_name).trim() ||
    safeStr(anyP?.pm_name).trim();
  if (label) return label;
  const pmId = safeStr(anyP?.project_manager_id).trim();
  if (pmId) return "Assigned";
  return "Unassigned";
}

function hasJsonContent(v: any) {
  if (v == null) return false;
  if (typeof v !== "object") return true;
  if (Array.isArray(v)) return v.length > 0;
  return Object.keys(v).length > 0;
}

function nonEmptyText(s: any) {
  const t = safeStr(s).trim();
  return t.length > 0;
}

/**
 * Treat these as NOT active for the Projects list + counts.
 * We intentionally exclude cancelled/closed/completed/archived/rejected.
 */
function isInactiveProject(p: any) {
  if ((p as any)?.deleted_at) return true;

  const lifecycle = safeStr(p?.lifecycle_status || p?.lifecycle_state)
    .trim()
    .toLowerCase();
  const status = safeStr(p?.status || p?.state).trim().toLowerCase();

  const s = `${status} ${lifecycle}`;

  if (s.includes("cancel")) return true;
  if (s.includes("archiv")) return true;
  if (s.includes("reject")) return true;
  if (s.includes("close")) return true;
  if (s.includes("complete")) return true; // completed/complete
  if (s.includes("done")) return true;

  return false;
}

function isClosedLikeProject(p: any) {
  const lifecycle = safeStr(p?.lifecycle_status || p?.lifecycle_state)
    .trim()
    .toLowerCase();
  const status = safeStr(p?.status || p?.state).trim().toLowerCase();
  const s = `${status} ${lifecycle}`;

  return (
    s.includes("close") ||
    s.includes("complete") ||
    s.includes("done") ||
    s.includes("cancel") ||
    s.includes("archiv") ||
    s.includes("reject")
  );
}

export default async function ProjectsResults({
  rows,
  view,
  q,
  sort,
  filter,
  pid,
  err,
  msg,
  orgAdminOrgIds,
  baseHrefForDismiss,
  panelGlow,
}: {
  rows: ProjectListRow[];
  view: "grid" | "list";
  q: string;
  sort: "title_asc" | "created_desc";
  filter: "active" | "closed" | "all";
  pid?: string;
  err?: string;
  msg?: string;
  orgAdminOrgIds: string[];
  baseHrefForDismiss: string;
  panelGlow: string;
}) {
  const orgAdminSet = new Set((orgAdminOrgIds ?? []).map((x) => String(x)));

  // ✅ Apply filter *here* so UI + counts are always correct
  const filteredRows = (Array.isArray(rows) ? rows : []).filter((p) => {
    if (filter === "all") return true;
    if (filter === "active") return !isInactiveProject(p);
    if (filter === "closed") return isClosedLikeProject(p);
    return true;
  });

  const total = filteredRows.length;

  const supabase = await createClient();

  // ✅ Only compute delete-guard for the projects actually displayed
  const projectIds = filteredRows
    .map((r) => String((r as any)?.id || ""))
    .filter(Boolean);

  const guardByProject: Record<string, DeleteGuard> = {};

  if (projectIds.length) {
    const { data: arts, error } = await supabase
      .from("artifacts")
      .select("project_id, approval_status, content, content_json, deleted_at")
      .in("project_id", projectIds)
      .is("deleted_at", null);

    if (error) {
      for (const pid of projectIds) {
        guardByProject[pid] = {
          canDelete: false,
          totalArtifacts: 0,
          submittedCount: 0,
          contentCount: 0,
          reasons: [
            "Safety lock: could not verify artifact state (query failed). Use Abnormal close.",
          ],
        };
      }
    } else {
      const list = Array.isArray(arts) ? arts : [];
      for (const pid of projectIds) {
        guardByProject[pid] = {
          canDelete: true,
          totalArtifacts: 0,
          submittedCount: 0,
          contentCount: 0,
          reasons: [],
        };
      }

      for (const a of list) {
        const pid = String((a as any)?.project_id || "");
        if (!pid || !guardByProject[pid]) continue;

        guardByProject[pid].totalArtifacts += 1;

        const status = safeStr((a as any)?.approval_status).trim().toLowerCase();
        const isSubmittedOrBeyond = !!status && status !== "draft";

        const hasInfo =
          nonEmptyText((a as any)?.content) ||
          hasJsonContent((a as any)?.content_json);

        if (isSubmittedOrBeyond) guardByProject[pid].submittedCount += 1;
        if (hasInfo) guardByProject[pid].contentCount += 1;
      }

      for (const pid of projectIds) {
        const g = guardByProject[pid];
        const reasons: string[] = [];
        if (g.submittedCount > 0)
          reasons.push(`${g.submittedCount} artifact(s) submitted / in workflow`);
        if (g.contentCount > 0)
          reasons.push(`${g.contentCount} artifact(s) contain information`);
        const protectedExists = g.submittedCount > 0 || g.contentCount > 0;
        guardByProject[pid] = {
          ...g,
          canDelete: !protectedExists,
          reasons: protectedExists
            ? reasons.length
              ? reasons
              : ["Protected artifacts exist."]
            : [],
        };
      }
    }
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

  const makeHref = (next: Record<string, unknown>) =>
    `/projects${qsSafe({ q, view, sort, filter, ...next })}`;

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,300&family=DM+Mono:wght@400;500&display=swap');

        .pr-root { font-family: 'DM Sans', sans-serif; }
        .pr-mono { font-family: 'DM Mono', monospace; }

        .pr-tab {
          position: relative;
          display: inline-flex;
          align-items: center;
          height: 36px;
          padding: 0 16px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 0.01em;
          transition: all 0.15s ease;
          border: 1px solid transparent;
          cursor: pointer;
          text-decoration: none;
          white-space: nowrap;
        }

        .pr-tab-inactive {
          color: #64748b;
          background: white;
          border-color: #e2e8f0;
        }

        .pr-tab-inactive:hover {
          background: #f8fafc;
          border-color: #cbd5e1;
          color: #334155;
        }

        .pr-tab-active {
          color: white;
          background: #00B8DB;
          border-color: #00B8DB;
          box-shadow: 0 2px 8px rgba(0,184,219,0.35);
        }

        .pr-search-input {
          height: 36px;
          padding: 0 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          font-size: 13px;
          font-family: 'DM Sans', sans-serif;
          color: #0f172a;
          background: white;
          outline: none;
          transition: all 0.15s ease;
          width: 240px;
        }

        .pr-search-input:focus {
          border-color: #00B8DB;
          box-shadow: 0 0 0 3px rgba(0,184,219,0.12);
        }

        .pr-search-btn {
          height: 36px;
          padding: 0 18px;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          background: #00B8DB;
          color: white;
          border: none;
          cursor: pointer;
          transition: all 0.15s ease;
          white-space: nowrap;
        }

        .pr-search-btn:hover {
          background: #00a0bf;
          box-shadow: 0 2px 8px rgba(0,184,219,0.35);
        }

        .pr-card {
          background: white;
          border: 1px solid #e8edf4;
          border-radius: 14px;
          padding: 20px 24px;
          transition: all 0.18s ease;
          position: relative;
          overflow: visible;
        }

        .pr-card:hover {
          border-color: #b8dde8;
          box-shadow: 0 4px 24px rgba(0,184,219,0.1), 0 1px 4px rgba(0,0,0,0.04);
          transform: translateY(-1px);
        }

        .pr-card::before {
          content: '';
          position: absolute;
          left: 0;
          top: 4px;
          bottom: 4px;
          width: 3px;
          background: #00B8DB;
          opacity: 0;
          transition: opacity 0.18s ease;
          border-radius: 0 3px 3px 0;
        }

        .pr-card:hover::before { opacity: 1; }
        .pr-card-closed::before { background: #94a3b8; }

        .pr-status-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          flex-shrink: 0;
          margin-top: 2px;
        }

        .pr-status-dot-active {
          background: #00B8DB;
          box-shadow: 0 0 0 3px rgba(0,184,219,0.2);
          animation: pr-pulse 2.5s infinite;
        }

        @keyframes pr-pulse {
          0%, 100% { box-shadow: 0 0 0 3px rgba(0,184,219,0.2); }
          50% { box-shadow: 0 0 0 5px rgba(0,184,219,0.08); }
        }

        .pr-action-link {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 13px;
          border-radius: 7px;
          font-size: 12.5px;
          font-weight: 600;
          text-decoration: none;
          transition: all 0.14s ease;
          border: 1px solid #e8edf4;
          background: #fafbfd;
          color: #475569;
          letter-spacing: 0.01em;
        }

        .pr-action-link:hover {
          background: white;
          border-color: #00B8DB;
          color: #00869e;
          box-shadow: 0 2px 8px rgba(0,184,219,0.12);
        }

        .pr-action-link-admin {
          background: #f0fdf4;
          border-color: #bbf7d0;
          color: #15803d;
        }

        .pr-action-link-admin:hover {
          background: #dcfce7;
          border-color: #86efac;
          color: #166534;
          box-shadow: 0 2px 8px rgba(34,197,94,0.12);
        }

        .pr-code-badge {
          display: inline-flex;
          align-items: center;
          padding: 2px 8px;
          border-radius: 5px;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.05em;
          background: #f1f5f9;
          color: #64748b;
          border: 1px solid #e2e8f0;
          font-family: 'DM Mono', monospace;
        }

        .pr-empty-state { padding: 72px 24px; text-align: center; }

        .pr-controls {
          display: flex;
          align-items: center;
          justify-content: space-between;
          flex-wrap: wrap;
          gap: 12px;
          margin-bottom: 20px;
        }

        .pr-controls-right {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .pr-tab-group {
          display: flex;
          align-items: center;
          gap: 4px;
          background: #f8fafc;
          padding: 3px;
          border-radius: 10px;
          border: 1px solid #e8edf4;
        }

        .pr-count-label {
          font-size: 13px;
          color: #94a3b8;
          font-weight: 500;
        }

        .pr-count-label strong { color: #334155; font-weight: 700; }

        .pr-list { display: flex; flex-direction: column; gap: 10px; }

        .pr-card-grid {
          display: grid;
          grid-template-columns: 1fr auto;
          gap: 16px;
          align-items: start;
        }

        .pr-title {
          font-size: 15px;
          font-weight: 700;
          color: #0f172a;
          line-height: 1.3;
        }

        .pr-meta {
          font-size: 12px;
          color: #94a3b8;
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          margin-top: 4px;
        }

        .pr-meta-sep { color: #cbd5e1; }
        .pr-meta strong { color: #475569; font-weight: 600; }

        .pr-schedule {
          font-size: 12.5px;
          color: #475569;
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 6px;
          margin-top: 8px;
        }

        .pr-actions-row {
          display: flex;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
          justify-content: flex-end;
        }

        .pr-search-form { display: flex; align-items: center; gap: 6px; }
      `}</style>

      <section className="pr-root">
        {/* Controls bar */}
        <div className="pr-controls">
          <div className="pr-count-label">
            <strong>{total}</strong> project{total === 1 ? "" : "s"}
          </div>

          <div className="pr-controls-right">
            {/* Filter tabs */}
            <div className="pr-tab-group">
              <Link
                href={makeHref({ filter: "active" })}
                className={`pr-tab ${
                  filter === "active" ? "pr-tab-active" : "pr-tab-inactive"
                }`}
              >
                Active
              </Link>
              <Link
                href={makeHref({ filter: "closed" })}
                className={`pr-tab ${
                  filter === "closed" ? "pr-tab-active" : "pr-tab-inactive"
                }`}
              >
                Closed
              </Link>
              <Link
                href={makeHref({ filter: "all" })}
                className={`pr-tab ${
                  filter === "all" ? "pr-tab-active" : "pr-tab-inactive"
                }`}
              >
                All
              </Link>
            </div>

            {/* Search */}
            <form action="/projects" method="GET" className="pr-search-form">
              <input type="hidden" name="view" value={view} />
              <input type="hidden" name="sort" value={sort} />
              <input type="hidden" name="filter" value={filter} />
              <input
                name="q"
                defaultValue={q}
                placeholder="Search projects…"
                className="pr-search-input"
              />
              <button type="submit" className="pr-search-btn">
                Search
              </button>
            </form>

            {/* Sort tabs */}
            <div className="pr-tab-group">
              <Link
                href={makeHref({ sort: "created_desc" })}
                className={`pr-tab ${
                  sort === "created_desc" ? "pr-tab-active" : "pr-tab-inactive"
                }`}
              >
                Newest
              </Link>
              <Link
                href={makeHref({ sort: "title_asc" })}
                className={`pr-tab ${
                  sort === "title_asc" ? "pr-tab-active" : "pr-tab-inactive"
                }`}
              >
                A–Z
              </Link>
            </div>
          </div>
        </div>

        {/* Project list */}
        {total > 0 ? (
          <div className="pr-list">
            {filteredRows.map((p, idx) => {
              const projectId = String((p as any)?.id || "");
              const orgId = String((p as any)?.organisation_id || "");
              const isOrgAdmin = orgId ? orgAdminSet.has(orgId) : false;

              const hrefProject = `/projects/${encodeURIComponent(projectId)}`;
              const hrefArtifacts = `/projects/${encodeURIComponent(
                projectId
              )}/artifacts`;
              const hrefMembers = `/projects/${encodeURIComponent(projectId)}/members`;
              const hrefApprovals = `/projects/${encodeURIComponent(
                projectId
              )}/approvals`;
              const hrefDoa = `/projects/${encodeURIComponent(projectId)}/doa`;

              const pm = pmLabel(p);
              const guard = guardByProject[projectId] ?? null;
              const closed = isClosedLikeProject(p);
              const tone = statusTone((p as any)?.status, closed);

              const startDate = fmtDate((p as any)?.start_date);
              const endDate = fmtDate((p as any)?.finish_date);

              return (
                <div
                  key={projectId}
                  className={`pr-card ${closed ? "pr-card-closed" : ""}`}
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  <div className="pr-card-grid">
                    {/* Left: project info */}
                    <div style={{ minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: "12px",
                        }}
                      >
                        {/* Status dot */}
                        <div style={{ paddingTop: "4px", flexShrink: 0 }}>
                          <div
                            className={`pr-status-dot ${
                              !closed ? "pr-status-dot-active" : ""
                            }`}
                            style={{ background: tone.dot }}
                          />
                        </div>

                        <div style={{ minWidth: 0, flex: 1 }}>
                          {/* Title row */}
                          <div
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "10px",
                              flexWrap: "wrap",
                            }}
                          >
                            <Link href={hrefProject} style={{ textDecoration: "none" }}>
                              <span
                                className="pr-title"
                                style={{
                                  color: closed ? "#94a3b8" : "#0f172a",
                                }}
                              >
                                {safeStr((p as any)?.title)}
                              </span>
                            </Link>

                            {(p as any)?.project_code != null &&
                              String((p as any)?.project_code).trim() !== "" && (
                                <span className="pr-code-badge">
                                  {String((p as any)?.project_code)}
                                </span>
                              )}

                            <span
                              className={`pr-code-badge ${tone.badge}`}
                              style={{
                                fontSize: "11px",
                                fontFamily: "'DM Sans', sans-serif",
                                letterSpacing: "0.03em",
                              }}
                            >
                              {closed ? "Closed" : "Active"}
                            </span>
                          </div>

                          {/* Meta row */}
                          <div className="pr-meta">
                            <span>
                              PM:{" "}
                              <strong
                                style={{
                                  color:
                                    pm === "Unassigned" ? "#cbd5e1" : "#475569",
                                }}
                              >
                                {pm}
                              </strong>
                            </span>
                            <span className="pr-meta-sep">·</span>
                            <span>Created {fmtDate((p as any)?.created_at)}</span>
                          </div>

                          {/* Schedule */}
                          <div className="pr-schedule">
                            <svg
                              width="13"
                              height="13"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                              <line x1="16" y1="2" x2="16" y2="6" />
                              <line x1="8" y1="2" x2="8" y2="6" />
                              <line x1="3" y1="10" x2="21" y2="10" />
                            </svg>
                            {startDate} — {endDate}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Right: actions */}
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "flex-end",
                        gap: "10px",
                        flexShrink: 0,
                      }}
                    >
                      <div className="pr-actions-row">
                        <Link href={hrefProject} className="pr-action-link">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="8" x2="12" y2="12" />
                            <line x1="12" y1="16" x2="12.01" y2="16" />
                          </svg>
                          Overview
                        </Link>
                        <Link href={hrefArtifacts} className="pr-action-link">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <polyline points="14 2 14 8 20 8" />
                          </svg>
                          Artifacts
                        </Link>
                        <Link href={hrefMembers} className="pr-action-link">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                          Members
                        </Link>
                        <Link href={hrefApprovals} className="pr-action-link">
                          <svg
                            width="12"
                            height="12"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                          Approvals
                        </Link>
                        {isOrgAdmin && (
                          <Link href={hrefDoa} className="pr-action-link pr-action-link-admin">
                            <svg
                              width="12"
                              height="12"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2.5"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            >
                              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            DOA (Admin)
                          </Link>
                        )}
                      </div>

                      <ProjectsDangerButtonsClient
                        projectId={projectId}
                        projectTitle={safeStr((p as any)?.title)}
                        guard={guard}
                        isClosed={closed}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div
            className="pr-empty-state"
            style={{
              background: "white",
              borderRadius: "14px",
              border: "1px solid #e8edf4",
            }}
          >
            <svg
              width="40"
              height="40"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#cbd5e1"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ margin: "0 auto 16px" }}
            >
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "#334155" }}>
              No projects found
            </div>
            <div style={{ marginTop: "6px", fontSize: "13px", color: "#94a3b8" }}>
              Try adjusting your filters or search terms.
            </div>
          </div>
        )}
      </section>
    </>
  );
}