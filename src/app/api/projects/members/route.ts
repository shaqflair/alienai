// src/app/api/projects/members/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function safeStr(x: unknown) {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

async function requireAuth(supabase: any) {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw new Error(error.message);
  if (!data?.user) throw new Error("Unauthorized");
  return data.user;
}

async function isProjectMember(supabase: any, projectId: string, userId: string) {
  const { data, error } = await supabase
    .from("project_members")
    .select("id")
    .eq("project_id", projectId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return !!data?.id;
}

async function isOrgAdminForProject(supabase: any, projectId: string, userId: string) {
  // If your DB has a helper like is_org_admin_for_project(uuid), prefer using RPC/select on it.
  // We'll do it via joins to stay self-contained.
  const { data: proj, error: projErr } = await supabase
    .from("projects")
    .select("organisation_id")
    .eq("id", projectId)
    .maybeSingle();

  if (projErr) throw new Error(projErr.message);
  const orgId = safeStr(proj?.organisation_id).trim();
  if (!orgId) return false;

  const { data: mem, error: memErr } = await supabase
    .from("organisation_members")
    .select("role, removed_at")
    .eq("organisation_id", orgId)
    .eq("user_id", userId)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);

  const role = safeStr(mem?.role).toLowerCase();
  return role === "owner" || role === "admin";
}

async function requireProjectMemberOrOrgAdmin(supabase: any, projectId: string, userId: string) {
  const [member, orgAdmin] = await Promise.all([
    isProjectMember(supabase, projectId, userId),
    isOrgAdminForProject(supabase, projectId, userId),
  ]);
  if (!member && !orgAdmin) throw new Error("Forbidden");
}

/**
 * GET /api/projects/members?projectId=...&q=...
 * Returns active members for the project (for dropdown picker).
 *
 * âœ… Project members can view.
 * âœ… PMO org admins/owners can view even if not a project member (support model).
 */
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const user = await requireAuth(supabase);

    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const q = safeStr(url.searchParams.get("q")).trim().toLowerCase();

    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    // âœ… must be a project member OR PMO org admin/owner
    await requireProjectMemberOrOrgAdmin(supabase, projectId, user.id);

    // 1) active members
    const { data: memRows, error: memErr } = await supabase
      .from("project_members")
      .select("user_id, role, removed_at")
      .eq("project_id", projectId)
      .is("removed_at", null)
      .order("role", { ascending: true });

    if (memErr) throw new Error(memErr.message);

    const memberRows = (memRows ?? []).filter((r: any) => !!r?.user_id);
    const userIds = memberRows.map((r: any) => String(r.user_id));

    // 2) profiles for those members
    const profilesByUserId = new Map<string, { full_name?: string; email?: string }>();

    if (userIds.length) {
      const { data: profRows, error: profErr } = await supabase
        .from("profiles")
        .select("user_id, full_name, email")
        .in("user_id", userIds);

      if (profErr) throw new Error(profErr.message);

      (profRows ?? []).forEach((p: any) => {
        profilesByUserId.set(String(p.user_id), {
          full_name: safeStr(p.full_name).trim(),
          email: safeStr(p.email).trim(),
        });
      });
    }

    // 3) merge
    const items = memberRows
      .map((r: any) => {
        const uid = String(r.user_id);
        const p = profilesByUserId.get(uid);
        const name = safeStr(p?.full_name).trim();
        const email = safeStr(p?.email).trim();

        return {
          userId: uid,
          role: safeStr(r?.role),
          name: name || email || "Unknown user",
          email: email || "",
        };
      })
      .filter((m: any) => {
        if (!q) return true;
        const hay = `${m.name} ${m.email} ${m.role}`.toLowerCase();
        return hay.includes(q);
      });

    return jsonOk({ members: items });
  } catch (e: any) {
    const msg = String(e?.message || e || "Unknown error");
    const lower = msg.toLowerCase();
    const status = lower.includes("unauthorized") ? 401 : lower.includes("forbidden") ? 403 : 400;
    return jsonErr(msg, status);
  }
}


