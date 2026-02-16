// src/lib/exports/schedule/renderScheduleXlsx.ts
import ExcelJS from "exceljs";
import { normalizeSchedule } from "./normalize";
import { addDaysUTC, fmtUkDate, startOfDayUTC, safeStr } from "./utils";

const DAY_MS = 86400000;

function statusLabel(s: string) {
  const v = String(s || "").trim();
  if (!v) return "";
  return v.replace(/_/g, " ");
}

function statusColor(statusRaw: string) {
  const s = String(statusRaw || "").toLowerCase();
  if (s === "done" || s === "completed" || s === "complete" || s === "approved") return "FF2563EB";
  if (s === "delayed" || s === "red") return "FFDC2626";
  if (s === "at_risk" || s === "risk" || s === "amber") return "FFD97706";
  if (s === "on_track" || s === "green") return "FF059669";
  return "FF94A3B8";
}

function typeLabel(t: "task" | "milestone" | "deliverable") {
  if (t === "milestone") return "Milestone";
  if (t === "deliverable") return "Deliverable";
  return "Task";
}

export type RenderScheduleXlsxArgs = {
  title?: string;
  pmName?: string;
  contentJson: any;
  viewStart?: Date | null;
  viewEnd?: Date | null;
  includeMilestonesSheet?: boolean;
};

