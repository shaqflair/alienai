// src/app/projects/[id]/members/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import MembersClient, {
  type MemberRow as ClientMemberRow,
  type InviteRow as ClientInviteRow,
} from "@/components/projects/MembersClient";

type Role = "owner" | "editor" | "viewer" | (string & {});

function uniq<T>(arr: T[]) {
  return Array.from(new Set(arr));
}

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function safeQuery(x: string | string[] | undefined): string {
  if (Array.isArray(x)) return String(x[0] ?? "");
  return typeof x === "string" ? x : "";
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
  searchParams?:
    | { [key: string]: string | string[] | undefined }
    | Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const p = await Promise.resolve(params as any);
  const sp = await Promise.resolve(searchParams as any);

  const projectId = safeParam(p?.id);
  if (!projectId) return notFound();

  const invited = safeQuery(sp?.invited);
  const tokenFromRedirect = safeQuery(sp?.token);

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return redirect("/login");

  const myUserId = auth.user.id;

  // Load project
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .single();

  if (projErr || !project) return notFound();

  // Members (active)
  const { data: membersData, error: membersErr } = await supabase
    .from("project_members")
    .select("project_id,user_id,role,removed_at,created_at")
    .eq("project_id", projectId)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (membersErr) throw new Error(`Failed to load members: ${membersErr.message}`);

  const membersRaw = (membersData ?? []) as Array<{
    project_id: string;
    user_id: string;
    role: Role;
    removed_at: string | null;
    created_at: string | null;
  }>;

  // Must be a member to view
  const me = membersRaw.find((m) => m.user_id === myUserId);
  if (!me) {
    return (
      <div className="max-w-4xl mx-auto p-6 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold">Members</h1>
            <p className="text-sm text-gray-600">
              You don’t have access to view members for this project.
            </p>
          </div>
          <Link
            href={`/projects/${projectId}`}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Back
          </Link>
        </div>
      </div>
    );
  }

  const myRole = (me.role ?? "viewer") as Role;

  // Pending invites (include token for copy link)
  const { data: invitesData, error: invitesErr } = await supabase
    .from("project_invites")
    .select("id,project_id,email,role,created_at,accepted_at,invited_by,status,token,expires_at")
    .eq("project_id", projectId)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  if (invitesErr) throw new Error(`Failed to load invites: ${invitesErr.message}`);

  const invitesRaw = (invitesData ?? []) as Array<{
    id: string;
    project_id: string;
    email: string;
    role: Role;
    created_at: string | null;
    accepted_at: string | null;
    invited_by?: string | null;
    status?: string | null;
    token?: string | null;
    expires_at?: string | null;
  }>;

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

  // Keep MembersClient stable: map created_at -> invited_at
  const invites: ClientInviteRow[] = invitesRaw.map((i) => ({
    id: i.id,
    project_id: i.project_id,
    email: i.email,
    role: (i.role ?? "viewer") as any,
    invited_at: i.created_at ?? null,
  }));

  // Prefer token from redirect, otherwise newest invite token
  const freshToken = tokenFromRedirect || (invitesRaw.find((x) => x.token)?.token ?? "");
  const invitePath = freshToken ? `/invite/${encodeURIComponent(freshToken)}` : "";

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Members</h1>
          <p className="text-sm text-gray-600">
            Project: <span className="font-medium">{project.title ?? project.id}</span>
            <span className="ml-2 text-xs text-gray-500">• Your role: {String(myRole)}</span>
          </p>
        </div>

        <Link
          href={`/projects/${projectId}`}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Back
        </Link>
      </div>

      {/* Success + copy link (owner UX) */}
      {String(myRole).toLowerCase() === "owner" && invited === "1" && invitePath ? (
        <div className="rounded-xl border bg-white p-4 space-y-2">
          <div className="text-sm font-medium">Invite created</div>
          <div className="text-xs text-gray-600">
            Share this link with the invited user to accept:
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <input
              readOnly
              value={invitePath}
              className="flex-1 min-w-[280px] rounded-md border px-3 py-2 text-sm"
            />
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(invitePath);
                } catch {}
              }}
            >
              Copy link
            </button>

            <Link
              href={invitePath}
              className="rounded-md border px-3 py-2 text-sm hover:bg-gray-50"
            >
              Open
            </Link>
          </div>

          <div className="text-xs text-gray-500">
            Tip: send the full URL by copying from your browser address bar, or implement email sending next.
          </div>
        </div>
      ) : null}

      <MembersClient
        projectId={projectId}
        myRole={String(myRole)}
        members={members}
        invites={invites}
      />
    </div>
  );
}

