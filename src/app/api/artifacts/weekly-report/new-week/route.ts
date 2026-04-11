import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(d: any)                { return NextResponse.json({ ok: true, ...d }); }
function fail(e: string, s = 400)  { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any)           { return typeof x === "string" ? x.trim() : ""; }

function isoDate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail("Unauthorised", 401);

    const body        = await req.json().catch(() => ({}));
    const artifactId  = safeStr(body?.artifactId);   // current artifact (becomes the root)
    const projectId   = safeStr(body?.projectId);
    const contentJson = body?.contentJson;            // current week's saved content

    if (!artifactId || !projectId || !contentJson) {
      return fail("artifactId, projectId and contentJson required", 400);
    }

    const admin = createServiceClient();

    // Load current artifact to get root_artifact_id, version, project info
    const { data: current } = await admin
      .from("artifacts")
      .select("id, title, root_artifact_id, version, type, artifact_type, project_id, organisation_id")
      .eq("id", artifactId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!current) return fail("Artifact not found", 404);
    if (safeStr(current.project_id) !== projectId) return fail("Project mismatch", 403);

    // The true root is either root_artifact_id (if this is a revision)
    // or the artifact itself (if this is the root, version 1)
    const rootId = safeStr(current.root_artifact_id || current.id);

    // Build next week's period dates
    const prevTo   = safeStr(contentJson?.period?.to);
    const baseDate = prevTo ? new Date(`${prevTo}T00:00:00Z`) : new Date();
    const nextFrom = new Date(baseDate.getTime() + 1 * 24 * 60 * 60 * 1000);   // day after period end
    const nextTo   = new Date(baseDate.getTime() + 7 * 24 * 60 * 60 * 1000);   // +7 days

    // Build new content: carry forward project info + RAID + changes, clear deliverables
    const newContent = {
      ...contentJson,
      period: {
        from: isoDate(nextFrom),
        to:   isoDate(nextTo),
      },
      // Clear completed items — they were last week's
      delivered: [],
      // Keep next week's plan as the new delivered placeholder
      planNextWeek: [],
      // Carry forward resource summary, decisions, blockers, RAID, changes, milestones
      summary: {
        ...contentJson.summary,
        headline:  "",
        narrative: "",
      },
      meta: {
        ...(contentJson.meta ?? {}),
        created_from_artifact: artifactId,
        created_at: new Date().toISOString(),
      },
    };

    // Mark current artifact as no longer current
    await admin
      .from("artifacts")
      .update({ is_current: false })
      .eq("id", artifactId);

    // Create the new artifact row
    // The DB trigger trg_set_artifact_root_and_version will set version automatically
    const { data: newArtifact, error: insertErr } = await admin
      .from("artifacts")
      .insert({
        project_id:          projectId,
        organisation_id:      current.organisation_id,
        user_id:              user.id,
        type:                 current.type        ?? "WEEKLY_REPORT",
        artifact_type:        current.artifact_type ?? null,
        title:                current.title       ?? "Weekly Report",
        content_json:         newContent,
        root_artifact_id:     rootId,
        parent_artifact_id:  artifactId,
        is_current:           true,
        approval_status:      "draft",
        status:               "draft",
        last_saved_at:        new Date().toISOString(),
        last_saved_by:        user.id,
      })
      .select("id, version")
      .single();

    if (insertErr || !newArtifact) {
      // Restore is_current on failure
      await admin.from("artifacts").update({ is_current: true }).eq("id", artifactId);
      console.error("[weekly-report/new-week] insert failed:", insertErr?.message);
      return fail(insertErr?.message ?? "Failed to create new week artifact", 500);
    }

    console.log(`[weekly-report/new-week] created artifact ${newArtifact.id} (v${newArtifact.version}) from ${artifactId}`);

    return ok({
      newArtifactId: newArtifact.id,
      version:       newArtifact.version,
      period: {
        from: isoDate(nextFrom),
        to:   isoDate(nextTo),
      },
    });

  } catch (e: any) {
    console.error("[weekly-report/new-week] FATAL:", e?.message);
    return fail(e?.message ?? "Unexpected error", 500);
  }
}
