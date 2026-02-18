import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  PageOrientation,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  VerticalAlign,
} from "docx";
import { z } from "zod";

export type StakeholderRegisterDocxMeta = {
  projectName?: string;
  projectCode?: string;
  organisationName?: string;
  clientName?: string;
  author?: string;
  sponsor?: string;

  generatedAt?: string; // UK display
  generatedDate?: string;
  generatedDateTime?: string;
  isApproved?: boolean;

  version?: string;
  classification?: string;

  logo?: Buffer | null;
};

type StakeholderRow = {
  stakeholder: string;
  contact: string;
  role: string;
  impact: string;
  influence: string;
  mapping: string;
  milestone: string;
  impactNotes: string;
  channels: string;
};

const StakeholderRowSchema = z.object({}).passthrough();

/* ---------------- helpers ---------------- */

function safeStr(x: any): string {
  return typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim();
}

function safeFilename(name: string) {
  return String(name || "Stakeholder_Register")
    .replace(/[\/\\?%*:|"<>]/g, "-")
    .replace(/\s+/g, "_")
    .trim()
    .slice(0, 120);
}

function pick(r: any, key: string) {
  const v1 = r?.[key];
  if (v1 != null && safeStr(v1) !== "") return v1;

  const ci = r?.contact_info;
  const v2 = ci?.[key];
  if (v2 != null && safeStr(v2) !== "") return v2;

  return "";
}

function channelsToString(ch: any): string {
  if (Array.isArray(ch)) return ch.map((x) => safeStr(x)).filter(Boolean).join(", ");
  return safeStr(ch);
}

function titleCaseLevel(v: any): string {
  const s = safeStr(v).toLowerCase();
  if (!s) return "";
  if (s === "high") return "High";
  if (s === "medium") return "Medium";
  if (s === "low") return "Low";
  return safeStr(v);
}

function normalizeInfluenceLevel(v: any): string {
  const s = safeStr(v).toLowerCase();
  if (s === "high" || s === "medium" || s === "low") return s;
  return safeStr(v);
}

function mapRow(raw: any): StakeholderRow {
  const baseObj = typeof raw === "object" && raw ? raw : {};
  const parsed = StakeholderRowSchema.safeParse(baseObj);
  const r = parsed.success ? (parsed.data as any) : baseObj;

  return {
    stakeholder: safeStr(pick(r, "name") || r?.stakeholder),
    contact: safeStr(pick(r, "point_of_contact") || r?.contact || pick(r, "owner")),
    role: safeStr(pick(r, "role") || r?.role),
    impact: titleCaseLevel(pick(r, "impact_level") || r?.impact),
    influence: normalizeInfluenceLevel(pick(r, "influence_level") || r?.influence || pick(r, "influence")),
    mapping: safeStr(pick(r, "stakeholder_mapping") || r?.mapping || pick(r, "category")),
    milestone: safeStr(pick(r, "involvement_milestone") || r?.milestone || pick(r, "frequency")),
    impactNotes: safeStr(pick(r, "stakeholder_impact") || r?.impact_notes || pick(r, "notes")),
    channels: channelsToString(pick(r, "channels") || r?.channels || pick(r, "preferred_channel")),
  };
}

const THEME = {
  ink: "0B1220",
  text: "111827",
  muted: "6B7280",
  line: "E5E7EB",
  headerFill: "F3F4F6",
  cardFill: "F8FAFC",
};

const COLS: Array<{ key: keyof StakeholderRow; header: string; w: number }> = [
  { key: "stakeholder", header: "Stakeholder", w: 1900 },
  { key: "contact", header: "Contact", w: 1500 },
  { key: "role", header: "Role", w: 1700 },
  { key: "impact", header: "Impact", w: 850 },
  { key: "influence", header: "Influence", w: 850 },
  { key: "mapping", header: "Mapping", w: 1500 },
  { key: "milestone", header: "Milestone", w: 1500 },
  { key: "impactNotes", header: "Impact Notes", w: 3300 },
  { key: "channels", header: "Channels", w: 1700 },
];

/* ---------------- main ---------------- */

export async function renderStakeholderDocx(args: {
  meta?: StakeholderRegisterDocxMeta | any;
  rows: any[];
}): Promise<{ docx: Uint8Array; baseName: string }> {
  const meta = (args?.meta ?? {}) as any;
  const rows = Array.isArray(args?.rows) ? args.rows : [];
  const data = rows.map(mapRow);

  const projectCode = safeStr(meta?.projectCode || meta?.project_code) || "—";
  const projectName = safeStr(meta?.projectName || meta?.project_title || meta?.projectTitle) || "Project";
  const organisationName = safeStr(meta?.organisationName || meta?.organisation || meta?.orgName) || "—";
  const clientName = safeStr(meta?.clientName || meta?.client || meta?.client_name) || "—";
  const generatedAt =
    safeStr(meta?.generatedAt || meta?.generatedDateTime || meta?.generated) ||
    safeStr(meta?.generatedDate) ||
    "";

  const reportDate = safeStr(meta?.generatedDate || "") || (generatedAt ? generatedAt.split(" ")[0] : "");

  const baseName = safeFilename(`Stakeholder_Register_${projectCode !== "—" ? projectCode : projectName}`);

  const title = new Paragraph({
    spacing: { after: 120 },
    children: [
      new TextRun({ text: "Stakeholder Register", bold: true, size: 28, color: THEME.ink }),
      new TextRun({ text: `  •  ${projectName}`, size: 20, color: THEME.muted }),
      ...(generatedAt ? [new TextRun({ text: `  •  ${generatedAt}`, size: 20, color: THEME.muted })] : []),
    ],
  });

  const summary = summaryCards({
    organisationName,
    clientName,
    projectCode,
    total: data.length,
    reportDate: reportDate || "—",
  });

  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: { orientation: PageOrientation.LANDSCAPE },
            margin: { top: 720, bottom: 720, left: 720, right: 720 },
          },
        },
        children: [
          title,
          summary,
          new Paragraph({ spacing: { after: 140 }, text: "" }),
          data.length ? registerTable(data) : emptyNote("No stakeholders recorded."),
        ],
      },
    ],
  });

  const buf = await Packer.toBuffer(doc);
  return { docx: new Uint8Array(buf), baseName };
}

