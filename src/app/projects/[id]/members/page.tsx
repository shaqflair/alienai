import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import MembersClient, {
  type MemberRow as ClientMemberRow,
  type InviteRow as ClientInviteRow,
} from "@/components/projects/MembersClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim(),
  );
}

function toText(x: any) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number") return Number.isFinite(x) ? String(x) : "";
  if (typeof x === "bigint") return String(x);
  try {
    return String(x);
  } catch {
    return "";
  }
}

async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const id = toText(identifier).trim();
  if (!id) return null;

  if (looksLikeUuid(id)) return id;

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("project_code", id)
    .maybeSingle();

  if (error) throw error;

  const uuid = toText(data?.id).trim();
  return uuid || null;
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

  const projectIdentifier = safeParam(p?.id).trim();
  if (!projectIdentifier || projectIdentifier === "undefined") return notFound();

  const invited = safeQuery(sp?.invited);
  const tokenFromRedirect = safeQuery(sp?.token);

  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return redirect("/login");

  const myUserId = auth.user.id;

  const projectUuid = await resolveProjectUuid(supabase, projectIdentifier);
  if (!projectUuid) return notFound();

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title,project_code")
    .eq("id", projectUuid)
    .maybeSingle();

  if (projErr || !project?.id) return notFound();

  const { data: membersData, error: membersErr } = await supabase
    .from("project_members")
    .select("project_id,user_id,role,removed_at,created_at")
    .eq("project_id", projectUuid)
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

  const me = membersRaw.find((m) => m.user_id === myUserId);
  if (!me) {
    return (
      <div className="relative z-[1] min-h-screen bg-white">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h1 className="text-2xl font-semibold text-gray-900">Members</h1>
                <p className="mt-2 text-sm text-gray-600">
                  You do not have access to view members for this project.
                </p>
              </div>

              <Link
                href={`/projects/${projectIdentifier}`}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
              >
                Back
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const myRole = (me.role ?? "viewer") as Role;

  const { data: invitesData, error: invitesErr } = await supabase
    .from("project_invites")
    .select("id,project_id,email,role,created_at,accepted_at,invited_by,status,token,expires_at")
    .eq("project_id", projectUuid)
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

  const invites: ClientInviteRow[] = invitesRaw.map((i) => ({
    id: i.id,
    project_id: i.project_id,
    email: i.email,
    role: (i.role ?? "viewer") as any,
    invited_at: i.created_at ?? null,
  }));

  const freshToken = tokenFromRedirect || (invitesRaw.find((x) => x.token)?.token ?? "");
  const invitePath = freshToken ? `/invite/${encodeURIComponent(freshToken)}` : "";

  const isOwner = String(myRole).toLowerCase() === "owner";
  const projectTitle = toText(project.title).trim() || "Untitled project";
  const projectCode = toText(project.project_code).trim();

  return (
    <div className="relative z-[1] min-h-screen bg-white">
      <div className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">Members</h1>
              <p className="mt-2 text-sm text-gray-600">
                Project: <span className="font-medium text-gray-900">{projectTitle}</span>
                {projectCode ? <span className="ml-2 text-gray-500">({projectCode})</span> : null}
                <span className="ml-2 text-xs text-gray-500">• Your role: {String(myRole)}</span>
              </p>
            </div>

            <Link
              href={`/projects/${projectIdentifier}`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
            >
              Back
            </Link>
          </div>
        </div>

        {isOwner && invited === "1" && invitePath ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
            <div className="text-sm font-medium text-gray-900">Invite created</div>
            <div className="text-xs text-gray-600">Share this link with the invited user to accept:</div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                readOnly
                value={invitePath}
                className="min-w-[280px] flex-1 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
              />

              <Link
                href={invitePath}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Open
              </Link>

              <Link
                href={`/projects/${projectIdentifier}/members/invite`}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
              >
                Invite another
              </Link>
            </div>

            <div className="text-xs text-gray-500">
              Tip: click into the field above and press <span className="font-medium">Ctrl+C</span> to copy, or copy the
              full URL from your browser address bar.
            </div>
          </div>
        ) : null}

        <div className="rounded-2xl border border-gray-200 bg-white p-0 shadow-sm">
          <MembersClient
            projectId={projectUuid}
            myRole={String(myRole)}
            members={members}
            invites={invites}
          />
        </div>
      </div>
    </div>
  );
}