// src/lib/date/format.ts
type DateInput = string | number | Date | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Locale + timezone aware DATE
 * - UK → dd/mm/yyyy
 * - US → mm/dd/yyyy
 */
export function formatDateAuto(
  value: DateInput,
  opts?: { locale?: string; timeZone?: string }
): string {
  const d = toDate(value);
  if (!d) return "—";

  const locale =
    opts?.locale ??
    (typeof navigator !== "undefined" ? navigator.language : "en-GB");

  const timeZone =
    opts?.timeZone ??
    (typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC");

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone,
  }).format(d);
}

/**
 * Locale + timezone aware DATE + TIME (consistent style)
 * Default format: "29 Dec 2025, 20:56"
 * Optionally include timezone label: "29 Dec 2025, 20:56 GMT"
 */
export function formatDateTimeAuto(
  value: DateInput,
  opts?: { locale?: string; timeZone?: string; showTimeZone?: boolean }
): string {
  const d = toDate(value);
  if (!d) return "—";

  // ✅ choose consistent display style across the app
  // Keep locale consistent, but timezone is the viewer’s current zone by default.
  const locale = opts?.locale ?? "en-GB";

  const timeZone =
    opts?.timeZone ??
    (typeof Intl !== "undefined"
      ? Intl.DateTimeFormat().resolvedOptions().timeZone
      : "UTC");

  const showTimeZone = opts?.showTimeZone ?? false;

  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "short", // ✅ Dec instead of 12
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false, // ✅ consistent 24h across app
    timeZone,
    ...(showTimeZone ? { timeZoneName: "short" } : {}),
  }).format(d);
}
