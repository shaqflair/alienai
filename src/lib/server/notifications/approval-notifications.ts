import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendApprovalAssignedEmail } from "./resend";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function toProjectRef(project: any, fallback: string) {
  const raw = safeStr(project?.project_code).trim();
  if (!raw) return fallback;

  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;

  return `P-${String(Math.floor(n)).padStart(5, "0")}`;
}

export async function notifyFirstStepApprovers(
  supabase: SupabaseClient,
  args: {
    projectId: string;
    artifactId: string;
    artifactTitle: string;
    artifactType: string;
    project: any;
    projectFallbackRef: string;
    submittedByName?: string | null;
  }
) {
  const baseUrl = process.env.APP_BASE_URL;
  if (!baseUrl) throw new Error("Missing env var: APP_BASE_URL");

  const { data: firstStep, error: firstStepErr } = await supabase
    .from("artifact_approval_steps")
    .select("id")
    .eq("artifact_id", args.artifactId)
    .eq("step_order", 1)
    .maybeSingle();

  if (firstStepErr) {
    throw new Error(`First approval step lookup failed: ${firstStepErr.message}`);
  }
  if (!firstStep?.id) return;

  const { data: approvers, error: approversErr } = await supabase
    .from("approval_step_approvers")
    .select("user_id, email")
    .eq("step_id", firstStep.id);

  if (approversErr) {
    throw new Error(`Approval step approvers lookup failed: ${approversErr.message}`);
  }

  const rows = Array.isArray(approvers) ? approvers : [];
  if (!rows.length) return;

  const userIds = Array.from(
    new Set(rows.map((r: any) => safeStr(r?.user_id).trim()).filter(Boolean))
  );

  const profileNameById = new Map<string, string>();
  if (userIds.length) {
    const { data: profiles, error: profilesErr } = await supabase
      .from("profiles")
      .select("id, user_id, full_name, display_name, name")
      .or(userIds.map((id) => `id.eq.${id},user_id.eq.${id}`).join(","));

    if (!profilesErr) {
      for (const p of profiles ?? []) {
        const key1 = safeStr((p as any)?.id).trim();
        const key2 = safeStr((p as any)?.user_id).trim();
        const fullName =
          safeStr((p as any)?.full_name).trim() ||
          safeStr((p as any)?.display_name).trim() ||
          safeStr((p as any)?.name).trim();

        if (fullName) {
          if (key1) profileNameById.set(key1, fullName);
          if (key2) profileNameById.set(key2, fullName);
        }
      }
    }
  }

  const projectTitle =
    safeStr(args.project?.title).trim() ||
    safeStr(args.project?.name).trim() ||
    "Project";

  const projectRef = toProjectRef(args.project, args.projectFallbackRef);

  const artifactUrl =
    `${baseUrl}/projects/${encodeURIComponent(projectRef)}/artifacts/${encodeURIComponent(args.artifactId)}`;

  for (const row of rows) {
    const to = safeStr((row as any)?.email).trim();
    const userId = safeStr((row as any)?.user_id).trim();
    if (!to) continue;

    await sendApprovalAssignedEmail({
      to,
      approverName: profileNameById.get(userId) || null,
      artifactTitle: args.artifactTitle,
      artifactType: args.artifactType,
      projectTitle,
      projectRef,
      artifactUrl,
      submittedByName: args.submittedByName ?? null,
    });
  }
}
