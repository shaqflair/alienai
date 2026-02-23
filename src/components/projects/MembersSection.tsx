// src/components/projects/MembersSection.tsx
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";import MembersClient, {
  type MemberRow as ClientMemberRow,
  type InviteRow as ClientInviteRow,
  type Role,
} from "@/components/projects/MembersClient";

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

export default async function MembersSection({
  projectId,
  myUserId,
}: {
  projectId: string;
  myUserId: string;
}) {
  const supabase = await createClient();

  // Active members only
  const { data: membersData, error: membersErr } = await supabase
    .from("project_members")
    .select("project_id,user_id,role,removed_at,created_at")
    .eq("project_id", projectId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (membersErr) {
    return (
      <section className="rounded-xl border bg-white">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Members</h2>
          <div className="mt-2 text-sm text-red-600">
            Failed to load members: {membersErr.message}
          </div>
        </div>
      </section>
    );
  }

  const membersRaw = (membersData ?? []) as Array<{
    project_id: string;
    user_id: string;
    role: Role;
    removed_at: string | null;
    created_at: string | null;
  }>;

  // Pending invites
  const { data: invitesData, error: invitesErr } = await supabase
    .from("project_invites")
    .select("id,project_id,email,role,created_at,expires_at,accepted_at,accepted_by,status")
    .eq("project_id", projectId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (invitesErr) {
    return (
      <section className="rounded-xl border bg-white">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Members</h2>
          <div className="mt-2 text-sm text-red-600">
            Failed to load invites: {invitesErr.message}
          </div>
        </div>
      </section>
    );
  }

  const invitesRaw = (invitesData ?? []) as Array<{
    id: string;
    project_id: string;
    email: string;
    role: Role;
    created_at: string | null;
    expires_at: string | null;
    accepted_at: string | null;
    accepted_by: string | null;
    status: string | null;
  }>;

  // My role
  const me = membersRaw.find((m) => m.user_id === myUserId);
  const myRole = (me?.role ?? "viewer") as Role;
  const isOwner = String(myRole).toLowerCase() === "owner";

  // Profiles enrichment
  const userIds = uniq(membersRaw.map((m) => m.user_id).filter(Boolean));
  const profilesById = new Map<
    string,
    { full_name?: string | null; email?: string | null; avatar_url?: string | null }
  >();

  if (userIds.length > 0) {
    const { data: profilesData } = await supabase
      .from("profiles")
      .select("user_id,full_name,email,avatar_url")
      .in("user_id", userIds);

    (profilesData ?? []).forEach((p: any) => {
      profilesById.set(String(p.user_id), {
        full_name: p.full_name ?? null,
        email: p.email ?? null,
        avatar_url: p.avatar_url ?? null,
      });
    });
  }

  // Adapt to shared MembersClient.tsx props
  const members: ClientMemberRow[] = membersRaw.map((m) => {
    const prof = profilesById.get(m.user_id);

    return {
      user_id: m.user_id,
      full_name: prof?.full_name ?? null,
      email: prof?.email ?? null,
      role: (m.role ?? "viewer") as Role,
      status: "active",
    };
  });

  const invites: ClientInviteRow[] = invitesRaw.map((i) => ({
    id: i.id,
    email: i.email,
    role: (i.role ?? "viewer") as Role,
    status: (i.status ?? "pending") as any,
    created_at: i.created_at ?? null,
    expires_at: i.expires_at ?? null,
  }));

  return (
    <section className="rounded-xl border bg-white">
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <h2 className="text-lg font-semibold">Members</h2>
          <p className="text-sm text-gray-600">
            People who can access this project
            <span className="ml-2 text-xs text-gray-500">• Your role: {String(myRole)}</span>
          </p>
        </div>

        {isOwner ? (
          <Link
            href={`/projects/${projectId}/members/invite`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Invite
          </Link>
        ) : null}
      </div>

      <div className="border-t p-4">
        <MembersClient
          projectId={projectId}
          myRole={myRole}
          members={members}
          invites={invites}
        />
      </div>
    </section>
  );
}
