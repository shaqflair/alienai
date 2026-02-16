import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { getExportMeta } from "@/lib/exports/core/meta";
import { exportRaidDocxBuffer } from "@/lib/exports/raid/exportRaidDocx";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

export async function GET(req: NextRequest) {
  const sb = await createClient();
  
  // Security check: Ensure the requester is logged in
  const { data: auth, error: authErr } = await sb.auth.getUser();
  if (authErr) return jsonErr(authErr.message, 401);
  if (!auth?.user) return jsonErr("Not authenticated", 401);

  const url = new URL(req.url);
  const projectId = String(url.searchParams.get("projectId") || "").trim();
  if (!projectId) return jsonErr("Missing projectId", 400);

  try {
    const meta = await getExportMeta(projectId);

    // Fetch RAID data from Supabase
    const { data: items, error } = await sb
      .from("raid_items")
      .select("id,type,title,owner,status,due_date,description,created_at")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) return jsonErr(error.message, 400);

    // Generate the DOCX buffer
    const buf = await exportRaidDocxBuffer({ meta, items: (items as any) ?? [] });

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="RAID_${meta.projectCode}.docx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return jsonErr(e?.message || "RAID DOCX export failed", 500);
  }
}
