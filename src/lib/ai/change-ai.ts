/**
 * src/lib/ai/change-ai.ts
 *
 * Shared utilities for Change Request AI features.
 * - buildChangeAiSummary      → gpt-4o        (persisted governance analysis)
 * - buildDraftAssist          → gpt-4o-mini   (high-frequency form drafting)
 * - buildPmImpactAssessment   → gpt-4o        (full PM review panel — new)
 *
 * All fall back to rule-based logic if the OpenAI call fails.
 */

import OpenAI from "openai";

// ---------------------------------------------------------------------------
// Types — existing
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
// Types — new PM Impact Assessment
// ---------------------------------------------------------------------------

type RAG = "red" | "amber" | "green" | "unknown";

export interface PmDimension {
  rag: RAG;
  score: number;       // 0-100
  headline: string;
  detail: string;
  actions: string[];
}

export interface PmImpactAssessment {
  readiness_score: number;     // 0-100
  readiness_label: string;     // "Ready" | "Needs Work" | "Not Ready"
  recommendation: string;      // "Approve" | "Approve with conditions" | "Request rework" | "Reject"
  executive_summary: string;
  schedule: PmDimension;
  cost: PmDimension;
  risk: PmDimension;
  scope: PmDimension;
  governance: PmDimension;
  blockers: string[];
  strengths: string[];
  next_actions: string[];
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

function safeArr(x: unknown): string[] {
  if (!Array.isArray(x)) return [];
  return x.map((v) => safeStr(v)).filter(Boolean);
}

function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return new OpenAI({ apiKey });
}

// ---------------------------------------------------------------------------
// LLM: Change AI Summary (existing — unchanged)
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
      headline, schedule: scheduleTxt, cost: costTxt, scope: scopeTxt, risk, next_action: nextAction,
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
// LLM: Draft Assist (existing — unchanged)
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

export async function buildDraftAssist(payload: Parameters<typeof buildDraftAssistLLM>[0]): Promise<DraftAssistResult> {
  try {
    return await buildDraftAssistLLM(payload);
  } catch (err) {
    console.error("[change-ai] gpt-4o-mini draft assist failed, using fallback:", err);
    return buildDraftAssistFallback(payload);
  }
}

// ---------------------------------------------------------------------------
// NEW: LLM: PM Impact Assessment  (gpt-4o — full structured review for PMs)
// ---------------------------------------------------------------------------

const PM_ASSESSMENT_SYSTEM = `You are a senior PMO governance analyst reviewing change requests 
for capital project delivery boards. You produce structured, opinionated assessments that give 
project managers clear signals on approval readiness. Always respond with valid JSON only — 
no prose, no markdown fences. Be direct, specific, and actionable.`;

const PM_ASSESSMENT_SCHEMA = `{
  "readiness_score": "number 0-100 — overall approval readiness",
  "readiness_label": "string — exactly one of: Ready, Needs Work, Not Ready",
  "recommendation": "string — exactly one of: Approve, Approve with conditions, Request rework, Reject",
  "executive_summary": "string — 2-3 sentences: what this CR does, why it matters, overall stance",
  "schedule": {
    "rag": "string — red | amber | green",
    "score": "number 0-100",
    "headline": "string — 1 sentence schedule verdict",
    "detail": "string — 2-3 sentences of specific schedule assessment",
    "actions": ["string — specific PM action", "string"]
  },
  "cost": {
    "rag": "string — red | amber | green",
    "score": "number 0-100",
    "headline": "string — 1 sentence cost verdict",
    "detail": "string — 2-3 sentences of specific cost assessment",
    "actions": ["string — specific PM action", "string"]
  },
  "risk": {
    "rag": "string — red | amber | green",
    "score": "number 0-100",
    "headline": "string — 1 sentence risk verdict",
    "detail": "string — 2-3 sentences of specific risk assessment with named mitigations",
    "actions": ["string — specific PM action", "string"]
  },
  "scope": {
    "rag": "string — red | amber | green",
    "score": "number 0-100",
    "headline": "string — 1 sentence scope verdict",
    "detail": "string — 2-3 sentences on scope clarity and business justification quality",
    "actions": ["string — specific PM action", "string"]
  },
  "governance": {
    "rag": "string — red | amber | green",
    "score": "number 0-100",
    "headline": "string — 1 sentence governance verdict",
    "detail": "string — 2-3 sentences on approval pathway, CAB readiness, compliance",
    "actions": ["string — specific PM action", "string"]
  },
  "blockers": ["string — specific blocker that must be resolved before approval"],
  "strengths": ["string — specific strength or completed element"],
  "next_actions": ["string — numbered specific PM action to take today"]
}`;

