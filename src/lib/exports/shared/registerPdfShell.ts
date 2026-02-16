import "server-only";

/**
 * Safely escapes HTML to prevent injection or broken markup.
 */
export function escapeHtml(value: any): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Shared base layout wrapper for register/table-style exports.
 * Optimized for Puppeteer + A4 PDF output.
 */
export function renderRegisterShell(opts: {
  title: string;
  metaHtml: string;
  bodyHtml: string;
  generatedAt?: string;
}) {
  const { title, metaHtml, bodyHtml, generatedAt } = opts;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  * { box-sizing: border-box; }

  body {
    font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    margin: 0;
    padding: 28px;
    color: #0f172a;
    background: #ffffff;
    font-size: 13px;
    line-height: 1.45;
  }

  .header {
    border-bottom: 2px solid #2563eb;
    padding-bottom: 10px;
    margin-bottom: 22px;
  }

  h1 {
    font-size: 20px;
    margin: 0;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .meta {
    margin-bottom: 22px;
    font-size: 12px;
    color: #475569;
  }

  .content {
    font-size: 12px;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 12px;
    table-layout: fixed;
    page-break-inside: auto;
  }

  thead { display: table-header-group; }

  tr {
    page-break-inside: avoid;
    page-break-after: auto;
  }

  th {
    background: #2563eb;
    color: white;
    text-align: left;
    padding: 8px;
    font-size: 11px;
    font-weight: 700;
  }

  td {
    border: 1px solid #e2e8f0;
    padding: 8px;
    font-size: 11px;
    vertical-align: top;
    word-break: break-word;
  }

  .footer {
    margin-top: 32px;
    font-size: 10px;
    color: #64748b;
    text-align: right;
  }

  @page {
    size: A4;
    margin: 10mm;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>${escapeHtml(title)}</h1>
  </div>

  <div class="meta">${metaHtml}</div>

  <div class="content">
    ${bodyHtml}
  </div>

  ${
    generatedAt
      ? `<div class="footer">Generated ${escapeHtml(generatedAt)}</div>`
      : ""
  }

</body>
</html>`;
}
