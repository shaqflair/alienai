import "server-only";

import { NextResponse } from "next/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x);
}

/**
 * GET /api/suggestions/explain?suggestionId=...
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const suggestionId = url.searchParams.get("suggestionId")?.trim();

    if (!suggestionId) {
      return NextResponse.json({ ok: false, error: "Missing suggestion id" }, { status: 400 });
    }

    if (!isUuid(suggestionId)) {
      return NextResponse.json({ ok: false, error: "Invalid suggestion id" }, { status: 400 });
    }

    const sb = adminClient();

    const { data, error } = await sb
      .from("ai_suggestions")
      .select(
        `
        id,
        suggestion_type,
        target_artifact_type,
        trigger_key,
        triggered_by_event_id,
        confidence,
        rationale
      `
      )
      .eq("id", suggestionId)
      .single();

    if (error || !data) {
      return NextResponse.json({ ok: false, error: "Suggestion not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      explanation: {
        rule: data.suggestion_type,
        target: data.target_artifact_type,
        trigger_key: data.trigger_key,
        triggered_by_event_id: data.triggered_by_event_id,
        confidence: data.confidence,
        rationale: data.rationale,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: String(e?.message ?? e) },
      { status: 500 }
    );
  }
}
