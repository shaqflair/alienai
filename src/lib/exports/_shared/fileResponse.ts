// src/lib/exports/_shared/fileResponse.ts
import "server-only";
import { NextResponse } from "next/server";
import { sanitizeFilename } from "./utils";

export function jsonOk(payload: any, status = 200) {
  return NextResponse.json({ ok: true, ...payload }, { status });
}

export function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

export function fileResponse(
  buf: Buffer | Uint8Array,
  filename: string,
  contentType: string
) {
  const safe = sanitizeFilename(filename, "export");

  // ? NextResponse expects BodyInit; Uint8Array is accepted
  const body = buf instanceof Buffer ? new Uint8Array(buf) : buf;

  return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(body))), {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${safe}"`,
      "Cache-Control": "no-store",
    },
  });
}
