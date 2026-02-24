// app/api/ai/pending-approvals/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createRouteHandlerClient } from "@supabase/auth-helpers-nextjs";
import type { Database } from "@/types/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PendingApprovalRow = Record<string, any>;

function noStoreJson(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, {
    ...(init ?? {}),
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
      ...(init?.headers ?? {}),
    },
  });
}

async function resolveActiveOrgId(supabase: ReturnType<typeof createRouteHandlerClient<Database>>) {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    return { user: null, orgId: null, error: userErr ?? new Error("Unauthenticated") };
  }

  // Single-org mode: org is derived from profiles.active_organisation_id
  const { data: profile, error: profileErr } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileErr) {
    return { user, orgId: null, error: profileErr };
  }

  const orgId = profile?.active_organisation_id ?? null;
  if (!orgId) {
    return { user, orgId: null, error: new Error("No active organisation set for user") };
  }

  return { user, orgId, error: null };
}

async function isExecutiveForOrg(
  supabase: ReturnType<typeof createRouteHandlerClient<Database>>,
  userId: string,
  orgId: string
) {
  // Best-effort: treat "owner" (or an org-level executive role if you add one later) as executive.
  // Since project_members is per-project, we infer executive if user is owner on ANY active project in org.
  // This keeps single-org clean without requiring an org_members table.
  const { data: ownerProject, error } = await supabase
    .from("project_members")
    .select("id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId)
    .limit(1)
    .maybeSingle();

  if (error) return { isExec: false, error };
  return { isExec: !!ownerProject, error: null };
}

async function getMyProjectIdsInOrg(
  supabase: ReturnType<typeof createRouteHandlerClient<Database>>,
  userId: string,
  orgId: string
) {
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId);

  if (error) return { projectIds: [] as string[], error };
  const projectIds = (data ?? []).map((r) => r.project_id).filter(Boolean) as string[];
  return { projectIds, error: null };
}

async function callExecPendingApprovalsRPC(
  supabase: ReturnType<typeof createRouteHandlerClient<Database>>,
  orgId: string
) {
  // Prefer org-scoped RPC signature: exec_pending_approvals(org_id uuid)
  const first = await supabase.rpc("exec_pending_approvals", { org_id: orgId } as any);

  if (!first.error) return first as { data: PendingApprovalRow[] | null; error: null };

  // Fallback: some installs may have exec_pending_approvals() without params (older version)
  const msg = (first.error as any)?.message ?? "";
  const hint = (first.error as any)?.hint ?? "";
  const code = (first.error as any)?.code ?? "";

  const looksLikeSignatureMismatch =
    msg.toLowerCase().includes("function") && msg.toLowerCase().includes("does not exist") ||
    msg.toLowerCase().includes("invalid input syntax") ||
    hint.toLowerCase().includes("no function matches") ||
    code === "42883";

  if (!looksLikeSignatureMismatch) {
    return { data: null, error: first.error };
  }

  const second = await supabase.rpc("exec_pending_approvals");
  if (second.error) return { data: null, error: second.error };

  return second as { data: PendingApprovalRow[] | null; error: null };
}

function filterToMyProjects(rows: PendingApprovalRow[], myProjectIds: string[]) {
  if (!Array.isArray(rows) || myProjectIds.length === 0) return [];
  const allowed = new Set(myProjectIds);

  // Common keys we’ve seen in approval payloads
  const projectKeys = ["project_id", "projectId", "project_uuid", "project_uuid"];

  return rows.filter((r) => {
    for (const k of projectKeys) {
      const v = r?.[k];
      if (typeof v === "string" && allowed.has(v)) return true;
    }
    return false;
  });
}

export async function GET() {
  const supabase = createRouteHandlerClient<Database>({ cookies });

  const { user, orgId, error: orgErr } = await resolveActiveOrgId(supabase);
  if (orgErr || !user || !orgId) {
    return noStoreJson(
      { error: "unauthorized", message: orgErr?.message ?? "Unauthorized" },
      { status: 401 }
    );
  }

  const { isExec, error: execErr } = await isExecutiveForOrg(supabase, user.id, orgId);
  if (execErr) {
    return noStoreJson(
      { error: "failed_role_check", message: (execErr as any)?.message ?? "Role check failed" },
      { status: 500 }
    );
  }

  const { data, error: rpcErr } = await callExecPendingApprovalsRPC(supabase, orgId);
  if (rpcErr) {
    return noStoreJson(
      { error: "rpc_failed", message: (rpcErr as any)?.message ?? "RPC failed" },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as PendingApprovalRow[];

  if (isExec) {
    return noStoreJson({ orgId, scope: "org", items: rows });
  }

  // PM/member: only approvals from projects they belong to
  const { projectIds, error: projectsErr } = await getMyProjectIdsInOrg(supabase, user.id, orgId);
  if (projectsErr) {
    return noStoreJson(
      { error: "project_lookup_failed", message: (projectsErr as any)?.message ?? "Project lookup failed" },
      { status: 500 }
    );
  }

  const scoped = filterToMyProjects(rows, projectIds);
  return noStoreJson({ orgId, scope: "member", items: scoped });
}