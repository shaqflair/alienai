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

function safeNum(v: any): number {
  return Number.isFinite(Number(v)) ? Number(v) : 0;
}

function safeStr(v: any): string {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function capWords(s: string) {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export async function GET(req: NextRequest) {
  try {
    /* ── Auth ───────────────────────────────────────────────────── */
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return jsonErr("Unauthorised", 401);

    const url = new URL(req.url);
    const artifactId = safeStr(url.searchParams.get("artifactId") ?? url.searchParams.get("id")).trim();
    if (!artifactId) return jsonErr("artifactId required", 400);

    const admin = createServiceClient();

    /* ── Load artifact + project ────────────────────────────────── */
    const { data: artifact, error: artErr } = await admin
      .from("artifacts")
      .select("id, title, type, project_id, content_json")
      .eq("id", artifactId)
      .maybeSingle();

    if (artErr) {
      console.error("[xlsx] Artifact query failed:", artErr.message);
      return jsonErr(`Artifact query failed: ${artErr.message}`, 500);
    }

    if (!artifact) return jsonErr("Artifact not found", 404);

    const { data: project, error: projectErr } = await admin
      .from("projects")
      .select("id, title, project_code")
      .eq("id", artifact.project_id)
      .maybeSingle();

    if (projectErr) console.error("[xlsx] Project lookup failed:", projectErr.message);

    /* ── Parse content ──────────────────────────────────────────── */
    const content = (artifact.content_json as any) ?? {};
    const currency = safeStr(content.currency || "GBP");
    const sym = currency;
    const costLines   = Array.isArray(content.cost_lines)      ? content.cost_lines      : [];
    const resources   = Array.isArray(content.resources)       ? content.resources       : [];
    const changeExp   = Array.isArray(content.change_exposure) ? content.change_exposure : [];
    const invoices    = Array.isArray(content.invoices)        ? content.invoices        : [];
    const monthlyData = (content.monthly_data ?? {}) as Record<string, any>;
    const fyConfig    = (content.fy_config ?? {}) as any;
    const projTitle   = safeStr(project?.title || "Project");
    const projCode    = safeStr(project?.project_code || "");
    const artifactTitle = safeStr(artifact.title || "Financial Plan");
    const projectId   = safeStr(artifact.project_id);

    /* ── FIX: Fetch heatmap people (real planned days + cost) ───── */
    // The Resources tab in the UI reads from the heatmap API, not content.resources.
    // content.resources often has planned_days = 0 for heatmap-allocated people.
    let heatmapPeople: any[] = [];
    try {
      const heatmapUrl = new URL(
        `/api/artifacts/financial-plan/resource-plan-sync`,
        req.url,
      );
      heatmapUrl.searchParams.set("projectId", projectId);
      heatmapUrl.searchParams.set("artifactId", artifactId);
      const heatmapRes = await fetch(heatmapUrl.toString(), {
        headers: { cookie: req.headers.get("cookie") || "" },
        cache: "no-store",
      });
      const heatmapJson = await heatmapRes.json().catch(() => ({ ok: false }));
      if (heatmapJson.ok && Array.isArray(heatmapJson.people)) {
        heatmapPeople = heatmapJson.people;
      }
    } catch (e: any) {
      console.warn("[xlsx] Heatmap fetch failed, falling back to content.resources:", e?.message);
    }

    /* ── FIX: Fetch approved timesheet days per person ──────────── */
    // Builds a map of person_id → total approved days from approved timesheets.
    const approvedDaysByPerson: Record<string, number> = {};
    const approvedCostByPerson: Record<string, number> = {};
    let totalApprovedDays = 0;

    try {
      // weekly_resource_allocations stores approved timesheet entries
      const { data: tsRows } = await admin
        .from("weekly_resource_allocations")
        .select("person_id, user_id, approved_days, cost_per_day, status")
        .eq("project_id", projectId)
        .in("status", ["approved", "Approved"]);

      if (tsRows && tsRows.length > 0) {
        for (const ts of tsRows) {
          const pid = safeStr(ts.person_id || ts.user_id).trim();
          if (!pid) continue;
          const days = safeNum(ts.approved_days);
          const cost = safeNum(ts.cost_per_day) * days;
          approvedDaysByPerson[pid] = (approvedDaysByPerson[pid] ?? 0) + days;
          approvedCostByPerson[pid] = (approvedCostByPerson[pid] ?? 0) + cost;
          totalApprovedDays += days;
        }
      }
    } catch {
      // Silently fall back — approved days will show as 0 if table doesn't exist
    }

    // If the weekly table didn't work, try the standard timesheet_entries table
    if (totalApprovedDays === 0) {
      try {
        const { data: tsRows2 } = await admin
          .from("timesheet_entries")
          .select("resource_id, person_id, user_id, approved_days, rate")
          .eq("project_id", projectId);

        if (tsRows2 && tsRows2.length > 0) {
          for (const ts of tsRows2) {
            if (safeStr(ts.resource_id) === "__weekly__") continue;
            const pid = safeStr(ts.person_id || ts.user_id || ts.resource_id).trim();
            if (!pid || pid.startsWith("__")) continue;
            const days = safeNum(ts.approved_days);
            const rate = safeNum(ts.rate);
            approvedDaysByPerson[pid] = (approvedDaysByPerson[pid] ?? 0) + days;
            approvedCostByPerson[pid] = (approvedCostByPerson[pid] ?? 0) + rate * days;
            totalApprovedDays += days;
          }
        }
      } catch {
        // Silently ignore — approved days will show as 0
      }
    }

    /* ── ExcelJS ────────────────────────────────────────────────── */
    const ExcelJS = await import("exceljs");
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
      grey:   { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF4F4F2" } },
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
        cell.fill = fill;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = NAVY_BORDER;
      });
      row.height = 28;
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

    function moneyFmt(_ws: any, row: any, col: number, val: number, colorArgb?: string) {
      const cell = row.getCell(col);
      cell.value = val;
      cell.numFmt = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
      cell.alignment = { horizontal: "right" };
      cell.font = { name: "Arial", size: 10, ...(colorArgb ? { color: { argb: colorArgb } } : {}) };
      cell.border = BORDER_THIN();
    }

    function pctFmt(row: any, col: number, val: number, colorArgb?: string) {
      const cell = row.getCell(col);
      cell.value = val;
      cell.numFmt = "0.0%;(0.0%);-";
      cell.alignment = { horizontal: "right" };
      cell.font = { name: "Arial", size: 10, ...(colorArgb ? { color: { argb: colorArgb } } : {}) };
      cell.border = BORDER_THIN();
    }

    function textCell(row: any, col: number, val: string, opts: any = {}) {
      const cell = row.getCell(col);
      cell.value = val;
      cell.font = { name: "Arial", size: 10, ...opts.font };
      cell.alignment = { vertical: "middle", wrapText: true, ...opts.alignment };
      cell.border = BORDER_THIN();
      if (opts.fill) cell.fill = opts.fill;
    }

    function dataRow(ws: any, altIdx: number) {
      const row = ws.addRow([]);
      row.fill = altIdx % 2 === 0 ? FILLS.white : FILLS.alt;
      row.height = 18;
      return row;
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 1 — SUMMARY
    ════════════════════════════════════════════════════════════ */
    const wsSummary = wb.addWorksheet("Summary", {
      properties: { tabColor: { argb: "FF0A1628" } },
    });

    wsSummary.columns = [
      { width: 34 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 },
    ];

    titleBlock(
      wsSummary,
      `${projCode ? projCode + " – " : ""}${projTitle}`,
      `${artifactTitle}   |   Exported ${new Date().toLocaleDateString("en-GB")}`,
    );

    const hdrR = hdrRow(wsSummary, ["Financial Summary", "", "", "", ""]);
    wsSummary.mergeCells(`A${hdrR.number}:E${hdrR.number}`);

    const approvedBudget = safeNum(content.total_approved_budget);
    const totalBudgeted  = costLines.reduce((s: number, l: any) => s + safeNum(l.budgeted), 0);
    const totalActual    = costLines.reduce((s: number, l: any) => s + safeNum(l.actual), 0);
    const totalForecast  = costLines.reduce((s: number, l: any) => s + safeNum(l.forecast), 0);
    const forecastVar    = approvedBudget ? totalForecast - approvedBudget : 0;
    const pendingExp     = changeExp
      .filter((c: any) => c.status === "pending")
      .reduce((s: number, c: any) => s + safeNum(c.cost_impact), 0);
    const approvedExp    = changeExp
      .filter((c: any) => c.status === "approved")
      .reduce((s: number, c: any) => s + safeNum(c.cost_impact), 0);

    const kpis: [string, number, string?][] = [
      ["Total Approved Budget",          approvedBudget, "FF2A6E47"],
      ["Total Budgeted (cost lines)",    totalBudgeted,  undefined],
      ["Total Actual Spend (timesheets)", totalActual,   "FF0E7490"],
      ["Total Forecast",                 totalForecast,  forecastVar > 0 ? "FFB83A2E" : "FF2A6E47"],
      ["Forecast Variance vs Approved",  forecastVar,    forecastVar > 0 ? "FFB83A2E" : "FF2A6E47"],
      ["Approved Change Exposure",       approvedExp,    undefined],
      ["Pending Change Exposure",        pendingExp,     pendingExp > 0 ? "FF8A5B1A" : undefined],
    ];

    kpis.forEach(([label, val, color], i) => {
      const row = wsSummary.addRow([label, val]);
      row.height = 20;
      row.fill = i % 2 === 0 ? FILLS.white : FILLS.alt;
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
      tr.height = 80;
      wsSummary.mergeCells(`A${tr.number}:E${tr.number}`);
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 2 — COST BREAKDOWN
    ════════════════════════════════════════════════════════════ */
    const wsCost = wb.addWorksheet("Cost Breakdown", {
      properties: { tabColor: { argb: "FF1B3652" } },
    });

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
      const tRow  = wsCost.addRow([]);
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
        [6, tVar, tVar > 0 ? "FFFF9999" : "FF99FFcc"],
      ] as [number, number, string][]) {
        moneyFmt(wsCost, tRow, col, val, clr);
        tRow.getCell(col).fill = FILLS.sub;
        tRow.getCell(col).font = { bold: true, color: { argb: clr }, name: "Arial", size: 10 };
      }

      [7, 8].forEach((c) => {
        tRow.getCell(c).border = NAVY_BORDER;
        tRow.getCell(c).fill   = FILLS.sub;
      });
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 3 — MONTHLY PHASING
    ════════════════════════════════════════════════════════════ */
    const hasMonthly = Object.keys(monthlyData).length > 0 && fyConfig?.fy_start_month;

    if (hasMonthly && costLines.length > 0) {
      const wsM = wb.addWorksheet("Monthly Phasing", {
        properties: { tabColor: { argb: "FF2A6E47" } },
      });

      const monthKeys: string[] = [];
      let mo = Number(fyConfig.fy_start_month);
      let yr = Number(fyConfig.fy_start_year);
      const numMonths = Number(fyConfig.num_months) || 12;

      for (let i = 0; i < numMonths; i++) {
        monthKeys.push(`${yr}-${String(mo).padStart(2, "0")}`);
        mo += 1;
        if (mo > 12) { mo = 1; yr += 1; }
      }

      wsM.columns = [
        { width: 20 },
        { width: 28 },
        ...monthKeys.flatMap(() => [{ width: 11 }, { width: 11 }, { width: 11 }]),
        { width: 14 }, { width: 14 }, { width: 14 },
      ];

      titleBlock(
        wsM,
        "Monthly Phasing",
        `${artifactTitle}  |  FY ${fyConfig.fy_start_year}/${String(Number(fyConfig.fy_start_year || 0) + 1).slice(2)}`,
      );

      const monthLabelRow = wsM.addRow([
        "", "",
        ...monthKeys.flatMap((mk) => {
          const [, mm] = mk.split("-");
          return [MONTH_SHORT[Number(mm) - 1], "", ""];
        }),
        "Total", "", "",
      ]);

      monthLabelRow.height = 22;
      monthLabelRow.eachCell((cell: any) => {
        cell.fill      = FILLS.sub;
        cell.border    = NAVY_BORDER;
        cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
        cell.alignment = { horizontal: "center", vertical: "middle" };
      });

      const baseCol = 3;
      monthKeys.forEach((_, idx) => {
        const s = baseCol + idx * 3;
        wsM.mergeCells(monthLabelRow.number, s, monthLabelRow.number, s + 2);
      });

      const totStart = baseCol + monthKeys.length * 3;
      wsM.mergeCells(monthLabelRow.number, totStart, monthLabelRow.number, totStart + 2);

      const subRow = wsM.addRow([
        "Category", "Description",
        ...monthKeys.flatMap(() => ["Budget", "Actual", "Forecast"]),
        "Budget", "Actual", "Forecast",
      ]);

      subRow.height = 20;
      subRow.eachCell((cell: any) => {
        cell.fill      = FILLS.hdr;
        cell.border    = NAVY_BORDER;
        cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
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
          totBudByMo[mi] += b;
          totActByMo[mi] += a;
          totFctByMo[mi] += f;
        });

        rowVals.push(lB, lA, lF);

        const row = wsM.addRow(rowVals);
        row.fill   = i % 2 === 0 ? FILLS.white : FILLS.alt;
        row.height = 17;

        [1, 2].forEach((c) => {
          row.getCell(c).font      = { name: "Arial", size: 9 };
          row.getCell(c).alignment = { vertical: "middle" };
          row.getCell(c).border    = BORDER_THIN();
        });

        const totalColStart = 2 + monthKeys.length * 3 + 1;
        for (let ci = 3; ci <= totalColStart + 2; ci++) {
          const cell           = row.getCell(ci);
          cell.numFmt          = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
          cell.alignment       = { horizontal: "right" };
          cell.border          = BORDER_THIN();
          cell.font            = { name: "Arial", size: 9, bold: ci >= totalColStart };
          // Actual columns violet background
          if (ci < totalColStart && (ci - 3) % 3 === 1 && row.getCell(ci).value) {
            cell.fill = FILLS.violet;
          }
        }
      });

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
        cell.fill      = FILLS.sub;
        cell.border    = NAVY_BORDER;
        cell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 9 };
        if (col > 2) {
          cell.numFmt    = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
          cell.alignment = { horizontal: "right" };
        }
      });

      wsM.views = [{ state: "frozen", xSplit: 2, ySplit: subRow.number, showGridLines: false }];
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 4 — RESOURCES
       FIX: reads from heatmap API (real planned days + cost) and
       adds Approved Days & Actual Cost columns from timesheets.
       Falls back to content.resources if heatmap unavailable.
    ════════════════════════════════════════════════════════════ */
    const wsRes = wb.addWorksheet("Resources", {
      properties: { tabColor: { argb: "FF4A3A7A" } },
    });

    // Use heatmap people if available, otherwise fall back to manual resources
    const useHeatmap = heatmapPeople.length > 0;

    wsRes.columns = useHeatmap
      ? [
          { width: 24 }, // Name
          { width: 20 }, // Job Title
          { width: 14 }, // Type
          { width: 12 }, // Rate Method
          { width: 14 }, // Cost/Day
          { width: 14 }, // Planned Days
          { width: 16 }, // Approved Days (locked)
          { width: 14 }, // Variance
          { width: 16 }, // Planned Cost
          { width: 16 }, // Actual Cost (locked)
          { width: 14 }, // Weeks
          { width: 30 }, // Notes
        ]
      : [
          { width: 24 }, { width: 20 }, { width: 14 }, { width: 14 },
          { width: 16 }, { width: 14 }, { width: 16 }, { width: 30 },
        ];

    titleBlock(wsRes, "Resources", `${artifactTitle}  |  ${new Date().toLocaleDateString("en-GB")}`);

    if (useHeatmap) {
      hdrRow(wsRes, [
        "Name", "Job Title", "Type", "Rate Method",
        `Cost/Day (${sym})`, "Planned Days",
        "Approved Days\n(Timesheets)", "Variance\n(days)",
        `Planned Cost (${sym})`, `Actual Cost (${sym})\n🔒 Locked`,
        "Weeks", "Notes",
      ]);

      let totalPlannedCost = 0;
      let totalActualCost  = 0;
      let totalPlannedDays = 0;
      let totalApprDays    = 0;

      heatmapPeople.forEach((person: any, i: number) => {
        const personId    = safeStr(person.person_id);
        const plannedDays = safeNum(person.total_days);
        const costPerDay  = safeNum(person.cost_day_rate);
        const plannedCost = safeNum(person.planned_cost) || costPerDay * plannedDays;
        const apprDays    = approvedDaysByPerson[personId] ?? 0;
        const actualCost  = approvedCostByPerson[personId] ?? (apprDays > 0 && costPerDay > 0 ? apprDays * costPerDay : 0);
        const variance    = apprDays > 0 ? apprDays - plannedDays : null;

        totalPlannedCost += plannedCost;
        totalActualCost  += actualCost;
        totalPlannedDays += plannedDays;
        totalApprDays    += apprDays;

        const row = dataRow(wsRes, i);

        textCell(row, 1, safeStr(person.name), { font: { bold: true } });
        textCell(row, 2, safeStr(person.job_title || person.role_title || ""));
        textCell(row, 3, "Internal");
        textCell(row, 4, "Day Rate");
        moneyFmt(wsRes, row, 5, costPerDay);

        const pdCell       = row.getCell(6);
        pdCell.value       = plannedDays;
        pdCell.numFmt      = "0.0";
        pdCell.alignment   = { horizontal: "right" };
        pdCell.font        = { name: "Arial", size: 10 };
        pdCell.border      = BORDER_THIN();

        // Approved Days — violet (locked from timesheets)
        const adCell       = row.getCell(7);
        adCell.value       = apprDays > 0 ? apprDays : null;
        adCell.numFmt      = "0.0";
        adCell.alignment   = { horizontal: "right" };
        adCell.font        = { name: "Arial", size: 10, bold: true, color: { argb: "FF0E7490" } };
        adCell.fill        = FILLS.violet;
        adCell.border      = BORDER_THIN("FF0E7490");

        // Variance
        const varCell      = row.getCell(8);
        varCell.value      = variance !== null ? variance : null;
        varCell.numFmt     = '+0.0;-0.0;"-"';
        varCell.alignment  = { horizontal: "right" };
        varCell.font       = {
          name: "Arial", size: 10, bold: variance !== null,
          color: { argb: variance === null ? "FF888888" : variance > 0 ? "FFB83A2E" : "FF2A6E47" },
        };
        varCell.border     = BORDER_THIN();

        moneyFmt(wsRes, row, 9, plannedCost, "FF1B3652");

        // Actual Cost — violet (locked)
        const acCell       = row.getCell(10);
        acCell.value       = actualCost > 0 ? actualCost : null;
        acCell.numFmt      = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
        acCell.alignment   = { horizontal: "right" };
        acCell.font        = { name: "Arial", size: 10, bold: true, color: { argb: "FF0E7490" } };
        acCell.fill        = FILLS.violet;
        acCell.border      = BORDER_THIN("FF0E7490");

        const wkCell       = row.getCell(11);
        wkCell.value       = safeNum(person.week_count) || null;
        wkCell.alignment   = { horizontal: "right" };
        wkCell.font        = { name: "Arial", size: 10 };
        wkCell.border      = BORDER_THIN();

        textCell(row, 12, `From heatmap${person.rate_source ? ` · ${person.rate_source} rate` : ""}`);
      });

      // Totals row
      const tRow    = wsRes.addRow([]);
      tRow.height   = 22;
      tRow.fill     = FILLS.sub;

      tRow.getCell(1).value  = "TOTAL";
      tRow.getCell(1).font   = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
      tRow.getCell(1).border = NAVY_BORDER;

      [2, 3, 4, 5, 8, 11, 12].forEach((c) => {
        tRow.getCell(c).border = NAVY_BORDER;
        tRow.getCell(c).fill   = FILLS.sub;
      });

      const tpdCell     = tRow.getCell(6);
      tpdCell.value     = totalPlannedDays;
      tpdCell.numFmt    = "0.0";
      tpdCell.alignment = { horizontal: "right" };
      tpdCell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
      tpdCell.fill      = FILLS.sub;
      tpdCell.border    = NAVY_BORDER;

      const tadCell     = tRow.getCell(7);
      tadCell.value     = totalApprDays > 0 ? totalApprDays : null;
      tadCell.numFmt    = "0.0";
      tadCell.alignment = { horizontal: "right" };
      tadCell.font      = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
      tadCell.fill      = FILLS.violet;
      tadCell.border    = NAVY_BORDER;

      moneyFmt(wsRes, tRow, 9, totalPlannedCost, "FFFFFFFF");
      tRow.getCell(9).fill = FILLS.sub;
      tRow.getCell(9).font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };

      moneyFmt(wsRes, tRow, 10, totalActualCost > 0 ? totalActualCost : 0, "FFFFFFFF");
      tRow.getCell(10).fill = FILLS.violet;
      tRow.getCell(10).font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };

      // Locked note
      wsRes.addRow([]);
      const noteRow = wsRes.addRow([
        "🔒  Approved Days & Actual Cost are locked — computed from approved timesheets × rate card. Planned days come from the capacity heatmap.",
      ]);
      noteRow.getCell(1).font      = { italic: true, size: 9, color: { argb: "FF0E7490" }, name: "Arial" };
      noteRow.getCell(1).fill      = FILLS.violet;
      noteRow.getCell(1).alignment = { wrapText: true };
      wsRes.mergeCells(`A${noteRow.number}:L${noteRow.number}`);
      noteRow.height = 20;

    } else {
      // Fallback: original format from content.resources
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

        const row = dataRow(wsRes, i);
        textCell(row, 1, safeStr(r.name));
        textCell(row, 2, capWords(safeStr(r.role)));
        textCell(row, 3, capWords(safeStr(r.type)));
        textCell(row, 4, r.rate_type === "day_rate" ? "Day Rate" : "Monthly");
        moneyFmt(wsRes, row, 5, rate);

        const qCell   = row.getCell(6);
        qCell.value   = qty;
        qCell.numFmt  = "0.0";
        qCell.alignment = { horizontal: "right" };
        qCell.font    = { name: "Arial", size: 10 };
        qCell.border  = BORDER_THIN();

        moneyFmt(wsRes, row, 7, total, "FF1B3652");
        textCell(row, 8, safeStr(r.notes));
      });

      const tRow   = wsRes.addRow([]);
      tRow.height  = 20;
      tRow.fill    = FILLS.sub;
      tRow.getCell(1).value  = "TOTAL";
      tRow.getCell(1).font   = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
      [1, 2, 3, 4, 5, 6, 8].forEach((c) => {
        tRow.getCell(c).border = NAVY_BORDER;
        tRow.getCell(c).fill   = FILLS.sub;
      });
      moneyFmt(wsRes, tRow, 7, resTotal);
      tRow.getCell(7).fill = FILLS.sub;
      tRow.getCell(7).font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 5 — CHANGE EXPOSURE
       FIX: always render this sheet (even when changeExp is empty)
    ════════════════════════════════════════════════════════════ */
    const wsCE = wb.addWorksheet("Change Exposure", {
      properties: { tabColor: { argb: "FF8A5B1A" } },
    });

    wsCE.columns = [
      { width: 16 }, { width: 30 }, { width: 18 }, { width: 16 }, { width: 30 },
    ];

    titleBlock(wsCE, "Change Exposure", `${artifactTitle}  |  ${new Date().toLocaleDateString("en-GB")}`);

    // Exposure summary stats
    const statRow = wsCE.addRow(["Approved Exposure", "", "Pending Exposure", "", "Total Exposure"]);
    statRow.height = 16;
    statRow.eachCell((c: any) => { c.font = { name: "Arial", size: 8, bold: true, color: { argb: "FF888888" } }; });

    const statValRow = wsCE.addRow([approvedExp, "", pendingExp, "", approvedExp + pendingExp]);
    statValRow.height = 26;
    [1, 3, 5].forEach((c, idx) => {
      const cell     = statValRow.getCell(c);
      cell.numFmt    = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
      cell.alignment = { horizontal: "left" };
      cell.font      = {
        name: "Arial", size: 14, bold: true,
        color: { argb: idx === 0 ? "FF1B3652" : idx === 1 ? (pendingExp > 0 ? "FF8A5B1A" : "FF888888") : "FF0A1628" },
      };
    });
    wsCE.addRow([]);

    hdrRow(wsCE, ["Change Ref", "Title", `Cost Impact (${sym})`, "Status", "Notes"]);

    if (changeExp.length === 0) {
      const emptyRow = wsCE.addRow(["No change exposure recorded for this project.", "", "", "", ""]);
      emptyRow.getCell(1).font      = { italic: true, size: 10, color: { argb: "FF888888" }, name: "Arial" };
      emptyRow.getCell(1).alignment = { horizontal: "center" };
      wsCE.mergeCells(`A${emptyRow.number}:E${emptyRow.number}`);
      emptyRow.height = 32;
    } else {
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

      const totRow   = wsCE.addRow([]);
      totRow.height  = 20;
      totRow.fill    = FILLS.sub;
      totRow.getCell(1).value  = "TOTAL";
      totRow.getCell(1).font   = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
      [1, 2, 4, 5].forEach((c) => {
        totRow.getCell(c).border = NAVY_BORDER;
        totRow.getCell(c).fill   = FILLS.sub;
      });
      moneyFmt(wsCE, totRow, 3, approvedExp + pendingExp);
      totRow.getCell(3).fill = FILLS.sub;
      totRow.getCell(3).font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
    }

    /* ════════════════════════════════════════════════════════════
       SHEET 6 — BILLING
       FIX: always render this sheet (even when invoices is empty)
    ════════════════════════════════════════════════════════════ */
    const wsBill = wb.addWorksheet("Billing", {
      properties: { tabColor: { argb: "FF0E7490" } },
    });

    wsBill.columns = [
      { width: 14 }, { width: 13 }, { width: 24 }, { width: 30 },
      { width: 18 }, { width: 14 }, { width: 13 }, { width: 14 }, { width: 20 },
    ];

    titleBlock(wsBill, "Billing", `${artifactTitle}  |  ${new Date().toLocaleDateString("en-GB")}`);

    let totalInvoiced = 0;
    let totalPaid     = 0;

    invoices.forEach((inv: any) => {
      const amount = safeNum(inv.amount);
      if (inv.status !== "cancelled") totalInvoiced += amount;
      if (inv.status === "paid")      totalPaid     += amount;
    });

    // Summary stats (always shown)
    const billStatRow = wsBill.addRow(["Total Invoiced", "", "Cash Received", "", "Outstanding"]);
    billStatRow.height = 16;
    billStatRow.eachCell((c: any) => { c.font = { name: "Arial", size: 8, bold: true, color: { argb: "FF888888" } }; });

    const billStatVal = wsBill.addRow([
      totalInvoiced, "", totalPaid, "", totalInvoiced - totalPaid,
    ]);
    billStatVal.height = 26;
    for (const [col, clr] of [[1, "FF1B3652"], [3, "FF2A6E47"], [5, totalInvoiced - totalPaid > 0 ? "FF8A5B1A" : "FF2A6E47"]] as [number, string][]) {
      const c     = billStatVal.getCell(col);
      c.numFmt    = `"${sym} "#,##0;("${sym} "#,##0);"-"`;
      c.alignment = { horizontal: "left" };
      c.font      = { name: "Arial", size: 14, bold: true, color: { argb: clr } };
    }

    wsBill.addRow([]);

    hdrRow(wsBill, [
      "Invoice #", "Date", "Customer", "Description",
      `Amount (${sym})`, "Status", "Due Date", "Paid Date", "PO Reference",
    ]);

    if (invoices.length === 0) {
      const emptyRow = wsBill.addRow(["No invoices logged yet. Add billing milestones in the Financial Plan → Billing tab.", "", "", "", "", "", "", "", ""]);
      emptyRow.getCell(1).font      = { italic: true, size: 10, color: { argb: "FF888888" }, name: "Arial" };
      emptyRow.getCell(1).alignment = { horizontal: "center" };
      wsBill.mergeCells(`A${emptyRow.number}:I${emptyRow.number}`);
      emptyRow.height = 36;
    } else {
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
          isCredit ? "FFB83A2E" : isPaid ? "FF2A6E47" : isOver ? "FFB83A2E" : undefined);
        textCell(row, 6, capWords(safeStr(inv.status)), {
          fill: isPaid ? FILLS.green : isOver ? FILLS.red : isCredit ? FILLS.red : undefined,
          font: { bold: true, color: { argb: isPaid ? "FF2A6E47" : isOver ? "FFB83A2E" : "FF64748B" } },
        });
        textCell(row, 7, safeStr(inv.due_date));
        textCell(row, 8, safeStr(inv.payment_date));
        textCell(row, 9, safeStr(inv.po_reference));
      });

      wsBill.addRow([]);
      for (const [label, val, clr] of [
        ["Total Invoiced", totalInvoiced, "FF1B3652"],
        ["Cash Received",  totalPaid,     "FF2A6E47"],
        ["Outstanding",    totalInvoiced - totalPaid, totalInvoiced - totalPaid > 0 ? "FF8A5B1A" : "FF2A6E47"],
      ] as [string, number, string][]) {
        const r = wsBill.addRow([label]);
        r.getCell(1).font = { bold: true, name: "Arial", size: 10 };
        moneyFmt(wsBill, r, 5, val, clr);
      }
    }

    /* ── Stream response ────────────────────────────────────────── */
    const buffer = await wb.xlsx.writeBuffer();
    const out = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer as ArrayBuffer);

    const safeName = (artifact.title || "financial-plan")
      .replace(/[^a-zA-Z0-9\-_ ]/g, "")
      .replace(/\s+/g, "-")
      .slice(0, 60);

    const filename = `${projCode ? projCode + "-" : ""}${safeName}-${new Date().toISOString().slice(0, 10)}.xlsx`;

    return new NextResponse(out, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[financial-plan/export/xlsx] FATAL:", e?.message, e?.stack);
    return jsonErr(e?.message ?? "Export failed", 500);
  }
}