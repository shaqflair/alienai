// src/app/api/approvals/delegations/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { requireApprovalsWriter, requireOrgMember, safeStr } from "@/lib/approvals/admin-helpers";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

async function requireAuth(sb: any) {
  const { data, error } = await sb.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

async function getOrgIdFromProject(sb: any, projectId: string) {
  // FIX: accept orgId directly (passed from org-level settings pages)
  // First try the organisations table — if this ID is itself an org, use it directly.
  const orgCheck = await sb
    .from("organisations")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!orgCheck.error && orgCheck.data?.id) return safeStr(orgCheck.data.id).trim();

  // Otherwise resolve org from project
  const first = await sb
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (!first.error) {
    const orgId = safeStr((first.data as any)?.organisation_id).trim();
    if (orgId) return orgId;
  }

  // Fallback for alternate column name
  const second = await sb
    .from("projects")
    .select("organization_id")
    .eq("id", projectId)
    .maybeSingle();

  if (second.error) throw new Error(second.error.message);
  const orgId = safeStr((second.data as any)?.organization_id).trim();
  if (!orgId) throw new Error("Could not resolve organisation from projectId/orgId provided");
  return orgId;
}

function errStatus(msg: string) {
  const m = msg.toLowerCase();
  if (m.includes("unauthorized")) return 401;
  if (m.includes("forbidden"))   return 403;
  return 400;
}

/* ── GET ────────────────────────────────────────────────────── */

export async function GET(req: Request) {
  try {
    const sb   = await createClient();
    const user = await requireAuth(sb);

    const url            = new URL(req.url);
    const projectId      = safeStr(url.searchParams.get("projectId")).trim();
    const includeInactive = url.searchParams.get("includeInactive") === "1";

    if (!projectId) return jsonErr("Missing projectId", 400);

    const orgId = await getOrgIdFromProject(sb, projectId);

    // Read = org member
    await requireOrgMember(sb, orgId, user.id);

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
    return jsonErr(msg, errStatus(msg));
  }
}

/* ── POST ───────────────────────────────────────────────────── */

export async function POST(req: Request) {
  try {
    const sb   = await createClient();
    const user = await requireAuth(sb);

    const body      = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) return jsonErr("Missing projectId", 400);

    const orgId = await getOrgIdFromProject(sb, projectId);

    // Write = platform admin only
    await requireApprovalsWriter(sb, orgId, user.id);

    const from_user_id = safeStr(body?.from_user_id).trim();
    const to_user_id   = safeStr(body?.to_user_id).trim();
    const starts_at    = safeStr(body?.starts_at).trim();
    const ends_at      = safeStr(body?.ends_at).trim();
    const reason       = safeStr(body?.reason ?? "").trim() || null;

    if (!from_user_id || !to_user_id)
      return jsonErr("from_user_id and to_user_id required", 400);
    if (!starts_at || !ends_at)
      return jsonErr("starts_at and ends_at required", 400);

    // FIX: server-side date validation — prevents bad data even if client skips it
    const startMs = new Date(starts_at).getTime();
    const endMs   = new Date(ends_at).getTime();

    if (!Number.isFinite(startMs)) return jsonErr("starts_at is not a valid date", 400);
    if (!Number.isFinite(endMs))   return jsonErr("ends_at is not a valid date", 400);
    if (endMs <= startMs)          return jsonErr("ends_at must be after starts_at", 400);

    // Prevent self-delegation
    if (from_user_id === to_user_id)
      return jsonErr("Delegate from and cover person must be different", 400);

    // FIX: check for overlapping active delegations for the same from_user_id
    // in the same org — warn but don't block (multiple cover scenarios are valid)
    const { data: overlapping } = await sb
      .from("approver_delegations")
      .select("id, to_user_id, starts_at, ends_at")
      .eq("organisation_id", orgId)
      .eq("from_user_id", from_user_id)
      .eq("is_active", true)
      .lte("starts_at", ends_at)
      .gte("ends_at", starts_at);

    const overlapCount = Array.isArray(overlapping) ? overlapping.length : 0;

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

    return jsonOk(
      {
        item: data,
        // Surface overlap warning so UI can optionally notify the admin
        overlap_warning: overlapCount > 0
          ? `${overlapCount} existing active delegation(s) overlap this date range for the same approver.`
          : null,
      },
      201
    );
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    return jsonErr(msg, errStatus(msg));
  }
}

/* ── DELETE ─────────────────────────────────────────────────── */

export async function DELETE(req: Request) {
  try {
    const sb   = await createClient();
    const user = await requireAuth(sb);

    const url       = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const id        = safeStr(url.searchParams.get("id")).trim();

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!id)        return jsonErr("Missing id", 400);

    const orgId = await getOrgIdFromProject(sb, projectId);

    // Write = platform admin only
    await requireApprovalsWriter(sb, orgId, user.id);

    // FIX: verify the delegation belongs to this org before soft-deleting
    const { data: existing } = await sb
      .from("approver_delegations")
      .select("id, organisation_id, is_active")
      .eq("id", id)
      .eq("organisation_id", orgId)
      .maybeSingle();

    if (!existing?.id) return jsonErr("Delegation not found", 404);

    if (existing.is_active === false) {
      // Already removed — idempotent success
      return jsonOk({ removed: true, was_already_inactive: true });
    }

    const { error } = await sb
      .from("approver_delegations")
      .update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
        deactivated_by: user.id,
      })
      .eq("id", id)
      .eq("organisation_id", orgId);

    if (error) {
      // If deactivated_at / deactivated_by columns don't exist yet, fall back
      const msg = String(error.message || "");
      if (msg.includes("column") && (msg.includes("deactivated_at") || msg.includes("deactivated_by"))) {
        const { error: fallbackErr } = await sb
          .from("approver_delegations")
          .update({ is_active: false })
          .eq("id", id)
          .eq("organisation_id", orgId);
        if (fallbackErr) throw new Error(fallbackErr.message);
      } else {
        throw new Error(error.message);
      }
    }

    return jsonOk({ removed: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    return jsonErr(msg, errStatus(msg));
  }
}