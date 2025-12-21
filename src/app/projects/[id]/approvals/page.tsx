import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

type Role = "owner" | "editor" | "viewer" | (string & {});

function normRole(x: any): Role {
  const v = String(x ?? "").toLowerCase();
  if (v === "owner" || v === "editor" || v === "viewer") return v;
  return (v || "viewer") as Role;
}

function shortId(x: any, n = 10) {
  const s = String(x ?? "");
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function initialsFrom(nameOrEmail: string) {
  const s = String(nameOrEmail ?? "").trim();
  if (!s) return "—";
  const parts = s.split(/[\s.@_-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase() || s.slice(0, 2).toUpperCase();
}

function rolePill(role: string) {
  const r = String(role ?? "").toLowerCase();
  if (r === "owner") return { label: "Owner", cls: "bg-purple-50 text-purple-700 border-purple-200" };
  if (r === "editor") return { label: "Editor", cls: "bg-blue-50 text-blue-700 border-blue-200" };
  if (r === "viewer") return { label: "Viewer", cls: "bg-gray-50 text-gray-700 border-gray-200" };
  return { label: role || "unknown", cls: "bg-gray-50 text-gray-700 border-gray-200" };
}

export default async function ApprovalsPage({
  params,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const projectId = safeParam(p?.id);
  if (!projectId) notFound();

  // Load project
  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;
  if (!project) notFound();

  // Gate: must be a member
  const { data: myMem, error: myErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (myErr) throw myErr;
  if (!myMem) notFound();

  const myRole = normRole((myMem as any)?.role);
  const isOwner = myRole === "owner";

  // Members (what your RLS allows)
  const { data: members, error: memErr } = await supabase
    .from("project_members")
    .select("user_id, role, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (memErr) throw memErr;

  const owners = (members ?? []).filter((m: any) => String(m.role ?? "").toLowerCase() === "owner");

  // Profiles (best-effort)
  const memberUserIds = Array.from(
    new Set((members ?? []).map((m: any) => String(m.user_id ?? "")).filter(Boolean))
  );

  const { data: profiles, error: profErr } = memberUserIds.length
    ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", memberUserIds)
    : ({ data: [] as any[], error: null } as any);

  if (profErr) {
    console.warn("[profiles.select] blocked:", profErr.message);
  }

  const profileByUserId = new Map<string, any>();
  for (const pr of profiles ?? []) {
    if (pr?.user_id) profileByUserId.set(String(pr.user_id), pr);
  }

  function displayMember(userId: string) {
    const pr = profileByUserId.get(userId);
    const fullName = String(pr?.full_name ?? "").trim();
    const email = String(pr?.email ?? "").trim();
    return {
      title: fullName || email || shortId(userId),
      subtitle: fullName && email ? email : "",
      initials: initialsFrom(fullName || email || userId),
    };
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}`}>
          ← Back to Project
        </Link>
        <div>
          Role: <span className="font-mono">{myRole}</span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Approvals — {project.title}</h1>

        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <Link className="underline" href={`/projects/${projectId}`}>
            Project
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/members`}>
            Members
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/artifacts`}>
            Artifacts
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline font-medium" href={`/projects/${projectId}/approvals`}>
            Approvals
          </Link>
          {isOwner ? (
            <>
              <span className="opacity-40">•</span>
              <Link className="underline" href={`/projects/${projectId}/doa`}>
                DOA (holiday cover)
              </Link>
            </>
          ) : null}
        </div>

        <p className="text-sm text-gray-600">
          <b>Approvals v1:</b> Owners are approvers. (We’ll add chains/steps later.)
        </p>
      </header>

      <section className="border rounded-2xl bg-white p-5 space-y-2">
        <div className="font-medium">Current approvers (v1)</div>
        <div className="text-sm text-gray-600">
          {owners.length
            ? "These owners can approve submitted artifacts."
            : "No owners visible. Add an owner in Members."}
        </div>

        {owners.length ? (
          <div className="divide-y border rounded-2xl overflow-hidden mt-3">
            {owners.map((m: any) => {
              const userId = String(m.user_id ?? "");
              const disp = displayMember(userId);
              const pill = rolePill("owner");
              const isMe = userId === auth.user.id;

              return (
                <div key={userId} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-10 w-10 rounded-full bg-gray-100 border flex items-center justify-center text-sm font-medium text-gray-700">
                      {disp.initials}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="font-medium truncate">{disp.title}</div>
                        {isMe ? <span className="text-xs text-gray-500">(You)</span> : null}
                      </div>
                      {disp.subtitle ? <div className="text-xs text-gray-500 truncate">{disp.subtitle}</div> : null}
                      <div className="mt-1 text-xs text-gray-600">
                        Role:{" "}
                        <span className={`inline-flex items-center border rounded-full px-2 py-0.5 ${pill.cls}`}>
                          {pill.label}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-gray-500">Approver</div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="border rounded-2xl bg-white p-5 space-y-2">
        <div className="font-medium">Next (not in v1)</div>
        <ul className="text-sm text-gray-600 list-disc pl-5 space-y-1">
          <li>Approval steps/chains per artifact type</li>
          <li>Holiday cover / DOA routing</li>
          <li>Approve / Reject buttons on submitted artifacts</li>
          <li>Audit trail + baseline promotion on approval</li>
        </ul>
      </section>

      <p className="text-xs text-gray-500">
        Note: Visibility depends on your RLS. If you can’t see profiles, we fall back to IDs.
      </p>
    </main>
  );
}
