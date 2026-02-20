import "server-only";

/**
 * Closure Report HTML wrapper used by PDF exports.
 * Delegates section rendering to ./render.ts (single source of truth).
 */

import { renderClosureReportSections } from "./render";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function esc(x: any) {
  return safeStr(x)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type RenderClosureReportHtmlArgs = {
  model: any;
  projectName: string;
  projectCode: string;
  clientName: string;
  orgName: string;
  logoDataUrl?: string | null;
};

export function renderClosureReportHtml(args: RenderClosureReportHtmlArgs): string {
  const { model, projectName, projectCode, clientName, orgName } = args;

  const { generatedDateTime, sectionsHtml } = renderClosureReportSections(model);

  const css = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color: #0b1220; background:#fff; }
    .page { padding: 28px 34px; }

    .header {
      background: linear-gradient(135deg, #2563eb 0%, #020617 100%);
      color: #fff;
      padding: 18px 22px;
      border-radius: 14px;
    }
    .badge {
      display:inline-block;
      background: rgba(255,255,255,.14);
      border: 1px solid rgba(255,255,255,.22);
      padding: 6px 10px;
      border-radius: 10px;
      font-weight: 900;
      letter-spacing: .06em;
      margin-right: 10px;
      color: #fff;
    }
    .h-title { font-size: 22px; font-weight: 900; margin: 0; }
    .h-sub { margin: 6px 0 0; color: rgba(255,255,255,.82); font-size: 13px; font-weight: 700; }

    .meta {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .metaCard {
      border: 1px solid #e2e8f0;
      background: #f8fafc;
      border-radius: 12px;
      padding: 10px 12px;
      min-height: 58px;
    }
    .metaLabel { font-size: 11px; color: #64748b; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .metaValue { margin-top: 4px; font-size: 14px; font-weight: 900; }
    .metaCode { font-family: ui-monospace, monospace; color: #2563eb; }

    @page { size: A4 landscape; margin: 10mm; }
  `;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${css}</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        <span class="badge">PC</span>
        <span class="h-title">Project Closure Report</span>
      </div>
      <div class="h-sub">${esc(projectName || "Project")}</div>
    </div>

    <div class="meta">
      <div class="metaCard">
        <div class="metaLabel">Organisation</div>
        <div class="metaValue">${esc(orgName || "—")}</div>
      </div>
      <div class="metaCard">
        <div class="metaLabel">Client</div>
        <div class="metaValue">${esc(clientName || "—")}</div>
      </div>
      <div class="metaCard">
        <div class="metaLabel">Project ID</div>
        <div class="metaValue metaCode">${esc(projectCode || "—")}</div>
      </div>
      <div class="metaCard">
        <div class="metaLabel">Generated</div>
        <div class="metaValue">${esc(generatedDateTime || "—")}</div>
      </div>
    </div>

    ${safeStr(sectionsHtml)}
  </div>
</body>
</html>`;
}

export default renderClosureReportHtml;