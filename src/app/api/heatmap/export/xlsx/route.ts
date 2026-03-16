import "server-only";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function jsonErr(msg: string, status = 400) {
  return NextResponse.json({ ok: false, error: msg }, { status });
}
function safeNum(v: any): number { return Number(v) || 0; }
function safeStr(v: any): string { return typeof v === "string" ? v : v == null ? "" : String(v); }

export async function GET(req: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return jsonErr("Unauthorised", 401);

    const url = new URL(req.url);
    const orgId      = safeStr(url.searchParams.get("organisationId") ?? url.searchParams.get("orgId")).trim();
    const granularity = safeStr(url.searchParams.get("granularity") || "weekly").trim();
    const dateFrom   = safeStr(url.searchParams.get("dateFrom")).trim();
    const dateTo     = safeStr(url.searchParams.get("dateTo")).trim();

    if (!orgId) return jsonErr("organisationId required", 400);

    const admin = createAdminClient();

    // Fetch org name
    const { data: org } = await admin.from("organisations").select("name").eq("id", orgId).maybeSingle();
    const orgName = safeStr(org?.name || "Organisation");

    // Fetch members in org
    const { data: members } = await admin
      .from("organisation_members")
      .select("user_id, role")
      .eq("organisation_id", orgId)
      .is("removed_at", null);

    const memberIds = (members ?? []).map((m: any) => safeStr(m.user_id));

    // Fetch profiles
    const { data: profiles } = await admin
      .from("profiles")
      .select("user_id, full_name, email, job_title, department, employment_type, default_capacity_days")
      .in("user_id", memberIds);

    const profileMap = new Map((profiles ?? []).map((p: any) => [safeStr(p.user_id), p]));

    // Fetch allocations in date range
    let allocQuery = admin
      .from("allocations")
      .select("id, person_id, project_id, start_date, end_date, days_per_week, allocation_type")
      .in("person_id", memberIds);

    if (dateFrom) allocQuery = allocQuery.gte("end_date", dateFrom);
    if (dateTo)   allocQuery = allocQuery.lte("start_date", dateTo);

    const { data: allocations } = await allocQuery;

    // Fetch projects
    const projectIds = [...new Set((allocations ?? []).map((a: any) => safeStr(a.project_id)))];
    const { data: projects } = projectIds.length > 0
      ? await admin.from("projects").select("id, title, project_code, status").in("id", projectIds)
      : { data: [] };

    const projectMap = new Map((projects ?? []).map((p: any) => [safeStr(p.id), p]));

    // Capacity exceptions
    const { data: exceptions } = await admin
      .from("capacity_exceptions")
      .select("person_id, exception_date, capacity_days")
      .in("person_id", memberIds);

    const ExcelJS = (await import("exceljs")).default;
    const wb = new ExcelJS.Workbook();
    wb.creator = "Aliena";
    wb.created = new Date();

    const HDR_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FF0A1628" } };
    const ALT_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFF0F7FF" } };
    const WHITE_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFFFFFF" } };
    const RED_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFDF2F1" } };
    const AMBER_FILL = { type: "pattern" as const, pattern: "solid" as const, fgColor: { argb: "FFFDF6EC" } };

    function hdrRow(ws: any, values: string[]) {
      const row = ws.addRow(values);
      row.eachCell((cell: any) => {
        cell.fill = HDR_FILL;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial", size: 10 };
        cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
        cell.border = {
          top: { style: "thin", color: { argb: "FF0A1628" } },
          bottom: { style: "thin", color: { argb: "FF0A1628" } },
          left: { style: "thin", color: { argb: "FF0A1628" } },
          right: { style: "thin", color: { argb: "FF0A1628" } },
        };
      });
      row.height = 24;
      return row;
    }

    function borderCell(cell: any) {
      cell.border = {
        top: { style: "thin", color: { argb: "FFE2E8F0" } },
        bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
        left: { style: "thin", color: { argb: "FFE2E8F0" } },
        right: { style: "thin", color: { argb: "FFE2E8F0" } },
      };
    }

    function pctColor(pct: number): string {
      if (pct === 0) return "FF94A3B8";
      if (pct < 75)  return "FF2A6E47";
      if (pct < 95)  return "FF8A5B1A";
      if (pct <= 110) return "FFB83A2E";
      return "FF7C3AED";
    }

    function titleBlock(ws: any, title: string, subtitle: string) {
      const r1 = ws.addRow([title]);
      r1.getCell(1).font = { bold: true, size: 14, name: "Arial", color: { argb: "FF0A1628" } };
      r1.height = 28;
      const r2 = ws.addRow([subtitle]);
      r2.getCell(1).font = { size: 10, name: "Arial", color: { argb: "FF64748B" } };
      ws.addRow([]);
    }

    const exportDate = new Date().toLocaleDateString("en-GB");
    const dateRange = dateFrom && dateTo ? `${dateFrom} to ${dateTo}` : "All dates";

    // -- SHEET 1: RESOURCE SUMMARY --------------------------------------------
    const wsSummary = wb.addWorksheet("Resource Summary", { properties: { tabColor: { argb: "FF00B8DB" } } });
    wsSummary.columns = [
      { key: "name",      width: 26 },
      { key: "title",     width: 22 },
      { key: "dept",      width: 20 },
      { key: "type",      width: 14 },
      { key: "cap",       width: 14 },
      { key: "alloc",     width: 16 },
      { key: "util",      width: 12 },
      { key: "projects", width: 32 },
    ];

    titleBlock(wsSummary, `${orgName} -- Resource Plan`, `Exported ${exportDate} | ${dateRange} | ${granularity} view`);
    hdrRow(wsSummary, ["Name", "Job Title", "Department", "Type", "Capacity d/wk", "Allocated Days", "Avg Util %", "Projects"]);

    let totalAllocDays = 0;
    let overAllocCount = 0;

    (profiles ?? []).forEach((profile: any, i: number) => {
      const uid = safeStr(profile.user_id);
      const personAllocs = (allocations ?? []).filter((a: any) => safeStr(a.person_id) === uid);

      const totalDays = personAllocs.reduce((s: number, a: any) => {
        if (!a.start_date || !a.end_date) return s;
        const start = new Date(a.start_date);
        const end   = new Date(a.end_date);
        const weeks = Math.max(0, (end.getTime() - start.getTime()) / (7 * 86400000)) + 1;
        return s + Math.round(weeks * safeNum(a.days_per_week));
      }, 0);

      const cap = safeNum(profile.default_capacity_days) || 5;
      let utilPct = 0;
      if (dateFrom && dateTo) {
        const rangeWeeks = Math.max(1, (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / (7 * 86400000));
        const totalCapDays = cap * rangeWeeks;
        utilPct = totalCapDays > 0 ? Math.round((totalDays / totalCapDays) * 100) : 0;
      }

      const projectList = personAllocs
        .map((a: any) => {
          const proj = projectMap.get(safeStr(a.project_id));
          return proj ? safeStr(proj.project_code || proj.title) : null;
        })
        .filter(Boolean)
        .filter((v: string, i: number, arr: string[]) => arr.indexOf(v) === i)
        .join(", ");

      totalAllocDays += totalDays;
      if (utilPct > 100) overAllocCount++;

      const row = wsSummary.addRow([
        safeStr(profile.full_name || profile.email),
        safeStr(profile.job_title),
        safeStr(profile.department),
        safeStr(profile.employment_type || "full_time").replace(/_/g, " "),
        cap,
        totalDays || null,
        utilPct > 0 ? utilPct / 100 : null,
        projectList || "No allocations",
      ]);

      row.getCell(5).numFmt = "0.0";
      row.getCell(6).numFmt = "#,##0";
      row.getCell(7).numFmt = "0%";
      [5, 6, 7].forEach(c => { row.getCell(c).alignment = { horizontal: "right" }; });

      if (utilPct > 0) {
        row.getCell(7).font = { name: "Arial", size: 10, bold: true, color: { argb: pctColor(utilPct) } };
      }

      if (utilPct > 110) {
        row.fill = RED_FILL;
      } else if (utilPct > 95) {
        row.fill = AMBER_FILL;
      } else {
        row.fill = i % 2 === 0 ? WHITE_FILL : ALT_FILL;
      }
      row.eachCell(borderCell);
      row.height = 18;
    });

    // -- SHEET 2: ALLOCATIONS DETAIL ------------------------------------------
    const wsAlloc = wb.addWorksheet("Allocations", { properties: { tabColor: { argb: "FF1B3652" } } });
    wsAlloc.columns = [
      { key: "person", width: 24 }, { key: "proj", width: 28 }, { key: "code", width: 12 },
      { key: "status", width: 14 }, { key: "start", width: 14 }, { key: "end", width: 14 },
      { key: "dpw", width: 12 }, { key: "weeks", width: 10 }, { key: "total", width: 14 },
      { key: "type", width: 14 },
    ];

    titleBlock(wsAlloc, "Allocation Detail", `${orgName} | ${dateRange}`);
    hdrRow(wsAlloc, ["Person", "Project", "Code", "Status", "Start Date", "End Date", "Days/Week", "Weeks", "Total Days", "Type"]);

    (allocations ?? []).forEach((alloc: any, i: number) => {
        const profile = profileMap.get(safeStr(alloc.person_id));
        const project = projectMap.get(safeStr(alloc.project_id));
        const start = alloc.start_date ? new Date(alloc.start_date) : null;
        const end   = alloc.end_date   ? new Date(alloc.end_date)   : null;
        const weeks = start && end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / (7 * 86400000))) + 1 : 0;
        
        const row = wsAlloc.addRow([
          safeStr(profile?.full_name || profile?.email || alloc.person_id),
          safeStr(project?.title || alloc.project_id),
          safeStr(project?.project_code),
          safeStr(project?.status || "").charAt(0).toUpperCase() + safeStr(project?.status || "").slice(1),
          start, end, safeNum(alloc.days_per_week), weeks, weeks * safeNum(alloc.days_per_week),
          safeStr(alloc.allocation_type || "confirmed")
        ]);
        row.eachCell(borderCell);
    });

    // -- STREAM RESPONSE ------------------------------------------------------
    const buffer = await wb.xlsx.writeBuffer();
    const safeOrg = orgName.replace(/[^a-zA-Z0-9- ]/g, "").replace(/\s+/g, "-").slice(0, 40);
    const filename = `${safeOrg}-resource-plan-${new Date().toISOString().slice(0,10)}.xlsx`;

    return new NextResponse(buffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });

  } catch (e: any) {
    console.error("[heatmap/export/xlsx]", e);
    return jsonErr(e?.message ?? "Export failed", 500);
  }
}
