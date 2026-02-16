import "server-only";

import { htmlToPdfBuffer } from "../_shared/puppeteer";
import { loadChangeExportData } from "./load";
import * as HtmlMod from "./changeRequestHtml";

function safeStr(x: any) {
  if (typeof x === "string") return x.trim();
  if (x == null) return "";
  return String(x).trim();
}

function sanitizeFilename(name: string) {
  return (
    safeStr(name)
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "change"
  );
}

function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

export async function exportChangeRequestPdfBuffer(changeId: string) {
  if (!safeStr(changeId)) {
    const e = new Error("Missing change id");
    (e as any).status = 400;
    throw e;
  }

  const { cr, attachments, branding, project } = await loadChangeExportData(changeId);

  const ref = safeStr(
    cr.public_id || cr.human_id || cr.reference || (cr.id ? String(cr.id).slice(0, 8) : "CR")
  );
  const projectCode = safeStr(branding?.projectCode || (project as any)?.project_code || "");
  const projectTitle = safeStr(branding?.projectTitle || (project as any)?.title || "Project");

  const orgName = safeStr(branding?.orgName || "—");
  const clientName = safeStr(branding?.clientName || (project as any)?.client_name || "—");
  const generated = formatUkDateTime();

  const renderFn = (HtmlMod as any).renderChangeRequestHtml || (HtmlMod as any).default;

  if (typeof renderFn !== "function") {
    const e = new Error("CR HTML renderer not found (renderChangeRequestHtml)");
    (e as any).status = 500;
    (e as any).details = { exports: Object.keys(HtmlMod || {}) };
    throw e;
  }

  const html = renderFn({
    cr,
    attachments,
    orgName,
    clientName,
    logoUrl: branding?.logoUrl || null,
    projectCode,
    projectTitle,
    generatedValue: generated,
  });

  const safeProjectCode = sanitizeFilename(projectCode || "project");
  const safeRef = sanitizeFilename(ref || "CR");
  const filename = `${safeProjectCode}_CR_${safeRef}.pdf`;

  // ✅ FOOTER: page numbers only (no date, no CR id, no project code)
  const footerTemplate = `
    <div style="
      width: 100%;
      padding: 0 14mm;
      box-sizing: border-box;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, 'Noto Sans', 'Liberation Sans', sans-serif;
      font-size: 8pt;
      color: #64748b;
      text-align: center;
    ">
      Page <span class="pageNumber"></span> of <span class="totalPages"></span>
    </div>`;

  const buffer = await htmlToPdfBuffer({
    html,
    waitUntil: "networkidle2",

    // keep your “UI-faithful” defaults from the shared helper:
    emulateScreen: true,
    forceA4PageSize: true,

    pdf: {
      // A4 portrait
      landscape: false,
      printBackground: true,

      // Header/footer
      displayHeaderFooter: true,
      headerTemplate: `<div></div>`,
      footerTemplate,

      // Your margins
      margin: { top: "12mm", right: "14mm", bottom: "16mm", left: "14mm" },

      // Keep this (works fine with forced @page sizing)
      preferCSSPageSize: true,
    },
  });

  return { buffer, filename };
}
