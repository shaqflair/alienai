import "server-only";

// TODO: create ../html/changeRequestHtml and ../xlsx/changeRequestXlsx modules

import { sanitizeFilename } from "../_shared/utils";
import { fileResponse } from "../_shared/fileResponse";

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
    // TODO: replace stub with renderChangeRequestHtml + htmlToPdfBuffer
    const pdf = Buffer.from("");
    return fileResponse(pdf, filename, "application/pdf");
  }

  if (format === "xlsx") {
    const filename = `${sanitizeFilename(baseName)}.xlsx`;
    // TODO: replace stub with buildChangeRequestXlsx
    const buf = Buffer.from("");
    return fileResponse(
      buf,
      filename,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
  }

  throw new Error(`Unsupported format: ${format}`);
}