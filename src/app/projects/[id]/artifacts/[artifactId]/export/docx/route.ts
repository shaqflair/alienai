// src/app/projects/[id]/artifacts/[artifactId]/export/docx/route.ts
import "server-only";

import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImageRun,
  Header,
  Footer,
  PageNumber,
} from "docx";

import { parseProjectCharter } from "@/lib/pdf/charter";

export const runtime = "nodejs";

function safeParam(x: unknown) {
  return typeof x === "string" ? x : "";
}

function safeHexColor(x: unknown, fallback = "E60000") {
  const s = String(x ?? "").trim().replace("#", "");
  if (/^([0-9a-fA-F]{6}|[0-9a-fA-F]{3})$/.test(s)) return s.toUpperCase();
  return fallback;
}

function derivedStatus(a: any) {
  const s = String(a?.approval_status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected") return "rejected";
  if (s === "changes_requested") return "changes_requested";
  if (s === "submitted") return "submitted";
  if (s === "on_hold") return "on_hold";
  if (a?.approved_by) return "approved";
  if (a?.rejected_by) return "rejected";
  if (a?.is_locked) return "submitted";
  return "draft";
}

function niceStatus(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "changes_requested") return "CHANGES REQUESTED";
  if (s === "on_hold") return "ON HOLD";
  return s.toUpperCase();
}

function watermarkTextFromStatus(status: string) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return "";
  if (s === "submitted") return "SUBMITTED";
  if (s === "changes_requested") return "CHANGES REQUESTED";
  if (s === "rejected") return "REJECTED";
  if (s === "on_hold") return "ON HOLD";
  return "DRAFT";
}

async function fetchLogoBuffer(url?: string | null): Promise<Buffer | null> {
  const u = String(url ?? "").trim();
  if (!u) return null;
  try {
    const res = await fetch(u, { cache: "no-store" });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

function normalizeCharterContent(artifact: any): string {
  if (artifact?.content_json && typeof artifact.content_json === "object") {
    try {
      return JSON.stringify(artifact.content_json);
    } catch {
      // ignore
    }
  }
  return String(artifact?.content ?? "");
}

function h1(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 240, after: 120 },
  });
}

function h2(text: string) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 240, after: 120 },
  });
}

function p(text: string) {
  const t = String(text ?? "").trim();
  return new Paragraph({
    children: [
      new TextRun({
        text: t || "—",
        size: 22, // 11pt
      }),
    ],
    spacing: { after: 120 },
  });
}

function numberedList(items: string[]) {
  const clean = (items ?? []).map((x) => String(x).trim()).filter(Boolean);
  if (!clean.length) return [p("—")];

  return clean.map(
    (item, i) =>
      new Paragraph({
        children: [
          new TextRun({ text: `${i + 1}. `, bold: true, size: 22 }),
          new TextRun({ text: item, size: 22 }),
        ],
        spacing: { after: 80 },
      })
  );
}

function tableBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    left: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    right: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
    insideVertical: { style: BorderStyle.SINGLE, size: 1, color: "CFCFCF" },
  };
}

function keyValueTable(rows: Array<{ field: string; value: string }>) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "Field", bold: true, size: 22 })] })],
            shading: { fill: "F2F2F2" },
          }),
          new TableCell({
            width: { size: 65, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "Value", bold: true, size: 22 })] })],
            shading: { fill: "F2F2F2" },
          }),
        ],
      }),
      ...rows.map(
        (r) =>
          new TableRow({
            children: [
              new TableCell({
                width: { size: 35, type: WidthType.PERCENTAGE },
                children: [p(r.field)],
              }),
              new TableCell({
                width: { size: 65, type: WidthType.PERCENTAGE },
                children: [p(r.value)],
              }),
            ],
          })
      ),
    ],
  });
}

