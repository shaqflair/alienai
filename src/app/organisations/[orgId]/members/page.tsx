// src/app/organisations/[orgId]/members/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import OrgMembersClient from "@/components/org/OrgMembersClient";

function safeParam(x: unknown) {
  return typeof x === "string" ? x : "";
}

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ orgId?: string }>;
}) {
  const p = await params;
  const organisationId = safeParam(p?.orgId);
  if (!organisationId) return notFound();

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) redirect("/login");

  // my membership
  const { data: me } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", organisationId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  // not a member => truly not found
  if (!me) return notFound();

  const myRole = (me.role as "admin" | "member") ?? "member";

  // load org (if blocked by RLS, don't pretend it doesn't exist)
  const { data: org, error: orgErr } = await sb
    .from("organisations")
    .select("id,name")
    .eq("id", organisationId)
    .maybeSingle();

  if (!org) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4 text-gray-900">
        <h1 className="text-xl font-semibold">Organisation members</h1>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Access denied to organisation details (RLS).
          <div className="mt-2 text-xs opacity-70">{orgErr?.message ?? "organisations select returned null"}</div>
        </div>
        <Link
          href="/organisations"
          className="inline-flex rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Back
        </Link>
      </div>
    );
  }

  // Admin-only: Members list
  const members =
    myRole === "admin"
      ? (
          await sb
            .from("organisation_members")
            .select("user_id,role,created_at")
            .eq("organisation_id", organisationId)
            .order("created_at", { ascending: true })
        ).data ?? []
      : [];

  // Admin-only: enrich names/emails from profiles
  const membersUi =
    myRole === "admin"
      ? await (async () => {
          const userIds = (members ?? []).map((m: any) => m.user_id).filter(Boolean);
          const profilesById = new Map<string, any>();

          if (userIds.length) {
            const { data: profs } = await sb
              .from("profiles")
              .select("user_id,full_name,email")
              .in("user_id", userIds);

            (profs ?? []).forEach((pp: any) => profilesById.set(pp.user_id, pp));
          }

          return (members ?? []).map((m: any) => {
            const prof = profilesById.get(m.user_id);
            return {
              user_id: m.user_id,
              role: m.role,
              full_name: prof?.full_name ?? null,
              email: prof?.email ?? null,
            };
          });
        })()
      : [];

  // Admin-only: invites
  const invites =
    myRole === "admin"
      ? (
          await sb
            .from("organisation_invites")
            .select("id,email,role,status,created_at,token")
            .eq("organisation_id", organisationId)
            .order("created_at", { ascending: false })
        ).data ?? []
      : [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4 text-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Organisation members</h1>
          <p className="text-sm text-gray-600">
            Org: <span className="font-medium">{org.name}</span>
            <span className="ml-2 text-xs text-gray-500">• Your role: {myRole}</span>
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/organisations/${organisationId}/settings`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Settings
          </Link>
          <Link href="/organisations" className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50">
            Back
          </Link>
        </div>
      </div>

      <OrgMembersClient
        organisationId={organisationId}
        myRole={myRole}
        members={membersUi}
        invites={invites as any}
      />
    </div>
  );
}
