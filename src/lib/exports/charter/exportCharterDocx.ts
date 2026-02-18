// src/lib/exports/charter/exportCharterDocx.ts
import "server-only";

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  VerticalAlign,
  AlignmentType,
  ShadingType,
  Header,
  Footer,
  PageNumber,
  convertInchesToTwip,
  PageOrientation,
} from "docx";

/* ---------------- helpers ---------------- */

function jsonErr(message: string, status = 400, details?: any) {
  return NextResponse.json({ ok: false, error: message, details }, { status });
}

function safeJson(x: any): any {
  if (!x) return null;
  if (typeof x === "object") return x;
  try {
    return JSON.parse(String(x));
  } catch {
    return null;
  }
}

function safeStr(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function safeString(x: any): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function formatUkDateTime(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatUkDate(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function looksIsoDateOnly(v: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim());
}
function looksIsoDateTime(v: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(String(v || "").trim());
}

function toUkDate(value: string) {
  const s = String(value || "").trim();
  if (!s) return s;
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return new Intl.DateTimeFormat("en-GB", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(d);
  } catch {
    return s;
  }
}

function formatCellValue(x: any) {
  const raw = safeString(x).trim();
  if (!raw) return "—";
  if (looksIsoDateOnly(raw) || looksIsoDateTime(raw)) return toUkDate(raw);
  return raw;
}

function stripNumberPrefix(title: string) {
  return String(title ?? "").replace(/^\s*\d+\.\s*/, "").trim();
}

function stripLeadingBullets(line: string) {
  return String(line ?? "")
    .replace(/^\s*(?:[•\u2022\-\*\u00B7\u2023\u25AA\u25CF\u2013]+)\s*/g, "")
    .trim();
}

function splitCellLines(v: any): string[] {
  const raw = String(v ?? "");
  const lines = raw
    .split("\n")
    .map((x) => stripLeadingBullets(x).trim())
    .filter(Boolean);
  return lines.length ? lines : [""];
}

function expandRowCellsByNewlines(rowCells: any[]) {
  const perCell = rowCells.map(splitCellLines);
  const maxLen = Math.max(1, ...perCell.map((a) => a.length));
  const out: string[][] = [];
  for (let i = 0; i < maxLen; i++) {
    out.push(perCell.map((a) => a[i] ?? ""));
  }
  return out;
}

/**
 * Normalize tables from either:
 * - v2: { table: { columns:number, rows: [{type:"header"|"data", cells:string[]}] } }
 * - legacy: { table: { columns?: string[], rows?: any[] } } or { columns: string[], rows: string[][] }
 */
function normalizeTable(sec: any): { header: string[]; rows: string[][] } | null {
  const t = sec?.table ?? null;

  // v2 table
  if (t && Array.isArray(t.rows) && t.rows.length) {
    const headerRow = t.rows.find((r: any) => r?.type === "header");
    const dataRows = t.rows.filter((r: any) => r?.type === "data");

    const header = Array.isArray(headerRow?.cells)
      ? headerRow.cells.map((c: any) => safeString(c))
      : [];

    const rows = dataRows.map((r: any) =>
      Array.isArray(r?.cells) ? r.cells.map((c: any) => safeString(c)) : []
    );

    // If header is empty but sec.columns is a string[]
    if ((!header || header.length === 0) && Array.isArray(sec?.columns)) {
      return { header: sec.columns.map((c: any) => safeString(c)), rows };
    }

    return { header, rows };
  }

  // legacy: sec.rows string[][]
  if (Array.isArray(sec?.rows)) {
    const header = Array.isArray(sec?.columns) ? sec.columns.map((c: any) => safeString(c)) : [];
    const rows = sec.rows.map((r: any) => (Array.isArray(r) ? r.map((c: any) => safeString(c)) : []));
    return { header, rows };
  }

  // legacy: tableData with columns array and rows arrays
  if (t && (Array.isArray((t as any).columns) || Array.isArray((t as any).rows))) {
    const header = Array.isArray((t as any).columns)
      ? (t as any).columns.map((c: any) => safeString(c))
      : [];

    const rowsRaw = Array.isArray((t as any).rows) ? (t as any).rows : [];
    const rows = rowsRaw.map((row: any) => {
      const cells = Array.isArray(row) ? row : row?.cells || [];
      return (Array.isArray(cells) ? cells : []).map((c: any) => safeString(c));
    });

    return { header, rows };
  }

  return null;
}

/* ---------------- docx builder ---------------- */

async function generateCharterDocx(doc: any, meta: any) {
  const sections = Array.isArray(doc?.sections) ? doc.sections : [];

  // ? Bullet sections contract (but Section 1 & 2 must NOT show bullet markers)
  const bulletIndices = new Set([0, 1, 3, 6, 7, 8, 9]);

  const titleBand = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.SINGLE, size: 16, color: "E2E8F0" },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "PC",
                    bold: true,
                    size: 48,
                    color: "FFFFFF",
                    font: "Calibri",
                  }),
                ],
                alignment: AlignmentType.CENTER,
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "2563EB" },
            verticalAlign: VerticalAlign.CENTER,
            width: { size: 15, type: WidthType.PERCENTAGE },
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: "Project Charter",
                    bold: true,
                    size: 48,
                    color: "0F172A",
                    font: "Calibri Light",
                  }),
                ],
                spacing: { after: 100 },
              }),
              new Paragraph({
                children: [new TextRun({ text: safeString(meta.projectName), size: 28, color: "64748B" })],
              }),
            ],
            columnSpan: 3,
            margins: { left: 200, top: 100, bottom: 100, right: 100 },
          }),
        ],
      }),
    ],
  });

  const metaTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
      left: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
      right: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Organisation", size: 16, color: "64748B", bold: true })],
              }),
              new Paragraph({
                children: [new TextRun({ text: safeString(meta.organisationName), size: 20, bold: true })],
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Client", size: 16, color: "64748B", bold: true })],
              }),
              new Paragraph({
                children: [new TextRun({ text: safeString(meta.clientName), size: 20, bold: true })],
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Project ID", size: 16, color: "64748B", bold: true })],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: safeString(meta.projectCode),
                    size: 22,
                    bold: true,
                    color: "2563EB",
                    font: "Consolas",
                  }),
                ],
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
          }),
          new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: "Project Manager", size: 16, color: "64748B", bold: true })],
              }),
              new Paragraph({
                children: [new TextRun({ text: safeString(meta.pmName), size: 20, bold: true })],
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
          }),
        ],
      }),
    ],
  });

  const contentBlocks: Array<Paragraph | Table> = [];

  sections.forEach((sec: any, idx: number) => {
    const secKey = safeString(sec?.key).trim().toLowerCase();
    const isScope = secKey === "scope_in_out" || secKey === "scope";

    // ? Avoid "1.1": strip any numeric prefix from stored title
    const rawTitle = safeString(sec?.title || sec?.key || `Section ${idx + 1}`);
    const title = stripNumberPrefix(rawTitle);

    const isBulletSection = bulletIndices.has(idx);
    const noBulletsThisSection = idx === 0 || idx === 1; // ? Section 1 & 2: no bullet markers

    contentBlocks.push(new Paragraph({ spacing: { before: 300 } }));

    // Section header bar
    contentBlocks.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.NONE },
          bottom: { style: BorderStyle.SINGLE, size: 12, color: "2563EB" },
          left: { style: BorderStyle.NONE },
          right: { style: BorderStyle.NONE },
          insideHorizontal: { style: BorderStyle.NONE },
          insideVertical: { style: BorderStyle.NONE },
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: `${idx + 1}. `, bold: true, size: 24, color: "2563EB" }),
                      new TextRun({ text: title, bold: true, size: 24, color: "2563EB" }),
                    ],
                  }),
                ],
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
              }),
            ],
          }),
        ],
      })
    );

    // Bullets / plain lines
    if (isBulletSection) {
      const content = sec?.bullets || sec?.content || "";
      const lines = String(content)
        .split("\n")
        .map((x) => stripLeadingBullets(String(x)).trim())
        .filter(Boolean);

      if (lines.length > 0) {
        if (noBulletsThisSection) {
          lines.forEach((line) => {
            contentBlocks.push(
              new Paragraph({
                children: [new TextRun({ text: line, size: 22 })],
                spacing: { after: 120, before: 40 },
              })
            );
          });
        } else {
          lines.forEach((line) => {
            contentBlocks.push(
              new Paragraph({
                children: [new TextRun({ text: line, size: 22 })],
                bullet: { level: 0 },
                spacing: { after: 80, before: 40 },
                indent: { left: convertInchesToTwip(0.25) },
              })
            );
          });
        }
      } else {
        contentBlocks.push(
          new Paragraph({
            children: [new TextRun({ text: "No content recorded", italics: true, size: 22, color: "94A3B8" })],
            spacing: { after: 200 },
          })
        );
      }
      return;
    }

    // Tables (supports v2 + legacy)
    const norm = normalizeTable(sec);
    if (norm) {
      const header = norm.header || [];
      const dataRows = norm.rows || [];

      const tableRows: TableRow[] = [];

      if (header.length > 0) {
        tableRows.push(
          new TableRow({
            children: header.map(
              (c: string) =>
                new TableCell({
                  children: [
                    new Paragraph({
                      children: [new TextRun({ text: safeString(c), bold: true, size: 18, color: "2563EB" })],
                    }),
                  ],
                  shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                })
            ),
          })
        );
      }

      let visualRowIndex = 0;

      if (dataRows.length > 0) {
        dataRows.forEach((rowCells: any[]) => {
          const expanded = isScope ? expandRowCellsByNewlines(rowCells) : [rowCells.map((c) => safeString(c))];

          expanded.forEach((cells: string[]) => {
            const rIdx = visualRowIndex++;
            tableRows.push(
              new TableRow({
                children: cells.map(
                  (c: any) =>
                    new TableCell({
                      children: [
                        new Paragraph({
                          children: [new TextRun({ text: formatCellValue(c), size: 20 })],
                        }),
                      ],
                      shading: rIdx % 2 === 1 ? { type: ShadingType.CLEAR, fill: "FAFAFA" } : undefined,
                      margins: { top: 60, bottom: 60, left: 100, right: 100 },
                    })
                ),
              })
            );
          });
        });
      } else {
        // If no rows, still show one empty row (keeps table visible)
        const colCount = Math.max(1, header.length || 2);
        tableRows.push(
          new TableRow({
            children: Array.from({ length: colCount }, () => "").map(
              () =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: "—", size: 20, color: "94A3B8" })] })],
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                })
            ),
          })
        );
      }

      contentBlocks.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          borders: {
            top: { style: BorderStyle.SINGLE, size: 8, color: "2563EB" },
            bottom: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
            left: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
            right: { style: BorderStyle.SINGLE, size: 6, color: "E2E8F0" },
            insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
            insideVertical: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
          },
          rows: tableRows,
        })
      );

      return;
    }

    // Default plain text
    const content = sec?.content || sec?.bullets || "";
    const lines = String(content)
      .split("\n")
      .map((x) => stripLeadingBullets(String(x)).trim())
      .filter(Boolean);

    if (lines.length > 0) {
      lines.forEach((line) => {
        contentBlocks.push(
          new Paragraph({
            children: [new TextRun({ text: line, size: 22 })],
            spacing: { after: 80 },
          })
        );
      });
    } else {
      contentBlocks.push(
        new Paragraph({
          children: [new TextRun({ text: "No content recorded", italics: true, size: 22, color: "94A3B8" })],
          spacing: { after: 200 },
        })
      );
    }
  });

  const document = new Document({
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(0.8),
              right: convertInchesToTwip(0.8),
              bottom: convertInchesToTwip(0.8),
              left: convertInchesToTwip(0.8),
            },
            size: {
              orientation: PageOrientation.LANDSCAPE,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Project Charter", bold: true, size: 28 }),
                  new TextRun({ text: " • " + safeString(meta.projectName), size: 24, color: "64748B" }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                children: [
                  new TextRun({
                    text: `Generated ${safeString(meta.generatedDate)} • Page `,
                    size: 18,
                    color: "64748B",
                  }),
                  PageNumber.CURRENT,
                  new TextRun({ text: " of ", size: 18, color: "64748B" }),
                  PageNumber.TOTAL_PAGES,
                ],
                alignment: AlignmentType.RIGHT,
              }),
            ],
          }),
        },
        children: [
          // ? Tables must be direct children (NOT inside Paragraph)
          titleBand,
          new Paragraph({ spacing: { after: 200 } }),
          metaTable,
          new Paragraph({ spacing: { after: 220 } }),

          // ? Stats removed to match PDF

          ...contentBlocks,
        ],
      },
    ],
  });

  return await Packer.toBuffer(document);
}