// ✅ NAMED EXPORT (this is what your route imports)
export async function renderScheduleXlsx(args: RenderScheduleXlsxArgs): Promise<Buffer> {
  const title = safeStr(args.title || "Schedule");
  const pmName = safeStr(args.pmName || "").trim();

  const { phases, items: allItems } = normalizeSchedule(args.contentJson);

  // filter window (inclusive)
  let items = allItems;
  if (args.viewStart && args.viewEnd) {
    const s = startOfDayUTC(args.viewStart);
    const e = startOfDayUTC(args.viewEnd);
    const eEx = addDaysUTC(e, 1);
    items = allItems.filter((it) => {
      const a = it.start;
      const b = it.end ?? it.start;
      return b >= s && a < eEx;
    });
  }

  // min/max
  let minDate: Date | null = null;
  let maxDate: Date | null = null;
  for (const it of items) {
    const s = it.start;
    const e = it.end ?? it.start;
    if (!minDate || s < minDate) minDate = s;
    if (!maxDate || e > maxDate) maxDate = e;
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Project Management System";
  wb.created = new Date();

  /* =========================
     Overview
  ========================= */
  const wsOverview = wb.addWorksheet("Overview", { views: [{ showGridLines: false }] });
  wsOverview.columns = [
    { header: "Key", key: "k", width: 26 },
    { header: "Value", key: "v", width: 60 },
  ];

  wsOverview.mergeCells("A1:B1");
  wsOverview.getCell("A1").value = `${title} — Export`;
  wsOverview.getCell("A1").font = { name: "Segoe UI", size: 18, bold: true, color: { argb: "FF0F172A" } };
  wsOverview.getCell("A1").alignment = { vertical: "middle", horizontal: "left" };
  wsOverview.getRow(1).height = 28;

  wsOverview.getCell("A2").border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
  wsOverview.getCell("B2").border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };

  const overviewRows: Array<[string, string]> = [
    ["Project Manager", pmName || ""],
    ["Phases", String(phases.length)],
    ["Items", String(items.length)],
    ["Window Start", minDate ? fmtUkDate(minDate) : ""],
    ["Window End", maxDate ? fmtUkDate(maxDate) : ""],
    ["Filtered Window", args.viewStart && args.viewEnd ? `${fmtUkDate(args.viewStart)} – ${fmtUkDate(args.viewEnd)}` : ""],
    ["Generated (UTC)", new Date().toISOString().replace("T", " ").replace("Z", " UTC")],
  ];

  let rr = 3;
  for (const [k, v] of overviewRows) {
    const a = wsOverview.getCell(`A${rr}`);
    a.value = k;
    a.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FF0F172A" } };
    a.alignment = { vertical: "middle", horizontal: "left" };

    const b = wsOverview.getCell(`B${rr}`);
    b.value = v;
    b.font = { name: "Segoe UI", size: 11, color: { argb: "FF475569" } };
    b.alignment = { vertical: "middle", horizontal: "left", wrapText: true };

    rr++;
  }

  /* =========================
     Schedule
  ========================= */
  const ws = wb.addWorksheet("Schedule", { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = [
    { header: "Phase", key: "phase", width: 24 },
    { header: "Item", key: "item", width: 46 },
    { header: "Type", key: "type", width: 14 },
    { header: "Start", key: "start", width: 14 },
    { header: "End", key: "end", width: 14 },
    { header: "Duration (days)", key: "dur", width: 16 },
    { header: "Status", key: "status", width: 16 },
    { header: "Progress %", key: "prog", width: 12 },
    { header: "Dependencies", key: "deps", width: 26 },
    { header: "Notes", key: "notes", width: 60 },
  ];

  const header = ws.getRow(1);
  header.height = 20;
  header.eachCell((cell) => {
    cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FF0F172A" } };
    cell.alignment = { vertical: "middle", horizontal: "left" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
  });

  const phaseNameById = new Map(phases.map((p) => [p.id, p.name]));
  const itemsSorted = [...items].sort((a, b) => {
    const pa = phaseNameById.get(a.phaseId || "") || "";
    const pb = phaseNameById.get(b.phaseId || "") || "";
    if (pa !== pb) return pa.localeCompare(pb);
    return a.start.getTime() - b.start.getTime();
  });

  let lastPhase = "";
  for (const it of itemsSorted) {
    const phase = phaseNameById.get(it.phaseId || "") || String(it.phaseId || "");
    if (phase !== lastPhase && lastPhase) ws.addRow([]);
    lastPhase = phase;

    const s = it.start;
    const e = it.end ?? it.start;
    const dur = Math.max(0, Math.round((startOfDayUTC(e).getTime() - startOfDayUTC(s).getTime()) / DAY_MS) + 1);

    const row = ws.addRow({
      phase,
      item: it.name,
      type: typeLabel(it.type),
      start: s,
      end: it.end ? e : null,
      dur: it.type === "milestone" ? 0 : dur,
      status: statusLabel(it.status || ""),
      prog: typeof it.progress === "number" ? Math.round(it.progress * 100) : "",
      deps: (it.dependencies || []).join(", "),
      notes: (it as any).notes || "",
    });

    row.height = 18;
    row.getCell("start").numFmt = "dd/mm/yyyy";
    row.getCell("end").numFmt = "dd/mm/yyyy";

    row.eachCell((cell, colNumber) => {
      cell.font = { name: "Segoe UI", size: 10, color: { argb: "FF0F172A" } };
      cell.alignment = { vertical: "middle", horizontal: colNumber === 6 || colNumber === 8 ? "center" : "left", wrapText: true };
      cell.border = { bottom: { style: "hair", color: { argb: "FFF1F5F9" } } };
    });

    const sc = statusColor(it.status || "");
    const statusCell = row.getCell("status");
    statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
    statusCell.border = {
      top: { style: "thin", color: { argb: "FFE2E8F0" } },
      bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
      left: { style: "thin", color: { argb: "FFE2E8F0" } },
      right: { style: "thin", color: { argb: "FFE2E8F0" } },
    };
    statusCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: sc } };
    statusCell.alignment = { vertical: "middle", horizontal: "center" };

    const progCell = row.getCell("prog");
    if (typeof it.progress === "number") {
      progCell.value = Math.round(it.progress * 100);
      progCell.numFmt = '0"%"';
      progCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: "FF0F172A" } };
    }
  }

  // Optional milestones sheet
  if (args.includeMilestonesSheet) {
    const ms = items.filter((i) => i.type === "milestone").sort((a, b) => a.start.getTime() - b.start.getTime());
    const wsM = wb.addWorksheet("Milestones", { views: [{ state: "frozen", ySplit: 1 }] });

    wsM.columns = [
      { header: "Date", key: "date", width: 14 },
      { header: "Milestone", key: "name", width: 56 },
      { header: "Phase", key: "phase", width: 24 },
      { header: "Status", key: "status", width: 16 },
    ];

    const h = wsM.getRow(1);
    h.height = 20;
    h.eachCell((cell) => {
      cell.font = { name: "Segoe UI", size: 11, bold: true, color: { argb: "FF0F172A" } };
      cell.alignment = { vertical: "middle", horizontal: "left" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } };
    });

    for (const it of ms) {
      const phase = phaseNameById.get(it.phaseId || "") || String(it.phaseId || "");
      const row = wsM.addRow({
        date: it.start,
        name: it.name,
        phase,
        status: statusLabel(it.status || ""),
      });

      row.height = 18;
      row.getCell("date").numFmt = "dd/mm/yyyy";

      row.eachCell((cell) => {
        cell.font = { name: "Segoe UI", size: 10, color: { argb: "FF0F172A" } };
        cell.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
        cell.border = { bottom: { style: "hair", color: { argb: "FFF1F5F9" } } };
      });

      const sc = statusColor(it.status || "");
      const statusCell = row.getCell("status");
      statusCell.font = { name: "Segoe UI", size: 10, bold: true, color: { argb: sc } };
      statusCell.alignment = { vertical: "middle", horizontal: "center" };
      statusCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
      statusCell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    }
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out);
}
