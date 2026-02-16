import ExcelJS from "exceljs";
import type { RenderWbsXlsxArgs } from "./types";
import {
  formatDateUK,
  formatDateTimeUK,
  normalizeEffort,
  effortLabel,
  effortColor,
  statusLabel,
  statusColor,
  safeStr,
} from "./utils";

/* ==========================================================================
   Constants & Design System (unchanged)
========================================================================== */

const THEME = {
  primary: "FF2563EB",
  secondary: "FF7C3AED",
  success: "FF10B981",
  warning: "FFF59E0B",
  danger: "FFEF4444",
  info: "FF3B82F6",
  neutral: {
    50: "FFF9FAFB",
    100: "FFF3F4F6",
    200: "FFE5E7EB",
    300: "FFD1D5DB",
    400: "FF9CA3AF",
    500: "FF6B7280",
    600: "FF4B5563",
    700: "FF374151",
    800: "FF1F2937",
    900: "FF111827",
  },
};

const COLUMN_WIDTHS = {
  code: 12,
  level: 8,
  deliverable: 40,
  status: 14,
  effort: 14,
  dueDate: 14,
  owner: 20,
  predecessor: 16,
  tags: 24,
  description: 45,
  acceptance: 45,
};

/* ==========================================================================
   Tree connector helpers (FIX: "connector just as before")
========================================================================== */

function clampLevel(x: any): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(50, Math.floor(n)));
}

/**
 * Determine whether the row at idx is the "last sibling" at its level.
 * We scan forward until we hit a row with level <= current level.
 * - if we hit same level => not last
 * - if we hit lower level or end => last
 */
function isLastSibling(rows: any[], idx: number): boolean {
  const curLevel = clampLevel(rows[idx]?.level);
  for (let j = idx + 1; j < rows.length; j++) {
    const nextLevel = clampLevel(rows[j]?.level);
    if (nextLevel < curLevel) return true;
    if (nextLevel === curLevel) return false;
    // if nextLevel > curLevel, keep scanning (we're inside children)
  }
  return true;
}

/**
 * Render deliverable with connector:
 * level 0 => "Title"
 * level 1 => "├ Title" or "└ Title"
 * level 2 => "  ├ Title" etc.
 *
 * Note: We keep it simple (no vertical '│' lines), matching your "└" style,
 * but now correctly uses ├ vs └.
 */
function formatDeliverableWithConnector(rows: any[], idx: number): string {
  const row = rows[idx];
  const lvl = clampLevel(row?.level);
  const title =
    safeStr(row?.deliverable) ||
    safeStr(row?.name) ||
    safeStr(row?.title) ||
    safeStr(row?.summary) ||
    "Untitled";

  if (lvl <= 0) return title;

  const last = isLastSibling(rows, idx);
  const connector = last ? "└ " : "├ ";
  const pad = "  ".repeat(Math.max(0, lvl - 1));
  return `${pad}${connector}${title}`;
}

class WBSWorkbookBuilder {
  private workbook: ExcelJS.Workbook;
  private metadata: { project: any; artifact: any; exportDate: Date };

  constructor(project: any, artifact: any) {
    this.workbook = new ExcelJS.Workbook();
    this.metadata = { project, artifact, exportDate: new Date() };
    this.setupWorkbookProperties();
  }

  private setupWorkbookProperties() {
    const { project, exportDate } = this.metadata;
    this.workbook.creator = "Aliena AI";
    this.workbook.created = exportDate;
    this.workbook.modified = exportDate;
    this.workbook.properties = {
      title: `WBS Export - ${project.code}`,
      subject: "Work Breakdown Structure",
      keywords: "WBS, Project Management, Work Breakdown Structure",
      category: "Project Management",
      description: `WBS export for ${project.title}`,
    };
  }

  async build(rows: any[]): Promise<Buffer> {
    const metrics = this.calculateMetrics(rows);
    this.addSummarySheet(metrics);
    this.addWBSSheet(rows);
    this.addMetadataSheet();
    return Buffer.from(await this.workbook.xlsx.writeBuffer());
  }

