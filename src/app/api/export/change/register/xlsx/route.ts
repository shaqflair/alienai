import "server-only";

import { NextRequest, NextResponse } from "next/server";
import {
  exportChangeRegisterXlsxBuffer,
  parseChangeRegisterInputsFromRequest,
} from "@/lib/exports/change/exportChangeRegisterXlsxBuffer";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

export async function GET(req: NextRequest) {
  try {
    const input = parseChangeRegisterInputsFromRequest(req);
    const { buffer, filename } = await exportChangeRegisterXlsxBuffer(input);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || "Failed to generate XLSX");
    const status = Number((e as any)?.status) || (msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500);
    const details = (e as any)?.details;
    return jsonErr(msg, status, details);
  }
}

export async function POST(req: NextRequest) {
  // Keep POST for backwards compatibility: accept JSON body as well.
  try {
    const url = new URL(req.url);
    const qsProject = url.searchParams.get("projectId") || url.searchParams.get("project_id");
    const qsArtifact = url.searchParams.get("artifactId") || url.searchParams.get("artifact_id");

    const body = await req.json().catch(() => ({}));

    const project_ref =
      (body as any)?.project_id ||
      (body as any)?.projectId ||
      qsProject ||
      "";

    const artifact_id =
      (body as any)?.artifact_id ||
      (body as any)?.artifactId ||
      qsArtifact ||
      null;

    const input = {
      project_ref: String(project_ref || ""),
      artifact_id: artifact_id ? String(artifact_id) : null,
    };

    const { buffer, filename } = await exportChangeRegisterXlsxBuffer(input);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    const msg = String(e?.message || "Failed to generate XLSX");
    const status = Number((e as any)?.status) || (msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500);
    const details = (e as any)?.details;
    return jsonErr(msg, status, details);
  }
}
