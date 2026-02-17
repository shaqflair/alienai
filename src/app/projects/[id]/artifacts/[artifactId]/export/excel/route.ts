// src/app/projects/[id]/artifacts/[artifactId]/export/excel/route.ts

        param($m)
        $inner = $m.Groups[1].Value
        if ($inner -match '\bNextRequest\b') { return $m.Value }
        if ($inner -match '\bNextResponse\b') {
          # insert NextRequest right after opening brace
          return ('import { NextRequest, ' + $inner.Trim() + ' } from "next/server";') -replace '\s+,', ','
        }
        return $m.Value
      

// âœ… Node runtime (safe for Buffer-based exporters; redirect is fine too)
export const runtime = "nodejs";

function safeParam(x: unknown): string {
  return typeof x === "string" ? x : "";
}

export async function GET(req: NextRequest,
  ctx: { params: Promise<{ id: string; artifactId: string }> } // âœ… MUST match folder names
) {
  const { id, artifactId } = await ctx.params;

  const projectId = safeParam(id).trim();
  const artifactIdSafe = safeParam(artifactId).trim();

  if (!projectId || !artifactIdSafe) {
    return NextResponse.json(
      { error: "Missing params", got: { projectId, artifactId: artifactIdSafe } },
      { status: 400 }
    );
  }

  // âœ… Redirect to the canonical XLSX route (use 307 to preserve method)
  return NextResponse.redirect(
    new URL(`/projects/${projectId}/artifacts/${artifactIdSafe}/export/xlsx`, req.url),
    { status: 307 }
  );
}