function twoColumnScopeTable(scope: string, deliverables: string) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "Scope", bold: true, size: 22 })] })],
            shading: { fill: "F2F2F2" },
          }),
          new TableCell({
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: "Deliverables", bold: true, size: 22 })] })],
            shading: { fill: "F2F2F2" },
          }),
        ],
      }),
      new TableRow({
        children: [
          new TableCell({ children: [p(scope)] }),
          new TableCell({ children: [p(deliverables)] }),
        ],
      }),
    ],
  });
}

function milestonesTable(rows: Array<{ milestone: string; targetDate: string; actualDate?: string; notes?: string }>) {
  const safe = (rows ?? []).length ? rows : [{ milestone: "—", targetDate: "—", actualDate: "—", notes: "—" }];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, shading: { fill: "F2F2F2" }, children: [p("Milestone")] }),
          new TableCell({ width: { size: 26, type: WidthType.PERCENTAGE }, shading: { fill: "F2F2F2" }, children: [p("Target Completion Date")] }),
          new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, shading: { fill: "F2F2F2" }, children: [p("Actual Date")] }),
          new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, shading: { fill: "F2F2F2" }, children: [p("Notes")] }),
        ],
      }),
      ...safe.map(
        (m) =>
          new TableRow({
            children: [
              new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, children: [p(m.milestone)] }),
              new TableCell({ width: { size: 26, type: WidthType.PERCENTAGE }, children: [p(m.targetDate)] }),
              new TableCell({ width: { size: 18, type: WidthType.PERCENTAGE }, children: [p(m.actualDate || "")] }),
              new TableCell({ width: { size: 28, type: WidthType.PERCENTAGE }, children: [p(m.notes || "")] }),
            ],
          })
      ),
    ],
  });
}

function approvalsTable(rows: Array<{ role: string; name: string }>) {
  const safe = (rows ?? []).length ? rows : [{ role: "Project Manager", name: "" }, { role: "Sponsor", name: "" }];

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(),
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, shading: { fill: "F2F2F2" }, children: [p("Role")] }),
          new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, shading: { fill: "F2F2F2" }, children: [p("Name")] }),
        ],
      }),
      ...safe.map(
        (a) =>
          new TableRow({
            children: [
              new TableCell({ width: { size: 35, type: WidthType.PERCENTAGE }, children: [p(a.role)] }),
              new TableCell({ width: { size: 65, type: WidthType.PERCENTAGE }, children: [p(a.name)] }),
            ],
          })
      ),
    ],
  });
}

