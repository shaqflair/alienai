// src/app/api/projects/[id]/gate/check/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { checkGate1 } from "@/lib/server/gates/checkGate1";
import { getActiveOrgId } from "@/utils/org/active-org";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const { id: projectId } = await params;
    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing project id" }, { status: 400 });
    }

    // Verify the user has access to this project
    const activeOrgId = await getActiveOrgId();
    const { data: project } = await supabase
      .from("projects")
      .select("id, organisation_id, resource_status")
      .eq("id", projectId)
      .maybeSingle();

    if (!project || (activeOrgId && project.organisation_id !== activeOrgId)) {
      return NextResponse.json({ ok: false, error: "Project not found" }, { status: 404 });
    }

    const gate = req.nextUrl.searchParams.get("gate") ?? "1";
    if (gate !== "1") {
      return NextResponse.json({ ok: false, error: "Only gate 1 is currently supported" }, { status: 400 });
    }

    const result = await checkGate1(projectId);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "Gate check failed" },
      { status: 500 },
    );
  }
}