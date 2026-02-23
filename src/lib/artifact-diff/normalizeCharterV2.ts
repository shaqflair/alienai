type RowObj = { type: "header" | "data"; cells: string[] };

export type CharterV2 = {
  version: 2;
  type: string; // "project_charter"
  meta?: Record<string, unknown>;
  sections?: Array<{
    key: string;
    title?: string;
    table?: { columns: number; rows: RowObj[] };
    columns?: string[];
    rows?: string[][];
    bullets?: string;
    text?: string;
  }>;
};

function isObj(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function asString(x: unknown): string {
  return typeof x === "string" ? x : String(x ?? "");
}

function padCells(cells: unknown, n: number): string[] {
  const arr = Array.isArray(cells) ? cells : [];
  const out = arr.map(asString);
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

function normalizeRows(rows: unknown, columns: number): RowObj[] {
  const src = Array.isArray(rows) ? rows : [];
  const out: RowObj[] = [];

  for (const r of src) {
    const robj = (isObj(r) ? r : {}) as any;
    const type = robj.type === "header" ? "header" : "data";
    out.push({ type, cells: padCells(robj.cells, columns) });
  }
  return out;
}

function normalizeSection(section: any): NonNullable<CharterV2["sections"]>[number] {
  const key = asString(section?.key).trim();
  const title = typeof section?.title === "string" ? section.title : undefined;

  // Normalize v2 table format
  const t = section?.table;
  const table =
    t && isObj(t) && Array.isArray((t as any).rows)
      ? {
          columns: Math.max(1, Number((t as any).columns ?? 1)),
          rows: normalizeRows((t as any).rows, Math.max(1, Number((t as any).columns ?? 1))),
        }
      : undefined;

  // Normalize legacy columns/rows shape (optional)
  const columns = Array.isArray(section?.columns) ? section.columns.map(asString) : undefined;
  const rows = Array.isArray(section?.rows)
    ? section.rows.map((r: any) => (Array.isArray(r) ? r.map(asString) : []))
    : undefined;

  const bullets = typeof section?.bullets === "string" ? section.bullets : undefined;
  const text = typeof section?.text === "string" ? section.text : undefined;

  return { key, title, table, columns, rows, bullets, text };
}

/**
 * Canonicalizes Charter v2:
 * - sections sorted by key
 * - table rows padded to column count
 * - basic string coercion
 */
export function normalizeCharterV2(input: unknown): CharterV2 | null {
  if (!isObj(input)) return null;

  const version = Number((input as any).version);
  if (version !== 2) return null;

  const type = asString((input as any).type || "");
  const meta = isObj((input as any).meta) ? ((input as any).meta as Record<string, unknown>) : undefined;

  const rawSections = Array.isArray((input as any).sections) ? (input as any).sections : [];
  const sections = rawSections
    .map(normalizeSection)
    .filter((s: any) => s.key.length > 0)
    .sort((a: any, b: any) => a.key.localeCompare(b.key));

  return { version: 2, type, meta, sections };
}
