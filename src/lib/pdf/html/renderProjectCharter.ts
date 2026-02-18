// src/lib/pdf/html/renderProjectCharter.ts

type Brand = {
  clientName: string;
  brandColor?: string; // e.g. "#E60000"
  logoDataUrl?: string | null; // e.g. "data:image/png;base64,..."
  productName?: string; // "AlienAI"
};

type RenderOpts = {
  brand: Brand;
  status: string; // "draft" | "submitted" | "changes_requested" | "approved" | "rejected" | "on_hold"
  project?: { title?: string };
  artifact?: { version?: number | string; updated_at?: string; title?: string };
  charter: any; // result of parseProjectCharter()
};

function esc(s: any) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeHex(x: any, fallback = "#E60000") {
  const s = String(x ?? "").trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s)) return s;
  return fallback;
}

function niceStatus(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "changes_requested") return "CHANGES REQUESTED";
  if (s === "on_hold") return "ON HOLD";
  return s.toUpperCase() || "DRAFT";
}

function watermarkText(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return "";
  if (s === "submitted") return "SUBMITTED";
  if (s === "changes_requested") return "CHANGES REQUESTED";
  if (s === "rejected") return "REJECTED";
  if (s === "on_hold") return "ON HOLD";
  return "DRAFT";
}

function fmtDateIso(x: any) {
  const s = String(x ?? "").trim();
  if (!s) return "";
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return s;
    return d.toISOString().slice(0, 10);
  } catch {
    return s;
  }
}

function ul(items: any[]) {
  const clean = (items ?? []).map((x) => String(x ?? "").trim()).filter(Boolean);
  if (!clean.length) return `<div class="empty">No data provided</div>`;
  return `<ol class="list">
    ${clean.map((x) => `<li>${esc(x)}</li>`).join("")}
  </ol>`;
}

