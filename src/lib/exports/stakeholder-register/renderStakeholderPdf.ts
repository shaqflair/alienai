import "server-only";

import { htmlToPdfBuffer } from "@/lib/exports/pdf-utils";

/**
 * Pure renderer: HTML -> PDF Buffer
 * Stakeholder Register MUST be landscape to avoid clipping rightmost columns.
 */
export async function renderStakeholderRegisterPdf(html: string): Promise<Buffer> {
  if (!html || typeof html !== "string") {
    throw new Error("renderStakeholderRegisterPdf: missing html");
  }

  return htmlToPdfBuffer(html, {
    format: "A4",
    landscape: true,
    margin: { top: "10mm", right: "10mm", bottom: "10mm", left: "10mm" },
    // Wider viewport helps Chromium layout the table correctly before printing
    viewport: { width: 1900, height: 1200, deviceScaleFactor: 2 },
  });
}
