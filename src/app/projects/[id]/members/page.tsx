import "server-only";

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";
import MembersClient, {
  type MemberRow as ClientMemberRow,
  type InviteRow as ClientInviteRow,
  type OrgMemberOption,
} from "@/components/projects/MembersClient";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type Role = "owner" | "editor" | "viewer" | (string & {});

function uniq<T>(arr: T[]) { return Array.from(new Set(arr)); }
function safeParam(x: unknown): string { return typeof x === "string" ? x : ""; }
function safeQuery(x: string | string[] | undefined): string {
  if (Array.isArray(x)) return String(x[0] ?? "");
  return typeof x === "string" ? x : "";
}
function looksLikeUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(value || "").trim()
  );
}
function toText(x: any) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number") return Number.isFinite(x) ? String(x) : "";
  try { return String(x); } catch { return ""; }
}

async function resolveProjectUuid(supabase: any, identifier: string): Promise<string | null> {
  const id = toText(identifier).trim();
  if (!id) return null;
  if (looksLikeUuid(id)) return id;
  const { data, error } = await supabase
    .from("projects").select("id").eq("project_code", id).maybeSingle();
  if (error) throw error;
  return toText(data?.id).trim() || null;
}

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
  searchParams?: { [key: string]: string | string[] | undefined } | Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const p  = await Promise.resolve(params as any);
  const sp = await Promise.resolve(searchParams as any);

  const projectIdentifier = safeParam(p?.id).trim();
  if (!projectIdentifier || projectIdentifier === "undefined") return notFound();

  const supabase = await createClient();
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr || !auth?.user) return redirect("/login");

  const myUserId = auth.user.id;

  const projectUuid = await resolveProjectUuid(supabase, projectIdentifier);
  if (!projectUuid) return notFound();

  const { data: project, error: projErr } = await supabase
    .from("projects").select("id,title,project_code,organisation_id")
    .eq("id", projectUuid).maybeSingle();

  if (projErr || !project?.id) return notFound();

  const { data: membersData, error: membersErr } = await supabase
    .from("project_members")
    .select("project_id,user_id,role,removed_at,created_at")
    .eq("project_id", projectUuid)
    .is("removed_at", null)
    .order("created_at", { ascending: true });

  if (membersErr) throw new Error(`Failed to load members: ${membersErr.message}`);

  const membersRaw = (membersData ?? []) as Array<{
    project_id: string; user_id: string; role: Role;
    removed_at: string | null; created_at: string | null;
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
              <Link href={`/projects/${projectIdentifier}`}
                className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
                Back
              </Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const myRole = (me.role ?? "viewer") as Role;

  // Pending invites (legacy — shown for cleanup only)
  const { data: invitesData } = await supabase
    .from("project_invites")
    .select("id,project_id,email,role,created_at,accepted_at,status,token,expires_at")
    .eq("project_id", projectUuid)
    .is("accepted_at", null)
    .order("created_at", { ascending: false });

  const invitesRaw = (invitesData ?? []) as Array<{
    id: string; project_id: string; email: string; role: Role;
    created_at: string | null; accepted_at: string | null;
    status?: string | null; token?: string | null; expires_at?: string | null;
  }>;

  // Profiles for current project members
  const userIds = uniq(membersRaw.map((m) => m.user_id).filter(Boolean));
  const profilesById = new Map<string, { full_name?: string | null; email?: string | null }>();
  if (userIds.length > 0) {
    const { data: profilesData } = await supabase
      .from("profiles").select("user_id,full_name,email").in("user_id", userIds);
    (profilesData ?? []).forEach((p: any) => {
      profilesById.set(p.user_id, { full_name: p.full_name, email: p.email });
    });
  }

  // ── Fetch all org members for the picker ──────────────────────────────────
  const orgId = project.organisation_id
    ?? (await getActiveOrgId().catch(() => null));

  let orgMembers: OrgMemberOption[] = [];
  if (orgId) {
    const { data: orgMemberRows } = await supabase
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", orgId)
      .is("removed_at", null);

    const orgUserIds = (orgMemberRows ?? []).map((r: any) => String(r.user_id)).filter(Boolean);

    if (orgUserIds.length > 0) {
      const { data: orgProfiles } = await supabase
        .from("profiles")
        .select("user_id,full_name,email")
        .in("user_id", orgUserIds);

      orgMembers = (orgProfiles ?? []).map((p: any) => ({
        user_id:   String(p.user_id),
        full_name: p.full_name ?? null,
        email:     p.email ?? null,
      }));
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  const members: ClientMemberRow[] = membersRaw.map((m) => {
    const prof = profilesById.get(m.user_id);
    return {
      project_id:   m.project_id,
      user_id:      m.user_id,
      role:         (m.role ?? "viewer") as any,
      removed_at:   m.removed_at ?? null,
      display_name: prof?.full_name?.trim() || prof?.email?.trim() || m.user_id,
      email:        prof?.email ?? undefined,
    };
  });

  const invites: ClientInviteRow[] = invitesRaw.map((i) => ({
    id:         i.id,
    project_id: i.project_id,
    email:      i.email,
    role:       (i.role ?? "viewer") as any,
    invited_at: i.created_at ?? null,
  }));

  const isOwner      = String(myRole).toLowerCase() === "owner";
  const projectTitle = toText(project.title).trim() || "Untitled project";
  const projectCode  = toText(project.project_code).trim();

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
                <span className="ml-2 text-xs text-gray-500">· Your role: {String(myRole)}</span>
              </p>
            </div>
            <Link href={`/projects/${projectIdentifier}`}
              className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50">
              Back
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-gray-200 bg-white p-0 shadow-sm">
          <MembersClient
            projectId={projectUuid}
            myRole={String(myRole)}
            members={members}
            invites={invites}
            orgMembers={orgMembers}
          />
        </div>
      </div>
    </div>
  );
}