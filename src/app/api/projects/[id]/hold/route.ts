// src/app/api/projects/[id]/hold/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any)           { return NextResponse.json({ ok: true, ...data }); }
function err(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any): string { return typeof x === "string" ? x : x == null ? "" : String(x); }

// GET — fetch hold status + history
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase    = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    const { id: projectId } = await params;

    const [{ data: proj }, { data: history }] = await Promise.all([
      supabase.from("projects")
        .select("id, title, on_hold, hold_started_at, hold_cr_id, hold_reason, hold_action_plan, total_hold_weeks")
        .eq("id", projectId).maybeSingle(),
      supabase.from("project_hold_history")
        .select("*")
        .eq("project_id", projectId)
        .order("started_at", { ascending: false }),
    ]);

    const holdWeeks = proj?.on_hold && proj?.hold_started_at
      ? Math.floor((Date.now() - new Date(proj.hold_started_at).getTime()) / (7 * 24 * 3600000))
      : 0;

    return ok({ project: proj, history: history ?? [], current_hold_weeks: holdWeeks });
  } catch (e: any) {
    return err(safeStr(e?.message) || "Failed", 500);
  }
}

// POST — put on hold or lift hold
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    const { id: projectId } = await params;
    const body   = await req.json().catch(() => ({}));
    const action = safeStr(body.action); // "hold" | "lift"

    // Check user is editor/owner on project
    const { data: mem } = await supabase
      .from("project_members").select("role")
      .eq("project_id", projectId).eq("user_id", auth.user.id).eq("is_active", true).maybeSingle();
    const role = safeStr((mem as any)?.role).toLowerCase();
    if (!["owner", "editor"].includes(role)) {
      // Also allow org admin
      const { data: orgMem } = await supabase
        .from("organisation_members").select("role")
        .eq("user_id", auth.user.id).is("removed_at", null).maybeSingle();
      const orgRole = safeStr((orgMem as any)?.role).toLowerCase();
      if (!["admin", "owner"].includes(orgRole)) return err("Insufficient permissions", 403);
    }

    const { data: proj } = await supabase
      .from("projects").select("id, organisation_id, on_hold, hold_started_at, title")
      .eq("id", projectId).maybeSingle();
    if (!proj) return err("Project not found", 404);

    if (action === "hold") {
      if (proj.on_hold) return err("Project is already on hold", 400);

      const crId       = safeStr(body.cr_id).trim() || null;
      const reason     = safeStr(body.reason).trim();
      const actionPlan = safeStr(body.action_plan).trim();

      if (!reason) return err("reason is required", 400);
      if (!actionPlan) return err("action_plan is required to put a project on hold", 400);

      const now = new Date().toISOString();

      // Update project
      const { error: projErr } = await supabase.from("projects").update({
        on_hold:          true,
        hold_started_at:  now,
        hold_cr_id:       crId,
        hold_reason:      reason,
        hold_action_plan: actionPlan,
        hold_lifted_at:   null,
      }).eq("id", projectId);
      if (projErr) throw projErr;

      // Log to history
      await supabase.from("project_hold_history").insert({
        project_id:      projectId,
        organisation_id: proj.organisation_id,
        cr_id:           crId,
        reason,
        action_plan:     actionPlan,
        started_at:      now,
        created_by:      auth.user.id,
      });

      // Create auto-governance action for tracking
      await supabase.from("ai_governance_actions").insert({
        project_id:      projectId,
        organisation_id: proj.organisation_id,
        action_type:     "project_on_hold",
        title:           `${proj.title} is on hold`,
        description:     `Reason: ${reason}\nAction plan: ${actionPlan}`,
        status:          "open",
        auto_created:    true,
        created_at:      now,
      }).select().maybeSingle();

      return ok({ held: true, hold_started_at: now });
    }

    if (action === "lift") {
      if (!proj.on_hold) return err("Project is not on hold", 400);

      const now       = new Date().toISOString();
      const started   = proj.hold_started_at ? new Date(proj.hold_started_at) : new Date();
      const holdWeeks = Math.ceil((Date.now() - started.getTime()) / (7 * 24 * 3600000));

      // Get current total
      const { data: current } = await supabase.from("projects")
        .select("total_hold_weeks").eq("id", projectId).maybeSingle();
      const totalWeeks = ((current as any)?.total_hold_weeks ?? 0) + holdWeeks;

      // Update project
      await supabase.from("projects").update({
        on_hold:          false,
        hold_lifted_at:   now,
        total_hold_weeks: totalWeeks,
        hold_started_at:  null,
        hold_cr_id:       null,
        hold_reason:      null,
        hold_action_plan: null,
      }).eq("id", projectId);

      // Update history record
      await supabase.from("project_hold_history")
        .update({ lifted_at: now, lifted_by: auth.user.id, hold_weeks: holdWeeks })
        .eq("project_id", projectId).is("lifted_at", null);

      // Resolve the governance action
      await supabase.from("ai_governance_actions")
        .update({ status: "resolved" })
        .eq("project_id", projectId).eq("action_type", "project_on_hold").eq("status", "open");

      return ok({ lifted: true, hold_weeks: holdWeeks, total_hold_weeks: totalWeeks });
    }

    return err("action must be 'hold' or 'lift'", 400);
  } catch (e: any) {
    console.error("[hold]", e);
    return err(safeStr(e?.message) || "Failed", 500);
  }
}