  private calculateMetrics(rows: any[]) {
    const total = rows.length;
    const byStatus: Record<string, number> = {};
    const byEffort: Record<string, number> = { S: 0, M: 0, L: 0, "": 0 };
    let missingDates = 0;
    let missingEffort = 0;
    let missingOwner = 0;

    rows.forEach((row) => {
      const st = statusLabel(row?.status);
      byStatus[st] = (byStatus[st] || 0) + 1;

      const e = normalizeEffort(row?.effort);
      byEffort[e]++;
      if (!e) missingEffort++;

      if (!row?.due_date) missingDates++;
      if (!row?.owner) missingOwner++;
    });

    return {
      total,
      byStatus,
      byEffort,
      missingDates,
      missingEffort,
      missingOwner,
      completionRate: total > 0 ? Math.round(((byStatus["Complete"] || 0) / total) * 100) : 0,
    };
  }

  private addSummarySheet(metrics: any) {
    const { project, artifact, exportDate } = this.metadata;
    const sheet = this.workbook.addWorksheet("Summary");

    sheet.mergeCells("A1:E1");
    const titleCell = sheet.getCell("A1");
    titleCell.value = "Work Breakdown Structure";
    titleCell.font = { size: 18, bold: true, color: { argb: THEME.neutral[900] } };
    titleCell.alignment = { vertical: "middle" };
    sheet.getRow(1).height = 30;

    let currentRow = 3;

    const addSection = (label: string, value: string, isCode = false) => {
      const labelCell = sheet.getCell(currentRow, 1);
      const valueCell = sheet.getCell(currentRow, 2);

      labelCell.value = label;
      labelCell.font = { bold: true, color: { argb: THEME.neutral[600] } };

      valueCell.value = value;
      if (isCode) valueCell.font = { bold: true, color: { argb: THEME.primary }, name: "Calibri" };
      currentRow++;
    };

    addSection("Project Code", project.code, true);
    addSection("Project Title", project.title);
    if (project.orgName) addSection("Organisation", project.orgName);
    if (project.client) addSection("Client", project.client);
    addSection("Artifact", artifact.title);
    addSection("Exported", formatDateTimeUK(exportDate));

    currentRow += 2;

    sheet.getCell(currentRow, 1).value = "Key Metrics";
    sheet.getCell(currentRow, 1).font = { bold: true, size: 12, color: { argb: THEME.neutral[800] } };
    currentRow++;

    const metricsData = [
      { label: "Total Work Packages", value: metrics.total, color: THEME.primary },
      { label: "Completion Rate", value: `${metrics.completionRate}%`, color: THEME.success },
      {
        label: "Missing Effort",
        value: metrics.missingEffort,
        color: metrics.missingEffort > 0 ? THEME.warning : THEME.success,
      },
      {
        label: "Missing Dates",
        value: metrics.missingDates,
        color: metrics.missingDates > 0 ? THEME.warning : THEME.success,
      },
    ];

    metricsData.forEach((m, idx) => {
      const row = currentRow + Math.floor(idx / 2);
      const col = (idx % 2) * 3 + 1;

      sheet.mergeCells(row, col, row, col + 1);
      const cell = sheet.getCell(row, col);
      cell.value = `${m.label}\n${m.value}`;
      cell.alignment = { horizontal: "center", vertical: "center", wrapText: true };
      cell.font = { bold: true, size: 11 };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `${m.color}20` } };
      cell.border = { outline: { style: "thin", color: { argb: `${m.color}60` } } };
    });

    currentRow += 3;

    sheet.getCell(currentRow, 1).value = "Status Breakdown";
    sheet.getCell(currentRow, 1).font = { bold: true, size: 12 };
    currentRow++;

    Object.entries(metrics.byStatus).forEach(([status, count]) => {
      sheet.getCell(currentRow, 1).value = status;
      sheet.getCell(currentRow, 2).value = count;
      sheet.getCell(currentRow, 2).font = { bold: true };
      sheet.getCell(currentRow, 2).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: `${statusColor(status, THEME)}20` },
      };
      currentRow++;
    });

    sheet.getColumn(1).width = 20;
    sheet.getColumn(2).width = 40;
    sheet.getColumn(3).width = 15;
  }

  private addWBSSheet(rows: any[]) {
    const sheet = this.workbook.addWorksheet("WBS", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 2 }],
    });

    sheet.columns = [
      { key: "code", header: "WBS Code", width: COLUMN_WIDTHS.code },
      { key: "level", header: "Lvl", width: COLUMN_WIDTHS.level },
      { key: "deliverable", header: "Deliverable / Work Package", width: COLUMN_WIDTHS.deliverable },
      { key: "status", header: "Status", width: COLUMN_WIDTHS.status },
      { key: "effort", header: "Effort", width: COLUMN_WIDTHS.effort },
      { key: "due_date", header: "Due Date", width: COLUMN_WIDTHS.dueDate },
      { key: "owner", header: "Assigned To", width: COLUMN_WIDTHS.owner },
      { key: "predecessor", header: "Predecessor", width: COLUMN_WIDTHS.predecessor },
      { key: "tags", header: "Tags", width: COLUMN_WIDTHS.tags },
      { key: "description", header: "Description", width: COLUMN_WIDTHS.description },
      { key: "acceptance_criteria", header: "Acceptance Criteria", width: COLUMN_WIDTHS.acceptance },
    ];

    const headerRow = sheet.getRow(1);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: THEME.neutral[800] } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.border = { bottom: { style: "thin", color: { argb: THEME.neutral[600] } } };
    });

    rows.forEach((row, idx) => {
      const level = clampLevel(row?.level);
      const effort = normalizeEffort(row?.effort);
      const status = statusLabel(row?.status);

      const tags = Array.isArray(row?.tags)
        ? row.tags.map((t: any) => safeStr(t)).filter(Boolean).join(", ")
        : safeStr(row?.tags || "");

      const dueDate = row?.due_date ? formatDateUK(row.due_date) : "";

      const deliverableWithConnector = formatDeliverableWithConnector(rows, idx);

      const excelRow = sheet.addRow({
        code: safeStr(row?.code || ""),
        level,
        deliverable: deliverableWithConnector,
        status,
        effort: effortLabel(effort),
        due_date: dueDate,
        owner: safeStr(row?.owner || ""),
        predecessor: safeStr(row?.predecessor || ""),
        tags,
        description: safeStr(row?.description || ""),
        acceptance_criteria: safeStr(row?.acceptance_criteria || ""),
      });

      const isEven = idx % 2 === 0;
      excelRow.alignment = { vertical: "top", wrapText: true };
      if (!isEven) excelRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: THEME.neutral[50] } };

      const statusCell = excelRow.getCell("status");
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `${statusColor(status, THEME)}15` } };
      statusCell.font = { color: { argb: statusColor(status, THEME) }, bold: true };
      statusCell.border = { outline: { style: "thin", color: { argb: `${statusColor(status, THEME)}40` } } };

      if (effort) {
        const effortCell = excelRow.getCell("effort");
        effortCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `${effortColor(effort, THEME)}15` } };
        effortCell.font = { color: { argb: effortColor(effort, THEME) } };
      }

      if (level === 0) excelRow.getCell("deliverable").font = { bold: true };
    });

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: sheet.columnCount },
    };
  }

  private addMetadataSheet() {
    const { project, artifact, exportDate } = this.metadata;
    const sheet = this.workbook.addWorksheet("Document Info");

    sheet.columns = [
      { key: "field", width: 25 },
      { key: "value", width: 60 },
    ];

    const data = [
      { field: "Document Type", value: "Work Breakdown Structure (WBS)" },
      { field: "Project Code", value: project.code },
      { field: "Project Name", value: project.title },
      { field: "Organisation", value: project.orgName || "—" },
      { field: "Client", value: project.client || "—" },
      { field: "Artifact Name", value: artifact.title },
      { field: "Artifact Type", value: safeStr(artifact.type || "").toUpperCase() },
      { field: "Export Date", value: formatDateTimeUK(exportDate) },
      { field: "Last Updated", value: formatDateTimeUK(artifact.updatedAt) },
      { field: "Exported By", value: "Aliena AI Platform" },
    ];

    data.forEach((item, idx) => {
      const row = sheet.addRow(item);
      row.getCell(1).font = { bold: true, color: { argb: THEME.neutral[600] } };
      row.getCell(2).font = { color: { argb: THEME.neutral[800] } };

      if (idx === 0) {
        row.getCell(1).font = { bold: true, size: 12 };
        row.getCell(2).font = { bold: true, size: 12, color: { argb: THEME.primary } };
      }
    });
  }
}

export async function renderWbsXlsx(args: RenderWbsXlsxArgs): Promise<Buffer> {
  const builder = new WBSWorkbookBuilder(args.project, args.artifact);
  return builder.build(args.rows);
}
