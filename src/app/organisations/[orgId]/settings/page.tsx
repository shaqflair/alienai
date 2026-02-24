// src/app/organisations/[orgId]/settings/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

// ✅ approvals admin panel (client component)
import OrgApprovalsAdminPanel from "@/components/approvals/OrgApprovalsAdminPanel";
import { isPlatformAdmin } from "@/lib/server/isPlatformAdmin";

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

async function requireOrgAdmin(sb: any, organisationId: string, userId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return { ok: false, role: null as any };
  return { ok: String(data.role).toLowerCase() === "admin", role: data.role };
}

function tabBtn(active: boolean) {
  return `px-3 py-1.5 text-sm ${active ? "bg-gray-100 font-semibold" : "bg-white hover:bg-gray-50"}`;
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
  const tab: "settings" | "approvals" = tabRaw === "approvals" ? "approvals" : "settings";

  const sb = await createClient();
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const userId = auth.user.id;

  // Ensure the user is at least a member (avoid leaking org existence)
  const { data: me, error: meErr } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (meErr) throw meErr;
  if (!me) return notFound();

  // Load org (RLS may block if organisations select policy missing)
  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .select("id,name,created_at")
    .eq("id", organisationId)
    .maybeSingle();

  if (orgErr) {
    throw orgErr;
  }
  if (!org) return notFound();

  // Org admin check (rename/delete)
  const { ok: isOrgAdmin, role } = await requireOrgAdmin(sb, organisationId, userId);

  // Platform admin check (approvals editing)
  const platformAdmin = await isPlatformAdmin();

  // Count members (non-fatal if blocked)
  const { count: memberCount, error: countErr } = await sb
    .from("organisation_members")
    .select("id", { count: "exact", head: true })
    .eq("organisation_id", organisationId);

  if (countErr) {
    // eslint-disable-next-line no-console
    console.warn("[organisation_members.count] blocked:", countErr.message);
  }

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

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6 text-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Organisation settings</h1>
          <p className="text-sm text-gray-600">
            Org: <span className="font-medium">{org.name}</span>
            <span className="ml-2 text-xs text-gray-500">
              • Your role: {String(role ?? me.role ?? "member")}
            </span>
            <span className="ml-2 text-xs text-gray-500">• Members: {memberCount ?? "—"}</span>
            <span className="ml-2 text-xs text-gray-500">
              • Platform admin: {platformAdmin ? "Yes" : "No"}
            </span>
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
        </div>

        <div className="p-4">
          {tab === "approvals" ? (
            <OrgApprovalsAdminPanel
              organisationId={organisationId}
              organisationName={String(org.name ?? "")}
              // ✅ approvals editing is PLATFORM admin
              isAdmin={!!platformAdmin}
            />
          ) : (
            <div className="space-y-6">
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
                      placeholder="Organisation name…"
                      required
                    />
                    <button className="rounded-md bg-black text-white px-4 py-2 text-sm">Save</button>
                  </form>
                ) : (
                  <div className="rounded border bg-gray-50 p-3 text-sm text-gray-700">
                    Only <b>admins</b> can rename the organisation.
                  </div>
                )}
              </div>

              {/* Danger zone */}
              <div className="rounded-xl border border-red-200 bg-white p-5 space-y-3">
                <div className="font-medium text-red-700">Danger zone</div>
                <div className="text-sm text-gray-700">
                  Deleting an organisation permanently removes the org and its memberships. Projects may also be
                  affected if they are linked via <code className="text-xs">organisation_id</code>.
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
                    Only <b>admins</b> can delete the organisation.
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