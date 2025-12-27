import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createClient } from "@/utils/supabase/server";

import AuthButton from "@/components/auth/AuthButton";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function fmtWhen(x: any) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().replace("T", " ").replace("Z", " UTC");
  } catch {
    return String(x);
  }
}

type StepRow = {
  id?: string;
  project_id?: string;
  step_index?: number | null;
  title?: string | null;
  status?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  // v2 fields you mentioned sometimes exist:
  kind?: string | null;
  role?: string | null;
};

type ApproverRow = {
  id?: string;
  project_id?: string;
  user_id?: string | null;
  email?: string | null;
  role?: string | null;
  is_active?: boolean | null;
  created_at?: string | null;
};

export default async function ApprovalsPage({
  params,
}: {
  params: { id?: string } | Promise<{ id?: string }>;
}) {
  const supabase = await createClient();

  // ----------------------------
  // Auth
  // ----------------------------
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  if (!auth?.user) redirect("/login");

  const p = await Promise.resolve(params as any);
  const projectId = safeParam(p?.id);
  if (!projectId) notFound();

  // ----------------------------
  // Load project
  // ----------------------------
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, title")
    .eq("id", projectId)
    .single();

  if (projectErr || !project) notFound();

  // ----------------------------
  // Try load approvals config (safe)
  // ----------------------------
  let steps: StepRow[] = [];
  let approvers: ApproverRow[] = [];
  let stepsErr: string | null = null;
  let approversErr: string | null = null;

  const stepsResp = await supabase
    .from("approval_steps")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (stepsResp.error) stepsErr = stepsResp.error.message;
  else steps = (stepsResp.data ?? []) as any;

  const approversResp = await supabase
    .from("project_approvers")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (approversResp.error) approversErr = approversResp.error.message;
  else approvers = (approversResp.data ?? []) as any;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <Link href={`/projects/${projectId}`} className="hover:underline">
              Project
            </Link>
            <span>/</span>
            <span>Approvals</span>
          </div>

          <h1 className="mt-1 text-xl font-semibold">Approvals</h1>
          <p className="text-sm text-gray-600 truncate">{project.title}</p>
        </div>

        <AuthButton />
      </div>

      {/* Quick links */}
      <div className="flex flex-wrap gap-2">
        <Link
          href={`/projects/${projectId}/settings`}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Project settings
        </Link>
        <Link
          href={`/projects/${projectId}/members`}
          className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
        >
          Members
        </Link>
      </div>

      {/* Steps */}
      <section className="rounded-xl border bg-white">
        <div className="p-4">
          <div className="text-base font-semibold">Approval steps</div>
          <div className="text-sm text-gray-600">
            Your configured chain (v1/v2). If this is blank, it usually means steps aren’t created yet.
          </div>
        </div>

        {stepsErr ? (
          <div className="border-t p-4 text-sm text-red-600">
            Could not load <code>approval_steps</code>: {stepsErr}
          </div>
        ) : steps.length === 0 ? (
          <div className="border-t p-4 text-sm text-gray-600">No steps found.</div>
        ) : (
          <div className="border-t divide-y">
            {steps.map((s, idx) => (
              <div key={s.id ?? String(idx)} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium">
                    Step {s.step_index ?? idx + 1}: {s.title ?? s.kind ?? "Untitled"}
                  </div>
                  <div className="text-sm text-gray-600">
                    Role: {s.role ?? "—"} · Status: {s.status ?? "—"}
                  </div>
                </div>
                <div className="text-xs text-gray-500 whitespace-nowrap">
                  Updated: {fmtWhen(s.updated_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Approvers */}
      <section className="rounded-xl border bg-white">
        <div className="p-4">
          <div className="text-base font-semibold">Project approvers</div>
          <div className="text-sm text-gray-600">
            People who can approve/reject/request changes (depends on your workflow rules).
          </div>
        </div>

        {approversErr ? (
          <div className="border-t p-4 text-sm text-red-600">
            Could not load <code>project_approvers</code>: {approversErr}
          </div>
        ) : approvers.length === 0 ? (
          <div className="border-t p-4 text-sm text-gray-600">No approvers found.</div>
        ) : (
          <div className="border-t divide-y">
            {approvers.map((a, idx) => (
              <div key={a.id ?? String(idx)} className="p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium truncate">
                    {a.email ?? a.user_id ?? "Unknown"}
                  </div>
                  <div className="text-sm text-gray-600">
                    Role: {a.role ?? "approver"} · Active: {String(a.is_active ?? true)}
                  </div>
                </div>
                <div className="text-xs text-gray-500 whitespace-nowrap">
                  Added: {fmtWhen(a.created_at)}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

