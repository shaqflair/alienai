import "server-only";

import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function normalizeFormat(x: any): "pdf" | "docx" | "xlsx" | "" {
  const f = safeStr(x).toLowerCase();
  if (!f) return "";
  if (f.includes("pdf")) return "pdf";
  if (f.includes("doc") || f.includes("word")) return "docx";
  if (f.includes("xls") || f.includes("excel")) return "xlsx";
  return "";
}

function jsonErr(message: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error: message, meta }, { status });
}

function redirectTo(req: NextRequest, format: "pdf" | "docx" | "xlsx") {
  const url = new URL(req.url);
  url.searchParams.delete("format");
  url.pathname = url.pathname.replace(/\/export\/?$/, `/export/${format}`);
  return NextResponse.redirect(url, { status: 307 });
}

export async function GET(req: NextRequest) {
  const format = normalizeFormat(req.nextUrl.searchParams.get("format"));
  if (!format) return jsonErr("Unsupported format: (empty)", 400, { url: req.nextUrl.toString() });
  return redirectTo(req, format);
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as any));
  const format = normalizeFormat(req.nextUrl.searchParams.get("format") || body?.format || body?.type || body?.fileType);
  if (!format) return jsonErr("Unsupported format: (empty)", 400, { url: req.nextUrl.toString() });
  return redirectTo(req, format);
}