export async function buildPmImpactAssessmentLLM(args: {
  title: string;
  description: string;
  justification: string;
  financial: string;
  schedule: string;
  risks: string;
  dependencies: string;
  implementationPlan: string;
  rollbackPlan: string;
  deliveryStatus: string;
  decisionStatus: string;
  priority: string;
  cost: number;
  days: number;
  risk: string;
}): Promise<PmImpactAssessment> {
  const client = getOpenAIClient();

  const userPrompt = `You are reviewing this change request for approval readiness. 
Give a direct, opinionated PMO assessment. Do not echo the fields back — assess them.
Flag missing information, poor quality justifications, and unmitigated risks clearly.

Change Request Details:
- Title: ${args.title || "(untitled)"}
- Description / Summary: ${args.description || "(not provided)"}
- Business Justification: ${args.justification || "(not provided)"}
- Financial Impact: ${args.financial || "(not provided)"}
- Schedule Impact: ${args.schedule || "(not provided)"} ${args.days > 0 ? `[+${args.days} days flagged]` : ""}
- Cost Impact: ${args.cost > 0 ? `£${args.cost.toLocaleString("en-GB")} flagged` : "(not quantified)"}
- Risks: ${args.risks || "(not provided)"}
- Dependencies: ${args.dependencies || "(not provided)"}
- Implementation Plan: ${args.implementationPlan || "(not provided)"}
- Rollback Plan: ${args.rollbackPlan || "(not provided)"}
- Delivery Lane: ${args.deliveryStatus || "intake"}
- Decision Status: ${args.decisionStatus || "none"}
- Priority: ${args.priority || "Medium"}
- Risk Level: ${args.risk || "not assessed"}

Required JSON schema:
${PM_ASSESSMENT_SCHEMA}

Critical rules:
- readiness_score: 0-40 = Not Ready, 41-74 = Needs Work, 75-100 = Ready
- If justification, risks, or implementation plan are missing/thin → red that dimension and add to blockers
- If cost or schedule are unquantified → amber at minimum
- blockers must be SPECIFIC (e.g. "No rollback plan defined" not "Missing info")
- next_actions must be SPECIFIC and ACTIONABLE for today (e.g. "Attach cost estimate from finance team" not "Add more detail")
- Provide 2-5 blockers, 2-4 strengths, 3-5 next_actions
- Return ONLY the JSON object`;

  const response = await client.chat.completions.create({
    model: "gpt-4o",
    response_format: { type: "json_object" },
    max_tokens: 2000,
    messages: [
      { role: "system", content: PM_ASSESSMENT_SYSTEM },
      { role: "user", content: userPrompt },
    ],
  });

  const text = response.choices[0]?.message?.content ?? "";
  const parsed = JSON.parse(text) as Omit<PmImpactAssessment, "model">;
  return { ...parsed, model: response.model };
}

