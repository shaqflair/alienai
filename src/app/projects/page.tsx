// src/app/projects/page.tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createProject, updateProjectTitle } from "./actions";

type MemberProjectRow = {
  project_id: string;
  role: string | null;
  projects: {
    id: string;
    title: string;
    delivery_type: string;
    created_at: string;
  } | null;
};

function fmtDateIso(x: string) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(x);
  }
}

function fmtRole(role?: string | null) {
  const v = String(role ?? "").toLowerCase();
  if (v === "owner") return { label: "Owner", cls: "bg-gray-50 border-gray-200" };
  if (v === "editor") return { label: "Editor", cls: "bg-blue-50 border-blue-200" };
  if (v === "viewer") return { label: "Viewer", cls: "bg-yellow-50 border-yellow-200" };
  return { label: role ? String(role) : "Member", cls: "bg-gray-50 border-gray-200" };
}

function canEditProjectTitle(role?: string | null) {
  const v = String(role ?? "").toLowerCase();
  return v === "owner" || v === "editor";
}

export default async function ProjectsPage() {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-3 text-sm text-red-600">Auth error: {authErr.message}</p>
      </main>
    );
  }
  if (!auth?.user) redirect("/login");

  const userId = auth.user.id;

  /**
   * ✅ RLS-safe listing:
   * Start from project_members (membership boundary), then join projects via explicit FK name.
   * FK constraint: project_members_project_id_fkey
   */
  const { data, error } = await supabase
    .from("project_members")
    .select(
      `
      project_id,
      role,
      projects:projects!project_members_project_id_fkey (
        id,
        title,
        delivery_type,
        created_at
      )
    `
    )
    .eq("user_id", userId)
    .order("created_at", { foreignTable: "projects", ascending: false });

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-6">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <p className="mt-3 text-sm text-red-600">Error: {error.message}</p>
      </main>
    );
  }

  const rows = ((data ?? []) as MemberProjectRow[])
    .map((r) => {
      if (!r.projects) return null;
      return {
        id: r.projects.id,
        title: r.projects.title,
        delivery_type: r.projects.delivery_type,
        created_at: r.projects.created_at,
        myRole: r.role ?? "viewer",
      };
    })
    .filter(Boolean) as Array<{
    id: string;
    title: string;
    delivery_type: string;
    created_at: string;
    myRole: string;
  }>;

  return (
    <main className="mx-auto max-w-4xl p-6 space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">AlienAI Projects</h1>
        <p className="text-sm opacity-70">Create a project, then generate and approve artifacts.</p>
      </header>

      {/* Create project */}
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h2 className="text-lg font-medium">Create a project</h2>

        <form action={createProject} className="grid gap-4 max-w-lg">
          <label className="grid gap-2">
            <span className="text-sm font-medium">Project name</span>
            <input
              name="title"
              placeholder="e.g. SD-WAN"
              required
              className="rounded border border-gray-200 px-3 py-2"
            />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Delivery type</span>
            <select
              name="delivery_type"
              required
              className="rounded border border-gray-200 px-3 py-2"
              defaultValue=""
            >
              <option value="" disabled>
                Select…
              </option>
              <option value="SAP">SAP</option>
              <option value="SD-WAN">SD-WAN</option>
              <option value="Cloud">Cloud</option>
            </select>
          </label>

          <button
            type="submit"
            className="w-fit rounded border border-gray-200 px-4 py-2 hover:bg-gray-50 transition"
          >
            Create project
          </button>
        </form>

        <p className="text-xs opacity-60">
          Note: the creator will automatically be added as <b>owner</b> in{" "}
          <code>project_members</code>.
        </p>
      </section>

      {/* List */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Your projects</h2>

        {!rows.length ? (
          <div className="rounded-lg border border-gray-200 bg-white p-6">
            <p className="text-sm opacity-70">No projects yet.</p>
          </div>
        ) : (
          <div className="rounded-lg border border-gray-200 bg-white divide-y">
            {rows.map((p) => {
              const myRole = p.myRole;
              const roleChip = fmtRole(myRole);
              const canEdit = canEditProjectTitle(myRole);
              const isOwner = String(myRole ?? "").toLowerCase() === "owner";

              return (
                <div key={p.id} className="p-5 flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    {/* Title row */}
                    {canEdit ? (
                      <form action={updateProjectTitle} className="flex items-center gap-2">
                        <input type="hidden" name="project_id" value={p.id} />
                        <input
                          name="title"
                          defaultValue={p.title}
                          className="w-full rounded border border-gray-200 px-2 py-1 font-semibold"
                        />
                        <button
                          type="submit"
                          className="rounded border border-gray-200 px-3 py-1 text-sm hover:bg-gray-50 transition shrink-0"
                          title="Save project name"
                        >
                          Save
                        </button>
                      </form>
                    ) : (
                      <div className="font-semibold truncate">
                        <Link className="underline hover:opacity-80 transition" href={`/projects/${p.id}`}>
                          {p.title}
                        </Link>
                      </div>
                    )}

                    <div className="text-xs opacity-70 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center rounded border border-gray-200 bg-gray-50 px-2 py-0.5">
                        {p.delivery_type}
                      </span>
                      <span
                        className={`inline-flex items-center rounded border px-2 py-0.5 ${roleChip.cls}`}
                      >
                        {roleChip.label}
                      </span>
                      <span>• Created: {fmtDateIso(p.created_at)}</span>
                    </div>

                    {/* Quick links */}
                    <div className="flex flex-wrap items-center gap-3 text-sm">
                      <Link className="underline hover:opacity-80 transition" href={`/projects/${p.id}`}>
                        Open
                      </Link>
                      <Link className="underline hover:opacity-80 transition" href={`/projects/${p.id}/artifacts`}>
                        Artifacts
                      </Link>
                      <Link className="underline hover:opacity-80 transition" href={`/projects/${p.id}/members`}>
                        Members
                      </Link>
                      <Link className="underline hover:opacity-80 transition" href={`/projects/${p.id}/approvals`}>
                        Approvals
                      </Link>
                      {isOwner ? (
                        <Link className="underline hover:opacity-80 transition" href={`/projects/${p.id}/doa`}>
                          DOA (holiday cover)
                        </Link>
                      ) : null}
                    </div>
                  </div>

                  <Link className="text-sm underline hover:opacity-80 transition shrink-0" href={`/projects/${p.id}`}>
                    Open →
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
