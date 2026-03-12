// src/app/organisations/[orgId]/members/page.tsx
import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import OrgMembersClient from "@/components/org/OrgMembersClient";

function safeParam(x: unknown) {
  return typeof x === "string" ? x : "";
}

function safeText(x: unknown) {
  return typeof x === "string" ? x.trim() : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

type OrgRole = "owner" | "admin" | "member";

type MemberDbRow = {
  user_id: string;
  role: string | null;
  created_at: string | null;
  removed_at: string | null;
};

type ProfileRow = {
  user_id: string;
  full_name: string | null;
  email: string | null;
  avatar_url?: string | null;
};

type InviteRow = {
  id: string;
  email: string | null;
  role: string | null;
  status: string | null;
  created_at: string | null;
  token: string | null;
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function OrgMembersPage({
  params,
}: {
  params: Promise<{ orgId?: string }>;
}) {
  const p = await params;
  const organisationId = safeParam(p?.orgId);

  if (!organisationId || !isUuid(organisationId)) return notFound();

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();

  if (!auth?.user) redirect("/login");

  // My membership (active only)
  const { data: me } = await sb
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (!me) return notFound();

  const myRole = (safeText(me.role).toLowerCase() as OrgRole) || "member";
  const canManage = myRole === "admin" || myRole === "owner";

  // Load org (if blocked by RLS, don't pretend it doesn't exist)
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
          <div className="mt-2 text-xs opacity-70">
            {orgErr?.message ?? "organisations select returned null"}
          </div>
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

  // Source of truth: active organisation_members
  const members: MemberDbRow[] = canManage
    ? (
        (
          await sb
            .from("organisation_members")
            .select("user_id,role,created_at,removed_at")
            .eq("organisation_id", organisationId)
            .is("removed_at", null)
            .order("created_at", { ascending: true })
        ).data ?? []
      )
    : [];

  // Load invites once so we can:
  // 1) render invite history
  // 2) use invite email as fallback when profile row is missing
  const invites: InviteRow[] = canManage
    ? (
        (
          await sb
            .from("organisation_invites")
            .select("id,email,role,status,created_at,token")
            .eq("organisation_id", organisationId)
            .order("created_at", { ascending: false })
        ).data ?? []
      )
    : [];

  // Left-join-safe enrichment:
  // - members table remains the source of truth
  // - profiles is optional
  // - invite email is fallback if profile doesn't exist yet
  const membersUi = canManage
    ? await (async () => {
        const userIds = members.map((m) => m.user_id).filter(Boolean);
        const profilesById = new Map<string, ProfileRow>();
        const inviteEmailsByLower = new Set(
          invites.map((i) => safeText(i.email).toLowerCase()).filter(Boolean)
        );

        if (userIds.length) {
          const { data: profs } = await sb
            .from("profiles")
            .select("user_id,full_name,email,avatar_url")
            .in("user_id", userIds);

          for (const prof of (profs ?? []) as ProfileRow[]) {
            if (safeText(prof.user_id)) {
              profilesById.set(prof.user_id, prof);
            }
          }
        }

        return members.map((m) => {
          const prof = profilesById.get(m.user_id);
          const profileEmail = safeText(prof?.email);
          const profileName = safeText(prof?.full_name);
          const avatarUrl =
            typeof prof?.avatar_url === "string" ? prof.avatar_url : null;

          // Try invite fallback by matching on email where possible.
          // In many accept flows the invited user may still be missing a profile row,
          // so we preserve the member row and fill what we can.
          const matchedInvite =
            profileEmail && inviteEmailsByLower.has(profileEmail.toLowerCase())
              ? invites.find(
                  (i) =>
                    safeText(i.email).toLowerCase() ===
                    profileEmail.toLowerCase()
                ) ?? null
              : null;

          const fallbackEmail = safeText(matchedInvite?.email);
          const displayEmail = profileEmail || fallbackEmail || "";
          const displayName = profileName || displayEmail || m.user_id;

          return {
            user_id: m.user_id,
            role: (safeText(m.role).toLowerCase() as OrgRole) || "member",
            full_name: displayName,
            email: displayEmail,
            avatar_url: avatarUrl,
            joined_at: m.created_at ?? null,
            created_at: m.created_at ?? null,
            removed_at: m.removed_at ?? null,
            isMe: m.user_id === auth.user.id,
          };
        });
      })()
    : [];

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4 text-gray-900">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Organisation members</h1>
          <p className="text-sm text-gray-600">
            Org: <span className="font-medium">{org.name}</span>
            <span className="ml-2 text-xs text-gray-500">
              • Your role: {myRole}
            </span>
          </p>
        </div>

        <div className="flex gap-2">
          <Link
            href={`/organisations/${organisationId}/settings?tab=settings`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Settings
          </Link>
          <Link
            href="/organisations"
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Back
          </Link>
        </div>
      </div>

      <OrgMembersClient
        organisationId={organisationId}
        myRole={myRole}
        members={membersUi as any}
        invites={invites as any}
      />
    </div>
  );
}