function tableMilestones(milestones: any[]) {
  const rows = (milestones ?? []).length ? milestones : [];
  if (!rows.length) {
    return `<div class="empty">No milestones provided</div>`;
  }
  return `<table class="tbl">
    <thead>
      <tr>
        <th style="width:28%">Milestone</th>
        <th style="width:26%">Target Completion Date</th>
        <th style="width:18%">Actual Date</th>
        <th style="width:28%">Notes</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (m: any) => `<tr>
            <td>${esc(m?.milestone)}</td>
            <td>${esc(m?.targetDate)}</td>
            <td>${esc(m?.actualDate ?? "")}</td>
            <td>${esc(m?.notes ?? "")}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

function tableApprovals(approvals: any[]) {
  const rows = (approvals ?? []).length ? approvals : [];
  if (!rows.length) {
    return `<div class="empty">No approvers listed</div>`;
  }
  return `<table class="tbl">
    <thead>
      <tr>
        <th style="width:35%">Role</th>
        <th style="width:65%">Name</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map(
          (a: any) => `<tr>
            <td>${esc(a?.role)}</td>
            <td>${esc(a?.name)}</td>
          </tr>`
        )
        .join("")}
    </tbody>
  </table>`;
}

export function renderProjectCharterHtml(opts: RenderOpts): string {
  const brandColor = safeHex(opts.brand.brandColor, "#E60000");
  const clientName = opts.brand.clientName || "Client";
  const productName = opts.brand.productName || "AlienAI";
  const statusNice = niceStatus(opts.status);
  const wm = watermarkText(opts.status);

  const charter = opts.charter ?? {};
  const h = charter.header ?? {};

  const title = String(h.projectTitle ?? opts.artifact?.title ?? "Project Charter").trim() || "Project Charter";
  const pm = String(h.projectManager ?? "").trim();
  const sponsor = String(h.projectSponsor ?? "").trim();
  const startDate = fmtDateIso(h.startDate ?? "");
  const endDate = fmtDateIso(h.endDate ?? "");

  const businessNeed = String(charter.businessNeed ?? "").trim();
  const scope = String(charter.scope?.scope ?? "").trim();
  const deliverables = String(charter.scope?.deliverables ?? "").trim();

  const budgetSummary = String(charter.financials?.budgetSummary ?? "").trim();
  const decisionOrAsk = String(charter.decisionOrAsk ?? "").trim();

  const v = opts.artifact?.version ?? "";
  const updated = fmtDateIso(opts.artifact?.updated_at ?? "");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${esc(title)}</title>

  <style>
    @page { size: A4; margin: 22mm 14mm 18mm 14mm; }

    :root{
      --brand: ${brandColor};
      --text: #111;
      --muted: #666;
      --line: #dcdcdc;
      --soft: #f5f5f5;
      --mint: #c8f3df;
      --paper: #ffffff;
    }

    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: var(--text);
      background: var(--paper);
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-size: 10.5px;
      line-height: 1.35;
    }

    header {
      position: fixed;
      top: -18mm;
      left: 0;
      right: 0;
      height: 14mm;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6mm 0 0 0;
      font-size: 11px;
      color: #222;
    }
    header .left { font-weight: 700; }
    header .right { display: flex; align-items: center; gap: 10px; }
    header .brandline {
      position: fixed;
      top: -4mm;
      left: -14mm;
      right: -14mm;
      height: 2px;
      background: var(--brand);
    }
    header .logo {
      height: 10mm;
      max-width: 50mm;
      object-fit: contain;
    }

    footer {
      position: fixed;
      bottom: -16mm;
      left: 0;
      right: 0;
      height: 12mm;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 9px;
      color: var(--muted);
    }

    .watermark {
      position: fixed;
      inset: 0;
      display: ${wm ? "flex" : "none"};
      align-items: center;
      justify-content: center;
      font-size: 64px;
      color: rgba(0,0,0,0.10);
      transform: rotate(-35deg);
      pointer-events: none;
      z-index: 0;
    }

    .wrap { position: relative; z-index: 1; }

    .doc-title {
      font-size: 18px;
      font-weight: 800;
      margin: 0 0 6px 0;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 10px 18px;
      color: var(--muted);
      margin-bottom: 10px;
      font-size: 10px;
    }
    .pill {
      display: inline-block;
      padding: 2px 8px;
      border: 1px solid var(--line);
      border-radius: 999px;
      color: #333;
      background: #fff;
      font-size: 10px;
    }

    .classic {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 10px;
      overflow: hidden;
      margin-top: 10px;
    }

    .classic .topbar {
      background: #fff2a3;
      text-align: center;
      font-weight: 800;
      padding: 8px 10px;
      letter-spacing: 0.4px;
    }

    .grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      border-top: 1px solid var(--line);
    }
    .cell {
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      padding: 8px 10px;
      min-height: 40px;
    }
    .grid .cell:nth-child(2n) { border-right: none; }

    .label {
      color: var(--muted);
      font-size: 9px;
      margin-bottom: 4px;
      font-weight: 700;
    }
    .value {
      font-size: 10.5px;
      color: var(--text);
      white-space: pre-wrap;
      word-break: break-word;
    }
    .value.empty { color: var(--muted); }

    .band {
      background: var(--mint);
      text-align: center;
      font-weight: 800;
      padding: 7px 10px;
      border-bottom: 1px solid var(--line);
      border-top: 1px solid var(--line);
    }

    .full {
      grid-column: 1 / -1;
      border-right: none !important;
    }

    .tbl {
      width: 100%;
      border-collapse: collapse;
      margin-top: 8px;
    }
    .tbl th, .tbl td {
      border: 1px solid var(--line);
      padding: 7px 8px;
      vertical-align: top;
      font-size: 10px;
    }
    .tbl th {
      background: var(--soft);
      text-align: left;
      font-weight: 700;
    }

    .list {
      margin: 8px 0 0 18px;
      padding: 0;
    }
    .list li { margin: 2px 0; }

    .empty {
      margin-top: 8px;
      color: var(--muted);
      font-style: italic;
    }

    .avoid-break { break-inside: avoid; page-break-inside: avoid; }
  </style>
</head>

