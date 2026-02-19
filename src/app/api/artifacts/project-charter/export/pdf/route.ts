import "server-only";

import { NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";

import { jsonErr } from "@/lib/exports/_shared/fileResponse";
import { exportCharterPdf } from "@/lib/exports/charter/exportCharterPdf";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeStr(x: unknown) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}
function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

type RouteCtx = { params: Promise<{ id: string }> };

async function handle(req: NextRequest, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;

    const artifactId = safeStr(id).trim();
    if (!artifactId) return jsonErr("Missing artifactId", 400);
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400);

    const supabase = await createClient();

    // Resolve project_id + content_json from artifacts
    const { data: art, error } = await supabase
      .from("artifacts")
      .select("id, project_id, content_json")
      .eq("id", artifactId)
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!art) return jsonErr("Not found", 404);

    const projectId = (art as any)?.project_id ? String((art as any).project_id) : null;
    const content_json = (art as any)?.content_json ?? null;

    return await exportCharterPdf({
      req,
      artifactId,
      projectId,
      content_json,
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "Server error");
    const status =
      msg === "Unauthorized" ? 401 : msg === "Forbidden" ? 403 : msg === "Not found" ? 404 : 500;
    return jsonErr(msg, status);
  }
}

export async function GET(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx);
}

export async function POST(req: NextRequest, ctx: RouteCtx) {
  return handle(req, ctx);
}
