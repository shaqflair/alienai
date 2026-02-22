// src/app/api/ai/events/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";
import {
  safeStr,
  safeNum,
  buildChangeAiSummary,
  buildDraftAssist,
} from "@/lib/ai/change-ai";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// Supabase helpers
// ---------------------------------------------------------------------------

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createSbJsClient(url, key, { auth: { persistSession: false } });
}

async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, is_active")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Forbidden");

  return { user: auth.user, member: mem };
}

// ---------------------------------------------------------------------------
// Supported event types
// ---------------------------------------------------------------------------

const SUPPORTED_EVENTS = new Set([
  "smoke_test",
  "charter_stakeholders_updated",
  "change_ai_scan_requested",
  "change_created",
  "change_saved",
  "change_submitted_for_approval",
  "change_draft_assist_requested",
]);

// ---------------------------------------------------------------------------
// POST /api/ai/events
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const body = await req.json().catch(() => ({} as any));

    const projectId = safeStr(body?.projectId).trim();
    const artifactId = safeStr(body?.artifactId).trim() || null;
    const eventType = safeStr(body?.eventType).trim();

    if (!projectId) {
      return NextResponse.json({ ok: false, error: "Missing projectId" }, { status: 400 });
    }

    await requireAuthAndMembership(supabase, projectId);

    if (!SUPPORTED_EVENTS.has(eventType)) {
      return NextResponse.json({ ok: true, ignored: true, eventType });
    }

    // -----------------------------------------------------------------------
    // smoke_test
    // -----------------------------------------------------------------------
    if (eventType === "smoke_test") {
      const admin = adminClient();
      const sig = `${projectId}||smoke_test||${safeStr(artifactId) || "no_artifact"}`.toLowerCase().slice(0, 800);

      const { data: existing } = await admin
        .from("ai_suggestions")
        .select("id")
        .eq("project_id", projectId)
        .eq("sig", sig)
        .limit(1);

      if (!existing?.length) {
        const { error: insErr } = await admin.from("ai_suggestions").insert([
          {
            project_id: projectId,
            artifact_id: artifactId,
            target_artifact_type: safeStr(body?.payload?.target_artifact_type) || "stakeholder_register",
            suggestion_type: "smoke_test",
            status: "proposed",
            rationale: "Smoke test suggestion generated from /api/ai/events.",
            sig,
            payload: {
              message: "If you can see this suggestion, the AI events → suggestions pipeline works.",
              created_from: "smoke_test",
              artifact_id: artifactId,
            },
          },
        ]);
        if (insErr) throw new Error(insErr.message);
        return NextResponse.json({ ok: true, generated: 1, eventType });
      }

      return NextResponse.json({ ok: true, generated: 0, deduped: true, eventType });
    }

    // -----------------------------------------------------------------------
    // charter_stakeholders_updated (no-op placeholder)
    // -----------------------------------------------------------------------
    if (eventType === "charter_stakeholders_updated") {
      return NextResponse.json({ ok: true, handled: true, eventType });
    }

    // -----------------------------------------------------------------------
    // change_draft_assist_requested — pre-create (no changeId yet)
    // -----------------------------------------------------------------------
    if (eventType === "change_draft_assist_requested") {
      const changeId =
        safeStr(artifactId).trim() ||
        safeStr(body?.payload?.changeId).trim() ||
        safeStr(body?.payload?.change_id).trim();

      if (!changeId) {
        // Pre-create path: generate from form payload only, no DB read required
        const ai = await buildDraftAssist(body?.payload ?? {});
        return NextResponse.json({
          ok: true,
          handled: true,
          eventType,
          model: ai.model,
          ai: {
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
          },
        });
      }
      // If changeId is present fall through to the change AI block below
    }

    // -----------------------------------------------------------------------
    // Change AI events — require changeId, read CR, write ai summary
    // -----------------------------------------------------------------------
    if (
      eventType === "change_ai_scan_requested" ||
      eventType === "change_created" ||
      eventType === "change_saved" ||
      eventType === "change_submitted_for_approval" ||
      eventType === "change_draft_assist_requested"
    ) {
      const changeId =
        safeStr(artifactId).trim() ||
        safeStr(body?.payload?.changeId).trim() ||
        safeStr(body?.payload?.change_id).trim();

      if (!changeId) {
        return NextResponse.json(
          { ok: false, error: "Missing changeId (artifactId or payload.changeId)" },
          { status: 400 }
        );
      }

      // Load change request
      const { data: cr, error: crErr } = await supabase
        .from("change_requests")
        .select("id, project_id, title, description, delivery_status, decision_status, priority, impact_analysis, risk")
        .eq("id", changeId)
        .eq("project_id", projectId)
        .maybeSingle();

      if (crErr) throw new Error(crErr.message);
      if (!cr) return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 });

      const impact = (cr as any)?.impact_analysis ?? {};

      // LLM-powered (with rule-based fallback)
      const ai = await buildChangeAiSummary({
        title: safeStr((cr as any)?.title),
        description: safeStr((cr as any)?.description),
        deliveryStatus: safeStr((cr as any)?.delivery_status),
        decisionStatus: safeStr((cr as any)?.decision_status),
        priority: safeStr((cr as any)?.priority),
        cost: safeNum(impact?.cost, 0),
        days: safeNum(impact?.days, 0),
        risk: safeStr((cr as any)?.risk ?? impact?.risk),
      });

      // Persist to change_ai_summaries
      const admin = adminClient();
      const { data: up, error: upErr } = await admin
        .from("change_ai_summaries")
        .upsert(
          {
            project_id: projectId,
            change_id: changeId,
            summary: ai.summary,
            alternatives: ai.alternatives,
            rationale: ai.rationale,
            model: ai.model,
          },
          { onConflict: "change_id" }
        )
        .select("*")
        .maybeSingle();

      if (upErr) throw new Error(upErr.message);

      // For draft assist on an existing change, also return draft fields
      if (eventType === "change_draft_assist_requested") {
        const draft = await buildDraftAssist({
          title: safeStr((cr as any)?.title),
          summary: safeStr((cr as any)?.description),
          priority: safeStr((cr as any)?.priority),
          interview: { riskLevel: safeStr((cr as any)?.risk ?? impact?.risk) },
        });

        return NextResponse.json({
          ok: true,
          handled: true,
          eventType,
          item: up,
          model: ai.model,
          ai: {
            summary: draft.summary,
            justification: draft.justification,
            financial: draft.financial,
            schedule: draft.schedule,
            risks: draft.risks,
            dependencies: draft.dependencies,
            assumptions: draft.assumptions,
            implementation: draft.implementation,
            rollback: draft.rollback,
            impact: {
              days: safeNum(impact?.days, 0),
              cost: safeNum(impact?.cost, 0),
              risk: draft.impact.risk,
            },
          },
        });
      }

      return NextResponse.json({ ok: true, handled: true, eventType, item: up });
    }

    return NextResponse.json({ ok: true, handled: true, eventType });
  } catch (e: any) {
    console.error("[ai/events] Unhandled error:", e);
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}