
modified_html = '''import "server-only";

// ? FIX: you already have renderClosureReportSections in ./render.ts
import { renderClosureReportSections } from "./render";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function escHtml(s: any) {
  return safeStr(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COLORS = {
  ink: "#0F172A",
  muted: "#64748B",
  border: "#E2E8F0",
  bg: "#F8FAFC",
  headerAccent: "#2563EB",
  headerGradEnd: "#020617",
};

export type ClosureRenderModel = any;

export function renderClosureReportHtml(args: {
  model: ClosureRenderModel;

  projectName: string;
  projectCode: string;
  clientName: string;
  orgName: string;
}) {
  const { model, projectName, projectCode, clientName, orgName } = args;

  const { generatedDateTime, sectionsHtml } = renderClosureReportSections(model);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji","Segoe UI Emoji";
      color: ${COLORS.ink};
      background: white;
    }
    .page { padding: 28px 34px; }

    .header {
      background: linear-gradient(135deg, ${COLORS.headerAccent} 0%, ${COLORS.headerGradEnd} 100%);
      color: white;
      padding: 18px 22px;
      border-radius: 14px;
    }
    .badge {
      display: inline-block;
      background: rgba(255,255,255,.14);
      border: 1px solid rgba(255,255,255,.22);
      padding: 6px 10px;
      border-radius: 10px;
      font-weight: 800;
      letter-spacing: .06em;
      margin-right: 10px;
      color: #fff;
    }
    .h-title { font-size: 22px; font-weight: 800; margin: 0; }
    .h-sub { margin: 6px 0 0; color: rgba(255,255,255,.82); font-size: 13px; }

    .meta {
      margin-top: 14px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .metaCard {
      border: 1px solid ${COLORS.border};
      background: ${COLORS.bg};
      border-radius: 12px;
      padding: 10px 12px;
      min-height: 58px;
    }
    .metaLabel { font-size: 11px; color: ${COLORS.muted}; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; }
    .metaValue { margin-top: 4px; font-size: 14px; font-weight: 800; }
    .metaCode { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; color: ${COLORS.headerAccent}; }

    /* REMOVED: .kpis block styles - no longer needed */

    /* ---- styles expected by renderClosureReportSections ---- */
    .section { margin-top: 18px; }
    .sectionHead { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; }
    .sectionHead .t {
      font-size: 14px;
      font-weight: 900;
      color: ${COLORS.headerAccent};
      border-bottom: 2px solid ${COLORS.headerAccent};
      padding-bottom: 6px;
      flex: 1;
    }
    /* REMOVED: .sectionHead .n (count indicator) - no longer needed */
    .sectionBody { margin-top: 10px; }
    .muted { color: ${COLORS.muted}; font-style: italic; }

    ul.bullets { margin: 0; padding-left: 18px; }
    ul.bullets li { margin: 6px 0; }

    table.kvTable { width:100%; border-collapse: collapse; border:1px solid ${COLORS.border}; border-radius:12px; overflow:hidden; font-size:12.5px; }
    .kvK { width: 30%; background:${COLORS.bg}; color:${COLORS.muted}; font-weight:800; padding:8px 10px; border-bottom:1px solid ${COLORS.border}; }
    .kvV { padding:8px 10px; border-bottom:1px solid ${COLORS.border}; font-weight:800; }

    /* your risks/issues table in sections uses inline styles; keep default table baseline too */
    table { width: 100%; border-collapse: collapse; }

    @page { size: A4 landscape; margin: 10mm; }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div>
        <span class="badge">PC</span>
        <span class="h-title">Project Closure Report</span>
      </div>
      <div class="h-sub">${escHtml(projectName)}</div>
    </div>

    <div class="meta">
      <div class="metaCard">
        <div class="metaLabel">Organisation</div>
        <div class="metaValue">${escHtml(orgName || "—")}</div>
      </div>
      <div class="metaCard">
        <div class="metaLabel">Client</div>
        <div class="metaValue">${escHtml(clientName || "—")}</div>
      </div>
      <div class="metaCard">
        <div class="metaLabel">Project ID</div>
        <div class="metaValue metaCode">${escHtml(projectCode || "—")}</div>
      </div>
      <div class="metaCard">
        <div class="metaLabel">Generated</div>
        <div class="metaValue">${escHtml(generatedDateTime)}</div>
      </div>
    </div>

    <!-- REMOVED: Health block (RAG, Overall, Open Risks/Issues) -->

    ${sectionsHtml}
  </div>
</body>
</html>`;
}
'''

print(modified_html)
