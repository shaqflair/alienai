import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient }     from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { runAutoGovernance, runPortfolioAutoGovernance } from "@/lib/server/ai/governance/runAutoGovernance";
import { resolvePortfolioScope } from "@/lib/server/portfolio-scope";

export const runtime     = "nodejs";
export const dynamic     = "force-dynamic";
export const revalidate  = 0;
export const maxDuration = 60;

function ok(data: any)              { return NextResponse.json({ ok: true,  ...data }); }
function err(e: string, s = 400)    { return NextResponse.json({ ok: false, error: e }, { status: s }); }
function safeStr(x: any): string    { return typeof x === "string" ? x : x == null ? "" : String(x); }

// POST — run auto-governance (project or portfolio)
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const body      = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId).trim();
    const admin     = createAdminClient();

    const scope = await resolvePortfolioScope(supabase, user.id);
    const orgId = safeStr(scope?.organisationId).trim();
    if (!orgId) return err("No active organisation", 400);

    if (projectId) {
      // Single project
      const result = await runAutoGovernance(admin, projectId, orgId);
      return ok(result);
    } else {
      // Full portfolio
      const result = await runPortfolioAutoGovernance(admin, orgId);
      return ok(result);
    }
  } catch (e: any) {
    console.error("[ai/governance] POST error:", e);
    return err(safeStr(e?.message) || "Failed", 500);
  }
}

// GET — read existing actions
export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const url       = new URL(req.url);
    const projectId = safeStr(url.searchParams.get("projectId")).trim();
    const statusFilter = safeStr(url.searchParams.get("status") || "pending,sent").split(",").filter(Boolean);

    const scope = await resolvePortfolioScope(supabase, user.id);
    const orgId = safeStr(scope?.organisationId).trim();
    if (!orgId) return err("No active organisation", 400);

    let query = supabase
      .from("ai_governance_actions")
      .select("*")
      .eq("organisation_id", orgId)
      .in("status", statusFilter)
      .order("priority", { ascending: true })  // critical first
      .order("created_at", { ascending: false });

    if (projectId) query = query.eq("project_id", projectId);

    const { data: actions, error: fetchErr } = await query.limit(100);
    if (fetchErr) return err(fetchErr.message, 500);

    return ok({ actions: actions ?? [], count: (actions ?? []).length });
  } catch (e: any) {
    return err(safeStr(e?.message) || "Failed", 500);
  }
}

// PATCH — update action status (acknowledge, resolve, dismiss)
export async function PATCH(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return err("Unauthorized", 401);

    const body     = await req.json().catch(() => ({}));
    const actionId = safeStr(body?.actionId).trim();
    const status   = safeStr(body?.status).trim() as "acknowledged" | "resolved" | "dismissed";

    if (!actionId) return err("actionId required", 400);
    if (!["acknowledged", "resolved", "dismissed"].includes(status)) return err("Invalid status", 400);

    const now = new Date().toISOString();
    const update: Record<string, any> = { status, updated_at: now };
    if (status === "acknowledged") update.acknowledged_at = now;
    if (status === "resolved")      update.resolved_at     = now;
    if (status === "dismissed")    update.dismissed_at    = now;

    const { error: updateErr } = await supabase
      .from("ai_governance_actions")
      .update(update)
      .eq("id", actionId);

    if (updateErr) return err(updateErr.message, 500);
    return ok({ actionId, status });
  } catch (e: any) {
    return err(safeStr(e?.message) || "Failed", 500);
  }
}