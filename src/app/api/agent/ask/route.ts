import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { runAgent } from "@/lib/agent/orchestrator";

export const runtime  = "nodejs";
export const dynamic  = "force-dynamic";
export const maxDuration = 60; // Up to 60s for deep multi-step agent reasoning

function jsonOk(data: any)   { return NextResponse.json({ ok: true,  ...data }); }
function jsonErr(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

/**
 * POST /api/agent/ask
 * Main chat endpoint. Runs the agent loop (Plan -> Act -> Observe).
 */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const message: string = String(body.message ?? "").trim();
    if (!message) return jsonErr("message is required");

    const history = Array.isArray(body.history) ? body.history : [];

    // Resolve organisation via service client to bypass RLS for context gathering
    const adminSb = createServiceClient();
    let organisationId: string = body.organisationId ?? "";

    if (!organisationId) {
      const { data: profile } = await adminSb
        .from("profiles")
        .select("active_organisation_id")
        .eq("user_id", user.id)
        .maybeSingle();
      organisationId = profile?.active_organisation_id ?? "";
    }

    if (!organisationId) return jsonErr("No active organisation found", 400);

    // Run the agent loop
    const result = await runAgent({
      userMessage:    message,
      history,
      organisationId,
      userId:         user.id,
    });

    return jsonOk({
      answer:     result.answer,
      drafts:     result.drafts,
      tool_calls: result.tool_calls,
      iterations: result.iterations,
    });

  } catch (err: any) {
    console.error("[agent/ask] POST error:", err);
    return jsonErr(err?.message ?? "Agent execution failed", 500);
  }
}

/**
 * PUT /api/agent/ask
 * Confirmation endpoint. Actually writes a draft (e.g., RAID item) to the DB.
 */
export async function PUT(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) return jsonErr("Not authenticated", 401);

    const body = await req.json().catch(() => ({}));
    const { draft_type, payload, organisationId } = body;

    if (draft_type === "create_raid") {
      const adminSb = createServiceClient();

      // Ensure we have an org context
      let orgId = organisationId;
      if (!orgId) {
        const { data: profile } = await adminSb
          .from("profiles")
          .select("active_organisation_id")
          .eq("user_id", user.id)
          .maybeSingle();
        orgId = profile?.active_organisation_id;
      }

      // Execute the actual database write
      const { data, error } = await adminSb
        .from("raid_items")
        .insert({
          ...payload,
          organisation_id: orgId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) return jsonErr(error.message);
      return jsonOk({ confirmed: true, raid_item: data });
    }

    return jsonErr(`Unknown draft type: ${draft_type}`);

  } catch (err: any) {
    console.error("[agent/ask] PUT error:", err);
    return jsonErr(err?.message ?? "Confirmation failed", 500);
  }
}
