// src/lib/exports/weekly-report/renderWeeklyReportHtml.ts
import "server-only";

import { safeStr, esc, formatDateUk } from "@/lib/exports/_shared/utils";
import type { WeeklyReportV1 } from "./types";

function ragLabel(rag: string) {
  const r = safeStr(rag).trim().toLowerCase();
  if (r === "red") return { label: "RED", bg: "#FFF1F2", fg: "#9F1239", bd: "#FECDD3" };
  if (r === "amber") return { label: "AMBER", bg: "#FFFBEB", fg: "#92400E", bd: "#FDE68A" };
  return { label: "GREEN", bg: "#ECFDF5", fg: "#065F46", bd: "#A7F3D0" };
}

function bullets(items: Array<{ text: string }> | undefined) {
  const xs = Array.isArray(items) ? items : [];
  if (xs.length === 0) return '<div class="muted">None.</div>';
  return "<ul>" + xs.map((x) => "<li>" + esc(x?.text) + "</li>").join("") + "</ul>";
}

export function renderWeeklyReportHtml(args: {
  model: WeeklyReportV1;
  projectName: string;
  projectCode: string;
  clientName?: string;
  orgName?: string;
}) {
  const model = args.model;

  const projName = safeStr(args.projectName || model.project?.name).trim();
  const projCode = safeStr(args.projectCode || model.project?.code).trim();
  const pmName = safeStr(model.project?.managerName).trim();
  const pmEmail = safeStr(model.project?.managerEmail).trim();
  const orgName = safeStr(args.orgName).trim();

  const fromUk = formatDateUk(model.period.from);
  const toUk = formatDateUk(model.period.to);

  const rag = ragLabel(model.summary.rag);

  const completed = bullets(model.delivered);
  const next = bullets(model.planNextWeek);
  const resource = bullets(model.resourceSummary);

  const decisions =
    (model.keyDecisions ?? []).length > 0
      ? "<ul>" +
        (model.keyDecisions ?? [])
          .map((d) => {
            const text = esc(d.text);
            const link = safeStr(d.link).trim();
            const linkHtml = link ? ' <span class="muted">(' + esc(link) + ")</span>" : "";
            return "<li>" + text + linkHtml + "</li>";
          })
          .join("") +
        "</ul>"
      : '<div class="muted">None.</div>';

  const blockers =
    (model.blockers ?? []).length > 0
      ? "<ul>" +
        (model.blockers ?? [])
          .map((b) => {
            const text = esc(b.text);
            const link = safeStr(b.link).trim();
            const linkHtml = link ? ' <span class="muted">(' + esc(link) + ")</span>" : "";
            return "<li>" + text + linkHtml + "</li>";
          })
          .join("") +
        "</ul>"
      : '<div class="muted">None.</div>';

  const headline = esc(model.summary.headline);
  const narrative = esc(model.summary.narrative).replace(/\n/g, "<br/>");

  // NOTE: using String.join to avoid template-literal parsing issues
  return [
    "<!doctype html>",
    "<html>",
    "<head>",
    '  <meta charset="utf-8"/>',
    '  <meta name="viewport" content="width=device-width, initial-scale=1"/>',
    "  <title>Weekly Report</title>",
    "  <style>",
    "    :root{--ink:#0F172A;--muted:#64748B;--border:#E2E8F0;--accent:#2563EB;--accent2:#020617;}",
    "    *{box-sizing:border-box;}",
    "    body{font-family:ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial;color:var(--ink);margin:0;background:white;}",
    "    .page{padding:24px 28px;}",
    "    .header{border-radius:14px;padding:16px 18px;color:white;background:linear-gradient(90deg,var(--accent) 0%,var(--accent2) 100%);}",
    "    .h-title{font-size:20px;font-weight:800;margin:0 0 6px 0;}",
    "    .h-sub{opacity:.9;font-size:12px;margin:0;}",
    "    .metaGrid{margin-top:14px;display:grid;grid-template-columns:repeat(4,1fr);gap:10px;}",
    "    .meta{border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);border-radius:12px;padding:10px 12px;}",
    "    .meta .k{font-size:10px;letter-spacing:.08em;text-transform:uppercase;opacity:.85}",
    "    .meta .v{font-size:12px;font-weight:650;margin-top:3px;line-height:1.3}",
    "    .ragPill{display:inline-block;padding:6px 10px;border-radius:999px;border:1px solid " +
      rag.bd +
      ";background:" +
      rag.bg +
      ";color:" +
      rag.fg +
      ";font-size:12px;font-weight:800;letter-spacing:.04em;}",
    "    .section{margin-top:16px;border:1px solid var(--border);border-radius:14px;padding:14px 14px;}",
    "    .s-title{font-size:14px;font-weight:800;margin:0 0 10px 0;}",
    "    .muted{color:var(--muted);font-size:12px;}",
    "    .bodyText{font-size:12.5px;line-height:1.55;color:var(--ink);}",
    "    ul{margin:8px 0 0 18px;padding:0;}",
    "    li{margin:6px 0;font-size:12.5px;line-height:1.45;}",
    "    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}",
    "    .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;}",
    "  </style>",
    "</head>",
    "<body>",
    '  <div class="page">',
    '    <div class="header">',
    '      <div class="h-title">Weekly Report</div>',
    '      <div class="h-sub">Period: ' + esc(fromUk) + " to " + esc(toUk) + "</div>",
    '      <div class="metaGrid">',
    '        <div class="meta"><div class="k">Project</div><div class="v">' +
      esc(projName || "—") +
      (projCode ? ' <span style="opacity:.85">(' + esc(projCode) + ")</span>" : "") +
      "</div></div>",
    '        <div class="meta"><div class="k">Project Manager</div><div class="v">' +
      esc(pmName || "—") +
      (pmEmail ? ' <span style="opacity:.85">(' + esc(pmEmail) + ")</span>" : "") +
      "</div></div>",
    '        <div class="meta"><div class="k">Organisation</div><div class="v">' + esc(orgName || "—") + "</div></div>",
    '        <div class="meta"><div class="k">RAG</div><div class="v"><span class="ragPill">RAG: ' +
      rag.label +
      "</span></div></div>",
    "      </div>",
    "    </div>",
    '    <div class="section">',
    '      <div class="s-title">1) Executive Summary</div>',
    '      <div class="bodyText"><b>Headline:</b> ' + (headline || "—") + "</div>",
    '      <div style="height:8px"></div>',
    '      <div class="bodyText"><b>Narrative:</b><br/>' + (narrative || '<span class="muted">—</span>') + "</div>",
    "    </div>",
    '    <div class="grid2">',
    '      <div class="section"><div class="s-title">2) Completed This Period</div>' + completed + "</div>",
    '      <div class="section"><div class="s-title">3) Next Period Focus</div>' + next + "</div>",
    "    </div>",
    '    <div class="grid3">',
    '      <div class="section"><div class="s-title">4) Resource Summary</div>' + resource + "</div>",
    '      <div class="section"><div class="s-title">5) Key Decisions Taken</div>' + decisions + "</div>",
    '      <div class="section"><div class="s-title">6) Operational Blockers</div>' + blockers + "</div>",
    "    </div>",
    "  </div>",
    "</body>",
    "</html>",
  ].join("\n");
}
