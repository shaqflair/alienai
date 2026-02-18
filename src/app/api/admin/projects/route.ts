import "server-only";
import { NextResponse } from "next/server";
import { requirePlatformAdmin } from "@/lib/auth/requirePlatformAdmin";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  try {
    // This helper throws an error if the user is not a platform admin
    await requirePlatformAdmin();

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("projects")
      .select("id, organisation_id, title, created_at")
      .order("created_at", { ascending: false });

    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, items: data ?? [] });
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    
    // Smart status code mapping based on the error message
    const status = msg.toLowerCase().includes("forbidden") ? 403 : 
                   msg.toLowerCase().includes("auth") ? 401 : 400;
                   
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}
