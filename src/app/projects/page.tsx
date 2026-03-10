// src/app/projects/page.tsx
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { portfolioGlobalCss } from "@/lib/ui/portfolioTheme";
import { getActiveOrgId } from "@/utils/org/active-org";
import { createClient } from "@/utils/supabase/server";
import CreateProjectModal from "./_components/CreateProjectModal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type SearchParams = Promise<{
  filter?: string;
  sort?: string;
  q?: string;
}>;

type Rag = "G" | "A" | "R" | null;

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
  project_manager_id?: string | null;
  pm_user_id?: string | null;
  pm_name?: string | null;
  health?: number | null;
  rag?: Rag;
};

type MemberRow = {
  project_id: string | null;
  role: string | null;
  removed_at: string | null;
};

type ProjectRow = {
  id: string;
  title: string | null;
  project_code: string | null;
  colour: string | null;
  status: string | null;
  resource_status: string | null;
  start_date: string | null;
  finish_date: string | null;
  created_at: string;
  organisation_id: string;
  deleted_at: string | null;
  project_manager_id: string | null;
  pm_user_id: string | null;
  pm_name: string | null;
};

type RagRow = {
  project_id: string | null;
  health: number | null;
  rag: string | null;
  created_at: string | null;
};

type ProfileRow = {
  id: string | null;
  user_id: string | null;
  full_name: string | null;
  email: string | null;
};

function toStr(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function toNullableTrimmed(value: unknown): string | null {
  const s = toStr(value).trim();
  return s || null;
}

function formatDate(
  value: string | null | undefined,
  mode: "short" | "long" = "long",
): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: mode === "short" ? "2-digit" : "numeric",
  });
}

function daysUntil(dateValue: string | null | undefined): number | null {
  if (!dateValue) return null;
  const date = new Date(dateValue);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / 86_400_000);
}

function normaliseRag(value: unknown): Rag {
  const s = toStr(value).trim().toUpperCase();
  if (s === "G" || s === "GREEN") return "G";
  if (s === "A" || s === "AMBER" || s === "Y") return "A";
  if (s === "R" || s === "RED") return "R";
  return null;
}

function ragLabel(rag: Rag): string {
  if (rag === "G") return "Green";
  if (rag === "A") return "Amber";
  if (rag === "R") return "Red";
  return "";
}

function isClosedStatus(status: string | null | undefined): boolean {
  return toStr(status).trim().toLowerCase() === "closed";
}

function getStatusLabel(project: Project): "Closed" | "Pipeline" | "Active" {
  if (isClosedStatus(project.status)) return "Closed";
  if (project.resource_status === "pipeline") return "Pipeline";
  return "Active";
}

function getStatusClassName(project: Project): string {
  if (isClosedStatus(project.status)) return "statusClosed";
  if (project.resource_status === "pipeline") return "statusPipeline";
  return "statusActive";
}

function getTimelineProgress(startDate: string | null, finishDate: string | null): number {
  if (!startDate || !finishDate) return 0;

  const start = new Date(startDate).getTime();
  const finish = new Date(finishDate).getTime();
  if (Number.isNaN(start) || Number.isNaN(finish) || finish <= start) return 0;

  const now = Date.now();
  return Math.min(100, Math.max(0, Math.round(((now - start) / (finish - start)) * 100)));
}

function getTimelineState(project: Project) {
  const accent = project.colour || "var(--ui-accent)";
  const remaining = daysUntil(project.finish_date);

  const label =
    remaining == null
      ? ""
      : remaining < 0
        ? `${Math.abs(remaining)}d overdue`
        : remaining === 0
          ? "Due today"
          : `${remaining}d left`;

  const tone =
    remaining == null
      ? "neutral"
      : remaining < 0
        ? "danger"
        : remaining < 30
          ? "warning"
          : "normal";

  const fillColor =
    tone === "danger"
      ? "var(--ui-danger)"
      : tone === "warning"
        ? "var(--ui-warning)"
        : accent;

  return {
    progress: getTimelineProgress(project.start_date, project.finish_date),
    label,
    tone,
    fillColor,
  } as const;
}

