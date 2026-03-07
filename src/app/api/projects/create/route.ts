// src/app/api/projects/create/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonOk(d: any)            { return NextResponse.json({ ok: true,  ...d }); }
function jsonErr(e: string, s=400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function ss(x: any): string        { return typeof x === "string" ? x : x == null ? "" : String(x); }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return jsonErr("Unauthorized", 401);

    const orgId = await getActiveOrgId().catch(() => null);
    if (!orgId) return jsonErr("No active organisation", 400);

    // Check user is admin/owner
    const { data: mem } = await supabase
      .from("organisation_members")
      .select("role")
      .eq("organisation_id", String(orgId))
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .maybeSingle();

    const role = ss(mem?.role).toLowerCase();
    if (!["admin","owner","manager"].includes(role)) return jsonErr("Insufficient permissions", 403);

    let body: any = {};
    try { body = await req.json(); } catch { return jsonErr("Invalid JSON", 400); }

    const title = ss(body.title).trim();
    if (!title) return jsonErr("Project name is required", 400);

    // project_code is intentionally omitted — DB trigger generates PRJ-001, PRJ-002 etc.
    const { data: project, error } = await supabase
      .from("projects")
      .insert({
        organisation_id: String(orgId),
        user_id:         auth.user.id,
        title,
        department:      ss(body.department) || null,
        colour:          ss(body.colour)     || "#06b6d4",
        pm_user_id:      body.pm_user_id      || null,
        sponsor_user_id: body.sponsor_user_id  || null,
        project_type:    ss(body.project_type)  || null,
        resource_status: ss(body.resource_status) || "pipeline",
        start_date:      body.start_date  || null,
        finish_date:     body.finish_date || null,
        created_by:      auth.user.id,
      })
      .select("id, title, project_code")
      .single();

    if (error) return jsonErr(error.message, 400);

    // Add creator as owner member
    await supabase.from("project_members").insert({
      project_id:  project.id,
      user_id:     auth.user.id,
      role:        "owner",
      is_active:   true,
      joined_at:   new Date().toISOString(),
    });

    // Auto-provision default artifacts (core types, empty drafts)
    const now = new Date().toISOString();
    await supabase.from("artifacts").insert([
      { project_id: project.id, user_id: auth.user.id, type: "FINANCIAL_PLAN",         title: "Financial Plan",           approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "SCHEDULE",               title: "Schedule",                 approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "WBS",                    title: "Work Breakdown Structure", approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "WEEKLY_REPORT",          title: "Weekly Report",            approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "LESSONS_LEARNED",        title: "Lessons Learned",          approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "PROJECT_CHARTER",        title: "Project Charter",          approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "RAID",                   title: "RAID Log",                 approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "STAKEHOLDER_REGISTER",   title: "Stakeholder Register",     approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
      { project_id: project.id, user_id: auth.user.id, type: "PROJECT_CLOSURE_REPORT", title: "Project Closure Report",   approval_status: "draft", is_current: false, is_baseline: false, is_locked: false, created_at: now, updated_at: now },
    ]);
    // Note: insert errors are intentionally ignored — duplicates or missing cols won't block project creation

    return jsonOk({ project });
  } catch (e: any) {
    console.error("[POST /api/projects/create]", e);
    return jsonErr(ss(e?.message) || "Server error", 500);
  }
}