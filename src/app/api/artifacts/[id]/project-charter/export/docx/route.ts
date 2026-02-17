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
  Header,
  Footer,
  PageNumber,
  convertInchesToTwip,
  HeadingLevel,
  LevelFormat,
  UnderlineType,
  PageBreak,
  ShadingType,
  ImageRun,
} from "docx";

export const runtime = "nodejs";
export const maxDuration = 60;

/* ──────────────────────────────────────────────── Constants & Theme ──────────────────────────────────────────────── */
const THEME = {
  colors: {
    primary: "1e3a5f", // Deep navy
    secondary: "2c5282", // Medium blue
    accent: "3182ce", // Bright blue
    text: "1a202c", // Near black
    textLight: "4a5568", // Gray
    border: "cbd5e0", // Light gray
    headerBg: "edf2f7", // Very light gray
    white: "ffffff",
  },
  fonts: {
    primary: "Calibri",
    heading: "Calibri Light",
  },
  sizes: {
    title: 56,
    subtitle: 32,
    heading1: 36,
    heading2: 28,
    heading3: 24,
    body: 22,
    small: 20,
  },
};

/* ──────────────────────────────────────────────── Helpers ──────────────────────────────────────────────── */
function safeStr(x: unknown): string {
  return typeof x === "string" ? x : "";
}

function isUuid(x: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    (x || "").trim()
  );
}

function jsonErr(error: string, status = 400, meta?: any) {
  return NextResponse.json({ ok: false, error, meta }, { status });
}

function safeJson<T = unknown>(value: unknown): T | null {
  if (!value) return null;
  if (typeof value === "object") return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return null;
  }
}

function formatUkDateTime(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}, ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatDate(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

function sanitizeFilename(input: string): string {
  return (
    String(input || "project-charter")
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 100) || "project-charter"
  );
}

function resolveArtifactId(req: Request | NextRequest, params: any): string {
  const fromParams = safeStr(params?.id ?? params?.artifactId).trim();
  if (fromParams) return fromParams;

  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const idx = parts.indexOf("artifacts");
  if (idx >= 0 && parts[idx + 1]) return safeStr(parts[idx + 1]).trim();

  return "";
}

/* ──────────────────────────────────────────────── Auth ──────────────────────────────────────────────── */
async function requireAuthAndMembership(supabase: any, projectId: string) {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw new Error(authErr.message);
  if (!auth?.user) throw new Error("Unauthorized");

  const { data: mem, error: memErr } = await supabase
    .from("project_members")
    .select("role, removed_at")
    .eq("project_id", projectId)
    .eq("user_id", auth.user.id)
    .is("removed_at", null)
    .maybeSingle();

  if (memErr) throw new Error(memErr.message);
  if (!mem) throw new Error("Not found");

  const role = String((mem as any).role ?? "viewer").toLowerCase();
  const canEdit = role === "owner" || role === "admin" || role === "editor";
  return { userId: auth.user.id, role, canEdit };
}

/* ──────────────────────────────────────────────── Advanced Document Builders ──────────────────────────────────────────────── */
function createBorders(
  style: BorderStyle = BorderStyle.SINGLE,
  size: number = 8,
  color: string = THEME.colors.border
) {
  return {
    top: { style, size, color },
    bottom: { style, size, color },
    left: { style, size, color },
    right: { style, size, color },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color },
  };
}

function createShading(color: string, type: ShadingType = ShadingType.CLEAR) {
  return { fill: color, type };
}

function textRun(
  text: string,
  options: {
    bold?: boolean;
    size?: number;
    color?: string;
    font?: string;
    caps?: boolean;
    underline?: UnderlineType;
  } = {}
): TextRun {
  return new TextRun({
    text: text || "—",
    font: options.font || THEME.fonts.primary,
    size: options.size || THEME.sizes.body,
    bold: options.bold,
    color: options.color || THEME.colors.text,
    caps: options.caps,
    underline: options.underline,
  });
}

function paragraph(
  children: (TextRun | Paragraph)[],
  options: {
    alignment?: AlignmentType;
    spacing?: { before?: number; after?: number; line?: number };
    heading?: HeadingLevel;
    border?: any;
    shading?: any;
    bullet?: { level: number };
  } = {}
): Paragraph {
  return new Paragraph({
    children: children as any,
    alignment: options.alignment,
    spacing: options.spacing || { after: 200 },
    heading: options.heading,
    border: options.border,
    shading: options.shading,
    bullet: options.bullet,
  });
}

