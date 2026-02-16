import "server-only";
import { NextResponse } from "next/server";
import { sanitizeFilename } from "./utils";

export function jsonOk(payload: any, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

export function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

export function fileResponse(buf: Buffer, filename: string, contentType: string) {
  const safe = sanitizeFilename(filename, "export");
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
    },
  });
}
