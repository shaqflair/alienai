// src/lib/exports/export-helpers.ts
import "server-only";

/**
 * Canonical export helpers for Aliena exports.
 * IMPORTANT:
 * - Named exports only (no default export) to avoid webpack import shape issues.
 * - server-only (these helpers are for API export routes, not client components).
 */

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

export function sanitizeFilename(input: string, fallback = "export"): string {
  const base = safeStr(input).trim() || fallback;
  return (
    base
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || fallback
  );
}

export function normalizeStringList(x: any): string[] {
  if (Array.isArray(x)) return x.map((v) => safeStr(v).trim()).filter(Boolean);

  const s = safeStr(x).trim();
  if (!s) return [];

  // allow comma-separated strings
  return s
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

export function normalizeChannelList(x: any): string {
  return normalizeStringList(x).join(", ");
}

export function escapeHtml(x: any): string {
  return String(x ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** UK Format: 31/12/2024 14:30 */
export function fmtDateTimeUK(d = new Date()): string {
  if (!d || isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** UK Format: 31/12/2024 */
export function fmtDateUK(d = new Date()): string {
  if (!d || isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function clampText(s: any, max = 160): string {
  const t = safeStr(s);
  return t.length > max ? `${t.slice(0, Math.max(0, max - 1))}…` : t;
}

export function csvCell(v: any): string {
  const s = safeStr(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Try to parse a filename from Content-Disposition header.
 * Supports: filename="x", filename=x, filename*=UTF-8''x
 */
export function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const m = /filename\*=UTF-8''([^;]+)|filename="([^"]+)"|filename=([^;]+)/i.exec(header);
  const raw = m?.[1] || m?.[2] || m?.[3] || "";
  if (!raw) return null;
  try {
    return decodeURIComponent(raw).trim();
  } catch {
    return String(raw).trim();
  }
}

/**
 * Small util for safe “truthy” string lists where the DB might return null/object/etc.
 */
export function uniqStrings(list: any[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of list || []) {
    const s = safeStr(v).trim();
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}
