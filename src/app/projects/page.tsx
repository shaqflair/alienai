// src/app/projects/page.tsx
import "server-only";

import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

import { createProject } from "./actions";

import ProjectsHeader from "./_components/ProjectsHeader";
import ProjectsResults from "./_components/ProjectsResults";

import {
  buildQs,
  flashFromQuery,
  inviteBanner,
  norm,
  safeStr,
  type MemberProjectRow,
  type ProjectListRow,
} from "./_lib/projects-utils";

type OrgMemberOption = {
  user_id: string;
  label: string;
  role?: string | null;
};

function displayNameFromUser(user: any) {
  const full =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    "";
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
    | Promise<{
        invite?: string;
        q?: string;
        view?: string;
        sort?: string;
        filter?: string;
        err?: string;
        msg?: string;
        pid?: string;
      }>
    | {
        invite?: string;
        q?: string;
        view?: string;
        sort?: string;
        filter?: string;
        err?: string;
        msg?: string;
        pid?: string;
      };
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect(`/login?next=${encodeURIComponent("/projects")}`);

  const sp = (await searchParams) ?? {};
  const banner = inviteBanner((sp as any)?.invite);

  const q = safeStr((sp as any)?.q).trim();
  const view = norm((sp as any)?.view) === "grid" ? "grid" : "list";
  const sort = norm((sp as any)?.sort) === "title_asc" ? "title_asc" : "created_desc";

  const filterRaw = norm((sp as any)?.filter).toLowerCase();
  const filter: "active" | "closed" | "all" =
    filterRaw === "closed" ? "closed" : filterRaw === "all" ? "all" : "active";

  const err = safeStr((sp as any)?.err).trim();
  const msg = safeStr((sp as any)?.msg).trim();
  const pid = safeStr((sp as any)?.pid).trim();
  const flash = flashFromQuery(err, msg);

  const userId = user.id;

  // ✅ Load projects (includes PM relationship via FK projects_project_manager_id_fkey)
  const { data, error } = await supabase
    .from("project_members")
    .select(
      `
      project_id,
      role,
      projects:projects!project_members_project_id_fkey (
        id,
        title,
        project_code,
        start_date,
        finish_date,
        created_at,
        organisation_id,
        status,
        lifecycle_status,
        closed_at,
        deleted_at,

        project_manager_id,
        project_manager:profiles!projects_project_manager_id_fkey (
          user_id,
          full_name,
          email
        )
      )
    `
    )
    .eq("user_id", userId)
    .is("projects.deleted_at", null)
    .order("created_at", { foreignTable: "projects", ascending: false });

  if (error) {
    return (
      <main className="min-h-screen bg-gray-50 text-gray-900">
        <div className="mx-auto max-w-6xl px-6 py-10">
          <h1 className="text-2xl font-semibold text-gray-900">Projects</h1>
          <p className="mt-3 text-sm text-red-600">Error: {error.message}</p>
        </div>
      </main>
    );
  }

  const rows: ProjectListRow[] = ((data ?? []) as MemberProjectRow[])
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

        // extra (safe)
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

  // Filter: active/closed/all
  const lifecycleFiltered = (() => {
    if (filter === "all") return rows;
    if (filter === "closed") return rows.filter((p: any) => isClosedProject(p));
    return rows.filter((p: any) => !isClosedProject(p));
  })();

  const textFiltered = (() => {
    if (!q) return lifecycleFiltered;
    const nq = norm(q);
    return lifecycleFiltered.filter((p) => {
      const hay = `${p.title} ${String(p.project_code ?? "")} ${p.id}`.toLowerCase();
      return hay.includes(nq);
    });
  })();

  const sorted = (() => {
    const arr = [...textFiltered];
    if (sort === "title_asc") {
      arr.sort((a, b) => safeStr(a.title).localeCompare(safeStr(b.title)));
    } else {
      arr.sort((a, b) => safeStr(b.created_at).localeCompare(safeStr(a.created_at)));
    }
    return arr;
  })();

  const inviteParam = safeStr((sp as any)?.invite).trim();
  function baseQs(next: Record<string, string | undefined>) {
    return buildQs({ ...next, invite: inviteParam || undefined });
  }

  // ✅ Cyan border style matching reference image (#00B8DB)
  const panelGlow = "bg-white text-gray-900 rounded-2xl border-2 border-[#00B8DB] shadow-[0_4px_20px_rgba(0,184,219,0.15)]";

  // ─────────────────────────────────────────────────────────────
  // Active org + org name
  // ─────────────────────────────────────────────────────────────
  const cookieOrgId = await getActiveOrgId().catch(() => null);
  const activeOrgId = (cookieOrgId && String(cookieOrgId)) || (orgIds[0] ? String(orgIds[0]) : "");

  const canCreate = !!activeOrgId;

  const { data: orgRow } = activeOrgId
    ? await supabase.from("organisations").select("id,name").eq("id", activeOrgId).maybeSingle()
    : { data: null as any };

  const activeOrgName = safeStr(orgRow?.name).trim();

  // Org members for PM dropdown
  const { data: orgMemberRows } = activeOrgId
    ? await supabase
        .from("organisation_members")
        .select(
          `
          user_id,
          role,
          profiles:profiles (
            user_id,
            full_name,
            email
          )
        `
        )
        .eq("organisation_id", activeOrgId)
        .is("removed_at", null)
        .order("role", { ascending: true })
    : { data: [] as any[] };

  const pmOptions: OrgMemberOption[] = (orgMemberRows ?? [])
    .map((r: any) => ({
      user_id: String(r?.user_id || ""),
      label: formatMemberLabel(r),
      role: (r?.role as string | null) ?? null,
    }))
    .filter((x) => !!x.user_id);

  const ownerLabel = displayNameFromUser(user);

  return (
    <main className="projects-theme-cyan relative min-h-screen bg-gray-50 text-gray-900 overflow-x-hidden">
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            .projects-theme-cyan { --accent: #00B8DB; }

            .projects-theme-cyan h1,
            .projects-theme-cyan [data-page-title="projects"],
            .projects-theme-cyan .page-title {
              color: #0f172a !important;
            }
            .projects-theme-cyan .text-white\\/80,
            .projects-theme-cyan .text-white\\/70,
            .projects-theme-cyan .text-slate-200,
            .projects-theme-cyan .text-slate-300 {
              color: #64748b !important;
            }

            .projects-theme-cyan a[href="/artifacts"],
            .projects-theme-cyan a[href^="/artifacts?" ],
            .projects-theme-cyan a[href="/app/artifacts"],
            .projects-theme-cyan a[href^="/app/artifacts?" ] {
              background: var(--accent) !important;
              border-color: var(--accent) !important;
              color: #fff !important;
              box-shadow: 0 10px 30px rgba(0,184,219,0.25) !important;
            }
            .projects-theme-cyan a[href="/artifacts"]:hover,
            .projects-theme-cyan a[href^="/artifacts?" ]:hover,
            .projects-theme-cyan a[href="/app/artifacts"]:hover,
            .projects-theme-cyan a[href^="/app/artifacts?" ]:hover {
              filter: brightness(0.95) !important;
            }

            .projects-theme-cyan .bg-blue-600 { background-color: var(--accent) !important; }
            .projects-theme-cyan .hover\\:bg-blue-700:hover { background-color: #00a5c4 !important; }
            .projects-theme-cyan .border-blue-600 { border-color: var(--accent) !important; }
            .projects-theme-cyan .text-blue-600 { color: var(--accent) !important; }
            .projects-theme-cyan .ring-blue-500\\/20 { --tw-ring-color: rgba(0,184,219,0.20) !important; }
          `,
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 py-10 space-y-8">
        <ProjectsHeader banner={banner} flash={flash} dismissHref={`/projects${baseQs({ q, sort, view, filter })}`} />

        {/* Create project */}
        <section className={`p-6 md:p-8 space-y-5 ${panelGlow}`}>
          <div className="space-y-1">
            <h2 className="text-lg font-semibold text-gray-900">Create a project</h2>
            <p className="text-sm text-gray-500">
              Enterprise setup: define ownership and delivery lead (PM) for governance and reporting.
            </p>

            <p className="text-xs text-gray-500">
              Active organisation:{" "}
              <span className="font-semibold text-gray-700">{activeOrgName || "Not set"}</span>
            </p>
          </div>

          {!canCreate ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              You don’t have an active organisation selected yet. Select an organisation first, then create a project.
            </div>
          ) : null}

          <form action={createProject} className="grid gap-4 max-w-2xl">
            <input type="hidden" name="organisation_id" value={activeOrgId} />

            <div className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Project owner</span>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 text-gray-900">
                {ownerLabel}
              </div>
              <p className="text-xs text-gray-500">Owner is the accountable lead for governance (auto-set to you).</p>
            </div>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Project name</span>
              <input
                name="title"
                placeholder="e.g. Project Venus"
                required
                className="rounded-lg bg-white border border-gray-300 px-4 py-3 text-gray-900 placeholder:text-gray-400 focus:border-[#00B8DB] focus:ring-2 focus:ring-[#00B8DB]/20 outline-none transition-colors"
              />
            </label>

            <label className="grid gap-2">
              <span className="text-sm font-semibold text-gray-700">Project manager (optional)</span>
              <select
                name="project_manager_id"
                defaultValue=""
                className="rounded-lg bg-white border border-gray-300 px-4 py-3 text-gray-900 focus:border-[#00B8DB] focus:ring-2 focus:ring-[#00B8DB]/20 outline-none transition-colors"
              >
                <option value="">Unassigned</option>
                {pmOptions.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500">Assign now or later — used for delivery accountability and exec reporting.</p>
            </label>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <label className="grid gap-2">
                <span className="text-sm font-semibold text-gray-700">Project start date</span>
                <input
                  name="start_date"
                  type="date"
                  required
                  className="rounded-lg bg-white border border-gray-300 px-4 py-3 text-gray-900 focus:border-[#00B8DB] focus:ring-2 focus:ring-[#00B8DB]/20 outline-none transition-colors"
                />
              </label>

              <label className="grid gap-2">
                <span className="text-sm font-semibold text-gray-700">Project finish date</span>
                <input
                  name="finish_date"
                  type="date"
                  className="rounded-lg bg-white border border-gray-300 px-4 py-3 text-gray-900 focus:border-[#00B8DB] focus:ring-2 focus:ring-[#00B8DB]/20 outline-none transition-colors"
                />
              </label>
            </div>

            <button
              type="submit"
              disabled={!canCreate}
              className="w-fit rounded-lg bg-[#00B8DB] px-5 py-2.5 font-semibold text-white hover:bg-[#00a5c4] transition shadow-lg shadow-[#00B8DB]/25 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create project
            </button>
          </form>
        </section>

        <div className="text-gray-900">
          <ProjectsResults
            rows={sorted}
            view={view}
            q={q}
            sort={sort}
            filter={filter}
            pid={pid}
            err={err}
            msg={msg}
            orgAdminSet={orgAdminSet}
            baseHrefForDismiss={`/projects${baseQs({ q, sort, view, filter })}`}
            panelGlow={panelGlow}
          />
        </div>
      </div>
    </main>
  );
}
