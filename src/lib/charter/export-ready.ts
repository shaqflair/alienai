// ? Client-safe: NO "server-only" here.
// This can be imported from Client Components (Editor banner) AND Server (routes).

import type { CharterV2, CharterSection, CharterMeta, RowObj } from "@/lib/charter/charter-v2";

export type ExportCheck = {
  ready: boolean;
  score0to100: number;
  missing: string[];
};

function normKey(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function isNonEmptyText(x: any) {
  return typeof x === "string" && x.trim().length > 0;
}

function rowCellsAnyNonEmpty(cells: any) {
  if (!Array.isArray(cells)) return false;
  return cells.some((c) => safeStr(c).trim().length > 0);
}

/**
 * Robust table check:
 * - Handles rows where `type` is missing/undefined
 * - Treats index 0 as header by default
 * - Counts a "data" row if any cell is non-empty
 */
function tableHasAnyDataRows(table?: { columns: number; rows: RowObj[] } | null) {
  if (!table || !Array.isArray((table as any).rows)) return false;

  const rows: any[] = (table as any).rows;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = String(r?.type ?? "").toLowerCase();

    // Treat first row as header even if type is missing
    const isHeaderRow = i === 0 || t === "header";
    if (isHeaderRow) continue;

    // Any non-header row counts as data (even if type is missing or odd)
    if (rowCellsAnyNonEmpty(r?.cells)) return true;
  }

  return false;
}

function sectionHasAnyMeaningfulContent(s: CharterSection | undefined | null) {
  if (!s) return false;

  // bullets
  if (isNonEmptyText((s as any).bullets)) return true;

  // table model
  if (tableHasAnyDataRows((s as any).table)) return true;

  // columns/rows model
  const rows = (s as any).rows;
  if (Array.isArray(rows) && rows.some((r) => Array.isArray(r) && r.some((c) => safeStr(c).trim().length > 0))) {
    return true;
  }

  // text fallback fields (legacy-ish)
  const maybe = (s as any).text ?? (s as any).body ?? (s as any).value ?? (s as any).content;
  if (isNonEmptyText(maybe)) return true;

  return false;
}

const REQUIRED_KEYS: Array<{ key: string; label: string; weight: number }> = [
  { key: "business_case", label: "1. Business Case", weight: 8 },
  { key: "objectives", label: "2. Objectives", weight: 8 },
  { key: "scope_in_out", label: "3. Scope (In / Out of Scope)", weight: 8 },
  { key: "key_deliverables", label: "4. Key Deliverables", weight: 8 },
  { key: "milestones_timeline", label: "5. Milestones & Timeline", weight: 10 },
  { key: "financials", label: "6. Financials", weight: 10 },
  { key: "risks", label: "7. Risks", weight: 8 },
  { key: "issues", label: "8. Issues", weight: 6 },
  { key: "assumptions", label: "9. Assumptions", weight: 6 },
  { key: "dependencies", label: "10. Dependencies", weight: 6 },
  { key: "project_team", label: "11. Project Team", weight: 8 },
  { key: "stakeholders", label: "12. Stakeholders", weight: 6 },
  { key: "approval_committee", label: "13. Approval / Review Committee", weight: 8 },
];

const REQUIRED_META: Array<{ key: keyof CharterMeta; label: string; weight: number }> = [
  { key: "project_title", label: "Project Title", weight: 10 },
];

export function isCharterExportReady(charter: CharterV2 | any): ExportCheck {
  const missing: string[] = [];

  const meta: CharterMeta = (charter?.meta && typeof charter.meta === "object" ? charter.meta : {}) as any;
  const sections: CharterSection[] = Array.isArray(charter?.sections) ? charter.sections : [];

  // index sections
  const byKey = new Map<string, CharterSection>();
  for (const s of sections) {
    const k = normKey((s as any)?.key);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, s);
  }

  // scoring
  const totalWeight =
    REQUIRED_META.reduce((a, x) => a + x.weight, 0) + REQUIRED_KEYS.reduce((a, x) => a + x.weight, 0);
  let earned = 0;

  // meta checks
  for (const req of REQUIRED_META) {
    const ok = isNonEmptyText((meta as any)[req.key]);
    if (!ok) missing.push(req.label);
    else earned += req.weight;
  }

  // section checks
  for (const req of REQUIRED_KEYS) {
    const s = byKey.get(req.key);
    const ok = sectionHasAnyMeaningfulContent(s);
    if (!ok) missing.push(req.label);
    else earned += req.weight;
  }

  const score0to100 = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  // gate rule: must have title + at least 3 sections with content (prevents blank PDFs)
  const filledSections = REQUIRED_KEYS.filter((r) => sectionHasAnyMeaningfulContent(byKey.get(r.key))).length;
  const hasTitle = isNonEmptyText((meta as any).project_title);

  const ready = hasTitle && filledSections >= 3;

  return { ready, score0to100, missing };
}
