import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { jsonErr, fileResponse } from "@/lib/exports/_shared/fileResponse";
import { safeStr } from "@/lib/exports/_shared/utils";

import { normalizeWeeklyReportV1 } from "@/lib/exports/weekly-report/transform";
import { exportWeeklyReportPdfBuffer } from "@/lib/exports/weekly-report/exportWeeklyReportPdfBuffer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const artifactId = safeStr(url.searchParams.get("artifactId")).trim();

    if (!projectId || !artifactId) {
      return jsonErr("Missing projectId/artifactId", 400, { projectId, artifactId });
    }

    const sb = await createClient();
    const { data: auth } = await sb.auth.getUser();
    if (!auth?.user) return jsonErr("Not authenticated", 401);

    const { data: artifact, error } = await sb
      .from("artifacts")
      .select("id, project_id, title, content_json, content, projects:project_id ( id, project_code, title )")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .single();

    if (error || !artifact) return jsonErr(error?.message || "Artifact not found", 404);

    const model = normalizeWeeklyReportV1((artifact as any).content_json ?? (artifact as any).content);

    const projectCode = safeStr((artifact as any)?.projects?.project_code).trim();
    const projectName = safeStr((artifact as any)?.projects?.title).trim();

    const { buffer, filename } = await exportWeeklyReportPdfBuffer({
      model,
      projectCode,
      projectName,
    });

    return fileResponse(buffer, filename, "application/pdf");
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Export failed" }, { status: 500 });
  }
}
