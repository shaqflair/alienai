import "server-only";

import { htmlToPdfBuffer } from "../_shared/puppeteer";
import { formatUkDate, safeStr, type CharterExportMeta } from "./charterShared";

/* ---------------- filename export (FIX FOR VERCEL BUILD) ---------------- */

export function charterPdfFilename(meta: CharterExportMeta) {
  const code = safeStr(meta?.projectCode || "P-00000").replace(/[^A-Za-z0-9_-]+/g, "_");
  const date = formatUkDate().replace(/\//g, "-");
  return `Project_${code}_Charter_${date}.pdf`;
}

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

  if (t && Array.isArray(t.rows) && t.rows.length) {
    const headerRow = t.rows.find((r: any) => r?.type === "header");
    const dataRows = t.rows.filter((r: any) => r?.type === "data");

    const header = Array.isArray(headerRow?.cells) ? headerRow.cells.map((c: any) => safeStr(c)) : [];
    const rows = dataRows.map((r: any) =>
      Array.isArray(r?.cells) ? r.cells.map((c: any) => safeStr(c)) : []
    );

    if ((!header || header.length === 0) && Array.isArray(sec?.columns)) {
      return { header: sec.columns.map((c: any) => safeStr(c)), rows };
    }
    return { header, rows };
  }

  if (Array.isArray(sec?.rows)) {
    const header = Array.isArray(sec?.columns) ? sec.columns.map((c: any) => safeStr(c)) : [];
    const rows = sec.rows.map((r: any) =>
      Array.isArray(r) ? r.map((c: any) => safeStr(c)) : []
    );
    return { header, rows };
  }

  if (t && (Array.isArray((t as any).columns) || Array.isArray((t as any).rows))) {
    const header = Array.isArray((t as any).columns)
      ? (t as any).columns.map((c: any) => safeStr(c))
      : [];
    const rowsRaw = Array.isArray((t as any).rows) ? (t as any).rows : [];
    const rows = rowsRaw.map((row: any) => {
      const cells = Array.isArray(row) ? row : row?.cells || [];
      return (Array.isArray(cells) ? cells : []).map((c: any) => safeStr(c));
    });
    return { header, rows };
  }

  return null;
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
@page { size: A4 landscape; margin:16mm 20mm 20mm 20mm; }
body{font-family:Segoe UI,Arial,sans-serif;font-size:10pt;color:#0f172a}
</style>
</head>
<body>
<h1>Project Charter</h1>
<h3>${projectName} • ${projectCode}</h3>
${sectionsHtml}
</body>
</html>`;
}

/* ---------------- main buffer export ---------------- */

export async function exportCharterPdfBuffer(args: { doc: any; meta: CharterExportMeta }) {
  const { doc, meta } = args;

  const html = renderCharterHtml(doc, meta);

  const pdf = await htmlToPdfBuffer({
    html,
    waitUntil: "networkidle2",
    emulateScreen: true,
    viewport: { width: 1440, height: 1024, deviceScaleFactor: 2 },
    forceA4PageSize: true,
    navigationTimeoutMs: 30000,
    renderTimeoutMs: 60000,
    pdf: {
      landscape: true,
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "16mm", right: "20mm", bottom: "20mm", left: "20mm" },
    },
  });

  return pdf;
}
