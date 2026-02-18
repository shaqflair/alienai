import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { exportChangeRequestXlsxBuffer } from "@/lib/exports/change/exportChangeRequestXlsxBuffer";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

function safeStr(x: any) {
  if (typeof x === "string") return x.trim();
  if (x == null) return "";
  return String(x);
}

function inferChangeIdFromPath(req: NextRequest) {
  const pathname = new URL(req.url).pathname; // /api/export/change/<id>/xlsx
  const parts = pathname.split("/").filter(Boolean);
  const idx = parts.lastIndexOf("xlsx");
  if (idx > 0) return safeStr(parts[idx - 1]);
  return "";
}

export async function GET(req: NextRequest, ctx: any) {
  try {
    const routeId = safeStr((await ctx.params).id);
    const pathId = inferChangeIdFromPath(req);

    const url = new URL(req.url);
    const queryId = safeStr(
      url.searchParams.get("id") ||
        url.searchParams.get("changeId") ||
        url.searchParams.get("change_id")
    );

    const changeId = routeId || pathId || queryId;
    if (!changeId) return jsonErr("Missing change id", 400, { routeId, pathId });

    const { buffer, filename } = await exportChangeRequestXlsxBuffer(changeId);

    return new NextResponse(new Uint8Array(new Uint8Array(buffer)), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[CR XLSX EXPORT]", err);
    const msg = String(err?.message || "Failed to generate XLSX");
    const status =
      Number(err?.status) || (msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : 500);
    return jsonErr(msg, status);
  }
}
