// src/app/api/artifacts/save-json/route.ts
//
// Silent auto-save endpoint for the Financial Plan editor.
//
// Why an API route instead of a server action?
// Next.js App Router automatically triggers an RSC router refresh after
// every server action completes — even if the action calls no revalidatePath.
// That refresh re-fetches the entire shared layout tree (sidebar, heatmap,
// governance, etc.) on every keystroke, swallowing click events during the
// ~500ms debounce window. A plain fetch() to an API route is invisible to
// the router and causes zero re-renders outside the component itself.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const artifactId = String(body?.artifactId ?? "").trim();
    const projectId  = String(body?.projectId  ?? "").trim();
    const contentJson = body?.contentJson;

    if (!artifactId) return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
    if (!projectId)  return NextResponse.json({ ok: false, error: "Missing projectId"  }, { status: 400 });
    if (contentJson === undefined) return NextResponse.json({ ok: false, error: "Missing contentJson" }, { status: 400 });

    const supabase = await createClient();

    // Auth check
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

    // Role check — owner or editor only
    const { data: roleData, error: roleErr } = await supabase.rpc("get_effective_project_role", {
      p_project_id: projectId,
    });
    if (roleErr) return NextResponse.json({ ok: false, error: roleErr.message }, { status: 403 });

    const row  = Array.isArray(roleData) ? roleData[0] : roleData;
    const role = String(row?.effective_role ?? "").toLowerCase();
    if (role !== "owner" && role !== "editor") {
      return NextResponse.json({ ok: false, error: "Insufficient role" }, { status: 403 });
    }

    // Ownership check — artifact must belong to this project
    const { data: artifact, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, approval_status, is_locked, is_current")
      .eq("id", artifactId)
      .single();

    if (artErr || !artifact) {
      return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });
    }
    if (String(artifact.project_id) !== projectId) {
      return NextResponse.json({ ok: false, error: "Project mismatch" }, { status: 403 });
    }

    // Guard: only draft/changes_requested, unlocked, current can be auto-saved
    const status = String(artifact.approval_status ?? "draft").toLowerCase();
    const editable =
      !artifact.is_locked &&
      (status === "draft" || status === "changes_requested") &&
      artifact.is_current;

    if (!editable) {
      // Return ok:true silently — editor should not surface an error for this
      return NextResponse.json({ ok: true, skipped: true });
    }

    // Save — intentionally NO revalidatePath / cache tag invalidation
    const { error: saveErr } = await supabase
      .from("artifacts")
      .update({
        content_json: contentJson,
        updated_at: new Date().toISOString(),
      })
      .eq("id", artifactId);

    if (saveErr) return NextResponse.json({ ok: false, error: saveErr.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Save failed" }, { status: 500 });
  }
}