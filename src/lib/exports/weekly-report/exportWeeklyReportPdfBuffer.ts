// src/lib/exports/weekly-report/exportWeeklyReportPdfBuffer.ts
import "server-only";

import { htmlToPdfBuffer } from "@/lib/exports/_shared/puppeteer";
import { sanitizeFilename, safeStr } from "@/lib/exports/_shared/utils";

import { renderWeeklyReportHtml } from "./renderWeeklyReportHtml";
import type { WeeklyReportV1 } from "./types";

export async function exportWeeklyReportPdfBuffer(args: {
  model: WeeklyReportV1;
  projectName: string;
  projectCode: string;
  clientName?: string;
  orgName?: string;
}) {
  const { model } = args;

  const html = renderWeeklyReportHtml(args);

  const projCode = safeStr(args.projectCode).trim();
  const from = safeStr(model?.period?.from).trim();
  const to = safeStr(model?.period?.to).trim();

  const filename = sanitizeFilename(
    `Weekly_Report-${projCode || "Project"}-${from || "from"}_to_${to || "to"}.pdf`,
    "Weekly_Report.pdf"
  );

  const buffer = await htmlToPdfBuffer({
    html,
    waitUntil: "networkidle2",
    emulateScreen: true,
    forceA4PageSize: true,
    pdf: {
      printBackground: true,
      margin: { top: "12mm", right: "12mm", bottom: "12mm", left: "12mm" },
    },
  });

  return { filename, buffer };
}
