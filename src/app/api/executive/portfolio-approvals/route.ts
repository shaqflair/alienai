// src/app/api/executive/approvals/portfolio/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { orgIdsForUser, requireUser, safeStr } from "../approvals/_lib";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function jsonOk(data: any, status = 200) {
  const res = NextResponse.json({ ok: true, ...data }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}
function jsonErr(error: string, status = 400, meta?: any) {
  const res = NextResponse.json({ ok: false, error, meta }, { status });
  res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.headers.set("Pragma", "no-cache");
  res.headers.set("Expires", "0");
  return res;
}

async function isExecutiveForOrg(supabase: any, userId: string, orgId: string) {
  // Single-org exec gate: owner on any active project in org
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
  return safeStr(row?.project_id || row?.projectId || row?.project_uuid || row?.projectUuid || row?.project || "").trim();
}

function safeIso(v: any): string | null {
  const s = safeStr(v).trim();
  if (!s) return null;
  const t = new Date(s).getTime();
  if (!Number.isFinite(t)) return null;
  return new Date(t).toISOString();
}

function isPendingLike(status: any) {
  const s = safeStr(status).toLowerCase().trim();
  return s === "" || ["pending", "requested", "awaiting", "open", "in_review"].includes(s);
}

export async function GET() {
  try {
    const supabase = await createClient();
    const user = await requireUser(supabase);

    // Single-org mode: orgIdsForUser returns [profiles.active_organisation_id]
    const orgIds = await orgIdsForUser(user.id);
    const orgId = safeStr(orgIds[0]).trim();
    if (!orgId) return jsonOk({ orgId: null, scope: "member", items: [] });

    const isExec = await isExecutiveForOrg(supabase, user.id, orgId);

    /**
     * Portfolio approvals: org-wide approval requests (budget/roadmap/etc).
     * Prefer:
     * - approvals table
     * Fallback:
     * - change_requests table
     *
     * Response shape stays stable: { items: [...] }
     */
    let items: any[] = [];

    // approvals
    {
      const { data, error } = await supabase
        .from("approvals")
        .select(
          "id, title, status, requested_by, requested_at, created_at, updated_at, project_id, amount, type, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .limit(500);

      if (!error && Array.isArray(data)) {
        items = data
          .filter((a: any) => isPendingLike(a?.status))
          .map((a: any) => ({
            type: "approval",
            id: a.id,
            title: safeStr(a?.title) || "Untitled",
            status: safeStr(a?.status) || "pending",
            approval_type: a?.type ?? null,
            amount: a?.amount ?? null,
            requested_by: a?.requested_by ?? null,
            requested_at: safeIso(a?.requested_at) ?? safeIso(a?.created_at) ?? null,
            updated_at: safeIso(a?.updated_at),
            project_id: safeStr(a?.project_id) || null,
            project_name: safeStr(a?.projects?.name) || null,
          }));
      }
    }

    // change_requests fallback
    if (items.length === 0) {
      const { data, error } = await supabase
        .from("change_requests")
        .select(
          "id, title, status, created_by, created_at, updated_at, project_id, impact, projects!inner(id, organisation_id, name)"
        )
        .eq("projects.organisation_id", orgId)
        .limit(500);

      if (!error && Array.isArray(data)) {
        items = data
          .filter((c: any) => isPendingLike(c?.status))
          .map((c: any) => ({
            type: "change_request",
            id: c.id,
            title: safeStr(c?.title) || "Untitled",
            status: safeStr(c?.status) || "pending",
            impact: c?.impact ?? null,
            requested_by: c?.created_by ?? null,
            requested_at: safeIso(c?.created_at),
            updated_at: safeIso(c?.updated_at),
            project_id: safeStr(c?.project_id) || null,
            project_name: safeStr(c?.projects?.name) || null,
          }));
      }
    }

    // Sort: newest requested first
    items.sort((a, b) => {
      const at = a.requested_at ? new Date(a.requested_at).getTime() : 0;
      const bt = b.requested_at ? new Date(b.requested_at).getTime() : 0;
      return bt - at;
    });

    if (isExec) return jsonOk({ orgId, scope: "org", items });

    const myProjectIds = await myProjectIdsInOrg(supabase, user.id, orgId);
    const allowed = new Set(myProjectIds);
    const scoped = items.filter((it) => {
      const pid = pickProjectId(it);
      return pid ? allowed.has(pid) : false;
    });

    return jsonOk({ orgId, scope: "member", items: scoped });
  } catch (e: any) {
    const msg = safeStr(e?.message) || "Failed";
    const status = msg.toLowerCase().includes("unauthorized") ? 401 : 500;
    return jsonErr(msg, status);
  }
}