function getHealthState(project: Project) {
  const rag = normaliseRag(project.rag);
  const health = project.health ?? null;

  const tone =
    rag === "G"
      ? "good"
      : rag === "A"
        ? "warning"
        : rag === "R"
          ? "danger"
          : health == null
            ? "neutral"
            : health >= 85
              ? "good"
              : health >= 70
                ? "warning"
                : "danger";

  return { rag, health, tone } as const;
}

function matchesQuery(project: Project, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();

  return (
    project.title.toLowerCase().includes(q) ||
    (project.project_code ?? "").toLowerCase().includes(q) ||
    (project.pm_name ?? "").toLowerCase().includes(q)
  );
}

function healthTone(value: number): "good" | "warning" | "danger" {
  if (value >= 90) return "good";
  if (value >= 70) return "warning";
  return "danger";
}

async function setProjectStatus(formData: FormData) {
  "use server";

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!user) redirect("/login");

  const projectId = toStr(formData.get("project_id")).trim();
  const status = toStr(formData.get("status")).trim().toLowerCase();
  const next = toStr(formData.get("next")).trim() || "/projects";

  if (!projectId || !["active", "closed"].includes(status)) {
    redirect(next);
  }

  const { error } = await supabase.from("projects").update({ status }).eq("id", projectId);

  if (error) throw error;

  redirect(next);
}