<body>
  <header>
    <div class="brandline"></div>
    <div class="left">${esc(clientName)}</div>
    <div class="right">
      <div class="pill">${esc(statusNice)}</div>
      ${opts.brand.logoDataUrl ? `<img class="logo" src="${opts.brand.logoDataUrl}" alt="logo" />` : ""}
    </div>
  </header>

  <footer>
    <div>Confidential – ${esc(clientName)} – Generated by ${esc(productName)} – ${esc(new Date().toISOString().slice(0,10))}</div>
    <div>Page <span class="pageNumber"></span> / <span class="totalPages"></span></div>
  </footer>

  <div class="watermark">${esc(wm)}</div>

  <div class="wrap">
    <div class="doc-title">${esc(title)}</div>
    <div class="meta">
      ${opts.project?.title ? `<div><b>Project:</b> ${esc(opts.project.title)}</div>` : ""}
      ${v !== "" ? `<div><b>Version:</b> ${esc(v)}</div>` : ""}
      ${updated ? `<div><b>Updated:</b> ${esc(updated)}</div>` : ""}
    </div>

    <div class="classic">
      <div class="topbar">PROJECT CHARTER</div>

      <div class="grid">
        <div class="cell">
          <div class="label">Project Title</div>
          <div class="value ${title ? "" : "empty"}">${esc(title || "No data provided")}</div>
        </div>
        <div class="cell">
          <div class="label">Project Manager</div>
          <div class="value ${pm ? "" : "empty"}">${esc(pm || "No data provided")}</div>
        </div>

        <div class="cell">
          <div class="label">Project Start Date</div>
          <div class="value ${startDate ? "" : "empty"}">${esc(startDate || "No data provided")}</div>
        </div>
        <div class="cell">
          <div class="label">Project End Date</div>
          <div class="value ${endDate ? "" : "empty"}">${esc(endDate || "No data provided")}</div>
        </div>

        <div class="cell full">
          <div class="label">Project Sponsor</div>
          <div class="value ${sponsor ? "" : "empty"}">${esc(sponsor || "No data provided")}</div>
        </div>
      </div>

      <div class="band">Business Need</div>
      <div class="grid">
        <div class="cell full">
          <div class="value ${businessNeed ? "" : "empty"}">${esc(businessNeed || "No data provided")}</div>
        </div>
      </div>

      <div class="band">Project Scope</div>
      <div class="grid">
        <div class="cell">
          <div class="label">Scope</div>
          <div class="value ${scope ? "" : "empty"}">${esc(scope || "No data provided")}</div>
        </div>
        <div class="cell">
          <div class="label">Deliverables</div>
          <div class="value ${deliverables ? "" : "empty"}">${esc(deliverables || "No data provided")}</div>
        </div>
      </div>

      <div class="band">Milestone Schedule</div>
      <div class="grid">
        <div class="cell full avoid-break">
          ${tableMilestones(charter.milestones || [])}
        </div>
      </div>

      <div class="band">Financials</div>
      <div class="grid">
        <div class="cell full">
          <div class="value ${budgetSummary ? "" : "empty"}">${esc(budgetSummary || "No data provided")}</div>
        </div>
      </div>

      <div class="band">Top Risks &amp; Issues</div>
      <div class="grid">
        <div class="cell full">
          ${ul(charter.topRisksAndIssues || [])}
        </div>
      </div>

      <div class="band">Dependencies</div>
      <div class="grid">
        <div class="cell full">
          ${ul(charter.dependencies || [])}
        </div>
      </div>

      <div class="band">Decision / Ask</div>
      <div class="grid">
        <div class="cell full">
          <div class="value ${decisionOrAsk ? "" : "empty"}">${esc(decisionOrAsk || "No data provided")}</div>
        </div>
      </div>

      <div class="band">Approval / Review Committee</div>
      <div class="grid">
        <div class="cell full avoid-break">
          ${tableApprovals(charter.approvals || [])}
        </div>
      </div>

    </div>
  </div>
</body>
</html>`;
}
