// src/app/api/artifacts/[artifactId]/approval-chain/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ────────────────────────────────────────────────────────────── */
/* helpers */
/* ────────────────────────────────────────────────────────────── */

function noStore(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/* ────────────────────────────────────────────────────────────── */
/* GET approval chain (boardroom-grade safe) */
/* ────────────────────────────────────────────────────────────── */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const { artifactId } = await params;

    if (!artifactId) {
      return noStore({ ok: false, error: "Missing artifactId" }, 400);
    }

    const supabase = await createClient();

    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) {
      return noStore({ ok: false, error: "Unauthorized" }, 401);
    }

    /* ────────────────────────────────────────────────────────── */
    /* 1. Resolve ACTIVE chain first (governance source of truth) */
    /* ────────────────────────────────────────────────────────── */

    const { data: activeChain } = await supabase
      .from("approval_chains")
      .select("id, status, is_active, created_at")
      .eq("artifact_id", artifactId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const chainId = activeChain?.id ?? null;

    /* ────────────────────────────────────────────────────────── */
    /* 2. Load steps (prefer chain-bound, fallback to artifact)   */
    /* ────────────────────────────────────────────────────────── */

    let stepsRaw: any[] = [];

    if (chainId) {
      const { data: chainSteps, error: chainStepsErr } = await supabase
        .from("artifact_approval_steps")
        .select(`
          id,
          step_order,
          status,
          name,
          approved_at,
          approved_by,
          is_active,
          chain_id,
          min_approvals,
          pending_since
        `)
        .eq("chain_id", chainId)
        .order("step_order", { ascending: true });

      if (!chainStepsErr && Array.isArray(chainSteps)) {
        stepsRaw = chainSteps;
      }
    }

    /* fallback: artifact-based (safety net) */
    if (!stepsRaw.length) {
      const { data: fallbackSteps } = await supabase
        .from("artifact_approval_steps")
        .select(`
          id,
          step_order,
          status,
          name,
          approved_at,
          approved_by,
          is_active,
          chain_id,
          min_approvals,
          pending_since
        `)
        .eq("artifact_id", artifactId)
        .order("step_order", { ascending: true });

      stepsRaw = fallbackSteps ?? [];
    }

    if (!stepsRaw.length) {
      return noStore({
        ok: true,
        steps: [],
        chain: activeChain ?? null,
      });
    }

    /* ────────────────────────────────────────────────────────── */
    /* 3. Load approver slots                                    */
    /* ────────────────────────────────────────────────────────── */

    const stepIds = stepsRaw.map((s) => safeStr(s.id)).filter(Boolean);

    const { data: slotsRaw } = await supabase
      .from("approval_step_approvers")
      .select(`
        id,
        step_id,
        user_id,
        email,
        role,
        status,
        acted_at
      `)
      .in("step_id", stepIds);

    const slots = Array.isArray(slotsRaw) ? slotsRaw : [];

    /* group slots by step */
    const approversByStep = new Map<string, any[]>();

    for (const slot of slots) {
      const sid = safeStr(slot.step_id);
      if (!approversByStep.has(sid)) {
        approversByStep.set(sid, []);
      }
      approversByStep.get(sid)!.push(slot);
    }

    /* ────────────────────────────────────────────────────────── */
    /* 4. Resolve user names safely                              */
    /* ────────────────────────────────────────────────────────── */

    const userIds = [
      ...new Set(
        slots.map((s) => safeStr(s.user_id)).filter(Boolean)
      ),
    ];

    const nameMap = new Map<string, string>();

    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, user_id, full_name, email")
        .or(`user_id.in.(${userIds.join(",")}),id.in.(${userIds.join(",")})`);

      for (const p of profiles ?? []) {
        const uid = safeStr(p.user_id || p.id).trim();
        const name =
          safeStr(p.full_name).trim() ||
          safeStr(p.email).trim() ||
          "Approver";

        if (uid) nameMap.set(uid, name);
      }
    }

    /* enrich approvers */
    for (const [sid, slotList] of approversByStep.entries()) {
      approversByStep.set(
        sid,
        slotList.map((s: any) => ({
          ...s,
          name:
            nameMap.get(safeStr(s.user_id)) ||
            safeStr(s.email) ||
            "Approver",
        }))
      );
    }

    /* ────────────────────────────────────────────────────────── */
    /* 5. Build final response                                   */
    /* ────────────────────────────────────────────────────────── */

    const enrichedSteps = stepsRaw.map((step: any) => ({
      id: step.id,
      step_order: step.step_order,
      status: step.status,
      approval_role: step.name,
      approved_at: step.approved_at,
      approved_by: step.approved_by,
      is_active: step.is_active,
      min_approvals: step.min_approvals ?? 1,
      pending_since: step.pending_since ?? null,
      approvers: approversByStep.get(safeStr(step.id)) ?? [],
    }));

    return noStore({
      ok: true,
      steps: enrichedSteps,
      chain: activeChain ?? null,
    });
  } catch (e: any) {
    return noStore(
      {
        ok: false,
        error: e?.message ?? "Server error",
      },
      500
    );
  }
}