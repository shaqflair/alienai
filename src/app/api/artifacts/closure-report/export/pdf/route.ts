// src/app/api/artifacts/closure-report/export/pdf/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { exportClosureReportPdf } from "@/lib/exports/closure-report";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/* ---------------- helpers ---------------- */

function jsonErr(error: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error, details }, { status });
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function pdfResponse(bytes: Buffer, filename: string) {
  return new NextResponse(bytes, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
      Pragma: "no-cache",
    },
  });
}

async function readJsonBodyBestEffort(req: NextRequest) {
  try {
    const ct = (req.headers.get("content-type") || "").toLowerCase();
    if (!ct.includes("application/json")) return {};
    return await req.json().catch(() => ({}));
  } catch {
    return {};
  }
}

function getArtifactIdFromQuery(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return (
    safeStr(searchParams.get("artifactId")).trim() ||
    safeStr(searchParams.get("artifact_id")).trim() ||
    ""
  );
}

function getFilenameBaseFromQuery(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  return (
    safeStr(searchParams.get("filenameBase")).trim() ||
    safeStr(searchParams.get("filename_base")).trim() ||
    ""
  );
}

/* ---------------- GET ---------------- */

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();

    const artifactId = getArtifactIdFromQuery(req);
    const filenameBase = getFilenameBaseFromQuery(req) || null;

    if (!artifactId) return jsonErr("Missing artifactId", 400, { example: "?artifactId=<uuid>" });
    if (!looksLikeUuid(artifactId)) return jsonErr("Invalid artifactId", 400, { artifactId });

    const { filename, bytes } = await exportClosureReportPdf({
      supabase,
      artifactId,
      filenameBase,
      contentOverride: null, // GET won't accept large content_json
    });

    return pdfResponse(bytes, filename);
  } catch (e: any) {
    console.error("[CLOSURE_PDF_EXPORT_ERROR][GET]:", e);
    return jsonErr("PDF export failed", 500, { message: e?.message || String(e) });
  }
}

/* ---------------- POST ---------------- */

export async function POST(req: NextRequest) {
  try {
    const body = await readJsonBodyBestEffort(req);

    // accept both keys
    const artifactId = safeStr(body?.artifact_id ?? body?.artifactId).trim();
    const filenameBase = safeStr(body?.filenameBase ?? body?.filename_base).trim() || null;

    // Prefer live editor JSON; exporter falls back to DB if null
    const contentOverride = body?.content_json ?? body?.contentOverride ?? null;

    if (!artifactId) return jsonErr("Missing artifact_id", 400, { expected: "body.artifact_id (uuid)" });
    if (!looksLikeUuid(artifactId)) return jsonErr("Invalid artifact_id", 400, { artifactId });

    const supabase = await createClient();

    const { filename, bytes } = await exportClosureReportPdf({
      supabase,
      artifactId,
      filenameBase,
      contentOverride,
    });

    return pdfResponse(bytes, filename);
  } catch (e: any) {
    console.error("[CLOSURE_PDF_EXPORT_ERROR][POST]:", e);
    return jsonErr("PDF export failed", 500, { message: e?.message || String(e) });
  }
}
