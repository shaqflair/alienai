// src/app/projects/[id]/artifacts/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

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
  // Prefer approval_status if present (newer model)
  const s = String(a?.approval_status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "changes_requested") return "changes_requested";
  if (s === "submitted") return "submitted";

  // Fallback to legacy columns
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

  // Gate: must be a member
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

  // Optional UX: show if user is an active approver for any type on this project
  const { data: approverAny, error: apprErr } = await supabase
    .from("project_approvers")
    .select("artifact_type")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .limit(1);

  if (apprErr) {
    // Don't crash if RLS blocks; just hide badge
    console.warn("[project_approvers.select] blocked:", apprErr.message);
  }
  const isApproverAny = (approverAny ?? []).length > 0;

  const { data: project, error: projErr } = await supabase
    .from("projects")
    .select("id,title")
    .eq("id", projectId)
    .maybeSingle();
  if (projErr) throw projErr;

  const { data: artifacts, error: artErr } = await supabase
    .from("artifacts")
    .select("id,type,title,created_at,updated_at,is_current,is_locked,locked_at,approval_status,approved_by,rejected_by")
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

        <div className="flex flex-wrap items-center gap-3 text-sm text-gray-600">
          <Link className="underline" href={`/projects/${projectId}`}>
            Overview
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline font-medium" href={`/projects/${projectId}/artifacts`}>
            Artifacts
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/members`}>
            Members
          </Link>
          <span className="opacity-40">•</span>
          <Link className="underline" href={`/projects/${projectId}/approvals`}>
            Approvals
          </Link>
        </div>

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

        <p className="text-sm text-gray-600">Draft → Submit (locks) → Approve → Baseline (later).</p>
      </header>

      <section className="border rounded-2xl bg-white overflow-hidden">
        <div className="flex items-center justify-between border-b bg-gray-50 px-5 py-3">
          <div className="font-medium">All artifacts</div>

          {canAdd ? (
            <Link className="text-sm underline" href={`/projects/${projectId}/artifacts/new`}>
              + New artifact
            </Link>
          ) : (
            <span className="text-xs text-gray-500">Only owners/editors can create artifacts</span>
          )}
        </div>

        {list.length === 0 ? (
          <div className="p-5 text-sm text-gray-600">No artifacts yet.</div>
        ) : (
          <div className="divide-y">
            {list.map((a: any) => (
              <div key={a.id} className="px-5 py-4 flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <div className="font-medium truncate">{a.title || a.type || "Untitled artifact"}</div>

                    {a.is_current ? (
                      <span className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs bg-black text-white border-black">
                        Current
                      </span>
                    ) : null}

                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${a._typePill.cls}`}
                    >
                      {a._typePill.label}
                    </span>

                    <span
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs ${a._statusPill.cls}`}
                    >
                      {a._statusPill.label}
                    </span>
                  </div>

                  <div className="text-xs text-gray-500">
                    Updated: {fmtWhen(a.updated_at ?? a.created_at)}
                    {a.locked_at ? <> • Submitted: {fmtWhen(String(a.locked_at))}</> : null}
                  </div>
                </div>

                <Link className="underline text-sm shrink-0" href={`/projects/${projectId}/artifacts/${a.id}`}>
                  Open →
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
