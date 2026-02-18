import "server-only";

import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  ShadingType,
  VerticalAlign,
} from "docx";

import { loadChangeExportData } from "./load";

/* ---------------- helpers ---------------- */

function safeStr(x: any) {
  if (typeof x === "string") return x.trim();
  if (x == null) return "";
  return String(x).trim();
}

function sanitizeFilename(name: string) {
  return (
    safeStr(name)
      .replace(/[^a-z0-9._-]+/gi, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 120) || "change"
  );
}

function formatDateUk(x: any) {
  const s = safeStr(x);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-GB");
}

/* ---------------- Proposed Change parsing (same behaviour as before, but styled) ---------------- */

type PcSection = { key: string; title: string; body: string; kind: "text" | "bullets" | "steps" };

function isLikelyBullets(s: string) {
  const t = safeStr(s);
  if (!t) return false;
  if (t.split(";").filter(Boolean).length >= 3) return true;
  return false;
}

function isLikelySteps(s: string) {
  const t = safeStr(s);
  if (!t) return false;
  return /\b1\s*[\)\.\-]\s*/.test(t) && /\b2\s*[\)\.\-]\s*/.test(t);
}

function splitBullets(s: string) {
  return safeStr(s)
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitSteps(s: string) {
  const t = safeStr(s);
  if (!t) return [];
  const parts = t.split(/\b\d+\s*[\)\.\-]\s*/).map((x) => x.trim());
  return parts.filter(Boolean);
}

function parseProposedChangeToSections(input: any): PcSection[] {
  const raw = safeStr(input);
  if (!raw) return [];

  const defs: Array<{ key: string; title: string; aliases: string[] }> = [
    { key: "justification", title: "Justification", aliases: ["justification", "driver", "value"] },
    { key: "financial", title: "Financial Impact", aliases: ["financial", "cost", "finance", "budget"] },
    { key: "schedule", title: "Schedule Impact", aliases: ["schedule", "timeline"] },
    { key: "risks", title: "Risks", aliases: ["risks", "risk level", "risk"] },
    { key: "mitigations", title: "Mitigations", aliases: ["mitigations", "controls"] },
    { key: "dependencies", title: "Dependencies", aliases: ["dependencies", "dependency"] },
    { key: "assumptions", title: "Assumptions", aliases: ["assumptions", "assumption"] },
    {
      key: "implementation",
      title: "Implementation Plan",
      aliases: ["implementation plan", "implementation", "plan", "steps"],
    },
    { key: "validation", title: "Validation Evidence", aliases: ["validation evidence", "validation", "evidence"] },
    { key: "rollback", title: "Rollback Plan", aliases: ["rollback plan", "rollback", "backout", "revert"] },
    { key: "unknowns", title: "Unknowns", aliases: ["unknowns", "tbc", "to be confirmed"] },
  ];

  const aliasToDef = new Map<string, { key: string; title: string }>();
  const aliases: string[] = [];
  for (const d of defs) {
    for (const a of d.aliases) {
      const al = a.toLowerCase();
      aliasToDef.set(al, { key: d.key, title: d.title });
      aliases.push(al.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    }
  }

  const re = new RegExp(`\\b(${aliases.join("|")})\\s*:\\s*`, "gi");

  const matches: Array<{ alias: string; start: number; end: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    matches.push({ alias: String(m[1] || "").toLowerCase(), start: m.index, end: re.lastIndex });
  }

  if (!matches.length) {
    const body = raw.trim();
    const kind: PcSection["kind"] = isLikelySteps(body) ? "steps" : isLikelyBullets(body) ? "bullets" : "text";
    return [{ key: "summary", title: "Summary", body, kind }];
  }

  const out: PcSection[] = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const next = matches[i + 1];
    const def = aliasToDef.get(cur.alias) || { key: cur.alias, title: cur.alias };
    const chunk = raw.slice(cur.end, next ? next.start : raw.length).trim();
    if (!chunk) continue;

    const kind: PcSection["kind"] = isLikelySteps(chunk) ? "steps" : isLikelyBullets(chunk) ? "bullets" : "text";
    out.push({ key: def.key, title: def.title, body: chunk, kind });
  }

  return out;
}

/* ---------------- charter-like design system ---------------- */

// Accent + neutrals roughly matching your Charter vibe
const COLOR = {
  accent: "2563EB", // blue
  accent2: "7C3AED", // violet (for badge gradient feel, used subtly)
  ink: "0B1220",
  muted: "64748B",
  line: "E7ECF7",
  card: "FBFDFF",
  keyShade: "F1F5F9",
};

function tr(text: string, opts?: { bold?: boolean; color?: string; size?: number }) {
  return new TextRun({
    text,
    bold: !!opts?.bold,
    color: opts?.color,
    size: opts?.size,
  });
}

