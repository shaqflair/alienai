import "server-only";

import puppeteer from "puppeteer";
import puppeteerCore from "puppeteer-core";
import chromium from "@sparticuz/chromium";

/**
 * Minimal, reliable RAID PDF export to unblock build.
 * Features a tolerant data parser and a professional HTML template.
 */

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function escapeHtml(str: any) {
  return safeStr(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function asArray(v: any): any[] {
  return Array.isArray(v) ? v : [];
}

function pickRaidLists(contentJson: any) {
  const raw = contentJson && typeof contentJson === "object" ? contentJson : {};
  const items = asArray(raw.items) || asArray(raw.raid_items) || asArray(raw.rows) || asArray(raw.log) || [];

  const risks = asArray(raw.risks);
  const issues = asArray(raw.issues);
  const assumptions = asArray(raw.assumptions);
  const dependencies = asArray(raw.dependencies);

  if (items.length && (!risks.length && !issues.length && !assumptions.length && !dependencies.length)) {
    const byType = (t: string) =>
      items.filter((x) => safeStr(x?.type ?? x?.item_type ?? x?.kind).toLowerCase() === t);
    return {
      risks: byType("risk"),
      issues: byType("issue"),
      assumptions: byType("assumption"),
      dependencies: byType("dependency"),
      all: items,
    };
  }

  return { risks, issues, assumptions, dependencies, all: items };
}

function renderRaidHtml(args: { title: string; contentJson: any }) {
  const title = safeStr(args.title || "RAID Log");
  const { risks, issues, assumptions, dependencies, all } = pickRaidLists(args.contentJson);

  const section = (name: string, rows: any[]) => {
    return `
      <h2>${escapeHtml(name)} <span class="count">(${rows.length})</span></h2>
      ${rows.length ? table(rows) : `<div class="empty">No items</div>`}
    `;
  };

  const table = (rows: any[]) => {
    return `
      <table>
        <thead>
          <tr>
            <th style="width:12%">Ref</th>
            <th style="width:26%">Title</th>
            <th style="width:12%">Status</th>
            <th style="width:12%">Owner</th>
            <th style="width:12%">Due</th>
            <th style="width:26%">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((r) => {
              const ref = r?.ref ?? r?.public_id ?? r?.human_id ?? r?.code ?? r?.id ?? "";
              const title = r?.title ?? r?.name ?? r?.summary ?? "Untitled";
              const status = r?.status ?? r?.state ?? r?.delivery_status ?? "";
              const owner = r?.owner_label ?? r?.owner ?? r?.assignee_label ?? "";
              const due = r?.due_date ?? r?.due ?? r?.target_date ?? "";
              const notes = r?.notes ?? r?.description ?? r?.impact ?? "";
              return `
                <tr>
                  <td class="mono">${escapeHtml(ref)}</td>
                  <td>${escapeHtml(title)}</td>
                  <td>${escapeHtml(status)}</td>
                  <td>${escapeHtml(owner)}</td>
                  <td>${escapeHtml(due)}</td>
                  <td>${escapeHtml(notes)}</td>
                </tr>
              `;
            }).join("")}
        </tbody>
      </table>
    `;
  };

  return `
  <!doctype html>
  <html>
    <head>
      <meta charset="utf-8" />
      <style>
        :root{ --bg:#ffffff; --text:#0f172a; --muted:#475569; --border:#e2e8f0; --surface:#f8fafc; }
        body{ margin:0; background:var(--bg); color:var(--text); font-family: "Segoe UI", sans-serif; }
        .page{ padding:28px 32px; }
        h1{ margin:0 0 6px 0; font-size:22px; }
        .sub{ color:var(--muted); font-size:12px; margin-bottom:18px; }
        h2{ font-size:14px; margin:18px 0 8px 0; padding-top:12px; border-top:1px solid var(--border); }
        .count{ color:var(--muted); font-weight:400; }
        table{ width:100%; border-collapse:collapse; border:1px solid var(--border); border-radius:8px; overflow:hidden; }
        thead th{ background:var(--surface); text-align:left; font-size:11px; padding:10px; border-bottom:1px solid var(--border); color:var(--muted); }
        tbody td{ font-size:11px; padding:9px 10px; border-bottom:1px solid #f1f5f9; vertical-align:top; }
        .mono{ font-family: monospace; }
        .empty{ padding:10px; border:1px dashed var(--border); border-radius:8px; color:var(--muted); font-size:11px; }
      </style>
    </head>
    <body>
      <div class="page">
        <h1>${escapeHtml(title)}</h1>
        <div class="sub">Generated (UTC): ${new Date().toISOString()}</div>
        ${(risks.length || issues.length || assumptions.length || dependencies.length)
            ? section("Risks", risks) + section("Issues", issues) + section("Assumptions", assumptions) + section("Dependencies", dependencies)
            : section("Items", all)
        }
      </div>
    </body>
  </html>
  `;
}

export type ExportRaidPdfArgs = {
  title?: string;
  contentJson: any;
  landscape?: boolean;
};

export async function exportRaidPdf(args: ExportRaidPdfArgs): Promise<Buffer> {
  const title = safeStr(args.title || "RAID Log");
  const html = renderRaidHtml({ title, contentJson: args.contentJson });

  const isServerless = !!process.env.VERCEL || !!process.env.AWS_REGION;
  const browser = isServerless
    ? await puppeteerCore.launch({
        args: chromium.args,
        executablePath: await chromium.executablePath(),
        headless: chromium.headless,
      })
    : await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle2" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      landscape: !!args.landscape,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}

