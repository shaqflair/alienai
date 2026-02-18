export function safeStr(x: unknown): string {
  if (x === null || x === undefined) return "";
  return typeof x === "string" ? x : String(x);
}

export function safeLower(x: unknown): string {
  return safeStr(x).trim().toLowerCase();
}

export function looksLikeUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

// Backwards-compatible alias (some modules imported the wrong name)
export const looksLikeUid = looksLikeUuid;

export function sanitizeFilename(name: string): string {
  const clean = String(name || "wbs")
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
  return clean || "wbs-export";
}

export function calculateProjectCode(code: number | null | undefined): string {
  if (code == null) return "";
  return `P-${String(code).padStart(5, "0")}`;
}

/** UK Date Format: 31/12/2024 */
export function formatDateUK(dateInput: unknown): string {
  if (!dateInput) return "";
  try {
    const date =
      typeof dateInput === "string"
        ? new Date(dateInput)
        : dateInput instanceof Date
        ? dateInput
        : null;
    if (!date || isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(date);
  } catch {
    return "";
  }
}

/** UK DateTime Format: 31/12/2024 14:30 */
export function formatDateTimeUK(dateInput: unknown): string {
  if (!dateInput) return "";
  try {
    const date =
      typeof dateInput === "string"
        ? new Date(dateInput)
        : dateInput instanceof Date
        ? dateInput
        : null;
    if (!date || isNaN(date.getTime())) return "";

    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(date);
  } catch {
    return "";
  }
}

export function normalizeEffort(x: unknown): "" | "S" | "M" | "L" {
  const s = safeStr(x).trim().toUpperCase();
  return s === "S" || s === "M" || s === "L" ? s : "";
}

export function effortFromNumber(n: unknown): "" | "S" | "M" | "L" {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return "";
  if (v <= 3) return "S";
  if (v <= 10) return "M";
  return "L";
}

export function effortLabel(e: "" | "S" | "M" | "L"): string {
  const labels: Record<string, string> = {
    S: "Small",
    M: "Medium",
    L: "Large",
    "": "Not Set",
  };
  return labels[e] || "Not Set";
}

export function effortColor(e: "" | "S" | "M" | "L", THEME: any): string {
  const colors: Record<string, string> = {
    S: "FF10B981",
    M: "FFF59E0B",
    L: "FFEF4444",
  };
  return colors[e] || THEME.neutral[400];
}

export function statusLabel(s: unknown): string {
  const v = safeLower(s);
  if (v === "done") return "Complete";
  if (v === "inprogress") return "In Progress";
  if (v === "blocked") return "Blocked";
  return "Not Started";
}

export function statusColor(label: string, THEME: any): string {
  const colors: Record<string, string> = {
    Complete: THEME.success,
    "In Progress": THEME.info,
    Blocked: THEME.danger,
    "Not Started": THEME.neutral[400],
  };
  return colors[label] || THEME.neutral[400];
}

export function indentDeliverable(level: number, text: string): string {
  const lvl = Number.isFinite(level) ? Math.max(0, Math.min(10, Math.floor(level))) : 0;
  const indent = "    ".repeat(lvl);
  return lvl > 0 ? `${indent}+ ${safeStr(text)}` : safeStr(text);
}
