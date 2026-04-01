// src/app/api/portfolio/budget-phasing/export/route.ts
// GET ?fyStart=4&fyYear=2026&fyMonths=12&scope=active|all&projectIds=id1,id2
//
// Exports the SAME data as the screen — cost categories as rows, months as columns.
// Format matches FinancialPlanMonthlyView: BUD / ACT / FCT per month, totals column.

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

function safeNum(v: any): number { const n = Number(v); return Number.isFinite(n) ? n : 0; }
function safeStr(v: any): string { return typeof v === "string" ? v : v == null ? "" : String(v); }

function buildMonthKeys(fyStart: number, fyYear: number, numMonths: number): string[] {
  const keys: string[] = [];
  let month = fyStart, year = fyYear;
  for (let i = 0; i < numMonths; i++) {
    keys.push(`${year}-${String(month).padStart(2, "0")}`);
    if (++month > 12) { month = 1; year++; }
  }
  return keys;
}

function currentMonthKey() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}`;
}

function colLetter(n: number): string {
  let r = "";
  while (n > 0) { const rem = (n - 1) % 26; r = String.fromCharCode(65 + rem) + r; n = Math.floor((n - 1) / 26); }
  return r;
}

function monthLabel(mk: string): string {
  const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const [y, m] = mk.split("-");
  return `${MONTHS[Number(m) - 1]} ${String(y).slice(2)}`;
}

function fyLabel(fyYear: number, fyStart: number): string {
  return fyStart === 1 ? String(fyYear) : `${fyYear}/${String(fyYear + 1).slice(2)}`;
}

const PM_ROLE_CANDIDATES = [
  "project_manager","project manager","pm",
  "programme_manager","program_manager","programme manager","program manager",
  "delivery_manager","delivery manager",
];

function displayName(profile: any): string {
  const full = safeStr(profile?.full_name).trim();
  const disp = safeStr(profile?.display_name).trim();
  const name = safeStr(profile?.name).trim();
  const email= safeStr(profile?.email).trim();
  if (full && !full.includes("@")) return full;
  if (disp && !disp.includes("@")) return disp;
  if (name && !name.includes("@")) return name;
  return email.includes("@") ? email.split("@")[0] : email || "Unknown";
}

export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const url       = new URL(req.url);
    const fyStart   = Math.max(1, Math.min(12, parseInt(url.searchParams.get("fyStart") ?? "4", 10)));
    const rawMonths = parseInt(url.searchParams.get("fyMonths") ?? "12", 10);
    const numMonths = [12,18,24,36].includes(rawMonths) ? rawMonths : 12;
    const nowYear   = new Date().getFullYear();
    const nowMonth  = new Date().getMonth() + 1;
    const defaultFy = nowMonth >= fyStart ? nowYear : nowYear - 1;
    const fyYear    = parseInt(url.searchParams.get("fyYear") ?? String(defaultFy), 10);
    const scope     = url.searchParams.get("scope") ?? "active";
    const filterIds = (url.searchParams.get("projectIds") ?? "").split(",").map(s => s.trim()).filter(Boolean);

    const monthKeys = buildMonthKeys(fyStart, fyYear, numMonths);
    const monthSet  = new Set(monthKeys);
    const nowKey    = currentMonthKey();
    const fy        = fyLabel(fyYear, fyStart);
    const scopeLabel= scope === "all" ? "All projects (active + archived)" : "Active projects only";

    // Organisation
    const { data: orgMem } = await supabase
      .from("organisation_members").select("organisation_id")
      .eq("user_id", auth.user.id).is("removed_at", null).limit(1).maybeSingle();
    const orgId = safeStr((orgMem as any)?.organisation_id);
    if (!orgId) return NextResponse.json({ error: "No organisation" }, { status: 404 });

    // Projects
    let projQ = supabase.from("projects").select("id, title, project_code, project_manager_id, department")
      .eq("organisation_id", orgId).neq("resource_status", "pipeline");
    if (scope === "active") projQ = projQ.is("deleted_at", null);
    const { data: projectRows } = await projQ.order("title");
    const allProjects = (projectRows ?? []) as any[];
    const allProjectIds = allProjects.map((p: any) => safeStr(p.id));

    // PM names
    const { data: pmMembers } = await supabase.from("project_members")
      .select("project_id, user_id, role").in("project_id", allProjectIds)
      .eq("is_active", true).in("role", PM_ROLE_CANDIDATES);
    const pmUserIds   = [...new Set((pmMembers ?? []).map((m: any) => safeStr(m.user_id)).filter(Boolean))];
    const fallbackIds = [...new Set(allProjects.map((p: any) => safeStr(p.project_manager_id)).filter(Boolean))];
    const allUserIds  = [...new Set([...pmUserIds, ...fallbackIds])];
    const profileById = new Map<string, any>();
    if (allUserIds.length) {
      const orFilter = allUserIds.flatMap(id => [`id.eq.${id}`,`user_id.eq.${id}`]).join(",");
      const { data: profiles } = await supabase.from("profiles")
        .select("id, user_id, full_name, display_name, name, email").or(orFilter);
      for (const p of (profiles ?? []) as any[]) {
        if (p.id)      profileById.set(safeStr(p.id), p);
        if (p.user_id) profileById.set(safeStr(p.user_id), p);
      }
    }
    const pmNameByProject = new Map<string, string>();
    for (const m of (pmMembers ?? []) as any[]) {
      const pid = safeStr(m.project_id);
      if (!pmNameByProject.has(pid)) {
        const prof = profileById.get(safeStr(m.user_id));
        if (prof) pmNameByProject.set(pid, displayName(prof));
      }
    }
    for (const p of allProjects) {
      const pid = safeStr(p.id), pmId = safeStr(p.project_manager_id);
      if (!pmNameByProject.has(pid) && pmId) {
        const prof = profileById.get(pmId);
        if (prof) pmNameByProject.set(pid, displayName(prof));
      }
    }

    // Which projects to aggregate
    const projectIds = filterIds.length ? allProjectIds.filter(id => filterIds.includes(id)) : allProjectIds;

    // Financial plans
    const { data: artifactRows } = await supabase.from("artifacts")
      .select("id, project_id, content_json, approval_status, type")
      .in("project_id", projectIds).ilike("type", "%financial%plan%");
    const rank = (s: string) => s === "approved" ? 3 : s === "submitted" ? 2 : 1;
    const artifactByProject = new Map<string, any>();
    for (const a of (artifactRows ?? []) as any[]) {
      const pid = safeStr(a.project_id), ex = artifactByProject.get(pid);
      if (!ex || rank(a.approval_status) > rank(ex.approval_status)) artifactByProject.set(pid, a);
    }

    // Aggregate by category (same logic as the GET route)
    const catTotals = new Map<string, Map<string, { budget: number; actual: number; forecast: number }>>();
    const catOrder  : string[] = [];
    const catSeen   = new Set<string>();
    let projectsWithPlan = 0;

    for (const id of projectIds) {
      const artifact = artifactByProject.get(id);
      if (!artifact?.content_json) continue;
      const cj      = artifact.content_json;
      const lines   = (Array.isArray(cj.cost_lines) ? cj.cost_lines : Array.isArray(cj.lines) ? cj.lines : []) as any[];
      const monthly = (cj.monthly_data ?? cj.monthlyData ?? {}) as Record<string, Record<string, any>>;
      if (!lines.length && !Object.keys(monthly).length) continue;
      projectsWithPlan++;
      for (const line of lines) {
        const lineId  = safeStr(line.id);
        const raw     = safeStr(line.description || "").trim();
        const display = raw || safeStr(line.category || "Uncategorised").trim() || "Uncategorised";
        const catKey  = display.toLowerCase();
        if (!catSeen.has(catKey)) { catSeen.add(catKey); catOrder.push(display); }
        for (const [mk, entry] of Object.entries(monthly[lineId] ?? {})) {
          if (!monthSet.has(mk)) continue;
          const e = entry as any;
          if (!catTotals.has(catKey)) catTotals.set(catKey, new Map());
          const m = catTotals.get(catKey)!, ex = m.get(mk) ?? { budget: 0, actual: 0, forecast: 0 };
          m.set(mk, {
            budget:   ex.budget   + safeNum(e?.budget   ?? e?.budgetAmount   ?? 0),
            actual:   ex.actual   + safeNum(e?.actual   ?? e?.actualAmount   ?? 0),
            forecast: ex.forecast + safeNum(e?.forecast ?? e?.forecastAmount ?? 0),
          });
        }
      }
    }

    // Build rows (same shape as screen)
    const aggLines = catOrder.map(display => {
      const catKey = display.toLowerCase();
      const catMap = catTotals.get(catKey)!;
      const monthData: Record<string, { budget: number; actual: number; forecast: number }> = {};
      for (const mk of monthKeys) {
        const e = catMap?.get(mk) ?? { budget: 0, actual: 0, forecast: 0 };
        monthData[mk] = e;
      }
      return { description: display, monthData };
    });

    // ── Build XLSX ──────────────────────────────────────────────────────────
    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.default.Workbook();
    wb.creator = "Aliena PMO"; wb.created = new Date();

    const ws = wb.addWorksheet("Portfolio Phasing");

    // Color palette matching the screen
    const NAVY   = "FF1B3652";
    const GREEN  = "FF2A6E47";
    const VIOLET = "FF4A3A7A";
    const RED    = "FFB83A2E";
    const GREY   = "FF6B7280";
    const WHITE  = "FFFFFFFF";
    const BLACK  = "FF0D0D0B";

    const headerFill  = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
    const gbpFmt = '£#,##0;(£#,##0);"-"';

    // Row 1: Title
    ws.mergeCells(1, 1, 1, 2 + monthKeys.length * 3 + 3);
    const titleCell = ws.getCell(1, 1);
    titleCell.value = `Portfolio Monthly Phasing — FY ${fy}`;
    titleCell.font  = { name: "Arial", size: 13, bold: true, color: { argb: BLACK } };
    titleCell.alignment = { horizontal: "left", vertical: "middle" };
    ws.getRow(1).height = 26;

    // Row 2: Meta
    ws.mergeCells(2, 1, 2, 2 + monthKeys.length * 3 + 3);
    const metaCell = ws.getCell(2, 1);
    metaCell.value = `${scopeLabel}  |  ${projectsWithPlan}/${projectIds.length} projects with plan  |  Generated: ${new Date().toLocaleDateString("en-GB")}`;
    metaCell.font  = { name: "Arial", size: 9, color: { argb: GREY } };
    metaCell.alignment = { horizontal: "left", vertical: "middle" };
    ws.getRow(2).height = 16;

    // Row 3: Month group headers — DARK NAVY per month group (3 cols each), then TOTAL (3 cols)
    ws.getRow(3).height = 18;
    ws.getCell(3, 1).value = "Cost Category";
    ws.getCell(3, 1).font  = { name: "Arial", size: 9, bold: true, color: { argb: WHITE } };
    ws.getCell(3, 1).fill  = headerFill(NAVY);
    ws.getCell(3, 1).alignment = { horizontal: "left", vertical: "middle" };

    ws.getCell(3, 2).value = "";
    ws.getCell(3, 2).fill  = headerFill(NAVY);

    let col = 3;
    for (const mk of monthKeys) {
      ws.mergeCells(3, col, 3, col + 2);
      const cell = ws.getCell(3, col);
      cell.value = monthLabel(mk);
      cell.font  = { name: "Arial", size: 9, bold: true, color: { argb: WHITE } };
      cell.fill  = headerFill(NAVY);
      cell.alignment = { horizontal: "center", vertical: "middle" };
      col += 3;
    }
    // FY Total header
    ws.mergeCells(3, col, 3, col + 2);
    const totHdr = ws.getCell(3, col);
    totHdr.value = "FY Total";
    totHdr.font  = { name: "Arial", size: 9, bold: true, color: { argb: WHITE } };
    totHdr.fill  = headerFill("FF111111");
    totHdr.alignment = { horizontal: "center", vertical: "middle" };

    // Row 4: Sub-column headers BUD / ACT / FCT per month
    ws.getRow(4).height = 14;
    ws.getCell(4, 1).value = "";
    ws.getCell(4, 1).fill  = headerFill("FFF5F5F0");
    ws.getCell(4, 2).value = "";
    ws.getCell(4, 2).fill  = headerFill("FFF5F5F0");

    col = 3;
    const SUB_LABELS = ["BUD", "ACT", "FCT"];
    const SUB_COLORS = [NAVY, VIOLET, GREEN];
    const SUB_BG     = ["FFEEF4F9", "FFF4F2FB", "FFF0F7F3"];

    for (let m = 0; m < monthKeys.length; m++) {
      for (let s = 0; s < 3; s++) {
        const cell = ws.getCell(4, col);
        cell.value = SUB_LABELS[s];
        cell.font  = { name: "Arial", size: 7, bold: true, color: { argb: SUB_COLORS[s] } };
        cell.fill  = headerFill(SUB_BG[s]);
        cell.alignment = { horizontal: "center" };
        col++;
      }
    }
    // Total sub-headers
    for (let s = 0; s < 3; s++) {
      const cell = ws.getCell(4, col);
      cell.value = SUB_LABELS[s];
      cell.font  = { name: "Arial", size: 7, bold: true, color: { argb: SUB_COLORS[s] } };
      cell.fill  = headerFill("FFE8E8E0");
      cell.alignment = { horizontal: "center" };
      col++;
    }

    // Style header border
    [3, 4].forEach(row => {
      ws.getRow(row).eachCell(cell => {
        cell.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } };
      });
    });

    // Data rows — cost categories
    const dataStart = 5;
    let currentRow  = dataStart;

    for (const { description, monthData } of aggLines) {
      const row   = ws.getRow(currentRow);
      row.height  = 14;
      const rowBg = currentRow % 2 === 0 ? "FFFAFAF8" : "FFFFFFFF";

      row.getCell(1).value = description;
      row.getCell(1).font  = { name: "Arial", size: 9, bold: true, color: { argb: BLACK } };
      row.getCell(1).fill  = headerFill(rowBg);
      row.getCell(2).fill  = headerFill(rowBg);

      let c = 3;
      let totBud = 0, totAct = 0, totFct = 0;

      for (const mk of monthKeys) {
        const e   = monthData[mk] ?? { budget: 0, actual: 0, forecast: 0 };
        const isPast = mk < nowKey;
        const vals = [e.budget, isPast ? e.actual : 0, e.forecast];
        totBud += e.budget; totAct += isPast ? e.actual : 0; totFct += e.forecast;

        for (let s = 0; s < 3; s++) {
          const cell = row.getCell(c);
          cell.value    = vals[s] || null;
          cell.numFmt   = gbpFmt;
          cell.font     = { name: "Arial", size: 8 };
          cell.fill     = headerFill(vals[s] === 0 ? rowBg : SUB_BG[s]);
          cell.alignment = { horizontal: "right" };
          c++;
        }
      }

      // Row totals
      const totVals = [totBud, totAct, totFct];
      for (let s = 0; s < 3; s++) {
        const cell = row.getCell(c);
        cell.value    = totVals[s] || null;
        cell.numFmt   = gbpFmt;
        cell.font     = { name: "Arial", size: 8, bold: true };
        cell.fill     = headerFill("FFE8E8E0");
        cell.alignment = { horizontal: "right" };
        c++;
      }

      row.eachCell(cell => { cell.border = { bottom: { style: "hair", color: { argb: "FFEEEEEE" } } }; });
      currentRow++;
    }

    // Portfolio Totals row
    const totRow   = ws.getRow(currentRow);
    totRow.height  = 18;
    totRow.getCell(1).value = "Portfolio Total";
    totRow.getCell(1).font  = { name: "Arial", size: 9, bold: true, color: { argb: WHITE } };
    totRow.getCell(1).fill  = headerFill(NAVY);
    totRow.getCell(2).fill  = headerFill(NAVY);

    let c2 = 3;
    for (let mi = 0; mi < monthKeys.length; mi++) {
      const mk    = monthKeys[mi];
      const isPast = mk < nowKey;
      const colStart = 3 + mi * 3;
      const subLabels = ["budget", "actual", "forecast"] as const;
      for (let s = 0; s < 3; s++) {
        const cell  = totRow.getCell(c2);
        const colL  = colLetter(colStart + s);
        const hasFc = s === 1 && !isPast; // actual in future = 0
        if (aggLines.length > 0 && !hasFc) {
          cell.value = { formula: `SUM(${colL}${dataStart}:${colL}${dataStart + aggLines.length - 1})` };
        } else {
          cell.value = 0;
        }
        cell.numFmt    = gbpFmt;
        cell.font      = { name: "Arial", size: 8, bold: true, color: { argb: WHITE } };
        cell.fill      = headerFill(NAVY);
        cell.alignment = { horizontal: "right" };
        c2++;
      }
    }
    // Grand totals
    for (let s = 0; s < 3; s++) {
      const colStart = 3 + monthKeys.length * 3 + s;
      const colL     = colLetter(colStart);
      const cell     = totRow.getCell(c2);
      cell.value     = aggLines.length > 0 ? { formula: `SUM(${colL}${dataStart}:${colL}${dataStart + aggLines.length - 1})` } : 0;
      cell.numFmt    = gbpFmt;
      cell.font      = { name: "Arial", size: 9, bold: true, color: { argb: WHITE } };
      cell.fill      = headerFill("FF111111");
      cell.alignment = { horizontal: "right" };
      c2++;
    }
    totRow.eachCell(cell => { cell.border = { top: { style: "medium", color: { argb: NAVY } } }; });

    // Column widths
    ws.getColumn(1).width = 26;
    ws.getColumn(2).width = 2;
    for (let i = 3; i <= 2 + (monthKeys.length + 1) * 3; i++) ws.getColumn(i).width = 9;

    // Freeze: category column + row headers
    ws.views = [{ state: "frozen", xSplit: 2, ySplit: 4, activeCell: "C5" }];

    // ── Sheet 2: Summary by project ────────────────────────────────────────
    const wsSummary = wb.addWorksheet("Project Summary");
    wsSummary.addRow([`Portfolio Budget Summary — FY ${fy}`]).getCell(1).font = { name: "Arial", size: 12, bold: true };
    wsSummary.addRow([scopeLabel]).getCell(1).font = { name: "Arial", size: 9, color: { argb: GREY } };
    wsSummary.addRow([]);

    const sumHdrs = ["Project", "Code", "PM", "Department", "Budget FCT", "Total FCT", "Total ACT", "Variance (£)", "Utilisation %"];
    const hRow = wsSummary.addRow(sumHdrs);
    hRow.eachCell(cell => {
      cell.font  = { name: "Arial", size: 9, bold: true, color: { argb: WHITE } };
      cell.fill  = headerFill(NAVY);
      cell.alignment = { horizontal: "center" };
    });

    for (const id of projectIds) {
      const proj    = allProjects.find((p: any) => safeStr(p.id) === id);
      if (!proj) continue;
      const artifact = artifactByProject.get(id);
      const cj       = artifact?.content_json;
      const lines    = cj ? (Array.isArray(cj.cost_lines) ? cj.cost_lines : Array.isArray(cj.lines) ? cj.lines : []) : [];
      const monthly  = cj ? (cj.monthly_data ?? cj.monthlyData ?? {}) : {};

      let totBud = 0, totFct = 0, totAct = 0;
      for (const line of lines as any[]) {
        const lineData = (monthly as any)[safeStr(line.id)] ?? {};
        for (const [mk, e] of Object.entries(lineData) as [string, any][]) {
          if (!monthSet.has(mk)) continue;
          totBud += safeNum(e?.budget   ?? 0);
          totFct += safeNum(e?.forecast ?? 0);
          if (mk < nowKey) totAct += safeNum(e?.actual ?? 0);
        }
      }

      const variance = totFct - totBud;
      const utilPct  = totBud > 0 ? totAct / totBud : null;
      const pmName   = pmNameByProject.get(id) ?? "";
      const dept     = safeStr(proj.department).trim();
      const code     = safeStr(proj.project_code) ? `PRJ-${proj.project_code}` : "";

      const dr = wsSummary.addRow([proj.title, code, pmName, dept, totBud, totFct, totAct, variance, utilPct]);
      dr.getCell(5).numFmt = gbpFmt;
      dr.getCell(6).numFmt = gbpFmt;
      dr.getCell(7).numFmt = gbpFmt;
      dr.getCell(8).numFmt = gbpFmt;
      dr.getCell(9).numFmt = "0.0%";
      dr.getCell(8).font   = { name: "Arial", size: 9, color: { argb: variance > 0 ? RED : GREEN } };
      dr.eachCell(cell => { cell.font = cell.font.color ? cell.font : { name: "Arial", size: 9 }; cell.border = { bottom: { style: "hair", color: { argb: "FFEEEEEE" } } }; });
    }

    [22, 10, 18, 16, 12, 12, 12, 12, 12].forEach((w, i) => { wsSummary.getColumn(i + 1).width = w; });

    // Serialize
    const buffer   = await wb.xlsx.writeBuffer();
    const filename = `portfolio-phasing-fy${fy.replace("/", "-")}.xlsx`;

    return new NextResponse(Buffer.from(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    console.error("[budget-phasing/export]", e);
    return NextResponse.json({ error: String(e?.message ?? "Export failed") }, { status: 500 });
  }
}