function para(
  text: string,
  opts?: {
    bold?: boolean;
    color?: string;
    size?: number;
    align?: AlignmentType;
    spacingAfter?: number;
    spacingBefore?: number;
  }
) {
  return new Paragraph({
    children: [tr(text, { bold: opts?.bold, color: opts?.color, size: opts?.size })],
    alignment: opts?.align,
    spacing: { before: opts?.spacingBefore ?? 0, after: opts?.spacingAfter ?? 0 },
  });
}

function sectionTitle(n: string, title: string) {
  return new Paragraph({
    children: [tr(`${n}. `, { bold: true, color: COLOR.accent }), tr(title, { bold: true, color: COLOR.ink })],
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 260, after: 120 },
  });
}

function cardCell(label: string, value: string) {
  return new TableCell({
    verticalAlign: VerticalAlign.TOP,
    shading: { type: ShadingType.CLEAR, fill: COLOR.card, color: "auto" },
    margins: { top: 170, bottom: 170, left: 220, right: 220 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      left: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      right: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
    },
    children: [
      new Paragraph({
        children: [tr(label.toUpperCase(), { bold: true, color: COLOR.muted, size: 18 })],
        spacing: { after: 70 },
      }),
      new Paragraph({
        children: [tr(value || "—", { bold: true, color: COLOR.ink, size: 26 })],
      }),
    ],
  });
}

function kvKeyCell(text: string) {
  return new TableCell({
    verticalAlign: VerticalAlign.TOP,
    shading: { type: ShadingType.CLEAR, fill: COLOR.keyShade, color: "auto" },
    margins: { top: 140, bottom: 140, left: 180, right: 180 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      left: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      right: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
    },
    children: [para(text, { bold: true, color: COLOR.muted, size: 18 })],
  });
}

function kvValCell(text: string) {
  return new TableCell({
    verticalAlign: VerticalAlign.TOP,
    margins: { top: 140, bottom: 140, left: 180, right: 180 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      left: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
      right: { style: BorderStyle.SINGLE, size: 6, color: COLOR.line },
    },
    children: [para(text || "—", { color: COLOR.ink, size: 22 })],
  });
}

function kvRow(k1: string, v1: string, k2: string, v2: string) {
  return new TableRow({
    children: [kvKeyCell(k1), kvValCell(v1), kvKeyCell(k2), kvValCell(v2)],
  });
}

function bodyText(text: string) {
  return new Paragraph({
    children: [tr(safeStr(text) || "—", { color: COLOR.ink, size: 22 })],
    spacing: { after: 120 },
  });
}

function h3(text: string) {
  return new Paragraph({
    children: [tr(text, { bold: true, color: COLOR.accent, size: 22 })],
    spacing: { before: 160, after: 80 },
  });
}

function bullet(text: string) {
  return new Paragraph({
    text: safeStr(text) || "—",
    bullet: { level: 0 },
    spacing: { after: 60 },
  });
}

function numbered(text: string, i: number) {
  return new Paragraph({
    children: [tr(`${i}. ${safeStr(text) || "—"}`, { color: COLOR.ink, size: 22 })],
    spacing: { after: 60 },
  });
}

function renderSectionBody(s: PcSection): Paragraph[] {
  const blocks: Paragraph[] = [];
  if (s.kind === "bullets") {
    for (const b of splitBullets(s.body)) blocks.push(bullet(b));
    return blocks.length ? blocks : [bodyText("—")];
  }
  if (s.kind === "steps") {
    const steps = splitSteps(s.body);
    for (let i = 0; i < steps.length; i++) blocks.push(numbered(steps[i], i + 1));
    return blocks.length ? blocks : [bodyText("—")];
  }
  return [bodyText(s.body)];
}

/* ---------------- exporter ---------------- */

