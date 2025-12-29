// src/lib/pdf/charter-html.ts
// ✅ v2-only renderer for Project Charter (tables + bullets)
// - Consumes v2: { meta, sections[] } (NOT ProseMirror / TipTap JSON)
// - Produces: { html, headerTemplate, footerTemplate }
// - Safe: no JSX, no DOM APIs, pure string templates

export type PdfBrand = {
  clientName: string;
  brandColor: string; // #RRGGBB
  productName?: string; // e.g. "AlienAI"
  logoDataUri?: string | null; // data:image/... OR https://...
};

export type RowObj = { type: "header" | "data"; cells: string[] };

export type CharterMeta = {
  project_title?: string;
  project_manager?: string;
  project_start_date?: string;
  project_end_date?: string;
  project_sponsor?: string;
  customer_account?: string;
};

export type CharterSection = {
  key: string;
  title: string;

  // Supported shapes (v2)
  table?: { columns: number; rows: RowObj[] };
  columns?: string[];
  rows?: string[][];
  bullets?: string; // newline separated, optionally "- " / "• "
};

export type CharterDataV2 = {
  meta?: CharterMeta;
  sections?: CharterSection[];
};

export type CharterData = {
  // These are the top-level hints you already pass from the route
  projectTitle: string;
  projectCode?: string | null;
  version?: string | null;
  status?: string | null;
  preparedBy?: string | null;
  approvedBy?: string | null;
  lastUpdated?: string | null;

  // IMPORTANT: raw must contain v2 data: { meta, sections }
  raw: any;
};

function escapeHtml(x: any): string {
  return String(x ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function safeHexColor(x: any, fallback = "#E60000") {
  const s = String(x ?? "").trim();
  if (/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s)) return s;
  return fallback;
}

function normKey(x: any) {
  return String(x ?? "").trim().toLowerCase();
}

function fmtDateMaybe(x: any) {
  if (!x) return "—";
  try {
    const d = new Date(x);
    if (Number.isNaN(d.getTime())) return String(x);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(x);
  }
}

function parseBullets(bullets: any): string[] {
  const raw = String(bullets ?? "");
  return raw
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*[-•]\s*/, "").trim())
    .filter(Boolean);
}

function pad(arr: string[], n: number) {
  const out = [...(arr ?? []).map((x) => String(x ?? ""))];
  while (out.length < n) out.push("");
  return out.slice(0, n);
}

function normalizeToTable(section: CharterSection): { columns: number; rows: RowObj[] } | null {
  // A) already in table model
  if (section.table?.columns && Array.isArray(section.table.rows)) {
    return { columns: section.table.columns, rows: section.table.rows };
  }

  // B) columns/rows model
  if (Array.isArray(section.columns) && Array.isArray(section.rows)) {
    const cols = Math.max(1, section.columns.length || 1);
    const rows: RowObj[] = [];
    if (section.columns.length) rows.push({ type: "header", cells: pad(section.columns, cols) });
    for (const r of section.rows) rows.push({ type: "data", cells: pad(r ?? [], cols) });
    return { columns: cols, rows };
  }

  return null;
}

/**
 * IMPORTANT:
 * These keys MUST match your editor's REQUIRED_SECTIONS keys.
 * Your editor uses:
 * - business_case
 * - objectives
 * - scope_in_out
 * - key_deliverables
 * - milestones_timeline
 * - financials
 * - risks
 * - issues
 * - assumptions
 * - dependencies
 * - project_team
 * - stakeholders
 * - approval_committee
 */
const REQUIRED_V2_SECTIONS: Array<{ key: string; title: string; kind: "table" | "bullets" | "either" }> = [
  { key: "business_case", title: "1. Business Case", kind: "either" },
  { key: "objectives", title: "2. Objectives", kind: "either" },
  { key: "scope_in_out", title: "3. Scope (In / Out of Scope)", kind: "table" },
  { key: "key_deliverables", title: "4. Key Deliverables", kind: "either" },
  { key: "milestones_timeline", title: "5. Milestones & Timeline", kind: "table" },
  { key: "financials", title: "6. Financials", kind: "table" },
  { key: "risks", title: "7. Risks", kind: "either" },
  { key: "issues", title: "8. Issues", kind: "either" },
  { key: "assumptions", title: "9. Assumptions", kind: "either" },
  { key: "dependencies", title: "10. Dependencies", kind: "either" },
  { key: "project_team", title: "11. Project Team", kind: "table" },
  { key: "stakeholders", title: "12. Stakeholders", kind: "table" },
  { key: "approval_committee", title: "13. Approval / Review Committee", kind: "table" },
];

