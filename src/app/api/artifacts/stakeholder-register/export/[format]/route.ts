import "server-only";

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonErr(message: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error: message, meta }, { status });
}

function safeStr(x: any): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function normalizeFormat(x: string) {
  const f = safeStr(x).trim().toLowerCase();
  if (f === "pdf") return "pdf";
  if (f === "docx" || f === "word") return "docx";
  if (f === "xlsx" || f === "excel") return "xlsx";
  return "";
}

async function readParams(req: NextRequest) {
  const url = req.nextUrl;

  const qProjectId = safeStr(url.searchParams.get("projectId"));
  const qArtifactId = safeStr(url.searchParams.get("artifactId"));

  if (req.method === "GET") {
    return { projectId: qProjectId, artifactId: qArtifactId };
  }

  const body = await req.json().catch(() => ({} as any));
  const bProjectId = safeStr(body?.projectId ?? body?.project_id);
  const bArtifactId = safeStr(body?.artifactId ?? body?.artifact_id);

  return {
    projectId: qProjectId || bProjectId,
    artifactId: qArtifactId || bArtifactId,
  };
}

async function proxy(req: NextRequest, formatRaw: string) {
  const format = normalizeFormat(formatRaw);

  if (!["pdf", "docx", "xlsx"].includes(format)) {
    return jsonErr(`Unsupported format: ${formatRaw}`, 400);
  }

  const { projectId, artifactId } = await readParams(req);

  if (!artifactId) return jsonErr("Missing artifactId", 400);
  if (!projectId) return jsonErr("Missing projectId", 400);

  const target = new URL(req.url);
  target.pathname = `/api/artifacts/stakeholder-register/export/${format}`;
  target.searchParams.set("projectId", projectId);
  target.searchParams.set("artifactId", artifactId);

  const resp = await fetch(target.toString(), {
    method: "GET",
    headers: {
      cookie: req.headers.get("cookie") ?? "",
    },
    cache: "no-store",
  });

  if (!resp.ok) {
    let j: any = null;
    try {
      j = await resp.json();
    } catch {}
    return jsonErr(j?.error || `Export failed (${resp.status})`, resp.status, j?.meta ?? j?.details);
  }

  const ab = await resp.arrayBuffer();
  const headers = new Headers();
  const ct = resp.headers.get("content-type");
  const cd = resp.headers.get("content-disposition");
  if (ct) headers.set("Content-Type", ct);
  if (cd) headers.set("Content-Disposition", cd);
  headers.set("Cache-Control", "no-store");

  return new NextResponse(Buffer.from(ab), { status: 200, headers });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ format?: string }> | { format?: string } }
) {
  const params = await Promise.resolve(ctx.params as any);
  return proxy(req, safeStr(params?.format));
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ format?: string }> | { format?: string } }
) {
  const params = await Promise.resolve(ctx.params as any);
  return proxy(req, safeStr(params?.format));
}