/* ──────────────────────────────────────────────── Section Builders ──────────────────────────────────────────────── */
function createCoverPage(meta: {
  projectName: string;
  projectCode: string;
  organisationName: string;
  generatedAt: string;
  pmName: string;
  version?: string;
  classification?: string;
}): (Paragraph | Table)[] {
  const classification = meta.classification || "INTERNAL";

  return [
    paragraph([textRun(classification, { bold: true, color: THEME.colors.primary, size: 20 })], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 12, color: THEME.colors.primary },
      },
    }),

    paragraph([], { spacing: { before: 2000 } }),

    paragraph(
      [
        textRun(meta.organisationName.toUpperCase(), {
          bold: true,
          size: 28,
          color: THEME.colors.secondary,
          caps: true,
        }),
      ],
      {
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 },
      }
    ),

    paragraph([textRun("PROJECT CHARTER", { bold: true, size: 72, color: THEME.colors.primary })], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
    }),

    paragraph([textRun(meta.projectName, { size: 48, color: THEME.colors.text })], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),

    paragraph([textRun(`Project Code: ${meta.projectCode}`, { size: 28, color: THEME.colors.textLight })], {
      alignment: AlignmentType.CENTER,
      spacing: { after: 1200 },
    }),

    new Table({
      width: { size: 60, type: WidthType.PERCENTAGE },
      alignment: AlignmentType.CENTER,
      borders: createBorders(BorderStyle.NIL, 0),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [paragraph([textRun("Project Manager", { bold: true, color: THEME.colors.textLight })])],
              width: { size: 40, type: WidthType.PERCENTAGE },
            }),
            new TableCell({
              children: [paragraph([textRun(meta.pmName)])],
              width: { size: 60, type: WidthType.PERCENTAGE },
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [paragraph([textRun("Date", { bold: true, color: THEME.colors.textLight })])],
            }),
            new TableCell({
              children: [paragraph([textRun(meta.generatedAt)])],
            }),
          ],
        }),
        new TableRow({
          children: [
            new TableCell({
              children: [paragraph([textRun("Version", { bold: true, color: THEME.colors.textLight })])],
            }),
            new TableCell({
              children: [paragraph([textRun(meta.version || "1.0")])],
            }),
          ],
        }),
      ],
    }),

    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function createExecutiveSummary(docData: any): Paragraph[] {
  const summary = docData?.executiveSummary || docData?.summary;
  if (!summary) return [];

  return [
    paragraph([textRun("Executive Summary", { bold: true, size: THEME.sizes.heading1 })], {
      spacing: { before: 400, after: 300 },
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 8, color: THEME.colors.accent },
      },
    }),
    paragraph([textRun(String(summary), { size: THEME.sizes.body })], {
      spacing: { after: 400, line: 360 },
    }),
  ];
}

function createSectionHeading(title: string, level: 1 | 2 | 3 = 1): Paragraph {
  const sizes = { 1: THEME.sizes.heading1, 2: THEME.sizes.heading2, 3: THEME.sizes.heading3 } as const;

  const spacing = {
    1: { before: 600, after: 300 },
    2: { before: 400, after: 200 },
    3: { before: 300, after: 200 },
  } as const;

  return paragraph(
    [
      textRun(title, {
        bold: true,
        size: sizes[level],
        color: level === 1 ? THEME.colors.primary : THEME.colors.text,
      }),
    ],
    {
      spacing: spacing[level],
      border:
        level === 1
          ? {
              bottom: { style: BorderStyle.SINGLE, size: 6, color: THEME.colors.accent },
            }
          : undefined,
    }
  );
}

function createMetadataTable(data: Record<string, string>): Table {
  const entries = Object.entries(data).filter(([_, v]) => v && v !== "—");

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: createBorders(BorderStyle.SINGLE, 4, THEME.colors.border),
    rows: entries.map(([key, value]) =>
      new TableRow({
        children: [
          new TableCell({
            children: [paragraph([textRun(key, { bold: true, size: THEME.sizes.small })])],
            width: { size: 30, type: WidthType.PERCENTAGE },
            shading: createShading(THEME.colors.headerBg),
            verticalAlign: VerticalAlign.CENTER,
          }),
          new TableCell({
            children: [paragraph([textRun(value, { size: THEME.sizes.small })])],
            width: { size: 70, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.CENTER,
          }),
        ],
      })
    ),
  });
}

