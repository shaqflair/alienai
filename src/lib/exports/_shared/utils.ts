import "server-only";

export function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

export function safeLower(x: unknown): string {
  return safeStr(x).trim().toLowerCase();
}

export function clampInt(n: any, min: number, max: number, fallback: number) {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(v)));
}

export function looksLikeUuid(s: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s || "").trim()
  );
}

export function sanitizeFilename(name: string, fallback = "export") {
  const s = safeStr(name).trim() || fallback;
  return s
    .replace(/[^a-z0-9._-]+/gi, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function isoNow() {
  return new Date().toISOString();
}

export function formatDateUk(value: any): string {
  const s = safeStr(value).trim();
  if (!s || s === "—") return "—";
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m1) return `${m1[3]}/${m1[2]}/${m1[1]}`;
  const dt = new Date(s);
  if (!Number.isNaN(dt.getTime())) {
    const dd = String(dt.getDate()).padStart(2, "0");
    const mm = String(dt.getMonth() + 1).padStart(2, "0");
    const yyyy = dt.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }
  return s;
}

export function esc(s: any) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