export async function exportChangeRequestDocxBuffer(changeId: string) {
  const { cr, attachments, branding } = await loadChangeExportData(changeId);

  const ref = safeStr(cr.public_id || cr.human_id || cr.reference || cr.id?.slice?.(0, 8) || "CR");
  const title = safeStr(cr.title || "Change Request");

  const projectTitle = safeStr(branding?.projectTitle || "Project");
  const projectCode = safeStr(branding?.projectCode || "—");
  const orgName = safeStr(branding?.orgName || "—");
  const clientName = safeStr(branding?.clientName || "—");

  const submitted = formatDateUk(cr.submitted_at || cr.created_at);
  const neededBy = formatDateUk(cr.needed_by || cr.required_by || cr.due_date);

  const proposedSectionsAll = parseProposedChangeToSections(cr.proposed_change || "");

  // Pull implementation + rollback from proposed_change if present
  const pcImplementation = proposedSectionsAll.find((s) => s.key === "implementation") || null;
  const pcRollback = proposedSectionsAll.find((s) => s.key === "rollback") || null;

  // ? Always show Implementation + Rollback as dedicated sections.
  // Prefer explicit columns; fallback to proposed_change sections; fallback to "—".
  const implementationText =
    safeStr(cr.implementation_plan || cr.plan) || safeStr(pcImplementation?.body) || "";
  const rollbackText =
    safeStr(cr.rollback_plan || cr.rollback) || safeStr(pcRollback?.body) || "";

  // ? Remove those from Proposed Change to avoid duplication
  const proposedSections = proposedSectionsAll.filter((s) => s.key !== "implementation" && s.key !== "rollback");

  const asStandalone = safeStr(cr.assumptions);
  const depStandalone = safeStr(cr.dependencies);

  // Cover-like header (Charter style): badge + big title
  const badge = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            width: { size: 12, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.TOP,
            shading: { type: ShadingType.CLEAR, fill: COLOR.accent, color: "auto" },
            margins: { top: 200, bottom: 200, left: 0, right: 0 },
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [tr("CR", { bold: true, color: "FFFFFF", size: 34 })],
              }),
            ],
          }),
          new TableCell({
            width: { size: 88, type: WidthType.PERCENTAGE },
            verticalAlign: VerticalAlign.TOP,
            borders: {
              top: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              bottom: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              left: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
              right: { style: BorderStyle.NONE, size: 0, color: "FFFFFF" },
            },
            children: [
              new Paragraph({
                children: [tr("Change Request", { bold: true, color: COLOR.ink, size: 36 })],
                spacing: { after: 80 },
              }),
              new Paragraph({
                children: [tr(title, { bold: true, color: COLOR.ink, size: 30 })],
                spacing: { after: 70 },
              }),
              new Paragraph({
                children: [
                  tr("Reference: ", { bold: true, color: COLOR.muted, size: 20 }),
                  tr(ref, { bold: true, color: COLOR.accent, size: 20 }),
                ],
              }),
            ],
          }),
        ],
      }),
    ],
  });

  // Meta cards (like Charter header blocks)
  const cards = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        children: [cardCell("Organisation", orgName), cardCell("Client", clientName)],
      }),
      new TableRow({
        children: [cardCell("Project ID", projectCode), cardCell("Owner", safeStr(cr.owner_label || cr.owner || "—"))],
      }),
    ],
  });

  // Summary grid (Charter-like table tone)
  const summaryTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      kvRow("Submitted", submitted, "Needed By", neededBy),
      kvRow("Status", safeStr(cr.status || "—"), "Priority", safeStr(cr.priority || "—")),
      kvRow("Decision", safeStr(cr.decision_status || "—"), "Requester", safeStr(cr.requester_name || "—")),
    ],
  });

  // Build section numbering deterministically (so Implementation/Rollback are always present)
  let sec = 1;
  const sectionNo = () => String(sec++);

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          badge,
          new Paragraph({ text: "", spacing: { after: 120 } }),
          cards,
          new Paragraph({ text: "", spacing: { after: 180 } }),
          summaryTable,

          sectionTitle(sectionNo(), "Impacts"),
          new Table({
            width: { size: 100, type: WidthType.PERCENTAGE },
            rows: [
              kvRow(
                "Cost Impact",
                safeStr(cr.cost_impact ?? cr.budget_impact ?? "—") || "—",
                "Schedule Impact",
                safeStr(cr.schedule_impact ?? cr.schedule_days ?? "—") || "—"
              ),
              kvRow(
                "Risk Impact",
                safeStr(cr.risk_impact ?? "—") || "—",
                "Benefits",
                safeStr(cr.benefits ?? cr.benefit_summary ?? "—") || "—"
              ),
            ],
          }),

          sectionTitle(sectionNo(), "Description"),
          bodyText(cr.description || cr.change_description || "—"),

          sectionTitle(sectionNo(), "Proposed Change"),
          ...(proposedSections.length
            ? proposedSections.flatMap((s) => [h3(s.title), ...renderSectionBody(s)])
            : [bodyText("—")]),

          // ? ALWAYS present again (even if it was embedded in proposed_change)
          sectionTitle(sectionNo(), "Implementation Plan"),
          ...(implementationText ? [bodyText(implementationText)] : [bodyText("—")]),

          // ? ALWAYS present again (even if it was embedded in proposed_change)
          sectionTitle(sectionNo(), "Rollback Plan"),
          ...(rollbackText ? [bodyText(rollbackText)] : [bodyText("—")]),

          // Keep assumptions/dependencies as dedicated sections if stored in columns
          sectionTitle(sectionNo(), "Assumptions"),
          ...(asStandalone ? [bodyText(asStandalone)] : [bodyText("—")]),

          sectionTitle(sectionNo(), "Dependencies"),
          ...(depStandalone ? [bodyText(depStandalone)] : [bodyText("—")]),

          // Attachments always included
          sectionTitle(sectionNo(), "Attachments"),
          ...(attachments?.length
            ? attachments.map((a: any) => bullet(`${safeStr(a.name)}${a.url ? ` (${safeStr(a.url)})` : ""}`))
            : [bodyText("No attachments")]),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  const filename = `${sanitizeFilename(ref)}_ChangeRequest.docx`;

  return { buffer, filename };
}
