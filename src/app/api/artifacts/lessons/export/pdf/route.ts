import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { exportLessonsPdf } from "@/lib/exports/lessons";

/**
 * PDF Export Route for Lessons Learned
 * Uses Node.js runtime for Puppeteer/Chromium compatibility.
 */
export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // Extract identifiers and optional overrides
  const artifactId = safeStr(url.searchParams.get("artifactId")) || safeStr(url.searchParams.get("artifact_id"));
  const filenameBase = safeStr(url.searchParams.get("filename")).trim() || null;

  // Extract status filters (e.g., ?status=Open&status=Resolved)
  const status = url.searchParams.getAll("status").map((s) => safeStr(s).trim()).filter(Boolean);

  try {
    const supabase = await createClient();

    const { filename, bytes } = await exportLessonsPdf({
      supabase,
      artifactId: artifactId || null,
      status: status.length ? status : null,
      filenameBase,
    });

    return new NextResponse(bytes, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[LESSONS_PDF_EXPORT_ERROR]:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Lessons PDF export failed" }, 
      { status: 500 }
    );
  }
}

