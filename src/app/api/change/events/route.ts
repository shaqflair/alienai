// src/app/api/ai/events/route.ts
import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createClient as createSbJsClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function safeStr(x: unknown) {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}
function safeNum(x: unknown, fallback = 0) {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing env vars for adminClient()");
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
  if (!mem) throw new Error("Not found");

  return { user: auth.user, member: mem };
}

/** tiny helper: create a consistent summary payload without needing an LLM */
function buildChangeAiSummary(args: {
  title: string;
  description: string;
  deliveryStatus: string;
  decisionStatus: string;
  priority: string;
  cost: number;
  days: number;
  risk: string;
}) {
  const title = safeStr(args.title).trim();
  const desc = safeStr(args.description).trim();
  const lane = safeStr(args.deliveryStatus).trim() || "new";
  const decision = safeStr(args.decisionStatus).trim() || null;
  const priority = safeStr(args.priority).trim() || "Medium";

  const days = safeNum(args.days, 0);
  const cost = safeNum(args.cost, 0);
  const risk = safeStr(args.risk).trim() || "None identified";

  const headline = title ? `Impact review for: ${title}` : `Impact review for change request`;

  const scheduleTxt =
    days > 0 ? `Estimated +${days} day(s) impact (based on current inputs).` : `No schedule slip currently flagged.`;

  const costTxt =
    cost > 0 ? `Estimated cost impact ~Â£${cost.toLocaleString("en-GB")}.` : `No cost impact currently flagged.`;

  const scopeTxt = desc
    ? `Scope summary: ${desc.length > 140 ? desc.slice(0, 140) + "â€¦" : desc}`
    : `Add a short summary to improve scope clarity.`;

  let nextAction = "";
  if (decision === "submitted") {
    nextAction = "Awaiting approver decision. Item is locked for review.";
  } else if (decision === "approved") {
    nextAction = "Approved for implementation. Proceed with execution and monitoring.";
  } else if (decision === "rejected" || decision === "rework") {
    nextAction = "Address feedback and resubmit for approval.";
  } else if (lane === "analysis") {
    nextAction = "Add mitigation/actions and attach evidence (WBS/Schedule/Risks), then Submit for approval.";
  } else if (lane === "review") {
    nextAction = "Await approver decision. If rejected, address feedback and resubmit.";
  } else {
    nextAction = "Complete the analysis fields and link to WBS/Schedule before moving forward.";
  }

  const alternatives = [
    {
      title: "Option A â€” Proceed with mitigations",
      summary: "Proceed as requested, but add mitigations and approvals to reduce delivery risk.",
      tradeoff: "Fastest path, but risk depends on quality of mitigations.",
    },
    {
      title: "Option B â€” Phase the change",
      summary: "Deliver in smaller increments to reduce risk and control schedule impact.",
      tradeoff: "Lower risk, but more coordination and governance steps.",
    },
    {
      title: "Option C â€” Defer / redesign",
      summary: "Defer until prerequisites are ready or redesign scope to reduce cost/schedule impact.",
      tradeoff: "May protect delivery, but delays benefit realization.",
    },
  ];

  return {
    summary: {
      headline,
      schedule: scheduleTxt,
      cost: costTxt,
      scope: scopeTxt,
      risk,
      next_action: nextAction,
      governance: { lane, decision, priority },
    },
    alternatives,
    rationale: `Auto-generated summary (lane=${lane}, decision=${decision || "none"}, priority=${priority}).`,
    model: "rule-based-v1",
  };
}

