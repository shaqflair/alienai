import "server-only";

import Link from "next/link";
import { buildQs, safeStr, type ProjectListRow } from "../_lib/projects-utils";

function fmtDate(d?: any) {
  const s = safeStr(d).trim();
  if (!s) return "—";
  // keep YYYY-MM-DD if already; else fallback to substring
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return s.slice(0, 10) || "—";
}

function statusTone(status?: string) {
  const s = String(status || "").toLowerCase();
  if (s.includes("close") || s.includes("complete")) return "border-gray-200 bg-gray-50 text-gray-700";
  if (s.includes("cancel")) return "border-rose-200 bg-rose-50 text-rose-700";
  if (s.includes("hold")) return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-emerald-200 bg-emerald-50 text-emerald-700";
}

export default function ProjectsResults({
  rows,
  view,
  q,
  sort,
  pid,
  err,
  msg,
  orgAdminSet,
  baseHrefForDismiss,
  panelGlow,
}: {
  rows: ProjectListRow[];
  view: "grid" | "list";
  q: string;
  sort: "title_asc" | "created_desc";
  pid?: string;
  err?: string;
  msg?: string;
  orgAdminSet: Set<string>;
  baseHrefForDismiss: string;
  panelGlow: string;
}) {
  const total = rows.length;

  function qs(next: Record<string, string | undefined>) {
    return buildQs({ ...next });
  }

  return (
    <section className="space-y-4">
      {/* Controls */}
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="text-sm text-gray-600">
          Showing <span className="font-semibold text-gray-900">{total}</span> project{total === 1 ? "" : "s"}
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
          {/* Search */}
          <form action="/projects" method="GET" className="flex items-center gap-2">
            <input type="hidden" name="view" value={view} />
            <input type="hidden" name="sort" value={sort} />

            <input
              name="q"
              defaultValue={q}
              placeholder="Search projects…"
              className="h-10 w-full sm:w-72 rounded-lg border border-gray-200 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none"
            />

            <button
              type="submit"
              className="h-10 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 transition"
            >
              Search
            </button>
          </form>

          {/* Sort */}
          <div className="flex items-center gap-2">
            <Link
              href={`/projects${qs({ q, view, sort: "created_desc" })}`}
              className={[
                "h-10 inline-flex items-center rounded-lg border px-3 text-sm font-semibold transition",
                sort === "created_desc"
                  ? "border-blue-500 bg-blue-600 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              Newest
            </Link>
            <Link
              href={`/projects${qs({ q, view, sort: "title_asc" })}`}
              className={[
                "h-10 inline-flex items-center rounded-lg border px-3 text-sm font-semibold transition",
                sort === "title_asc"
                  ? "border-blue-500 bg-blue-600 text-white"
                  : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50",
              ].join(" ")}
            >
              A–Z
            </Link>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className={`rounded-xl ${panelGlow} overflow-hidden`}>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse">
            <thead>
              <tr className="bg-gray-50 text-gray-600 text-xs uppercase tracking-wider">
                <th className="text-left font-semibold px-5 py-4 border-b border-gray-200 w-[46%]">
                  Project
                </th>
                <th className="text-left font-semibold px-5 py-4 border-b border-gray-200 w-[22%]">
                  Schedule
                </th>
                <th className="text-right font-semibold px-5 py-4 border-b border-gray-200 w-[32%]">
                  Actions
                </th>
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

                return (
                  <tr
                    key={projectId}
                    className="border-b border-gray-200 hover:bg-gray-50/70 transition-colors"
                  >
                    {/* PROJECT */}
                    <td className="px-5 py-5 align-top">
                      <div className="flex items-start gap-4">
                        <span
                          className={[
                            "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold border",
                            statusTone(p.status),
                          ].join(" ")}
                        >
                          {String(p.status || "active").toLowerCase().includes("active") ? "Active" : p.status}
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
                            Owner • ID: {String(p.project_code ?? "—")} • Created {fmtDate(p.created_at)}
                          </div>

                          {/* Quick nav chips */}
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Link
                              href={`${hrefProject}/change`}
                              className="inline-flex items-center rounded-lg px-3 py-1 text-xs font-semibold border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                            >
                              Change
                            </Link>
                            <Link
                              href={`${hrefProject}/raid`}
                              className="inline-flex items-center rounded-lg px-3 py-1 text-xs font-semibold border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                            >
                              RAID
                            </Link>
                            <Link
                              href={`${hrefArtifacts}?type=charter`}
                              className="inline-flex items-center rounded-lg px-3 py-1 text-xs font-semibold border border-gray-200 bg-white text-gray-800 hover:bg-gray-50"
                            >
                              Charter
                            </Link>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* SCHEDULE */}
                    <td className="px-5 py-5 align-top">
                      <div className="text-sm text-gray-900">
                        {fmtDate(p.start_date)} — {fmtDate(p.finish_date)}
                      </div>
                      <div className="mt-2 text-xs text-gray-500">Schedule window</div>
                    </td>

                    {/* ACTIONS */}
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

                        <div className="flex justify-end gap-2">
                          <Link
                            href={hrefProject}
                            className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
                          >
                            Close
                          </Link>
                          <Link
                            href={hrefProject}
                            className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm font-semibold text-rose-700 hover:bg-rose-100"
                          >
                            Delete
                          </Link>
                        </div>
                      </div>
                    </td>
                  </tr>
                );
              })}

              {rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-6 py-14 text-center">
                    <div className="text-sm font-semibold text-gray-900">No projects found</div>
                    <div className="mt-1 text-sm text-gray-500">Try adjusting your search.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-xs text-gray-400">
        Tip: this layout is intentionally “sheet-like” (grid lines + hover rows) to match your reference.
      </div>
    </section>
  );
}
