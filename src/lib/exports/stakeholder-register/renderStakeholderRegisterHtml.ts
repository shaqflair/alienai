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

function norm(x: any) {
  return String(x ?? "").trim();
}

function influenceLabel(v: any) {
  const s = norm(v).toLowerCase();
  if (!s) return "Medium";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return cell(v);
}

function contactInfoToString(ci: any) {
  if (!ci) return "";
  if (typeof ci === "string") return norm(ci);
  if (typeof ci !== "object") return norm(ci);

  const email = norm(ci?.email);
  const phone = norm(ci?.phone);
  const org = norm(ci?.organisation || ci?.organization);
  const notes = norm(ci?.notes);

  const parts = [email, phone, org, notes].filter(Boolean);
  if (parts.length) return parts.join(" | ");

  try {
    const s = JSON.stringify(ci);
    return s.length > 240 ? s.slice(0, 240) + "…" : s;
  } catch {
    return "";
  }
}

/**
 * DB-first render:
 * - name, role, influence_level, expectations, communication_strategy, contact_info
 * Backwards compatible:
 * - stakeholder -> name
 * - impact_notes/stakeholder_impact -> expectations
 * - channels -> communication_strategy
 * - contact -> contact string
 */
function rowView(r: any) {
  const name = norm(r?.name ?? r?.stakeholder);
  const role = norm(r?.role ?? r?.title_role ?? r?.title);
  const influence = r?.influence_level ?? r?.influence;
  const expectations = norm(r?.expectations ?? r?.impact_notes ?? r?.stakeholder_impact ?? r?.notes);
  const comms = norm(r?.communication_strategy ?? r?.communication ?? r?.channels);
  const contact =
    contactInfoToString(r?.contact_info) ||
    norm(r?.contact ?? r?.point_of_contact ?? r?.contact_details ?? r?.email);

  return {
    name: cell(name),
    role: cell(role),
    influence: influenceLabel(influence),
    expectations: cell(expectations),
    comms: cell(comms),
    contact: cell(contact),
  };
}

export function renderStakeholderRegisterHtml(args: {
  meta: StakeholderRegisterMeta;
  rows: StakeholderRegisterRow[];
  logoDataUrl?: string | null;
}) {
  const { meta, rows, logoDataUrl } = args;

  const cols = [
    { key: "name", label: "Name", cls: "name" },
    { key: "role", label: "Role", cls: "role" },
    { key: "influence", label: "Influence", cls: "influence" },
    { key: "expectations", label: "Expectations", cls: "expectations" },
    { key: "comms", label: "Communication Strategy", cls: "comms" },
    { key: "contact", label: "Contact Info", cls: "contact" },
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

    .logoBox{
      width: 44px; height: 44px; border-radius: 12px;
      background: #0b1220;
      display:flex; align-items:center; justify-content:center;
      overflow:hidden;
      border: 1px solid #e7ecf7;
    }
    .logoBox img{ width:100%; height:100%; object-fit:cover; }

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
    .sectionHead .right { font-size: 12px; font-weight:900; color:#64748b; }

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

    .name { width: 150px; font-weight: 900; }
    .role { width: 120px; }
    .influence { width: 90px; }
    .expectations { width: 330px; }
    .comms { width: 330px; }
    .contact { width: 180px; }

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
          .map((raw) => {
            const r = rowView(raw);
            return `
              <tr>
                <td class="name">${esc(cell(r.name))}</td>
                <td class="role">${esc(cell(r.role))}</td>
                <td class="influence"><span class="pillLevel">${esc(cell(r.influence))}</span></td>
                <td class="expectations">${esc(cell(r.expectations))}</td>
                <td class="comms">${esc(cell(r.comms))}</td>
                <td class="contact">${esc(cell(r.contact))}</td>
              </tr>
            `;
          })
          .join("");

  const brandMark = logoDataUrl
    ? `<div class="logoBox"><img alt="logo" src="${esc(logoDataUrl)}" /></div>`
    : `<div class="badge">SR</div>`;

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
      ${brandMark}
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
    <div class="right">Influence / Expectations / Communication</div>
  </div>

  <div class="tableWrap">
    <table>
      <thead>
        <tr>${cols.map((c) => `<th class="${c.cls}">${c.label}</th>`).join("")}</tr>
      </thead>
      <tbody>${tbody}</tbody>
    </table>
  </div>

</div>
</body>
</html>`;
}