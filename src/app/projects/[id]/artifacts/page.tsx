// src/app/projects/[id]/artifacts/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/utils/supabase/server";

import DeleteDraftButton from "@/components/artifacts/DeleteDraftButton";

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
  const s = String(a?.approval_status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "changes_requested") return "changes_requested";
  if (s === "submitted") return "submitted";

  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";
  return "draft";
}

function statusPill(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return { label: "✅ Approved", cls: "bg-green-50 border-green-200 text-green-800" };
  if (s === "rejected") return { label: "⛔ Rejected (Final)", cls: "bg-red-50 border-red-200 text-red-800" };
  if (s === "changes_requested")
    return { label: "🛠 Changes requested (CR)", cls: "bg-blue-50 border-blue-200 text-blue-800" };
  if (s === "submitted") return { label: "🟡 Submitted", cls: "bg-yellow-50 border-yellow-200 text-yellow-800" };
  return { label: "📝 Draft", cls: "bg-gray-50 border-gray-200 text-gray-800" };
}

function typePill(type: any) {
  const t = String(type ?? "—").toUpperCase();
  return { label: t, cls: "bg-white border-gray-200 text-gray-800" };
}

function canCreate(role: string) {
  const r = String(role ?? "").toLowerCase();
  return r === "owner" || r === "editor";
}

const ARTIFACT_TYPES = [
  { type: "CHANGE_REQUESTS", label: "Change Requests" },
  { type: "PROJECT_CHARTER", label: "Project Charter" },
  { type: "RAID", label: "RAID Log" },
  { type: "SCHEDULE", label: "Schedule / Roadmap" },
  { type: "WBS", label: "Work Breakdown Structure" },
  { type: "STAKEHOLDER_REGISTER", label: "Stakeholder Register" },
  { type: "LESSONS_LEARNED", label: "Lessons Learned" },
  { type: "STATUS_DASHBOARD", label: "Status Dashboard" },
] as const;

function labelForType(type: string) {
  const t = String(type ?? "").trim().toUpperCase();
  return ARTIFACT_TYPES.find((x) => x.type === t)?.label ?? (type || "Artifact");
}

