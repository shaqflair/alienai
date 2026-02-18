import "server-only";

/**
 * Formatting Utilities for Export Renderers
 * Ensures consistent data presentation across PDF and XLSX outputs.
 */

export function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function formatUkDate(d: string | Date | null | undefined) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "";
  // DD/MM/YYYY
  const dd = String(dt.getDate()).padStart(2, "0");
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const yyyy = String(dt.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

export function formatIsoDateOnly(d: string | Date | null | undefined) {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  if (Number.isNaN(dt.getTime())) return "";
  return dt.toISOString().slice(0, 10);
}

export function sanitizeFilename(name: string) {
  const s = safeStr(name).trim() || "Export";
  return s.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9\-_.]/g, "").slice(0, 80);
}

export function preventExcelFormulaInjection(v: any) {
  const s = safeStr(v);
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}
