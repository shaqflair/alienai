import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient }      from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";
import { computeDependencyGraph, addDependency } from "@/lib/server/ai/dependencies/computeDependencyGraph";

export const runtime    = "nodejs";
export const dynamic    = "force-dynamic";
export const revalidate = 0;

function ok(data: any)           { return NextResponse.json({ ok: true, ...data }); }
function err(e: string, s = 400) { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any): string { return typeof x === "string" ? x : x == null ? "" : String(x); }

export async function GET(_req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const scope = await resolvePortfolioScope(supabase, user.id);
    const orgId = safeStr(scope?.organisationId).trim();
    if (!orgId) return err("No active organisation", 400);

    const admin  = createAdminClient();
    const result = await computeDependencyGraph(admin, orgId);
    return ok(result);
  } catch (e: any) {
    console.error("[dependencies] GET error:", e);
    return err(safeStr(e?.message) || "Failed", 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const body = await req.json().catch(() => ({}));

    if (body.action === "delete" && body.dependencyId) {
      const { error } = await supabase
        .from("project_dependencies")
        .update({ status: "resolved" })
        .eq("id", body.dependencyId);
      return error ? err(error.message, 500) : ok({ deleted: true });
    }

    const { from_project_id, to_project_id } = body;
    if (!from_project_id || !to_project_id) return err("from_project_id and to_project_id required", 400);
    if (from_project_id === to_project_id)  return err("A project cannot depend on itself", 400);

    const scope = await resolvePortfolioScope(supabase, user.id);
    const orgId = safeStr(scope?.organisationId).trim();
    if (!orgId) return err("No active organisation", 400);

    const { dep, error } = await addDependency(supabase, orgId, body, user.id);
    if (error) return err(error.message, 500);
    return ok({ dependency: dep });
  } catch (e: any) {
    console.error("[dependencies] POST error:", e);
    return err(safeStr(e?.message) || "Failed", 500);
  }
}