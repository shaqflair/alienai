// src/app/api/ai/pending-approvals/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/* ---------------- response helpers ---------------- */

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, proxy-revalidate"
  );
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(v)));
}

function norm(x: any) {
  return safeStr(x).trim();
}

/* ---------------- auth helpers ---------------- */

async function requireUser(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

/**
 * Executive visibility (your org roles):
 * - owner/admin = org-wide
 * - member      = project-scoped
 */
async function isOrgExec(supabase: any, orgId: string, userId: string) {
  const { data, error } = await supabase
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const role = safeStr(data?.role).toLowerCase();
  return role === "owner" || role === "admin";
}

/* ---------------- GET ---------------- */

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const orgId = norm(url.searchParams.get("orgId"));
    const projectId = norm(url.searchParams.get("projectId"));
    const pmId = norm(url.searchParams.get("pmId"));
    const q = norm(url.searchParams.get("q"));
    const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);

    if (!orgId) {
      return jsonErr("Missing orgId", 400, {
        hint: "Pass ?orgId=<organisation uuid>",
      });
    }

    const exec = await isOrgExec(supabase, orgId, user.id);

    // PM filter -> resolve project ids for that PM in org
    let pmProjectIds: string[] | null = null;
    if (pmId) {
      const { data: pmProjects, error: pmErr } = await supabase
        .from("projects")
        .select("id")
        .eq("organisation_id", orgId)
        .eq("project_manager_id", pmId)
        .is("deleted_at", null);

      if (pmErr) throw new Error(pmErr.message);

      pmProjectIds = (pmProjects ?? []).map((r: any) => r.id).filter(Boolean);

      if (!pmProjectIds.length) {
        return jsonOk({
          scope: exec ? "org_exec" : "project_member",
          radar: { overdue: 0, warn: 0, ok: 0 },
          items: [],
        });
      }
    }

    // Non-exec users -> restrict to active project memberships
    let memberProjectIds: string[] | null = null;
    if (!exec) {
      const { data: memberships, error: memErr } = await supabase
        .from("project_members")
        .select("project_id")
        .eq("user_id", user.id)
        .is("removed_at", null);

      if (memErr) throw new Error(memErr.message);

      memberProjectIds = (memberships ?? [])
        .map((r: any) => r.project_id)
        .filter(Boolean);

      if (!memberProjectIds.length) {
        return jsonOk({
          scope: "project_member",
          radar: { overdue: 0, warn: 0, ok: 0 },
          items: [],
        });
      }
    }

    const base = () =>
      supabase
        .from("v_exec_approval_sla_radar")
        .select(
          [
            "organisation_id",
            "project_id",
            "project_code",
            "project_title",
            "artifact_id",
            "artifact_type",
            "artifact_title",
            "approval_status",
            "chain_id",
            "artifact_step_id",
            "step_order",
            "step_name",
            "pending_since",
            "stage_key",
            "approver_type",
            "approver_ref",
            "pending_user_id",
            "pending_email",
            "sla_hours",
            "warn_hours",
            "age_hours",
            "sla_state",
          ].join(",")
        )
        .eq("organisation_id", orgId);

    const applyFilters = (qb: any) => {
      let out = qb;

      if (projectId) out = out.eq("project_id", projectId);
      if (pmProjectIds) out = out.in("project_id", pmProjectIds);
      if (memberProjectIds) out = out.in("project_id", memberProjectIds);

      if (q) {
        const like = `%${q.replace(/%/g, "\\%").replace(/_/g, "\\_")}%`;
        out = out.or(
          `project_code.ilike.${like},project_title.ilike.${like},artifact_title.ilike.${like}`
        );
      }

      return out;
    };

    const countState = async (state: "overdue" | "warn" | "ok") => {
      const { count, error } = await applyFilters(base())
        .eq("sla_state", state)
        .select("artifact_id", { count: "exact", head: true });

      if (error) throw new Error(error.message);
      return count ?? 0;
    };

    const [overdue, warn, ok] = await Promise.all([
      countState("overdue"),
      countState("warn"),
      countState("ok"),
    ]);

    const { data: items, error: itemsErr } = await applyFilters(base())
      .order("age_hours", { ascending: false })
      .limit(limit);

    if (itemsErr) throw new Error(itemsErr.message);

    return jsonOk({
      scope: exec ? "org_exec" : "project_member",
      radar: { overdue, warn, ok },
      items: items ?? [],
    });
  } catch (e: any) {
    return jsonErr(e?.message || "Server error", 500);
  }
}