import "server-only";

import { DEFAULT_THEME, ExportTheme } from "../core/theme";
import { ExportMeta } from "../core/meta";
import { formatUkDate } from "../core/format";

type Args = {
  title: string;
  meta: ExportMeta;
  theme?: Partial<ExportTheme>;
  bodyHtml: string;
  subtitle?: string;
};

/**
 * Escapes HTML special characters to prevent injection/rendering issues.
 */
function esc(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Builds a standardized HTML shell for PDF conversion.
 * Includes CSS variables for branding, fixed headers, and print-specific styling.
 */
export function buildStandardPdfHtml({ title, subtitle, meta, theme, bodyHtml }: Args) {
  const t: ExportTheme = { 
    ...DEFAULT_THEME, 
    ...theme, 
    primary: (theme?.primary || meta.brandPrimary || DEFAULT_THEME.primary) 
  };

  const now = formatUkDate(new Date());

  const clientLine = meta.clientName ? `Client: ${esc(meta.clientName)}` : "";
  const projLine = `Project: ${esc(meta.projectTitle)} (${esc(meta.projectCode)})`;

  const logo = meta.clientLogoUrl
    ? `<img class="logo" src="${esc(meta.clientLogoUrl)}" alt="Client logo" />`
    : `<div class="logoFallback">${esc(meta.clientName || t.brandName)}</div>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    :root{
      --primary:${t.primary};
      --text:${t.text};
      --muted:${t.muted};
      --border:${t.border};
      --bg:${t.bg};
      --headerBg:${t.headerBg};
      --theadBg:${t.tableHeadBg};
      --theadText:${t.tableHeadText};
    }
    *{ box-sizing:border-box; }
    body{
      margin:0;
      font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Helvetica Neue", sans-serif;
      color: var(--text);
      background: var(--bg);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .topbar{
      position: fixed;
      top: 0; left: 0; right: 0;
      height: 14mm;
      background: var(--headerBg);
      border-bottom: 2px solid var(--primary);
    }
    .header{
      position: fixed;
      top: 0;
      left: 0; right: 0;
      padding: 6mm 14mm 0 14mm;
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap: 10mm;
      height: 18mm;
    }
    .brandLeft{ display:flex; align-items:center; gap:10px; }
    .logo{
      height: 10mm;
      max-width: 48mm;
      object-fit: contain;
      filter: drop-shadow(0 1px 0 rgba(0,0,0,.25));
    }
    .logoFallback{
      height: 10mm;
      min-width: 36mm;
      padding: 2mm 3mm;
      border-radius: 6px;
      background: rgba(255,255,255,.06);
      color: #fff;
      display:flex;
      align-items:center;
      font-weight:700;
      font-size: 10pt;
    }
    .headerRight{
      color: #fff;
      text-align:right;
      line-height: 1.2;
      max-width: 100mm;
    }
    .org{ font-weight:800; font-size: 11.5pt; }
    .meta{ font-size: 9.5pt; opacity:.92; margin-top: 2px; }
    .docTitle{
      margin-top: 20mm;
      padding: 0 14mm;
    }
    h1{
      margin: 0;
      font-size: 20pt;
      letter-spacing: -0.02em;
    }
    .subtitle{
      margin-top: 4px;
      color: var(--muted);
      font-size: 10.5pt;
    }
    .accent{
      margin-top: 8px;
      height: 3px;
      width: 64mm;
      background: var(--primary);
      border-radius: 999px;
    }
    .content{
      padding: 8mm 14mm 18mm 14mm;
    }
    h2{ margin: 14px 0 8px; font-size: 12.5pt; }
    p{ margin: 0 0 8px; font-size: 10.5pt; color: var(--text); }
    table{
      width:100%;
      border-collapse: collapse;
      font-size: 10pt;
    }
    thead th{
      background: var(--theadBg);
      color: var(--theadText);
      padding: 8px 10px;
      text-align:left;
      font-weight: 800;
    }
    tbody td{
      border-bottom: 1px solid var(--border);
      padding: 8px 10px;
      vertical-align: top;
    }
    tbody tr:nth-child(even) td{
      background: rgba(2,6,23,0.02);
    }
    .footer{
      position: fixed;
      bottom: 6mm; left: 14mm; right: 14mm;
      display:flex;
      justify-content: space-between;
      align-items:center;
      color: var(--muted);
      font-size: 9pt;
      border-top: 1px solid var(--border);
      padding-top: 4mm;
    }
    .page:before{ content: counter(page); }
    .pages:before{ content: counter(pages); }
  </style>
</head>
<body>
  <div class="topbar"></div>
  <div class="header">
    <div class="brandLeft">${logo}</div>
    <div class="headerRight">
      <div class="org">${esc(meta.organisationName)}</div>
      <div class="meta">${esc(projLine)}</div>
      ${clientLine ? `<div class="meta">${esc(clientLine)}</div>` : ""}
    </div>
  </div>
  <div class="docTitle">
    <h1>${esc(title)}</h1>
    ${subtitle ? `<div class="subtitle">${esc(subtitle)}</div>` : ""}
    <div class="accent"></div>
  </div>
  <div class="content">
    ${bodyHtml}
  </div>
  <div class="footer">
    <div>Generated ${esc(now)} • ${esc(t.brandName)}</div>
    <div>Page <span class="page"></span> of <span class="pages"></span></div>
  </div>
</body>
</html>`;
}
