import "server-only";

export function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function formatUkDateTime(date = new Date()) {
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)}/${date.getFullYear()}, ${pad2(
    date.getHours()
  )}:${pad2(date.getMinutes())}`;
}

export function formatUkDate(x: any) {
  const s = typeof x === "string" ? x.trim() : x == null ? "" : String(x);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatGbDateTime(x: any) {
  const s = typeof x === "string" ? x.trim() : x == null ? "" : String(x);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("en-GB");
}
