// src/app/api/ai/change-guidance/route.ts
import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { sb, requireUser, requireProjectRole, safeStr } from "@/lib/change/server-helpers";

export const runtime = "nodejs";

function ok(data: any, status = 200) {
  return NextResponse.json({ ok: true, ...data }, { status });
}
function err(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function clamp(s: string, max: number) {
  const t = String(s ?? "");
  return t.length > max ? t.slice(0, max) : t;
}

type AiField = "title" | "summary" | "justification" | "financial" | "schedule" | "risks" | "dependencies";

function asField(x: any): AiField {
  const v = safeStr(x).trim().toLowerCase();
  const map: Record<string, AiField> = {
    title: "title",
    summary: "summary",
    justification: "justification",
    financial: "financial",
    schedule: "schedule",
    risks: "risks",
    dependencies: "dependencies",
  };
  return map[v] || "summary";
}

function nonEmpty(s: any) {
  return Boolean(safeStr(s).trim());
}

function score(payload: any) {
  // Weight the key approval fields
  const checks: Array<{ key: string; w: number; label: string; ok: boolean }> = [
    { key: "title", w: 15, label: "Title", ok: nonEmpty(payload?.title) },
    { key: "summary", w: 20, label: "Summary", ok: nonEmpty(payload?.summary) },
    { key: "justification", w: 15, label: "Business justification", ok: nonEmpty(payload?.sections?.justification) },
    { key: "financial", w: 10, label: "Financial impact", ok: nonEmpty(payload?.sections?.financial) },
    { key: "schedule", w: 10, label: "Schedule impact", ok: nonEmpty(payload?.sections?.schedule) },
    { key: "risks", w: 10, label: "Risks", ok: nonEmpty(payload?.sections?.risks) },
    { key: "dependencies", w: 10, label: "Dependencies", ok: nonEmpty(payload?.sections?.dependencies) },
    {
      key: "impact",
      w: 10,
      label: "Impact estimate (days/cost/risk)",
      ok: Number(payload?.aiImpact?.days ?? 0) > 0 || Number(payload?.aiImpact?.cost ?? 0) > 0 || nonEmpty(payload?.aiImpact?.risk),
    },
  ];

  let s = 0;
  const missing: string[] = [];
  for (const c of checks) {
    if (c.ok) s += c.w;
    else missing.push(c.label);
  }
  return { readinessScore: Math.min(100, Math.max(0, Math.round(s))), missingFields: missing };
}

function draftFor(field: AiField, p: any) {
  const title = safeStr(p?.title).trim();
  const summary = safeStr(p?.summary).trim();
  const days = Number(p?.aiImpact?.days ?? 0) || 0;
  const cost = Number(p?.aiImpact?.cost ?? 0) || 0;

  if (field === "title") {
    return clamp(title || "Change request: [clear action] for [scope/system]", 160);
  }

  if (field === "summary") {
    return clamp(
      summary ||
        `Requesting approval to implement the proposed change. This will address the identified requirement, confirm scope, and enable delivery with controlled risk. Estimated impact: ${days} day(s), Â£${cost.toLocaleString()} (if applicable).`,
      1200
    );
  }

  if (field === "justification") {
    return clamp(
      safeStr(p?.sections?.justification).trim() ||
        `This change is required to meet delivery requirements and avoid downstream delay. It improves service quality/compliance and reduces operational risk. Without approval, the delivery plan will remain constrained and may increase rework/cost.`,
      2000
    );
  }

  if (field === "financial") {
    return clamp(
      safeStr(p?.sections?.financial).trim() ||
        `Estimated commercial impact: Â£${cost.toLocaleString()} (if applicable). Confirm funding source (CR/budget line), billing approach, and whether this is in-scope or chargeable variation.`,
      2000
    );
  }

  if (field === "schedule") {
    return clamp(
      safeStr(p?.sections?.schedule).trim() ||
        `Expected schedule impact: ${days} day(s). Identify affected milestones, critical path implications, and any re-sequencing required to maintain delivery.`,
      2000
    );
  }

  if (field === "risks") {
    return clamp(
      safeStr(p?.sections?.risks).trim() ||
        `Key risks:
- Delivery: dependency slippage or access delays (mitigation: confirm owners & dates)
- Technical: implementation failure/rollback (mitigation: tested plan + backout)
- Governance: approval latency (mitigation: submit decision-ready pack)`,
      2000
    );
  }

  return clamp(
    safeStr(p?.sections?.dependencies).trim() ||
      `Dependencies:
- Required approvals (CAB/Change Authority)
- Vendor / customer access windows
- Technical prerequisites (accounts, firewall rules, environments)
- Updated documentation and comms plan`,
    2000
  );
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await sb();
    const user = await requireUser(supabase);

    const body = await req.json().catch(() => ({}));

    const projectId = safeStr(body?.projectId).trim();
    if (!projectId) return err("Missing projectId", 400);

    // gate: user must be member of project
    const role = await (requireProjectRole as any)(supabase, projectId, user.id).catch(async () => {
      return await (requireProjectRole as any)(supabase, projectId);
    });
    if (!role) return err("Forbidden", 403);

    const action = safeStr(body?.action).trim().toLowerCase();
    const field = asField(body?.field);

    const base = score(body);

    const suggestions: any[] = [];
    // lightweight suggestions by missing fields
    for (const m of base.missingFields.slice(0, 6)) {
      suggestions.push({
        field,
        text: `Add ${m.toLowerCase()} to make the request decision-ready.`,
        reason: "This is commonly required for approval.",
        confidence: 0.7,
      });
    }

    const drafts: any = {};
    if (action === "draft_field" || action === "improve_field" || action === "rewrite_for_approver") {
      drafts[field] = draftFor(field, body);
    }

    return ok({
      guidance: {
        ...base,
        suggestions,
        drafts,
        notes: [
          "Keep it short and measurable.",
          "State what decision you need and by when.",
          "Quantify schedule/cost impact and name dependencies.",
        ],
      },
    });
  } catch (e: any) {
    console.error("[POST /api/ai/change-guidance]", e);
    return err(safeStr(e?.message) || "AI guidance failed", 500);
  }
}


