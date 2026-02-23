// Auto-generated stub for @/lib/date/utils
export function formatDate(date: Date | string | null | undefined, fmt?: string): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}

export function parseDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

export function diffDays(a: Date | string, b: Date | string): number {
  const da = typeof a === "string" ? new Date(a) : a;
  const db = typeof b === "string" ? new Date(b) : b;
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

export function endOfWeek(date: Date): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + (6 - d.getDay()));
  return d;
}

export function dayIndex(date: Date, weekStart: Date): number { return Math.round((date.getTime() - weekStart.getTime()) / 86400000); }

export function todayISO(): string { return new Date().toISOString().slice(0, 10); }

export function fmtWeekHeader(date: Date): string { return date.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }); }

export function parseISODate(s: string | null | undefined): Date | null { if (!s) return null; const d = new Date(s); return isNaN(d.getTime()) ? null : d; }

export function weekIndexFromISO(isoDate: string, weekStarts: Date[]): number { const d = new Date(isoDate); return weekStarts.findIndex((w, i) => { const next = weekStarts[i+1]; return d >= w && (!next || d < next); }); }

export function startOfWeekMonday(date: Date): Date { const d = new Date(date); const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; d.setDate(d.getDate() + diff); d.setHours(0,0,0,0); return d; }

export function iso(date: Date | string | null | undefined): string {
  if (!date) return "";
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toISOString().slice(0, 10);
}