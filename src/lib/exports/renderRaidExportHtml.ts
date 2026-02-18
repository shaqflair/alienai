import "server-only";

type RaidItem = {
  public_id: string;
  type: string;
  status: string;
  priority: string;
  probability: number | null;
  severity: number | null;
  impact: string;
  owner_label: string;
  title: string;
  description: string;
  response_plan: string;
  next_steps: string;
  notes: string;
  ai_rollup: string;
  due_date: any;
  updated_at: any;
};

type Meta = {
  projectName: string;
  projectCode: string;
  clientName: string;
  organisationName: string;
  generated: string;
  brand: string;
  logoUrl: string;
  watermarkText: string;
  locale?: string;
  dateFormat?: string;
};

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function escHtml(s: any) {
  const t = safeStr(s);
  return t
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function asNum(x: any) {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}
function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}
function score(prob: any, sev: any) {
  const p = clamp(asNum(prob), 0, 100);
  const s = clamp(asNum(sev), 0, 100);
  return Math.round((p * s) / 100);
}

function fmtGBDate(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB");
}

function groupBy<T>(arr: T[], keyFn: (x: T) => string) {
  const out: Record<string, T[]> = {};
  for (const x of arr) {
    const k = keyFn(x) || "Other";
    (out[k] ||= []).push(x);
  }
  return out;
}

