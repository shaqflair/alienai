// src/lib/exports/charter/exportCharterPdfBuffer.ts
import "server-only";

import { htmlToPdfBuffer } from "../_shared/puppeteer";
import { formatUkDate, safeStr, type CharterExportMeta } from "./charterShared";

/* ---------------- helpers ---------------- */

function escapeHtml(str: any) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function looksIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}
function looksIsoDateTime(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v || "").trim());
}
function formatToUkDate(value: string) {
  const s = String(value || "").trim();
  if (!s) return s;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return s;
  }
}

function formatCellValue(x: any) {
  const raw = safeStr(x).trim();
  if (!raw) return "—";
  if (looksIsoDateOnly(raw) || looksIsoDateTime(raw)) return formatToUkDate(raw);
  return raw;
}

function stripNumberPrefix(title: string) {
  return String(title ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

function stripLeadingBullets(line: string) {
  return String(line ?? "")
    .replace(/^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/g, "")
    .trim();
}

function splitCellLines(v: any): string[] {
  const raw = String(v ?? "");
  const lines = raw
    .split("\n")
    .map((x) => stripLeadingBullets(x).trim())
    .filter(Boolean);
  return lines.length ? lines : [""];
}

function expandRowsByNewlines(rows: string[][]) {
  const out: string[][] = [];
  for (const rowCells of rows) {
    const perCell = rowCells.map(splitCellLines);
    const maxLen = Math.max(1, ...perCell.map((a) => a.length));
    for (let i = 0; i < maxLen; i++) out.push(perCell.map((a) => a[i] ?? ""));
  }
  return out;
}

function normalizeTable(sec: any): { header: string[]; rows: string[][] } | null {
  const t = sec?.table ?? null;

  // v2
  if (t && Array.isArray(t.rows) && t.rows.length) {
    const headerRow = t.rows.find((r: any) => r?.type === "header");
    const dataRows = t.rows.filter((r: any) => r?.type === "data");

    const header = Array.isArray(headerRow?.cells) ? headerRow.cells.map((c: any) => safeStr(c)) : [];
    const rows = dataRows.map((r: any) => (Array.isArray(r?.cells) ? r.cells.map((c: any) => safeStr(c)) : []));

    if ((!header || header.length === 0) && Array.isArray(sec?.columns)) {
      return { header: sec.columns.map((c: any) => safeStr(c)), rows };
    }

    return { header, rows };
  }

  // legacy sec.rows
  if (Array.isArray(sec?.rows)) {
    const header = Array.isArray(sec?.columns) ? sec.columns.map((c: any) => safeStr(c)) : [];
    const rows = sec.rows.map((r: any) => (Array.isArray(r) ? r.map((c: any) => safeStr(c)) : []));
    return { header, rows };
  }

  // legacy t.columns/t.rows
  if (t && (Array.isArray((t as any).columns) || Array.isArray((t as any).rows))) {
    const header = Array.isArray((t as any).columns) ? (t as any).columns.map((c: any) => safeStr(c)) : [];
    const rowsRaw = Array.isArray((t as any).rows) ? (t as any).rows : [];
    const rows = rowsRaw.map((row: any) => {
      const cells = Array.isArray(row) ? row : row?.cells || [];
      return (Array.isArray(cells) ? cells : []).map((c: any) => safeStr(c));
    });
    return { header, rows };
  }

  return null;
}

/* ---------------- filename ---------------- */

export function charterPdfFilename(meta: CharterExportMeta) {
  const code = safeStr(meta?.projectCode || "P-00000").replace(/[^A-Za-z0-9_-]+/g, "_");
  const date = formatUkDate().replace(/\//g, "-");
  return `Project_${code}_Charter_${date}.pdf`;
}

/* ---------------- renderer ---------------- */

function renderCharterHtml(doc: any, meta: CharterExportMeta) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];
  const bulletIndices = new Set([0, 1, 3, 6, 7, 8, 9]);

  const sectionsHtml = sections
    .map((sec: any, idx: number) => {
      const rawTitle = safeStr(sec?.title || sec?.key || `Section ${idx + 1}`);
      const title = escapeHtml(stripNumberPrefix(rawTitle));

      const secKey = safeStr(sec?.key).trim().toLowerCase();
      const isScope = secKey === "scope_in_out" || secKey === "scope";

      const useBullets = bulletIndices.has(idx);
      const plainLinesForThisSection = idx === 0 || idx === 1;

      let contentHtml = "";
      let rawContent = "";

      if (useBullets) {
        rawContent = sec?.bullets || sec?.content || "";
      } else {
        const norm = normalizeTable(sec);
        if (norm && (norm.header.length || norm.rows.length)) {
          const header = norm.header || [];
          const dataRows = norm.rows || [];
          const rowsForRender = isScope ? expandRowsByNewlines(dataRows) : dataRows;

          const headerHtml =
            header.length > 0
              ? `<tr>${header.map((c: string) => `<th>${escapeHtml(c)}</th>`).join("")}</tr>`
              : "";

          const rowsHtml = rowsForRender
            .map((cells: string[], rIdx: number) => {
              const bgClass = rIdx % 2 === 0 ? "row-even" : "row-odd";
              return `<tr class="${bgClass}">${cells
                .map((c: any) => `<td>${escapeHtml(formatCellValue(stripLeadingBullets(String(c ?? ""))))}</td>`)
                .join("")}</tr>`;
            })
            .join("");

          contentHtml = `
            <div class="section-table">
              <table>
                ${headerHtml ? `<thead>${headerHtml}</thead>` : ""}
                <tbody>${rowsHtml}</tbody>
              </table>
            </div>
          `;
        } else {
          rawContent = sec?.bullets || sec?.content || "";
        }
      }

      if (!contentHtml && rawContent) {
        const lines = String(rawContent)
          .split("\n")
          .map((x: string) => stripLeadingBullets(x).trim())
          .filter(Boolean);

        if (lines.length > 0) {
          if (plainLinesForThisSection) {
            contentHtml = `
              <div class="plain-lines">
                ${lines.map((line: string) => `<div class="plain-line">${escapeHtml(line)}</div>`).join("")}
              </div>
            `;
          } else {
            contentHtml = `<ul class="bullet-list">
              ${lines.map((line: string) => `<li>${escapeHtml(line)}</li>`).join("")}
            </ul>`;
          }
        }
      }

      if (!contentHtml) contentHtml = '<div class="empty-content">No content recorded</div>';

      return `
        <div class="section-card">
          <div class="section-header">
            <span class="section-number">${idx + 1}</span>
            <span class="section-title-text">${title}</span>
            ${sec?.approved ? '<span class="approved-badge">✓ Approved</span>' : ""}
          </div>
          <div class="section-body">
            ${contentHtml}
          </div>
        </div>
      `;
    })
    .join("");

  const projectName = escapeHtml(meta.projectName || "Project");
  const projectCode = escapeHtml(meta.projectCode || "—");

  return `<!DOCTYPE html>
<html lang="en-GB">
<head>
  <meta charset="utf-8">
  <title>Project Charter - ${projectName}</title>
  <style>
    :root {
      --primary: #2563eb;
      --text: #0f172a;
      --text-muted: #64748b;
      --bg: #ffffff;
      --bg-secondary: #f8fafc;
      --border: #e2e8f0;
    }

    /* ✅ Use CSS page size + margins as the single source of truth */
    @page { size: A4 landscape; margin: 16mm 20mm 20mm 20mm; }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      font-size: 10pt;
      line-height: 1.5;
      color: var(--text);
      background: var(--bg);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .header {
      margin-bottom: 20px;
      padding-bottom: 18px;
      border-bottom: 2px solid var(--border);
    }
    .header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 16px;
    }
    .brand { display: flex; align-items: center; gap: 16px; }
    .logo {
      width: 48px; height: 48px; border-radius: 10px;
      background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
      display: flex; align-items: center; justify-content: center;
      color: white; font-weight: 700; font-size: 20px;
      box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1);
    }
    .brand-content h1 {
      font-size: 24pt; font-weight: 700; color: var(--text);
      letter-spacing: -0.02em; margin-bottom: 4px;
    }
    .brand-content .subtitle { font-size: 11pt; color: var(--text-muted); font-weight: 500; }
    .generated-meta { text-align: right; }
    .generated-label {
      font-size: 8pt; color: var(--text-muted); font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px;
    }
    .generated-value { font-size: 11pt; color: var(--text); font-weight: 600; }

    .meta-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .meta-card {
      background: var(--bg-secondary);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 12px 16px;
    }
    .meta-label {
      font-size: 8pt; text-transform: uppercase; letter-spacing: 0.05em;
      color: var(--text-muted); font-weight: 700; margin-bottom: 4px;
    }
    .meta-value { font-size: 10.5pt; font-weight: 600; color: var(--text); }
    .meta-value.code { font-family: "SF Mono", Monaco, monospace; color: var(--primary); font-size: 12pt; }

    .content-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    .section-card {
      background: white; border: 1px solid var(--border); border-radius: 8px;
      overflow: hidden; break-inside: avoid; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
    }
    .section-header {
      background: var(--bg-secondary); padding: 10px 16px;
      border-bottom: 2px solid var(--primary);
      display: flex; align-items: center; gap: 10px;
    }
    .section-number {
      background: var(--primary); color: white; width: 24px; height: 24px;
      border-radius: 50%; display: flex; align-items: center; justify-content: center;
      font-size: 9pt; font-weight: 700;
    }
    .section-title-text { font-size: 11pt; font-weight: 700; color: var(--primary); flex: 1; }
    .approved-badge {
      background: #d1fae5; color: #065f46; padding: 2px 8px;
      border-radius: 9999px; font-size: 7pt; font-weight: 700;
    }
    .section-body { padding: 12px 16px; }

    ul.bullet-list { list-style: none; padding: 0; margin: 0; }
    ul.bullet-list li {
      position: relative; padding-left: 16px; margin-bottom: 6px;
      line-height: 1.4; font-size: 9.5pt; color: var(--text);
    }
    ul.bullet-list li:before {
      content: "•"; color: var(--primary); font-weight: 700;
      position: absolute; left: 0; font-size: 12pt; line-height: 1;
    }

    .plain-lines { display: flex; flex-direction: column; gap: 8px; }
    .plain-line { font-size: 9.5pt; color: var(--text); line-height: 1.45; }

    table { width: 100%; border-collapse: collapse; font-size: 9pt; }
    th {
      background: linear-gradient(to bottom, #f8fafc, #f1f5f9);
      text-align: left; padding: 8px; font-weight: 700; font-size: 8pt;
      text-transform: uppercase; letter-spacing: 0.03em; color: var(--primary);
      border-bottom: 2px solid var(--primary);
    }
    td { padding: 8px; border-bottom: 1px solid var(--border); }
    .row-even { background: white; }
    .row-odd { background: #fafafa; }

    .empty-content {
      color: var(--text-muted); font-style: italic; padding: 20px;
      text-align: center; background: var(--bg-secondary); border-radius: 6px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-top">
      <div class="brand">
        <div class="logo">PC</div>
        <div class="brand-content">
          <h1>Project Charter</h1>
          <div class="subtitle">${projectName}${projectCode !== "—" ? ` • Project ${projectCode}` : ""}</div>
        </div>
      </div>
      <div class="generated-meta">
        <div class="generated-label">Generated</div>
        <div class="generated-value">${escapeHtml(meta.generated)}</div>
      </div>
    </div>

    <div class="meta-grid">
      <div class="meta-card">
        <div class="meta-label">Organisation</div>
        <div class="meta-value">${escapeHtml(meta.organisationName)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Client</div>
        <div class="meta-value">${escapeHtml(meta.clientName)}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Project ID</div>
        <div class="meta-value code">${projectCode}</div>
      </div>
      <div class="meta-card">
        <div class="meta-label">Project Manager</div>
        <div class="meta-value">${escapeHtml(meta.pmName)}</div>
      </div>
    </div>
  </div>

  <div class="content-grid">
    ${sectionsHtml}
  </div>
</body>
</html>`;
}

/* ---------------- main buffer export ---------------- */

export async function exportCharterPdfBuffer(args: { doc: any; meta: CharterExportMeta }) {
  const { doc, meta } = args;

  const html = renderCharterHtml(doc, meta);

  // ✅ Chromium-safe: keep templates minimal, inline-only
  const headerTemplate = `
    <div style="width:100%; font-size:8px; color:#64748b; padding:0 20mm; box-sizing:border-box;">
      ${escapeHtml(meta.projectName)} • Project Charter
    </div>
  `;

  const footerTemplate = `
    <div style="width:100%; font-size:8px; color:#64748b; padding:0 20mm; box-sizing:border-box;">
      <div style="display:flex; justify-content:space-between; width:100%;">
        <span>Confidential</span>
        <span>Generated ${escapeHtml(meta.generated)} • Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    </div>
  `;

  const pdf = await htmlToPdfBuffer({
    html,
    waitUntil: "networkidle2",
    emulateScreen: true,
    viewport: { width: 1440, height: 1024, deviceScaleFactor: 2 },
    forceA4PageSize: true,
    navigationTimeoutMs: 30_000,
    renderTimeoutMs: 60_000,
    pdf: {
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: true,
      headerTemplate,
      footerTemplate,
      margin: { top: "16mm", right: "20mm", bottom: "20mm", left: "20mm" },
    },
  });

  return pdf;
}
