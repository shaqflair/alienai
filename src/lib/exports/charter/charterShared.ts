// src/lib/exports/charter/charterShared.ts
import "server-only";

/* ---------------- common helpers ---------------- */

export function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

export function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(
    date.getMinutes()
  )}`;
}

export function formatUkDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function escapeHtml(str: string) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function stripNumberPrefix(title: string) {
  return String(title ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

export function stripLeadingBullets(line: string) {
  return String(line ?? "")
    .replace(/^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/g, "")
    .trim();
}

/* ---------------- UK date formatting inside cells ---------------- */

function looksIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}
function looksIsoDateTime(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v || "").trim());
}
function formatToUkDate(value: string) {
  const s = String(value || "").trim();
  if (!s) return s;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return s;
  }
}

export function formatCellValue(x: any) {
  const raw = safeStr(x).trim();
  if (!raw) return "—";
  if (looksIsoDateOnly(raw) || looksIsoDateTime(raw)) return formatToUkDate(raw);
  return raw;
}

/* ---------------- multiline expansion for tables ---------------- */

function splitCellLines(v: any): string[] {
  const raw = String(v ?? "");
  const lines = raw
    .split("\n")
    .map((x) => stripLeadingBullets(x).trim())
    .filter(Boolean);
  return lines.length ? lines : [""];
}

export function expandRowsByNewlines(rows: string[][]) {
  const out: string[][] = [];
  for (const rowCells of rows) {
    const perCell = rowCells.map(splitCellLines);
    const maxLen = Math.max(1, ...perCell.map((a) => a.length));
    for (let i = 0; i < maxLen; i++) out.push(perCell.map((a) => a[i] ?? ""));
  }
  return out;
}

/* ---------------- table normalization (v2 + legacy) ---------------- */

export function normalizeTable(sec: any): { header: string[]; rows: string[][] } | null {
  const t = sec?.table ?? null;

  // v2 schema: { table: { rows:[{type,cells}...] } }
  if (t && Array.isArray(t.rows) && t.rows.length) {
    const headerRow = t.rows.find((r: any) => r?.type === "header");
    const dataRows = t.rows.filter((r: any) => r?.type === "data");

    const header = Array.isArray(headerRow?.cells) ? headerRow.cells.map((c: any) => safeStr(c)) : [];
    const rows = dataRows.map((r: any) => (Array.isArray(r?.cells) ? r.cells.map((c: any) => safeStr(c)) : []));

    // If header empty but legacy columns exist
    if ((!header || header.length === 0) && Array.isArray(sec?.columns)) {
      return { header: sec.columns.map((c: any) => safeStr(c)), rows };
    }

    return { header, rows };
  }

  // legacy: { columns: string[], rows: string[][] }
  if (Array.isArray(sec?.rows)) {
    const header = Array.isArray(sec?.columns) ? sec.columns.map((c: any) => safeStr(c)) : [];
    const rows = sec.rows.map((r: any) => (Array.isArray(r) ? r.map((c: any) => safeStr(c)) : []));
    return { header, rows };
  }

  return null;
}

/* ---------------- canonical charter section contract ---------------- */

export type CharterSectionKind = "bullets" | "table";

export const CHARTER_SECTION_SPECS: Array<{
  key: string;
  title: string; // numbered title
  kind: CharterSectionKind;
  headers?: string[];
}> = [
  { key: "business_case", title: "1. Business Case", kind: "bullets" },
  { key: "objectives", title: "2. Objectives", kind: "bullets" },
  { key: "scope_in_out", title: "3. Scope (In / Out of Scope)", kind: "table", headers: ["In Scope", "Out of Scope"] },
  { key: "key_deliverables", title: "4. Key Deliverables", kind: "bullets" },
  {
    key: "milestones_timeline",
    title: "5. Milestones & Timeline",
    kind: "table",
    headers: ["Milestone", "Target Date", "Actual Date", "Notes"],
  },
  { key: "financials", title: "6. Financials", kind: "table", headers: ["Item", "Amount", "Currency", "Notes"] },
  { key: "risks", title: "7. Risks", kind: "bullets" },
  { key: "issues", title: "8. Issues", kind: "bullets" },
  { key: "assumptions", title: "9. Assumptions", kind: "bullets" },
  { key: "dependencies", title: "10. Dependencies", kind: "bullets" },
  {
    key: "project_team",
    title: "11. Project Team",
    kind: "table",
    headers: ["Role", "Name", "Organisation", "Responsibilities / Notes"],
  },
  {
    key: "stakeholders",
    title: "12. Stakeholders",
    kind: "table",
    headers: ["Stakeholder", "Role/Interest", "Influence", "Engagement / Notes"],
  },
  {
    key: "approval_committee",
    title: "13. Approval / Review Committee",
    kind: "table",
    headers: ["Role", "Name", "Date", "Decision/Notes"],
  },
];

export const CHARTER_SECTIONS_BY_KEY = new Map(CHARTER_SECTION_SPECS.map((s) => [String(s.key).toLowerCase(), s]));

/**
 * ✅ The ONE canonicalise function (doc in, ordered sections out)
 */
export function canonicaliseCharterSections(doc: any): any[] {
  const input = Array.isArray(doc?.sections) ? doc.sections : [];
  const byKey = new Map<string, any>();

  for (const s of input) {
    const k = safeStr(s?.key).trim().toLowerCase();
    if (!k) continue;
    if (!byKey.has(k)) byKey.set(k, s);
  }

  const out = CHARTER_SECTION_SPECS.map((spec) => {
    const existing = byKey.get(spec.key.toLowerCase());
    const base = existing && typeof existing === "object" ? existing : {};
    return {
      ...base,
      key: spec.key,
      title: safeStr(base?.title).trim() ? base.title : spec.title,
    };
  });

  // Append any unknown sections at the end (avoid data loss)
  for (const s of input) {
    const k = safeStr(s?.key).trim().toLowerCase();
    if (!k) continue;
    if (!CHARTER_SECTIONS_BY_KEY.has(k)) out.push(s);
  }

  return out;
}

export function charterSectionNumberFromTitleOrIndex(title: string, fallbackIndex1: number) {
  const m = String(title || "").trim().match(/^(\d+)\s*\./);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallbackIndex1;
}

/* ---------------- types ---------------- */

export type CharterExportMeta = {
  projectName: string;
  projectCode: string;
  organisationName: string;
  clientName: string;
  pmName: string;
  status: string;
  generated: string;
  generatedDate: string;
  generatedDateTime: string;
};