export function renderRaidExportHtml({
  items,
  meta,
}: {
  items: RaidItem[];
  meta: Meta;
}) {
  const list = (items ?? []).map((it) => ({
    ...it,
    sc: score(it.probability, it.severity),
    type: safeStr(it.type).trim() || "Risk",
    status: safeStr(it.status).trim() || "Open",
    priority: safeStr(it.priority).trim(),
    owner_label: safeStr(it.owner_label).trim(),
    title: safeStr(it.title).trim(),
    description: safeStr(it.description).trim(),
  }));

  // KPIs
  const total = list.length;
  const openish = new Set(["open", "in progress", "in_progress", "inprogress"]);
  const openCount = list.filter((x) => openish.has(safeStr(x.status).toLowerCase())).length;
  const closedCount = list.filter((x) => safeStr(x.status).toLowerCase() === "closed").length;
  const highExposure = list.filter((x) => x.sc >= 61 && safeStr(x.status).toLowerCase() !== "closed").length;

  const dueSoon = list.filter((x) => {
    if (!x.due_date) return false;
    const d = new Date(x.due_date);
    if (Number.isNaN(d.getTime())) return false;
    const now = new Date();
    const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= 14 && safeStr(x.status).toLowerCase() !== "closed";
  }).length;

  const byType = groupBy(list, (x) => x.type);
  const typeOrder = ["Risk", "Issue", "Assumption", "Dependency"];
  const orderedTypes = Array.from(new Set([...typeOrder, ...Object.keys(byType)]));

  const rowsForType = (type: string) =>
    (byType[type] ?? []).map((it) => {
      const st = safeStr(it.status);
      const pri = safeStr(it.priority);
      const stKey = safeStr(st).toLowerCase().replaceAll(" ", "_");
      const priKey = safeStr(pri).toLowerCase() || "none";
      const sc = it.sc;

      return `
        <tr>
          <td class="mono">${escHtml(it.public_id)}</td>
          <td>${escHtml(it.type)}</td>
          <td><span class="badge badge-status badge-${escHtml(stKey)}">${escHtml(st || " ")}</span></td>
          <td><span class="badge badge-pri badge-${escHtml(priKey)}">${escHtml(pri || " ")}</span></td>
          <td class="center"><span class="score ${sc >= 61 ? "score-high" : sc >= 31 ? "score-med" : "score-low"}">${sc}</span></td>
          <td>${escHtml(it.owner_label || " ")}</td>
          <td>
            ${it.title ? `<div class="title">${escHtml(it.title)}</div>` : ""}
            <div>${escHtml(it.description || " ")}</div>
            ${it.ai_rollup ? `<div class="ai">${escHtml(it.ai_rollup)}</div>` : ""}
          </td>
          <td>${escHtml(it.due_date ? fmtGBDate(it.due_date) : " ")}</td>
          <td>${escHtml(it.updated_at ? fmtGBDate(it.updated_at) : " ")}</td>
        </tr>
      `;
    });

  const sectionsHtml = orderedTypes
    .filter((t) => (byType[t] ?? []).length > 0)
    .map((t) => {
      const count = (byType[t] ?? []).length;
      return `
        <section class="section">
          <div class="section-head">
            <div class="section-title">${escHtml(t)}</div>
            <div class="pill">${count}</div>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th style="width:78px">ID</th>
                <th style="width:68px">Type</th>
                <th style="width:90px">Status</th>
                <th style="width:78px">Priority</th>
                <th style="width:52px" class="center">Score</th>
                <th style="width:120px">Owner</th>
                <th>Description</th>
                <th style="width:82px">Due</th>
                <th style="width:92px">Updated</th>
              </tr>
            </thead>
            <tbody>
              ${rowsForType(t).join("")}
            </tbody>
          </table>
        </section>
      `;
    })
    .join("");

  const watermark = `${(safeStr(meta.clientName || "ALIENA AI").toUpperCase() || "ALIENA AI")}    CONFIDENTIAL`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      --brand: ${escHtml(meta.brand || "#111827")};
      --ink: #0f172a;
      --muted: #475569;
      --line: #e2e8f0;
      --bg: #ffffff;
      --chip: #f1f5f9;
    }
    * { box-sizing: border-box; }
    body { font-family: ui-sans-serif, system-ui, sans-serif; font-size: 12px; line-height: 1.35; margin: 0; padding: 0; background: var(--bg); color: var(--ink); }
    .wm { position: fixed; inset: 0; display:flex; align-items:center; justify-content:center; pointer-events:none; opacity: 0.06; transform: rotate(-24deg); font-weight: 900; letter-spacing: 0.22em; font-size: 42px; z-index: 0; }
    .page { position: relative; z-index: 1; padding: 28px 32px 18px; }
    .cover { padding: 36px 32px 26px; border: 1px solid var(--line); border-radius: 16px; background: #fff; margin-bottom: 16px; }
    .brandbar { height: 10px; border-radius: 999px; background: var(--brand); margin-bottom: 14px; }
    .top { display:flex; align-items:flex-start; justify-content:space-between; gap: 14px; }
    .h1 { font-size: 22px; font-weight: 950; margin:0; }
    .sub { color: var(--muted); margin-top: 6px; }
    .meta { display:flex; gap: 10px; flex-wrap: wrap; margin-top: 10px; color: var(--muted); }
    .tag { background: var(--chip); border: 1px solid var(--line); border-radius: 999px; padding: 4px 10px; font-weight: 800; font-size: 11px; }
    .logo { width: 140px; height: 48px; border: 1px solid var(--line); border-radius: 12px; display:flex; align-items:center; justify-content:center; overflow:hidden; background:#fff; }
    .logo img { width:100%; height:100%; object-fit: contain; }
    .kpis { display:grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-top: 14px; }
    .kpi { border: 1px solid var(--line); border-radius: 14px; padding: 10px 12px; background: #fff; }
    .kpi .label { color: var(--muted); font-weight: 800; font-size: 11px; }
    .kpi .value { font-weight: 950; font-size: 18px; margin-top: 4px; }
    .section { margin-top: 14px; break-inside: avoid; }
    .section-head { display:flex; align-items:center; justify-content:space-between; margin-bottom: 8px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 14px; background: rgba(15, 23, 42, 0.02); }
    .section-title { font-weight: 950; }
    .pill { background: var(--chip); border: 1px solid var(--line); border-radius: 999px; padding: 2px 8px; font-weight: 950; font-size: 11px; }
    table.table { width: 100%; border-collapse: collapse; border: 1px solid var(--line); border-radius: 14px; overflow: hidden; }
    .table thead th { text-align:left; font-size: 11px; font-weight: 950; padding: 8px; background: rgba(15, 23, 42, 0.04); border-bottom: 1px solid var(--line); }
    .table tbody td { padding: 8px; border-bottom: 1px solid #eef2f7; vertical-align: top; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-weight: 900; }
    .center { text-align: center; }
    .badge { display:inline-flex; align-items:center; gap: 6px; border-radius: 999px; padding: 3px 8px; border: 1px solid var(--line); font-weight: 900; font-size: 11px; background: #fff; }
    .badge::before { content:""; width: 8px; height: 8px; border-radius: 999px; background: #94a3b8; }
    .badge-status.badge-open::before { background:#3b82f6; }
    .badge-status.badge-in_progress::before { background:#f59e0b; }
    .badge-status.badge-mitigated::before { background:#10b981; }
    .badge-status.badge-closed::before { background:#64748b; }
    .badge-status.badge-invalid::before { background:#ef4444; }
    .badge-pri.badge-low::before { background:#10b981; }
    .badge-pri.badge-medium::before { background:#f59e0b; }
    .badge-pri.badge-high::before { background:#f97316; }
    .badge-pri.badge-critical::before { background:#ef4444; }
    .score { display:inline-block; min-width: 34px; text-align:center; border-radius: 10px; padding: 3px 7px; border: 1px solid var(--line); font-weight: 950; background:#fff; }
    .score-high { background: rgba(239,68,68,0.10); }
    .score-med { background: rgba(245,158,11,0.10); }
    .score-low { background: rgba(16,185,129,0.10); }
    .title { font-weight: 950; margin-bottom: 2px; }
    .ai { margin-top: 6px; padding: 6px 8px; border: 1px dashed rgba(15,23,42,0.18); border-radius: 12px; background: rgba(15,23,42,0.02); color: rgba(15,23,42,0.75); font-size: 11px; }
  </style>
</head>
<body>
  <div class="wm">${escHtml(watermark)}</div>
  <div class="page">
    <div class="cover">
      <div class="brandbar"></div>
      <div class="top">
        <div style="min-width:0">
          <h1 class="h1">Weekly RAID Export</h1>
          <div class="sub"><strong>${escHtml(meta.projectName)}</strong>${meta.clientName ? ` — ${escHtml(meta.clientName)}` : ""}</div>
          <div class="meta">
            <span class="tag">Code: ${escHtml(meta.projectCode || "—")}</span>
            ${meta.organisationName ? `<span class="tag">${escHtml(meta.organisationName)}</span>` : ""}
            <span class="tag">Generated: ${escHtml(meta.generated || "")}</span>
            ${meta.watermarkText ? `<span class="tag">${escHtml(meta.watermarkText)}</span>` : ""}
            ${closedCount ? `<span class="tag">Closed: ${closedCount}</span>` : ""}
          </div>
        </div>
        ${meta.logoUrl ? `<div class="logo"><img src="${escHtml(meta.logoUrl)}"/></div>` : ""}
      </div>

      <div class="kpis">
        <div class="kpi"><div class="label">Open</div><div class="value">${openCount}</div></div>
        <div class="kpi"><div class="label">High Exposure</div><div class="value">${highExposure}</div></div>
        <div class="kpi"><div class="label">Due Soon (14d)</div><div class="value">${dueSoon}</div></div>
        <div class="kpi"><div class="label">Total</div><div class="value">${total}</div></div>
      </div>
    </div>

    ${sectionsHtml || `<div style="color:#64748b; padding: 10px 2px;">No RAID items found.</div>`}
  </div>
</body>
</html>`;
}
