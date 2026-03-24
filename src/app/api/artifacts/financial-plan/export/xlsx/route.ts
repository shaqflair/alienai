import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonErr(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}
function safeNum(v: any): number { return isFinite(Number(v)) ? Number(v) : 0; }
function safeStr(v: any): string { return typeof v === "string" ? v : v == null ? "" : String(v); }
function capWords(s: string) { return s.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()); }

const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export async function GET(req: NextRequest) {
  try {
    /* ── Auth ───────────────────────────────────────────────────── */
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonErr("Unauthorised", 401);

    const url = new URL(req.url);
    const artifactId = safeStr(url.searchParams.get("artifactId") ?? url.searchParams.get("id")).trim();
    if (!artifactId) return jsonErr("artifactId required", 400);

    // createServiceClient() uses mustEnv("SUPABASE_URL") + mustEnv("SUPABASE_SERVICE_ROLE_KEY")
    // internally — no separate env check needed here.
    const admin = createServiceClient();

    /* ── Load artifact + project ────────────────────────────────── */
    const { data: artifact, error: artErr } = await admin
      .from("artifacts")
      .select("id, title, kind, project_id, content_json")
      .eq("id", artifactId)
      .maybeSingle();
    if (artErr || !artifact) {
      console.error("[xlsx] Artifact not found:", artErr?.message);
      return jsonErr("Artifact not found", 404);
    }

    const { data: project } = await admin
      .from("projects")
      .select("id, title, project_code")
      .eq("id", artifact.project_id)
      .maybeSingle();

    /* ── Parse content ──────────────────────────────────────────── */
    const content       = (artifact.content_json as any) ?? {};
    const currency      = safeStr(content.currency || "GBP");
    const sym           = currency;
    const costLines     = Array.isArray(content.cost_lines)      ? content.cost_lines      : [];
    const resources     = Array.isArray(content.resources)       ? content.resources       : [];
    const changeExp     = Array.isArray(content.change_exposure) ? content.change_exposure : [];
    const invoices      = Array.isArray(content.invoices)        ? content.invoices        : [];
    const monthlyData   = (content.monthly_data ?? {}) as Record<string, any>;
    const fyConfig      = (content.fy_config    ?? {}) as any;
    const projTitle     = safeStr(project?.title        || "Project");
    const projCode      = safeStr(project?.project_code || "");
    const artifactTitle = safeStr(artifact.title        || "Financial Plan");

    /* ── ExcelJS ────────────────────────────────────────────────── */
    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Aliena";
    wb.created = new Date();

    /* ── Shared styles ──────────────────────────────────────────── */
    const FILLS = {
      hdr:    { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0A1628" } },
      sub:    { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1B3652" } },
      alt:    { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0F7FF" } },
      white:  { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFFFF" } },
      green:  { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0F7F3" } },
      amber:  { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFDF6EC" } },
      red:    { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFDF2F1" } },
      violet: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE0F7FA" } },
    };

    const BORDER_THIN = (argb = "FFE2E8F0") => ({
      top:    { style: "thin" as const, color: { argb } },
      bottom: { style: "thin" as const, color: { argb } },
      left:   { style: "thin" as const, color: { argb } },
      right:  { style: "thin" as const, color: { argb } },
    });
    const NAVY_BORDER = BORDER_THIN("FF0A1628");

    function hdrRow(ws: any, values: (string | number)[], fill = FILLS.hdr) {
      const row = ws.addRow(values);
      row.eachCell((cell: any) => {
        cell.fill      = fill;
        cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border    = NAVY_BORDER;
      });
      row.height = 24;
      return row;
    }

    function titleBlock(ws: any, title: string, sub: string) {
      const r1 = ws.addRow([title]);
      r1.getCell(1).font = { bold: true, size: 14, name: "Arial", color: { argb: "FF0A1628" } };
      r1.height = 28;
      const r2 = ws.addRow([sub]);
      r2.getCell(1).font = { size: 10, name: "Arial", color: { argb: "FF64748B" } };
      ws.addRow([]);
    }

    function moneyFmt(ws: any, row: any, col: number, val: number, colorArgb?: string) {
      const cell = row.getCell(col);
      cell.value     = val;
      cell.numFmt    = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
      cell.alignment = { horizontal: "right" };
      cell.font      = { name: "Arial", size: 10, ...(colorArgb ? { color: { argb: colorArgb } } : {}) };
      cell.border    = BORDER_THIN();
    }

    function pctFmt(row: any, col: number, val: number, colorArgb?: string) {
      const cell = row.getCell(col);
      cell.value     = val;
      cell.numFmt    = "0.0%;(0.0%);-";
      cell.alignment = { horizontal: "right" };
      cell.font      = { name: "Arial", size: 10, ...(colorArgb ? { color: { argb: colorArgb } } : {}) };
      cell.border    = BORDER_THIN();
    }

    function textCell(row: any, col: number, val: string, opts: any = {}) {
      const cell     = row.getCell(col);
      cell.value     = val;
      cell.font      = { name: "Arial", size: 10, ...opts.font };
      cell.alignment = { vertical: "middle", wrapText: true, ...opts.alignment };
      cell.border    = BORDER_THIN();
      if (opts.fill) cell.fill = opts.fill;
    }

    function dataRow(ws: any, altIdx: number) {
      const row  = ws.addRow([]);
      row.fill   = altIdx % 2 === 0 ? FILLS.white : FILLS.alt;
      row.height = 18;
      return row;
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 1 — SUMMARY
    ════════════════════════════════════════════════════════════ */
    const wsSummary = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF0A1628" } } });
    wsSummary.columns = [
      { width: 34 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 },
    ];
    titleBlock(wsSummary,
      `${projCode ? projCode + " – " : ""}${projTitle}`,
      `${artifactTitle}   |   Exported ${new Date().toLocaleDateString("en-GB")}`
    );

    const hdrR = hdrRow(wsSummary, ["Financial Summary", "", "", "", ""]);
    wsSummary.mergeCells(`A${hdrR.number}:E${hdrR.number}`);

    const approvedBudget = safeNum(content.total_approved_budget);
    const totalBudgeted  = costLines.reduce((s: number, l: any) => s + safeNum(l.budgeted), 0);
    const totalActual    = costLines.reduce((s: number, l: any) => s + safeNum(l.actual), 0);
    const totalForecast  = costLines.reduce((s: number, l: any) => s + safeNum(l.forecast), 0);
    const forecastVar    = approvedBudget ? totalForecast - approvedBudget : 0;
    const pendingExp     = changeExp.filter((c: any) => c.status === "pending").reduce((s: number, c: any) => s + safeNum(c.cost_impact), 0);
    const approvedExp    = changeExp.filter((c: any) => c.status === "approved").reduce((s: number, c: any) => s + safeNum(c.cost_impact), 0);

    const kpis: [string, number, string?][] = [
      ["Total Approved Budget",         approvedBudget, "FF2A6E47"],
      ["Total Budgeted (cost lines)",   totalBudgeted,  undefined],
      ["Total Actual Spend",            totalActual,    "FF0E7490"],
      ["Total Forecast",                totalForecast,  forecastVar > 0 ? "FFB83A2E" : "FF2A6E47"],
      ["Forecast Variance vs Approved", forecastVar,    forecastVar > 0 ? "FFB83A2E" : "FF2A6E47"],
      ["Approved Change Exposure",      approvedExp,    undefined],
      ["Pending Change Exposure",       pendingExp,     pendingExp > 0 ? "FF8A5B1A" : undefined],
    ];

    kpis.forEach(([label, val, color], i) => {
      const row  = wsSummary.addRow([label, val]);
      row.height = 20;
      row.fill   = i % 2 === 0 ? FILLS.white : FILLS.alt;
      row.getCell(1).font   = { name: "Arial", size: 10, bold: true };
      row.getCell(1).border = BORDER_THIN();
      moneyFmt(wsSummary, row, 2, val, color);
    });

    for (const [heading, body] of [
      ["Plan Summary",       content.summary],
      ["Variance Narrative", content.variance_narrative],
      ["Assumptions",        content.assumptions],
    ] as [string, string][]) {
      if (!body) continue;
      wsSummary.addRow([]);
      const hr = hdrRow(wsSummary, [heading, "", "", "", ""]);
      wsSummary.mergeCells(`A${hr.number}:E${hr.number}`);
      const tr = wsSummary.addRow([body]);
      tr.getCell(1).alignment = { wrapText: true, vertical: "top" };
      tr.getCell(1).font      = { name: "Arial", size: 10 };
      tr.height               = 80;
      wsSummary.mergeCells(`A${tr.number}:E${tr.number}`);
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 2 — COST BREAKDOWN
    ════════════════════════════════════════════════════════════ */
    const wsCost = wb.addWorksheet("Cost Breakdown", { properties: { tabColor: { argb: "FF1B3652" } } });
    wsCost.columns = [
      { width: 22 }, { width: 32 }, { width: 18 }, { width: 18 },
      { width: 18 }, { width: 18 }, { width: 14 }, { width: 30 },
    ];
    titleBlock(wsCost, "Cost Breakdown", `${artifactTitle}  |  ${new Date().toLocaleDateString("en-GB")}`);
    hdrRow(wsCost, [
      "Category", "Description",
      `Budgeted (${sym})`, `Actual (${sym})`, `Forecast (${sym})`,
      `Variance (${sym})`, "Variance %", "Notes",
    ]);

    costLines.forEach((line: any, i: number) => {
      const bud    = safeNum(line.budgeted);
      const act    = safeNum(line.actual);
      const fct    = safeNum(line.forecast);
      const varVal = bud ? fct - bud : 0;
      const varPct = bud ? varVal / bud : 0;
      const over   = bud > 0 && fct > bud;
      const row    = dataRow(wsCost, i);
      textCell(row, 1, capWords(safeStr(line.category)));
      textCell(row, 2, safeStr(line.description || line.category));
      moneyFmt(wsCost, row, 3, bud);
      moneyFmt(wsCost, row, 4, act, "FF0E7490");
      moneyFmt(wsCost, row, 5, fct, over ? "FFB83A2E" : "FF2A6E47");
      moneyFmt(wsCost, row, 6, varVal, over ? "FFB83A2E" : "FF2A6E47");
      pctFmt(row, 7, varPct, over ? "FFB83A2E" : "FF2A6E47");
      textCell(row, 8, safeStr(line.notes));
    });

    if (costLines.length > 0) {
      const tRow = wsCost.addRow([]);
      tRow.height = 22;
      tRow.fill   = FILLS.sub;
      const tVar  = approvedBudget ? totalForecast - approvedBudget : 0;
      tRow.getCell(1).value  = "TOTAL";
      tRow.getCell(1).font   = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
      tRow.getCell(1).border = NAVY_BORDER;
      tRow.getCell(2).border = NAVY_BORDER;
      for (const [col, val, clr] of [
        [3, totalBudgeted, "FFFFFFFF"],
        [4, totalActual,   "FFFFFFFF"],
        [5, totalForecast, "FFFFFFFF"],
        [6, tVar,          tVar > 0 ? "FFFF9999" : "FF99FFcc"],
      ] as [number, number, string][]) {
        moneyFmt(wsCost, tRow, col, val, clr);
        tRow.getCell(col).fill = FILLS.sub;
        tRow.getCell(col).font = { bold: true, color: { argb: clr }, name: "Arial", size: 10 };
      }
      tRow.getCell(7).border = NAVY_BORDER; tRow.getCell(7).fill = FILLS.sub;
      tRow.getCell(8).border = NAVY_BORDER; tRow.getCell(8).fill = FILLS.sub;
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 3 — MONTHLY PHASING
    ════════════════════════════════════════════════════════════ */
    const hasMonthly = Object.keys(monthlyData).length > 0 && fyConfig?.fy_start_month;
    if (hasMonthly && costLines.length > 0) {
      const wsM = wb.addWorksheet("Monthly Phasing", { properties: { tabColor: { argb: "FF2A6E47" } } });

      const monthKeys: string[] = [];
      let mo = fyConfig.fy_start_month as number;
      let yr = fyConfig.fy_start_year  as number;
      const numMonths = (fyConfig.num_months as number) ?? 12;
      for (let i = 0; i < numMonths; i++) {
        monthKeys.push(`${yr}-${String(mo).padStart(2, "0")}`);
        if (++mo > 12) { mo = 1; yr++; }
      }

      wsM.columns = [
        { width: 20 }, { width: 28 },
        ...monthKeys.flatMap(() => [{ width: 11 }, { width: 11 }, { width: 11 }]),
        { width: 14 }, { width: 14 }, { width: 14 },
      ];
      titleBlock(wsM, "Monthly Phasing",
        `${artifactTitle}  |  FY ${fyConfig.fy_start_year}/${String((fyConfig.fy_start_year as number) + 1).slice(2)}`
      );

      // Month label row (merged × 3 per month)
      const monthLabelRow = wsM.addRow([
        "", "",
        ...monthKeys.flatMap(mk => { const [,mm] = mk.split("-"); return [MONTH_SHORT[Number(mm)-1], "", ""]; }),
        "Total", "", "",
      ]);
      monthLabelRow.height = 22;
      monthLabelRow.eachCell((cell: any) => {
        cell.fill = FILLS.sub; cell.border = NAVY_BORDER;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });
      const baseCol = 3;
      monthKeys.forEach((_, idx) => {
        const s = baseCol + idx * 3;
        wsM.mergeCells(monthLabelRow.number, s, monthLabelRow.number, s + 2);
      });
      const totStart = baseCol + monthKeys.length * 3;
      wsM.mergeCells(monthLabelRow.number, totStart, monthLabelRow.number, totStart + 2);

      // Sub-header row
      const subRow = wsM.addRow([
        "Category", "Description",
        ...monthKeys.flatMap(() => ["Budget", "Actual", "Forecast"]),
        "Budget", "Actual", "Forecast",
      ]);
      subRow.height = 20;
      subRow.eachCell((cell: any) => {
        cell.fill = FILLS.hdr; cell.border = NAVY_BORDER;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
        cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
      });

      const totBudByMo: number[] = Array(monthKeys.length).fill(0);
      const totActByMo: number[] = Array(monthKeys.length).fill(0);
      const totFctByMo: number[] = Array(monthKeys.length).fill(0);

      costLines.forEach((line: any, i: number) => {
        const lineMonthly = (monthlyData[line.id] ?? {}) as Record<string, any>;
        const rowVals: any[] = [
          capWords(safeStr(line.category)),
          safeStr(line.description || line.category),
        ];
        let lB = 0, lA = 0, lF = 0;
        monthKeys.forEach((mk, mi) => {
          const e = lineMonthly[mk] ?? {};
          const b = safeNum(e.budget ?? e.budgeted);
          const a = safeNum(e.actual);
          const f = safeNum(e.forecast);
          rowVals.push(b, a, f);
          lB += b; lA += a; lF += f;
          totBudByMo[mi] += b; totActByMo[mi] += a; totFctByMo[mi] += f;
        });
        rowVals.push(lB, lA, lF);

        const row  = wsM.addRow(rowVals);
        row.fill   = i % 2 === 0 ? FILLS.white : FILLS.alt;
        row.height = 17;

        [1, 2].forEach(c => {
          row.getCell(c).font      = { name: "Arial", size: 9 };
          row.getCell(c).alignment = { vertical: "middle" };
          row.getCell(c).border    = BORDER_THIN();
        });
        const totalColStart = 2 + monthKeys.length * 3 + 1;
        for (let ci = 3; ci <= totalColStart + 2; ci++) {
          const cell    = row.getCell(ci);
          cell.numFmt   = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
          cell.alignment = { horizontal: "right" };
          cell.border   = BORDER_THIN();
          cell.font     = { name: "Arial", size: 9, bold: ci >= totalColStart };
          // Highlight actual columns (index 1 of each 3-col group)
          if (ci < totalColStart && (ci - 3) % 3 === 1 && row.getCell(ci).value) {
            cell.fill = FILLS.violet;
          }
        }
      });

      // Totals footer
      const footVals: any[] = ["TOTAL", ""];
      let gB = 0, gA = 0, gF = 0;
      monthKeys.forEach((_, mi) => {
        footVals.push(totBudByMo[mi], totActByMo[mi], totFctByMo[mi]);
        gB += totBudByMo[mi]; gA += totActByMo[mi]; gF += totFctByMo[mi];
      });
      footVals.push(gB, gA, gF);
      const footRow = wsM.addRow(footVals);
      footRow.height = 22;
      footRow.eachCell((cell: any, col: number) => {
        cell.fill = FILLS.sub; cell.border = NAVY_BORDER;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
        if (col > 2) { cell.numFmt = `"${sym} "#,##0;("${sym} "#,##0);"-"`; cell.alignment = { horizontal: "right" }; }
      });

      wsM.views = [{ state: "frozen", xSplit: 2, ySplit: subRow.number, showGridLines: false }];
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 4 — CHANGE EXPOSURE
    ════════════════════════════════════════════════════════════ */
    if (changeExp.length > 0) {
      const wsCE = wb.addWorksheet("Change Exposure", { properties: { tabColor: { argb: "FF8A5B1A" } } });
      wsCE.columns = [
        { width: 16 }, { width: 30 }, { width: 18 }, { width: 16 }, { width: 30 },
      ];
      titleBlock(wsCE, "Change Exposure", `${artifactTitle}  |  ${new Date().toLocaleDateString("en-GB")}`);
      hdrRow(wsCE, ["Change Ref", "Title", `Cost Impact (${sym})`, "Status", "Notes"]);

      changeExp.forEach((c: any, i: number) => {
        const impact = safeNum(c.cost_impact);
        const isApp  = c.status === "approved";
        const isPend = c.status === "pending";
        const row    = dataRow(wsCE, i);
        textCell(row, 1, safeStr(c.change_ref));
        textCell(row, 2, safeStr(c.title));
        moneyFmt(wsCE, row, 3, impact, isApp ? "FF2A6E47" : isPend ? "FF8A5B1A" : undefined);
        textCell(row, 4, capWords(safeStr(c.status)), {
          fill: isApp ? FILLS.green : isPend ? FILLS.amber : undefined,
          font: { bold: true, color: { argb: isApp ? "FF2A6E47" : isPend ? "FF8A5B1A" : "FF64748B" } },
        });
        textCell(row, 5, safeStr(c.notes));
      });

      const totRow = wsCE.addRow([]);
      totRow.height = 20; totRow.fill = FILLS.sub;
      totRow.getCell(1).value = "TOTAL";
      totRow.getCell(1).font  = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
      [1,2,4,5].forEach(c => { totRow.getCell(c).border = NAVY_BORDER; totRow.getCell(c).fill = FILLS.sub; });
      moneyFmt(wsCE, totRow, 3, approvedExp + pendingExp);
      totRow.getCell(3).fill = FILLS.sub;
      totRow.getCell(3).font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 5 — RESOURCES
    ════════════════════════════════════════════════════════════ */
    if (resources.length > 0) {
      const wsRes = wb.addWorksheet("Resources", { properties: { tabColor: { argb: "FF4A3A7A" } } });
      wsRes.columns = [
        { width: 24 }, { width: 20 }, { width: 14 }, { width: 14 },
        { width: 16 }, { width: 14 }, { width: 16 }, { width: 30 },
      ];
      titleBlock(wsRes, "Resources", `${artifactTitle}  |  ${new Date().toLocaleDateString("en-GB")}`);
      hdrRow(wsRes, [
        "Name", "Role", "Type", "Rate Method",
        `Rate (${sym})`, "Planned Qty", `Total Cost (${sym})`, "Notes",
      ]);

      let resTotal = 0;
      resources.forEach((r: any, i: number) => {
        const rate  = r.rate_type === "day_rate" ? safeNum(r.day_rate) : safeNum(r.monthly_cost);
        const qty   = r.rate_type === "day_rate" ? safeNum(r.planned_days) : safeNum(r.planned_months);
        const total = rate * qty;
        resTotal   += total;
        const row   = dataRow(wsRes, i);
        textCell(row, 1, safeStr(r.name));
        textCell(row, 2, capWords(safeStr(r.role)));
        textCell(row, 3, capWords(safeStr(r.type)));
        textCell(row, 4, r.rate_type === "day_rate" ? "Day Rate" : "Monthly");
        moneyFmt(wsRes, row, 5, rate);
        const qCell     = row.getCell(6);
        qCell.value     = qty;
        qCell.numFmt    = "0.0";
        qCell.alignment = { horizontal: "right" };
        qCell.font      = { name: "Arial", size: 10 };
        qCell.border    = BORDER_THIN();
        moneyFmt(wsRes, row, 7, total, "FF1B3652");
        textCell(row, 8, safeStr(r.notes));
      });

      const tRow = wsRes.addRow([]);
      tRow.height = 20; tRow.fill = FILLS.sub;
      tRow.getCell(1).value = "TOTAL";
      tRow.getCell(1).font  = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
      [1,2,3,4,5,6,8].forEach(c => { tRow.getCell(c).border = NAVY_BORDER; tRow.getCell(c).fill = FILLS.sub; });
      moneyFmt(wsRes, tRow, 7, resTotal);
      tRow.getCell(7).fill = FILLS.sub;
      tRow.getCell(7).font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 6 — BILLING
    ════════════════════════════════════════════════════════════ */
    if (invoices.length > 0) {
      const wsBill = wb.addWorksheet("Billing", { properties: { tabColor: { argb: "FF0E7490" } } });
      wsBill.columns = [
        { width: 14 }, { width: 13 }, { width: 24 }, { width: 30 },
        { width: 18 }, { width: 14 }, { width: 13 }, { width: 14 }, { width: 20 },
      ];
      titleBlock(wsBill, "Billing", `${artifactTitle}  |  ${new Date().toLocaleDateString("en-GB")}`);
      hdrRow(wsBill, [
        "Invoice #", "Date", "Customer", "Description",
        `Amount (${sym})`, "Status", "Due Date", "Paid Date", "PO Reference",
      ]);

      let totalInvoiced = 0, totalPaid = 0;
      invoices.forEach((inv: any, i: number) => {
        const amount   = safeNum(inv.amount);
        const isPaid   = inv.status === "paid";
        const isOver   = inv.status === "overdue";
        const isCredit = amount < 0;
        const row      = dataRow(wsBill, i);
        textCell(row, 1, safeStr(inv.invoice_number));
        textCell(row, 2, safeStr(inv.invoice_date));
        textCell(row, 3, safeStr(inv.customer_name));
        textCell(row, 4, safeStr(inv.description));
        moneyFmt(wsBill, row, 5, amount,
          isCredit ? "FFB83A2E" : isPaid ? "FF2A6E47" : isOver ? "FFB83A2E" : undefined
        );
        textCell(row, 6, capWords(safeStr(inv.status)), {
          fill: isPaid ? FILLS.green : isOver ? FILLS.red : isCredit ? FILLS.red : undefined,
          font: { bold: true, color: { argb: isPaid ? "FF2A6E47" : isOver ? "FFB83A2E" : "FF64748B" } },
        });
        textCell(row, 7, safeStr(inv.due_date));
        textCell(row, 8, safeStr(inv.payment_date));
        textCell(row, 9, safeStr(inv.po_reference));
        if (inv.status !== "cancelled") totalInvoiced += amount;
        if (isPaid) totalPaid += amount;
      });

      wsBill.addRow([]);
      for (const [label, val, clr] of [
        ["Total Invoiced", totalInvoiced,              "FF1B3652"],
        ["Cash Received",  totalPaid,                  "FF2A6E47"],
        ["Outstanding",    totalInvoiced - totalPaid,  (totalInvoiced - totalPaid) > 0 ? "FF8A5B1A" : "FF2A6E47"],
      ] as [string, number, string][]) {
        const r = wsBill.addRow([label]);
        r.getCell(1).font = { bold: true, name: "Arial", size: 10 };
        moneyFmt(wsBill, r, 5, val, clr);
      }
    }

    /* ════════════════════════════════════════════════════════════
       STREAM RESPONSE
    ════════════════════════════════════════════════════════════ */
    const buffer   = await wb.xlsx.writeBuffer();
    const safeName = (artifact.title || "financial-plan")
      .replace(/[^a-zA-Z0-9\-_ ]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60);
    const filename = `${projCode ? projCode + "-" : ""}${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        "Content-Type":        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control":       "no-store",
      },
    });

  } catch (e: any) {
    console.error("[financial-plan/export/xlsx] FATAL:", e?.message, e?.stack);
    return jsonErr(e?.message ?? "Export failed", 500);
  }
}