/** Pre-create draft assist: generate field drafts from the modal payload only (no change_id yet). */
function buildDraftAssistFromPayload(payload: any) {
  const title = safeStr(payload?.title).trim();
  const summary = safeStr(payload?.summary).trim();
  const priority = safeStr(payload?.priority).trim() || "Medium";
  const requester = safeStr(payload?.requester).trim();
  const interview = payload?.interview ?? {};

  const about = safeStr(interview?.about || title).trim();
  const why = safeStr(interview?.why || summary).trim();
  const impacted = safeStr(interview?.impacted).trim();
  const whenTxt = safeStr(interview?.when).trim();
  const constraints = safeStr(interview?.constraints).trim();
  const costs = safeStr(interview?.costs).trim();
  const riskLevel = safeStr(interview?.riskLevel).trim() || "Medium";
  const rollback = safeStr(interview?.rollback).trim();

  // Keep it â€œPMO cleanâ€, not verbose.
  const outSummary =
    summary ||
    (about
      ? `${about}${why ? ` â€” ${why}` : ""}`.slice(0, 1200)
      : "Describe the change in 2â€“3 lines for quick scanning.");

  const justification =
    safeStr(payload?.justification).trim() ||
    (why
      ? `Driver / value:\n- ${why}\n\nExpected outcome:\n- Improved delivery, risk reduction, or benefit realisation (confirm specifics).`
      : "State the driver/value, what problem it solves, and what benefit is realised.");

  const financial =
    safeStr(payload?.financial).trim() ||
    `Cost impact (estimate): ${costs || "TBC"}\n\nNotes:\n- Confirm funding source (BAU / project / change budget)\n- Confirm commercial implications (supplier day-rates, licences, OPEX/CAPEX)`;

  const schedule =
    safeStr(payload?.schedule).trim() ||
    `Target window: ${whenTxt || "TBC"}\n\nMilestones impacted:\n- Identify impacted milestones and any critical path implications.\n\nConstraints:\n- ${constraints || "TBC"}`;

  const risks =
    safeStr(payload?.risks).trim() ||
    `Risk level: ${riskLevel}\n\nKey risks (add mitigations):\n- Delivery risk: scope/effort uncertainty\n- Operational risk: change window / service impact\n- Security/compliance risk: approvals and evidence required`;

  const dependencies =
    safeStr(payload?.dependencies).trim() ||
    `Dependencies:\n- Approvals (CAB/Change Authority)\n- Access & environments (DEV/UAT/PROD)\n- Linked artifacts (WBS/Schedule/RAID)\n\nImpacted parties:\n- ${impacted || "TBC"}`;

  const assumptions =
    safeStr(payload?.assumptions).trim() ||
    `Assumptions:\n- Required SMEs/resources available when needed\n- Environments and access approved in time\n- No conflicting releases/change freezes`;

  const implementation =
    safeStr(payload?.implementation).trim() ||
    `Implementation approach:\n1) Confirm scope + acceptance criteria\n2) Prepare implementation plan + communications\n3) Execute in agreed window\n4) Validate success + capture evidence\n5) Update WBS/Schedule/RAID + close change`;

  const rollbackPlan =
    safeStr(payload?.rollback).trim() ||
    (rollback
      ? rollback
      : `Rollback / validation:\n- Define success checks\n- Backout trigger conditions\n- Steps to revert safely\n- Post-change monitoring window`);

  // Impact: keep default 0/0, but keep a sensible risk string.
  const impact = {
    days: safeNum(payload?.impact?.days, 0),
    cost: safeNum(payload?.impact?.cost, 0),
    risk: (safeStr(payload?.impact?.risk).trim() || riskLevel || "None identified").toString(),
  };

  return {
    summary: outSummary,
    justification,
    financial,
    schedule,
    risks,
    dependencies,
    assumptions,
    implementation,
    rollback: rollbackPlan,
    impact,
    model: "rule-based-v1",
  };
}

