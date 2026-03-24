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
  return isFinite(Number(v)) ? Number(v) : 0;
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
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) return jsonErr("Unauthorised", 401);

    const url = new URL(req.url);
    const artifactId = safeStr(url.searchParams.get("artifactId") ?? url.searchParams.get("id")).trim();
    if (!artifactId) return jsonErr("artifactId required", 400);

    const admin = createServiceClient();

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

    const content = (artifact.content_json as any) ?? {};
    const currency = safeStr(content.currency || "GBP");
    const sym = currency;
    const costLines = Array.isArray(content.cost_lines) ? content.cost_lines : [];
    const resources = Array.isArray(content.resources) ? content.resources : [];
    const changeExp = Array.isArray(content.change_exposure) ? content.change_exposure : [];
    const invoices = Array.isArray(content.invoices) ? content.invoices : [];
    const monthlyData = (content.monthly_data ?? {}) as Record<string, any>;
    const fyConfig = (content.fy_config ?? {}) as any;
    const projTitle = safeStr(project?.title || "Project");
    const projCode = safeStr(project?.project_code || "");
    const artifactTitle = safeStr(artifact.title || "Financial Plan");

    const ExcelJS = await import("exceljs");
    const wb = new ExcelJS.Workbook();
    wb.creator = "Aliena";
    wb.created = new Date();

    const FILLS = {
      hdr: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0A1628" } },
      sub: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF1B3652" } },
      alt: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0F7FF" } },
      white: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFFFF" } },
      green: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0F7F3" } },
      amber: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFDF6EC" } },
      red: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFDF2F1" } },
      violet: { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFE0F7FA" } },
    };

    const BORDER_THIN = (argb = "FFE2E8F0") => ({
      top: { style: "thin" as const, color: { argb } },
      bottom: { style: "thin" as const, color: { argb } },
      left: { style: "thin" as const, color: { argb } },
      right: { style: "thin" as const, color: { argb } },
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

    const wsSummary = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF0A1628" } } });
    wsSummary.columns = [{ width: 34 }, { width: 22 }, { width: 18 }, { width: 18 }, { width: 18 }];
    titleBlock(
      wsSummary,
      `${projCode ? projCode + " – " : ""}${projTitle}`,
      `${artifactTitle}   |   Exported ${new Date().toLocaleDateString("en-GB")}`
    );

    const hdrR = hdrRow(wsSummary, ["Financial Summary", "", "", "", ""]);
    wsSummary.mergeCells(`A${hdrR.number}:E${hdrR.number}`);

    const approvedBudget = safeNum(content.total_approved_budget);
    const totalBudgeted = costLines.reduce((s: number, l: any) => s + safeNum(l.budgeted), 0);
    const totalActual = costLines.reduce((s: number, l: any) => s + safeNum(l.actual), 0);
    const totalForecast = costLines.reduce((s: number, l: any) => s + safeNum(l.forecast), 0);
    const forecastVar = approvedBudget ? totalForecast - approvedBudget : 0;
    const pendingExp = changeExp
      .filter((c: any) => c.status === "pending")
      .reduce((s: number, c: any) => s + safeNum(c.cost_impact), 0);
    const approvedExp = changeExp
      .filter((c: any) => c.status === "approved")
      .reduce((s: number, c: any) => s + safeNum(c.cost_impact), 0);

    const kpis: [string, number, string?][] = [
      ["Total Approved Budget", approvedBudget, "FF2A6E47"],
      ["Total Budgeted (cost lines)", totalBudgeted, undefined],
      ["Total Actual Spend", totalActual, "FF0E7490"],
      ["Total Forecast", totalForecast, forecastVar > 0 ? "FFB83A2E" : "FF2A6E47"],
      ["Forecast Variance vs Approved", forecastVar, forecastVar > 0 ? "FFB83A2E" : "FF2A6E47"],
      ["Approved Change Exposure", approvedExp, undefined],
      ["Pending Change Exposure", pendingExp, pendingExp > 0 ? "FF8A5B1A" : undefined],
    ];

    kpis.forEach(([label, val, color], i) => {
      const row = wsSummary.addRow([label, val]);
      row.height = 20;
      row.fill = i % 2 === 0 ? FILLS.white : FILLS.alt;
      row.getCell(1).font = { name: "Arial", size: 10, bold: true };
      row.getCell(1).border = BORDER_THIN();
      moneyFmt(wsSummary, row, 2, val, color);
    });

    for (const [heading, body] of [
      ["Plan Summary", content.summary],
      ["Variance Narrative", content.variance_narrative],
      ["Assumptions", content.assumptions],
    ] as [string, string][]) {
      if (!body) continue;
      wsSummary.addRow([]);
      const hr = hdrRow(wsSummary, [heading, "", "", "", ""]);
      wsSummary.mergeCells(`A${hr.number}:E${hr.number}`);
      const tr = wsSummary.addRow([body]);
      tr.getCell(1).alignment = { wrapText: true, vertical: "top" };
      tr.getCell(1).font = { name: "Arial", size: 10 };
      tr.height = 80;
      wsSummary.mergeCells(`A${tr.number}:E${tr.number}`);
    }

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