// src/app/api/executive/approvals/portfolio/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireUser, safeStr, clampDays } from "../_lib";

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

function riskState(nowMs: number, slaDueIso?: string | null) {
  const s = safeStr(slaDueIso).trim();
  if (!s) {
    return {
      state: "ok" as const,
      rag: "G" as const,
      hoursToBreach: null as number | null,
    };
  }

  const due = new Date(s).getTime();
  if (!Number.isFinite(due)) {
    return {
      state: "ok" as const,
      rag: "G" as const,
      hoursToBreach: null as number | null,
    };
  }

  const diffHrs = Math.round((due - nowMs) / 36e5);

  if (nowMs > due) return { state: "breached" as const, rag: "R" as const, hoursToBreach: diffHrs };
  if (diffHrs <= 48) return { state: "at_risk" as const, rag: "A" as const, hoursToBreach: diffHrs };
  return { state: "ok" as const, rag: "G" as const, hoursToBreach: diffHrs };
}

function daysWaiting(createdAtIso?: string | null) {
  const s = safeStr(createdAtIso).trim();
  if (!s) return 0;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .eq("role", "owner")
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId)
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data;
}

async function myProjectIdsInOrg(supabase: any, userId: string, orgId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("project_id, projects!inner(id, organisation_id)")
    .eq("user_id", userId)
    .is("removed_at", null)
    .eq("projects.organisation_id", orgId);

  if (error) throw new Error(error.message);
  return (data || []).map((r: any) => safeStr(r?.project_id).trim()).filter(Boolean);
}

function pickProjectId(row: any): string {
  return safeStr(row?.project_id || row?.projectId || row?.project_uuid || row?.projectUuid || "").trim();
}

function pendingLike(status: any) {
  const s = safeStr(status).trim().toLowerCase();
  return s === "" || ["pending", "requested", "awaiting", "open", "in_review", "review", "submitted"].includes(s);
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();

    // _lib.requireUser returns { supabase, user, orgId }
    const auth = await requireUser(supabase);
    const user = (auth as any)?.user ?? auth;
    const orgId = safeStr((auth as any)?.orgId).trim();

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"), 7, 60, 30);
    const sinceIso = new Date(Date.now() - days * 864e5).toISOString();

    if (!orgId) {
      return noStoreJson(
        { ok: false, error: "no_active_org", message: "No active organisation set for user" },
        { status: 400 }
      );
    }

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    // Try approvals table first
    let raw: any[] = [];

    {
      const { data, error } = await supabase
        .from("approvals")
        .select(
          "id, title, status, type, amount, requested_by, requested_at, created_at, updated_at, sla_due_at, due_at, project_id, projects!inner(id, organisation_id, name, deleted_at)"
        )
        .eq("projects.organisation_id", orgId)
        .is("projects.deleted_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500);

      if (!error && Array.isArray(data)) raw = data;
    }

    // Fallback: change_requests
    if (raw.length === 0) {
      const { data, error } = await supabase
        .from("change_requests")
        .select(
          "id, title, status, decision_status, impact, created_by, created_at, updated_at, review_by, project_id, projects!inner(id, organisation_id, name, deleted_at)"
        )
        .eq("projects.organisation_id", orgId)
        .is("projects.deleted_at", null)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500);

      if (!error && Array.isArray(data)) raw = data;
    }

    const nowMs = Date.now();

    let items = raw
      .filter((r) => {
        const ds = safeStr((r as any)?.decision_status).trim().toLowerCase();
        if (ds && ["approved", "rejected"].includes(ds)) return false;
        return pendingLike((r as any)?.status);
      })
      .map((r) => {
        const createdAt = safeStr((r as any)?.requested_at || (r as any)?.created_at || "").trim() || null;

        const slaDue =
          safeStr((r as any)?.sla_due_at || (r as any)?.review_by || (r as any)?.due_at || "").trim() || null;

        const risk = riskState(nowMs, slaDue);

        return {
          id: safeStr((r as any)?.id),
          title: safeStr((r as any)?.title) || "Untitled",
          status: safeStr((r as any)?.status) || "pending",
          approval_type: safeStr((r as any)?.type || (r as any)?.impact) || null,
          amount: (r as any)?.amount ?? null,
          requested_by: (r as any)?.requested_by ?? (r as any)?.created_by ?? null,
          project_id: safeStr((r as any)?.project_id) || null,
          project_name: safeStr((r as any)?.projects?.name) || null,
          created_at: createdAt,
          updated_at: safeStr((r as any)?.updated_at) || null,
          sla_due_at: slaDue,
          waiting_days: daysWaiting(createdAt),
          risk_state: risk.state,
          rag: risk.rag,
          hours_to_breach: risk.hoursToBreach,
        };
      });

    if (!isExec) {
      const myProjectIds = await myProjectIdsInOrg(supabase, user.id, orgId);
      const allowed = new Set(myProjectIds);
      items = items.filter((it) => {
        const pid = pickProjectId(it);
        return pid ? allowed.has(pid) : false;
      });
    }

    const counts = items.reduce(
      (acc, it) => {
        const rag = safeStr((it as any).rag);
        if (rag === "R") acc.R += 1;
        else if (rag === "A") acc.A += 1;
        else acc.G += 1;
        acc.total += 1;
        return acc;
      },
      { total: 0, R: 0, A: 0, G: 0 }
    );

    return noStoreJson({
      ok: true,
      orgId,
      scope: isExec ? "org" : "member",
      window_days: days,
      counts,
      items,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unknown error";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return noStoreJson({ ok: false, error: "portfolio_approvals_failed", message: msg }, { status });
  }
}