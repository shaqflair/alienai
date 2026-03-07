// FILE: src/app/api/artifacts/save-json/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(d: any = {}) {
  const r = NextResponse.json({ ok: true, ...d });
  r.headers.set("Cache-Control", "no-store, max-age=0");
  return r;
}
function err(e: string, s = 400) {
  const r = NextResponse.json({ ok: false, error: e }, { status: s });
  r.headers.set("Cache-Control", "no-store, max-age=0");
  return r;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    let body: any = {};
    try { body = await req.json(); } catch { return err("Invalid JSON"); }

    const artifactId = String(body.artifactId ?? "").trim();
    const contentJson = body.contentJson;

    if (!artifactId)      return err("artifactId is required");
    if (contentJson == null) return err("contentJson is required");

    const { error } = await supabase
      .from("artifacts")
      .update({ content_json: contentJson, updated_at: new Date().toISOString() })
      .eq("id", artifactId);

    if (error) return err(error.message, 500);
    return ok();
  } catch (e: any) {
    return err(String(e?.message ?? "Server error"), 500);
  }
}