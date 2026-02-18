// src/app/api/artifacts/charter/export/pdf/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const artifactId = safeStr(url.searchParams.get("artifactId") || url.searchParams.get("artifact_id")).trim();

  if (!artifactId) return jsonErr("Missing artifactId", 400);

  url.pathname = `/api/artifacts/${artifactId}/export/pdf`;
  return NextResponse.redirect(url, 307);
}

export async function POST(req: NextRequest) {
  return GET(req);
}
