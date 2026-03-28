// src/app/api/artifacts/[artifactId]/approval-chain/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function noStore(data: any, status = 200) {
  const res = NextResponse.json(data, { status });
  res.headers.set("Cache-Control", "no-store, no-cache");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ artifactId: string }> }
) {
  try {
    const { artifactId } = await params;
    if (!artifactId) return noStore({ ok: false, error: "Missing artifactId" }, 400);

    const supabase = await createClient();
    const { data: auth, error: authErr } = await supabase.auth.getUser();
    if (authErr || !auth?.user) return noStore({ ok: false, error: "Unauthorized" }, 401);

    // Query steps directly by artifact_id (no chain lookup needed)
    const { data: stepsRaw, error: stepsErr } = await supabase
      .from("artifact_approval_steps")
      .select("id, step_order, status, name, approved_at, approved_by, is_active, chain_id, min_approvals")
      .eq("artifact_id", artifactId)
      .order("step_order", { ascending: true });

    if (stepsErr) {
      // Fallback: try via chain
      const { data: chain } = await supabase
        .from("approval_chains")
        .select("id, status")
        .eq("artifact_id", artifactId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!chain?.id) return noStore({ ok: true, steps: [], chain: null });

      const { data: chainSteps } = await supabase
        .from("artifact_approval_steps")
        .select("id, step_order, status, name, approved_at, approved_by, is_active, min_approvals")
        .eq("chain_id", chain.id)
        .order("step_order", { ascending: true });

      return noStore({ ok: true, steps: chainSteps ?? [], chain });
    }

    const steps = Array.isArray(stepsRaw) ? stepsRaw : [];
    if (!steps.length) return noStore({ ok: true, steps: [], chain: null });

    const stepIds = steps.map((s: any) => safeStr(s.id)).filter(Boolean);

    // Get approver slots
    const { data: slots } = await supabase
      .from("approval_step_approvers")
      .select("id, step_id, user_id, email, role, status, acted_at")
      .in("step_id", stepIds);

    const approversByStep = new Map<string, any[]>();
    for (const slot of slots ?? []) {
      const sid = safeStr(slot.step_id);
      if (!approversByStep.has(sid)) approversByStep.set(sid, []);
      approversByStep.get(sid)!.push(slot);
    }

    // Enrich with profile names
    const userIds = [...new Set((slots ?? []).map((s: any) => safeStr(s.user_id)).filter(Boolean))];
    if (userIds.length) {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, id, full_name, email")
        .or(`user_id.in.(${userIds.join(",")}),id.in.(${userIds.join(",")})`);

      const nameMap = new Map<string, string>();
      for (const p of profiles ?? []) {
        const uid = safeStr(p.user_id || p.id).trim();
        const name = safeStr(p.full_name).trim() || safeStr(p.email).trim();
        if (uid && name) nameMap.set(uid, name);
      }

      for (const [sid, slotList] of approversByStep.entries()) {
        approversByStep.set(sid, slotList.map((s: any) => ({
          ...s,
          name: nameMap.get(safeStr(s.user_id)) || safeStr(s.email) || "Approver",
        })));
      }
    }

    const enrichedSteps = steps.map((step: any) => ({
      id: step.id,
      step_order: step.step_order,
      status: step.status,
      approval_role: step.name,
      approved_at: step.approved_at,
      is_active: step.is_active,
      approvers: approversByStep.get(safeStr(step.id)) ?? [],
    }));

    return noStore({ ok: true, steps: enrichedSteps, chain: null });
  } catch (e: any) {
    return noStore({ ok: false, error: e?.message ?? "Server error" }, 500);
  }
}