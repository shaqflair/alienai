import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import AuthButton from "@/components/auth/AuthButton";
import {
  changeMemberRoleAction,
  removeMemberAction,
  revokeInviteAction,
  resendInviteAction,
} from "./actions";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function safeQuery(x: string | string[] | undefined): string {
  if (Array.isArray(x)) return String(x[0] ?? "");
  return typeof x === "string" ? x : "";
}

function fmtWhen(x: string | null) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(x);
  }
}

export default async function ManageMemberPage({
  params,
  searchParams,
}: {
  params:
    | { id?: string; memberId?: string }
    | Promise<{ id?: string; memberId?: string }>;
  searchParams?:
    | { [key: string]: string | string[] | undefined }
    | Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const supabase = await createClient();

  // Auth
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const sp = await Promise.resolve(searchParams as any);

  const projectId = safeParam(p?.id);
  const memberId = safeParam(p?.memberId);
  if (!projectId || !memberId) notFound();

  const confirm = safeQuery(sp?.confirm).toLowerCase(); // "remove" | "revoke" | ""

  // Load project
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .single();

  if (projectErr || !project) notFound();

  // In this route we treat `memberId` as either:
  // - a project_members.id (active member), OR
  // - a project_invites.id (pending invite)
  // We'll try invites first, then members.

  const { data: invite, error: invErr } = await supabase
    .from("project_invites")
    .select("id,project_id,email,role,created_at,accepted_at,invited_by,status")
    .eq("id", memberId)
    .eq("project_id", projectId)
    .maybeSingle();

  const isInvite = !!invite;

  let member: any = null;
  if (!isInvite) {
    const { data: mem, error: memErr } = await supabase
      .from("project_members")
      .select("id,project_id,user_id,role,created_at,removed_at")
      .eq("id", memberId)
      .eq("project_id", projectId)
      .single();

    if (memErr || !mem) notFound();
    member = mem;
  } else if (invErr) {
    // if invite lookup errored and no invite returned, treat as not found
    notFound();
  }

  // Load profile if active member user_id exists
  let profile: any = null;
  if (!isInvite && member?.user_id) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("user_id,email,full_name")
      .eq("user_id", member.user_id)
      .maybeSingle();
    profile = prof ?? null;
  }

  const display = isInvite
    ? invite?.email
    : profile?.full_name || profile?.email || member?.user_id;

  const isMe = !isInvite && !!member?.user_id && member.user_id === auth.user.id;

  const status = isInvite
    ? String(invite?.status ?? (invite?.accepted_at ? "accepted" : "pending"))
    : String(member?.removed_at ? "removed" : "active");

  const baseUrl = `/projects/${projectId}/members/manage/${memberId}`;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Link href={`/projects/${projectId}`} className="hover:underline">
              Project
            </Link>
            <span>/</span>
            <Link href={`/projects/${projectId}/members`} className="hover:underline">
              Members
            </Link>
            <span>/</span>
            <span>Manage</span>
          </div>

          <h1 className="mt-1 text-xl font-semibold">
            {isInvite ? "Manage invite" : "Manage member"}
          </h1>
          <p className="text-sm text-gray-600 truncate">{project.title}</p>
        </div>

        <AuthButton />
      </div>

      <section className="rounded-xl border bg-white p-4 space-y-4">
        <div>
          <div className="text-sm text-gray-600">{isInvite ? "Invite" : "Member"}</div>
          <div className="font-medium">{display}</div>
          <div className="mt-1 text-xs text-gray-600">
            Status: {status}
            {isMe ? <span className="ml-2 text-amber-700">• This is you</span> : null}
          </div>
        </div>

        {/* Role change */}
        <form action={changeMemberRoleAction} className="space-y-2">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="memberId" value={memberId} />
          <input type="hidden" name="isInvite" value={isInvite ? "1" : "0"} />

          <label className="block text-sm font-medium">Role</label>
          <select
            name="role"
            defaultValue={String((isInvite ? invite?.role : member?.role) ?? "viewer")}
            className="w-full rounded-md border px-3 py-2 text-sm"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </select>

          <button
            className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
            type="submit"
          >
            Save role
          </button>
        </form>

        {/* Invite controls */}
        {isInvite ? (
          <div className="pt-4 border-t space-y-3">
            <div className="text-sm font-medium">Invite controls</div>

            <form action={resendInviteAction}>
              <input type="hidden" name="projectId" value={projectId} />
              <input type="hidden" name="inviteId" value={memberId} />
              <button
                className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
                type="submit"
              >
                Resend invite
              </button>

              <div className="mt-1 text-xs text-gray-600">
                Last invited: {fmtWhen(invite?.created_at ?? null)}
              </div>
            </form>

            {confirm === "revoke" ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <div className="text-sm font-medium text-red-800">
                  Confirm revoke invite?
                </div>
                <div className="text-xs text-red-700">
                  This will delete the pending invite row. The user will no longer be
                  able to claim access.
                </div>

                <div className="flex items-center gap-2">
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="inviteId" value={memberId} />
                    <button
                      className="rounded-md border border-red-200 bg-red-100 px-4 py-2 text-sm text-red-800 hover:bg-red-200"
                      type="submit"
                    >
                      Yes, revoke
                    </button>
                  </form>

                  <Link
                    href={baseUrl}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </Link>
                </div>
              </div>
            ) : (
              <Link
                href={`${baseUrl}?confirm=revoke`}
                className="inline-flex rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100"
              >
                Revoke invite…
              </Link>
            )}
          </div>
        ) : (
          <div className="pt-4 border-t space-y-3">
            <div className="text-sm font-medium">Remove member</div>

            {isMe ? (
              <div className="text-xs text-gray-600">
                You can’t remove yourself. Ask another owner to remove you if needed.
              </div>
            ) : null}

            {isMe ? null : confirm === "remove" ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
                <div className="text-sm font-medium text-red-800">
                  Confirm remove member?
                </div>
                <div className="text-xs text-red-700">
                  This will remove the member from the project immediately.
                </div>

                <div className="flex items-center gap-2">
                  <form action={removeMemberAction}>
                    <input type="hidden" name="projectId" value={projectId} />
                    <input type="hidden" name="memberId" value={memberId} />
                    <button
                      className="rounded-md border border-red-200 bg-red-100 px-4 py-2 text-sm text-red-800 hover:bg-red-200"
                      type="submit"
                    >
                      Yes, remove
                    </button>
                  </form>

                  <Link
                    href={baseUrl}
                    className="rounded-md border px-4 py-2 text-sm hover:bg-gray-50"
                  >
                    Cancel
                  </Link>
                </div>
              </div>
            ) : (
              <Link
                href={`${baseUrl}?confirm=remove`}
                className="inline-flex rounded-md border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700 hover:bg-red-100"
              >
                Remove member…
              </Link>
            )}
          </div>
        )}

        <div className="pt-2">
          <Link href={`/projects/${projectId}/members`} className="text-sm hover:underline">
            ← Back to members
          </Link>
        </div>
      </section>
    </div>
  );
}