export default async function ArtifactsPage({
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

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw memErr;
  if (!mem) notFound();

  const myRole = String((mem as any)?.role ?? "viewer").toLowerCase();
  const canAdd = canCreate(myRole);

  const { data: approverAny, error: apprErr } = await supabase
    .from("project_approvers")
    .select("artifact_type")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1);

  if (apprErr) console.warn("[project_approvers.select] blocked:", apprErr.message);
  const isApproverAny = (approverAny ?? []).length > 0;

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;

  const { data: artifacts, error: artErr } = await supabase
    .from("artifacts")
    .select(
      "id,type,title,created_at,updated_at,is_current,is_baseline,is_locked,locked_at,approval_status,approved_by,rejected_by"
    )
    .eq("project_id", projectId)
    .order("is_current", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(300);

  if (artErr) throw artErr;

  const list = (artifacts ?? []).map((a: any) => {
    const status = derivedStatus(a);
    return {
      ...a,
      _status: status,
      _statusPill: statusPill(status),
      _typePill: typePill(a.type),
    };
  });

  const stats = list.reduce(
    (acc: any, a: any) => {
      acc.total += 1;
      acc[a._status] = (acc[a._status] ?? 0) + 1;
      return acc;
    },
    { total: 0, draft: 0, submitted: 0, changes_requested: 0, approved: 0, rejected: 0 }
  );

  async function createArtifactAction(formData: FormData) {
    "use server";

    const typeRaw = String(formData.get("type") ?? "").trim();
    const type = (typeRaw || "PROJECT_CHARTER").toUpperCase();

    const supabase = await createClient();
    const { data: auth2, error: authErr2 } = await supabase.auth.getUser();
    if (authErr2) throw authErr2;
    if (!auth2?.user) redirect("/login");

    const { data: mem2, error: memErr2 } = await supabase
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", auth2.user.id)
      .maybeSingle();

    if (memErr2) throw memErr2;
    const role2 = String((mem2 as any)?.role ?? "viewer").toLowerCase();
    if (!(role2 === "owner" || role2 === "editor")) throw new Error("Only owners/editors can create artifacts.");

    const { error: retireErr } = await supabase
      .from("artifacts")
      .update({ is_current: false })
      .eq("project_id", projectId)
      .eq("type", type)
      .eq("is_current", true);

    if (retireErr) throw new Error(`[artifacts.update(retire_current)] ${retireErr.code} ${retireErr.message}`);

    const nowIso = new Date().toISOString();
    const title = `${labelForType(type)} — ${nowIso.slice(0, 10)}`;

    const { data: inserted, error: insErr } = await supabase
      .from("artifacts")
      .insert({
        project_id: projectId,
        user_id: auth2.user.id,
        type,
        title,
        content: "",
        approval_status: "draft",
        status: "draft",
        is_locked: false,
        locked_at: null,
        locked_by: null,
        is_current: true,
        is_baseline: false,
        created_at: nowIso,
      })
      .select("id")
      .single();

    if (insErr) throw new Error(`[artifacts.insert] ${insErr.code} ${insErr.message}`);

    revalidatePath(`/projects/${projectId}/artifacts`);
    redirect(`/projects/${projectId}/artifacts/${inserted.id}`);
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8 space-y-6">
      <div className="flex items-center justify-between text-sm text-gray-500">
        <Link className="underline" href={`/projects/${projectId}`}>
          ← Back to Project
        </Link>

        <div className="flex items-center gap-3">
          {isApproverAny ? (
            <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-blue-50 border-blue-200 text-blue-800">
              Approver
            </span>
          ) : null}

          <div>
            Role: <span className="font-mono">{myRole}</span>
          </div>
        </div>
      </div>

      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">Artifacts — {project?.title ?? "Project"}</h1>

        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-600">
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50 border-gray-200">
            Total: <span className="ml-1 font-mono">{stats.total}</span>
          </span>
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-gray-50 border-gray-200">
            Draft: <span className="ml-1 font-mono">{stats.draft}</span>
          </span>
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-yellow-50 border-yellow-200 text-yellow-800">
            Submitted: <span className="ml-1 font-mono">{stats.submitted}</span>
          </span>
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-blue-50 border-blue-200 text-blue-800">
            CR: <span className="ml-1 font-mono">{stats.changes_requested}</span>
          </span>
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-green-50 border-green-200 text-green-800">
            Approved: <span className="ml-1 font-mono">{stats.approved}</span>
          </span>
          <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-red-50 border-red-200 text-red-800">
            Rejected: <span className="ml-1 font-mono">{stats.rejected}</span>
          </span>
        </div>
      </header>

      <section className="border rounded-2xl bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3 gap-3">
          <div className="font-medium">All artifacts</div>

          {canAdd ? (
            <form action={createArtifactAction} className="flex items-center gap-2">
              <select name="type" className="border rounded-xl px-3 py-2 text-sm bg-white" defaultValue="PROJECT_CHARTER">
                {ARTIFACT_TYPES.map((a) => (
                  <option key={a.type} value={a.type}>
                    {a.label}
                  </option>
                ))}
              </select>

              <button type="submit" className="px-3 py-2 rounded-xl bg-black text-white text-sm">
                + Create
              </button>
            </form>
          ) : (
            <span className="text-xs text-gray-500">Only owners/editors can create artifacts</span>
          )}
        </div>

        {list.length === 0 ? (
          <div className="p-5 text-sm text-gray-600">No artifacts yet.</div>
        ) : (
          <div className="divide-y">
            {list.map((a: any) => {
              const canDeleteThis = canAdd && a._status === "draft" && !a.is_locked && !a.is_baseline;

              return (
                <div key={a.id} className="px-5 py-4 flex items-center justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <div className="font-medium truncate">{a.title || a.type || "Untitled artifact"}</div>

                      {a.is_current ? (
                        <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-black text-white border-black">
                          Current
                        </span>
                      ) : null}

                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${a._typePill.cls}`}>
                        {a._typePill.label}
                      </span>

                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${a._statusPill.cls}`}>
                        {a._statusPill.label}
                      </span>
                    </div>

                    <div className="text-xs text-gray-500">
                      Updated: {fmtWhen(a.updated_at ?? a.created_at)}
                      {a.locked_at ? <> • Submitted: {fmtWhen(String(a.locked_at))}</> : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <Link className="underline text-sm" href={`/projects/${projectId}/artifacts/${a.id}`}>
                      Open →
                    </Link>

                    {canDeleteThis ? (
                      <DeleteDraftButton projectId={projectId} artifactId={a.id} />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
