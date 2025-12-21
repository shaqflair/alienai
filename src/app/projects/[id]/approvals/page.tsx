import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { addProjectApprover, removeProjectApprover, toggleProjectApprover } from "./actions";

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

const ALLOWED_TYPES = ["PID", "RAID", "SOW", "STATUS", "RISKS", "ASSUMPTIONS", "ACTIONS"] as const;

export default async function ApprovalsPage({
  params,
  searchParams,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
  searchParams?: Record<string, string | string[] | undefined> | Promise<Record<string, any>>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const sp = await Promise.resolve(searchParams as any);

  const projectId = safeParam(p?.id);
  if (!projectId) notFound();

  const banner = String(sp?.banner ?? "");

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

  // Members list (so owners can choose who to make approver)
  const { data: members, error: memErr } = await supabase
    .from("project_members")
    .select("user_id, role, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true })
    .limit(500);
  if (memErr) throw memErr;

  const memberUserIds = Array.from(
    new Set((members ?? []).map((m: any) => String(m.user_id ?? "")).filter(Boolean))
  );

  // Approvers v1 (per artifact_type)
  const { data: approvers, error: apprErr } = await supabase
    .from("project_approvers")
    .select("project_id,user_id,artifact_type,is_active,created_at,created_by,role_label")
    .eq("project_id", projectId)
    .order("artifact_type", { ascending: true })
    .order("created_at", { ascending: true });

  if (apprErr) throw apprErr;

  // Profiles (best-effort)
  const idsForProfiles = Array.from(
    new Set([...(memberUserIds ?? []), ...((approvers ?? []).map((a: any) => String(a.user_id ?? "")).filter(Boolean))])
  );

  const { data: profiles, error: profErr } = idsForProfiles.length
    ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", idsForProfiles)
    : ({ data: [] as any[], error: null } as any);

  if (profErr) console.warn("[profiles.select] blocked:", profErr.message);

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

  const grouped = new Map<string, any[]>();
  for (const a of approvers ?? []) {
    const t = String(a.artifact_type ?? "").toUpperCase() || "—";
    if (!grouped.has(t)) grouped.set(t, []);
    grouped.get(t)!.push(a);
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
        </div>

        <p className="text-sm text-gray-600">
          <b>Approvals v1:</b> Assign approvers per <code>artifact_type</code>. Approvers can approve/reject (but not their own work).
        </p>
      </header>

      {banner ? (
        <section className="border rounded-2xl p-4 bg-green-50 border-green-200 text-sm">
          ✅ {banner.replaceAll("_", " ")}
        </section>
      ) : null}

      {/* Owner tool: add approver */}
      {isOwner ? (
        <section className="border rounded-2xl bg-white p-5 space-y-4">
          <div className="font-medium">Add approver</div>
          <div className="text-sm text-gray-600">
            Choose a project member and which artifact type they can approve.
          </div>

          <form action={addProjectApprover} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="project_id" value={projectId} />

            <select name="user_id" className="border rounded-xl px-3 py-2 min-w-[280px]" required>
              <option value="" disabled selected>
                Select member…
              </option>
              {(memberUserIds ?? []).map((uid) => {
                const d = displayMember(uid);
                const isMe = uid === auth.user.id;
                return (
                  <option key={uid} value={uid}>
                    {d.title}{isMe ? " (You)" : ""}
                  </option>
                );
              })}
            </select>

            <select name="artifact_type" className="border rounded-xl px-3 py-2" defaultValue="PID" required>
              {ALLOWED_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>

            <button className="px-4 py-2 rounded-xl bg-black text-white text-sm" type="submit">
              Add / Reactivate
            </button>
          </form>

          <p className="text-xs text-gray-500">
            This writes to <code>project_approvers</code> with <code>is_active=true</code>.
          </p>
        </section>
      ) : (
        <section className="border rounded-2xl bg-white p-5">
          <div className="text-sm text-gray-600">Only owners can add/remove/toggle approvers.</div>
        </section>
      )}

      {/* Current approvers */}
      <section className="border rounded-2xl bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
          <div className="font-medium">Approvers (by artifact type)</div>
          <div className="text-xs text-gray-500">{(approvers ?? []).length} rows</div>
        </div>

        {(approvers ?? []).length === 0 ? (
          <div className="p-5 text-sm text-gray-600">No approvers set yet.</div>
        ) : (
          <div className="divide-y">
            {ALLOWED_TYPES.map((t) => {
              const rows = grouped.get(t) ?? [];
              return (
                <div key={t} className="px-5 py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="font-medium">{t}</div>
                    <div className="text-xs text-gray-500">{rows.length} approver(s)</div>
                  </div>

                  {rows.length === 0 ? (
                    <div className="text-sm text-gray-500">None assigned.</div>
                  ) : (
                    <div className="divide-y border rounded-2xl overflow-hidden">
                      {rows.map((a: any) => {
                        const uid = String(a.user_id ?? "");
                        const disp = displayMember(uid);
                        const isActive = !!a.is_active;
                        const isMe = uid === auth.user.id;

                        return (
                          <div key={`${uid}-${t}`} className="px-4 py-3 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className="h-9 w-9 rounded-full bg-gray-100 border flex items-center justify-center text-xs font-medium text-gray-700">
                                {disp.initials}
                              </div>
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div className="font-medium truncate">{disp.title}</div>
                                  {isMe ? <span className="text-xs text-gray-500">(You)</span> : null}
                                  {isActive ? (
                                    <span className="text-xs rounded-full border px-2 py-0.5 bg-green-50 border-green-200 text-green-800">
                                      Active
                                    </span>
                                  ) : (
                                    <span className="text-xs rounded-full border px-2 py-0.5 bg-gray-50 border-gray-200 text-gray-700">
                                      Inactive
                                    </span>
                                  )}
                                </div>
                                {disp.subtitle ? <div className="text-xs text-gray-500 truncate">{disp.subtitle}</div> : null}
                              </div>
                            </div>

                            {isOwner ? (
                              <div className="flex items-center gap-2">
                                <form action={toggleProjectApprover}>
                                  <input type="hidden" name="project_id" value={projectId} />
                                  <input type="hidden" name="user_id" value={uid} />
                                  <input type="hidden" name="artifact_type" value={t} />
                                  <input type="hidden" name="next_active" value={String(!isActive)} />
                                  <button className="border rounded-xl px-3 py-2 text-sm" type="submit">
                                    {isActive ? "Disable" : "Enable"}
                                  </button>
                                </form>

                                <form action={removeProjectApprover}>
                                  <input type="hidden" name="project_id" value={projectId} />
                                  <input type="hidden" name="user_id" value={uid} />
                                  <input type="hidden" name="artifact_type" value={t} />
                                  <button className="px-3 py-2 text-sm text-red-600" type="submit">
                                    Remove
                                  </button>
                                </form>
                              </div>
                            ) : (
                              <div className="text-xs text-gray-500">—</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <p className="text-xs text-gray-500">
        Note: Visibility depends on your RLS. If profiles are blocked, we fall back to user IDs.
      </p>
    </main>
  );
}
