// src/app/api/ai/draft-assist/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { safeStr, buildDraftAssist } from "@/lib/ai/change-ai";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Auth guard
// ---------------------------------------------------------------------------

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem || mem.is_active === false || mem.removed_at != null) throw new Error("Forbidden");

  return auth.user;
}

// ---------------------------------------------------------------------------
// POST /api/ai/draft-assist
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => ({} as any));

    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    }

    await requireAuthAndMembership(supabase, projectId);

    // Use `body.draft` if provided, otherwise treat top-level body as the payload
    const payload = body?.draft ?? body;

    // LLM-powered draft assist (with rule-based fallback)
    const ai = await buildDraftAssist(payload);

    return NextResponse.json({
      ok: true,
      item: {
        summary: ai.summary,
        justification: ai.justification,
        financial: ai.financial,
        schedule: ai.schedule,
        risks: ai.risks,
        dependencies: ai.dependencies,
        assumptions: ai.assumptions,
        implementation: ai.implementation,
        rollback: ai.rollback,
        impact: ai.impact,
        model: ai.model,
      },
    });
  } catch (e: any) {
    console.error("[ai/draft-assist] Unhandled error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}