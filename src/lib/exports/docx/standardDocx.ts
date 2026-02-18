import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  PageNumber,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  ShadingType,
} from "docx";

import { ExportMeta } from "../core/meta";
import { DEFAULT_THEME, ExportTheme } from "../core/theme";
import { formatUkDate, safeStr } from "../core/format";

/**
 * Builds a standardized DOCX Document shell.
 * Handles branding, headers, footers, and page margins.
 */
export function buildStandardDocxShell(args: {
  title: string;
  subtitle?: string;
  meta: ExportMeta;
  theme?: Partial<ExportTheme>;
  children: (Paragraph | Table)[];
}) {
  const { title, subtitle, meta, children } = args;
  const t: ExportTheme = { 
    ...DEFAULT_THEME, 
    ...args.theme, 
    primary: (args.theme?.primary || meta.brandPrimary || DEFAULT_THEME.primary) 
  };

  const header = new Header({
    children: [
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 55, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                borders: noBorders(),
                children: [
                  new Paragraph({
                    children: [
                      new TextRun({ text: safeStr(meta.clientName || t.brandName), bold: true, color: "FFFFFF" }),
                    ],
                  }),
                ],
                shading: { type: ShadingType.CLEAR, fill: t.headerBg.replace("#", "") },
              }),
              new TableCell({
                width: { size: 45, type: WidthType.PERCENTAGE },
                verticalAlign: VerticalAlign.CENTER,
                borders: noBorders(),
                shading: { type: ShadingType.CLEAR, fill: t.headerBg.replace("#", "") },
                children: [
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: safeStr(meta.organisationName), bold: true, color: "FFFFFF" }),
                    ],
                  }),
                  new Paragraph({
                    alignment: AlignmentType.RIGHT,
                    children: [
                      new TextRun({ text: `Project: ${safeStr(meta.projectTitle)} (${safeStr(meta.projectCode)})`, color: "E5E7EB", size: 18 }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        ],
      }),
      new Paragraph({
        children: [],
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 8, color: t.primary.replace("#", "") },
        },
      }),
    ],
  });

  const footer = new Footer({
    children: [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        children: [
          new TextRun({ text: `Generated ${formatUkDate(new Date())} • ${t.brandName} • `, color: "6B7280", size: 18 }),
          new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES] as any, color: "6B7280", size: 18 }),
        ],
      }),
    ],
  });

  const titleBlock: Paragraph[] = [
    new Paragraph({
      spacing: { after: 120 },
      children: [new TextRun({ text: title, bold: true, size: 40 })],
    }),
    ...(subtitle
      ? [
          new Paragraph({
            spacing: { after: 200 },
            children: [new TextRun({ text: subtitle, color: "6B7280", size: 22 })],
          }),
        ]
      : []),
    new Paragraph({
      spacing: { after: 220 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: t.primary.replace("#", "") } },
      children: [],
    }),
  ];

  return new Document({
    sections: [
      {
        properties: {
          page: {
            margin: { top: 720, bottom: 720, left: 720, right: 720 }, // Standard 0.5 inch margins
          },
        },
        headers: { default: header },
        footers: { default: footer },
        children: [...titleBlock, ...children],
      },
    ],
  });
}

/**
 * Utility to generate formatted tables for DOCX.
 */
export function docxTable(args: { headers: string[]; rows: (string | null | undefined)[][] }) {
  const { headers, rows } = args;

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: headers.map((h) =>
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: "0B1220" },
            borders: thinBorders(),
            children: [
              new Paragraph({
                children: [new TextRun({ text: safeStr(h), bold: true, color: "FFFFFF" })],
              }),
            ],
          })
        ),
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: r.map((c) =>
              new TableCell({
                borders: thinBorders(),
                children: [new Paragraph({ children: [new TextRun({ text: safeStr(c) })] })],
              })
            ),
          })
      ),
    ],
  });
}

function noBorders() {
  return {
    top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
  } as const;
}

function thinBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB" },
    bottom: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB" },
    left: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB" },
    right: { style: BorderStyle.SINGLE, size: 4, color: "E5E7EB" },
  } as const;
}
