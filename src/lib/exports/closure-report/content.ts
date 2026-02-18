import "server-only";

export type ClosureProjectMeta = {
  projectId: string | null;
  projectName: string;
  projectCode: string; // e.g. P-00001
  clientName: string;
  organisationName: string;
  logoUrl?: string | null;

  // canonical timestamps (used by PDF + DOCX)
  generatedIso: string;

  // Charter-style strings (used by DOCX buffer/grid/footer)
  generated?: string; // DD/MM/YYYY HH:mm
  generatedDate?: string; // DD/MM/YYYY
  generatedDateTime?: string; // DD/MM/YYYY, HH:mm (Charter-style comma)
};

export type ClosureNormalized = {
  meta: ClosureProjectMeta;

  executiveSummary: string;

  rag: string;
  overall: string;

  stakeholders: any[];
  achievements: any[];
  criteria: any[];
  delivered: any[];
  outstanding: any[];

  budgetRows: any[];
  roi: any;

  wentWell: any[];
  didntGoWell: any[];
  surprises: any[];

  risksIssues: any[];
  teamMoves: any[];
  knowledgeTransfer: any;
  supportModel: any;

  recommendations: any[];
  signoff: any;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeJson(x: any) {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function safeArr(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function pickFirstNonEmptyString(...vals: any[]): string {
  for (const v of vals) {
    const s = safeStr(v).trim();
    if (s) return s;
  }
  return "";
}

function pickFirstNonEmptyArray(...vals: any[]): any[] {
  for (const v of vals) {
    const arr = safeArr(v);
    if (arr.length) return arr;
  }
  return [];
}

/* ---------------- id / code guards ---------------- */

function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

function looksLikeShortHexId(s: string) {
  const t = safeStr(s).trim().toLowerCase();
  return /^[0-9a-f]{6,12}$/.test(t);
}

function normalizeProjectCodeHumanStyle(x: any): string {
  const s = safeStr(x).trim();
  if (!s) return "";

  // already in the desired form
  if (/^P-\d{1,}$/i.test(s)) {
    const n = s.replace(/^P-/i, "").trim();
    const num = Number(n);
    if (Number.isFinite(num)) return `P-${String(Math.trunc(num)).padStart(5, "0")}`;
    return s.toUpperCase();
  }

  // numeric code -> Charter style
  if (/^\d+$/.test(s)) return `P-${String(Number(s)).padStart(5, "0")}`;

  // never allow ids / hashes to appear
  if (looksLikeUuid(s) || looksLikeShortHexId(s)) return "";

  // if it’s a real business code (e.g. "SZC-001"), allow it
  return s;
}

function computeProjectCode(content: any, project: any): string {
  // preference order: content explicit > project_code_human > project_code
  const c1 = normalizeProjectCodeHumanStyle(content?.project?.project_code);
  const c2 = normalizeProjectCodeHumanStyle(content?.projectCode);
  const c3 = normalizeProjectCodeHumanStyle(project?.project_code_human);
  const c4 = normalizeProjectCodeHumanStyle(project?.project_code);

  const pick = c1 || c2 || c3 || c4;

  return pick || "—";
}

/* ---------------- UK date helpers (Charter-compatible) ---------------- */

function formatUkDateFromIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function formatUkDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return safeStr(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${mi}`;
}

/**
 * Normalise closure report editor JSON into a stable model for exports.
 * Supports variations across:
 * - content_json / document_json
 * - v1/v2 editor keys
 */
export function normalizeClosureReport(args: {
  artifact: any;
  project: any | null;
  orgName: string;
  logoUrl?: string | null;
  contentOverride?: any | null;
}): ClosureNormalized {
  const { artifact, project, orgName, logoUrl, contentOverride } = args;

  // ? Prefer provided override, then artifact JSON columns
  const content =
    (contentOverride && typeof contentOverride === "object" ? contentOverride : null) ||
    safeJson(artifact?.content_json) ||
    safeJson(artifact?.document_json) ||
    {};

  const projectName =
    pickFirstNonEmptyString(content?.project?.project_name, content?.projectName, project?.title) ||
    "Project Closure Report";

  const projectCode = computeProjectCode(content, project);

  const clientName =
    pickFirstNonEmptyString(
      content?.project?.client_name,
      content?.client_name,
      content?.clientName,
      project?.client_name
    ) || "—";

  const generatedIso = new Date().toISOString();
  const generated = formatUkDateTime(generatedIso);
  const generatedDate = formatUkDateFromIso(generatedIso);
  const generatedDateTime = generated.replace(" ", ", "); // Charter uses comma in one place

  const executiveSummary =
    pickFirstNonEmptyString(content?.executive_summary, content?.executiveSummary, content?.health?.summary) || "";

  // Health
  const ragRaw = pickFirstNonEmptyString(content?.health?.rag, content?.rag) || "green";
  const rag = ragRaw.toLowerCase();
  const overall = pickFirstNonEmptyString(content?.health?.overall_health, content?.overall) || "good";

  // Stakeholders (support common shapes)
  const stakeholders = pickFirstNonEmptyArray(
    content?.stakeholders?.items,
    content?.stakeholders?.key,
    content?.stakeholders
  );

  // Achievements (support common shapes)
  const achievements = pickFirstNonEmptyArray(
    content?.achievements?.key_achievements,
    content?.achievements?.items,
    content?.achievements
  );

  // Success criteria
  const criteria = pickFirstNonEmptyArray(content?.success?.criteria, content?.successCriteria, content?.criteria);

  // Deliverables
  const delivered = pickFirstNonEmptyArray(content?.deliverables?.delivered, content?.delivered);
  const outstanding = pickFirstNonEmptyArray(content?.deliverables?.outstanding, content?.outstanding);

  // Finance
  const budgetRows = pickFirstNonEmptyArray(
    content?.financial_closeout?.budget_rows,
    content?.financial_closeout?.budgetRows,
    content?.budgetRows
  );

  const roi =
    (content?.financial_closeout?.roi && typeof content.financial_closeout.roi === "object"
      ? content.financial_closeout.roi
      : null) ||
    (content?.roi && typeof content.roi === "object" ? content.roi : null) ||
    {};

  // Lessons learned
  const wentWell = pickFirstNonEmptyArray(content?.lessons?.went_well, content?.lessons?.wentWell, content?.wentWell);
  const didntGoWell = pickFirstNonEmptyArray(
    content?.lessons?.didnt_go_well,
    content?.lessons?.didntGoWell,
    content?.didntGoWell
  );
  const surprises = pickFirstNonEmptyArray(
    content?.lessons?.surprises_risks,
    content?.lessons?.surprises,
    content?.surprises
  );

  // Handover / transition
  const risksIssues = pickFirstNonEmptyArray(content?.handover?.risks_issues, content?.handover?.risksIssues, content?.risksIssues);
  const teamMoves = pickFirstNonEmptyArray(content?.handover?.team_moves, content?.handover?.teamMoves, content?.teamMoves);

  const knowledgeTransfer =
    (content?.handover?.knowledge_transfer && typeof content.handover.knowledge_transfer === "object"
      ? content.handover.knowledge_transfer
      : null) ||
    (content?.handover?.knowledgeTransfer && typeof content.handover.knowledgeTransfer === "object"
      ? content.handover.knowledgeTransfer
      : null) ||
    (content?.knowledgeTransfer && typeof content.knowledgeTransfer === "object" ? content.knowledgeTransfer : null) ||
    {};

  const supportModel =
    (content?.handover?.support_model && typeof content.handover.support_model === "object"
      ? content.handover.support_model
      : null) ||
    (content?.handover?.supportModel && typeof content.handover.supportModel === "object"
      ? content.handover.supportModel
      : null) ||
    (content?.supportModel && typeof content.supportModel === "object" ? content.supportModel : null) ||
    {};

  // Recommendations
  const recommendations = pickFirstNonEmptyArray(content?.recommendations?.items, content?.recommendations, content?.actions);

  // Sign-off
  const signoff =
    (content?.signoff && typeof content.signoff === "object" ? content.signoff : null) ||
    (content?.signOff && typeof content.signOff === "object" ? content.signOff : null) ||
    {};

  return {
    meta: {
      projectId: safeStr(project?.id).trim() || safeStr(artifact?.project_id).trim() || null,
      projectName,
      projectCode,
      clientName,
      organisationName: pickFirstNonEmptyString(orgName, project?.organisation_name, project?.org_name) || "—",
      logoUrl: safeStr(logoUrl).trim() ? safeStr(logoUrl).trim() : null,

      generatedIso,
      generated,
      generatedDate,
      generatedDateTime,
    },

    executiveSummary,

    rag,
    overall,

    stakeholders,
    achievements,
    criteria,
    delivered,
    outstanding,

    budgetRows,
    roi,

    wentWell,
    didntGoWell,
    surprises,

    risksIssues,
    teamMoves,
    knowledgeTransfer,
    supportModel,

    recommendations,
    signoff,
  };
}
