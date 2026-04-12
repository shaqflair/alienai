// src/app/api/projects/[id]/change-requests/route.ts
import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function ok(data: any) { return NextResponse.json({ ok: true, ...data }); }
function err(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const { id: projectId } = await params;

    const { data, error } = await supabase
      .from("change_requests")
      .select("id, title, status, created_at")
      .eq("project_id", projectId)
      .not("status", "in", '("closed","rejected","cancelled","archived")')
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      // Table might not exist — return empty gracefully
      if (error.message.includes("does not exist")) return ok({ items: [] });
      throw error;
    }

    return ok({ items: data ?? [] });
  } catch (e: any) {
    return ok({ items: [] }); // Always return empty rather than error — CR is optional
  }
}