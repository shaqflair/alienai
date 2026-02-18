import "server-only";

import { renderChangeRequestHtml } from "../html/changeRequestHtml";
import { buildChangeRequestXlsx } from "../xlsx/changeRequestXlsx";

import { sanitizeFilename } from "../_shared/utils";
import { fileResponse } from "../_shared/fileResponse";
import { renderHtmlToPdfBuffer } from "../_shared/puppeteer";

import type { ChangeExportData } from "./types";

/**
 * Main entry point for Change Request exports.
 * Orchestrates HTML rendering/PDF generation or XLSX workbook building.
 */
export async function exportChange(format: "pdf" | "xlsx", data: ChangeExportData) {
  const cr = data.cr;
  const ref = String(cr.public_id || cr.human_id || cr.reference || cr.id || "change");
  const title = String(cr.title || cr.change_title || "change_request");
  
  const baseName = `Change_${ref}_${title}`;

  if (format === "pdf") {
    const filename = `${sanitizeFilename(baseName)}.pdf`;
    
    const html = renderChangeRequestHtml({
      cr: data.cr,
      attachments: data.attachments,
      orgName: data.branding.orgName,
      clientName: data.branding.clientName,
      logoUrl: data.branding.logoUrl,
    });

    const pdf = await renderHtmlToPdfBuffer(html, {
      format: "A4",
      printBackground: true,
      margin: { top: "14mm", right: "12mm", bottom: "16mm", left: "12mm" },
    });

    return fileResponse(pdf, filename, "application/pdf");
  }

  if (format === "xlsx") {
    const filename = `${sanitizeFilename(baseName)}.xlsx`;
    const buf = await buildChangeRequestXlsx({ 
      cr: data.cr, 
      attachments: data.attachments 
    });

    return fileResponse(
      Buffer.from(buf), 
      filename, 
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  }

  throw new Error(`Unsupported format: ${format}`);
}
