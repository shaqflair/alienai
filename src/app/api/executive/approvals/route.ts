// src/app/api/executive/approvals/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { sb, requireAuth, safeStr } from "@/lib/approvals/admin-helpers";

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

function ok(data: any, status = 200) {
  return noStoreJson({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400, meta?: any) {
  return noStoreJson({ ok: false, error: msg, ...(meta ? { meta } : {}) }, { status });
}

function parseIntClamp(v: string | null, def: number, min: number, max: number) {
  const n = Number.parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

async function resolveOrgIdForUser(supabase: any, userId: string, requestedOrgId: string | null) {
  // If caller supplies orgId, verify membership and use it
  const reqOrg = safeStr(requestedOrgId).trim();
  if (reqOrg) {
    const m = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("organisation_id", reqOrg)
      .eq("user_id", userId)
      .maybeSingle();
    if (m.error) throw new Error(m.error.message);
    if (!m.data) throw new Error("Forbidden: not a member of requested org");
    return { orgId: reqOrg, scope: "org:param" as const };
  }

  // Single-org fallback: first org membership
  const mem = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mem.error) throw new Error(mem.error.message);
  if (!mem.data?.organisation_id) throw new Error("No organisation membership");
  return { orgId: String(mem.data.organisation_id), scope: "org:first-membership" as const };
}

/* ---------------- route ---------------- */

/**
 * GET /api/executive/approvals?limit=50&orgId=...
 * Returns org-scoped approval counts + top items (live, no cron dependency).
 */
export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const limit = parseIntClamp(url.searchParams.get("limit"), 50, 1, 200);
    const orgIdParam = url.searchParams.get("orgId");

    const { orgId, scope } = await resolveOrgIdForUser(supabase, user.id, orgIdParam);

    // Live pending approvals joined to org via artifacts->projects
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
            organisation_id
          )
        )
      `
      )
      .eq("step_status", "pending")
      .eq("artifacts.projects.organisation_id", orgId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(limit);

    if (error) return err("Failed to load approvals", 500, { error });

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;

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
          step_name: safeStr(s.name).trim(),
          due_at: s.due_at ?? null,
          risk: isBreached ? "breached" : isAtRisk ? "at_risk" : "waiting",
          artifact: art
            ? {
                id: art.id,
                title: safeStr(art.title).trim(),
                artifact_type: safeStr(art.artifact_type).trim(),
              }
            : null,
          project: proj
            ? {
                id: proj.id,
                name: safeStr(proj.name).trim(),
              }
            : null,
        };
      }) ?? [];

    return ok({
      orgId,
      scope,
      counts: { waiting, at_risk, breached },
      items,
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const lc = msg.toLowerCase();
    const status = lc.includes("unauthorized") ? 401 : lc.includes("forbidden") ? 403 : 400;
    return err(msg, status);
  }
}