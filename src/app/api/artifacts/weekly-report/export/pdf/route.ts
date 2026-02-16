import "server-only";
import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// ✅ reuse your existing permission helpers if you have them
// import { requireUser, requireProjectRole } from "@/lib/auth/guards";

import { normalizeWeeklyReportV1 } from "@/lib/exports/weekly-report/transform";
import { exportWeeklyReportPdfBuffer } from "@/lib/exports/weekly-report/exportWeeklyReportPdfBuffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function safeStr(x: any) {
  return String(x ?? "").trim();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const projectId = safeStr(url.searchParams.get("projectId"));
  const artifactId = safeStr(url.searchParams.get("artifactId"));
  if (!projectId || !artifactId) {
    return NextResponse.json({ ok: false, error: "Missing projectId/artifactId" }, { status: 400 });
  }

  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: false, error: "Not authenticated" }, { status: 401 });

  // ✅ If you have a shared guard, use it here.
  // await requireProjectRole(sb, auth.user.id, projectId, "viewer");

  const { data: artifact, error } = await sb
    .from("artifacts")
    .select("id, project_id, title, content_json, content, projects:project_id ( id, project_code, title )")
    .eq("id", artifactId)
    .eq("project_id", projectId)
    .single();

  if (error || !artifact) return NextResponse.json({ ok: false, error: error?.message || "Artifact not found" }, { status: 404 });

  const model = normalizeWeeklyReportV1(artifact.content_json ?? artifact.content);

  const projectCode = safeStr((artifact as any)?.projects?.project_code);
  const projectName = safeStr((artifact as any)?.projects?.title);

  const { buffer, filename } = await exportWeeklyReportPdfBuffer({
    model,
    projectCode,
    projectName,
    // orgName/clientName: wire if you store them (same as Charter)
  });

  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
