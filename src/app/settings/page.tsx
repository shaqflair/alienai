// src/app/settings/page.tsx
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { createOrganisation, inviteToOrganisation, renameOrganisation } from "@/app/actions/org-admin";

type Role = "owner" | "admin" | "member";

type OrgRow = {
  organisation_id: string;
  role: string;
  organisations: { id: string; name: string } | null;
};

function sbErrText(e: any) {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  if (typeof e?.message === "string") return e.message;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function normalizeRole(x: any): Role {
  const v = String(x || "").trim().toLowerCase();
  if (v === "owner") return "owner";
  if (v === "admin") return "admin";
  return "member";
}

function roleBadge(role: Role) {
  if (role === "owner") return { label: "Owner", cls: "bg-gray-50 border-gray-200" };
  if (role === "admin") return { label: "Admin", cls: "bg-blue-50 border-blue-200" };
  return { label: "Member", cls: "bg-yellow-50 border-yellow-200" };
}

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();

  if (authErr) throw new Error(sbErrText(authErr));
  if (!user) redirect("/login");

  const activeOrgId = await getActiveOrgId();

  const { data, error: memErr } = await supabase
    .from("organisation_members")
    .select(
      `
      organisation_id,
      role,
      organisations:organisations (
        id,
        name
      )
    `
    )
    .eq("user_id", user.id);

  if (memErr) throw new Error(sbErrText(memErr));

  const memberships = ((data ?? []) as OrgRow[])
    .map((r) => {
      if (!r.organisations) return null;
      return {
        orgId: r.organisations.id,
        orgName: r.organisations.name,
        role: normalizeRole(r.role),
      };
    })
    .filter(Boolean) as Array<{ orgId: string; orgName: string; role: Role }>;

  const active = memberships.find((m) => m.orgId === activeOrgId) ?? memberships[0] ?? null;
  const myRole = active?.role ?? null;
  const isOwnerOrAdmin = myRole === "owner" || myRole === "admin";

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="rounded-lg border bg-white p-5 space-y-3">
        <div className="text-sm font-medium">Your organisations</div>

        {memberships.length === 0 ? (
          <div className="text-sm text-gray-700">You are not a member of any organisation yet.</div>
        ) : (
          <div className="space-y-2">
            {memberships.map((m) => {
              const isActive = active?.orgId === m.orgId;
              const badge = roleBadge(m.role);

              return (
                <div
                  key={m.orgId}
                  className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 ${
                    isActive ? "bg-gray-50 border-gray-300" : "bg-white"
                  }`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-medium truncate">{m.orgName}</div>
                      <span className={`text-xs rounded border px-2 py-0.5 ${badge.cls}`}>{badge.label}</span>
                      {isActive ? (
                        <span className="text-xs rounded border px-2 py-0.5 bg-green-50 border-green-200 text-green-800">
                          Active
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs opacity-60 font-mono">org_id: {m.orgId}</div>
                  </div>

                  {!isActive ? (
                    <form method="post" action="/api/active-org">
                      <input type="hidden" name="org_id" value={m.orgId} />
                      <input type="hidden" name="next" value="/settings" />
                      <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" type="submit">
                        Set active
                      </button>
                    </form>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        <div className="text-xs opacity-60">Admin/Owner settings appear only if you have access on the active org.</div>
      </section>

      <section className="rounded-lg border bg-white p-5 space-y-3">
        <div className="text-sm font-medium">Active organisation</div>
        <div className="flex items-center gap-2">
          <div className="text-sm">{active?.orgName ?? "No organisation selected"}</div>
          {myRole ? (
            <span className={`text-xs rounded border px-2 py-0.5 ${roleBadge(myRole).cls}`}>
              {roleBadge(myRole).label}
            </span>
          ) : null}
        </div>
      </section>

      <section className="rounded-lg border bg-white p-5 space-y-5">
        <h2 className="text-lg font-medium">Organisation management</h2>

        {!active ? (
          <div className="text-sm text-gray-700">Select an active organisation first.</div>
        ) : !isOwnerOrAdmin ? (
          <div className="text-sm text-gray-700">You don’t have Admin/Owner access for the active organisation.</div>
        ) : (
          <>
            <form action={createOrganisation} className="space-y-2">
              <div className="text-sm font-medium">Create new organisation</div>
              <div className="flex gap-2">
                <input
                  name="name"
                  placeholder="e.g. Vodafone UK"
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                  required
                />
                <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" type="submit">
                  Create
                </button>
              </div>
            </form>

            <form action={renameOrganisation} className="space-y-2">
              <div className="text-sm font-medium">Rename active organisation</div>
              <input type="hidden" name="org_id" value={active.orgId} />
              <div className="flex gap-2">
                <input
                  name="name"
                  defaultValue={active.orgName}
                  className="flex-1 rounded-md border px-3 py-2 text-sm"
                  required
                />
                <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" type="submit">
                  Save
                </button>
              </div>
            </form>

            <form action={inviteToOrganisation} className="space-y-2">
              <div className="text-sm font-medium">Invite member</div>
              <input type="hidden" name="org_id" value={active.orgId} />
              <div className="grid gap-2 sm:grid-cols-[1fr_160px_120px]">
                <input
                  name="email"
                  type="email"
                  placeholder="person@company.com"
                  className="rounded-md border px-3 py-2 text-sm"
                  required
                />
                <select name="role" defaultValue="member" className="rounded-md border px-3 py-2 text-sm">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </select>
                <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" type="submit">
                  Invite
                </button>
              </div>
              <div className="text-xs opacity-60">Invites are currently disabled in code; this will error until enabled.</div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
