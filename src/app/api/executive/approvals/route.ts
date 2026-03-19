// src/app/api/executive/approvals/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { sb, requireAuth, safeStr } from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

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

  const mem = await supabase
    .from("organisation_members")
    .select("organisation_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mem.error) throw new Error(mem.error.message);
  if (!mem.data?.organisation_id) throw new Error("No organisation membership");

  return {
    orgId: String(mem.data.organisation_id),
    scope: "org:first-membership" as const,
  };
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const limit = parseIntClamp(url.searchParams.get("limit"), 200, 1, 500);
    const orgIdParam = url.searchParams.get("orgId");

    const { orgId, scope } = await resolveOrgIdForUser(supabase, user.id, orgIdParam);

    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("id")
      .eq("organisation_id", orgId)
      .is("deleted_at", null)
      .neq("resource_status", "pipeline");

    if (projErr) {
      return err("Failed to load projects", 500, { error: projErr.message });
    }

    const projectIds = (projectRows ?? [])
      .map((p: any) => safeStr(p.id))
      .filter(Boolean);

    if (!projectIds.length) {
      return ok({
        orgId,
        scope,
        counts: {
          pending: 0,
          waiting: 0,
          at_risk: 0,
          breached: 0,
        },
        items: [],
      });
    }

    const { data: pending, error: pendingErr } = await supabase
      .from("v_pending_artifact_approvals_all")
      .select(
        [
          "artifact_id",
          "project_id",
          "artifact_type",
          "title",
          "approval_status",
          "artifact_step_id",
          "chain_id",
          "step_order",
          "step_name",
          "step_status",
          "pending_user_id",
          "pending_email",
          "artifact_submitted_at",
          "step_pending_since",
        ].join(",")
      )
      .in("project_id", projectIds)
      .limit(limit);

    if (pendingErr) {
      return err("Failed to load pending approvals", 500, { error: pendingErr.message });
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    const SLA_DAYS = 5;

    const stepsSeen = new Set<string>();
    const items: any[] = [];

    let waiting = 0;
    let at_risk = 0;
    let breached = 0;

    for (const r of pending ?? []) {
      const stepId = safeStr(r.artifact_step_id).trim();
      if (stepId && stepsSeen.has(stepId)) continue;
      if (stepId) stepsSeen.add(stepId);

      const pendingSince = r.step_pending_since ?? r.artifact_submitted_at ?? null;

      const dueMs = pendingSince
        ? new Date(pendingSince).getTime() + SLA_DAYS * DAY
        : null;

      const isBreached = dueMs != null && dueMs < now;
      const isAtRisk = dueMs != null && !isBreached && dueMs <= now + 2 * DAY;
      const risk = isBreached ? "breached" : isAtRisk ? "at_risk" : "waiting";

      waiting += 1;
      if (isBreached) breached += 1;
      else if (isAtRisk) at_risk += 1;

      items.push({
        step_id: stepId || safeStr(r.artifact_id),
        artifact_id: safeStr(r.artifact_id),
        chain_id: safeStr(r.chain_id) || null,
        step_order: Number(r.step_order ?? 1),
        step_name: safeStr(r.step_name).trim() || "Approval",
        due_at: dueMs ? new Date(dueMs).toISOString() : null,
        pending_since: pendingSince,
        risk,
        artifact: {
          id: safeStr(r.artifact_id),
          title: safeStr(r.title).trim() || "Untitled",
          artifact_type: safeStr(r.artifact_type).trim(),
          approval_status: safeStr(r.approval_status).trim(),
        },
        project: {
          id: safeStr(r.project_id),
          name: null,
        },
        approver: {
          user_id: safeStr(r.pending_user_id) || null,
          email: safeStr(r.pending_email) || null,
        },
      });
    }

    if (items.length > 0) {
      const uniqueProjIds = [...new Set(items.map((i) => i.project.id).filter(Boolean))];

      if (uniqueProjIds.length) {
        const { data: projNames, error: projNamesErr } = await supabase
          .from("projects")
          .select("id, title")
          .in("id", uniqueProjIds);

        if (projNamesErr) {
          return err("Failed to load project names", 500, { error: projNamesErr.message });
        }

        const nameMap = new Map<string, string>();
        for (const p of projNames ?? []) {
          nameMap.set(safeStr(p.id), safeStr(p.title).trim() || "Project");
        }

        for (const item of items) {
          if (item.project?.id) {
            item.project.name = nameMap.get(item.project.id) ?? null;
          }
        }
      }
    }

    items.sort((a, b) => {
      const rw = (r: string) => (r === "breached" ? 2 : r === "at_risk" ? 1 : 0);
      if (rw(b.risk) !== rw(a.risk)) return rw(b.risk) - rw(a.risk);

      const ad = a.pending_since ? new Date(a.pending_since).getTime() : Infinity;
      const bd = b.pending_since ? new Date(b.pending_since).getTime() : Infinity;
      return ad - bd;
    });

    return ok({
      orgId,
      scope,
      counts: {
        pending: waiting,
        waiting,
        at_risk,
        breached,
      },
      items,
    });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const lc = msg.toLowerCase();
    const status = lc.includes("unauthorized")
      ? 401
      : lc.includes("forbidden")
        ? 403
        : 400;

    return err(msg, status);
  }
}