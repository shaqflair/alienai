import "server-only";
import { NextResponse } from "next/server";

export function fileResponse(
  data: Buffer | Uint8Array,
  filename: string,
  contentType: string
) {
  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}