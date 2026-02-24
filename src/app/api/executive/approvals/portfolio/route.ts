// src/app/api/executive/approvals/portfolio/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
export function num(x: any, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}

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

export async function requireUser(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

/**
 * Single-org mode: derive org from profiles.active_organisation_id.
 * Kept as "orgIdsForUser" for backwards compatibility with existing callers.
 */
export async function orgIdsForUser(userId: string) {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("active_organisation_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(error.message);

  const orgId = safeStr(data?.active_organisation_id).trim();
  if (!orgId) return [];

  return [orgId];
}

export function clampDays(v: string | null): 7 | 14 | 30 | 60 {
  const s = safeStr(v).trim().toLowerCase();
  const n = Number(s);
  if (n === 7 || n === 14 || n === 30 || n === 60) return n;
  return 30;
}

export function riskState(nowMs: number, slaDueIso?: string | null) {
  const s = safeStr(slaDueIso).trim();
  if (!s) return { state: "ok" as const, rag: "G" as const, hoursToBreach: null as number | null };

  const due = new Date(s).getTime();
  if (!Number.isFinite(due)) {
    return { state: "ok" as const, rag: "G" as const, hoursToBreach: null as number | null };
  }

  const diffHrs = Math.round((due - nowMs) / 36e5);

  if (nowMs > due) return { state: "breached" as const, rag: "R" as const, hoursToBreach: diffHrs };
  if (diffHrs <= 48) return { state: "at_risk" as const, rag: "A" as const, hoursToBreach: diffHrs };
  return { state: "ok" as const, rag: "G" as const, hoursToBreach: diffHrs };
}

export function daysWaiting(createdAtIso?: string | null) {
  const s = safeStr(createdAtIso).trim();
  if (!s) return 0;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 864e5));
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  // Single-org best-practice: exec gate is "owner on any active project in org"
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
  return s === "" || ["pending", "requested", "awaiting", "open", "in_review"].includes(s);
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    const url = new URL(req.url);
    const days = clampDays(url.searchParams.get("days"));
    const sinceIso = new Date(Date.now() - days * 864e5).toISOString();

    const orgIds = await orgIdsForUser(user.id);
    const orgId = orgIds[0] ?? null;
    if (!orgId) {
      return noStoreJson(
        { error: "no_active_org", message: "No active organisation set for user" },
        { status: 400 }
      );
    }

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    // Try approvals table first (common)
    let raw: any[] = [];
    {
      const { data, error } = await supabase
        .from("approvals")
        .select(
          "id, title, status, type, amount, requested_by, requested_at, created_at, updated_at, sla_due_at, due_at, project_id, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500);

      if (!error && Array.isArray(data)) {
        raw = data;
      }
    }

    // Fallback: change_requests
    if (raw.length === 0) {
      const { data, error } = await supabase
        .from("change_requests")
        .select(
          "id, title, status, impact, created_by, created_at, updated_at, project_id, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(500);

      if (!error && Array.isArray(data)) raw = data;
    }

    // Convert to stable shape
    const nowMs = Date.now();
    let items = raw
      .filter((r) => pendingLike(r?.status))
      .map((r) => {
        const createdAt = safeStr(r?.requested_at || r?.created_at || "").trim() || null;
        const slaDue = safeStr(r?.sla_due_at || r?.due_at || "").trim() || null;
        const risk = riskState(nowMs, slaDue);

        return {
          id: safeStr(r?.id),
          title: safeStr(r?.title) || "Untitled",
          status: safeStr(r?.status) || "pending",
          approval_type: safeStr(r?.type || r?.impact) || null,
          amount: r?.amount ?? null,
          requested_by: r?.requested_by ?? r?.created_by ?? null,
          project_id: safeStr(r?.project_id) || null,
          project_name: safeStr(r?.projects?.name) || null,
          created_at: createdAt,
          updated_at: safeStr(r?.updated_at) || null,
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
      orgId,
      scope: isExec ? "org" : "member",
      window_days: days,
      counts,
      items,
    });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Unknown error";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return noStoreJson({ error: "portfolio_approvals_failed", message: msg }, { status });
  }
}