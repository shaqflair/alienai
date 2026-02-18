import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { exportLessonsPdf } from "@/lib/exports/lessons";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(
  req: NextRequest, 
  ctx: { params: Promise<{ id: string }> }
) {
  const url = new URL(req.url);
  const { id } = await Promise.resolve(ctx.params);

  const projectRef = safeStr(id).trim();
  const filenameBase = safeStr(url.searchParams.get("filename")).trim() || null;
  const status = url.searchParams.getAll("status").map((s) => safeStr(s).trim()).filter(Boolean);

  try {
    const supabase = await createClient();

    const { filename, bytes } = await exportLessonsPdf({
      supabase,
      projectRef,
      status: status.length ? status : null,
      filenameBase,
    });

    return new NextResponse(new Uint8Array(new Uint8Array(bytes)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[PROJECT_PDF_EXPORT_ERROR]:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Lessons PDF export failed" }, 
      { status: 500 }
    );
  }
}

