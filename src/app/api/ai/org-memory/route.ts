import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient }      from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { buildOrgMemory } from "@/lib/server/ai/memory/buildOrgMemory";

export const runtime      = "nodejs";
export const dynamic      = "force-dynamic";
export const revalidate   = 0;
export const maxDuration = 30;

function ok(data: any)           { return NextResponse.json({ ok: true, ...data }); }
function err(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any): string { return typeof x === "string" ? x : x == null ? "" : String(x); }

// GET — read existing patterns
export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const scope = await resolvePortfolioScope(supabase, user.id);
    const orgId = safeStr(scope?.organisationId).trim();
    if (!orgId) return err("No active organisation", 400);

    const { data: patterns } = await supabase
      .from("org_memory_patterns")
      .select("*")
      .eq("organisation_id", orgId)
      .order("confidence", { ascending: false });

    return ok({ patterns: patterns ?? [], count: (patterns ?? []).length });
  } catch (e: any) {
    return err(safeStr(e?.message) || "Failed", 500);
  }
}

// POST — recompute patterns
export async function POST(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const scope = await resolvePortfolioScope(supabase, user.id);
    const orgId = safeStr(scope?.organisationId).trim();
    if (!orgId) return err("No active organisation", 400);

    const admin  = createAdminClient();
    const result = await buildOrgMemory(admin, orgId);
    return ok(result);
  } catch (e: any) {
    console.error("[org-memory] POST error:", e);
    return err(safeStr(e?.message) || "Failed", 500);
  }
}