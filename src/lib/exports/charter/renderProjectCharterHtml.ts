export type Rag = "green" | "amber" | "red";

type RowObj = { type: "header" | "data"; cells: string[] };

function escapeHtml(str: string) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeString(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

/** Accept canonical v2 {sections:[{table:{columns,rows}}]} and legacy-ish {columns,rows} */
function tableFromSection(sec: any): { columns: number; rows: RowObj[] } | null {
  if (sec?.table?.rows && Array.isArray(sec.table.rows)) {
    const cols = Math.max(1, Number(sec.table.columns || 1));
    return { columns: cols, rows: sec.table.rows as RowObj[] };
  }

  if (Array.isArray(sec?.columns) || Array.isArray(sec?.rows)) {
    const cols = Array.isArray(sec.columns) ? sec.columns : [];
    const rows = Array.isArray(sec.rows) ? sec.rows : [];
    const colCount = Math.max(1, cols.length || rows?.[0]?.length || 1);
    if (!cols.length && !rows.length) return null;

    const out: RowObj[] = [];
    out.push({
      type: "header",
      cells: Array.from({ length: colCount }, (_, i) => safeString(cols[i] ?? "")),
    });

    for (const r of rows) {
      out.push({
        type: "data",
        cells: Array.from({ length: colCount }, (_, i) => safeString((r ?? [])[i] ?? "")),
      });
    }

    if (out.length === 1) out.push({ type: "data", cells: Array.from({ length: colCount }, () => "") });
    return { columns: colCount, rows: out };
  }

  return null;
}

/* ------------------------------------------------ UK date helpers ------------------------------------------------ */

function isIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(v);
}
function isIsoDateTime(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v);
}
function toUkDate(value: string) {
  const s = String(value || "").trim();
  if (!s) return "";
  const d = new Date(isIsoDateOnly(s) ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return value;
  try {
    return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric" }).format(d);
  } catch {
    return value;
  }
}

/* ------------------------------------------------ currency helpers (NO £ prefix) ------------------------------------------------ */

function normalizeCurrencyLabel(v: string) {
  const s = String(v || "").trim();
  if (!s) return "Pounds sterling";
  const lower = s.toLowerCase();
  if (lower === "gbp" || lower.includes("pound") || lower.includes("sterling") || lower === "£") return "Pounds sterling";
  if (lower === "usd" || lower.includes("dollar")) return "USD";
  if (lower === "eur" || lower.includes("euro")) return "EUR";
  return s;
}

/* ------------------------------------------------ bullets: NO bullets, render lines from forms ------------------------------------------------ */

function normalizeBulletLine(line: string) {
  let s = String(line ?? "");
  // strip repeated bullet-ish prefixes
  const re = /^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/;
  for (let i = 0; i < 6; i++) {
    const next = s.replace(re, "");
    if (next === s) break;
    s = next;
  }
  return s.trim();
}

function renderLinesFromFormsHtml(text: string) {
  const lines = String(text || "")
    .split("\n")
    .map((x) => normalizeBulletLine(x))
    .map((x) => x.trim())
    .filter(Boolean);

  if (!lines.length) return `<div class="muted">No content recorded</div>`;

  // No bullets. Just clean lines.
  return `
    <div class="lines">
      ${lines.map((ln) => `<div class="line">${escapeHtml(ln)}</div>`).join("")}
    </div>
  `;
}

/* ------------------------------------------------ table renderer (UK date, keep amount as entered, keep currency column as-is) ------------------------------------------------ */

function renderTableHtml(
  t: { columns: number; rows: RowObj[] },
  opts?: { sectionKey?: string; currencyLabel?: string; dateLocale?: string }
) {
  const header = t.rows.find((r) => r.type === "header")?.cells ?? [];
  const data = t.rows.filter((r) => r.type === "data");
  const colCount = Math.max(1, t.columns || header.length || data?.[0]?.cells?.length || 1);

  const currencyLabel = String(opts?.currencyLabel || "Pounds sterling");
  const headerLower = header.map((h) => String(h || "").toLowerCase());

  const dateCols = new Set<number>();
  let currencyCol: number | null = null;

  headerLower.forEach((h, i) => {
    if (h.includes("date")) dateCols.add(i);
    if (h.includes("currency")) currencyCol = i;
  });

  function renderCell(raw: string, colIdx: number) {
    const v = String(raw ?? "");
    const trimmed = v.trim();

    // Currency column: normalize GBP -> "Pounds sterling" but DO NOT force GBP if USD is provided
    if (currencyCol != null && colIdx === currencyCol) {
      // if blank, default to pounds sterling; otherwise keep user's choice (USD/EUR/etc)
      return escapeHtml(trimmed ? normalizeCurrencyLabel(trimmed) : currencyLabel);
    }

    // Date columns OR ISO-ish dates: UK date
    if (dateCols.has(colIdx) || isIsoDateOnly(trimmed) || isIsoDateTime(trimmed)) {
      const uk = toUkDate(trimmed);
      return escapeHtml(uk || trimmed);
    }

    // Amount column: keep value exactly as entered (NO £ prefix)
    return escapeHtml(trimmed);
  }

  return `
    <table class="tbl">
      <thead>
        <tr>
          ${Array.from({ length: colCount }, (_, i) => {
            const h = escapeHtml(String(header[i] ?? "")) || "&nbsp;";
            return `<th>${h}</th>`;
          }).join("")}
        </tr>
      </thead>
      <tbody>
        ${
          data.length
            ? data
                .map((r) => {
                  const cells = Array.from({ length: colCount }, (_, i) => renderCell(String((r.cells ?? [])[i] ?? ""), i));
                  return `<tr>${cells.map((c) => `<td>${c || "&nbsp;"}</td>`).join("")}</tr>`;
                })
                .join("")
            : `<tr><td colspan="${colCount}" class="muted">No rows recorded</td></tr>`
        }
      </tbody>
    </table>
  `;
}

/**
 * Project Charter HTML renderer (Closure-report-like layout)
 * - Logo top-right
 * - Meta “pills”
 * - Watermark
 * - Clean table styling (accent outer border)
 *
 * Changes requested:
 * ? UK date format (tables + meta already provided)
 * ? Remove £ sign (keep amount as entered)
 * ? Remove header PM + Currency pills
 * ? Remove bullet points: render plain lines from forms (no <ul>/<li>)
 */
export function renderProjectCharterHtml({
  doc,
  meta,
}: {
  doc: any;
  meta: {
    projectName: string;
    projectCode: string;
    organisationName?: string;
    generated: string; // UK formatted timestamp
    logoUrl?: string;
    watermarkText?: string; // DRAFT / FINAL
    pmName?: string; // derived from owner name in route (not shown in header anymore)
    bulletsMode?: "forms" | "ul"; // optional (default forms)
    currencyLabel?: string; // default Pounds sterling (used when currency cell blank)
    locale?: string; // default en-GB
  };
}) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];

  const orgName = safeString(meta.organisationName || "—");
  const watermarkText = safeString(meta.watermarkText || "DRAFT");

  const bulletsMode = (meta as any)?.bulletsMode === "ul" ? "ul" : "forms";
  const currencyLabel = safeString((meta as any)?.currencyLabel) || "Pounds sterling";
  const locale = safeString((meta as any)?.locale) || "en-GB";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root{
      --bg:#F8FAFC;
      --card:#FFFFFF;
      --text:#0F172A;
      --muted:#6b7280;
      --border:#E5E7EB;
      --accent:#c7d2fe; /* matches closure-report docx outer border tone */
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
    }
    .wrap{ padding: 18mm 15mm 18mm 15mm; }

    /* Watermark */
    .wm{
      position: fixed;
      inset: 0;
      display:flex;
      align-items:center;
      justify-content:center;
      pointer-events:none;
      opacity:0.07;
      font-size:110px;
      font-weight:800;
      transform: rotate(-25deg);
      letter-spacing: 6px;
      color:#111827;
      z-index:0;
    }

    /* Header */
    .header{
      position:relative;
      z-index:1;
      display:flex;
      justify-content:space-between;
      align-items:flex-start;
      gap:14px;
      margin-bottom: 10px;
    }
    .h1{
      margin:0;
      font-size:34px;
      font-weight:800;
    }
    .meta{
      margin-top:8px;
      display:flex;
      flex-wrap:wrap;
      gap:8px 10px;
      color: var(--muted);
      font-size:12px;
    }
    .pill{
      border:1px solid #e5e7eb;
      background:#fff;
      border-radius:999px;
      padding:6px 10px;
      color:#111827;
      font-size:12px;
      display:inline-flex;
      gap:6px;
      align-items:center;
      white-space:nowrap;
    }
    .pill b{ color:#111827; }
    .logo{
      width:140px;
      height:56px;
      display:flex;
      align-items:center;
      justify-content:flex-end;
    }
    .logo img{ max-width:140px; max-height:56px; object-fit:contain; }

    .title2{
      margin: 18px 0 0 0;
      text-align:center;
      font-size:28px;
      font-weight:800;
    }

    /* Sections */
    .grid{
      position:relative;
      z-index:1;
      margin-top:14px;
      display:flex;
      flex-direction:column;
      gap:12px;
    }
    .sec{
      background:var(--card);
      border:1px solid var(--border);
      border-radius:14px;
      overflow:hidden;
      page-break-inside:avoid;
    }
    .secHead{
      background:#fff;
      border-bottom:1px solid var(--border);
      padding:12px 14px;
      font-weight:800;
      font-size:14px;
    }
    .secBody{
      padding:12px 14px 14px 14px;
      font-size:12.5px;
    }

    .muted{ color: var(--muted); font-size:12px; }

    /* No bullets: lines from forms */
    .lines{
      display:flex;
      flex-direction:column;
      gap:6px;
    }
    .line{
      font-size:12.5px;
      line-height:1.35;
      word-wrap:break-word;
      white-space:pre-wrap;
    }

    /* (Optional legacy bullets style if you ever enable bulletsMode="ul") */
    .bullets{
      margin:0;
      padding-left:18px;
      display:flex;
      flex-direction:column;
      gap:6px;
    }

    /* Table styling */
    .tbl{
      width:100%;
      border-collapse:separate;
      border-spacing:0;
      border:2px solid var(--accent);
      border-radius:12px;
      overflow:hidden;
      table-layout:fixed;
    }
    .tbl thead th{
      background:#F9FAFB;
      border-bottom:1px solid var(--border);
      font-size:11px;
      padding:9px 10px;
      text-align:left;
      word-wrap:break-word;
    }
    .tbl tbody td{
      border-bottom:1px solid var(--border);
      border-right:1px solid var(--border);
      padding:9px 10px;
      font-size:11.5px;
      vertical-align:top;
      word-wrap:break-word;
    }
    .tbl tbody tr:last-child td{ border-bottom:none; }
    .tbl tbody td:last-child{ border-right:none; }
  </style>
</head>
<body>
  <div class="wm">${escapeHtml(watermarkText)}</div>

  <div class="wrap">
    <div class="header">
      <div>
        <div class="h1">${escapeHtml(meta.projectName)}</div>
        <div class="meta">
          <span class="pill"><b>Document</b> Project Charter</span>
          <span class="pill"><b>Organisation</b> ${escapeHtml(orgName)}</span>
          <span class="pill"><b>Project ID</b> ${escapeHtml(meta.projectCode || "—")}</span>
          <span class="pill"><b>Generated</b> ${escapeHtml(meta.generated)}</span>
        </div>
      </div>

      <div class="logo">
        ${meta.logoUrl ? `<img src="${escapeHtml(meta.logoUrl)}" />` : ""}
      </div>
    </div>

    <div class="title2">Project Charter</div>

    <div class="grid">
      ${
        sections.length
          ? sections
              .map((sec: any) => {
                const title = String(sec?.title || sec?.key || "Section");
                const t = tableFromSection(sec);

                const body = t
                  ? renderTableHtml(t, {
                      sectionKey: String(sec?.key || ""),
                      currencyLabel,
                      dateLocale: locale,
                    })
                  : bulletsMode === "ul"
                    ? (() => {
                        const items = String(sec?.bullets || "")
                          .split("\n")
                          .map((x) => normalizeBulletLine(x))
                          .map((x) => x.trim())
                          .filter(Boolean);
                        if (!items.length) return `<div class="muted">No content recorded</div>`;
                        return `<ul class="bullets">${items.map((it) => `<li>${escapeHtml(it)}</li>`).join("")}</ul>`;
                      })()
                    : renderLinesFromFormsHtml(String(sec?.bullets || ""));

                return `
                  <div class="sec">
                    <div class="secHead">${escapeHtml(title)}</div>
                    <div class="secBody">${body}</div>
                  </div>
                `;
              })
              .join("")
          : `<div class="sec"><div class="secHead">Charter content</div><div class="secBody"><div class="muted">No sections found.</div></div></div>`
      }
    </div>
  </div>
</body>
</html>`;
}
