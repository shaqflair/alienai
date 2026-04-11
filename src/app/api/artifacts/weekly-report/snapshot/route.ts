import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(d: any)                { return NextResponse.json({ ok: true, ...d }); }
function fail(e: string, s = 400)  { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any)           { return typeof x === "string" ? x.trim() : ""; }

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail("Unauthorised", 401);

    const body       = await req.json().catch(() => ({}));
    const artifactId = safeStr(body?.artifactId);
    const projectId  = safeStr(body?.projectId);
    const contentJson = body?.contentJson;

    if (!artifactId || !projectId || !contentJson) {
      return fail("artifactId, projectId and contentJson required", 400);
    }

    const admin = createServiceClient();

    // Verify artifact exists and belongs to this project
    const { data: artifact } = await admin
      .from("artifacts")
      .select("id, title, version, artifact_type, type")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .is("deleted_at", null)
      .maybeSingle();

    if (!artifact) return fail("Artifact not found", 404);

    // Get current version count to set version_no
    const { count } = await admin
      .from("artifact_versions")
      .select("id", { count: "exact", head: true })
      .eq("artifact_id", artifactId);

    const versionNo = (count ?? 0) + 1;

    // Write snapshot to artifact_versions
    const { data: snap, error: snapErr } = await admin
      .from("artifact_versions")
      .insert({
        artifact_id:   artifactId,
        project_id:    projectId,
        snapshot:      contentJson,
        title:         artifact.title ?? "Weekly Report",
        version_no:    versionNo,
        artifact_type: artifact.artifact_type ?? artifact.type ?? "WEEKLY_REPORT",
        created_by:    user.id,
      })
      .select("id")
      .single();

    if (snapErr) {
      console.error("[weekly-report/snapshot] insert failed:", snapErr.message);
      return fail(snapErr.message, 500);
    }

    // Update artifact to point to latest saved version
    await admin
      .from("artifacts")
      .update({
        last_saved_version_id: snap.id,
        last_saved_at:          new Date().toISOString(),
        last_saved_by:          user.id,
      })
      .eq("id", artifactId);

    console.log(`[weekly-report/snapshot] saved version ${versionNo} for artifact ${artifactId}`);

    return ok({ versionId: snap.id, versionNo });

  } catch (e: any) {
    console.error("[weekly-report/snapshot] FATAL:", e?.message);
    return fail(e?.message ?? "Unexpected error", 500);
  }
}
