import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { submitArtifact, updateArtifact, approveArtifact, rejectArtifact, addArtifactComment } from "../actions";

function safeParam(x: unknown): string {
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

function derivedStatus(a: any) {
  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";
  return "draft";
}

function statusPill(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return { label: "✅ Approved", cls: "bg-green-50 border-green-200 text-green-800" };
  if (s === "rejected") return { label: "❌ Rejected", cls: "bg-red-50 border-red-200 text-red-800" };
  if (s === "submitted") return { label: "🟡 Submitted", cls: "bg-yellow-50 border-yellow-200 text-yellow-800" };
  return { label: "📝 Draft", cls: "bg-gray-50 border-gray-200 text-gray-800" };
}

function initialsFrom(nameOrEmail: string) {
  const s = String(nameOrEmail ?? "").trim();
  if (!s) return "—";
  const parts = s.split(/[\s.@_-]+/).filter(Boolean);
  const a = parts[0]?.[0] ?? "";
  const b = parts[1]?.[0] ?? parts[0]?.[1] ?? "";
  return (a + b).toUpperCase() || s.slice(0, 2).toUpperCase();
}

export default async function ArtifactDetailPage({
  params,
}: {
  params: { id?: string; artifactId?: string } | Promise<{ id?: string; artifactId?: string }>;
}) {
  const supabase = await createClient();

  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const projectId = safeParam(p?.id);
  const artifactId = safeParam(p?.artifactId);
  if (!projectId || !artifactId) notFound();

  // Member gate
  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (memErr) throw memErr;
  if (!mem) notFound();

  const myRole = String((mem as any)?.role ?? "viewer").toLowerCase();
  const canEditByRole = myRole === "owner" || myRole === "editor";

  // Approver gate (flat v1 list)
  const { data: approverRow } = await supabase
    .from("project_approvers")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  const isApprover = !!approverRow;

  // Artifact
  const { data: artifact, error: artErr } = await supabase
    .from("artifacts")
    .select(
      "id, project_id, user_id, type, title, content, created_at, updated_at, is_locked, locked_at, locked_by, approved_by, approved_at, rejected_by, rejected_at, rejection_reason"
    )
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (artErr) throw artErr;
  if (!artifact) notFound();

  const status = derivedStatus(artifact);
  const pill = statusPill(status);

  const isAuthor = String(artifact.user_id) === auth.user.id;

  // Editing rules:
  // - owner/editor can edit only while draft (not locked)
  const isEditable = canEditByRole && !artifact.is_locked && status === "draft";

  // Approval rules:
  // - approver + submitted + NOT author
  const canApproveOrReject = isApprover && status === "submitted" && !isAuthor;

  // Comments (best effort; RLS allows members to read)
  const { data: comments } = await supabase
    .from("artifact_comments")
    .select("id, actor_user_id, action, body, created_at")
    .eq("project_id", projectId)
    .eq("artifact_id", artifactId)
    .order("created_at", { ascending: true })
    .limit(500);

  // Profiles for comment authors (best effort)
  const ids = Array.from(new Set((comments ?? []).map((c: any) => String(c.actor_user_id ?? "")).filter(Boolean)));
  const { data: profiles, error: profErr } = ids.length
    ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids)
    : ({ data: [] as any[], error: null } as any);
  if (profErr) console.warn("[profiles.select] blocked:", profErr.message);

  const byId = new Map<string, any>();
  for (const pr of profiles ?? []) byId.set(String(pr.user_id), pr);

  function displayUser(uid: string) {
    const pr = byId.get(uid);
    const fullName = String(pr?.full_name ?? "").trim();
    const email = String(pr?.email ?? "").trim();
    const title = fullName || email || uid.slice(0, 8) + "…";
    return { title, initials: initialsFrom(fullName || email || uid) };
    }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}/artifacts`}>
          ← Back to Artifacts
        </Link>
        <div className="flex items-center gap-3">
          <span>
            Role: <span className="font-mono">{myRole}</span>
          </span>
          <span className={`inline-flex items-center rounded-full border px-2 py-0.5 ${pill.cls}`}>
            {pill.label}
          </span>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">{artifact.title || artifact.type || "Artifact"}</h1>
        <div className="text-sm text-gray-600 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center rounded border px-2 py-0.5 bg-gray-50">
            Type: <span className="ml-1 font-mono">{String(artifact.type ?? "—")}</span>
          </span>
          <span className="opacity-40">•</span>
          <span className="text-xs">Updated: {fmtWhen(artifact.updated_at ?? artifact.created_at)}</span>
          {artifact.locked_at ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">Submitted: {fmtWhen(String(artifact.locked_at))}</span>
            </>
          ) : null}
          {artifact.approved_at ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">Approved: {fmtWhen(String(artifact.approved_at))}</span>
            </>
          ) : null}
          {artifact.rejected_at ? (
            <>
              <span className="opacity-40">•</span>
              <span className="text-xs">Rejected: {fmtWhen(String(artifact.rejected_at))}</span>
            </>
          ) : null}
        </div>
      </header>

      {/* Actions */}
      <section className="border rounded-2xl bg-white p-5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-gray-600">
            {isEditable
              ? "Draft: you can edit and submit."
              : status === "submitted"
                ? isAuthor
                  ? "Submitted: waiting for another approver (you cannot approve your own artifact)."
                  : isApprover
                    ? "Submitted: you can approve or reject."
                    : "Submitted: waiting for approval."
                : status === "approved"
                  ? "Approved."
                  : status === "rejected"
                    ? "Rejected: unlocked for edits and resubmission."
                    : "View-only."}
          </div>

          {/* Submit button (authoring path) */}
          {canEditByRole && status === "draft" ? (
            <form action={submitArtifact}>
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="artifact_id" value={artifactId} />
              <button className="px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm" type="submit">
                Submit for approval
              </button>
            </form>
          ) : null}
        </div>

        {/* Approve/Reject (approver path) */}
        {canApproveOrReject ? (
          <div className="grid gap-3 md:grid-cols-2">
            <form action={approveArtifact} className="border rounded-2xl p-4 space-y-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="artifact_id" value={artifactId} />
              <div className="font-medium">Approve</div>
              <textarea
                name="comment"
                rows={3}
                placeholder="Optional approval comment…"
                className="w-full border rounded-xl px-3 py-2 text-sm"
              />
              <button className="px-4 py-2 rounded-xl bg-black text-white text-sm" type="submit">
                Approve
              </button>
            </form>

            <form action={rejectArtifact} className="border rounded-2xl p-4 space-y-2">
              <input type="hidden" name="project_id" value={projectId} />
              <input type="hidden" name="artifact_id" value={artifactId} />
              <div className="font-medium">Reject</div>
              <textarea
                name="reason"
                rows={3}
                placeholder="Required rejection reason…"
                className="w-full border rounded-xl px-3 py-2 text-sm"
                required
              />
              <button className="px-4 py-2 rounded-xl border border-red-200 text-red-700 text-sm hover:bg-red-50" type="submit">
                Reject
              </button>
            </form>
          </div>
        ) : null}
      </section>

      {/* Editor */}
      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Content</div>
          {!isEditable ? <div className="text-xs text-gray-500">Read-only</div> : null}
        </div>

        <form action={updateArtifact} className="grid gap-4">
          <input type="hidden" name="project_id" value={projectId} />
          <input type="hidden" name="artifact_id" value={artifactId} />

          <label className="grid gap-2">
            <span className="text-sm font-medium">Title</span>
            <input name="title" defaultValue={String(artifact.title ?? "")} className="border rounded-xl px-3 py-2" disabled={!isEditable} />
          </label>

          <label className="grid gap-2">
            <span className="text-sm font-medium">Content</span>
            <textarea
              name="content"
              rows={14}
              defaultValue={String(artifact.content ?? "")}
              className="border rounded-xl px-3 py-2 font-mono text-sm"
              disabled={!isEditable}
            />
          </label>

          {isEditable ? (
            <button type="submit" className="w-fit px-4 py-2 rounded-xl bg-black text-white text-sm">
              Save changes
            </button>
          ) : null}
        </form>
      </section>

      {/* Comments */}
      <section className="border rounded-2xl bg-white p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="font-medium">Comments</div>
          <div className="text-xs text-gray-500">
            {isApprover ? "Approvers can comment." : "Read-only."}
          </div>
        </div>

        {isApprover ? (
          <form action={addArtifactComment} className="grid gap-2">
            <input type="hidden" name="project_id" value={projectId} />
            <input type="hidden" name="artifact_id" value={artifactId} />
            <input type="hidden" name="action" value="comment" />
            <textarea name="body" rows={3} className="border rounded-xl px-3 py-2 text-sm" placeholder="Write a comment…" required />
            <button className="w-fit px-4 py-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm" type="submit">
              Add comment
            </button>
          </form>
        ) : null}

        {(comments ?? []).length === 0 ? (
          <div className="text-sm text-gray-600">No comments yet.</div>
        ) : (
          <div className="divide-y border rounded-2xl overflow-hidden">
            {(comments ?? []).map((c: any) => {
              const who = displayUser(String(c.actor_user_id ?? ""));
              return (
                <div key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="h-8 w-8 rounded-full bg-gray-100 border flex items-center justify-center text-xs font-medium text-gray-700">
                        {who.initials}
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-medium truncate">{who.title}</div>
                        <div className="text-xs text-gray-500">
                          {String(c.action ?? "comment")} • {fmtWhen(String(c.created_at ?? null))}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-gray-700 whitespace-pre-wrap">{String(c.body ?? "")}</div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
