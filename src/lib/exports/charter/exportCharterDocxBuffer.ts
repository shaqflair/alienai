// src/lib/exports/charter/exportCharterDocxBuffer.ts
import "server-only";

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

import {
  CharterExportMeta,
  CHARTER_SECTIONS_BY_KEY,
  canonicaliseCharterSections,
  charterSectionNumberFromTitleOrIndex,
  expandRowsByNewlines,
  formatCellValue,
  normalizeTable,
  safeStr,
  stripLeadingBullets,
  stripNumberPrefix,
} from "./charterShared";

/* ---------------- local helpers ---------------- */

function linesFromBulletsOrContent(sec: any) {
  const content = sec?.bullets || sec?.content || "";
  return String(content)
    .split("\n")
    .map((x) => stripLeadingBullets(String(x)).trim())
    .filter(Boolean);
}

/**
 * Builds the DOCX Document structure.
 * Canonical section ordering by key; matches PDF section logic.
 */
async function generateCharterDocx(doc: any, meta: CharterExportMeta) {
  const sections = canonicaliseCharterSections(doc);

  // Blue Title Header Band
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
                children: [new TextRun({ text: "PC", bold: true, size: 48, color: "FFFFFF" })],
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
                children: [new TextRun({ text: "Project Charter", bold: true, size: 48, color: "0F172A" })],
                spacing: { after: 100 },
              }),
              new Paragraph({
                children: [new TextRun({ text: safeStr(meta.projectName), size: 28, color: "64748B" })],
              }),
            ],
            columnSpan: 3,
            margins: { left: 200, top: 100, bottom: 100, right: 100 },
          }),
        ],
      }),
    ],
  });

  // Grid Table for Organisation, Client, Project ID, PM
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
        children: ["Organisation", "Client", "Project ID", "Project Manager"].map((label, i) => {
          const values = [meta.organisationName, meta.clientName, meta.projectCode, meta.pmName];
          return new TableCell({
            children: [
              new Paragraph({
                children: [new TextRun({ text: label, size: 16, color: "64748B", bold: true })],
              }),
              new Paragraph({
                children: [
                  new TextRun({
                    text: safeStr(values[i]),
                    size: 20,
                    bold: true,
                    color: i === 2 ? "2563EB" : undefined,
                    font: i === 2 ? "Consolas" : undefined,
                  }),
                ],
              }),
            ],
            shading: { type: ShadingType.CLEAR, fill: "F8FAFC" },
            margins: { top: 100, bottom: 100, left: 120, right: 120 },
          });
        }),
      }),
    ],
  });

  const contentBlocks: Array<Paragraph | Table> = [];

  sections.forEach((sec: any, idx: number) => {
    const secKey = safeStr(sec?.key).trim().toLowerCase();
    const spec = CHARTER_SECTIONS_BY_KEY.get(secKey) || null;

    const rawTitle = safeStr(sec?.title || spec?.title || sec?.key || `Section ${idx + 1}`);
    const title = stripNumberPrefix(rawTitle);
    const secNumber = charterSectionNumberFromTitleOrIndex(rawTitle, idx + 1);

    const isScope = secKey === "scope_in_out" || secKey === "scope";

    const isBullets = (spec?.kind || "") === "bullets";
    const isTable = (spec?.kind || "") === "table";

    // Sections 1 & 2: plain lines, NO bullet markers
    const plainLinesForThisSection = secKey === "business_case" || secKey === "objectives";

    contentBlocks.push(new Paragraph({ spacing: { before: 300 } }));

    // Section Header Table (Blue Underline)
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
                      new TextRun({ text: `${secNumber}. `, bold: true, size: 24, color: "2563EB" }),
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

    // Bullets / plain lines (preferred for bullets sections)
    if (isBullets) {
      const lines = linesFromBulletsOrContent(sec);

      if (lines.length > 0) {
        if (plainLinesForThisSection) {
          // no bullet markers
          lines.forEach((l) => {
            contentBlocks.push(
              new Paragraph({
                children: [new TextRun({ text: l, size: 22 })],
                spacing: { after: 120, before: 40 },
              })
            );
          });
        } else {
          lines.forEach((l) => {
            contentBlocks.push(
              new Paragraph({
                children: [new TextRun({ text: l, size: 22 })],
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

    // Tables
    if (isTable) {
      const norm = normalizeTable(sec);

      if (norm) {
        const header = norm.header || [];
        const dataRows = norm.rows || [];

        // Scope rows expand by newline for readability (matches PDF behaviour)
        const rowsForRender = isScope ? expandRowsByNewlines(dataRows) : dataRows;

        const tableRows: TableRow[] = [];

        if (header.length > 0) {
          tableRows.push(
            new TableRow({
              children: header.map(
                (h: string) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text: safeStr(h), bold: true, size: 18, color: "2563EB" })],
                      }),
                    ],
                    shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
                    margins: { top: 60, bottom: 60, left: 100, right: 100 },
                  })
              ),
            })
          );
        }

        if (rowsForRender.length > 0) {
          rowsForRender.forEach((rowCells: any[], rIdx: number) => {
            tableRows.push(
              new TableRow({
                children: (rowCells || []).map(
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
        } else {
          // keep table visible
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

      // missing table fallback -> treat as plain lines
      const lines = linesFromBulletsOrContent(sec);
      if (lines.length > 0) {
        lines.forEach((l) => {
          contentBlocks.push(
            new Paragraph({
              children: [new TextRun({ text: l, size: 22 })],
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

      return;
    }

    // Unknown section fallback: attempt table else bullets-as-lines
    const norm = normalizeTable(sec);
    if (norm) {
      const header = norm.header || [];
      const dataRows = norm.rows || [];
      const rowsForRender = isScope ? expandRowsByNewlines(dataRows) : dataRows;

      const tableRows: TableRow[] = [];

      if (header.length > 0) {
        tableRows.push(
          new TableRow({
            children: header.map(
              (h: string) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: safeStr(h), bold: true, size: 18, color: "2563EB" })] })],
                  shading: { type: ShadingType.CLEAR, fill: "F1F5F9" },
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                })
            ),
          })
        );
      }

      rowsForRender.forEach((rowCells: any[], rIdx: number) => {
        tableRows.push(
          new TableRow({
            children: (rowCells || []).map(
              (c: any) =>
                new TableCell({
                  children: [new Paragraph({ children: [new TextRun({ text: formatCellValue(c), size: 20 })] })],
                  shading: rIdx % 2 === 1 ? { type: ShadingType.CLEAR, fill: "FAFAFA" } : undefined,
                  margins: { top: 60, bottom: 60, left: 100, right: 100 },
                })
            ),
          })
        );
      });

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
          rows: tableRows.length ? tableRows : [],
        })
      );

      return;
    }

    const lines = linesFromBulletsOrContent(sec);
    if (lines.length) {
      lines.forEach((l) =>
        contentBlocks.push(
          new Paragraph({
            children: [new TextRun({ text: l, size: 22 })],
            spacing: { after: 80 },
          })
        )
      );
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
            size: { orientation: PageOrientation.LANDSCAPE },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Project Charter", bold: true, size: 28 }),
                  new TextRun({ text: " • " + safeStr(meta.projectName), size: 24, color: "64748B" }),
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
                  new TextRun({ text: `Generated ${safeStr(meta.generatedDate)} • Page `, size: 18, color: "64748B" }),
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
          titleBand,
          new Paragraph({ spacing: { after: 200 } }),
          metaTable,
          new Paragraph({ spacing: { after: 220 } }),
          ...contentBlocks,
        ],
      },
    ],
  });

  return await Packer.toBuffer(document);
}

export async function exportCharterDocxBuffer({
  doc,
  meta,
}: {
  doc: any;
  meta: CharterExportMeta;
}): Promise<Buffer> {
  return generateCharterDocx(doc, meta);
}

export function charterDocxFilename(meta: CharterExportMeta) {
  return `Charter_${meta.projectCode}_${meta.generatedDate.replace(/\//g, "-")}.docx`;
}
