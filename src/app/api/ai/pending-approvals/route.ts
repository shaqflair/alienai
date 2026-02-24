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
 * If orgId isn't provided, pick the first active org membership for the user.
 */
async function resolveOrgId(
  supabase: any,
  explicitOrgId: string | null,
  userId: string
) {
  const orgId = norm(explicitOrgId);
  if (orgId) return orgId;

  const { data, error } = await supabase
    .from("organisation_members")
    .select("organisation_id, created_at")
    .eq("user_id", userId)
    .is("removed_at", null)
    .order("created_at", { ascending: true })
    .limit(1);

  if (error) throw new Error(error.message);

  const first = data?.[0]?.organisation_id;
  if (!first) throw new Error("No organisation membership found");
  return String(first);
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

    const orgId = await resolveOrgId(
      supabase,
      url.searchParams.get("orgId"),
      user.id
    );

    const projectId = norm(url.searchParams.get("projectId"));
    const pmId = norm(url.searchParams.get("pmId"));
    const q = norm(url.searchParams.get("q"));
    const limit = clampInt(url.searchParams.get("limit"), 1, 200, 50);

    const exec = await isOrgExec(supabase, orgId, user.id);

    /* =========================================================
       EXEC PATH (owner/admin)
       ✅ Use SECURITY DEFINER RPC to bypass RLS blanking
    ========================================================= */

    if (exec) {
      const { data: rows, error: rpcErr } = await supabase.rpc(
        "exec_pending_approvals",
        {
          p_org_id: orgId,
          p_limit: limit,
        }
      );

      if (rpcErr) throw new Error(rpcErr.message);

      const items = (rows ?? []) as any[];

      let overdue = 0;
      let warn = 0;
      let ok = 0;

      for (const it of items) {
        const s = safeStr(it?.sla_state);
        if (s === "overdue") overdue += 1;
        else if (s === "warn") warn += 1;
        else if (s === "ok") ok += 1;
      }

      // Optional client-side search filter (RPC already returns top N)
      let filtered = items;
      if (q) {
        const ql = q.toLowerCase();
        filtered = items.filter((it) => {
          const pc = safeStr(it?.project_code).toLowerCase();
          const pt = safeStr(it?.project_title).toLowerCase();
          const at = safeStr(it?.artifact_title).toLowerCase();
          return pc.includes(ql) || pt.includes(ql) || at.includes(ql);
        });
      }
      if (projectId) filtered = filtered.filter((it) => safeStr(it?.project_id) === projectId);

      // NOTE: pmId filtering could be done by expanding RPC later.
      // For now keep it simple (exec radar is portfolio-wide).
      if (pmId) {
        // fallback: filter by projects table (requires RLS, so don’t do it here)
        // We return unfiltered exec list; UI can filter via project selector.
      }

      return jsonOk({
        scope: "org_exec",
        orgId,
        radar: { overdue, warn, ok },
        items: filtered,
      });
    }

    /* =========================================================
       MEMBER PATH (project member)
       - restrict to active project memberships
       - uses the view under normal RLS rules
    ========================================================= */

    const { data: memberships, error: memErr } = await supabase
      .from("project_members")
      .select("project_id")
      .eq("user_id", user.id)
      .is("removed_at", null);

    if (memErr) throw new Error(memErr.message);

    const memberProjectIds = (memberships ?? [])
      .map((r: any) => r.project_id)
      .filter(Boolean);

    if (!memberProjectIds.length) {
      return jsonOk({
        scope: "project_member",
        orgId,
        radar: { overdue: 0, warn: 0, ok: 0 },
        items: [],
      });
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
      let out = qb.in("project_id", memberProjectIds);

      if (projectId) out = out.eq("project_id", projectId);

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
      scope: "project_member",
      orgId,
      radar: { overdue, warn, ok },
      items: items ?? [],
    });
  } catch (e: any) {
    return jsonErr(e?.message || "Server error", 500);
  }
}