function createStyledTable(tableData: { columns: number; rows: any[] }, title?: string): (Paragraph | Table)[] {
  const elements: (Paragraph | Table)[] = [];

  if (title) elements.push(createSectionHeading(title, 2));

  const headerRow = tableData.rows.find((r) => r.type === "header");
  const dataRows = tableData.rows.filter((r) => r.type === "data");
  const colCount = Math.max(1, tableData.columns || headerRow?.cells?.length || 1);

  const rows: TableRow[] = [];

  if (headerRow) {
    rows.push(
      new TableRow({
        children: Array.from({ length: colCount }, (_, i) =>
          new TableCell({
            children: [
              paragraph([
                textRun(safeStr(headerRow.cells[i]), {
                  bold: true,
                  color: THEME.colors.white,
                  size: THEME.sizes.small,
                }),
              ]),
            ],
            shading: createShading(THEME.colors.primary),
            verticalAlign: VerticalAlign.CENTER,
            borders: createBorders(BorderStyle.SINGLE, 4, THEME.colors.primary),
          })
        ),
        tableHeader: true,
      })
    );
  }

  if (dataRows.length > 0) {
    dataRows.forEach((row, idx) => {
      const isEven = idx % 2 === 0;
      rows.push(
        new TableRow({
          children: Array.from({ length: colCount }, (_, i) =>
            new TableCell({
              children: [paragraph([textRun(safeStr(row.cells[i]), { size: THEME.sizes.small })])],
              shading: isEven ? createShading(THEME.colors.white) : createShading(THEME.colors.headerBg),
              verticalAlign: VerticalAlign.CENTER,
              borders: createBorders(BorderStyle.SINGLE, 4, THEME.colors.border),
            })
          ),
        })
      );
    });
  } else {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [paragraph([textRun("No data available", { color: THEME.colors.textLight })])],
            columnSpan: colCount,
            shading: createShading(THEME.colors.headerBg),
          }),
        ],
      })
    );
  }

  elements.push(
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows,
    })
  );

  return elements;
}

function createBulletList(items: string[], level: number = 0): Paragraph[] {
  return items.map((item) =>
    paragraph([textRun(item, { size: THEME.sizes.body })], {
      spacing: { after: 120 },
      bullet: { level },
    })
  );
}

function createApprovalSection(): (Paragraph | Table)[] {
  return [
    new Paragraph({ children: [new PageBreak()] }),
    createSectionHeading("Approval", 1),

    paragraph([textRun("This charter is approved by the following stakeholders:", { size: THEME.sizes.body })], {
      spacing: { after: 400 },
    }),

    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: createBorders(BorderStyle.SINGLE, 8, THEME.colors.primary),
      rows: [
        new TableRow({
          children: [
            new TableCell({
              children: [paragraph([textRun("Role", { bold: true })])],
              width: { size: 25, type: WidthType.PERCENTAGE },
              shading: createShading(THEME.colors.headerBg),
            }),
            new TableCell({
              children: [paragraph([textRun("Name")])],
              width: { size: 25, type: WidthType.PERCENTAGE },
              shading: createShading(THEME.colors.headerBg),
            }),
            new TableCell({
              children: [paragraph([textRun("Signature")])],
              width: { size: 25, type: WidthType.PERCENTAGE },
              shading: createShading(THEME.colors.headerBg),
            }),
            new TableCell({
              children: [paragraph([textRun("Date")])],
              width: { size: 25, type: WidthType.PERCENTAGE },
              shading: createShading(THEME.colors.headerBg),
            }),
          ],
        }),
        ...Array(4)
          .fill(null)
          .map(() =>
            new TableRow({
              children: [
                new TableCell({ children: [paragraph([])] as any }),
                new TableCell({ children: [paragraph([])] as any }),
                new TableCell({ children: [paragraph([])] as any }),
                new TableCell({ children: [paragraph([])] as any }),
              ],
            })
          ),
      ],
    }),
  ];
}

