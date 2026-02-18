// src/app/api/artifacts/wbs/export/xlsx/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { looksLikeUuid, sanitizeFilename, formatDateUK } from "@/lib/exports/wbs/utils";
import {
  ExportError,
  resolveProjectIdFromArtifact,
  verifyProjectAccess,
  fetchProjectData,
  fetchArtifactData,
  fetchWbsItems,
} from "@/lib/exports/wbs/fetch";
import { flattenForExport } from "@/lib/exports/wbs/transform";
import { renderWbsXlsx } from "@/lib/exports/wbs/renderWbsXlsx";

export const runtime = "nodejs";
export const maxDuration = 60;

function jsonErr(message: string, status = 500, meta?: any) {
  return NextResponse.json({ ok: false, error: message, meta }, { status });
}

function pickParam(url: URL, ...keys: string[]) {
  for (const k of keys) {
    const v = url.searchParams.get(k);
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);

    // tolerate common param variants
    const artifactId = pickParam(url, "artifactId", "id", "artifact_id");
    let projectId = pickParam(url, "projectId", "project_id");
    const filenameParam = pickParam(url, "filename", "file", "name");

    if (!looksLikeUuid(artifactId)) {
      throw new ExportError("INVALID_ID", "Invalid artifactId", 400);
    }

    const supabase = await createClient();

    // derive project id if missing
    if (!looksLikeUuid(projectId)) {
      projectId = await resolveProjectIdFromArtifact(supabase, artifactId);
    }

    await verifyProjectAccess(supabase, projectId);

    const [project, artifact, wbsItems] = await Promise.all([
      fetchProjectData(supabase, projectId),
      fetchArtifactData(supabase, projectId, artifactId),
      fetchWbsItems(supabase, projectId, artifactId),
    ]);

    // normalize rows for export
    const rows = flattenForExport(wbsItems);

    // visibility in server logs + response headers (helps when you see “blank”)
    const itemsCount = Array.isArray(wbsItems) ? wbsItems.length : 0;
    if (!rows.length) {
      console.warn("[WBS EXPORT] No rows found", { projectId, artifactId, itemsCount });
    } else {
      console.log("[WBS EXPORT] Export rows", { projectId, artifactId, itemsCount, rowsCount: rows.length });
    }

    const buffer = await renderWbsXlsx({
      project: {
        code: project.code,
        title: project.title,
        client: project.client,
        orgName: project.orgName,
        description: "", // schema-safe (projects.description may not exist)
      },
      artifact: {
        title: artifact.title || "Work Breakdown Structure",
        type: (artifact.artifact_type || artifact.type || "wbs") as string,
        updatedAt: artifact.updated_at,
      },
      rows,
    });

    const timestamp = formatDateUK(new Date()).replace(/\//g, "-");
    const baseName = sanitizeFilename(filenameParam || `WBS_${project.code || "P-00000"}_${timestamp}`);
    const filename = baseName.toLowerCase().endsWith(".xlsx") ? baseName : `${baseName}.xlsx`;

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(buffer))), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "X-Export-Count": String(rows.length),
        "X-Items-Count": String(itemsCount),
        "X-Project-Code": project.code,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (err: any) {
    if (err instanceof ExportError) {
      return jsonErr(err.message, err.statusCode, { code: err.code });
    }

    console.error("[/api/artifacts/wbs/export/xlsx] ERROR", err);
    return jsonErr(String(err?.message || err || "Unknown error"), 500, {
      stack: err?.stack ? String(err.stack) : null,
    });
  }
}
