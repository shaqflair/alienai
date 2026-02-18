// src/app/api/artifacts/lessons/export/xlsx/route.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { exportLessonsXlsx } from "@/lib/exports/lessons";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const artifactId = safeStr(url.searchParams.get("artifactId")) || safeStr(url.searchParams.get("artifact_id"));
  const filenameBase = safeStr(url.searchParams.get("filename")).trim() || null;
  const status = url.searchParams.getAll("status").map((s) => safeStr(s).trim()).filter(Boolean);

  try {
    const supabase = await createClient();

    const { filename, bytes } = await exportLessonsXlsx({
      supabase,
      artifactId: artifactId || null,
      status: status.length ? status : null,
      filenameBase,
    });

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(bytes))), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Lessons XLSX export failed" }, { status: 500 });
  }
}
