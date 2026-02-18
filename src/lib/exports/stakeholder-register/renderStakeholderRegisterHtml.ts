import "server-only";

import type { StakeholderRegisterMeta, StakeholderRegisterRow } from "./types";
import { escapeHtml } from "./stakeholderShared";

function esc(x: any) {
  return escapeHtml(String(x ?? ""));
}

function cell(v: any) {
  const s = String(v ?? "").trim();
  return s ? s : "—";
}

export function renderStakeholderRegisterHtml(args: {
  meta: StakeholderRegisterMeta;
  rows: StakeholderRegisterRow[];
  logoDataUrl?: string | null;
}) {
  const { meta, rows } = args;

  const cols = [
    { key: "stakeholder", label: "Stakeholder", cls: "stakeholder" },
    { key: "contact", label: "Contact", cls: "contact" },
    { key: "title_role", label: "Role", cls: "role" },
    { key: "impact", label: "Impact", cls: "impact" },
    { key: "influence", label: "Influence", cls: "influence" },
    { key: "mapping", label: "Mapping", cls: "mapping" },
    { key: "milestone", label: "Milestone", cls: "milestone" },
    { key: "impact_notes", label: "Impact Notes", cls: "impactNotes" },
    { key: "channels", label: "Channels", cls: "channels" },
  ] as const;

  const css = `
    * { box-sizing: border-box; }
    body { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; color: #0b1220; background:#fff; }
    .page { padding: 28px 28px 22px 28px; }

    .top {
      display:flex; align-items:flex-start; justify-content:space-between; gap:16px;
      padding-bottom: 14px; border-bottom: 2px solid #e7ecf7;
    }

    .brand { display:flex; align-items:flex-start; gap:14px; }
    .badge {
      width: 44px; height: 44px; border-radius: 12px;
      background: linear-gradient(135deg, #2563eb 0%, #7c3aed 100%);
      color:#fff; display:flex; align-items:center; justify-content:center;
      font-weight:800;
    }
    .titles { display:flex; flex-direction:column; gap:4px; }
    .h1 { font-size: 28px; font-weight: 900; margin:0; }
    .sub { font-size: 13px; color:#64748b; font-weight:600; }

    .gen { text-align:right; }
    .gen .lbl { font-size: 12px; color:#64748b; font-weight:700; }
    .gen .val { font-size: 13px; font-weight:800; }

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
      padding: 12px 14px;
    }
    .card .k { font-size: 11px; text-transform: uppercase; color:#64748b; font-weight:800; }
    .card .v { margin-top: 6px; font-size: 14px; font-weight: 900; }
    .code { color:#2563eb; font-family: ui-monospace, monospace; }

    .sectionHead {
      margin-top: 18px;
      display:flex; justify-content:space-between; align-items:flex-end;
    }
    .sectionHead .t { font-size: 18px; font-weight: 900; }
    .sectionHead .n { font-size: 12px; color:#64748b; font-weight:800; }
    .sectionHead .right { font-size: 16px; font-weight:900; color:#64748b; }

    .tableWrap {
      margin-top: 10px;
      border: 1px solid #e7ecf7;
      border-radius: 14px;
      overflow: hidden;
    }

    table { width:100%; border-collapse: collapse; table-layout: fixed; }

    thead th {
      background:#fff;
      color:#2563eb;
      font-size:11px;
      font-weight:900;
      text-transform:uppercase;
      padding: 12px 10px;
      border-bottom: 3px solid #2563eb;
      white-space: nowrap;
    }

    tbody td {
      padding: 12px 10px;
      font-size: 12px;
      border-bottom: 1px solid #e7ecf7;
      vertical-align: top;
      word-break: break-word;
    }
    tbody tr:last-child td { border-bottom:none; }

    .stakeholder { width: 135px; font-weight: 900; }
    .contact { width: 135px; }
    .role { width: 78px; }
    .impact, .influence { width: 70px; }
    .mapping { width: 95px; }
    .milestone { width: 80px; }
    .impactNotes { width: 210px; }
    .channels { width: 80px; }

    .pillLevel{
      display:inline-flex;
      padding: 4px 10px;
      border-radius: 999px;
      border: 1px solid #e7ecf7;
      background: #f7faff;
      font-weight: 900;
      font-size: 11px;
      white-space: nowrap;
    }
  `;

  const tbody =
    rows.length === 0
      ? `<tr><td colspan="${cols.length}">No stakeholders recorded.</td></tr>`
      : rows
          .map((r) => `
            <tr>
              <td class="stakeholder">${esc(cell(r.stakeholder))}</td>
              <td class="contact">${esc(cell(r.contact))}</td>
              <td class="role">${esc(cell(r.title_role))}</td>
              <td class="impact"><span class="pillLevel">${esc(cell(r.impact))}</span></td>
              <td class="influence"><span class="pillLevel">${esc(cell(r.influence))}</span></td>
              <td class="mapping">${esc(cell(r.mapping))}</td>
              <td class="milestone">${esc(cell(r.milestone))}</td>
              <td class="impactNotes">${esc(cell(r.impact_notes))}</td>
              <td class="channels">${esc(cell(r.channels))}</td>
            </tr>
          `)
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
      <div class="badge">SR</div>
      <div class="titles">
        <h1 class="h1">Stakeholder Register</h1>
        <div class="sub">${esc(meta.projectName || "Project")}</div>
      </div>
    </div>

    <div class="gen">
      <div class="lbl">Generated</div>
      <div class="val">${esc(meta.generatedDateTime || meta.generated || "—")}</div>
    </div>
  </div>

  <div class="cards">
    <div class="card"><div class="k">Organisation</div><div class="v">${esc(meta.organisationName || "—")}</div></div>
    <div class="card"><div class="k">Client</div><div class="v">${esc(meta.clientName || "—")}</div></div>
    <div class="card"><div class="k">Project ID</div><div class="v code">${esc(meta.projectCode || "—")}</div></div>
    <div class="card"><div class="k">Total Stakeholders</div><div class="v">${rows.length}</div></div>
    <div class="card"><div class="k">Report Date</div><div class="v">${esc(meta.generatedDate || "—")}</div></div>
  </div>

  <div class="sectionHead">
    <div>
      <span class="t">Register</span>
      <span class="n">${rows.length} records</span>
    </div>
    <div class="right">Influence / Impact / Mapping</div>
  </div>

  <div class="tableWrap">
    <table>
      <thead>
        <tr>${cols.map(c => `<th class="${c.cls}">${c.label}</th>`).join("")}</tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>

</div>
</body>
</html>`;
}
