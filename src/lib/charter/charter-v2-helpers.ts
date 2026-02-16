import { getCharterValidation } from "@/lib/charter/charter-validation";

export type RowObj = { type: "header" | "data"; cells: string[] };

const REQUIRED_SECTIONS: Array<{ key: string; title: string; kind: "bullets" | "table"; headers?: string[] }> = [
  { key: "business_case", title: "1. Business Case", kind: "bullets" },
  { key: "objectives", title: "2. Objectives", kind: "bullets" },
  { key: "scope_in_out", title: "3. Scope (In / Out of Scope)", kind: "table", headers: ["In Scope", "Out of Scope"] },
  { key: "key_deliverables", title: "4. Key Deliverables", kind: "bullets" },
  { key: "milestones_timeline", title: "5. Milestones & Timeline", kind: "table", headers: ["Milestone", "Target Date", "Actual Date", "Notes"] },
  { key: "financials", title: "6. Financials", kind: "table", headers: ["Item", "Amount", "Currency", "Notes"] },
  { key: "risks", title: "7. Risks", kind: "bullets" },
  { key: "issues", title: "8. Issues", kind: "bullets" },
  { key: "assumptions", title: "9. Assumptions", kind: "bullets" },
  { key: "dependencies", title: "10. Dependencies", kind: "bullets" },
  { key: "project_team", title: "11. Project Team", kind: "table", headers: ["Role", "Name", "Organisation", "Responsibilities / Notes"] },
  { key: "stakeholders", title: "12. Stakeholders", kind: "table", headers: ["Stakeholder", "Role/Interest", "Influence", "Engagement / Notes"] },
  { key: "approval_committee", title: "13. Approval / Review Committee", kind: "table", headers: ["Role", "Name", "Date", "Decision/Notes"] },
];

function s(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function buildEmptyTable(headers: string[]): { columns: number; rows: RowObj[] } {
  const cols = Math.max(1, headers.length);
  return {
    columns: cols,
    rows: [
      { type: "header", cells: headers.map((h) => s(h)) },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
      { type: "data", cells: Array.from({ length: cols }, () => "") },
    ],
  };
}

/**
 * ✅ Sync helper: used anywhere (client/server/lib)
 * projectTitleFallback can be passed as string; it will populate meta.project_title when empty.
 */
export function buildEmptyCharterV2(projectTitleFallback: string = "") {
  const baseMeta: Record<string, any> = {};
  if (String(projectTitleFallback || "").trim()) {
    baseMeta.project_title = String(projectTitleFallback).trim();
  }

  return {
    version: 2 as const,
    type: "project_charter" as const,
    meta: baseMeta,
    sections: REQUIRED_SECTIONS.map((r) => {
      if (r.kind === "table") {
        return { key: r.key, title: r.title, table: buildEmptyTable(r.headers ?? ["", ""]) };
      }
      return { key: r.key, title: r.title, bullets: "" };
    }),
  };
}

/**
 * ✅ Sync helper: validation wrapper
 */
export function validateCharterV2(charterV2: { meta: any; sections: any[] }) {
  return getCharterValidation({
    meta: charterV2?.meta ?? {},
    sections: Array.isArray(charterV2?.sections) ? charterV2.sections : [],
  });
}
