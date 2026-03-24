import { NextResponse } from "next/server";
import {
  acquireArtifactLock,
  getArtifactCollaborationState,
  refreshArtifactLock,
  releaseArtifactLock,
} from "@/lib/server/artifacts/collaboration";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

type RouteContext = {
  params: Promise<{ artifactId: string }> | { artifactId: string };
};

async function readArtifactId(ctx: RouteContext): Promise<string> {
  const params = await ctx?.params;
  const v = params?.artifactId;
  return typeof v === "string" ? v : Array.isArray(v) ? String(v[0] || "") : "";
}

async function safeJson(req: Request) {
  return req.json().catch(() => ({}));
}

export async function GET(_req: Request, ctx: RouteContext) {
  const artifactId = await readArtifactId(ctx);

  if (!artifactId) {
    return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
  }

  const state = await getArtifactCollaborationState(artifactId);

  if (!state) {
    return NextResponse.json({ ok: false, error: "Artifact not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true, state });
}

export async function POST(req: Request, ctx: RouteContext) {
  const artifactId = await readArtifactId(ctx);

  if (!artifactId) {
    return NextResponse.json({ ok: false, error: "Missing artifactId" }, { status: 400 });
  }

  const body = await safeJson(req);
  const action = String(body?.action || "").trim().toLowerCase();

  if (action === "acquire") {
    const result = await acquireArtifactLock(artifactId);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (action === "refresh") {
    const sessionId = String(body?.sessionId || "").trim();

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    }

    const result = await refreshArtifactLock(artifactId, sessionId);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  if (action === "release") {
    const sessionId = String(body?.sessionId || "").trim();
    const releaseReason = String(body?.releaseReason || "released").trim();

    if (!sessionId) {
      return NextResponse.json({ ok: false, error: "Missing sessionId" }, { status: 400 });
    }

    const result = await releaseArtifactLock(artifactId, sessionId, releaseReason);
    return NextResponse.json(result, { status: result.ok ? 200 : 409 });
  }

  return NextResponse.json({ ok: false, error: "Unsupported action" }, { status: 400 });
}