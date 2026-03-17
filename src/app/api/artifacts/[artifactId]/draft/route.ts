import { NextResponse } from "next/server";
import { saveArtifactDraft } from "@/lib/server/artifacts/collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function readArtifactId(ctx: any): string {
  const v = ctx?.params?.artifactId;
  return typeof v === "string" ? v : Array.isArray(v) ? String(v[0] || "") : "";
}

async function safeJson(req: Request) {
  return req.json().catch(() => ({}));
}

export async function POST(req: Request, ctx: any) {
  const artifactId = readArtifactId(ctx);
  if (!artifactId) {
    return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
  }

  const body = await safeJson(req);

  const result = await saveArtifactDraft({
    artifactId,
    title: body?.title,
    content: body?.content,
    sessionId: body?.sessionId,
    clientDraftRev: Number(body?.clientDraftRev || 0),
    autosave: !!body?.autosave,
    summary: body?.summary || null,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 409 });
}