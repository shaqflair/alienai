import "server-only";

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function jsonErr(message: string, status = 400, details?: any) {
  const res = NextResponse.json({ ok: false, error: message, details }, { status });
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const artifactId = safeStr(id).trim();
  if (!artifactId) return jsonErr("Missing artifactId", 400);

  const url = new URL(req.url);
  url.pathname = `/api/artifacts/${encodeURIComponent(artifactId)}/project-charter/export/pdf`;

  const res = NextResponse.redirect(url, 307);
  res.headers.set("Cache-Control", "no-store, max-age=0");
  return res;
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  return GET(req, ctx);
}
