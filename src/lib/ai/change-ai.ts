/**
 * src/lib/ai/change-ai.ts
 *
 * Shared utilities for Change Request AI features.
 * - buildChangeAiSummary   → gpt-4o        (persisted governance analysis)
 * - buildDraftAssist       → gpt-4o-mini   (high-frequency form drafting)
 *
 * Both fall back to rule-based logic if the OpenAI call fails.
 */

import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ChangeAiSummary {
  headline: string;
  schedule: string;
  cost: string;
  scope: string;
  risk: string;
  next_action: string;
  governance: {
    lane: string;
    decision: string | null;
    priority: string;
  };
}

export interface ChangeAiAlternative {
  title: string;
  summary: string;
  tradeoff: string;
}

export interface ChangeAiResult {
  summary: ChangeAiSummary;
  alternatives: ChangeAiAlternative[];
  rationale: string;
  model: string;
}

export interface DraftAssistResult {
  summary: string;
  justification: string;
  financial: string;
  schedule: string;
  risks: string;
  dependencies: string;
  assumptions: string;
  implementation: string;
  rollback: string;
  impact: { days: number; cost: number; risk: string };
  model: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function safeStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (x == null) return "";
  return String(x);
}

export function safeNum(x: unknown, fallback = 0): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : fallback;
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// LLM: Change AI Summary
// ---------------------------------------------------------------------------

const CHANGE_AI_SYSTEM = `You are a senior PMO analyst assistant. Your job is to produce concise, 
governance-ready analysis of change requests for capital project delivery teams.
Always respond with valid JSON only — no prose, no markdown fences.`;

const CHANGE_AI_SCHEMA = `{
  "summary": {
    "headline": "string — 1 sentence, verb-led, professional",
    "schedule": "string — plain-English schedule impact or 'No schedule impact identified'",
    "cost": "string — plain-English cost impact or 'No cost impact identified'",
    "scope": "string — 1-2 sentence scope summary for quick scanning",
    "risk": "string — top risk or 'No significant risks identified'",
    "next_action": "string — single clear PMO next step",
    "governance": {
      "lane": "string — delivery_status value",
      "decision": "string | null — decision_status or null",
      "priority": "string — priority level"
    }
  },
  "alternatives": [
    { "title": "string", "summary": "string", "tradeoff": "string" },
    { "title": "string", "summary": "string", "tradeoff": "string" },
    { "title": "string", "summary": "string", "tradeoff": "string" }
  ],
  "rationale": "string — 1-2 sentence reasoning for the analysis approach"
}`;

