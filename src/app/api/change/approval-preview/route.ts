import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { sb, requireUser, requireProjectRole } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

type PreviewApprover = {
  user_id?: string | null;
  email?: string | null;
  role?: string | null;
};

type PreviewStep = {
  step: number;
  label: string;
  mode: string;
  threshold?: number | null;
  requires_all?: boolean;
  min_approvals?: number | null;
  approvers: PreviewApprover[];
  source: "template" | "artifact";
};

export async function POST(req: Request) {
  const supabase = sb();

  try {
    await requireUser(supabase);

    const body = await req.json();
    const projectId: string | null = body?.projectId ?? null;
    const artifactType: string = body?.artifactType ?? "change_request";

    const artifactIdFromBody: string | null = body?.artifactId ?? null;
    const changeRequestId: string | null = body?.changeRequestId ?? null;

    if (!projectId) {
      return NextResponse.json({ error: "Missing projectId" }, { status: 400 });
    }

    await requireProjectRole(supabase, projectId, ["owner", "editor", "viewer"]);

    // 1) Active chain for project + artifact_type
    const { data: chain, error: chainErr } = await supabase
      .from("approval_chains")
      .select("id, project_id, artifact_type, is_active")
      .eq("project_id", projectId)
      .eq("artifact_type", artifactType)
      .eq("is_active", true)
      .maybeSingle();

    if (chainErr) throw chainErr;

    if (!chain) {
      return NextResponse.json({
        required: false,
        chain: [],
        notes: `No active approval chain for artifact_type="${artifactType}".`,
      });
    }

    // 2) Resolve artifactId
    let artifactId: string | null = artifactIdFromBody;

    if (!artifactId && changeRequestId) {
      const { data: cr, error: crErr } = await supabase
        .from("change_requests")
        .select("artifact_id, project_id")
        .eq("id", changeRequestId)
        .maybeSingle();

      if (crErr) throw crErr;

      // (optional safety) ensure the CR is for this project
      if (cr?.project_id && cr.project_id !== projectId) {
        return NextResponse.json({ error: "changeRequestId not in project" }, { status: 403 });
      }

      artifactId = cr?.artifact_id ?? null;
    }

    // 3) If we have artifactId, prefer runtime steps (artifact_approval_steps)
    if (artifactId) {
      const { data: artSteps, error: artErr } = await supabase
        .from("artifact_approval_steps")
        .select(
          "id, artifact_id, step_order, name, mode, min_approvals, round, status, approval_step_id, chain_id"
        )
        .eq("artifact_id", artifactId)
        .eq("chain_id", chain.id)
        .order("step_order", { ascending: true });

      if (artErr) throw artErr;

      if (artSteps && artSteps.length) {
        const templateStepIds = artSteps
          .map((s: any) => s.approval_step_id)
          .filter(Boolean);

        const approversByTemplateStep = new Map<string, PreviewApprover[]>();

        if (templateStepIds.length) {
          const { data: appr, error: apprErr } = await supabase
            .from("approval_step_approvers")
            .select("step_id, user_id, email, role")
            .in("step_id", templateStepIds);

          if (apprErr) throw apprErr;

          for (const a of appr || []) {
            const arr = approversByTemplateStep.get(a.step_id) ?? [];
            arr.push({
              user_id: a.user_id ?? null,
              email: a.email ?? null,
              role: a.role ?? null,
            });
            approversByTemplateStep.set(a.step_id, arr);
          }
        }

        const preview: PreviewStep[] = artSteps.map((s: any) => ({
          step: Number(s.step_order),
          label: s.name || `Step ${s.step_order}`,
          mode: String(s.mode || "VETO_QUORUM"),
          min_approvals: s.min_approvals ?? null,
          threshold: null,
          requires_all: true,
          approvers: s.approval_step_id
            ? approversByTemplateStep.get(s.approval_step_id) ?? []
            : [],
          source: "artifact",
        }));

        return NextResponse.json({
          required: preview.length > 0,
          chain: preview,
          notes: null,
          meta: { approval_chain_id: chain.id, source: "artifact_steps", artifactId },
        });
      }
    }

    // 4) Otherwise preview template steps (approval_steps)
    // NOTE: your approval_steps.project_id is actually chain_id (FK to approval_chains.id)
    const { data: steps, error: stepsErr } = await supabase
      .from("approval_steps")
      .select("id, step_order, step_name, mode, threshold, requires_all, min_approvals, is_active")
      .eq("project_id", chain.id)
      .eq("is_active", true)
      .order("step_order", { ascending: true });

    if (stepsErr) throw stepsErr;

    const stepIds = (steps || []).map((s: any) => s.id);

    const { data: approvers, error: apprErr } = await supabase
      .from("approval_step_approvers")
      .select("step_id, user_id, email, role")
      .in("step_id", stepIds.length ? stepIds : ["00000000-0000-0000-0000-000000000000"]);

    if (apprErr) throw apprErr;

    const byStep = new Map<string, PreviewApprover[]>();
    for (const a of approvers || []) {
      const arr = byStep.get(a.step_id) ?? [];
      arr.push({
        user_id: a.user_id ?? null,
        email: a.email ?? null,
        role: a.role ?? null,
      });
      byStep.set(a.step_id, arr);
    }

    const preview: PreviewStep[] = (steps || []).map((s: any) => ({
      step: Number(s.step_order),
      label: s.step_name || `Step ${s.step_order}`,
      mode: String(s.mode),
      threshold: s.threshold ?? null,
      requires_all: !!s.requires_all,
      min_approvals: s.min_approvals ?? null,
      approvers: byStep.get(s.id) ?? [],
      source: "template",
    }));

    return NextResponse.json({
      required: preview.length > 0,
      chain: preview,
      notes: preview.length ? null : "Chain is active but has no active steps.",
      meta: { approval_chain_id: chain.id, source: "template_steps" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || "Approval preview failed" },
      { status: 500 }
    );
  }
}