function indexSectionsByKey(sections: CharterSection[] | undefined | null) {
  const map = new Map<string, CharterSection>();
  for (const s of sections ?? []) {
    const k = normKey(s?.key);
    if (!k) continue;
    if (!map.has(k)) map.set(k, s);
  }
  return map;
}

function ensureRequiredSections(rawSections: CharterSection[] | undefined | null): CharterSection[] {
  const byKey = indexSectionsByKey(rawSections);
  const out: CharterSection[] = [];

  for (const req of REQUIRED_V2_SECTIONS) {
    const found = byKey.get(req.key);

    if (found) {
      // Keep the found content but enforce key/title ordering
      out.push({
        key: req.key,
        title: found.title || req.title,
        table: found.table,
        columns: found.columns,
        rows: found.rows,
        bullets: found.bullets,
      });
    } else {
      // Create empty placeholder
      out.push({ key: req.key, title: req.title });
    }
  }

  return out;
}

function renderMetaTable(meta: CharterMeta, projectTitleFallback: string) {
  const m: CharterMeta = { ...(meta ?? {}) };
  const projectTitle = m.project_title || projectTitleFallback;

  const rows: Array<[string, string]> = [
    ["Project Title", projectTitle || "—"],
    ["Project Manager", m.project_manager || "—"],
    ["Project Start Date", fmtDateMaybe(m.project_start_date)],
    ["Project End Date", fmtDateMaybe(m.project_end_date)],
    ["Project Sponsor", m.project_sponsor || "—"],
    ["Customer / Account", m.customer_account || "—"],
  ];

  const cells = rows
    .map(
      ([k, v]) => `
      <tr>
        <th>${escapeHtml(k)}</th>
        <td>${escapeHtml(v)}</td>
      </tr>
    `
    )
    .join("");

  return `
    <section class="card">
      <h2 class="cardTitle">Document Overview</h2>
      <table class="metaTable">
        <tbody>
          ${cells}
        </tbody>
      </table>
    </section>
  `;
}

function renderSection(section: CharterSection) {
  const title = section.title || "Section";

  const table = normalizeToTable(section);
  const bullets = parseBullets(section.bullets);

  const hasTable = !!table && (table.rows?.length ?? 0) > 0;
  const hasBullets = bullets.length > 0;

  let body = "";

  if (hasTable) {
    const cols = Math.max(1, table!.columns || 1);

    const rowsHtml = (table!.rows ?? [])
      .map((r) => {
        const cells = pad(r.cells ?? [], cols)
          .map((c) => `<td>${escapeHtml(c)}</td>`)
          .join("");

        if (r.type === "header") {
          const heads = pad(r.cells ?? [], cols)
            .map((c) => `<th>${escapeHtml(c)}</th>`)
            .join("");
          return `<tr class="thead">${heads}</tr>`;
        }

        return `<tr>${cells}</tr>`;
      })
      .join("");

    body += `
      <table class="gridTable">
        <tbody>
          ${rowsHtml}
        </tbody>
      </table>
    `;
  } else if (hasBullets) {
    body += `
      <ul class="bullets">
        ${bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
      </ul>
    `;
  } else {
    body += `<div class="empty">—</div>`;
  }

  return `
    <section class="section">
      <div class="sectionHeader">
        <h3>${escapeHtml(title)}</h3>
      </div>
      <div class="sectionBody">
        ${body}
      </div>
    </section>
  `;
}

function headerTemplateHtml(brand: PdfBrand, title: string) {
  const logo = brand.logoDataUri
    ? `<img src="${escapeHtml(brand.logoDataUri)}" style="height:22px; margin-right:10px; object-fit:contain;" />`
    : "";

  return `
  <div style="width:100%; font-size:10px; padding:0 10px; color:#111827;">
    <div style="display:flex; align-items:center; justify-content:space-between; width:100%;">
      <div style="display:flex; align-items:center;">
        ${logo}
        <div>
          <div style="font-weight:700;">${escapeHtml(brand.clientName || "Client")}</div>
          <div style="color:#6B7280;">${escapeHtml(title || "Project Charter")}</div>
        </div>
      </div>
      <div style="font-weight:700; color:${escapeHtml(brand.brandColor)};">
        ${escapeHtml(brand.productName || "AlienAI")}
      </div>
    </div>
    <div style="height:3px; background:${escapeHtml(brand.brandColor)}; margin-top:6px;"></div>
  </div>
  `;
}

function footerTemplateHtml(brand: PdfBrand, subtitle: string) {
  return `
  <div style="width:100%; font-size:9px; padding:0 10px; color:#6B7280;">
    <div style="display:flex; justify-content:space-between; align-items:center; width:100%;">
      <div>${escapeHtml(subtitle || "")}</div>
      <div>
        <span>Confidential</span>
        <span style="margin-left:10px;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
      </div>
    </div>
  </div>
  `;
}

