const DAY_MS = 86400000;

export function isYmd(s: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function safeFileName(s: string) {
  return (s || "Schedule").replace(/[^a-z0-9]/gi, "_");
}

export function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

export function parseDateUTC(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const s = String(v || "").trim();
  if (!s) return null;

  if (isYmd(s)) {
    const [yy, mm, dd] = s.split("-").map((n) => Number(n));
    return new Date(Date.UTC(yy, mm - 1, dd, 0, 0, 0, 0));
  }

  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return d;
}

export function startOfDayUTC(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
}

export function addDaysUTC(d: Date, n: number) {
  return new Date(d.getTime() + n * DAY_MS);
}

export function daysBetweenUTC(a: Date, b: Date) {
  const aa = startOfDayUTC(a).getTime();
  const bb = startOfDayUTC(b).getTime();
  return Math.round((bb - aa) / DAY_MS);
}

export function startOfWeekUTC(d: Date) {
  const day = d.getUTCDay(); // 0 is Sunday
  // Adjust to Monday start
  const diff = d.getUTCDate() - (day === 0 ? 6 : day - 1);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), diff, 0, 0, 0, 0));
}

export function fmtDateShortUTC(d: Date) {
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
}

export function fmtUkDate(d: Date) {
  return d.toLocaleDateString("en-GB", { timeZone: "UTC" });
}
