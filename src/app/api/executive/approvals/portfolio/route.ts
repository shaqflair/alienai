import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { clampDays, daysWaiting, orgIdsForUser, requireUser, riskState, safeStr, num } from "../_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const scope = safeStr(url.searchParams.get("scope") || "all").toLowerCase() === "org" ? "org" : "all";

    const orgIds = await orgIdsForUser(user.id);
    if (!orgIds.length) return jsonOk({ days, scope, counts: { pending: 0, at_risk: 0, breached: 0 }, projects: [] });

    // 1) Prefer cache if populated
    let cacheRows: any[] | null = null;
    {
      const { data } = await supabase
        .from("exec_approval_cache")
        .select("*")
        .in("org_id", orgIds)
        .limit(2000);
      cacheRows = Array.isArray(data) && data.length ? data : null;
    }

    const now = Date.now();
    const windowStart = now - days * 86400_000;

    const rows = cacheRows
      ? cacheRows
      : (
          await supabase
            .from("v_pending_artifact_approvals")
            .select("*")
            .in("org_id", orgIds)
            .limit(5000)
        ).data || [];

    // Normalize shape
    const items = (Array.isArray(rows) ? rows : [])
      .map((r: any) => {
        const created_at =
          safeStr(r?.created_at) ||
          safeStr(r?.task_created_at) ||
          safeStr(r?.pending_since) ||
          "";

        const createdMs = created_at ? new Date(created_at).getTime() : NaN;
        if (Number.isFinite(createdMs) && createdMs < windowStart) return null;

        const sla_due_at =
          safeStr(r?.sla_due_at) ||
          safeStr(r?.due_at) ||
          safeStr(r?.slaDueAt) ||
          null;

        const risk = riskState(now, sla_due_at);

        const project_id = safeStr(r?.project_id || r?.projectId);
        const project_code = safeStr(r?.project_code || r?.project_human_id || r?.projectCode);
        const project_title = safeStr(r?.project_title || r?.project_name || r?.title);

        const stage =
          safeStr(r?.stage_name) ||
          safeStr(r?.step_name) ||
          safeStr(r?.approval_step_name) ||
          safeStr(r?.group_name) ||
          "Approval";

        const approver_label =
          safeStr(r?.approver_label) ||
          safeStr(r?.approver_name) ||
          safeStr(r?.approval_group_name) ||
          safeStr(r?.group_name) ||
          "Unassigned";

        return {
          project_id,
          project_code: project_code || null,
          project_title: project_title || "Project",
          stage,
          approver_label,
          sla_due_at,
          created_at: created_at || null,
          days_waiting: daysWaiting(created_at),
          risk_state: risk.state,
          rag: risk.rag,
        };
      })
      .filter(Boolean) as any[];

    // Aggregate to project-level “blocked” summary
    const byProject = new Map<string, any>();
    for (const it of items) {
      const pid = safeStr(it.project_id).trim() || safeStr(it.project_code).trim() || it.project_title;
      if (!pid) continue;

      const existing = byProject.get(pid);
      if (!existing) {
        byProject.set(pid, { ...it });
        continue;
      }

      // choose “worst” rag: R > A > G
      const rank = (r: string) => (r === "R" ? 3 : r === "A" ? 2 : 1);
      if (rank(it.rag) > rank(existing.rag)) byProject.set(pid, { ...existing, ...it });

      // if same rag, prefer longer waiting
      if (rank(it.rag) === rank(existing.rag) && num(it.days_waiting) > num(existing.days_waiting)) {
        byProject.set(pid, { ...existing, ...it });
      }
    }

    const projects = Array.from(byProject.values()).sort((a, b) => {
      const rank = (r: string) => (r === "R" ? 3 : r === "A" ? 2 : 1);
      const ra = rank(a.rag);
      const rb = rank(b.rag);
      if (ra !== rb) return rb - ra;
      return num(b.days_waiting) - num(a.days_waiting);
    });

    const counts = {
      pending: projects.length,
      at_risk: projects.filter((p) => p.risk_state === "at_risk").length,
      breached: projects.filter((p) => p.risk_state === "breached").length,
    };

    return jsonOk({ days, scope, counts, projects });
  } catch (e: any) {
    return jsonErr(e?.message || "Failed", 500);
  }
}
