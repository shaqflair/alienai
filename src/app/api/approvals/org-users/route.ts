// src/app/api/approvals/org-users/route.ts
import "server-only";
import { NextResponse } from "next/server";
import { sb, requireAuth, requireOrgMember, safeStr } from "@/lib/approvals/admin-helpers";

export const runtime = "nodejs";

type ProfileLite = {
  user_id: string;
  full_name?: string | null;
  email?: string | null;
};

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

async function getOrgIdFromProject(supabase: any, projectId: string) {
  const { data, error } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  const orgId = safeStr((data as any)?.organisation_id).trim();
  if (!orgId) throw new Error("Project has no organisation_id");
  return orgId;
}

export async function GET(req: Request) {
  try {
    const supabase = await sb();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);

    const orgIdParam = safeStr(url.searchParams.get("orgId")).trim();
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const limit = Math.max(1, Math.min(200, Number(url.searchParams.get("limit") || "50") || 50));

    const organisationId = orgIdParam || (projectId ? await getOrgIdFromProject(supabase, projectId) : "");

    if (!organisationId) return err("Missing orgId or projectId", 400);

    await requireOrgMember(supabase, organisationId, user.id);

    // 1) org members
    const { data: memRows, error: memErr } = await supabase
      .from("organisation_members")
      .select("user_id")
      .eq("organisation_id", organisationId)
      .limit(limit);

    if (memErr) throw new Error(memErr.message);

    const userIds = (memRows ?? [])
      .map((r: any) => safeStr(r?.user_id).trim())
      .filter(Boolean);

    if (!userIds.length) return ok({ organisation_id: organisationId, users: [] });

    // 2) profiles (adjust columns if needed)
    const { data: profRows, error: profErr } = await supabase
      .from("profiles")
      .select("user_id, full_name, email")
      .in("user_id", userIds);

    if (profErr) throw new Error(profErr.message);

    const profByUser = new Map<string, ProfileLite>();
    for (const p of (profRows ?? []) as any[]) {
      const uid = safeStr(p?.user_id).trim();
      if (uid) profByUser.set(uid, p as ProfileLite);
    }

    const items = userIds.map((uid) => {
      const p = profByUser.get(uid);
      const full_name = safeStr(p?.full_name).trim();
      const email = safeStr(p?.email).trim();
      const label = full_name || email || uid;

      return {
        user_id: uid,
        full_name: full_name || null,
        email: email || null,
        label,
      };
    });

    return ok({ organisation_id: organisationId, users: items });
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