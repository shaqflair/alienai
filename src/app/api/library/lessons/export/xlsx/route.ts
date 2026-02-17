import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";
import ExcelJS from "exceljs";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function safeStr(x: any) {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function slugify(x: string) {
  return String(x || "export")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9\-_.]/g, "")
    .slice(0, 80);
}

function safeExcelCell(v: any) {
  const s = String(v ?? "");
  if (/^[=+\-@]/.test(s)) return "'" + s;
  return s;
}

function ukDateFromIso(isoLike?: string | null) {
  const s = safeStr(isoLike).trim();
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = String(d.getFullYear());
  return `${dd}/${mm}/${yyyy}`;
}

function categoryLabel(cat: any) {
  const v = safeStr(cat).trim();
  const maps: Record<string, string> = {
    "what_went_well": "What went well",
    "improvements": "Improvements",
    "issues": "Issues"
  };
  return maps[v] || v;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  const q = safeStr(url.searchParams.get("q")).trim();
  const tag = safeStr(url.searchParams.get("tag")).trim();

  try {
    const supabase = await createClient();

    let query = supabase
      .from("lessons_learned")
      .select(`
        id,
        description,
        category,
        action_for_future,
        published_at,
        is_published,
        library_tags,
        project_id,
        projects:project_id ( title, project_code )
      `)
      .eq("is_published", true)
      .order("published_at", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });

    if (q) query = query.ilike("description", `%${q}%`);
    if (tag) query = query.contains("library_tags", [tag]);

    const { data, error } = await query;
    if (error) throw new Error(`LESSONS_QUERY: ${error.message}`);

    const items = data || [];

    const wb = new ExcelJS.Workbook();
    wb.creator = "Aliena AI";
    wb.created = new Date();

    const ws = wb.addWorksheet("Org Lessons", { views: [{ state: "frozen", ySplit: 1 }] });

    ws.columns = [
      { header: "Published", key: "published", width: 14 },
      { header: "Description", key: "description", width: 60 },
      { header: "Category", key: "category", width: 18 },
      { header: "Tags", key: "tags", width: 30 },
      { header: "Action for future", key: "action", width: 40 },
      { header: "Project", key: "project", width: 28 },
    ];

    const headerRow = ws.getRow(1);
    headerRow.font = { bold: true };
    headerRow.height = 18;

    if (items.length > 0) {
      items.forEach((r: any) => {
        const projTitle = safeStr(r?.projects?.title);
        const projCode = safeStr(r?.projects?.project_code);
        const projectLabel = projCode ? `${projTitle} (${projCode})` : projTitle;
        const tags = Array.isArray(r?.library_tags) ? r.library_tags.filter(Boolean).join(", ") : "";

        ws.addRow({
          published: safeExcelCell(ukDateFromIso(r.published_at)),
          description: safeExcelCell(r.description || ""),
          category: safeExcelCell(categoryLabel(r.category)),
          tags: safeExcelCell(tags),
          action: safeExcelCell(r.action_for_future || ""),
          project: safeExcelCell(projectLabel || ""),
        });
      });
    }

    ws.eachRow((row) => {
      row.eachCell((cell) => {
        cell.border = {
          top: { style: "thin", color: { argb: "FFE6EAF0" } },
          left: { style: "thin", color: { argb: "FFE6EAF0" } },
          bottom: { style: "thin", color: { argb: "FFE6EAF0" } },
          right: { style: "thin", color: { argb: "FFE6EAF0" } },
        };
        cell.alignment = { vertical: "top", wrapText: true };
      });
    });

    const buf = await wb.xlsx.writeBuffer();
    const filename = `${slugify("org-lessons-library")}.xlsx`;

    return new NextResponse(Buffer.from(buf), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "Export failed" }, { status: 500 });
  }
}