export function renderProjectCharterHtml(args: { brand: PdfBrand; charter: CharterData }) {
  const brand: PdfBrand = {
    clientName: args.brand?.clientName || "Client",
    brandColor: safeHexColor(args.brand?.brandColor, "#E60000"),
    productName: args.brand?.productName || "AlienAI",
    logoDataUri: args.brand?.logoDataUri ?? null,
  };

  const charter = args.charter;

  // ✅ v2-only: raw must contain { meta, sections }
  const raw = charter?.raw ?? {};
  const v2: CharterDataV2 = {
    meta: raw?.meta ?? {},
    sections: Array.isArray(raw?.sections) ? raw.sections : [],
  };

  const meta: CharterMeta = {
    ...(v2.meta ?? {}),
    project_title: (v2.meta?.project_title || charter.projectTitle || "").trim(),
  };

  // ✅ force the 13 required sections, and ignore any others for PDF stability
  const sections = ensureRequiredSections(v2.sections);

  const docTitle = charter.projectTitle || meta.project_title || "Project Charter";
  const status = String(charter.status ?? "draft").toLowerCase();
  const watermarkText =
    status === "approved"
      ? ""
      : status === "submitted"
      ? "SUBMITTED"
      : status === "changes_requested"
      ? "CHANGES REQUESTED"
      : status === "rejected"
      ? "REJECTED"
      : "DRAFT";

  const subtitle = `${brand.clientName} | ${docTitle} ${brand.productName} PDF Export`;

  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(docTitle)}</title>
  <style>
    @page { size: A4; margin: 0; }
    html, body { margin:0; padding:0; background:#ffffff; font-family: Arial, Helvetica, sans-serif; color:#111827; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    .watermark {
      position: fixed;
      inset: 0;
      display: ${watermarkText ? "block" : "none"};
      pointer-events: none;
      z-index: 0;
    }
    .watermark span{
      position: absolute;
      top: 42%;
      left: 50%;
      transform: translate(-50%,-50%) rotate(-32deg);
      font-size: 64px;
      font-weight: 800;
      color: rgba(156,163,175,0.18);
      letter-spacing: 2px;
      white-space: nowrap;
    }

    .page {
      position: relative;
      z-index: 1;
      padding: 96px 36px 72px 36px;
    }

    .coverTitle {
      font-size: 26px;
      font-weight: 800;
      margin: 0 0 8px 0;
    }
    .coverSub {
      font-size: 12px;
      color:#6B7280;
      margin: 0 0 18px 0;
    }

    .card {
      background: #F3F4F6;
      border-radius: 14px;
      padding: 14px 14px;
      margin-bottom: 16px;
    }
    .cardTitle {
      margin: 0 0 10px 0;
      font-size: 13px;
      font-weight: 800;
      color:#111827;
    }
    .metaTable {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .metaTable th {
      width: 34%;
      text-align: left;
      color: #6B7280;
      font-weight: 700;
      padding: 6px 8px;
      vertical-align: top;
    }
    .metaTable td {
      color: #111827;
      padding: 6px 8px;
      vertical-align: top;
    }

    .section {
      margin: 0 0 16px 0;
      break-inside: avoid;
    }
    .sectionHeader {
      border-bottom: 1px solid #D1D5DB;
      margin-bottom: 8px;
      padding-bottom: 6px;
    }
    .sectionHeader h3{
      margin:0;
      font-size: 13px;
      font-weight: 800;
      color: #111827;
    }
    .sectionBody { font-size: 11px; color:#111827; }

    .bullets { margin: 6px 0 0 18px; padding: 0; }
    .bullets li { margin: 4px 0; }

    .gridTable {
      width: 100%;
      border-collapse: collapse;
      font-size: 10.5px;
      margin-top: 6px;
    }
    .gridTable th, .gridTable td {
      border: 1px solid #D1D5DB;
      padding: 6px 6px;
      vertical-align: top;
      word-break: break-word;
    }
    .gridTable tr.thead th {
      background: #E5E7EB;
      font-weight: 800;
      color: #111827;
    }

    .empty { color:#6B7280; font-style: italic; padding-top: 4px; }
    .muted { color:#6B7280; }
  </style>
</head>
<body>
  <div class="watermark"><span>${escapeHtml(watermarkText)}</span></div>

  <div class="page">
    <h1 class="coverTitle">Project Charter</h1>
    <p class="coverSub">${escapeHtml(docTitle)}</p>

    ${renderMetaTable(meta, charter.projectTitle)}

    ${sections.map(renderSection).join("")}
  </div>
</body>
</html>`;

  const headerTemplate = headerTemplateHtml(brand, docTitle);
  const footerTemplate = footerTemplateHtml(brand, subtitle);

  return { html, headerTemplate, footerTemplate };
}
