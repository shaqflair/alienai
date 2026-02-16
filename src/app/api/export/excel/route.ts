// src/app/api/export/excel/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { renderScheduleXlsx } from "@/lib/exports/schedule/renderScheduleXlsx";
import { parseDateUTC } from "@/lib/exports/schedule/utils";

export const runtime = "nodejs";
export const maxDuration = 60;

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeFileName(s: string) {
  return (s || "Schedule").replace(/[^a-z0-9]/gi, "_");
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);

    const artifactId = searchParams.get("artifactId");
    const title = searchParams.get("title") || "Schedule";
    const pmName = (searchParams.get("pm") || searchParams.get("pmName") || "").trim();

    const viewStart = parseDateUTC(searchParams.get("viewStart"));
    const viewEnd = parseDateUTC(searchParams.get("viewEnd"));

    const includeMilestonesSheet =
      String(searchParams.get("includeMilestones") || "").toLowerCase() === "true";

    // Fetch artifact content_json
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

    const buffer = await renderScheduleXlsx({
      title,
      pmName,
      contentJson,
      viewStart,
      viewEnd,
      includeMilestonesSheet,
    });

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeFileName(
          safeStr(title)
        )}_schedule.xlsx"`,
      },
    });
  } catch (err: any) {
    console.error("[/api/export/excel] ERROR", err);
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
