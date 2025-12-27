// src/app/projects/[id]/artifacts/[artifactId]/export/excel/route.ts
import { NextResponse } from "next/server";

// âœ… Node runtime (safe for Buffer-based exporters; redirect is fine too)
export const runtime = "nodejs";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; artifactId: string }> } // âœ… MUST match folder names
) {
  const { id, artifactId } = await params;
  const projectId = safeParam(id);
  const artifactIdSafe = safeParam(artifactId);

  if (!projectId || !artifactId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  // âœ… Redirect to the canonical XLSX route (use 307 to preserve method)
  return NextResponse.redirect(
    new URL(`/projects/${projectId}/artifacts/${artifactId}/export/xlsx`, req.url),
    { status: 307 }
  );
}



