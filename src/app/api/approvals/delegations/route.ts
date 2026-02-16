// src/app/api/approvals/delegations/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

async function requireAuth(sb: any) {
  const { data, error } = await sb.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

async function getOrgIdFromProject(sb: any, projectId: string) {
  // support both spellings if you ever had legacy
  const first = await sb.from("projects").select("organisation_id").eq("id", projectId).maybeSingle();
  if (!first.error) {
    const orgId = safeStr((first.data as any)?.organisation_id).trim();
    if (!orgId) throw new Error("Project has no organisation_id");
    return orgId;
  }

  // fallback for legacy schema
  const second = await sb.from("projects").select("organization_id").eq("id", projectId).maybeSingle();
  if (second.error) throw new Error(second.error.message);
  const orgId = safeStr((second.data as any)?.organization_id).trim();
  if (!orgId) throw new Error("Project has no organisation_id");
  return orgId;
}

async function requireOrgAdmin(sb: any, orgId: string, userId: string) {
  const { data, error } = await sb
    .from("organisation_members")
    .select("role")
    .eq("organisation_id", orgId)
    .eq("user_id", userId);

  if (error) throw new Error(error.message);
  const role = String((data?.[0] as any)?.role ?? "").toLowerCase();
  if (role !== "admin") throw new Error("Admin only");
}

/**
 * Delegations (org-scoped)
 * Table: public.approver_delegations
 * Columns:
 *  - organisation_id, from_user_id, to_user_id, starts_at, ends_at, reason, is_active, created_by, created_at
 */

export async function GET(req: Request) {
  try {
    const sb = await createClient();
    await requireAuth(sb);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const includeInactive = safeStr(url.searchParams.get("includeInactive")).trim() === "1";

    if (!projectId) return jsonErr("Missing projectId", 400);

    const orgId = await getOrgIdFromProject(sb, projectId);

    let q = sb
      .from("approver_delegations")
      .select("*")
      .eq("organisation_id", orgId)
      .order("starts_at", { ascending: false });

    if (!includeInactive) q = q.eq("is_active", true);

    const { data, error } = await q;
    if (error) throw new Error(error.message);

    return jsonOk({ organisation_id: orgId, items: data ?? [] });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized") ? 401 : 400;
    return jsonErr(msg, s);
  }
}

export async function POST(req: Request) {
  try {
    const sb = await createClient();
    const user = await requireAuth(sb);

    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) return jsonErr("Missing projectId", 400);

    const orgId = await getOrgIdFromProject(sb, projectId);
    await requireOrgAdmin(sb, orgId, user.id);

    const from_user_id = safeStr(body?.from_user_id).trim();
    const to_user_id = safeStr(body?.to_user_id).trim();
    const starts_at = safeStr(body?.starts_at).trim();
    const ends_at = safeStr(body?.ends_at).trim();
    const reason = safeStr(body?.reason ?? "").trim() || null;

    if (!from_user_id || !to_user_id) return jsonErr("from_user_id and to_user_id required", 400);
    if (!starts_at || !ends_at) return jsonErr("starts_at and ends_at required", 400);

    const { data, error } = await sb
      .from("approver_delegations")
      .insert({
        organisation_id: orgId,
        from_user_id,
        to_user_id,
        starts_at,
        ends_at,
        reason,
        is_active: true,
        created_by: user.id,
      })
      .select("*")
      .single();

    if (error) throw new Error(error.message);
    return jsonOk({ item: data }, 201);
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("admin only") || msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return jsonErr(msg, s);
  }
}

export async function DELETE(req: Request) {
  try {
    const sb = await createClient();
    const user = await requireAuth(sb);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const id = safeStr(url.searchParams.get("id")).trim();

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!id) return jsonErr("Missing id", 400);

    const orgId = await getOrgIdFromProject(sb, projectId);
    await requireOrgAdmin(sb, orgId, user.id);

    // ✅ soft-disable (matches table design)
    const { error } = await sb
      .from("approver_delegations")
      .update({ is_active: false })
      .eq("id", id)
      .eq("organisation_id", orgId);

    if (error) throw new Error(error.message);
    return jsonOk({ removed: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("admin only") || msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return jsonErr(msg, s);
  }
}
