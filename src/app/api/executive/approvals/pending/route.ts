// src/app/api/executive/approvals/pending/route.ts
// Reads live from v_pending_artifact_approvals_all instead of stale exec_approval_cache
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { filterActiveProjectIds } from "@/lib/server/project-scope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function noStoreJson(data: unknown, init?: ResponseInit) {
  const res = NextResponse.json(data, init);
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqStrings(xs: any): string[] {
  const arr = Array.isArray(xs) ? xs : xs == null ? [] : [xs];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of arr) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

function clampDays(v: string | null): 7 | 14 | 30 | 60 {
  const s = safeStr(v).trim().toLowerCase();
  if (s === "all") return 60;
  const n = Number(s);
  for (const b of [7, 14, 30, 60] as const) {
    if (Number.isFinite(n) && n <= b) return b;
  }
  return 60;
}

async function normalizeActiveIds(supabase: any, rawIds: string[]) {
  try {
    const r: any = await filterActiveProjectIds(supabase, rawIds);
    const ids = Array.isArray(r) ? r.filter(Boolean)
      : Array.isArray(r?.projectIds) ? r.projectIds.filter(Boolean) : [];
    if (!ids.length && rawIds.length) return { ids: rawIds, ok: false, error: "active filter returned 0; failing open" };
    return { ids, ok: true, error: null as string | null };
  } catch (e: any) {
    return { ids: rawIds, ok: false, error: safeStr(e?.message || e) };
  }
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "200"), 1), 500);
    const days = clampDays(url.searchParams.get("days"));

    const supabase = await createClient();
    const { data: { user }, error: userErr } = await supabase.auth.getUser();
    if (userErr || !user) return noStoreJson({ ok: false, error: "unauthorized" }, { status: 401 });

    // Resolve org-wide scope
    const sharedScope = await resolvePortfolioScope(supabase, user.id);
    const organisationId = sharedScope.organisationId ?? null;
    const scopedRaw: string[] = Array.isArray(sharedScope.rawProjectIds)
      ? sharedScope.rawProjectIds
      : Array.isArray(sharedScope.projectIds) ? sharedScope.projectIds : [];

    const active = await normalizeActiveIds(supabase, scopedRaw);
    const scopedActive = active.ids;

    if (!scopedActive.length) {
      return noStoreJson({
        ok: true, scope: "portfolio", organisationId, days,
        source: "v_pending_artifact_approvals_all", items: [],
        meta: { scopeCounts: { scopedIdsRaw: scopedRaw.length, scopedIdsActive: 0 } },
      });
    }

    // Filter out pipeline projects
    const { data: nonPipelineRows } = await supabase
      .from("projects")
      .select("id")
      .in("id", scopedActive)
      .neq("resource_status", "pipeline")
      .is("deleted_at", null);

    const projectIds = uniqStrings((nonPipelineRows ?? []).map((p: any) => p.id));

    if (!projectIds.length) {
      return noStoreJson({
        ok: true, scope: "portfolio", organisationId, days,
        source: "v_pending_artifact_approvals_all", items: [],
        meta: { scopeCounts: { scopedIdsRaw: scopedRaw.length, scopedIdsActive: scopedActive.length, scopedIdsFiltered: 0 } },
      });
    }

    // Query the live view directly
    const { data: pending, error: pendingErr } = await supabase
      .from("v_pending_artifact_approvals_all")
      .select([
        "artifact_id", "project_id", "artifact_type", "title",
        "approval_status", "artifact_step_id", "chain_id",
        "step_order", "step_name", "step_status",
        "pending_user_id", "pending_email",
        "artifact_submitted_at", "step_pending_since",
      ].join(","))
      .in("project_id", projectIds)
      .limit(limit);

    if (pendingErr) {
      return noStoreJson({ ok: false, error: pendingErr.message }, { status: 500 });
    }

    const SLA_DAYS = 5;
    const now = Date.now();
    const DAY = 864e5;

    // Dedupe by step id
    const stepsSeen = new Set<string>();
    const items: any[] = [];

    for (const r of pending ?? []) {
      const stepId = safeStr(r.artifact_step_id).trim();
      if (stepId && stepsSeen.has(stepId)) continue;
      if (stepId) stepsSeen.add(stepId);

      const pendingSince = r.step_pending_since ?? r.artifact_submitted_at;
      const dueMs = pendingSince ? new Date(pendingSince).getTime() + SLA_DAYS * DAY : null;
      const slaStatus = !dueMs ? "ok"
        : now > dueMs ? "overdue"
        : (dueMs - now) <= 2 * DAY ? "at_risk"
        : "ok";

      items.push({
        // Fields matching exec_approval_cache shape so UI works unchanged
        project_id:     safeStr(r.project_id),
        project_title:  null, // enriched below
        project_code:   null, // enriched below
        approver_label: safeStr(r.pending_email || r.pending_user_id),
        sla_status,
        window_days:    days,
        computed_at:    pendingSince ?? null,
        // Extended fields
        artifact_id:    safeStr(r.artifact_id),
        artifact_type:  safeStr(r.artifact_type),
        title:          safeStr(r.title).trim() || "Untitled",
        step_id:        stepId || null,
        chain_id:       safeStr(r.chain_id) || null,
        step_name:      safeStr(r.step_name).trim() || "Approval",
      });
    }

    // Enrich project title + code
    if (items.length > 0) {
      const uniqueProjIds = [...new Set(items.map(i => i.project_id).filter(Boolean))];
      if (uniqueProjIds.length) {
        const { data: projRows } = await supabase
          .from("projects")
          .select("id, title, project_code")
          .in("id", uniqueProjIds);

        const projMap = new Map<string, any>();
        for (const p of projRows ?? []) projMap.set(String(p.id), p);

        for (const item of items) {
          const p = projMap.get(item.project_id);
          if (p) {
            item.project_title = safeStr(p.title).trim() || null;
            item.project_code  = p.project_code ?? null;
          }
        }
      }
    }

    return noStoreJson({
      ok: true,
      scope: "portfolio",
      organisationId,
      days,
      source: "v_pending_artifact_approvals_all",
      items,
      meta: {
        total: items.length,
        window_days: days,
        scopeCounts: {
          scopedIdsRaw:      scopedRaw.length,
          scopedIdsActive:   scopedActive.length,
          scopedIdsFiltered: projectIds.length,
        },
        active_filter_ok:    active.ok,
        active_filter_error: active.error,
      },
    });
  } catch (e: any) {
    return noStoreJson(
      { ok: false, error: "pending_approvals_failed", message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}