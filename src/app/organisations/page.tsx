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

  const items =
    (data ?? [])
      .map((r: any) =>
        r.organisations?.id ? { id: r.organisations.id, name: r.organisations.name, role: r.role } : null
      )
      .filter(Boolean) as Array<{ id: string; name: string; role: "admin" | "member" }>;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Organisations</h1>
        <Link href="/projects" className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
          Back to Projects
        </Link>
      </div>

      <form action={createOrganisation} className="flex gap-2">
        <input
          name="name"
          className="flex-1 rounded-md border px-3 py-2 text-sm"
          placeholder="Organisation name…"
          required
        />
        <button className="rounded-md bg-black text-white px-4 py-2 text-sm">Create</button>
      </form>

      <div className="rounded-xl border bg-white">
        <div className="p-3 border-b text-xs text-gray-600">Your orgs</div>
        <div className="p-3 grid gap-2">
          {items.length === 0 ? <div className="text-sm text-gray-600">No organisations yet.</div> : null}

          {items.map((o) => (
            <div key={o.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div>
                <div className="font-medium">{o.name}</div>
                <div className="text-xs text-gray-600">Role: {o.role}</div>
              </div>

              <div className="flex gap-2">
                <Link
                  href={`/organisations/${o.id}/members`}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Members
                </Link>

                <Link
                  href={`/organisations/${o.id}/settings`}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
                >
                  Settings
                </Link>

                {/* ✅ Org-level approvals (Approvers / Groups / Rules) */}
                <Link
                  href={`/organisations/${o.id}/approvals`}
                  className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
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
