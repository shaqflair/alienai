import "server-only";

export function safeStr(x: any) {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x);
}

export function sanitizeFilename(name: string, fallback = "export") {
  return (
    String(name || fallback)
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || fallback
  );
}

export function isUuid(x: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

export function escHtml(s: any) {
  const t = safeStr(s);
  return t
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