/** Legacy alias */
export async function renderStakeholderRegisterDocx(args: { meta?: StakeholderRegisterDocxMeta | any; rows: any[] }) {
  return renderStakeholderDocx(args);
}

export default renderStakeholderDocx;

/* ---------------- header cards ---------------- */

function summaryCards(opts: {
  organisationName: string;
  clientName: string;
  projectCode: string;
  total: number;
  reportDate: string;
}) {
  const cards: Array<{ label: string; value: string }> = [
    { label: "ORGANISATION", value: opts.organisationName || "—" },
    { label: "CLIENT", value: opts.clientName || "—" },
    { label: "PROJECT ID", value: opts.projectCode || "—" },
    { label: "TOTAL STAKEHOLDERS", value: String(opts.total ?? 0) },
    { label: "REPORT DATE", value: opts.reportDate || "—" },
  ];

  const cardCells = cards.map((c) =>
    new TableCell({
      width: { size: 20, type: WidthType.PERCENTAGE },
      borders: cardBorders(),
      shading: { type: ShadingType.CLEAR, color: "auto", fill: THEME.cardFill },
      verticalAlign: VerticalAlign.CENTER,
      margins: { top: 120, bottom: 120, left: 160, right: 160 },
      children: [
        new Paragraph({
          spacing: { before: 0, after: 60 },
          children: [new TextRun({ text: c.label, bold: true, size: 16, color: THEME.muted })],
        }),
        new Paragraph({
          spacing: { before: 0, after: 0 },
          children: [new TextRun({ text: c.value || "—", bold: true, size: 22, color: THEME.ink })],
        }),
      ],
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({ children: cardCells })],
  });
}

function cardBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
    left: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
    right: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
  };
}

/* ---------------- table helpers ---------------- */

function registerTable(rows: StakeholderRow[]): Table {
  const headerRow = new TableRow({
    tableHeader: true,
    children: COLS.map((c) =>
      new TableCell({
        width: { size: c.w, type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, color: "auto", fill: THEME.headerFill },
        borders: cellBorders(),
        verticalAlign: VerticalAlign.CENTER,
        margins: cellMargins(),
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0 },
            children: [new TextRun({ text: c.header, bold: true, size: 18, color: THEME.ink })],
          }),
        ],
      })
    ),
  });

  const bodyRows = rows.map(
    (r) =>
      new TableRow({
        children: COLS.map((c) => {
          const text = safeStr((r as any)[c.key]) || "—";
          return new TableCell({
            width: { size: c.w, type: WidthType.DXA },
            borders: cellBorders(),
            verticalAlign: VerticalAlign.TOP,
            margins: cellMargins(),
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                alignment: AlignmentType.LEFT,
                children: [new TextRun({ text, size: 18, color: THEME.text })],
              }),
            ],
          });
        }),
      })
  );

  return new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows: [headerRow, ...bodyRows] });
}

function emptyNote(text: string) {
  return new Paragraph({
    spacing: { after: 120 },
    children: [new TextRun({ text, italics: true, size: 20, color: THEME.muted })],
  });
}

function cellBorders() {
  return {
    top: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
    bottom: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
    left: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
    right: { style: BorderStyle.SINGLE, size: 1, color: THEME.line },
  };
}

function cellMargins() {
  return { top: 80, bottom: 80, left: 90, right: 90 };
}