export function buildPmImpactAssessmentFallback(args: {
  title: string;
  description: string;
  justification: string;
  financial: string;
  schedule: string;
  risks: string;
  implementationPlan: string;
  rollbackPlan: string;
  deliveryStatus: string;
  decisionStatus: string;
  priority: string;
  cost: number;
  days: number;
  risk: string;
}): PmImpactAssessment {
  const hasJustification = safeStr(args.justification).trim().length > 20;
  const hasRisks = safeStr(args.risks).trim().length > 20;
  const hasImpl = safeStr(args.implementationPlan).trim().length > 20;
  const hasRollback = safeStr(args.rollbackPlan).trim().length > 20;
  const hasFinancial = args.cost > 0 || safeStr(args.financial).trim().length > 10;
  const hasDays = args.days > 0 || safeStr(args.schedule).trim().length > 10;

  const completedCount = [hasJustification, hasRisks, hasImpl, hasRollback, hasFinancial, hasDays].filter(Boolean).length;
  const score = Math.round((completedCount / 6) * 85);

  const blockers: string[] = [];
  if (!hasJustification) blockers.push("Business justification is missing or too brief — required for CAB review");
  if (!hasRisks) blockers.push("No risk assessment provided — mitigations must be documented before approval");
  if (!hasImpl) blockers.push("Implementation plan is absent — delivery approach must be defined");
  if (!hasRollback) blockers.push("No rollback plan defined — required for any change affecting production");
  if (!hasFinancial) blockers.push("Cost impact not quantified — attach estimate or formal TBC from finance");

  const strengths: string[] = [];
  if (hasJustification) strengths.push("Business justification has been completed");
  if (hasRisks) strengths.push("Risk section is populated with assessments");
  if (hasImpl) strengths.push("Implementation approach has been documented");
  if (hasRollback) strengths.push("Rollback plan is defined");
  if (args.priority) strengths.push(`Priority set as ${args.priority}`);

  const nextActions: string[] = [];
  if (!hasJustification) nextActions.push("Write a structured business justification: driver, outcome, and benefit realised");
  if (!hasRisks) nextActions.push("Complete the risk register: list top 3 risks with RAG rating and mitigation owner");
  if (!hasImpl) nextActions.push("Add numbered implementation steps with owner and time estimate per step");
  if (!hasRollback) nextActions.push("Define rollback triggers, revert procedure, and post-rollback validation checks");
  if (!hasFinancial) nextActions.push("Obtain cost estimate from finance — attach SOW or assumption basis");
  if (nextActions.length === 0) nextActions.push("Review all sections for completeness and submit for PMO approval");

  const dimRag = (has: boolean): RAG => has ? "green" : "red";
  const dimScore = (has: boolean): number => has ? 78 : 25;

  return {
    readiness_score: score,
    readiness_label: score >= 75 ? "Ready" : score >= 41 ? "Needs Work" : "Not Ready",
    recommendation: score >= 75 ? "Approve" : score >= 41 ? "Approve with conditions" : "Request rework",
    executive_summary: `Change request "${safeStr(args.title) || "untitled"}" is currently ${score >= 75 ? "well-documented and approaching approval readiness" : score >= 41 ? "partially complete with key sections still outstanding" : "incomplete and not ready for governance review"}. ${blockers.length > 0 ? `${blockers.length} blocking issue${blockers.length > 1 ? "s" : ""} must be resolved before submission.` : "All core sections are in place."}`,
    schedule: {
      rag: hasDays ? "amber" : "red",
      score: hasDays ? 60 : 20,
      headline: hasDays ? `Schedule impact of +${args.days} day(s) has been flagged` : "Schedule impact has not been quantified",
      detail: hasDays
        ? `A schedule impact of ${args.days} day(s) has been recorded. Confirm whether this affects the critical path or any CAB-controlled milestones.`
        : "No schedule impact data is present. A delivery window and milestone impact assessment are required before approval.",
      actions: hasDays
        ? ["Confirm whether this change falls within or outside the agreed change window", "Identify any milestone or critical path impacts and document them"]
        : ["Define target delivery window and compare against programme schedule", "Identify and document any milestone impacts or sequencing constraints"],
    },
    cost: {
      rag: dimRag(hasFinancial),
      score: dimScore(hasFinancial),
      headline: hasFinancial ? "Cost impact has been captured" : "Cost impact is unquantified",
      detail: hasFinancial
        ? `Financial information has been provided. Ensure funding source, CAPEX/OPEX split, and approval authority are clearly documented.`
        : "No cost estimate has been attached. A formal estimate, quote, or assumption basis is required for financial governance.",
      actions: hasFinancial
        ? ["Confirm funding source and budget approval authority", "Document CAPEX vs OPEX classification"]
        : ["Obtain cost estimate from finance team or vendor", "Attach SOW, quote, or documented assumption basis"],
    },
    risk: {
      rag: dimRag(hasRisks),
      score: dimScore(hasRisks),
      headline: hasRisks ? "Risk assessment is populated" : "Risk assessment is missing",
      detail: hasRisks
        ? `Risks have been documented. Review each risk for completeness: each should have an owner, likelihood rating, and mitigation action.`
        : "No risk assessment is present. This is a mandatory field for CAB submission.",
      actions: hasRisks
        ? ["Ensure each risk has a named owner and mitigation action", "Confirm the overall risk rating is consistent with individual risks"]
        : ["Complete risk register with minimum 3 risks rated High/Medium/Low", "Assign a mitigation owner for each identified risk"],
    },
    scope: {
      rag: dimRag(hasJustification),
      score: dimScore(hasJustification),
      headline: hasJustification ? "Business justification has been provided" : "Business justification is insufficient",
      detail: hasJustification
        ? `A justification has been provided. Ensure it covers the driver, expected outcome, and measurable benefit.`
        : "The business justification is missing or too brief. Reviewers need to understand the driver and benefit to approve this change.",
      actions: hasJustification
        ? ["Ensure justification references the specific business driver", "Add expected outcome and measurable success criteria"]
        : ["Write structured justification: driver, problem solved, benefit realised", "Include success criteria and how benefit will be measured"],
    },
    governance: {
      rag: (hasJustification && hasRisks && hasImpl) ? "green" : hasJustification ? "amber" : "red",
      score: completedCount >= 5 ? 80 : completedCount >= 3 ? 50 : 25,
      headline: completedCount >= 5 ? "CR is approaching CAB readiness" : "Several governance requirements are outstanding",
      detail: `Currently ${completedCount} of 6 core governance sections are complete. ${blockers.length > 0 ? `${blockers.length} blocker${blockers.length > 1 ? "s" : ""} must be resolved before this is suitable for CAB submission.` : "Ready for submission to the change authority."}`,
      actions: blockers.length > 0
        ? ["Resolve all blockers listed below before submitting for approval", "Schedule a pre-CAB review with the PMO once blockers are cleared"]
        : ["Submit change request for PMO review", "Confirm CAB date and ensure all evidence is attached"],
    },
    blockers,
    strengths: strengths.length > 0 ? strengths : ["Change request has been initiated in the system"],
    next_actions: nextActions,
    model: "rule-based-fallback-v1",
  };
}

export async function buildPmImpactAssessment(
  args: Parameters<typeof buildPmImpactAssessmentLLM>[0]
): Promise<PmImpactAssessment> {
  try {
    return await buildPmImpactAssessmentLLM(args);
  } catch (err) {
    console.error("[change-ai] gpt-4o PM assessment failed, using fallback:", err);
    return buildPmImpactAssessmentFallback(args);
  }
}