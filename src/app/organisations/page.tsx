import "server-only";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createOrganisation } from "./actions";

export default async function OrganisationsPage() {
  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const { data, error } = await sb
    .from("organisation_members")
    .select("role, organisations:organisations ( id, name )")
    .eq("user_id", auth.user.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(error.message);

  const items = (data ?? [])
    .map((r: any) =>
      r.organisations?.id
        ? { id: r.organisations.id, name: r.organisations.name, role: r.role }
        : null
    )
    .filter(Boolean) as Array<{ id: string; name: string; role: "admin" | "member" | "owner" }>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Organisations</h1>
        <Link
          href="/projects"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Back to Projects
        </Link>
      </div>

      {/* Create form */}
      <form action={createOrganisation} className="flex gap-2">
        <input
          name="name"
          className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
          placeholder="Organisation nameâ€¦"
          required
        />
        <button
          type="submit"
          className="rounded-md bg-gray-900 text-white px-4 py-2 text-sm font-medium hover:bg-gray-700 transition-colors"
        >
          Create
        </button>
      </form>

      {/* Org list */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
        <div className="p-3 border-b border-gray-200 text-xs font-medium text-gray-500 uppercase tracking-wide">
          Your orgs
        </div>
        <div className="p-3 grid gap-2">
          {items.length === 0 ? (
            <div className="text-sm text-gray-500 py-2">No organisations yet.</div>
          ) : null}

          {items.map((o) => (
            <div
              key={o.id}
              className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 hover:bg-white transition-colors"
            >
              <div>
                <div className="text-sm font-semibold text-gray-900">{o.name}</div>
                <div className="text-xs text-gray-500 mt-0.5 capitalize">Role: {o.role}</div>
              </div>

              <div className="flex gap-2">
                <Link
                  href={`/organisations/${o.id}/members`}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                >
                  Members
                </Link>
                <Link
                  href={`/organisations/${o.id}/settings`}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                >
                  Settings
                </Link>
                <Link
                  href={`/organisations/${o.id}/settings?tab=approvals`}
                  className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-700 font-medium hover:bg-gray-50 transition-colors"
                  title="Configure organisation approvers, groups, and rules"
                >
                  Approvals
                </Link>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
