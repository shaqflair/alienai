import "server-only";

// ✅ you already have renderClosureReportSections in ./render.ts
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
  accent: "#2563EB",
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

  const { generatedDateTime, openRisksCount, sectionsHtml } = renderClosureReportSections(model);

  const rag = safeStr(model?.rag || "—").toUpperCase() || "—";
  const overall = safeStr(model?.overall || "—") || "—";

  // Optional PM name if you want it like Charter (falls back to signoff.pm_name)
  const pmName =
    safeStr(model?.projectManager) ||
    safeStr(model?.pm_name) ||
    safeStr(model?.signoff?.pm_name) ||
    safeStr(model?.signoff?.pmName) ||
    "";

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
    .page { padding: 26px 34px; }

    /* --- Charter-style header --- */
    .topRow { display:flex; align-items:flex-start; justify-content:space-between; gap: 18px; }
    .brand { display:flex; align-items:center; gap: 14px; }
    .badge {
      width: 44px; height: 44px;
      border-radius: 12px;
      background: linear-gradient(180deg, ${COLORS.accent} 0%, #1D4ED8 100%);
      color: #fff;
      display:flex; align-items:center; justify-content:center;
      font-weight: 900;
      letter-spacing: .06em;
    }
    .titles { display:flex; flex-direction:column; gap: 2px; }
    .h1 { font-size: 28px; font-weight: 900; margin: 0; line-height: 1.1; }
    .sub { font-size: 13px; color: ${COLORS.muted}; font-weight: 700; }

    .generatedBox { text-align:right; min-width: 220px; }
    .genLabel {
      font-size: 11px; color: ${COLORS.muted};
      font-weight: 800; text-transform: uppercase; letter-spacing: .06em;
    }
    .genValue { margin-top: 6px; font-size: 14px; font-weight: 900; }

    .divider { margin: 16px 0 14px; height: 2px; background: ${COLORS.accent}; opacity: 0.35; border-radius: 2px; }

    .meta {
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
    .metaLabel { font-size: 11px; color: ${COLORS.muted}; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .metaValue { margin-top: 4px; font-size: 14px; font-weight: 900; }
    .metaCode { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; color: ${COLORS.accent}; }

    /* KPI row (kept) */
    .kpis { margin-top: 12px; }
    .kpiRow { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .kpi {
      border: 1px solid ${COLORS.border};
      background: white;
      border-radius: 12px;
      padding: 10px 12px;
    }
    .kpiLabel { font-size: 12px; color: ${COLORS.muted}; font-weight: 800; text-transform: uppercase; letter-spacing: .04em; }
    .kpiValue { margin-top: 6px; font-size: 18px; font-weight: 950; }

    /* ---- styles expected by renderClosureReportSections ---- */
    .section { margin-top: 18px; }
    .sectionHead { display:flex; justify-content:space-between; align-items:flex-end; gap:12px; }
    .sectionHead .t {
      font-size: 14px;
      font-weight: 950;
      color: ${COLORS.accent};
      border-bottom: 2px solid ${COLORS.accent};
      padding-bottom: 6px;
      flex: 1;
    }
    .sectionHead .n { font-size: 11px; color: ${COLORS.muted}; font-weight: 800; white-space: nowrap; }
    .sectionBody { margin-top: 10px; }
    .muted { color: ${COLORS.muted}; font-style: italic; }

    ul.bullets { margin: 0; padding-left: 18px; }
    ul.bullets li { margin: 6px 0; }

    table.kvTable {
      width:100%;
      border-collapse: collapse;
      border:1px solid ${COLORS.border};
      border-radius:12px;
      overflow:hidden;
      font-size:12.5px;
    }
    .kvK { width: 30%; background:${COLORS.bg}; color:${COLORS.muted}; font-weight:900; padding:8px 10px; border-bottom:1px solid ${COLORS.border}; }
    .kvV { padding:8px 10px; border-bottom:1px solid ${COLORS.border}; font-weight:900; }

    table { width: 100%; border-collapse: collapse; }

    @page { size: A4 landscape; margin: 10mm; }
  </style>
</head>
<body>
  <div class="page">
    <div class="topRow">
      <div class="brand">
        <div class="badge">PC</div>
        <div class="titles">
          <h1 class="h1">Project Closure Report</h1>
          <div class="sub">${escHtml(projectName)}</div>
        </div>
      </div>
      <div class="generatedBox">
        <div class="genLabel">Generated</div>
        <div class="genValue">${escHtml(generatedDateTime)}</div>
      </div>
    </div>

    <div class="divider"></div>

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
        <div class="metaLabel">Project Manager</div>
        <div class="metaValue">${escHtml(pmName || "—")}</div>
      </div>
    </div>

    <div class="kpis">
      <div class="kpiRow">
        <div class="kpi">
          <div class="kpiLabel">RAG</div>
          <div class="kpiValue">${escHtml(rag)}</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Overall</div>
          <div class="kpiValue">${escHtml(overall)}</div>
        </div>
        <div class="kpi">
          <div class="kpiLabel">Open Risks / Issues</div>
          <div class="kpiValue">${escHtml(String(openRisksCount))}</div>
        </div>
      </div>
    </div>

    ${sectionsHtml}
  </div>
</body>
</html>`;
}