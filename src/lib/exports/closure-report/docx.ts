// src/lib/exports/closure-report/exportClosureReportDocx.ts
import "server-only";

import { exportClosureReportDocxBuffer } from "./exportClosureReportDocxBuffer";
import { safeStr, sanitizeFilename, pickFirstTruthy, toProjectCode } from "./utils";

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function yyyymmdd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Orchestrator: builds the buffer + filename.
 * Returns { bytes, filename } to match your API route conventions.
 */
export async function exportClosureReportDocx(model: any): Promise<{
  bytes: Buffer;
  filename: string;
  contentType: string;
}> {
  const bytes = await exportClosureReportDocxBuffer(model);


  const meta = (typeof model === "object" && model ? model?.meta : null) || {};
  const projectName = pickFirstTruthy(meta, ["projectName", "title", "name"]) || "Project";
  const projectCode = toProjectCode(pickFirstTruthy(meta, ["projectCode", "project_id", "projectId", "code"]));

  const iso =
    pickFirstTruthy(meta, ["generatedDateIso", "generatedIso", "generatedAt"]) ||
    safeStr(meta?.generatedDateTime || meta?.generatedDateTimeUk || meta?.generatedAt || "");

  const datePart = iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : yyyymmdd(new Date());

  const base =
    projectCode && projectCode !== " "
      ? `Project Closure Report - ${projectCode} - ${projectName} - ${datePart}`
      : `Project Closure Report - ${projectName} - ${datePart}`;

  const filename = `${sanitizeFilename(base)}.docx`;

  return {
    bytes,
    filename,
    contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  };
}
