import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";

function jsonOk(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function jsonErr(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}
function safeStr(x: any) {
  return typeof x === "string" ? x : "";
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const projectId = safeStr(searchParams.get("projectId"));
  if (!projectId) return jsonErr("projectId required", 400);

  const sb = await createClient();
  const { data, error } = await sb
    .from("lessons_learned")
    .select("category,status,impact,severity,created_at,ai_generated")
    .eq("project_id", projectId);

  if (error) return jsonErr(error.message, 400);

  const rows = data ?? [];
  const countBy = (key: string) =>
    rows.reduce((acc: any, r: any) => {
      const k = String(r[key] || "—");
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});

  const monthly = rows.reduce((acc: any, r: any) => {
    const ym = String(r.created_at || "").slice(0, 7) || "—";
    acc[ym] = (acc[ym] || 0) + 1;
    return acc;
  }, {});

  return jsonOk({
    totals: {
      lessons: rows.length,
      ai: rows.filter((r: any) => r.ai_generated).length,
      manual: rows.filter((r: any) => !r.ai_generated).length,
    },
    byCategory: countBy("category"),
    byStatus: countBy("status"),
    bySeverity: countBy("severity"),
    byImpact: countBy("impact"),
    monthlyTrend: monthly,
  });
}

