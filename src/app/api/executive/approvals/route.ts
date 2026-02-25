import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { resolveActiveOrgScope } from "@/lib/server/org-scope"; // adjust if your helper name differs

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- helpers ---------------- */

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

function jsonOk(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400, meta?: any) {
  return noStoreJson({ ok: false, error, meta }, { status });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function parseIntClamp(v: string | null, def: number, min: number, max: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

/* ---------------- route ---------------- */

/**
 * GET /api/executive/approvals?limit=50
 *
 * Returns org-scoped approval intelligence for Executive Cockpit:
 * - counts: waiting / at_risk / breached
 * - items: lightweight top bottlenecks list
 *
 * Notes:
 * - This is a LIVE aggregation (no cron dependency).
 * - “at_risk” and “breached” are computed from due_at if present.
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    const { data: u, error: ue } = await supabase.auth.getUser();
    if (ue || !u?.user) return jsonErr("Unauthorized", 401);

    // org scope (must exist in your codebase)
    // If your helper name/path is different, tell me and I’ll adjust.
    const scope = await resolveActiveOrgScope(supabase);
    if (!scope?.org_id) return jsonErr("No active organisation scope", 400);

    const url = new URL(req.url);
    const limit = parseIntClamp(url.searchParams.get("limit"), 50, 1, 200);

    // ----- Live pending approvals for this org -----
    // We join steps -> artifacts -> projects to filter by org_id.
    // We keep selection small to avoid heavy payloads.
    const { data: steps, error } = await supabase
      .from("artifact_approval_steps")
      .select(
        `
        id,
        artifact_id,
        step_order,
        name,
        step_status,
        approver_type,
        approver_ref,
        due_at,
        created_at,
        artifacts:artifact_id (
          id,
          title,
          artifact_type,
          project_id,
          projects:project_id (
            id,
            name,
            org_id
          )
        )
      `
      )
      .eq("step_status", "pending")
      .eq("artifacts.projects.org_id", scope.org_id) // relies on PostgREST embedded filter support
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) return jsonErr("Failed to load approvals", 500, { error });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

    // Risk rules (tunable):
    // - breached: due_at < now
    // - at_risk: due_at within next 3 days
    // - waiting: everything pending
    let waiting = 0;
    let at_risk = 0;
    let breached = 0;

    const items =
      (steps ?? []).map((s: any) => {
        waiting += 1;

        const dueAt = s?.due_at ? new Date(s.due_at).getTime() : null;
        const isBreached = typeof dueAt === "number" && dueAt < now;
        const isAtRisk =
          typeof dueAt === "number" && dueAt >= now && dueAt <= now + 3 * DAY;

        if (isBreached) breached += 1;
        else if (isAtRisk) at_risk += 1;

        const art = s?.artifacts ?? null;
        const proj = art?.projects ?? null;

        return {
          step_id: s.id,
          artifact_id: s.artifact_id,
          step_order: s.step_order,
          step_name: safeStr(s.name),
          due_at: s.due_at ?? null,
          risk: isBreached ? "breached" : isAtRisk ? "at_risk" : "waiting",
          artifact: art
            ? {
                id: art.id,
                title: safeStr(art.title),
                artifact_type: safeStr(art.artifact_type),
              }
            : null,
          project: proj
            ? {
                id: proj.id,
                name: safeStr(proj.name),
              }
            : null,
        };
      }) ?? [];

    return jsonOk({
      org_id: scope.org_id,
      counts: { waiting, at_risk, breached },
      items,
    });
  } catch (e: any) {
    return jsonErr("Server error", 500, { message: e?.message ?? String(e) });
  }
}
