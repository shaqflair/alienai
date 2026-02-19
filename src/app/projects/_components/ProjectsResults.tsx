import "server-only";

import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import { safeStr, fmtUkDate, type ProjectListRow } from "../_lib/projects-utils";
import ProjectsDangerButtonsClient, { type DeleteGuard } from "./ProjectsDangerButtonsClient";

function fmtDate(d?: any) {
  const s = safeStr(d).trim();
  if (!s) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return fmtUkDate(s);
  const d10 = s.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(d10)) return fmtUkDate(d10);
  return s.slice(0, 10) || "—";
}

function statusTone(status?: string) {
  const s = String(status || "").toLowerCase();
  if (s.includes("close") || s.includes("complete")) return "border-gray-200 bg-gray-50 text-gray-700";
  if (s.includes("cancel")) return "border-rose-200 bg-rose-50 text-rose-700";
  if (s.includes("hold")) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
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

function isClosedProject(p: any) {
  const lifecycle = safeStr(p?.lifecycle_status).trim().toLowerCase();
  const status = safeStr(p?.status).trim().toLowerCase();
  if (lifecycle === "closed") return true;
  if (status.includes("closed")) return true;
  if (status.includes("complete")) return true;
  return false;
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

  // ✅ SERIALIZABLE (was Set<string>, which breaks RSC stringify)
  orgAdminOrgIds: string[];

  baseHrefForDismiss: string;
  panelGlow: string;
}) {
  const total = rows.length;
  const orgAdminSet = new Set((orgAdminOrgIds ?? []).map((x) => String(x)));

  // ------------------------------------------------------------------
  // Enterprise delete protection (server-side)
  // ------------------------------------------------------------------
  const supabase = await createClient();
  const projectIds = rows.map((r) => String(r.id || "")).filter(Boolean);

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
          reasons: ["Safety lock: could not verify artifact state (query failed). Use Abnormal close."],
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

        const hasInfo = nonEmptyText((a as any)?.content) || hasJsonContent((a as any)?.content_json);

        if (isSubmittedOrBeyond) guardByProject[pid].submittedCount += 1;
        if (hasInfo) guardByProject[pid].contentCount += 1;
      }

      for (const pid of projectIds) {
        const g = guardByProject[pid];

        const reasons: string[] = [];
        if (g.submittedCount > 0) reasons.push(`${g.submittedCount} artifact(s) submitted / in workflow`);
        if (g.contentCount > 0) reasons.push(`${g.contentCount} artifact(s) contain information`);

        const protectedExists = g.submittedCount > 0 || g.contentCount > 0;

        guardByProject[pid] = {
          ...g,
          canDelete: !protectedExists,
          reasons: protectedExists ? (reasons.length ? reasons : ["Protected artifacts exist."]) : [],
        };
      }
    }
  }

  // Simple URL builder (no buildQs dependency)
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
    `/projects${qsSafe({
      q,
      view,
      sort,
      filter,
      ...next,
    })}`;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-gray-600">
          Showing <span className="font-semibold text-gray-900">{total}</span> project{total === 1 ? "" : "s"}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          <div className="flex items-center gap-2">
            <Link
              href={makeHref({ filter: "active" })}
              className={[
                "h-10 inline-flex items-center rounded-lg border px-3 text-sm font-semibold transition",
                filter === "active"
                  ? "border-[#00B8DB] bg-[#00B8DB] text-white shadow-sm shadow-[#00B8DB]/20"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              Active
            </Link>
            <Link
              href={makeHref({ filter: "closed" })}
              className={[
                "h-10 inline-flex items-center rounded-lg border px-3 text-sm font-semibold transition",
                filter === "closed"
                  ? "border-[#00B8DB] bg-[#00B8DB] text-white shadow-sm shadow-[#00B8DB]/20"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              Closed
            </Link>
            <Link
              href={makeHref({ filter: "all" })}
              className={[
                "h-10 inline-flex items-center rounded-lg border px-3 text-sm font-semibold transition",
                filter === "all"
                  ? "border-[#00B8DB] bg-[#00B8DB] text-white shadow-sm shadow-[#00B8DB]/20"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              All
            </Link>
          </div>

          <form action="/projects" method="GET" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="sort" value={sort} />
            <input type="hidden" name="filter" value={filter} />

            <input
              name="q"
              defaultValue={q}
              placeholder="Search projects…"
              className="h-10 w-full sm:w-72 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#00B8DB] focus:ring-2 focus:ring-[#00B8DB]/20 outline-none"
            />

            <button
              type="submit"
              className="h-10 rounded-lg bg-[#00B8DB] px-4 text-sm font-semibold text-white hover:bg-[#00a5c4] transition shadow-sm shadow-[#00B8DB]/20"
            >
              Search
            </button>
          </form>

          <div className="flex items-center gap-2">
            <Link
              href={makeHref({ sort: "created_desc" })}
              className={[
                "h-10 inline-flex items-center rounded-lg border px-3 text-sm font-semibold transition",
                sort === "created_desc"
                  ? "border-[#00B8DB] bg-[#00B8DB] text-white shadow-sm shadow-[#00B8DB]/20"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              Newest
            </Link>

            <Link
              href={makeHref({ sort: "title_asc" })}
              className={[
                "h-10 inline-flex items-center rounded-lg border px-3 text-sm font-semibold transition",
                sort === "title_asc"
                  ? "border-[#00B8DB] bg-[#00B8DB] text-white shadow-sm shadow-[#00B8DB]/20"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              A–Z
            </Link>
          </div>
        </div>
      </div>

      <div className={`rounded-xl ${panelGlow} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                <th className="text-left font-semibold px-5 py-4 border-b border-gray-200 w-[46%]">Project</th>
                <th className="text-left font-semibold px-5 py-4 border-b border-gray-200 w-[22%]">Schedule</th>
                <th className="text-right font-semibold px-5 py-4 border-b border-gray-200 w-[32%]">Actions</th>
              </tr>
            </thead>

            <tbody className="bg-white">
              {rows.map((p) => {
                const projectId = String(p.id || "");
                const orgId = String(p.organisation_id || "");
                const isOrgAdmin = orgId ? orgAdminSet.has(orgId) : false;

                const hrefProject = `/projects/${encodeURIComponent(projectId)}`;
                const hrefArtifacts = `/projects/${encodeURIComponent(projectId)}/artifacts`;
                const hrefMembers = `/projects/${encodeURIComponent(projectId)}/members`;
                const hrefApprovals = `/projects/${encodeURIComponent(projectId)}/approvals`;
                const hrefDoa = `/projects/${encodeURIComponent(projectId)}/doa`;

                const pm = pmLabel(p);
                const guard = guardByProject[projectId] ?? null;
                const closed = isClosedProject(p);

                return (
                  <tr key={projectId} className="border-b border-gray-200 hover:bg-gray-50/70 transition-colors">
                    <td className="px-5 py-5 align-top">
                      <div className="flex items-start gap-4">
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border",
                            statusTone(p.status),
                          ].join(" ")}
                        >
                          {closed ? "Closed" : "Active"}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="font-semibold text-gray-900 truncate">{p.title}</div>
                            {p.project_code != null && String(p.project_code).trim() !== "" && (
                              <span className="shrink-0 inline-flex items-center rounded-md border border-gray-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-gray-700">
                                {String(p.project_code)}
                              </span>
                            )}
                          </div>

                          <div className="mt-1 text-xs text-gray-500">
                            Owner • PM:{" "}
                            <span className={pm === "Unassigned" ? "text-gray-400" : "text-gray-700 font-semibold"}>
                              {pm}
                            </span>{" "}
                            • Created {fmtDate((p as any).created_at)}
                          </div>

                          {guard && !guard.canDelete ? (
                            <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-800">
                              <span className="font-semibold">Delete blocked:</span>{" "}
                              {guard.reasons.join(" • ")}. Use <span className="font-semibold">Abnormal close</span>.
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="px-5 py-5 align-top">
                      <div className="text-sm text-gray-900">
                        {fmtDate((p as any).start_date)} — {fmtDate((p as any).finish_date)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500">Schedule window</div>
                    </td>

                    <td className="px-5 py-5 align-top">
                      <div className="flex flex-col items-end gap-3">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Link
                            href={hrefProject}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                          >
                            Overview
                          </Link>
                          <Link
                            href={hrefArtifacts}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                          >
                            Artifacts
                          </Link>
                          <Link
                            href={hrefMembers}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                          >
                            Members
                          </Link>
                          <Link
                            href={hrefApprovals}
                            className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-800 hover:bg-gray-50"
                          >
                            Approvals
                          </Link>

                          {isOrgAdmin && (
                            <Link
                              href={hrefDoa}
                              className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-100"
                            >
                              DOA (Admin)
                            </Link>
                          )}
                        </div>

                        <ProjectsDangerButtonsClient
                          projectId={projectId}
                          projectTitle={safeStr(p.title)}
                          guard={guard}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-14 text-center">
                    <div className="text-sm font-semibold text-gray-900">No projects found</div>
                    <div className="mt-1 text-sm text-gray-500">Try adjusting your filters or search.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
