// src/app/settings/page.tsx
import "server-only";

import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import { createOrganisation } from "@/app/actions/org-admin";

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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
    .eq("user_id", user.id)
    .is("removed_at", null);

  if (memErr) throw new Error(sbErrText(memErr));

  const memberships = ((data ?? []) as unknown as OrgRow[])
    .map((r) => {
      if (!r.organisations?.id) return null;
      return {
        orgId:   r.organisations.id,
        orgName: r.organisations.name,
        role:    normalizeRole(r.role),
      };
    })
    .filter(Boolean) as Array<{ orgId: string; orgName: string; role: Role }>;

  const active  = memberships.find((m) => m.orgId === activeOrgId) ?? memberships[0] ?? null;
  const myRole  = active?.role ?? null;
  const isAdmin = myRole === "admin" || myRole === "owner";

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      {/* ── Your organisations ── */}
      <section className="rounded-lg border bg-white p-5 space-y-3">
        <div className="text-sm font-medium">Your organisations</div>

        {memberships.length === 0 ? (
          <div className="text-sm text-gray-700">
            You are not a member of any organisation yet.
          </div>
        ) : (
          <div className="space-y-2">
            {memberships.map((m) => {
              const isActive      = active?.orgId === m.orgId;
              const badge         = roleBadge(m.role);
              const memberIsAdmin = m.role === "admin" || m.role === "owner";

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
                      <span className={`text-xs rounded border px-2 py-0.5 ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {isActive ? (
                        <span className="text-xs rounded border px-2 py-0.5 bg-green-50 border-green-200 text-green-800">
                          Active
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs opacity-60 font-mono">org_id: {m.orgId}</div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {!isActive ? (
                      <form method="post" action="/api/active-org">
                        <input type="hidden" name="org_id"  value={m.orgId} />
                        <input type="hidden" name="next"    value="/settings" />
                        <button
                          className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
                          type="submit"
                        >
                          Set active
                        </button>
                      </form>
                    ) : null}

                    <Link
                      href={`/organisations/${m.orgId}/members`}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Members
                    </Link>

                    <Link
                      href={`/organisations/${m.orgId}/settings?tab=settings`}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      Settings
                    </Link>

                    <Link
                      href={`/organisations/${m.orgId}/settings?tab=approvals`}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
                      title="Configure organisation approvals"
                    >
                      Approvals
                    </Link>

                    {/*
                      Rate Cards — visible to all members so they can see rates,
                      but only admins/owners can create or edit entries (enforced
                      by RLS on the resource_rates table and by RateCardTab itself).
                    */}
                    <Link
                      href={`/organisations/${m.orgId}/settings/rate-cards`}
                      className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 inline-flex items-center gap-1.5"
                      title="View and manage resource rate cards used in Financial Plans"
                    >
                      Rate Cards
                      {memberIsAdmin && (
                        <span className="text-[10px] rounded px-1.5 py-0.5 bg-blue-100 text-blue-700 font-semibold leading-none">
                          Admin
                        </span>
                      )}
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="text-xs opacity-60">
          Governance actions (transfer ownership / leave org) live in{" "}
          <b>Organisation settings</b>.
        </div>
      </section>

      {/* ── Active organisation ── */}
      <section className="rounded-lg border bg-white p-5 space-y-3">
        <div className="text-sm font-medium">Active organisation</div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="text-sm">{active?.orgName ?? "No organisation selected"}</div>
          {myRole ? (
            <span className={`text-xs rounded border px-2 py-0.5 ${roleBadge(myRole).cls}`}>
              {roleBadge(myRole).label}
            </span>
          ) : null}
        </div>

        {active ? (
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              href={`/organisations/${active.orgId}/members`}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Members
            </Link>

            <Link
              href={`/organisations/${active.orgId}/settings?tab=settings`}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Organisation settings
            </Link>

            <Link
              href={`/organisations/${active.orgId}/settings?tab=approvals`}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Approvals
            </Link>

            <Link
              href={`/organisations/${active.orgId}/settings/rate-cards`}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50 inline-flex items-center gap-1.5"
              title="View and manage resource rate cards used in Financial Plans"
            >
              Rate Cards
              {isAdmin && (
                <span className="text-[10px] rounded px-1.5 py-0.5 bg-blue-100 text-blue-700 font-semibold leading-none">
                  Admin
                </span>
              )}
            </Link>
          </div>
        ) : null}
      </section>

      {/* ── Create organisation ── */}
      {/* Creating an org should not depend on being admin/owner of an active org */}
      <section className="rounded-lg border bg-white p-5 space-y-4">
        <h2 className="text-lg font-medium">Create organisation</h2>

        <form action={createOrganisation} className="space-y-2">
          <div className="text-sm font-medium">New organisation</div>
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

        <div className="text-xs opacity-60">
          After creating, use the org's <b>Settings</b> page for governance and membership
          management.
        </div>
      </section>
    </main>
  );
}