/* ---------------- exported API ---------------- */

export async function exportCharterDocx({
  req,
  artifactId,
  projectId,
  content_json,
}: {
  req: NextRequest;
  artifactId: string;
  projectId?: string | null;
  content_json?: any;
}) {
  try {
    const supabase = await createClient();

    const { data: artifact, error: aErr } = await supabase
      .from("artifacts")
      .select("id,title,content_json,project_id,projects:project_id(title, project_code, organisation_id, client_name)")
      .eq("id", artifactId)
      .single();

    if (aErr || !artifact) return jsonErr("Artifact not found", 404, { error: aErr?.message });

    const doc = safeJson(content_json ?? (artifact as any).content_json);
    if (!doc) return jsonErr("No content found", 400);

    const effectiveProjectId =
      safeStr(projectId).trim() || safeStr((artifact as any).project_id).trim() || null;

    let projectRow: any = (artifact as any).projects ?? null;
    if (!projectRow && effectiveProjectId) {
      const { data: p } = await supabase
        .from("projects")
        .select("id,title,project_code,organisation_id,client_name")
        .eq("id", effectiveProjectId)
        .single();
      projectRow = p ?? null;
    }

    const projectCode = projectRow?.project_code
      ? `P-${String(projectRow.project_code).padStart(5, "0")}`
      : "—";

    let orgName = "—";
    const orgId = projectRow?.organisation_id;
    if (orgId) {
      const { data: org } = await supabase.from("organisations").select("name").eq("id", orgId).single();
      orgName = org?.name || "—";
    }

    const meta = {
      projectName: (artifact as any).title || projectRow?.title || "Project",
      projectCode,
      organisationName: orgName,
      clientName: projectRow?.client_name || "—",
      pmName: doc?.meta?.pm_name || "—",
      status: doc?.meta?.status || "Draft",
      generatedDate: formatUkDate(),
      generatedDateTime: formatUkDateTime(),
    };

    const buffer = await generateCharterDocx(doc, meta);
    const filename = `Project_${meta.projectCode}_Charter_${meta.generatedDate.replace(/\//g, "-")}.docx`;

    return new NextResponse(new Uint8Array(new Uint8Array(new Uint8Array(buffer))), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err: any) {
    console.error("[Charter DOCX Error]", err);
    return jsonErr(err?.message || "Export failed", 500);
  }
}
