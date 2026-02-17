// src/app/api/export/pptx/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { renderSchedulePptx } from "@/lib/exports/schedule/renderSchedulePptx";
import { parseDateUTC, safeFileName } from "@/lib/exports/schedule/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const artifactId = searchParams.get("artifactId");
    const title = searchParams.get("title") || "Project Roadmap";
    const pmName = (searchParams.get("pm") || searchParams.get("pmName") || "").trim();

    const viewStart = parseDateUTC(searchParams.get("viewStart"));
    const viewEnd = parseDateUTC(searchParams.get("viewEnd"));

    const weeksPerSlide = Math.max(
      1,
      Math.min(12, Number(searchParams.get("weeksPerSlide") || "8") || 8)
    );

    let contentJson: any = null;

    if (artifactId) {
      const supabase = await createClient();
      const { data, error } = await supabase
        .from("artifacts")
        .select("content_json")
        .eq("id", artifactId)
        .maybeSingle();

      if (error) throw new Error(error.message);
      contentJson = data?.content_json ?? null;
    }

    const buffer = await renderSchedulePptx({
      title,
      pmName,
      contentJson,
      viewStart,
      viewEnd,
      weeksPerSlide,
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${safeFileName(title)}_roadmap.pptx"`,
      },
    });
  } catch (err: any) {
    console.error("[/api/export/pptx] ERROR", err);
    return NextResponse.json(
      {
        ok: false,
        error: String(err?.message || err || "Unknown error"),
        stack: err?.stack ? String(err.stack) : null,
      },
      { status: 500 }
    );
  }
}

