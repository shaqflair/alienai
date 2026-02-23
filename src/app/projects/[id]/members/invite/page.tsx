import Link from "next/link";
import { createClient } from "@/utils/supabase/server";
import MembersClient, {
  type MemberRow as ClientMemberRow,
  type InviteRow as ClientInviteRow,
} from "@/components/projects/MembersClient";

type Role = "owner" | "editor" | "viewer" | (string & {});

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

  // Must be a member to view this section properly
  const me = membersRaw.find((m) => m.user_id === myUserId);
  if (!me) {
    return (
      <section className="rounded-xl border bg-white">
        <div className="p-4">
          <h2 className="text-lg font-semibold">Members</h2>
          <div className="mt-2 text-sm text-gray-600">
            You don’t have access to view members for this project.
          </div>
        </div>
      </section>
    );
  }

  // Pending invites (use created_at; project_invites.invited_at may not exist)
  const { data: invitesData, error: invitesErr } = await supabase
    .from("project_invites")
    .select("id,project_id,email,role,created_at,accepted_at,status")
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
    accepted_at: string | null;
    status?: string | null;
  }>;

  const myRole = (me.role ?? "viewer") as Role;
  const isOwner = String(myRole).toLowerCase() === "owner";

  // Profiles enrichment (optional)
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
      profilesById.set(p.user_id, {
        full_name: p.full_name,
        email: p.email,
        avatar_url: p.avatar_url,
      });
    });
  }

  const members: ClientMemberRow[] = membersRaw.map((m) => {
    const prof = profilesById.get(m.user_id);
    const display_name = prof?.full_name?.trim() || prof?.email?.trim() || m.user_id;

    return {
      project_id: m.project_id,
      user_id: m.user_id,
      role: (m.role ?? "viewer") as any,
      removed_at: m.removed_at ?? null,
      display_name,
      email: prof?.email ?? undefined,
    };
  });

  // Keep client API stable: map created_at -> invited_at
  const invites: ClientInviteRow[] = invitesRaw.map((i) => ({
    id: i.id,
    project_id: i.project_id,
    email: i.email,
    role: (i.role ?? "viewer") as any,
    invited_at: i.created_at ?? null,
  }));

  return (
    <section className="rounded-xl border bg-white">
      <div className="flex items-start justify-between gap-3 p-4">
        <div>
          <h2 className="text-lg font-semibold">Members</h2>
          <p className="text-sm text-gray-600">
            People who can access this project
            <span className="ml-2 text-xs text-gray-500">
              • Your role: {String(myRole)}
            </span>
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
          myRole={String(myRole)}
          members={members}
          invites={invites}
        />
      </div>
    </section>
  );
}

