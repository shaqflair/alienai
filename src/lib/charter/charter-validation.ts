// src/lib/charter/charter-validation.ts
// ✅ Client-safe (no "server-only").
// Shared single source of truth for:
// - UI completeness pills + readiness banner
// - Server submit gate (assertCharterReadyForSubmit)

import type { CharterV2, CharterSection, CharterMeta, RowObj } from "@/lib/charter/charter-v2";

export type CharterValidation = {
  ready: boolean;
  score0to100: number;
  missing: string[]; // human labels e.g. "1. Business Case"
  missingKeys: string[]; // canonical keys e.g. "business_case"
  completenessByKey: Record<string, boolean>; // key -> complete?
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
 * Robust table detection:
 * - rows may have missing `type`
 * - treat row[0] as header by default
 * - any non-header row with any non-empty cell counts as data
 */
function tableHasAnyDataRows(table?: { columns: number; rows: RowObj[] } | null) {
  if (!table || !Array.isArray((table as any).rows)) return false;
  const rows: any[] = (table as any).rows;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const t = String(r?.type ?? "").toLowerCase();
    const isHeader = i === 0 || t === "header";
    if (isHeader) continue;
    if (rowCellsAnyNonEmpty(r?.cells)) return true;
  }
  return false;
}

function sectionHasAnyMeaningfulContent(s: CharterSection | undefined | null) {
  if (!s) return false;

  // bullets
  if (isNonEmptyText((s as any).bullets)) return true;

  // v2 table model
  if (tableHasAnyDataRows((s as any).table)) return true;

  // legacy columns/rows model (in case any old payloads exist)
  const rows = (s as any).rows;
  if (
    Array.isArray(rows) &&
    rows.some((r) => Array.isArray(r) && r.some((c) => safeStr(c).trim().length > 0))
  ) {
    return true;
  }

  // fallback text-like fields
  const maybe = (s as any).text ?? (s as any).body ?? (s as any).value ?? (s as any).content;
  if (isNonEmptyText(maybe)) return true;

  return false;
}

/**
 * These must match your required charter layout (the canonical keys).
 * We keep weights to produce a stable score for the UI banner.
 */
const REQUIRED_SECTIONS: Array<{ key: string; label: string; weight: number }> = [
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

/**
 * ✅ Single source of truth used by BOTH client and server.
 * - ready rule (same as your current export gate idea):
 *   must have project title + at least 3 filled sections
 */
export function getCharterValidation(charter: CharterV2 | any): CharterValidation {
  const meta: CharterMeta = (charter?.meta && typeof charter.meta === "object" ? charter.meta : {}) as any;
  const sections: CharterSection[] = Array.isArray(charter?.sections) ? charter.sections : [];

  // index sections by key
  const byKey = new Map<string, CharterSection>();
  for (const s of sections) {
    const k = normKey((s as any)?.key);
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, s);
  }

  const completenessByKey: Record<string, boolean> = {};
  const missing: string[] = [];
  const missingKeys: string[] = [];

  const totalWeight =
    REQUIRED_META.reduce((a, x) => a + x.weight, 0) + REQUIRED_SECTIONS.reduce((a, x) => a + x.weight, 0);
  let earned = 0;

  // meta checks
  for (const req of REQUIRED_META) {
    const ok = isNonEmptyText((meta as any)[req.key]);
    if (!ok) {
      missing.push(req.label);
      missingKeys.push(String(req.key));
    } else {
      earned += req.weight;
    }
  }

  // section checks
  for (const req of REQUIRED_SECTIONS) {
    const s = byKey.get(req.key);
    const ok = sectionHasAnyMeaningfulContent(s);
    completenessByKey[req.key] = ok;

    if (!ok) {
      missing.push(req.label);
      missingKeys.push(req.key);
    } else {
      earned += req.weight;
    }
  }

  const score0to100 = totalWeight > 0 ? Math.round((earned / totalWeight) * 100) : 0;

  // readiness gate (same rule everywhere)
  const filledSections = REQUIRED_SECTIONS.filter((r) => completenessByKey[r.key]).length;
  const hasTitle = isNonEmptyText((meta as any).project_title);
  const ready = hasTitle && filledSections >= 3;

  return { ready, score0to100, missing, missingKeys, completenessByKey };
}

/**
 * ✅ Server gate: call this before allowing submit.
 * Throws a clean error message the UI can show.
 */
export function assertCharterReadyForSubmit(charter: CharterV2 | any) {
  const v = getCharterValidation(charter);

  if (v.ready) return;

  // Better message: show missing sections (not everything) + rule reminder
  const missingReadable = v.missing.length ? v.missing.join(", ") : "Required content";
  throw new Error(
    `Charter incomplete. Missing: ${missingReadable}. Rule: Project Title + at least 3 sections must contain content.`
  );
}
