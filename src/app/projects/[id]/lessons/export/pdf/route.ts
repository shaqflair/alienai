// src/app/projects/[id]/lessons/export/pdf/route.ts
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

function truthyParam(x: string | null) {
  const v = safeStr(x).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "y";
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const url = new URL(req.url);
  const { id } = await Promise.resolve(ctx.params);

  const projectRef = safeStr(id).trim(); // uuid OR project_code
  const filenameBase = safeStr(url.searchParams.get("filename")).trim() || null;

  const status = url.searchParams.getAll("status").map((s) => safeStr(s).trim()).filter(Boolean);

  // ✅ NEW: Org Library export mode
  const publishedOnly = truthyParam(url.searchParams.get("publishedOnly"));

  try {
    const supabase = await createClient();

    const { filename, bytes } = await exportLessonsPdf({
      supabase,
      projectRef,
      status: status.length ? status : null,
      filenameBase,
      publishedOnly,
    });

    return new NextResponse(new Uint8Array(new Uint8Array(bytes)), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Lessons PDF export failed" }, { status: 500 });
  }
}
