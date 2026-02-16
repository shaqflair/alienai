import "server-only";

/**
 * Metadata specifically for Stakeholder Register exports.
 */
export type StakeholderExportMeta = {
  projectName: string;
  projectCode: string;
  organisationName: string;
  clientName: string;
  generated: string;
  generatedDate: string;
  generatedDateTime: string;
};

/* ---------------- common helpers ---------------- */

export function safeStr(x: any): string {
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

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatUkDate(d = new Date()) {
  const dd = pad2(d.getDate());
  const mm = pad2(d.getMonth() + 1);
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function formatUkDateTime(d = new Date()) {
  const ddmmyyyy = formatUkDate(d);
  const hh = pad2(d.getHours());
  const mi = pad2(d.getMinutes());
  return `${ddmmyyyy} ${hh}:${mi}`;
}

export function escapeHtml(str: string): string {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ---------------- Filename Generators ---------------- */

export function stakeholderDocxFilename(meta: StakeholderExportMeta) {
  return `Stakeholder_Register_${meta.projectCode}_${meta.generatedDate.replace(/\//g, "-")}.docx`;
}

export function stakeholderPdfFilename(meta: StakeholderExportMeta) {
  return `Stakeholder_Register_${meta.projectCode}_${formatUkDate().replace(/\//g, "-")}.pdf`;
}