/* ──────────────────────────────────────────────── Main Generator ──────────────────────────────────────────────── */
async function generateWorldClassDocx(
  docData: any,
  meta: {
    projectName: string;
    projectCode: string;
    organisationName: string;
    generatedAt: string;
    pmName?: string;
    version?: string;
  }
) {
  const sections = Array.isArray(docData?.sections) ? docData.sections : [];
  const pm = meta.pmName || "—";

  const children: (Paragraph | Table)[] = [
    ...(createCoverPage({
      ...meta,
      pmName: pm,
      classification: docData?.classification || "INTERNAL",
      version: meta.version || "1.0",
    }) as any),

    createSectionHeading("Document Control", 1),
    createMetadataTable({
      "Project Name": meta.projectName,
      "Project Code": meta.projectCode,
      "Project Manager": pm,
      Organization: meta.organisationName,
      "Last Updated": meta.generatedAt,
      Version: meta.version || "1.0",
      Status: docData?.status || "Draft",
    }),

    ...createExecutiveSummary(docData),

    ...sections.flatMap((sec: any, idx: number) => {
      const title = safeStr(sec?.title || sec?.key || `Section ${idx + 1}`);
      const table = sec?.table ? createStyledTable(sec.table, title) : null;

      if (table) return table;

      const content: (Paragraph | Table)[] = [createSectionHeading(title, 1)];

      if (sec?.description) {
        content.push(
          paragraph([textRun(sec.description, { size: THEME.sizes.body })], {
            spacing: { after: 200 },
          })
        );
      }

      if (Array.isArray(sec?.items)) {
        content.push(
          ...createBulletList(
            sec.items.map((i: any) => (typeof i === "string" ? i : i.text || i.name || JSON.stringify(i)))
          )
        );
      } else if (sec?.content) {
        content.push(
          paragraph([textRun(String(sec.content), { size: THEME.sizes.body })], {
            spacing: { after: 200, line: 360 },
          })
        );
      }

      if (sec?.metadata && typeof sec.metadata === "object") {
        content.push(createMetadataTable(sec.metadata));
      }

      return content;
    }),

    ...(createApprovalSection() as any),
  ];

  const doc = new Document({
    creator: "AlienAI",
    title: `${meta.projectName} - Project Charter`,
    description: "Executive Project Charter Document",
    subject: "Project Management",
    keywords: "Project Charter, PMO, Governance",
    categories: ["Project Documentation"],
    lastModifiedBy: "AlienAI Document Generator",
    revision: meta.version || "1.0",

    styles: {
      default: {
        document: {
          run: {
            font: THEME.fonts.primary,
            size: THEME.sizes.body,
            color: THEME.colors.text,
          },
          paragraph: {
            spacing: { line: 276, after: 200 },
          },
        },
      },
      paragraphStyles: [
        {
          id: "Heading1",
          name: "Heading 1",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: THEME.fonts.heading,
            size: THEME.sizes.heading1,
            bold: true,
            color: THEME.colors.primary,
          },
          paragraph: { spacing: { before: 480, after: 240 } },
        },
        {
          id: "Heading2",
          name: "Heading 2",
          basedOn: "Normal",
          next: "Normal",
          quickFormat: true,
          run: {
            font: THEME.fonts.heading,
            size: THEME.sizes.heading2,
            bold: true,
            color: THEME.colors.secondary,
          },
          paragraph: { spacing: { before: 360, after: 200 } },
        },
      ],
    },

    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
              right: convertInchesToTwip(1.25),
            },
          },
        },

        headers: {
          default: new Header({
            children: [
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: {
                  bottom: { style: BorderStyle.SINGLE, size: 6, color: THEME.colors.primary },
                },
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          paragraph(
                            [
                              textRun(meta.organisationName, {
                                bold: true,
                                color: THEME.colors.primary,
                                size: 20,
                              }),
                            ],
                            { alignment: AlignmentType.LEFT }
                          ),
                        ],
                        width: { size: 50, type: WidthType.PERCENTAGE },
                        borders: { bottom: { style: BorderStyle.NIL } },
                      }),
                      new TableCell({
                        children: [
                          paragraph(
                            [
                              textRun("CONFIDENTIAL", {
                                bold: true,
                                color: THEME.colors.textLight,
                                size: 20,
                              }),
                            ],
                            { alignment: AlignmentType.RIGHT }
                          ),
                        ],
                        width: { size: 50, type: WidthType.PERCENTAGE },
                        borders: { bottom: { style: BorderStyle.NIL } },
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        },

        footers: {
          default: new Footer({
            children: [
              new Table({
                width: { size: 100, type: WidthType.PERCENTAGE },
                borders: {
                  top: { style: BorderStyle.SINGLE, size: 4, color: THEME.colors.border },
                },
                rows: [
                  new TableRow({
                    children: [
                      new TableCell({
                        children: [
                          paragraph(
                            [
                              textRun(`${meta.projectCode} | ${meta.projectName}`, {
                                size: 18,
                                color: THEME.colors.textLight,
                              }),
                            ],
                            { alignment: AlignmentType.LEFT }
                          ),
                        ],
                        width: { size: 33, type: WidthType.PERCENTAGE },
                        borders: { top: { style: BorderStyle.NIL } },
                      }),
                      new TableCell({
                        children: [
                          paragraph(
                            [
                              textRun(`Page `, { size: 18, color: THEME.colors.textLight }),
                              PageNumber.CURRENT,
                              textRun(` of `, { size: 18, color: THEME.colors.textLight }),
                              PageNumber.TOTAL_PAGES,
                            ] as any,
                            { alignment: AlignmentType.CENTER }
                          ),
                        ],
                        width: { size: 33, type: WidthType.PERCENTAGE },
                        borders: { top: { style: BorderStyle.NIL } },
                      }),
                      new TableCell({
                        children: [
                          paragraph(
                            [
                              textRun(`Generated: ${meta.generatedAt}`, {
                                size: 18,
                                color: THEME.colors.textLight,
                              }),
                            ],
                            { alignment: AlignmentType.RIGHT }
                          ),
                        ],
                        width: { size: 34, type: WidthType.PERCENTAGE },
                        borders: { top: { style: BorderStyle.NIL } },
                      }),
                    ],
                  }),
                ],
              }),
            ],
          }),
        },

        children,
      },
    ],
  });

  return await Packer.toBuffer(doc);
}

