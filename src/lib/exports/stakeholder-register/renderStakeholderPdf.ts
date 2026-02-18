import "server-only";

import { htmlToPdfBuffer } from "@/lib/exports/pdf-utils";

/**
 * Pure renderer: HTML -> PDF Buffer
 * (No DB calls, no loaders.)
 *
 * Stakeholder Register must be LANDSCAPE so the rightmost columns (e.g. Channels)
 * are not clipped.
 */
export async function renderStakeholderRegisterPdf(html: string): Promise<Buffer> {
  if (!html || typeof html !== "string") {
    throw new Error("renderStakeholderRegisterPdf: missing html");
  }

  // ? Force wide (yesterday look)
  // A4 landscape = 297mm wide. Give chromium a wide viewport too.
  return htmlToPdfBuffer(html, {
    format: "A4",
    landscape: true,
    margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" },
    viewport: { width: 1900, height: 1200, deviceScaleFactor: 2 },
  });
}