export async function POST(req: NextRequest) {
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

    const supported = new Set([
      "smoke_test",
      "charter_stakeholders_updated",

      "change_ai_scan_requested",
      "change_created",
      "change_saved",
      "change_submitted_for_approval",
      "change_draft_assist_requested",
    ]);

    if (!supported.has(eventType)) {
      return NextResponse.json({ ok: true, ignored: true, eventType });
    }

    if (eventType === "smoke_test") {
      const admin = adminClient();

      const sig = `${projectId}||smoke_test||${safeStr(artifactId) || "no_artifact"}`
        .toLowerCase()
        .slice(0, 800);

      const suggestion = {
        project_id: projectId,
        artifact_id: artifactId,
        target_artifact_type: safeStr(body?.payload?.target_artifact_type) || "stakeholder_register",
        suggestion_type: "smoke_test",
        status: "proposed",
        rationale: `Smoke test suggestion generated from /api/ai/events.`,
        sig,
        payload: {
          message: "If you can see this suggestion, the AI events â†’ suggestions pipeline works.",
          created_from: "smoke_test",
          artifact_id: artifactId,
        },
      };

      const { data: existing, error: exErr } = await admin
        .from("ai_suggestions")
        .select("id")
        .eq("project_id", projectId)
        .eq("sig", sig)
        .limit(1);

      if (exErr) throw new Error(exErr.message);

      if (!existing || existing.length === 0) {
        const { error: insErr } = await admin.from("ai_suggestions").insert([suggestion]);
        if (insErr) throw new Error(insErr.message);
        return NextResponse.json({ ok: true, generated: 1, eventType });
      }

      return NextResponse.json({ ok: true, generated: 0, deduped: true, eventType });
    }

    if (eventType === "charter_stakeholders_updated") {
      return NextResponse.json({ ok: true, handled: true, eventType });
    }

    // âœ… Draft assist can be PRE-CREATE (no changeId yet)
    if (eventType === "change_draft_assist_requested") {
      const changeId =
        safeStr(artifactId).trim() ||
        safeStr(body?.payload?.changeId).trim() ||
        safeStr(body?.payload?.change_id).trim();

      // Pre-create: no DB read/write required
      if (!changeId) {
        const ai = buildDraftAssistFromPayload(body?.payload ?? {});
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

      // If change exists already, fall through to â€œload change + upsert summaryâ€ below
    }

    // âœ… CHANGE AI: write into change_ai_summaries (requires changeId)
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

      const { data: cr, error: crErr } = await supabase
        .from("change_requests")
        .select("id, project_id, title, description, delivery_status, decision_status, priority, impact_analysis, risk")
        .eq("id", changeId)
        .eq("project_id", projectId)
        .maybeSingle();

      if (crErr) throw new Error(crErr.message);
      if (!cr) return NextResponse.json({ ok: false, error: "Change request not found" }, { status: 404 });

      const impact = (cr as any)?.impact_analysis ?? {};
      const ai = buildChangeAiSummary({
        title: safeStr((cr as any)?.title),
        description: safeStr((cr as any)?.description),
        deliveryStatus: safeStr((cr as any)?.delivery_status),
        decisionStatus: safeStr((cr as any)?.decision_status),
        priority: safeStr((cr as any)?.priority),
        cost: safeNum(impact?.cost, 0),
        days: safeNum(impact?.days, 0),
        risk: safeStr((cr as any)?.risk ?? impact?.risk),
      });

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

      // If this is a draft assist request for an existing change, return drafts too
      if (eventType === "change_draft_assist_requested") {
        return NextResponse.json({
          ok: true,
          handled: true,
          eventType,
          item: up,
          model: ai.model,
          ai: {
            summary: ai.summary.scope, // better â€œsummaryâ€ than headline-only
            justification: ai.rationale,
            financial: ai.summary.cost,
            schedule: ai.summary.schedule,
            risks: ai.summary.risk,
            dependencies: "Review linked artifacts (WBS/Schedule/RAID) for dependencies.",
            assumptions: "Validate assumptions against environments/access/approvals.",
            implementation: "Define steps, owners, windows, and evidence collection.",
            rollback: "Define backout triggers, revert steps, and validation checks.",
            impact: {
              days: safeNum(impact?.days, 0),
              cost: safeNum(impact?.cost, 0),
              risk: ai.summary.risk,
            },
          },
        });
      }

      return NextResponse.json({ ok: true, handled: true, eventType, item: up });
    }

    return NextResponse.json({ ok: true, handled: true, eventType });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}


