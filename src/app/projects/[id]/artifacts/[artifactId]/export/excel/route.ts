import { NextResponse } from "next/server";

export const runtime = "nodejs";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export async function GET(
  req: Request,
  ctx: { params: { id?: string; artifactId?: string } }
) {
  const projectId = safeParam(ctx?.params?.id);
  const artifactId = safeParam(ctx?.params?.artifactId);

  if (!projectId || !artifactId) {
    return NextResponse.json({ error: "Missing params" }, { status: 400 });
  }

  // Redirect to the canonical XLSX route
  return NextResponse.redirect(
    new URL(`/projects/${projectId}/artifacts/${artifactId}/export/xlsx`, req.url),
    { status: 302 }
  );
}
