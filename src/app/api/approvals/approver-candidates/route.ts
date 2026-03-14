import "server-only";
import { NextResponse } from "next/server";
import {
  sb,
  requireAuth,
  requireOrgMember,
  safeStr,
} from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
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

    const { data: members, error: membersError } = await supabase
      .from("organisation_members")
      .select("user_id, role, department, job_title, removed_at")
      .eq("organisation_id", organisationId)
      .is("removed_at", null);

    if (membersError) throw new Error(membersError.message);

    const userIds = Array.from(
      new Set((members ?? []).map((m: any) => safeStr(m.user_id)).filter(Boolean))
    );

    if (userIds.length === 0) {
      return ok({ candidates: [] });
    }

    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", userIds);

    if (profilesError) throw new Error(profilesError.message);

    const profileById = new Map(
      (profiles ?? []).map((p: any) => [safeStr(p.id), p])
    );

    const items = (members ?? [])
      .map((row: any) => {
        const profile = profileById.get(safeStr(row.user_id));
        const email = safeStr(profile?.email).trim();
        const name = safeStr(profile?.full_name).trim();
        const department = safeStr(row.department).trim();
        const jobTitle = safeStr(row.job_title).trim();
        const membershipRole = safeStr(row.role).trim();

        return {
          user_id: safeStr(row.user_id),
          email: email || null,
          full_name: name || null,
          department: department || null,
          job_title: jobTitle || null,
          membership_role: membershipRole || null,
          label: name ? `${name} (${email})` : email,
        };
      })
      .filter((x: any) => !!x.user_id && !!x.email)
      .filter((x: any) => {
        if (!q) return true;
        const hay =
          `${x.email ?? ""} ${x.full_name ?? ""} ${x.department ?? ""} ${x.job_title ?? ""} ${x.membership_role ?? ""}`.toLowerCase();
        return hay.includes(q);
      })
      .sort((a: any, b: any) =>
        (a.full_name || a.email || "").localeCompare(
          b.full_name || b.email || ""
        )
      );

    return ok({ candidates: items });
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