export async function buildChangeAiSummaryLLM(args: {
  title: string;
  description: string;
  deliveryStatus: string;
  decisionStatus: string;
  priority: string;
  cost: number;
  days: number;
  risk: string;
}): Promise<ChangeAiResult> {
  const client = getOpenAIClient();

  const userPrompt = `Analyse this change request and return JSON matching the schema exactly.

Change Request:
- Title: ${args.title || "(untitled)"}
- Description: ${args.description || "(no description)"}
- Delivery Lane: ${args.deliveryStatus || "new"}
- Decision Status: ${args.decisionStatus || "none"}
- Priority: ${args.priority || "Medium"}
- Schedule Impact: ${args.days > 0 ? `+${args.days} day(s)` : "none flagged"}
- Cost Impact: ${args.cost > 0 ? `£${args.cost.toLocaleString("en-GB")}` : "none flagged"}
- Risk: ${args.risk || "none identified"}

Required JSON schema:
${CHANGE_AI_SCHEMA}

Rules:
- next_action must reflect the governance lane and decision status
- Provide exactly 3 alternatives: proceed-with-mitigations, phase-the-change, defer-or-redesign
- Keep all strings concise and PMO-professional
- Return ONLY the JSON object`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    max_tokens: 1024,
    messages: [
      { role: "system", content: CHANGE_AI_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(text) as Omit<ChangeAiResult, "model">;

  return { ...parsed, model: response.model };
}

/** Rule-based fallback for change AI summary */
export function buildChangeAiSummaryFallback(args: {
  title: string;
  description: string;
  deliveryStatus: string;
  decisionStatus: string;
  priority: string;
  cost: number;
  days: number;
  risk: string;
}): ChangeAiResult {
  const title = safeStr(args.title).trim();
  const desc = safeStr(args.description).trim();
  const lane = safeStr(args.deliveryStatus).trim() || "new";
  const decision = safeStr(args.decisionStatus).trim() || null;
  const priority = safeStr(args.priority).trim() || "Medium";
  const days = safeNum(args.days, 0);
  const cost = safeNum(args.cost, 0);
  const risk = safeStr(args.risk).trim() || "None identified";

  const headline = title ? `Impact review for: ${title}` : "Impact review for change request";
  const scheduleTxt = days > 0 ? `Estimated +${days} day(s) impact.` : "No schedule slip currently flagged.";
  const costTxt = cost > 0 ? `Estimated cost impact ~£${cost.toLocaleString("en-GB")}.` : "No cost impact currently flagged.";
  const scopeTxt = desc
    ? `Scope summary: ${desc.length > 140 ? desc.slice(0, 140) + "…" : desc}`
    : "Add a short summary to improve scope clarity.";

  let nextAction = "Complete the analysis fields and link to WBS/Schedule before moving forward.";
  if (decision === "submitted") nextAction = "Awaiting approver decision. Item is locked for review.";
  else if (decision === "approved") nextAction = "Approved for implementation. Proceed with execution and monitoring.";
  else if (decision === "rejected" || decision === "rework") nextAction = "Address feedback and resubmit for approval.";
  else if (lane === "analysis") nextAction = "Add mitigations and evidence, then submit for approval.";
  else if (lane === "review") nextAction = "Await approver decision.";

  return {
    summary: {
      headline,
      schedule: scheduleTxt,
      cost: costTxt,
      scope: scopeTxt,
      risk,
      next_action: nextAction,
      governance: { lane, decision: decision || null, priority },
    },
    alternatives: [
      { title: "Option A — Proceed with mitigations", summary: "Proceed as requested with added mitigations.", tradeoff: "Fastest path; risk depends on mitigation quality." },
      { title: "Option B — Phase the change", summary: "Deliver in smaller increments to reduce risk.", tradeoff: "Lower risk, more coordination steps." },
      { title: "Option C — Defer / redesign", summary: "Defer until prerequisites are ready.", tradeoff: "Protects delivery but delays benefit realization." },
    ],
    rationale: `Fallback summary (lane=${lane}, decision=${decision || "none"}, priority=${priority}).`,
    model: "rule-based-fallback-v1",
  };
}

/** Wrapper: try gpt-4o, fall back to rules on any error */
export async function buildChangeAiSummary(
  args: Parameters<typeof buildChangeAiSummaryLLM>[0]
): Promise<ChangeAiResult> {
  try {
    return await buildChangeAiSummaryLLM(args);
  } catch (err) {
    console.error("[change-ai] gpt-4o summary failed, using fallback:", err);
    return buildChangeAiSummaryFallback(args);
  }
}

// ---------------------------------------------------------------------------
// LLM: Draft Assist  (gpt-4o-mini — cost-efficient, high frequency)
// ---------------------------------------------------------------------------

const DRAFT_ASSIST_SYSTEM = `You are a senior PMO change manager. You help project teams draft 
professional change requests for governance boards. Your output must be clear, concise, and 
governance-ready. Always respond with valid JSON only — no prose, no markdown fences.`;

const DRAFT_ASSIST_SCHEMA = `{
  "summary": "string — 2-3 sentence executive summary: what is changing, why, and who is impacted",
  "justification": "string — structured business case: driver/value, problem solved, benefit realised",
  "financial": "string — cost impact structured as: estimate, funding source, OPEX/CAPEX breakdown",
  "schedule": "string — target window, impacted milestones, critical path implications, constraints",
  "risks": "string — risk level + 3-4 key risks with brief mitigations",
  "dependencies": "string — approvals, environments, access, linked artifacts, impacted parties",
  "assumptions": "string — key assumptions about resources, access, and environment availability",
  "implementation": "string — numbered 5-step implementation approach",
  "rollback": "string — backout trigger conditions, revert steps, validation checks",
  "impact": {
    "days": "number — schedule impact in days (0 if unknown)",
    "cost": "number — cost impact in GBP (0 if unknown)",
    "risk": "string — High / Medium / Low"
  }
}`;

export async function buildDraftAssistLLM(payload: {
  title?: string;
  summary?: string;
  priority?: string;
  requester?: string;
  interview?: {
    about?: string;
    why?: string;
    impacted?: string;
    when?: string;
    constraints?: string;
    costs?: string;
    riskLevel?: string;
    rollback?: string;
  };
  [key: string]: unknown;
}): Promise<DraftAssistResult> {
  const client = getOpenAIClient();
  const iv = payload?.interview ?? {};

  const userPrompt = `Draft a professional change request from the following inputs. 
Return JSON matching the schema exactly — fill gaps with PMO-professional placeholder guidance 
in square brackets, e.g. [Confirm with sponsor].

Inputs:
- Title: ${payload.title || "(not provided)"}
- Summary: ${payload.summary || "(not provided)"}
- Priority: ${payload.priority || "Medium"}
- Requester: ${payload.requester || "(not provided)"}
- What is changing: ${iv.about || "(not provided)"}
- Why / driver: ${iv.why || "(not provided)"}
- Who is impacted: ${iv.impacted || "(not provided)"}
- When needed: ${iv.when || "(not provided)"}
- Constraints: ${iv.constraints || "(not provided)"}
- Cost estimate: ${iv.costs || "(not provided)"}
- Risk level: ${iv.riskLevel || "Medium"}
- Rollback approach: ${iv.rollback || "(not provided)"}

Required JSON schema:
${DRAFT_ASSIST_SCHEMA}

Rules:
- Write in third-person, professional PMO style
- For impact.days and impact.cost use 0 if not determinable from inputs
- impact.risk must be exactly one of: High, Medium, Low
- Return ONLY the JSON object`;

  const response = await client.chat.completions.create({
    model: "gpt-4o-mini",
    response_format: { type: "json_object" },
    max_tokens: 2048,
    messages: [
      { role: "system", content: DRAFT_ASSIST_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(text) as Omit<DraftAssistResult, "model">;

  return { ...parsed, model: response.model };
}

/** Rule-based fallback for draft assist */
export function buildDraftAssistFallback(payload: Parameters<typeof buildDraftAssistLLM>[0]): DraftAssistResult {
  const title = safeStr(payload?.title).trim();
  const summary = safeStr(payload?.summary).trim();
  const iv = payload?.interview ?? {};
  const riskLevel = safeStr(iv.riskLevel).trim() || "Medium";

  return {
    summary: summary || (title ? `Change request: ${title}` : "Describe the change in 2–3 lines."),
    justification: safeStr(iv.why) ? `Driver: ${iv.why}\n\nExpected outcome: [Confirm benefit with sponsor]` : "[State the driver/value and benefit realised]",
    financial: `Cost impact: ${safeStr(iv.costs) || "[TBC]"}\n\nFunding source: [BAU / project / change budget]\nConfirm OPEX/CAPEX split.`,
    schedule: `Target window: ${safeStr(iv.when) || "[TBC]"}\n\nImpacted milestones: [Identify and list]\nConstraints: ${safeStr(iv.constraints) || "[TBC]"}`,
    risks: `Risk level: ${riskLevel}\n\n- Delivery risk: scope/effort uncertainty\n- Operational risk: change window / service impact\n- Compliance risk: approvals and evidence required`,
    dependencies: `Approvals: [CAB/Change Authority]\nEnvironments: [DEV/UAT/PROD]\nImpacted parties: ${safeStr(iv.impacted) || "[TBC]"}`,
    assumptions: "Resources available as needed\nEnvironments approved in time\nNo conflicting releases or change freezes",
    implementation: "1) Confirm scope + acceptance criteria\n2) Prepare implementation plan\n3) Execute in agreed window\n4) Validate and capture evidence\n5) Update WBS/Schedule/RAID + close change",
    rollback: safeStr(iv.rollback) || "Define backout triggers, revert steps, and validation checks.",
    impact: { days: 0, cost: 0, risk: riskLevel },
    model: "rule-based-fallback-v1",
  };
}

/** Wrapper: try LLM, fall back to rules on any error */
export async function buildDraftAssist(payload: Parameters<typeof buildDraftAssistLLM>[0]): Promise<DraftAssistResult> {
  try {
    return await buildDraftAssistLLM(payload);
  } catch (err) {
    console.error("[change-ai] gpt-4o-mini draft assist failed, using fallback:", err);
    return buildDraftAssistFallback(payload);
  }
}
