// src/app/api/approvals/approvers/route.ts
import "server-only";
import { NextResponse } from "next/server";
import {
  sb,
  requireAuth,
  requireOrgMember,
  requireApprovalsWriter,
  safeStr,
} from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function normEmail(x: unknown) {
  return safeStr(x).trim().toLowerCase();
}

async function resolveLinkedOrgUser(
  supabase: any,
  organisationId: string,
  email: string
) {
  const { data: profileMatch, error: profileError } = await supabase
    .from("profiles")
    .select("id,email,full_name")
    .ilike("email", email)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profileMatch?.id) {
    return {
      user_id: null,
      email: email,
      full_name: null,
      department: null,
      job_title: null,
      membership_role: null,
      link_state: "external" as const,
    };
  }

  const { data: membership, error: membershipError } = await supabase
    .from("organisation_members")
    .select("user_id,role,department,job_title,removed_at")
    .eq("organisation_id", organisationId)
    .eq("user_id", profileMatch.id)
    .is("removed_at", null)
    .maybeSingle();

  if (membershipError) throw new Error(membershipError.message);

  if (!membership?.user_id) {
    return {
      user_id: null,
      email: normEmail(profileMatch.email),
      full_name: safeStr(profileMatch.full_name).trim() || null,
      department: null,
      job_title: null,
      membership_role: null,
      link_state: "unlinked" as const,
    };
  }

  return {
    user_id: safeStr(membership.user_id),
    email: normEmail(profileMatch.email),
    full_name: safeStr(profileMatch.full_name).trim() || null,
    department: safeStr(membership.department).trim() || null,
    job_title: safeStr(membership.job_title).trim() || null,
    membership_role: safeStr(membership.role).trim() || null,
    link_state: "linked" as const,
  };
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const organisationId = safeStr(url.searchParams.get("orgId")).trim();
    const q = safeStr(url.searchParams.get("q")).trim().toLowerCase();

    if (!organisationId) return err("Missing orgId", 400);

    await requireOrgMember(supabase, organisationId, user.id);

    const { data: rows, error } = await supabase
      .from("organisation_approvers")
      .select(
        "id, organisation_id, email, name, approver_role, department, user_id, is_active, created_at"
      )
      .eq("organisation_id", organisationId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);

    const items = (rows ?? [])
      .map((r: any) => {
        const email = normEmail(r.email);
        const name = safeStr(r.name).trim();
        const role = safeStr(r.approver_role).trim();
        const dept = safeStr(r.department).trim();
        const userId = safeStr(r.user_id).trim();
        const label = name || email || safeStr(r.id);

        return {
          id: safeStr(r.id),
          organisation_id: safeStr(r.organisation_id),
          user_id: userId || null,
          is_active: r.is_active ?? true,
          created_at: r.created_at ?? null,
          email: email || null,
          name: name || null,
          approver_role: role || null,
          department: dept || null,
          link_state: userId ? "linked" : "external",
          label,
        };
      })
      .filter((x: any) => {
        if (!q) return true;
        const hay =
          `${x.email ?? ""} ${x.name ?? ""} ${x.department ?? ""} ${x.approver_role ?? ""} ${x.label ?? ""}`.toLowerCase();
        return hay.includes(q);
      });

    return ok({ approvers: items });
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

export async function POST(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const body = await req.json().catch(() => ({}));
    const organisationId = safeStr(body?.orgId).trim();
    const rawUserId = safeStr(body?.user_id).trim();
    let email = normEmail(body?.email);
    let name = safeStr(body?.name).trim();
    const approverRole = safeStr(body?.approver_role).trim();
    let department = safeStr(body?.department).trim();

    if (!organisationId) return err("Missing orgId", 400);

    await requireApprovalsWriter(supabase, organisationId, user.id);

    let linkedUserId: string | null = null;
    let linkState: "linked" | "unlinked" | "external" = "external";
    let resolvedJobTitle: string | null = null;
    let membershipRole: string | null = null;

    if (rawUserId) {
      const { data: membership, error: membershipError } = await supabase
        .from("organisation_members")
        .select("user_id,role,department,job_title,removed_at")
        .eq("organisation_id", organisationId)
        .eq("user_id", rawUserId)
        .is("removed_at", null)
        .maybeSingle();

      if (membershipError) throw new Error(membershipError.message);
      if (!membership?.user_id) return err("Selected user is not an active member of this organisation", 400);

      const { data: profile, error: profileError } = await supabase
        .from("profiles")
        .select("id,email,full_name")
        .eq("id", rawUserId)
        .maybeSingle();

      if (profileError) throw new Error(profileError.message);
      if (!profile?.id || !safeStr(profile.email).trim()) {
        return err("Selected user profile has no email", 400);
      }

      linkedUserId = safeStr(profile.id);
      email = normEmail(profile.email);
      if (!name) name = safeStr(profile.full_name).trim();
      if (!department) department = safeStr(membership.department).trim();
      resolvedJobTitle = safeStr(membership.job_title).trim() || null;
      membershipRole = safeStr(membership.role).trim() || null;
      linkState = "linked";
    } else {
      if (!email) return err("Missing email", 400);

      const linked = await resolveLinkedOrgUser(supabase, organisationId, email);
      linkedUserId = linked.user_id;
      email = linked.email;
      if (!name) name = linked.full_name ?? "";
      if (!department) department = linked.department ?? "";
      resolvedJobTitle = linked.job_title ?? null;
      membershipRole = linked.membership_role ?? null;
      linkState = linked.link_state;
    }

    if (!email) return err("Missing email", 400);

    const payload = {
      organisation_id: organisationId,
      email,
      user_id: linkedUserId,
      name: name || null,
      approver_role: approverRole || null,
      department: department || null,
      is_active: true,
      created_by: user.id,
    };

    const { data, error } = await supabase
      .from("organisation_approvers")
      .upsert(payload, { onConflict: "organisation_id,email" })
      .select(
        "id, organisation_id, email, name, approver_role, department, user_id, is_active, created_at"
      )
      .single();

    if (error) throw new Error(error.message);

    return ok(
      {
        approver: {
          ...data,
          link_state: data?.user_id ? "linked" : linkState,
          job_title: resolvedJobTitle,
          membership_role: membershipRole,
        },
      },
      201
    );
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
    const organisationId = safeStr(url.searchParams.get("orgId")).trim();
    const approverId = safeStr(url.searchParams.get("id")).trim();
    const email = normEmail(safeStr(url.searchParams.get("email")));

    if (!organisationId) return err("Missing orgId", 400);
    if (!approverId && !email) return err("Missing id or email", 400);

    await requireApprovalsWriter(supabase, organisationId, user.id);

    const q = supabase.from("organisation_approvers").delete().eq("organisation_id", organisationId);
    const { error } = approverId ? await q.eq("id", approverId) : await q.eq("email", email);

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