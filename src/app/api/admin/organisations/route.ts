import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
  const sb = await createClient();
  const { data: auth } = await sb.auth.getUser();
  if (!auth?.user) return NextResponse.json({ ok: false, error: "Unauthenticated" }, { status: 401 });

  // Gate: must be platform admin (RLS-protected table)
  const { data: pa, error: paErr } = await sb
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (paErr || !pa) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // Now use service role (global access)
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("organisations")
    .select("id,name,created_at")
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, items: data ?? [] });
}

