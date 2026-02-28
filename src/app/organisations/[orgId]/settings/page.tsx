// src/app/organisations/[orgId]/settings/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

// approvals admin panel (client component)
import OrgApprovalsAdminPanel from "@/components/approvals/OrgApprovalsAdminPanel";
import { isPlatformAdmin } from "@/lib/server/isPlatformAdmin";
import RateCardTab from "@/components/settings/RateCardTab";
import {
  getOrgMembersForPicker,
  getResourceRatesForOrg,
} from "@/app/actions/resource-rates";

type OrgRole = "owner" | "admin" | "member";

function safeParam(x: unknown) {
  return typeof x === "string" ? x : "";
}
function safeSearchParam(x: unknown) {
  return typeof x === "string" ? x : "";
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}
function normRole(x: unknown): OrgRole {
  const r = String(x || "").toLowerCase();
  return r === "owner" || r === "admin" || r === "member" ? (r as OrgRole) : "member";
}

async function requireOrgAdmin(sb: any, organisationId: string, userId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw error;

  const role = data?.role ? normRole(data.role) : null;
  const ok = role === "admin" || role === "owner";
  return { ok, role };
}

function tabBtn(active: boolean) {
  return `px-3 py-1.5 text-sm ${active ? "bg-gray-100 font-semibold" : "bg-white hover:bg-gray-50"}`;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

async function rpcWithFallback<T = any>(
  sb: any,
  fn: string,
  argsPrimary: Record<string, any>,
  argsFallback?: Record<string, any>
): Promise<{ data: T | null; error: any | null; used: "primary" | "fallback" }> {
  const a = await sb.rpc(fn, argsPrimary);
  if (!a?.error) return { data: a.data ?? null, error: null, used: "primary" };

  if (!argsFallback) return { data: a.data ?? null, error: a.error, used: "primary" };

  const msg = String(a.error?.message ?? a.error ?? "");
  const looksLikeSignature =
    msg.toLowerCase().includes("function") ||
    msg.toLowerCase().includes("argument") ||
    msg.toLowerCase().includes("parameter") ||
    msg.toLowerCase().includes("signature");

  if (!looksLikeSignature) return { data: a.data ?? null, error: a.error, used: "primary" };

  const b = await sb.rpc(fn, argsFallback);
  if (!b?.error) return { data: b.data ?? null, error: null, used: "fallback" };

  return { data: b.data ?? null, error: b.error, used: "fallback" };
}

export default async function OrgSettingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ orgId?: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const p = await params;
  const sp = (await searchParams) ?? {};

  const organisationId = safeParam(p?.orgId);
  if (!organisationId || !isUuid(organisationId)) return notFound();

  const tabRaw = safeSearchParam(sp?.tab).trim().toLowerCase();
  const tab: "settings" | "approvals" | "ratecards" =
    tabRaw === "approvals" ? "approvals" : tabRaw === "ratecards" ? "ratecards" : "settings";

  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const userId = auth.user.id;

  const { data: me, error: meErr } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (meErr) throw meErr;
  if (!me) return notFound();

  const myRole = normRole(me.role);
  const isOwner = myRole === "owner";

  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .select("id,name,created_at")
    .eq("id", organisationId)
    .maybeSingle();

  if (orgErr) throw orgErr;
  if (!org) return notFound();

  const { ok: isOrgAdmin } = await requireOrgAdmin(sb, organisationId, userId);

  const platformAdmin = await isPlatformAdmin();

  const { count: memberCount, error: countErr } = await sb
    .from("organisation_members")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId)
    .is("removed_at", null);

  if (countErr) {
    console.warn("[organisation_members.count] blocked:", countErr.message);
  }

  const { data: ownerRow } = await sb
    .from("organisation_members")
    .select("user_id, role")
    .eq("organisation_id", organisationId)
    .is("removed_at", null)
    .eq("role", "owner")
    .maybeSingle();

  const ownerUserId = safeParam(ownerRow?.user_id);

  const { data: memberRows } = await sb
    .from("organisation_members")
    .select("user_id, role")
    .eq("organisation_id", organisationId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  const memberUserIds = (memberRows ?? []).map((r: any) => safeParam(r.user_id)).filter(Boolean);

  const profilesById = new Map<string, any>();
  if (memberUserIds.length) {
    const { data: profs } = await sb
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", memberUserIds);

    (profs ?? []).forEach((pp: any) => profilesById.set(pp.user_id, pp));
  }

  const transferCandidates = (memberRows ?? [])
    .map((r: any) => {
      const uid = safeParam(r.user_id);
      if (!uid) return null;
      if (uid === ownerUserId) return null;
      const prof = profilesById.get(uid);
      return {
        user_id: uid,
        role: normRole(r.role),
        label: String(prof?.full_name || prof?.email || uid),
        email: prof?.email ?? null,
      };
    })
    .filter(Boolean) as Array<{ user_id: string; role: OrgRole; label: string; email: string | null }>;

  // Load rate card data when on that tab
  const [ratesResult, membersResult] = tab === "ratecards"
    ? await Promise.all([
        getResourceRatesForOrg(organisationId),
        getOrgMembersForPicker(organisationId),
      ])
    : [{ rates: [] }, { members: [] }];

  async function renameAction(formData: FormData) {
    "use server";

    const name = String(formData.get("name") ?? "").trim();
    if (!name) return;

    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) throw authErr;
    if (!auth?.user) redirect("/login");

    const check = await requireOrgAdmin(sb, organisationId, auth.user.id);
    if (!check.ok) throw new Error("Admin permission required");

    const { error } = await sb.from("organisations").update({ name }).eq("id", organisationId);
    if (error) throw error;

    redirect(`/organisations/${organisationId}/settings?tab=settings`);
  }

  async function deleteAction(formData: FormData) {
    "use server";

    const confirm = String(formData.get("confirm") ?? "").trim();
    if (confirm !== "DELETE") throw new Error('Type "DELETE" to confirm.');

    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) throw authErr;
    if (!auth?.user) redirect("/login");

    const check = await requireOrgAdmin(sb, organisationId, auth.user.id);
    if (!check.ok) throw new Error("Admin permission required");

    const { error } = await sb.from("organisations").delete().eq("id", organisationId);
    if (error) throw error;

    redirect("/organisations");
  }

  async function transferOwnershipAction(formData: FormData) {
    "use server";

    const newOwnerUserId = String(formData.get("new_owner_user_id") ?? "").trim();
    if (!newOwnerUserId || !isUuid(newOwnerUserId))
      throw new Error("Select a valid user to transfer ownership to.");

    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) throw authErr;
    if (!auth?.user) redirect("/login");

    const { data: me, error: meErr } = await sb
      .from("organisation_members")
      .select("role, removed_at")
      .eq("organisation_id", organisationId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (meErr) throw meErr;
    if (normRole(me?.role) !== "owner")
      throw new Error("Only the organisation owner can transfer ownership.");

    const res = await rpcWithFallback(
      sb,
      "transfer_org_ownership",
      { p_org_id: organisationId, p_new_owner_user_id: newOwnerUserId },
      { org_id: organisationId, new_owner_user_id: newOwnerUserId }
    );

    if (res.error) throw new Error(String(res.error.message ?? res.error));

    redirect(`/organisations/${organisationId}/settings?tab=settings&ownership=transferred`);
  }

  async function leaveOrganisationAction() {
    "use server";

    const sb = await createClient();
    const { data: auth, error: authErr } = await sb.auth.getUser();
    if (authErr) throw authErr;
    if (!auth?.user) redirect("/login");

    const { data: me, error: meErr } = await sb
      .from("organisation_members")
      .select("role, removed_at")
      .eq("organisation_id", organisationId)
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    if (meErr) throw meErr;
    if (normRole(me?.role) === "owner")
      throw new Error("The organisation owner cannot leave. Transfer ownership first.");

    const res = await rpcWithFallback(
      sb,
      "leave_organisation",
      { p_org_id: organisationId },
      { org_id: organisationId }
    );

    if (res.error) throw new Error(String(res.error.message ?? res.error));

    redirect(`/organisations?left=1`);
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 text-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Organisation settings</h1>
          <p className="text-sm text-gray-600">
            Org: <span className="font-medium">{org.name}</span>
            <span className="ml-2 text-xs text-gray-500">&bull; Your role: {myRole}</span>
            <span className="ml-2 text-xs text-gray-500">&bull; Members: {memberCount ?? "&mdash;"}</span>
            <span className="ml-2 text-xs text-gray-500">&bull; Platform admin: {platformAdmin ? "Yes" : "No"}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/organisations/${organisationId}/members`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Members
          </Link>
          <Link href="/organisations" className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
            Back
          </Link>
        </div>
      </div>

      {/* Tabs */}
      <div className="rounded-xl border bg-white overflow-hidden">
        <div className="border-b p-2 flex gap-2">
          <Link
            href={`/organisations/${organisationId}/settings?tab=settings`}
            className={tabBtn(tab === "settings")}
          >
            General
          </Link>
          <Link
            href={`/organisations/${organisationId}/settings?tab=approvals`}
            className={tabBtn(tab === "approvals")}
          >
            Approvals
          </Link>
          <Link
            href={`/organisations/${organisationId}/settings?tab=ratecards`}
            className={tabBtn(tab === "ratecards")}
          >
            Rate Cards
            {isOrgAdmin && (
              <span className="ml-1.5 text-xs bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full font-medium">
                Admin
              </span>
            )}
          </Link>
        </div>

        <div className="p-4">
          {tab === "approvals" ? (
            <OrgApprovalsAdminPanel
              organisationId={organisationId}
              organisationName={String(org.name ?? "")}
              isAdmin={!!platformAdmin}
            />
          ) : tab === "ratecards" ? (
            <RateCardTab
              organisationId={organisationId}
              rates={(ratesResult as any).rates ?? []}
              members={(membersResult as any).members ?? []}
            />
          ) : (
            <div className="space-y-6">
              {/* Governance panel */}
              <div className="rounded-xl border bg-white p-5 space-y-4">
                <div className="font-medium">Governance</div>

                <div className="text-sm text-gray-700">
                  <div>
                    <span className="text-gray-500">Current owner:</span>{" "}
                    <span className="font-medium">
                      {ownerUserId
                        ? String(
                            profilesById.get(ownerUserId)?.full_name ||
                            profilesById.get(ownerUserId)?.email ||
                            ownerUserId
                          )
                        : "&mdash;"}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Single-owner mode: the owner cannot be removed or leave until ownership is transferred.
                  </div>
                </div>

                {isOwner ? (
                  <div className="rounded-lg border p-4 space-y-3">
                    <div className="text-sm font-medium">Transfer ownership</div>
                    <div className="text-xs text-gray-500">
                      Transfers the <b>owner</b> role to another member. You will become an{" "}
                      <b>admin</b> (or member depending on your RPC rules).
                    </div>

                    {transferCandidates.length === 0 ? (
                      <div className="text-sm text-gray-600">
                        No eligible members to transfer to. Invite someone first.
                      </div>
                    ) : (
                      <form action={transferOwnershipAction} className="flex flex-wrap items-end gap-2">
                        <div className="space-y-1">
                          <div className="text-xs text-gray-500">New owner</div>
                          <select
                            name="new_owner_user_id"
                            className="min-w-[260px] rounded-md border px-3 py-2 text-sm bg-white"
                            required
                          >
                            <option value="">Select member&hellip;</option>
                            {transferCandidates.map((m) => (
                              <option key={m.user_id} value={m.user_id}>
                                {m.label}{m.email ? ` (${m.email})` : ""}
                              </option>
                            ))}
                          </select>
                        </div>

                        <button className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50" type="submit">
                          Transfer
                        </button>
                      </form>
                    )}
                  </div>
                ) : (
                  <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
                    Only the <b>owner</b> can transfer ownership.
                  </div>
                )}

                {!isOwner ? (
                  <form action={leaveOrganisationAction}>
                    <button
                      className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
                      type="submit"
                    >
                      Leave organisation
                    </button>
                    <div className="mt-1 text-xs text-gray-500">
                      This will remove your membership (soft remove if your RPC uses removed_at).
                    </div>
                  </form>
                ) : (
                  <div className="rounded-lg border bg-gray-50 p-3 text-sm text-gray-700">
                    The <b>owner</b> cannot leave. Transfer ownership first.
                  </div>
                )}
              </div>

              {/* Rename */}
              <div className="rounded-xl border bg-white p-5 space-y-3">
                <div className="font-medium">Rename organisation</div>
                <div className="text-sm text-gray-600">
                  Update the organisation name shown in the header dropdown.
                </div>

                {isOrgAdmin ? (
                  <form action={renameAction} className="flex flex-wrap gap-2">
                    <input
                      name="name"
                      defaultValue={String(org.name ?? "")}
                      className="flex-1 min-w-[240px] rounded-md border px-3 py-2 text-sm text-gray-900 bg-white"
                      placeholder="Organisation name&hellip;"
                      required
                    />
                    <button className="rounded-md bg-black text-white px-4 py-2 text-sm">Save</button>
                  </form>
                ) : (
                  <div className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
                    Only <b>owners/admins</b> can rename the organisation.
                  </div>
                )}
              </div>

              {/* Danger zone */}
              <div className="rounded-xl border border-red-200 bg-white p-5 space-y-3">
                <div className="font-medium text-red-700">Danger zone</div>
                <div className="text-sm text-gray-700">
                  Deleting an organisation permanently removes the org and its memberships. Projects may
                  also be affected if they are linked via{" "}
                  <code className="text-xs">organisation_id</code>.
                </div>

                {isOrgAdmin ? (
                  <form action={deleteAction} className="space-y-3">
                    <div className="text-sm">
                      Type <code className="text-xs">DELETE</code> to confirm:
                    </div>
                    <input
                      name="confirm"
                      className="w-[220px] rounded-md border px-3 py-2 text-sm text-gray-900 bg-white"
                      placeholder='Type "DELETE"'
                      required
                    />
                    <button className="rounded-md border border-red-300 px-4 py-2 text-sm hover:bg-red-50 text-red-700">
                      Delete organisation
                    </button>
                  </form>
                ) : (
                  <div className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
                    Only <b>owners/admins</b> can delete the organisation.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
