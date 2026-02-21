import "server-only";

import { NextResponse } from "next/server";
import { sb, requireAuth, requireOrgAdmin, requireOrgMember, safeStr } from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * For now we only support org approvals for:
 * - project_charter
 * - change
 * - project_closure_report
 *
 * NOTE: membership operations are group-scoped and do not create rules,
 * but we still keep the route strict + safe.
 */

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const groupId = safeStr(url.searchParams.get("groupId")).trim();
    if (!groupId) return err("Missing groupId", 400);

    const { data: group, error: gErr } = await supabase
      .from("approval_groups")
      .select("id, organisation_id")
      .eq("id", groupId)
      .maybeSingle();

    if (gErr) throw new Error(gErr.message);
    if (!group) return err("Group not found", 404);

    const organisationId = safeStr((group as any).organisation_id).trim();
    await requireOrgMember(supabase, organisationId, user.id);

    const { data: rows, error } = await supabase
      .from("approval_group_members")
      .select("group_id, user_id, approver_id, created_at")
      .eq("group_id", groupId);

    if (error) throw new Error(error.message);

    const userIds = Array.from(new Set((rows ?? []).map((r: any) => safeStr(r.user_id)).filter(Boolean)));
    const approverIds = Array.from(new Set((rows ?? []).map((r: any) => safeStr(r.approver_id)).filter(Boolean)));

    // profiles (for direct user_id memberships)
    let profiles: any[] = [];
    if (userIds.length) {
      const { data: pData, error: pErr } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);
      if (!pErr) profiles = pData ?? [];
    }
    const profileByUser = new Map<string, any>((profiles ?? []).map((p: any) => [safeStr(p.user_id), p]));

    // organisation_approvers (for approver_id memberships)
    let approvers: any[] = [];
    if (approverIds.length) {
      const { data: aData, error: aErr } = await supabase
        .from("organisation_approvers")
        .select("id, email, name, approver_role, department, user_id")
        .in("id", approverIds);
      if (!aErr) approvers = aData ?? [];
    }
    const approverById = new Map<string, any>((approvers ?? []).map((a: any) => [safeStr(a.id), a]));

    const members = (rows ?? []).map((r: any) => {
      const uid = safeStr(r.user_id);
      const aid = safeStr(r.approver_id);

      // Preferred membership: via organisation_approvers
      if (aid) {
        const a = approverById.get(aid);
        const email = safeStr(a?.email).trim();
        const name = safeStr(a?.name).trim();
        const role = safeStr(a?.approver_role).trim();
        const dept = safeStr(a?.department).trim();

        return {
          approver_id: aid,
          user_id: safeStr(a?.user_id) || null, // linked auth user id (may be null if not linked)
          email: email || null,
          name: name || null,
          approver_role: role || null,
          department: dept || null,
          label: email || name || aid,
          created_at: r.created_at ?? null,
        };
      }

      // Legacy membership: direct user_id
      const p = profileByUser.get(uid);
      const email = safeStr(p?.email).trim();
      const name = safeStr(p?.full_name).trim();

      return {
        approver_id: null,
        user_id: uid || null,
        email: email || null,
        name: name || null,
        approver_role: null,
        department: null,
        label: email || name || uid,
        created_at: r.created_at ?? null,
      };
    });

    members.sort((a: any, b: any) =>
      String(a.label || "").toLowerCase().localeCompare(String(b.label || "").toLowerCase())
    );

    return ok({ members });
  } catch (e: any) {
    // ✅ IMPORTANT FIX:
    // Never do `ok(...) && err(...)` (it will always return err()).
    // Keep UI stable: return ok with empty list and include error message.
    const msg = String(e?.message || e || "Error");
    return NextResponse.json({ ok: true, members: [], error: msg }, { status: 200 });
  }
}

export async function POST(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const orgId = safeStr(body?.orgId).trim();
    const groupId = safeStr(body?.groupId).trim();
    const approverId = safeStr(body?.approverId).trim();
    const userId = safeStr(body?.userId).trim();

    if (!orgId) return err("Missing orgId", 400);
    if (!groupId) return err("Missing groupId", 400);
    if (!approverId && !userId) return err("Missing approverId or userId", 400);

    await requireOrgAdmin(supabase, orgId, user.id);

    const { data: group, error: gErr } = await supabase
      .from("approval_groups")
      .select("id, organisation_id")
      .eq("id", groupId)
      .maybeSingle();

    if (gErr) throw new Error(gErr.message);
    if (!group) return err("Group not found", 404);
    if (safeStr((group as any).organisation_id).trim() !== orgId) {
      return err("Group does not belong to this organisation", 403);
    }

    if (approverId) {
      const { data: ap, error: apErr } = await supabase
        .from("organisation_approvers")
        .select("id, organisation_id")
        .eq("id", approverId)
        .maybeSingle();

      if (apErr) throw new Error(apErr.message);
      if (!ap) return err("Approver not found", 404);
      if (safeStr((ap as any).organisation_id).trim() !== orgId) {
        return err("Approver does not belong to this organisation", 403);
      }
    }

    const row: any = { group_id: groupId };
    if (approverId) row.approver_id = approverId;
    else row.user_id = userId;

    const { data, error } = await supabase.from("approval_group_members").insert(row).select("*").single();
    if (error) throw new Error(error.message);

    return ok({ member: data }, 201);
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const groupId = safeStr(url.searchParams.get("groupId")).trim();
    const approverId = safeStr(url.searchParams.get("approverId")).trim();
    const userId = safeStr(url.searchParams.get("userId")).trim();

    if (!groupId) return err("Missing groupId", 400);
    if (!approverId && !userId) return err("Missing approverId or userId", 400);

    const { data: group, error: gErr } = await supabase
      .from("approval_groups")
      .select("id, organisation_id")
      .eq("id", groupId)
      .maybeSingle();

    if (gErr) throw new Error(gErr.message);
    if (!group) return err("Group not found", 404);

    const orgId = safeStr((group as any).organisation_id).trim();
    await requireOrgAdmin(supabase, orgId, user.id);

    let q = supabase.from("approval_group_members").delete().eq("group_id", groupId);
    q = approverId ? q.eq("approver_id", approverId) : q.eq("user_id", userId);

    const { error } = await q;
    if (error) throw new Error(error.message);

    return ok({ removed: true });
  } catch (e: any) {
    const msg = String(e?.message || e || "Error");
    const s = msg.toLowerCase().includes("unauthorized")
      ? 401
      : msg.toLowerCase().includes("forbidden")
      ? 403
      : 400;
    return err(msg, s);
  }
}