/* ──────────────────────────────────────────────── Route Handler ──────────────────────────────────────────────── */
type RouteCtx = { params: Promise<{ id: string }> };

async function handle(req: NextRequest, params: { id?: string; artifactId?: string }) {
  try {
    const supabase = await createClient();
    const artifactId = resolveArtifactId(req, params);
    const body = await req.json().catch(() => ({}));
    const projectId = safeStr(body?.projectId ?? body?.project_id).trim();

    if (!artifactId) return jsonErr("Missing artifactId", 400);
    if (!isUuid(artifactId)) return jsonErr("Invalid artifactId", 400);
    if (!projectId) return jsonErr("Missing projectId", 400);
    if (!isUuid(projectId)) return jsonErr("Invalid projectId", 400);

    await requireAuthAndMembership(supabase, projectId);

    const { data: art, error: artErr } = await supabase
      .from("artifacts")
      .select("id, project_id, title, content_json, version, status")
      .eq("id", artifactId)
      .eq("project_id", projectId)
      .maybeSingle();

    if (artErr) throw new Error(artErr.message);
    if (!art) return jsonErr("Not found", 404);

    const stored = safeJson((art as any).content_json);
    const provided = safeJson(body?.content_json ?? body?.contentJson);
    const docData = provided || stored;

    if (!docData) {
      return jsonErr("No valid content found", 400, {
        hint: "Save the charter first, or send content_json in the request body.",
      });
    }

    let projectName = safeStr((art as any).title) || "Project";
    let projectCode = "—";
    let organisationName = "—";

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("title, project_code, organisation_id")
      .eq("id", projectId)
      .maybeSingle();

    if (pErr) throw new Error(pErr.message);

    if (project) {
      projectName = safeStr((project as any).title) || projectName;
      projectCode = safeStr((project as any).project_code) || projectCode;

      const orgId = (project as any).organisation_id;
      if (orgId) {
        const { data: org } = await supabase.from("organisations").select("name").eq("id", orgId).maybeSingle();
        organisationName = safeStr((org as any)?.name) || organisationName;
      }
    }

    const pmName =
      safeStr(docData?.meta?.pm_name) ||
      safeStr(docData?.meta?.project_manager) ||
      safeStr(docData?.meta?.pm) ||
      safeStr(docData?.projectManager) ||
      "";

    const generatedAt = formatUkDateTime();
    const version = safeStr((art as any).version) || "1.0";

    const buf = await generateWorldClassDocx(docData, {
      projectName,
      projectCode,
      organisationName,
      generatedAt,
      pmName: pmName || undefined,
      version,
    });

    const base = projectCode !== "—" ? `${projectCode}_Project_Charter` : `${projectName}_Charter`;
    const filename = `${sanitizeFilename(base)}_v${version}.docx`;

    return new NextResponse(buf, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, no-cache, must-revalidate",
        Pragma: "no-cache",
      },
    });
  } catch (e: any) {
    const msg = String(e?.message ?? "Server error");
    const status = msg === "Unauthorized" ? 401 : msg === "Not found" ? 404 : msg === "Forbidden" ? 403 : 500;
    console.error("DOCX Generation Error:", e);
    return jsonErr(msg, status);
  }
}

export async function GET(request: NextRequest, context: RouteCtx) {
  const params = await context.params;
  return handle(request, params);
}

export async function POST(request: NextRequest, context: RouteCtx) {
  const params = await context.params;
  return handle(request, params);
}
