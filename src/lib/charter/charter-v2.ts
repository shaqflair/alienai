// src/lib/charter/charter-v2.ts
// ? Client-safe: NO "server-only" here.

export type RowObj = { type: "header" | "data"; cells: string[] };

export type CharterMeta = {
  project_title?: string;
  project_manager?: string;
  project_start_date?: string;
  project_end_date?: string;
  project_sponsor?: string;
  customer_account?: string;
};

export type CharterSection = {
  key: string;
  title: string;
  table?: { columns: number; rows: RowObj[] };
  columns?: string[];
  rows?: string[][];
  bullets?: string;
};

export type CharterV2 = {
  meta: CharterMeta;
  sections: CharterSection[];
  legacy_raw?: any;
};

function normKey(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function isPlainObject(x: any) {
  return !!x && typeof x === "object" && !Array.isArray(x);
}

/**
 * ? Stronger guard:
 * - meta must be an object
 * - sections must be an array
 * - each section must have a string key (non-empty)
 */
export function isCharterV2(x: any): x is CharterV2 {
  if (!isPlainObject(x)) return false;
  if (!isPlainObject((x as any).meta)) return false;
  if (!Array.isArray((x as any).sections)) return false;

  // ensure at least one usable section; allow empty array but still valid if explicitly empty
  for (const s of (x as any).sections) {
    if (!isPlainObject(s)) return false;
    const k = String((s as any).key ?? "").trim();
    if (!k) return false;
  }
  return true;
}

/**
 * If your stored section title already starts with "1. " then
 * your UI should not add another index prefix.
 *
 * This helper returns:
 * - if title already has a leading "N. " prefix => return title as-is
 * - else => prefix with `${index}. `
 */
export function displaySectionTitle(title: string, index1Based: number) {
  const t = String(title ?? "").trim();
  if (/^\d+\.\s+/.test(t)) return t;
  return `${index1Based}. ${t || "Section"}`;
}

export function buildEmptyCharterV2(projectTitle?: string): CharterV2 {
  // IMPORTANT: keys must match editor + PDF renderer + export-ready
  const required: Array<{ key: string; title: string }> = [
    { key: "business_case", title: "1. Business Case" },
    { key: "objectives", title: "2. Objectives" },
    { key: "scope_in_out", title: "3. Scope (In / Out of Scope)" },
    { key: "key_deliverables", title: "4. Key Deliverables" },
    { key: "milestones_timeline", title: "5. Milestones & Timeline" },
    { key: "financials", title: "6. Financials" },
    { key: "risks", title: "7. Risks" },
    { key: "issues", title: "8. Issues" },
    { key: "assumptions", title: "9. Assumptions" },
    { key: "dependencies", title: "10. Dependencies" },
    { key: "project_team", title: "11. Project Team" },
    { key: "stakeholders", title: "12. Stakeholders" },
    { key: "approval_committee", title: "13. Approval / Review Committee" },
  ];

  return {
    meta: { project_title: String(projectTitle ?? "") },
    sections: required.map((r) => ({ key: r.key, title: r.title })),
  };
}

/**
 * Normalises incoming JSON:
 * - ensures meta exists and project_title is present
 * - normalises keys
 * - ensures section titles exist
 */
export function validateCharterV2(input: any, projectTitleFallback?: string): CharterV2 {
  if (isCharterV2(input)) {
    const sections = (input.sections ?? []).map((s) => {
      const key = normKey((s as any).key);
      const titleRaw = String((s as any).title ?? "").trim();

      return {
        ...s,
        key,
        title: titleRaw || key || "Section",
      } as CharterSection;
    });

    return {
      meta: {
        ...(isPlainObject(input.meta) ? input.meta : {}),
        project_title: String(
          (input.meta as any)?.project_title ?? projectTitleFallback ?? ""
        ).trim(),
      },
      sections,
      legacy_raw: (input as any).legacy_raw,
    };
  }

  return buildEmptyCharterV2(projectTitleFallback);
}
