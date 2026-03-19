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
  return { orgId: String(mem.data.organisation_id), scope: "org:first-membership" as const };
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const limit = parseIntClamp(url.searchParams.get("limit"), 50, 1, 200);
    const orgIdParam = url.searchParams.get("orgId");

    const { orgId, scope } = await resolveOrgIdForUser(supabase, user.id, orgIdParam);

    // Step 1: Get all project IDs for this org (not pipeline)
    const { data: projectRows, error: projErr } = await supabase
      .from("projects")
      .select("id")
      .eq("organisation_id", orgId)
      .is("deleted_at", null);

    if (projErr) return err("Failed to load projects", 500, { error: projErr });

    const projectIds = (projectRows ?? []).map((p: any) => String(p.id)).filter(Boolean);

    if (!projectIds.length) {
      return ok({ orgId, scope, counts: { waiting: 0, at_risk: 0, breached: 0 }, items: [] });
    }

    const now = Date.now();
    const DAY = 24 * 60 * 60 * 1000;
    let items: any[] = [];
    let waiting = 0;
    let at_risk = 0;
    let breached = 0;

    // Strategy 1: artifact_approval_steps (charter / financial plan approvals)
    // Fix: get artifact IDs for org projects first, then query steps
    const { data: artifactRows, error: artErr } = await supabase
      .from("artifacts")
      .select("id, title, artifact_type, project_id")
      .in("project_id", projectIds)
      .is("deleted_at", null);

    if (!artErr && Array.isArray(artifactRows) && artifactRows.length > 0) {
      const artifactIds = artifactRows.map((a: any) => String(a.id)).filter(Boolean);
      const artifactMap = new Map<string, any>();
      for (const a of artifactRows) artifactMap.set(String(a.id), a);

      const { data: steps, error: stepsErr } = await supabase
        .from("artifact_approval_steps")
        .select("id, artifact_id, step_order, name, step_status, approver_type, approver_ref, due_at, created_at")
        .eq("step_status", "pending")
        .in("artifact_id", artifactIds)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(limit);

      if (!stepsErr && Array.isArray(steps)) {
        for (const s of steps) {
          waiting += 1;
          const dueAt = s?.due_at ? new Date(s.due_at).getTime() : null;
          const isBreached = typeof dueAt === "number" && dueAt < now;
          const isAtRisk = typeof dueAt === "number" && dueAt >= now && dueAt <= now + 3 * DAY;

          if (isBreached) breached += 1;
          else if (isAtRisk) at_risk += 1;

          const art = artifactMap.get(String(s.artifact_id)) ?? null;
          items.push({
            step_id: s.id,
            artifact_id: s.artifact_id,
            step_order: s.step_order,
            step_name: safeStr(s.name).trim(),
            due_at: s.due_at ?? null,
            risk: isBreached ? "breached" : isAtRisk ? "at_risk" : "waiting",
            source: "artifact_approval_steps",
            artifact: art ? {
              id: art.id,
              title: safeStr(art.title).trim(),
              artifact_type: safeStr(art.artifact_type).trim(),
            } : null,
            project: art ? { id: art.project_id, name: null } : null,
          });
        }
      }
    }

    // Strategy 2: approvals table (direct project approvals)
    {
      const { data: approvalRows, error: approvalErr } = await supabase
        .from("approvals")
        .select("id, title, status, type, project_id, created_at, due_at")
        .in("project_id", projectIds)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (!approvalErr && Array.isArray(approvalRows)) {
        for (const a of approvalRows) {
          waiting += 1;
          const dueAt = a?.due_at ? new Date(a.due_at).getTime() : null;
          const isBreached = typeof dueAt === "number" && dueAt < now;
          const isAtRisk = typeof dueAt === "number" && dueAt >= now && dueAt <= now + 3 * DAY;

          if (isBreached) breached += 1;
          else if (isAtRisk) at_risk += 1;

          items.push({
            step_id: a.id,
            artifact_id: a.id,
            step_order: 1,
            step_name: safeStr(a.type || a.title).trim() || "Approval",
            due_at: a.due_at ?? null,
            risk: isBreached ? "breached" : isAtRisk ? "at_risk" : "waiting",
            source: "approvals",
            artifact: {
              id: a.id,
              title: safeStr(a.title).trim(),
              artifact_type: safeStr(a.type).trim() || "approval",
            },
            project: { id: a.project_id, name: null },
          });
        }
      }
    }

    // Strategy 3: artifact_approvals table (if exists)
    {
      const { data: aaRows, error: aaErr } = await supabase
        .from("artifact_approvals")
        .select("id, artifact_id, status, created_at, due_at, approver_id")
        .in("project_id", projectIds)
        .eq("status", "pending")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (!aaErr && Array.isArray(aaRows)) {
        for (const a of aaRows) {
          // dedupe with artifact_approval_steps
          const alreadyCounted = items.some(i => i.artifact_id === a.artifact_id && i.source === "artifact_approval_steps");
          if (alreadyCounted) continue;

          waiting += 1;
          const dueAt = a?.due_at ? new Date(a.due_at).getTime() : null;
          const isBreached = typeof dueAt === "number" && dueAt < now;
          const isAtRisk = typeof dueAt === "number" && dueAt >= now && dueAt <= now + 3 * DAY;
          if (isBreached) breached += 1;
          else if (isAtRisk) at_risk += 1;

          items.push({
            step_id: a.id,
            artifact_id: a.artifact_id,
            step_order: 1,
            step_name: "Approval",
            due_at: a.due_at ?? null,
            risk: isBreached ? "breached" : isAtRisk ? "at_risk" : "waiting",
            source: "artifact_approvals",
            artifact: null,
            project: null,
          });
        }
      }
    }

    // Enrich project names where missing
    if (items.some(i => i.project?.id && !i.project?.name)) {
      const missingProjIds = [...new Set(
        items
          .filter(i => i.project?.id && !i.project?.name)
          .map(i => i.project.id)
      )];

      if (missingProjIds.length) {
        const { data: projNames } = await supabase
          .from("projects")
          .select("id, title, name")
          .in("id", missingProjIds);

        const nameMap = new Map<string, string>();
        for (const p of projNames ?? []) {
          nameMap.set(String(p.id), safeStr(p.title || p.name).trim() || "Project");
        }
        for (const item of items) {
          if (item.project?.id && !item.project?.name) {
            item.project.name = nameMap.get(item.project.id) ?? null;
          }
        }
      }
    }

    // Sort: breached first, then at_risk, then soonest due
    items.sort((a, b) => {
      const rw = (r: string) => r === "breached" ? 2 : r === "at_risk" ? 1 : 0;
      if (rw(b.risk) !== rw(a.risk)) return rw(b.risk) - rw(a.risk);
      const ad = a.due_at ? new Date(a.due_at).getTime() : Infinity;
      const bd = b.due_at ? new Date(b.due_at).getTime() : Infinity;
      return ad - bd;
    });

    return ok({ orgId, scope, counts: { waiting, at_risk, breached }, items });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const lc = msg.toLowerCase();
    const status = lc.includes("unauthorized") ? 401 : lc.includes("forbidden") ? 403 : 400;
    return err(msg, status);
  }
}