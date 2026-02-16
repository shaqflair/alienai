import "server-only";

/**
 * Export Theme Configuration
 * Centralizes the visual identity for all generated documents (PDF, Excel, etc.)
 */
export type ExportTheme = {
  brandName: string;
  // hex like "#7C3AED"
  primary: string;
  text: string;
  muted: string;
  border: string;
  bg: string;
  headerBg: string;
  tableHeadBg: string;
  tableHeadText: string;
};

export const DEFAULT_THEME: ExportTheme = {
  brandName: "Aliena AI",
  primary: "#7C3AED",
  text: "#0B1220",
  muted: "#6B7280",
  border: "rgba(15, 23, 42, 0.12)",
  bg: "#FFFFFF",
  headerBg: "#0B1220",
  tableHeadBg: "#0B1220",
  tableHeadText: "#FFFFFF",
};

/**
 * Ensures a color string is a valid hex code.
 * Helpful when pulling theme overrides from a database or query params.
 */
export function normalizeHex(input: string | null | undefined, fallback = DEFAULT_THEME.primary) {
  const s = String(input || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`;
  return fallback;
}
