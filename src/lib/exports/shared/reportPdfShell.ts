import "server-only";
import { escapeHtml } from "./registerPdfShell";

export type ReportCard = { k: string; v: string; vClass?: string };

export function renderStakeholderStyleReportHtml(args: {
  badgeText: string;
  title: string;
  subtitle: string;
  generatedValue: string;
  cards: ReportCard[];
  sectionsHtml: string;
}) {
  const esc = escapeHtml;

  const css = `
    * { box-sizing: border-box; }

    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
      color: #0b1220;
      background:#fff;
      line-height: 1.5;
      font-size: 12px;
    }

    .page { padding: 26px 26px 20px 26px; }

    .top {
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:16px;
      padding-bottom: 14px;
      border-bottom: 2px solid #e7ecf7;
    }

    .brand { display:flex; gap:14px; }

    .badge {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
      color:#fff;
      display:flex;
      align-items:center;
      justify-content:center;
      font-weight:800;
    }

    .h1 {
      font-size: 24px;
      font-weight: 900;
      margin:0;
      letter-spacing: -0.02em;
    }

    .sub {
      font-size: 12px;
      color:#64748b;
      font-weight:600;
    }

    .gen { text-align:right; }
    .gen .lbl { font-size: 11px; color:#64748b; font-weight:700; }
    .gen .val { font-size: 12px; font-weight:800; }

    .cards {
      margin-top: 14px;
      display:grid;
      grid-template-columns: repeat(5, 1fr);
      gap: 12px;
    }

    .card {
      border: 1px solid #e7ecf7;
      border-radius: 12px;
      background: #fbfdff;
      padding: 10px 12px;
    }

    .card .k {
      font-size: 10px;
      text-transform: uppercase;
      color:#64748b;
      font-weight:800;
    }

    .card .v {
      margin-top: 4px;
      font-size: 13px;
      font-weight: 900;
      word-break: break-word;
    }

    .section {
      margin-top: 18px;
      border: 1px solid #e7ecf7;
      border-radius: 14px;
      overflow: hidden;
      background: #fff;
      page-break-inside: avoid;
    }

    .sectionHead {
      padding: 10px 14px;
      border-bottom: 1px solid #e7ecf7;
      background: #fbfdff;
      font-weight: 900;
    }

    .sectionBody {
      padding: 12px 14px;
      font-size: 12px;
    }

    ul { margin: 8px 0 0 18px; }
    li { margin: 6px 0; }

    table {
      width:100%;
      border-collapse: collapse;
      table-layout: fixed;
    }

    td {
      padding: 8px 10px;
      border-bottom: 1px solid #e7ecf7;
      vertical-align: top;
      font-size: 11px;
    }

    .kvK {
      width: 160px;
      color:#64748b;
      font-weight: 900;
      text-transform: uppercase;
      font-size: 10px;
    }

    .kvV {
      font-weight: 700;
      color: #334155;
    }

    @page {
      size: A4;
      margin: 10mm;
    }
  `;

  const cardsHtml = (args.cards || [])
    .slice(0, 5)
    .map((c) => {
      const safeClass = (c.vClass || "")
        .replace(/[^a-z0-9 _-]/gi, "")
        .trim();

      return `
        <div class="card">
          <div class="k">${esc(c.k)}</div>
          <div class="v ${safeClass}">${esc(c.v || "—")}</div>
        </div>
      `;
    })
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>${css}</style>
</head>
<body>
<div class="page">

  <div class="top">
    <div class="brand">
      <div class="badge">${esc(args.badgeText)}</div>
      <div>
        <div class="h1">${esc(args.title)}</div>
        <div class="sub">${esc(args.subtitle)}</div>
      </div>
    </div>

    <div class="gen">
      <div class="lbl">Generated</div>
      <div class="val">${esc(args.generatedValue)}</div>
    </div>
  </div>

  <div class="cards">${cardsHtml}</div>

  ${args.sectionsHtml}

</div>
</body>
</html>`;
}
