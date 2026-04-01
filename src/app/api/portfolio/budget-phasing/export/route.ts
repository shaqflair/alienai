// GET /api/portfolio/budget-phasing/export?fy=2025&fyStart=4&scope=active|all
//
// Exports portfolio monthly phasing as a formatted XLSX file.

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function err(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}

function safeNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeStr(v: any): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function buildFyMonths(fyStart: number, fyYear: number) {
  const MONTH_NAMES = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const months = [];
  for (let i = 0; i < 12; i++) {
    const month = ((fyStart - 1 + i) % 12) + 1;
    const year = fyYear + Math.floor((fyStart - 1 + i) / 12);
    months.push({ year, month, label: `${MONTH_NAMES[month - 1]} ${String(year).slice(2)}` });
  }
  return months;
}

function buildMonthIndex(fyMonths: ReturnType<typeof buildFyMonths>) {
  const map = new Map<string, number>();
  fyMonths.forEach(({ year, month }, i) => {
    map.set(`${year}-${String(month).padStart(2, "0")}`, i);
  });
  return map;
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return err("Unauthorized", 401);

    const url = new URL(req.url);
    const fyStart = Math.max(1, Math.min(12, parseInt(url.searchParams.get("fyStart") ?? "4", 10)));
    const nowYear = new Date().getFullYear();
    const nowMonth = new Date().getMonth() + 1;
    const defaultFyYear = nowMonth >= fyStart ? nowYear : nowYear - 1;
    const fyYear = parseInt(url.searchParams.get("fy") ?? String(defaultFyYear), 10);
    const scope = url.searchParams.get("scope") ?? "active";

    const fyMonths = buildFyMonths(fyStart, fyYear);
    const monthIndex = buildMonthIndex(fyMonths);
    const fyEndYear = fyMonths[11].year;
    const fyLabel = fyStart === 1
      ? String(fyYear)
      : `${fyYear}/${String(fyEndYear).slice(2)}`;

    const fyStart_date = `${fyYear}-${String(fyStart).padStart(2, "0")}-01`;
    const fyEnd_month = fyMonths[11].month;
    const fyEnd_year = fyMonths[11].year;
    const fyEnd_date = `${fyEnd_year}-${String(fyEnd_month).padStart(2, "0")}-${new Date(fyEnd_year, fyEnd_month, 0).getDate()}`;

    // Fetch org
    const { data: orgMem } = await supabase
      .from("organisation_members")
      .select("organisation_id")
      .eq("user_id", auth.user.id)
      .is("removed_at", null)
      .limit(1)
      .maybeSingle();

    const orgId = safeStr((orgMem as any)?.organisation_id);
    if (!orgId) return err("No organisation found", 404);

    // Fetch projects
    let projectQuery = supabase
      .from("projects")
      .select("id, title, project_code, budget_amount, resource_status, deleted_at")
      .eq("organisation_id", orgId)
      .neq("resource_status", "pipeline");

    if (scope === "active") projectQuery = projectQuery.is("deleted_at", null);

    const { data: projectRows } = await projectQuery.order("title");
    const projects = (projectRows ?? []) as any[];

    // Fetch financial plans
    const projectIds = projects.map((p: any) => p.id);
    const { data: artifactRows } = await supabase
      .from("artifacts")
      .select("id, project_id, content_json, approval_status, is_current")
      .in("project_id", projectIds)
      .eq("type", "financial_plan")
      .eq("is_current", true);

    const artifactByProject = new Map<string, any>();
    for (const a of (artifactRows ?? []) as any[]) {
      const pid = safeStr(a.project_id);
      if (!artifactByProject.has(pid) || a.approval_status === "approved") {
        artifactByProject.set(pid, a);
      }
    }

    // Fetch actuals
    const { data: spendRows } = await supabase
      .from("project_spend")
      .select("project_id, amount, spend_date")
      .in("project_id", projectIds)
      .gte("spend_date", fyStart_date)
      .lte("spend_date", fyEnd_date);

    const actualsByProject = new Map<string, Map<string, number>>();
    for (const row of (spendRows ?? []) as any[]) {
      const pid = safeStr(row.project_id);
      const dateStr = safeStr(row.spend_date).slice(0, 7);
      const amount = safeNum(row.amount);
      if (!actualsByProject.has(pid)) actualsByProject.set(pid, new Map());
      const m = actualsByProject.get(pid)!;
      m.set(dateStr, (m.get(dateStr) ?? 0) + amount);
    }

    // Build project rows data
    const projectData = projects.map((proj: any) => {
      const artifact = artifactByProject.get(proj.id);
      const budget = safeNum(proj.budget_amount);
      const monthlyBudget = budget / 12;
      const forecast = new Array(12).fill(0);
      const actual = new Array(12).fill(0);
      const budgetArr = new Array(12).fill(monthlyBudget);

      if (artifact?.content_json) {
        const cj = artifact.content_json;
        const lines: any[] = Array.isArray(cj.lines) ? cj.lines : [];
        const monthlyData: Record<string, Record<string, any>> = cj.monthlyData ?? cj.monthly_data ?? {};
        for (const line of lines) {
          const lineId = safeStr(line.id);
          const lineMonthly = monthlyData[lineId] ?? {};
          for (const [monthKey, entry] of Object.entries(lineMonthly)) {
            const idx = monthIndex.get(monthKey);
            if (idx === undefined) continue;
            forecast[idx] += safeNum((entry as any)?.forecast ?? 0);
          }
        }
      }

      const projectActuals = actualsByProject.get(proj.id) ?? new Map<string, number>();
      for (const [monthKey, amount] of projectActuals) {
        const idx = monthIndex.get(monthKey);
        if (idx !== undefined) actual[idx] = amount;
      }

      return {
        title: safeStr(proj.title) || "Untitled",
        code: safeStr(proj.project_code),
        budget,
        forecast,
        actual,
        budgetArr,
        variance: forecast.map((f, i) => f - budgetArr[i]),
      };
    });

    // Build XLSX using ExcelJS (available in Next.js env via npm)
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.default.Workbook();
    wb.creator = "Aliena PMO";
    wb.created = new Date();

    // -- Sheet 1: Portfolio Phasing ------------------------------------------
    const ws = wb.addWorksheet("Portfolio Phasing");

    // Styles
    const headerFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A1A" } };
    const subHeaderFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF5F5F0" } };
    const totalsFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE8E8E0" } };
    const negativeFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0F0" } };
    const positiveFill: any = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF0FFF4" } };

    const gbpFmt = '£#,##0;(£#,##0);"-"';
    const gbpFmtK = '£#,##0,"k";(£#,##0,"k");"-"';

    // Row 1: Title
    ws.mergeCells("A1:B1");
    const titleCell = ws.getCell("A1");
    titleCell.value = `Portfolio Monthly Phasing -- FY ${fyLabel}`;
    titleCell.font = { name: "Arial", size: 14, bold: true, color: { argb: "FF1A1A1A" } };
    titleCell.alignment = { horizontal: "left", vertical: "middle" };
    ws.getRow(1).height = 28;

    ws.mergeCells(`C1:${colLetter(2 + fyMonths.length * 4)}1`);
    const scopeCell = ws.getCell("C1");
    scopeCell.value = `Scope: ${scope === "all" ? "All projects (active + archived)" : "Active projects only"}  |  Generated: ${new Date().toLocaleDateString("en-GB")}`;
    scopeCell.font = { name: "Arial", size: 10, color: { argb: "FF888888" } };
    scopeCell.alignment = { horizontal: "right", vertical: "middle" };

    // Row 2: Month group headers
    ws.getRow(2).height = 20;
    const r2 = ws.getRow(2);
    r2.getCell(1).value = "Project";
    r2.getCell(2).value = "Code";

    let col = 3;
    for (const m of fyMonths) {
      ws.mergeCells(2, col, 2, col + 3);
      const cell = ws.getCell(2, col);
      cell.value = m.label;
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = headerFill;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      col += 4;
    }
    // Totals group header
    ws.mergeCells(2, col, 2, col + 3);
    const totHdr = ws.getCell(2, col);
    totHdr.value = "FY Total";
    totHdr.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
    totHdr.fill = headerFill;
    totHdr.alignment = { horizontal: "center", vertical: "middle" };

    // Row 3: Sub-column headers (Forecast, Actual, Budget, Variance) x 12 months + totals
    ws.getRow(3).height = 16;
    const r3 = ws.getRow(3);
    r3.getCell(1).value = "";
    r3.getCell(2).value = "";

    col = 3;
    const subCols = ["Forecast", "Actual", "Budget", "Variance"];
    const subColColors = ["FF2563EB", "FF059669", "FF6B7280", "FFDC2626"];

    for (let m = 0; m < fyMonths.length; m++) {
      for (let s = 0; s < 4; s++) {
        const cell = ws.getCell(3, col);
        cell.value = subCols[s];
        cell.font = { name: "Arial", size: 7, bold: true, color: { argb: subColColors[s] } };
        cell.fill = subHeaderFill;
        cell.alignment = { horizontal: "center", vertical: "middle" };
        col++;
      }
    }
    for (let s = 0; s < 4; s++) {
      const cell = ws.getCell(3, col);
      cell.value = subCols[s];
      cell.font = { name: "Arial", size: 7, bold: true, color: { argb: subColColors[s] } };
      cell.fill = totalsFill;
      cell.alignment = { horizontal: "center", vertical: "middle" };
      col++;
    }

    // Style header rows
    [1, 2, 3].forEach(rowNo => {
      const row = ws.getRow(rowNo);
      row.eachCell(cell => {
        cell.border = {
          bottom: { style: "thin", color: { argb: "FFCCCCCC" } },
        };
      });
    });

    // Data rows
    const dataStartRow = 4;
    let currentRow = dataStartRow;

    for (const proj of projectData) {
      const row = ws.getRow(currentRow);
      row.height = 15;

      row.getCell(1).value = proj.title;
      row.getCell(1).font = { name: "Arial", size: 9, bold: true };

      row.getCell(2).value = proj.code;
      row.getCell(2).font = { name: "Arial", size: 9, color: { argb: "FF888888" } };

      col = 3;
      for (let m = 0; m < 12; m++) {
        const fc = proj.forecast[m];
        const ac = proj.actual[m];
        const bd = proj.budgetArr[m];
        const vr = proj.variance[m];

        const vals = [fc, ac, bd, vr];
        for (let s = 0; s < 4; s++) {
          const cell = row.getCell(col);
          cell.value = vals[s];
          cell.numFmt = gbpFmt;
          cell.font = { name: "Arial", size: 8 };
          cell.alignment = { horizontal: "right" };
          if (s === 3 && vals[s] < 0) {
            cell.fill = negativeFill;
            cell.font = { name: "Arial", size: 8, color: { argb: "FFDC2626" } };
          }
          col++;
        }
      }

      // Row totals
      const tfc = proj.forecast.reduce((a: number, b: number) => a + b, 0);
      const tac = proj.actual.reduce((a: number, b: number) => a + b, 0);
      const tbd = proj.budget;
      const tvr = tfc - tbd;
      const totVals = [tfc, tac, tbd, tvr];
      for (let s = 0; s < 4; s++) {
        const cell = row.getCell(col);
        cell.value = totVals[s];
        cell.numFmt = gbpFmtK;
        cell.font = { name: "Arial", size: 8, bold: true };
        cell.fill = totalsFill;
        cell.alignment = { horizontal: "right" };
        if (s === 3 && totVals[s] < 0) {
          cell.fill = negativeFill;
          cell.font = { name: "Arial", size: 8, bold: true, color: { argb: "FFDC2626" } };
        } else if (s === 3 && totVals[s] >= 0) {
          cell.fill = positiveFill;
          cell.font = { name: "Arial", size: 8, bold: true, color: { argb: "FF059669" } };
        }
        col++;
      }

      row.eachCell(cell => {
        cell.border = {
          bottom: { style: "hair", color: { argb: "FFEEEEEE" } },
        };
      });

      currentRow++;
    }

    // Portfolio Totals row
    const totRow = ws.getRow(currentRow);
    totRow.height = 18;
    totRow.getCell(1).value = "Portfolio Total";
    totRow.getCell(1).font = { name: "Arial", size: 9, bold: true };
    totRow.getCell(2).value = "";

    col = 3;
    // Sum each sub-column across all projects using Excel formulas
    const totalProjects = projectData.length;

    for (let m = 0; m < 12; m++) {
      for (let s = 0; s < 4; s++) {
        const colIdx = 3 + m * 4 + s;
        const startRow = dataStartRow;
        const endRow = dataStartRow + totalProjects - 1;
        const colL = colLetter(colIdx);
        const cell = totRow.getCell(col);
        cell.value = totalProjects > 0 ? { formula: `SUM(${colL}${startRow}:${colL}${endRow})` } : 0;
        cell.numFmt = gbpFmt;
        cell.font = { name: "Arial", size: 8, bold: true };
        cell.fill = totalsFill;
        cell.alignment = { horizontal: "right" };
        if (s === 3) {
          // Variance gets conditional color via formula (we'll just style it dark)
          cell.font = { name: "Arial", size: 8, bold: true, color: { argb: "FF1A1A1A" } };
        }
        col++;
      }
    }

    // Grand total
    for (let s = 0; s < 4; s++) {
      const colIdx = 3 + 12 * 4 + s;
      const colL = colLetter(colIdx);
      const startRow = dataStartRow;
      const endRow = dataStartRow + totalProjects - 1;
      const cell = totRow.getCell(col);
      cell.value = totalProjects > 0 ? { formula: `SUM(${colL}${startRow}:${colL}${endRow})` } : 0;
      cell.numFmt = gbpFmtK;
      cell.font = { name: "Arial", size: 9, bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1A1A1A" } };
      cell.font = { name: "Arial", size: 8, bold: true, color: { argb: "FFFFFFFF" } };
      cell.alignment = { horizontal: "right" };
      col++;
    }

    totRow.eachCell(cell => {
      cell.border = {
        top: { style: "medium", color: { argb: "FF1A1A1A" } },
        bottom: { style: "medium", color: { argb: "FF1A1A1A" } },
      };
    });

    // Column widths
    ws.getColumn(1).width = 28;
    ws.getColumn(2).width = 10;
    for (let i = 3; i <= 2 + (fyMonths.length + 1) * 4; i++) {
      ws.getColumn(i).width = 9;
    }

    // Freeze panes: freeze project + code columns
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 3, activeCell: "C4" }];

    // -- Sheet 2: Summary ----------------------------------------------------
    const wsSummary = wb.addWorksheet("Summary");

    const summaryHeaders = ["Project", "Code", "Budget", "Total Forecast", "Total Actual", "Variance (£)", "Variance (%)", "Burn Rate (%)", "Status"];
    const summaryRow1 = wsSummary.addRow(["Portfolio Budget Summary -- FY " + fyLabel]);
    summaryRow1.getCell(1).font = { name: "Arial", size: 12, bold: true };
    wsSummary.addRow([]);

    const hdrRow = wsSummary.addRow(summaryHeaders);
    hdrRow.eachCell(cell => {
      cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FFFFFFFF" } };
      cell.fill = headerFill;
      cell.alignment = { horizontal: "center" };
      cell.border = { bottom: { style: "thin", color: { argb: "FFFFFFFF" } } };
    });

    for (const proj of projectData) {
      const tfc = proj.forecast.reduce((a: number, b: number) => a + b, 0);
      const tac = proj.actual.reduce((a: number, b: number) => a + b, 0);
      const tvr = tfc - proj.budget;
      const vrPct = proj.budget > 0 ? tvr / proj.budget : 0;
      const burnPct = proj.budget > 0 ? tac / proj.budget : 0;
      const status = tvr > proj.budget * 0.1 ? "Over Budget" : tvr < -(proj.budget * 0.1) ? "Under Forecast" : "On Track";

      const dr = wsSummary.addRow([proj.title, proj.code, proj.budget, tfc, tac, tvr, vrPct, burnPct, status]);
      dr.getCell(3).numFmt = gbpFmt;
      dr.getCell(4).numFmt = gbpFmt;
      dr.getCell(5).numFmt = gbpFmt;
      dr.getCell(6).numFmt = gbpFmt;
      dr.getCell(7).numFmt = "0.0%";
      dr.getCell(8).numFmt = "0.0%";

      const statusColor = status === "Over Budget" ? "FFDC2626" : status === "On Track" ? "FF059669" : "FFD97706";
      dr.getCell(9).font = { name: "Arial", size: 9, bold: true, color: { argb: statusColor } };
      dr.eachCell(cell => { cell.font = cell.font ?? { name: "Arial", size: 9 }; });
      dr.eachCell(cell => { cell.border = { bottom: { style: "hair", color: { argb: "FFEEEEEE" } } }; });
    }

    [28, 10, 12, 14, 12, 12, 11, 11, 12].forEach((w, i) => {
      wsSummary.getColumn(i + 1).width = w;
    });

    // Serialize
    const buffer = await wb.xlsx.writeBuffer();
    const filename = `portfolio-phasing-fy${fyLabel.replace("/", "-")}.xlsx`;

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[portfolio/budget-phasing/export]", e);
    return err(String(e?.message ?? e ?? "Export failed"), 500);
  }
}

function colLetter(colIndex: number): string {
  let result = "";
  let n = colIndex;
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}