async function getProjectsForUser(
  userId: string,
  activeOrgId: string,
): Promise<{
  projects: Project[];
  roleMap: Record<string, string | null>;
}> {
  const supabase = await createClient();

  const { data: memberRows, error: memberError } = await supabase
    .from("project_members")
    .select("project_id, role, removed_at")
    .eq("user_id", userId)
    .is("removed_at", null)
    .limit(20000);

  if (memberError) throw memberError;

  const typedMembers = (memberRows ?? []) as MemberRow[];

  const memberProjectIds = typedMembers
    .map((row) => toNullableTrimmed(row.project_id))
    .filter((value): value is string => Boolean(value));

  const roleMap = Object.fromEntries(
    typedMembers.map((row) => [toStr(row.project_id), row.role ?? null]),
  ) as Record<string, string | null>;

  if (memberProjectIds.length === 0) {
    return { projects: [], roleMap };
  }

  const { data: projectRows, error: projectError } = await supabase
    .from("projects")
    .select(
      "id, title, project_code, colour, status, resource_status, start_date, finish_date, created_at, organisation_id, deleted_at, project_manager_id, pm_user_id, pm_name",
    )
    .in("id", memberProjectIds)
    .eq("organisation_id", activeOrgId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(20000);

  if (projectError) throw projectError;

  const typedProjects = (projectRows ?? []) as ProjectRow[];
  const projectIds = typedProjects.map((project) => project.id);

  const pmUserIds = Array.from(
    new Set(
      typedProjects
        .map((project) => toNullableTrimmed(project.pm_user_id))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const pmProfileIds = Array.from(
    new Set(
      typedProjects
        .map((project) => toNullableTrimmed(project.project_manager_id))
        .filter((value): value is string => Boolean(value)),
    ),
  );

  const ragMap = new Map<string, { health: number | null; rag: Rag }>();
  const profileByUserId = new Map<string, { full_name: string | null; email: string | null }>();
  const profileById = new Map<string, { full_name: string | null; email: string | null }>();

  if (projectIds.length > 0) {
    const { data: ragRows, error: ragError } = await supabase
      .from("project_rag_scores")
      .select("project_id, health, rag, created_at")
      .in("project_id", projectIds)
      .order("created_at", { ascending: false });

    if (ragError) throw ragError;

    for (const row of (ragRows ?? []) as RagRow[]) {
      const projectId = toNullableTrimmed(row.project_id);
      if (!projectId || ragMap.has(projectId)) continue;

      const health =
        row.health == null || Number.isNaN(Number(row.health)) ? null : Number(row.health);

      ragMap.set(projectId, {
        health,
        rag: normaliseRag(row.rag),
      });
    }
  }

  if (pmUserIds.length > 0) {
    const { data: rows, error } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, email")
      .in("user_id", pmUserIds);

    if (error) throw error;

    for (const row of (rows ?? []) as ProfileRow[]) {
      const userId = toNullableTrimmed(row.user_id);
      if (!userId) continue;

      profileByUserId.set(userId, {
        full_name: row.full_name ?? null,
        email: row.email ?? null,
      });
    }
  }

  if (pmProfileIds.length > 0) {
    const { data: rows, error } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, email")
      .in("id", pmProfileIds);

    if (error) throw error;

    for (const row of (rows ?? []) as ProfileRow[]) {
      const id = toNullableTrimmed(row.id);
      if (!id) continue;

      profileById.set(id, {
        full_name: row.full_name ?? null,
        email: row.email ?? null,
      });
    }
  }

  const projects: Project[] = typedProjects.map((project) => {
    const projectId = project.id;
    const pmUserId = toNullableTrimmed(project.pm_user_id);
    const projectManagerId = toNullableTrimmed(project.project_manager_id);
    const storedPmName = toNullableTrimmed(project.pm_name);

    const fromUser = pmUserId ? profileByUserId.get(pmUserId) : null;
    const fromProfile = projectManagerId ? profileById.get(projectManagerId) : null;

    const resolvedPmName =
      storedPmName ||
      toNullableTrimmed(fromUser?.full_name) ||
      toNullableTrimmed(fromUser?.email) ||
      toNullableTrimmed(fromProfile?.full_name) ||
      toNullableTrimmed(fromProfile?.email) ||
      null;

    return {
      id: projectId,
      title: project.title?.trim() || "Untitled",
      project_code: project.project_code ?? null,
      colour: project.colour ?? null,
      status: project.status ?? null,
      resource_status: project.resource_status ?? null,
      start_date: project.start_date ?? null,
      finish_date: project.finish_date ?? null,
      created_at: project.created_at,
      pm_user_id: pmUserId,
      project_manager_id: projectManagerId,
      pm_name: resolvedPmName,
      health: ragMap.get(projectId)?.health ?? null,
      rag: ragMap.get(projectId)?.rag ?? null,
    };
  });

  return { projects, roleMap };
}

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams?: SearchParams;
}) {
  const supabase = await createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw authError;
  if (!user) redirect("/login");

  const activeOrgId = await getActiveOrgId();
  if (!activeOrgId) redirect("/settings?err=no_active_org");

  const { projects, roleMap } = await getProjectsForUser(user.id, activeOrgId);

  const sp = (await searchParams) ?? {};
  const filter = (sp.filter ?? "Active").trim();
  const sortMode = (sp.sort ?? "Newest").trim();
  const query = (sp.q ?? "").trim();

  const filtered = [...projects]
    .filter((project) => {
      if (filter === "Active") return !isClosedStatus(project.status);
      if (filter === "Closed") return isClosedStatus(project.status);
      return true;
    })
    .filter((project) => matchesQuery(project, query))
    .sort((a, b) => {
      if (sortMode === "A-Z") {
        return a.title.localeCompare(b.title);
      }
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const activeCount = projects.filter((project) => !isClosedStatus(project.status)).length;
  const closedCount = projects.filter((project) => isClosedStatus(project.status)).length;
  const atRiskCount = projects.filter(
    (project) => !isClosedStatus(project.status) && normaliseRag(project.rag) === "R",
  ).length;

  const averageHealth = (() => {
    const scored = projects.filter(
      (project) => !isClosedStatus(project.status) && project.health != null,
    );
    if (scored.length === 0) return null;
    return Math.round(
      scored.reduce((sum, project) => sum + (project.health ?? 0), 0) / scored.length,
    );
  })();

  const todayLabel = new Date().toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <>
      <style>{portfolioGlobalCss()}</style>

      <div
        className="min-h-screen bg-[var(--ui-bg)] text-[var(--ui-text)]"
        style={{ fontFamily: "var(--ui-font-sans)" }}
      >
        <div className="border-b border-[var(--ui-border)] bg-[var(--ui-panel)]">
          <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--ui-muted)]">
                Portfolio
              </div>
              <h1 className="text-xl font-semibold tracking-tight">Projects</h1>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/artifacts"
                className="inline-flex items-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] px-3 py-2 text-sm font-medium text-[var(--ui-text)] shadow-sm transition hover:bg-[var(--ui-panelAlt)]"
              >
                Artifacts
              </Link>
              <CreateProjectModal activeOrgId={activeOrgId} userId={user.id} />
            </div>
          </div>
        </div>

        <main className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
          <section className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.9fr)]">
            <div className="rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-6 shadow-sm">
              <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--ui-muted)]">
                Portfolio command centre
              </div>
              <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
                Portfolio Projects
              </h2>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-[var(--ui-muted)]">
                Monitor delivery health, track milestones, and move into project execution,
                governance, and team coordination from one portfolio view.
              </p>
            </div>

            <div className="rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-panel)] p-6 shadow-sm">
              <p className="text-sm leading-6 text-[var(--ui-muted)]">
                Portfolio overview for your active organisation. Review live project inventory,
                scan risk posture, and jump directly into action.
              </p>

              <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <MetricCard label="Total" value={projects.length} />
                <MetricCard label="Active" value={activeCount} />
                <MetricCard label="Closed" value={closedCount} tone="neutral" />
                {atRiskCount > 0 ? (
                  <MetricCard label="At Risk" value={atRiskCount} tone="danger" />
                ) : averageHealth != null ? (
                  <MetricCard
                    label="Avg Health"
                    value={`${averageHealth}%`}
                    tone={healthTone(averageHealth)}
                  />
                ) : (
                  <MetricCard label="Coverage" value="—" tone="neutral" />
                )}
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-3xl border border-[var(--ui-border)] bg-[var(--ui-panel)] shadow-sm">
            <div className="flex flex-col gap-4 border-b border-[var(--ui-border)] p-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex flex-wrap gap-2">
                {(["Active", "Closed", "All"] as const).map((item) => {
                  const count =
                    item === "Active"
                      ? activeCount
                      : item === "Closed"
                        ? closedCount
                        : projects.length;

                  const active = filter === item;

                  return (
                    <Link
                      key={item}
                      href={`/projects?filter=${item}&sort=${sortMode}&q=${encodeURIComponent(query)}`}
                      className={`inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                        active
                          ? "bg-[var(--ui-text)] text-white"
                          : "border border-[var(--ui-border)] bg-[var(--ui-panel)] text-[var(--ui-muted)] hover:bg-[var(--ui-panelAlt)]"
                      }`}
                    >
                      {item}
                      <span className="ml-2 opacity-80">{count}</span>
                    </Link>
                  );
                })}
              </div>

              <div className="flex flex-col gap-3 sm:flex-row">
                <form method="get" className="flex items-center gap-2">
                  <input type="hidden" name="filter" value={filter} />
                  <input type="hidden" name="sort" value={sortMode} />
                  <input
                    type="search"
                    name="q"
                    defaultValue={query}
                    placeholder="Search projects"
                    className="w-full min-w-[220px] rounded-2xl border border-[var(--ui-border)] bg-[var(--ui-panelAlt)] px-4 py-2.5 text-sm outline-none transition placeholder:text-[var(--ui-muted)] focus:border-[var(--ui-accent)] sm:w-72"
                  />
                </form>

                <div className="flex gap-2">
                  {(["Newest", "A-Z"] as const).map((item) => {
                    const active = sortMode === item;
                    return (
                      <Link
                        key={item}
                        href={`/projects?filter=${filter}&sort=${item}&q=${encodeURIComponent(query)}`}
                        className={`inline-flex items-center rounded-full px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] transition ${
                          active
                            ? "bg-[var(--ui-accentSoft)] text-[var(--ui-accent)]"
                            : "border border-[var(--ui-border)] text-[var(--ui-muted)] hover:bg-[var(--ui-panelAlt)]"
                        }`}
                      >
                        {item}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>

            {filtered.length > 0 ? (
              <>
                <div className="hidden grid-cols-[minmax(0,1.4fr)_180px_150px_120px] gap-4 border-b border-[var(--ui-border)] bg-[var(--ui-panelAlt)] px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ui-muted)] md:grid">
                  <div>Project</div>
                  <div>Timeline</div>
                  <div className="text-right">Health</div>
                  <div className="text-center">Status</div>
                </div>

                <div className="divide-y divide-[var(--ui-border)]">
                  {filtered.map((project) => {
                    const health = getHealthState(project);
                    const timeline = getTimelineState(project);
                    const isClosed = isClosedStatus(project.status);

                    return (
                      <div
                        key={project.id}
                        className="group relative border-l-4 px-4 py-4 transition hover:bg-[var(--ui-panelAlt)]"
                        style={{ borderLeftColor: project.colour || "var(--ui-accent)" }}
                      >
                        <div className="grid gap-4 md:grid-cols-[minmax(0,1.4fr)_180px_150px_120px] md:items-center">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                href={`/projects/${project.id}`}
                                className="truncate text-base font-semibold tracking-tight text-[var(--ui-text)] hover:underline"
                              >
                                {project.title}
                              </Link>
                              {project.project_code ? (
                                <span className="rounded-full bg-[var(--ui-panelAlt)] px-2.5 py-1 text-[11px] font-medium text-[var(--ui-muted)]">
                                  {project.project_code}
                                </span>
                              ) : null}
                            </div>

                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--ui-muted)]">
                              <span>{project.pm_name?.trim() || "Unassigned"}</span>
                              <span className="hidden sm:inline">•</span>
                              <span>{formatDate(project.created_at, "long") || "—"}</span>
                              {roleMap[project.id] ? (
                                <>
                                  <span className="hidden sm:inline">•</span>
                                  <span className="capitalize">{String(roleMap[project.id])}</span>
                                </>
                              ) : null}
                            </div>

                            <div className="mt-3 flex flex-wrap gap-2 md:hidden">
                              <InlineInfo
                                label="Start"
                                value={formatDate(project.start_date, "short") || "—"}
                              />
                              <InlineInfo
                                label="Finish"
                                value={formatDate(project.finish_date, "short") || "—"}
                              />
                              <InlineInfo label="Timeline" value={timeline.label || "—"} />
                              <InlineInfo
                                label="Health"
                                value={
                                  health.health != null
                                    ? `${health.health}%`
                                    : health.rag
                                      ? ragLabel(health.rag)
                                      : "—"
                                }
                              />
                            </div>
                          </div>

                          <div className="hidden md:block">
                            <div className="flex justify-between text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--ui-muted)]">
                              <span>{formatDate(project.start_date, "short") || "—"}</span>
                              <span>{formatDate(project.finish_date, "short") || "—"}</span>
                            </div>
                            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--ui-border)]">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${timeline.progress}%`,
                                  background: timeline.fillColor,
                                }}
                              />
                            </div>
                            <div
                              className={`mt-2 text-right text-xs font-medium ${
                                timeline.tone === "danger"
                                  ? "text-[var(--ui-danger)]"
                                  : timeline.tone === "warning"
                                    ? "text-[var(--ui-warning)]"
                                    : timeline.tone === "neutral"
                                      ? "text-[var(--ui-muted)]"
                                      : "text-[var(--ui-text)]"
                              }`}
                            >
                              {timeline.label || "—"}
                            </div>
                          </div>

                          <div className="hidden justify-end md:flex">
                            {health.health != null ? (
                              <div className="flex items-center gap-2">
                                {health.rag ? <RagBadge rag={health.rag} /> : null}
                                <span
                                  className={`text-sm font-semibold ${
                                    health.tone === "good"
                                      ? "text-[var(--ui-success)]"
                                      : health.tone === "warning"
                                        ? "text-[var(--ui-warning)]"
                                        : health.tone === "danger"
                                          ? "text-[var(--ui-danger)]"
                                          : "text-[var(--ui-muted)]"
                                  }`}
                                >
                                  {health.health}%
                                </span>
                              </div>
                            ) : health.rag ? (
                              <RagBadge rag={health.rag} />
                            ) : (
                              <span className="text-sm text-[var(--ui-muted)]">—</span>
                            )}
                          </div>

                          <div className="hidden items-center justify-center md:flex">
                            <span
                              className={`inline-flex rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${getStatusClassName(
                                project,
                              )}`}
                            >
                              {getStatusLabel(project)}
                            </span>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap gap-2">
                          <Link
                            href={`/projects/${project.id}`}
                            className="inline-flex items-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--ui-panelAlt)]"
                          >
                            Overview
                          </Link>
                          <Link
                            href={`/projects/${project.id}/artifacts`}
                            className="inline-flex items-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--ui-panelAlt)]"
                          >
                            Artifacts
                          </Link>
                          <Link
                            href={`/projects/${project.id}/members`}
                            className="inline-flex items-center rounded-xl border border-[var(--ui-border)] bg-[var(--ui-panel)] px-3 py-2 text-sm font-medium transition hover:bg-[var(--ui-panelAlt)]"
                          >
                            Members
                          </Link>

                          <form action={setProjectStatus}>
                            <input type="hidden" name="project_id" value={project.id} />
                            <input
                              type="hidden"
                              name="status"
                              value={isClosed ? "active" : "closed"}
                            />
                            <input type="hidden" name="next" value="/projects" />
                            <button
                              type="submit"
                              className={`inline-flex items-center rounded-xl border px-3 py-2 text-sm font-medium transition ${
                                isClosed
                                  ? "border-[var(--ui-border)] bg-[var(--ui-panel)] hover:bg-[var(--ui-panelAlt)]"
                                  : "border-[var(--ui-warning)]/20 bg-[var(--ui-warningSoft)] text-[var(--ui-warning)] hover:opacity-90"
                              }`}
                            >
                              {isClosed ? "Reopen" : "Close"}
                            </button>
                          </form>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="px-4 py-16 text-center">
                <div className="mx-auto max-w-xl">
                  <h3 className="text-2xl font-semibold tracking-tight text-[var(--ui-text)]">
                    {projects.length === 0 ? "No projects yet." : "Nothing matches your filters."}
                  </h3>
                  <p className="mt-3 text-sm leading-6 text-[var(--ui-muted)]">
                    {projects.length === 0
                      ? "Create your first project to get started."
                      : "Try adjusting the search term, filter, or sort order."}
                  </p>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between border-t border-[var(--ui-border)] px-4 py-3 text-xs font-medium uppercase tracking-[0.14em] text-[var(--ui-muted)]">
              <span>
                {filtered.length} project{filtered.length !== 1 ? "s" : ""}
              </span>
              <span>{todayLabel}</span>
            </div>
          </section>
        </main>

        <style>{`
          .statusActive {
            background: var(--ui-successSoft);
            color: var(--ui-success);
          }

          .statusClosed {
            background: var(--ui-panelAlt);
            color: var(--ui-muted);
            border-color: var(--ui-border);
          }

          .statusPipeline {
            background: var(--ui-accentSoft);
            color: var(--ui-accent);
          }
        `}</style>
      </div>
    </>
  );
}

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string | number;
  tone?: "default" | "neutral" | "danger" | "good" | "warning";
}) {
  const toneClass =
    tone === "danger"
      ? "bg-[var(--ui-dangerSoft)] text-[var(--ui-danger)]"
      : tone === "good"
        ? "bg-[var(--ui-successSoft)] text-[var(--ui-success)]"
        : tone === "warning"
          ? "bg-[var(--ui-warningSoft)] text-[var(--ui-warning)]"
          : tone === "neutral"
            ? "bg-[var(--ui-panelAlt)] text-[var(--ui-muted)]"
            : "bg-[var(--ui-panelAlt)] text-[var(--ui-text)]";

  return (
    <div className={`rounded-2xl px-4 py-3 ${toneClass}`}>
      <div className="text-2xl font-semibold tracking-tight">{value}</div>
      <div className="mt-1 text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">
        {label}
      </div>
    </div>
  );
}

function RagBadge({ rag }: { rag: Exclude<Rag, null> }) {
  const cls =
    rag === "G"
      ? "bg-[var(--ui-successSoft)] text-[var(--ui-success)]"
      : rag === "A"
        ? "bg-[var(--ui-warningSoft)] text-[var(--ui-warning)]"
        : "bg-[var(--ui-dangerSoft)] text-[var(--ui-danger)]";

  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${cls}`}>
      {ragLabel(rag)}
    </span>
  );
}

function InlineInfo({ label, value }: { label: string; value: string }) {
  return (
    <span className="rounded-full bg-[var(--ui-panelAlt)] px-2.5 py-1 text-[11px] font-medium text-[var(--ui-muted)]">
      {label}: {value}
    </span>
  );
}