function docHeaderFooter(args: {
  clientName: string;
  brandColorHex: string; // no '#'
  logoBuf: Buffer | null;
}) {
  const { clientName, brandColorHex, logoBuf } = args;

  const left = new Paragraph({
    children: [
      new TextRun({ text: clientName || "Client", bold: true, color: brandColorHex, size: 22 }),
    ],
  });

  const right = new Paragraph({
    alignment: AlignmentType.RIGHT,
    children: logoBuf
      ? [
          new ImageRun({
            type: "png",
            data: logoBuf,
            transformation: { width: 140, height: 28 },
          }),
        ]
      : [],
  });

  const headerTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({ width: { size: 60, type: WidthType.PERCENTAGE }, children: [left] }),
          new TableCell({ width: { size: 40, type: WidthType.PERCENTAGE }, children: [right] }),
        ],
      }),
    ],
  });

  const footer = new Paragraph({
    alignment: AlignmentType.LEFT,
    children: [
      new TextRun({ text: "Confidential – Generated by AlienAI – ", color: "666666", size: 18 }),
      new TextRun({ children: [PageNumber.CURRENT], color: "666666", size: 18 }),
      new TextRun({ text: " / ", color: "666666", size: 18 }),
      new TextRun({ children: [PageNumber.TOTAL_PAGES], color: "666666", size: 18 }),
    ],
  });

  return {
    header: new Header({ children: [headerTable] }),
    footer: new Footer({ children: [footer] }),
  };
}

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string; artifactId: string }> }
) {
  try {
    const { id, artifactId } = await ctx.params;

    const projectId = safeParam(id).trim();
    const aid = safeParam(artifactId).trim();

    if (!projectId || !aid) {
      const url = new URL(req.url);
      return NextResponse.json(
        { error: "Missing params", got: { projectId, aid, pathname: url.pathname } },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: artifact, error: aErr } = await supabase
      .from("artifacts")
      .select("id, project_id, title, content, content_json, approval_status, approved_by, rejected_by, is_locked, version")
      .eq("id", aid)
      .eq("project_id", projectId)
      .maybeSingle();

    if (aErr || !artifact) {
      return NextResponse.json(
        { error: "Artifact not found", details: String(aErr?.message ?? "") },
        { status: 404 }
      );
    }

    const { data: project, error: pErr } = await supabase
      .from("projects")
      .select("id, title, client_name, client_logo_url, brand_primary_color")
      .eq("id", projectId)
      .maybeSingle();

    if (pErr || !project) {
      return NextResponse.json(
        { error: "Project not found", details: String(pErr?.message ?? "") },
        { status: 404 }
      );
    }

    const clientName = String(project.client_name ?? "Client");
    const brandColorHex = safeHexColor(project.brand_primary_color, "E60000");
    const logoBuf = await fetchLogoBuffer(project.client_logo_url);

    const status = derivedStatus(artifact);
    const watermark = watermarkTextFromStatus(status);

    const charter = parseProjectCharter(normalizeCharterContent(artifact));

    const titleText =
      charter.header.projectTitle ||
      String(artifact.title ?? "").trim() ||
      "Project Charter";

    const fileName = `project-charter-${niceStatus(status)}.docx`;

    const hf = docHeaderFooter({ clientName, brandColorHex, logoBuf });

    const doc = new Document({
      sections: [
        {
          properties: {},
          headers: { default: hf.header },
          footers: { default: hf.footer },
          children: [
            // Title
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 200 },
              children: [new TextRun({ text: titleText, bold: true, size: 40 })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 220 },
              children: [
                new TextRun({ text: `Project: ${project.title}  •  Version: ${artifact.version}  •  Status: ${niceStatus(status)}`, size: 20, color: "444444" }),
              ],
            }),
            watermark
              ? new Paragraph({
                  alignment: AlignmentType.CENTER,
                  spacing: { after: 240 },
                  children: [new TextRun({ text: watermark, bold: true, size: 22, color: "D0D0D0" })],
                })
              : new Paragraph({ text: "" }),

            // Project Details
            h1("Project Details"),
            keyValueTable([
              { field: "Project Title", value: charter.header.projectTitle },
              { field: "Project Manager", value: charter.header.projectManager },
              { field: "Project Sponsor", value: charter.header.projectSponsor },
              { field: "Project Start Date", value: charter.header.startDate || "" },
              { field: "Project End Date", value: charter.header.endDate || "" },
              { field: "Approval Status", value: niceStatus(status) },
            ]),

            // Business Need
            h1("Business Need"),
            p(charter.businessNeed),

            // Project Scope
            h1("Project Scope"),
            twoColumnScopeTable(charter.scope.scope, charter.scope.deliverables),

            // Milestones
            h1("Milestone Schedule"),
            milestonesTable(charter.milestones || []),

            // Financials
            h1("Financials"),
            p(charter.financials?.budgetSummary || ""),

            // Risks & Issues
            h1("Top Risks & Issues"),
            ...numberedList(charter.topRisksAndIssues || []),

            // Dependencies
            h1("Dependencies"),
            ...numberedList(charter.dependencies || []),

            // Decision / Ask
            h1("Decision / Ask"),
            p(charter.decisionOrAsk || ""),

            // Approvals
            h1("Approval / Review Committee"),
            approvalsTable(charter.approvals || []),
          ],
        },
      ],
    });

    const buf = await Packer.toBuffer(doc);

    return new NextResponse(new Uint8Array(new Uint8Array(buf)), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Content-Length": String(buf.length),
        "Cache-Control": "no-store",
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: String(e?.message ?? e), stack: String(e?.stack ?? "") },
      { status: 500 }
    );
  }
}
