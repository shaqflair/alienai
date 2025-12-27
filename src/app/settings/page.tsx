// src/app/settings/page.tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { createOrganisation, inviteToOrganisation, renameOrganisation } from "@/app/actions/org-admin";

type Role = "owner" | "editor" | "viewer";
type OrgRow = {
  org_id: string;
  role: Role;
  organizations: { id: string; name: string } | null;
};

function roleBadge(role: Role) {
  if (role === "owner") return { label: "Owner", cls: "bg-gray-50 border-gray-200" };
  if (role === "editor") return { label: "Editor", cls: "bg-blue-50 border-blue-200" };
  return { label: "Viewer", cls: "bg-yellow-50 border-yellow-200" };
}

export default async function SettingsPage() {
  const supabase = await createClient();

  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!user) redirect("/login");

  const activeOrgId = await getActiveOrgId();

  const { data, error: memErr } = await supabase
    .from("org_members")
    .select(
      `
      org_id,
      role,
      organizations:organizations (
        id,
        name
      )
    `
    )
    .eq("user_id", user.id);

  if (memErr) throw memErr;

  const memberships = ((data ?? []) as OrgRow[])
    .map((r) => {
      if (!r.organizations) return null;
      return { orgId: r.organizations.id, orgName: r.organizations.name, role: r.role };
    })
    .filter(Boolean) as Array<{ orgId: string; orgName: string; role: Role }>;

  const active = memberships.find((m) => m.orgId === activeOrgId) ?? memberships[0] ?? null;
  const myRole = active?.role ?? null;
  const isOwner = myRole === "owner";

  // ---------------------------
  // Inline Server Actions
  // ---------------------------
  async function setActiveOrgAction(formData: FormData) {
    "use server";
    const orgId = String(formData.get("org_id") ?? "").trim();
    if (!orgId) return;

    // Light validation: ensure the user is a member of this org
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) redirect("/login");

    const { data: member, error } = await supabase
      .from("org_members")
      .select("org_id")
      .eq("user_id", user.id)
      .eq("org_id", orgId)
      .maybeSingle();

    if (error) throw error;
    if (!member) throw new Error("You are not a member of that organisation.");

    // Persist selection (cookie). Your getActiveOrgId() should read this; if it already does, this will work immediately.
    cookies().set("active_org_id", orgId, {
      path: "/",
      sameSite: "lax",
      httpOnly: true,
      secure: true,
    });

    revalidatePath("/settings");
    redirect("/settings");
  }

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* Your orgs + switcher */}
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
                    <form action={setActiveOrgAction}>
                      <input type="hidden" name="org_id" value={m.orgId} />
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

        <div className="text-xs opacity-60">
          Owner-only settings appear only if your role is Owner for the active organisation.
        </div>
      </section>

      {/* Active org + role */}
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
        <div className="text-xs opacity-60">
          If you can’t see the right org here, switch it in “Your organisations” above.
        </div>
      </section>

      {/* Owner-only org management */}
      <section className="rounded-lg border bg-white p-5 space-y-5">
        <h2 className="text-lg font-medium">Organisation management</h2>

        {!active ? (
          <div className="text-sm text-gray-700">Select an active organisation first.</div>
        ) : !isOwner ? (
          <div className="text-sm text-gray-700">You don’t have Owner access for the active organisation.</div>
        ) : (
          <>
            {/* Create org */}
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
              <div className="text-xs opacity-60">
                After creating, switch active org in “Your organisations”.
              </div>
            </form>

            {/* Rename active org */}
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

            {/* Invite */}
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
                <select name="role" defaultValue="viewer" className="rounded-md border px-3 py-2 text-sm">
                  <option value="viewer">Viewer</option>
                  <option value="editor">Editor</option>
                  <option value="owner">Owner</option>
                </select>
                <button className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50" type="submit">
                  Invite
                </button>
              </div>

              <div className="text-xs opacity-60">
                This creates a pending invite record. Email sending can be added next.
              </div>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
