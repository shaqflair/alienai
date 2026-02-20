// src/lib/exports/closure-report/exportClosureReportDocxBuffer.ts
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

import { safeStr, toProjectCode, pickFirstTruthy } from "./utils";

/* ==================== Charter-style tokens ==================== */

const COLORS = {
  blue: "2563EB",
  slate900: "0F172A",
  slate500: "64748B",
  slate400: "94A3B8",
  border: "E2E8F0",
  bgCell: "F8FAFC",
  bgHeader: "F1F5F9",
  bgAlt: "FAFAFA",
};

const META_LABEL_SIZE = 16;
const META_VALUE_SIZE = 20;

/* ==================== tiny safe helpers ==================== */

function devLog(...args: any[]) {
  if (process.env.NODE_ENV === "development") {
    // eslint-disable-next-line no-console
    console.log(...args);
  }
}

function clampStr(x: any, max = 160): string {
  const s = safeStr(x).trim();
  return s.length > max ? s.slice(0, max) : s;
}

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function yyyyMmDdFromAny(x: any): string {
  const s = safeStr(x).trim();
  if (!s) {
    const d = new Date();
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }

  // Prefer ISO-like YYYY-MM-DD
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) {
    const now = new Date();
    return `${now.getUTCFullYear()}-${pad2(now.getUTCMonth() + 1)}-${pad2(now.getUTCDate())}`;
  }
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function slugFilePart(x: any, fallback = "project") {
  const s = safeStr(x).trim().toLowerCase();
  const cleaned = s
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

/* ==================== tolerant getters ==================== */

function getPath(obj: any, path: string): any {
  try {
    if (!obj || !path) return undefined;
    const parts = path.split(".").filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  } catch {
    return undefined;
  }
}

function pickAny(obj: any, paths: string[]) {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (v === true) return "Yes";
    if (v === false) return "No";
    if (v != null && typeof v !== "object") return String(v);
  }
  return "";
}

function toArrayLoose(items: any): any[] {
  if (items == null) return [];
  if (Array.isArray(items)) return items;

  if (typeof items === "string") {
    const s = items.trim();
    if (!s) return [];
    const parts = s
      .split(/\r?\n|•|\u2022|;+/g)
      .map((x) => x.trim())
      .filter(Boolean);
    return parts.length ? parts : [s];
  }

  return [items];
}

/**
 * Unwrap wrapper objects like:
 *  - { key: [...] }
 *  - { items: [...] } / { rows: [...] } / { data: [...] }
 */
function unwrapArray(input: any, preferredKeys: string[] = []): any[] {
  if (input == null) return [];
  if (Array.isArray(input)) return input;

  if (typeof input === "object") {
    for (const k of preferredKeys) {
      const v = (input as any)?.[k];
      if (Array.isArray(v)) return v;
    }

    const common = ["items", "rows", "data", "value", "list", "entries", "key"];
    for (const k of common) {
      const v = (input as any)?.[k];
      if (Array.isArray(v)) return v;
    }

    const arrKey = Object.keys(input).find((k) => Array.isArray((input as any)[k]));
    if (arrKey) return (input as any)[arrKey];
  }

  return toArrayLoose(input);
}

function firstString(obj: any, keys: string[]) {
  for (const k of keys) {
    const v = obj?.[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function textFromAny(x: any): string {
  if (x == null) return "";
  if (typeof x === "string") return x.trim();
  if (typeof x === "number" || typeof x === "boolean") return String(x);

  if (typeof x === "object") {
    const candidate = pickFirstTruthy(x, [
      "text",
      "title",
      "value",
      "achievement",
      "summary",
      "description",
      "detail",
      "lesson",
      "name",
      "action",
      "note",
      "item",
      "deliverable",
      "criterion",
      "recommendation",
    ]);
    if (candidate) return candidate;

    try {
      const s = JSON.stringify(x);
      return s && s !== "{}" ? s : "";
    } catch {
      return "";
    }
  }

  return "";
}

/* ==================== normalisers ==================== */

function normaliseRag(v: any): string {
  const s = safeStr(v).trim();
  if (!s) return "—";
  const t = s.toLowerCase();

  if (t.includes("green")) return "GREEN";
  if (t.includes("amber") || t.includes("yellow")) return "AMBER";
  if (t.includes("red")) return "RED";

  if (t === "g") return "GREEN";
  if (t === "a" || t === "y") return "AMBER";
  if (t === "r") return "RED";

  return s.toUpperCase();
}

function normaliseOverall(v: any): string {
  const s = safeStr(v).trim();
  if (!s) return "—";
  const t = s.toLowerCase();

  // editor: good | watch | critical
  if (t === "good") return "Good";
  if (t === "watch") return "Watch";
  if (t === "critical") return "Critical";

  // legacy
  if (t === "ok" || t === "okay") return "OK";
  if (t === "poor" || t === "bad") return "Poor";
  if (t === "at risk" || t === "atrisk") return "At Risk";

  return s;
}

/* ==================== small doc helpers ==================== */

function para(
  text: string,
  opts?: {
    bold?: boolean;
    size?: number;
    color?: string;
    spacingAfter?: number;
    spacingBefore?: number;
    italics?: boolean;
  }
) {
  return new Paragraph({
    spacing: { after: opts?.spacingAfter ?? 120, before: opts?.spacingBefore ?? 0 },
    children: [
      new TextRun({
        text: safeStr(text),
        bold: !!opts?.bold,
        italics: !!opts?.italics,
        size: opts?.size ?? 22,
        color: opts?.color,
      }),
    ],
  });
}

/* ==================== Shared Charter-style UI ==================== */

function blueHeaderBand(badge: string, title: string, subtitle: string) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.SINGLE, size: 16, color: COLORS.border },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            shading: { type: ShadingType.CLEAR, fill: COLORS.blue },
            verticalAlign: VerticalAlign.CENTER,
            width: { size: 15, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [new TextRun({ text: badge, bold: true, size: 48, color: "FFFFFF" })],
              }),
            ],
          }),
          new TableCell({
            columnSpan: 3,
            margins: { left: 200, top: 100, bottom: 100, right: 100 },
            children: [
              new Paragraph({
                spacing: { after: 100 },
                children: [new TextRun({ text: safeStr(title), bold: true, size: 48, color: COLORS.slate900 })],
              }),
              new Paragraph({
                children: [new TextRun({ text: safeStr(subtitle), size: 28, color: COLORS.slate500 })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function metaCell(label: string, value: string, opts?: { isCode?: boolean }) {
  return new TableCell({
    shading: { type: ShadingType.CLEAR, fill: COLORS.bgCell },
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    children: [
      new Paragraph({
        children: [new TextRun({ text: safeStr(label), size: META_LABEL_SIZE, color: COLORS.slate500, bold: true })],
      }),
      new Paragraph({
        children: [
          new TextRun({
            text: safeStr(value) || "—",
            size: META_VALUE_SIZE,
            bold: true,
            color: opts?.isCode ? COLORS.blue : COLORS.slate900,
            font: opts?.isCode ? "Consolas" : undefined,
          }),
        ],
      }),
    ],
  });
}

function metaGrid4(meta: { organisation: string; client: string; projectId: string; generated: string }) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
      left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
      right: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    },
    rows: [
      new TableRow({
        children: [
          metaCell("Organisation", meta.organisation),
          metaCell("Client", meta.client),
          metaCell("Project ID", meta.projectId, { isCode: true }),
          metaCell("Generated", meta.generated),
        ],
      }),
    ],
  });
}

function sectionHeader(title: string) {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: COLORS.blue },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
      insideHorizontal: { style: BorderStyle.NONE },
      insideVertical: { style: BorderStyle.NONE },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            margins: { top: 80, bottom: 80, left: 120, right: 120 },
            children: [
              new Paragraph({
                children: [new TextRun({ text: safeStr(title), bold: true, size: 24, color: COLORS.blue })],
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

function charterTable(headers: string[], rows: string[][]) {
  const borders = {
    top: { style: BorderStyle.SINGLE, size: 8, color: COLORS.blue },
    bottom: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
    left: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
    right: { style: BorderStyle.SINGLE, size: 6, color: COLORS.border },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
    insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  };

  const headerRow = new TableRow({
    children: headers.map(
      (h) =>
        new TableCell({
          shading: { type: ShadingType.CLEAR, fill: COLORS.bgHeader },
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
          children: [
            new Paragraph({
              children: [new TextRun({ text: safeStr(h), bold: true, size: 18, color: COLORS.blue })],
            }),
          ],
        })
    ),
  });

  const safeRows = Array.isArray(rows) && rows.length ? rows : [["—"]];
  const colCount = headers.length || 1;

  const bodyRows = safeRows.map((r, idx) => {
    const shading = idx % 2 === 1 ? { type: ShadingType.CLEAR, fill: COLORS.bgAlt } : undefined;
    return new TableRow({
      children: Array.from({ length: colCount }, (_, c) => safeStr(r?.[c] ?? "—")).map(
        (cell) =>
          new TableCell({
            shading,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [new Paragraph({ children: [new TextRun({ text: cell || "—", size: 20 })] })],
          })
      ),
    });
  });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders,
    rows: [headerRow, ...bodyRows],
  });
}

function bulletLines(items: any, mapFn?: (x: any) => string) {
  const arr = unwrapArray(items);

  const lines = arr
    .map((x) => (mapFn ? mapFn(x) : textFromAny(x)))
    .map((s) => safeStr(s).trim())
    .filter(Boolean);

  if (!lines.length) {
    return [para("No content recorded", { italics: true, size: 22, color: COLORS.slate400, spacingAfter: 140 })];
  }

  return lines.map(
    (t) =>
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 80, before: 40 },
        children: [new TextRun({ text: t, size: 22 })],
      })
  );
}

function boolToYesNo(v: any): string {
  if (v === true) return "Yes";
  if (v === false) return "No";
  const s = safeStr(v).trim();
  return s || "—";
}

function moneyStr(v: any): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && Number.isFinite(v)) {
    try {
      return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(v);
    } catch {
      return `£${Math.round(v).toLocaleString("en-GB")}`;
    }
  }
  return safeStr(v).trim() || "—";
}

/* ==================== Filename helper ==================== */

export function closureReportDocxFilename(meta?: any) {
  const projectName =
    pickAny(meta, ["projectName", "title", "project_title", "project.project_name"]) ||
    pickAny(meta, ["meta.projectName", "meta.title"]) ||
    "project";

  const codeRaw =
    pickAny(meta, ["projectCode", "project_code", "projectId", "project_id", "project.project_code"]) ||
    pickAny(meta, ["meta.projectCode"]) ||
    "";

  const code = toProjectCode(codeRaw) || "";
  const date = yyyyMmDdFromAny(pickAny(meta, ["generatedAt", "generated", "generatedDateTime", "generatedDateTimeUk"]) || "");

  const parts = [
    "project-closure-report",
    code ? slugFilePart(code, "project") : slugFilePart(projectName, "project"),
    date,
  ].filter(Boolean);

  return `${parts.join("-")}.docx`;
}

/* ==================== Main Closure DOCX (Charter layout) ==================== */

export async function exportClosureReportDocxBuffer({
  doc,
  meta,
}: {
  doc: any;
  meta?: any;
}): Promise<Buffer> {
  const model = doc ?? {};

  // ---- PRIMARY: support the editor schema (ClosureDocV1) ----

  const projectName =
    pickAny(model, ["project.project_name"]) ||
    pickAny(meta, ["projectName", "title", "project_title"]) ||
    pickAny(model, ["meta.projectName", "meta.title", "projectName", "title"]) ||
    "Project";

  const projectCodeRaw =
    pickAny(model, ["project.project_code"]) ||
    pickAny(meta, ["projectCode", "project_code", "projectId", "project_id"]) ||
    pickAny(model, ["meta.projectCode", "project_code", "projectId", "project_id"]) ||
    "";

  const projectCode = toProjectCode(projectCodeRaw);

  const orgName =
    pickAny(meta, ["organisationName", "orgName", "organisation", "organisation_name"]) ||
    pickAny(model, ["meta.organisationName", "meta.orgName", "organisation", "organisation_name", "org_name", "orgName"]) ||
    "—";

  const clientName =
    pickAny(model, ["project.client_name"]) ||
    pickAny(meta, ["clientName", "client", "client_name"]) ||
    pickAny(model, ["meta.clientName", "client_business", "clientBusiness", "client", "client_name"]) ||
    "—";

  const generatedFooter =
    pickAny(meta, ["generatedDateTimeUk", "generatedDateTime", "generated", "generatedAt"]) ||
    pickAny(model, ["meta.generatedDateTimeUk", "meta.generatedDateTime", "meta.generated", "meta.generatedAt"]) ||
    pickAny(model, ["generatedDateTimeUk", "generatedDateTime", "generated"]) ||
    "—";

  const generatedGrid = generatedFooter;

  const ragRaw =
    pickAny(model, ["health.rag"]) || pickAny(meta, ["rag", "rag_status", "ragStatus"]) || pickAny(model, ["meta.rag", "rag", "rag_status", "ragStatus"]) || "—";

  const overallRaw =
    pickAny(model, ["health.overall_health"]) ||
    pickAny(meta, ["overall", "overall_health", "overallHealth"]) ||
    pickAny(model, ["meta.overall", "overall", "overall_health", "overallHealth"]) ||
    "—";

  const rag = normaliseRag(ragRaw);
  const overall = normaliseOverall(overallRaw);

  const executiveSummary =
    pickAny(model, ["health.summary"]) ||
    pickAny(model, ["executiveSummary", "summary", "projectSummary.summary", "project_summary.summary"]) ||
    "";

  // Stakeholders (editor: stakeholders.key)
  const stakeholdersRaw =
    getPath(model, "stakeholders.key") ?? getPath(model, "stakeholders") ?? getPath(model, "keyStakeholders") ?? null;

  // Achievements (editor: achievements.key_achievements)
  const achievementsRaw =
    getPath(model, "achievements.key_achievements") ?? getPath(model, "achievements") ?? getPath(model, "keyAchievements") ?? null;

  const stakeholdersArr = unwrapArray(stakeholdersRaw, ["key", "stakeholders", "items", "rows", "data"]);
  const achievementsArr = unwrapArray(achievementsRaw, ["key_achievements", "achievements", "items", "rows", "data"]);

  // Success criteria (editor: success.criteria)
  const criteriaRaw =
    getPath(model, "success.criteria") ??
    getPath(model, "criteria") ??
    getPath(model, "successCriteria") ??
    getPath(model, "success_criteria") ??
    null;
  const criteriaArr = unwrapArray(criteriaRaw, ["criteria", "success_criteria", "items", "rows", "data"]);

  // Deliverables (editor: deliverables.delivered/outstanding)
  const deliveredRaw = getPath(model, "deliverables.delivered") ?? getPath(model, "delivered") ?? null;
  const deliveredArr = unwrapArray(deliveredRaw, ["delivered", "items", "rows", "data"]);

  const outstandingRaw = getPath(model, "deliverables.outstanding") ?? getPath(model, "outstanding") ?? null;
  const outstandingArr = unwrapArray(outstandingRaw, ["outstanding", "items", "rows", "data"]);

  // Financial rows (editor: financial_closeout.budget_rows)
  const budgetRowsRaw =
    getPath(model, "financial_closeout.budget_rows") ?? getPath(model, "budgetRows") ?? getPath(model, "financial.budget_rows") ?? null;
  const budgetRowsArr = unwrapArray(budgetRowsRaw, ["budget_rows", "budgetRows", "items", "rows", "data"]);

  // Lessons learned (editor: lessons.*)
  const wentWellRaw = getPath(model, "lessons.went_well") ?? getPath(model, "wentWell") ?? null;
  const wentWellArr = unwrapArray(wentWellRaw, ["went_well", "wentWell", "items", "rows", "data"]);

  const didntGoWellRaw = getPath(model, "lessons.didnt_go_well") ?? getPath(model, "didntGoWell") ?? null;
  const didntGoWellArr = unwrapArray(didntGoWellRaw, ["didnt_go_well", "didntGoWell", "items", "rows", "data"]);

  const surprisesRaw = getPath(model, "lessons.surprises_risks") ?? getPath(model, "surprises") ?? null;
  const surprisesArr = unwrapArray(surprisesRaw, ["surprises_risks", "surprises", "items", "rows", "data"]);

  // Risks/issues handover (editor: handover.risks_issues)
  const risksIssuesRaw =
    getPath(model, "handover.risks_issues") ?? getPath(model, "risksIssues") ?? getPath(model, "risks_issues") ?? null;
  const risksIssuesArr = unwrapArray(risksIssuesRaw, ["risks_issues", "risksIssues", "items", "rows", "data"]);

  // Recommendations (editor: recommendations.items)
  const recsRaw =
    getPath(model, "recommendations.items") ??
    getPath(model, "recommendations") ??
    getPath(model, "followUpActions") ??
    getPath(model, "follow_up_actions") ??
    null;
  const recsArr = unwrapArray(recsRaw, ["items", "recommendations", "follow_up_actions", "rows", "data"]);

  // Sign-off (editor: signoff)
  const signoff = getPath(model, "signoff") ?? getPath(model, "finalSignOff") ?? getPath(model, "final_sign_off") ?? {};

  // Optional, gated dev probe (kept minimal + safe)
  devLog("[closure-docx] model keys:", Object.keys(model || {}).slice(0, 30));
  devLog("[closure-docx] project:", { projectName: clampStr(projectName), projectCode: clampStr(projectCodeRaw) });

  /* ==================== build document ==================== */

  const docChildren: Array<Paragraph | Table> = [];

  // Title band + meta grid
  docChildren.push(blueHeaderBand("PC", "Project Closure Report", projectName));
  docChildren.push(new Paragraph({ spacing: { after: 200 } }));
  docChildren.push(
    metaGrid4({
      organisation: orgName,
      client: clientName,
      projectId: projectCode || "—",
      generated: generatedGrid,
    })
  );
  docChildren.push(new Paragraph({ spacing: { after: 220 } }));

  const openRisksCount = Array.isArray(risksIssuesArr)
    ? risksIssuesArr.filter((x: any) => String(x?.status || "").toLowerCase() !== "closed").length
    : 0;

  docChildren.push(charterTable(["RAG", "Overall", "Open Risks / Issues"], [[rag, overall, String(openRisksCount)]]));

  // Executive Summary
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Executive Summary"));
  docChildren.push(para(executiveSummary || "No content recorded", { spacingAfter: 160 }));

  // Key Stakeholders
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Key Stakeholders"));
  if (stakeholdersArr.length) {
    docChildren.push(
      charterTable(
        ["Name", "Role"],
        stakeholdersArr.map((s: any) => [
          safeStr(firstString(s, ["name", "fullName"]) || textFromAny(s) || "—"),
          safeStr(firstString(s, ["role", "responsibility", "title"]) || "—"),
        ])
      )
    );
  } else {
    docChildren.push(para("No content recorded", { color: COLORS.slate400, size: 22 }));
  }

  // Key Achievements
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Key Achievements"));
  docChildren.push(
    ...bulletLines(achievementsArr, (a) => firstString(a, ["text", "title", "achievement", "value"]) || textFromAny(a))
  );

  // Success Criteria
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Success Criteria"));
  if (criteriaArr.length) {
    docChildren.push(
      charterTable(
        ["Criterion", "Achieved"],
        criteriaArr.map((c: any) => [
          safeStr(firstString(c, ["text", "criterion", "title"]) || textFromAny(c) || "—"),
          (() => {
            const a = safeStr(c?.achieved).toLowerCase();
            if (a === "yes") return "Yes";
            if (a === "partial") return "Partially";
            if (a === "no") return "No";
            if (c?.achieved === true) return "Yes";
            if (c?.achieved === false) return "No";
            return safeStr(firstString(c, ["achieved", "status"]) || "—");
          })(),
        ])
      )
    );
  } else {
    docChildren.push(para("No content recorded", { color: COLORS.slate400, size: 22 }));
  }

  // Deliverables — Delivered
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Deliverables — Delivered"));
  if (deliveredArr.length) {
    docChildren.push(
      charterTable(
        ["Deliverable", "Accepted by", "Accepted on"],
        deliveredArr.map((d: any) => [
          safeStr(firstString(d, ["deliverable", "item", "title"]) || textFromAny(d) || "—"),
          safeStr(firstString(d, ["accepted_by", "acceptedBy", "acceptedByName"]) || "—"),
          safeStr(firstString(d, ["accepted_on", "acceptedOn", "date"]) || "—"),
        ])
      )
    );
  } else {
    docChildren.push(para("No content recorded", { color: COLORS.slate400, size: 22 }));
  }

  // Deliverables — Outstanding
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Deliverables — Outstanding"));
  if (outstandingArr.length) {
    docChildren.push(
      charterTable(
        ["Item", "Owner", "Status", "Target"],
        outstandingArr.map((o: any) => [
          safeStr(firstString(o, ["item", "deliverable", "title"]) || textFromAny(o) || "—"),
          safeStr(firstString(o, ["owner", "assigned_to", "assignedTo"]) || "—"),
          safeStr(firstString(o, ["status"]) || "—"),
          safeStr(firstString(o, ["target", "due_date", "dueDate"]) || "—"),
        ])
      )
    );
  } else {
    docChildren.push(para("No content recorded", { color: COLORS.slate400, size: 22 }));
  }

  // Financial Closeout
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Financial Closeout"));
  if (budgetRowsArr.length) {
    docChildren.push(
      charterTable(
        ["Category", "Budget", "Actual"],
        budgetRowsArr.map((b: any) => [
          safeStr(firstString(b, ["category", "name"]) || "—"),
          moneyStr(b?.budget ?? b?.budget_gbp ?? b?.planned ?? "—"),
          moneyStr(b?.actual ?? b?.actual_gbp ?? b?.spent ?? "—"),
        ])
      )
    );
  } else {
    docChildren.push(para("No budget lines recorded", { color: COLORS.slate400, size: 22 }));
  }

  // Lessons Learned
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Lessons Learned — What Went Well"));
  docChildren.push(
    ...bulletLines(wentWellArr, (l) => {
      const t = firstString(l, ["text", "lesson", "summary", "description"]) || textFromAny(l);
      const a = firstString(l, ["action", "next_action", "nextAction"]);
      return a ? `${t} (Action: ${a})` : t;
    })
  );

  docChildren.push(new Paragraph({ spacing: { before: 220 } }));
  docChildren.push(sectionHeader("Lessons Learned — What Didn’t Go Well"));
  docChildren.push(
    ...bulletLines(didntGoWellArr, (l) => {
      const t = firstString(l, ["text", "lesson", "summary", "description"]) || textFromAny(l);
      const a = firstString(l, ["action", "next_action", "nextAction"]);
      return a ? `${t} (Action: ${a})` : t;
    })
  );

  docChildren.push(new Paragraph({ spacing: { before: 220 } }));
  docChildren.push(sectionHeader("Lessons Learned — Surprises & Risks"));
  docChildren.push(
    ...bulletLines(surprisesArr, (l) => {
      const t = firstString(l, ["text", "lesson", "summary", "description"]) || textFromAny(l);
      const a = firstString(l, ["action", "next_action", "nextAction"]);
      return a ? `${t} (Action: ${a})` : t;
    })
  );

  // Handover — Open Risks & Issues
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Handover — Open Risks & Issues"));
  if (risksIssuesArr.length) {
    docChildren.push(
      charterTable(
        ["Risk ID", "Description", "Severity", "Owner", "Status", "Next Action"],
        risksIssuesArr.map((r: any) => [
          safeStr(r?.human_id ?? r?.humanId ?? r?.display_id ?? r?.displayId ?? r?.id ?? "—"),
          safeStr(firstString(r, ["description", "text", "title", "summary"]) || "—"),
          safeStr(firstString(r, ["severity", "impact"]) || "—"),
          safeStr(firstString(r, ["owner", "assigned_to", "assignedTo"]) || "—"),
          safeStr(firstString(r, ["status"]) || "—"),
          safeStr(firstString(r, ["next_action", "nextAction", "action"]) || "—"),
        ])
      )
    );
  } else {
    docChildren.push(para("No risks/issues recorded", { color: COLORS.slate400, size: 22 }));
  }

  // Recommendations
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Recommendations & Follow-up Actions"));
  if (recsArr.length) {
    docChildren.push(
      charterTable(
        ["Recommendation", "Owner", "Due Date"],
        recsArr.map((r: any) => [
          safeStr(firstString(r, ["text", "recommendation", "title", "summary"]) || textFromAny(r) || "—"),
          safeStr(firstString(r, ["owner", "assigned_to", "assignedTo"]) || "—"),
          safeStr(firstString(r, ["due", "due_date", "dueDate", "target"]) || "—"),
        ])
      )
    );
  } else {
    docChildren.push(para("No recommendations recorded", { color: COLORS.slate400, size: 22 }));
  }

  // Final Sign-off
  docChildren.push(new Paragraph({ spacing: { before: 300 } }));
  docChildren.push(sectionHeader("Final Sign-off"));
  docChildren.push(
    charterTable(
      ["Field", "Value"],
      [
        ["Sponsor Name", safeStr(signoff?.sponsor_name ?? signoff?.sponsorName ?? signoff?.sponsor ?? "—")],
        ["Sponsor Date", safeStr(signoff?.sponsor_date ?? signoff?.sponsorDate ?? "—")],
        ["Sponsor Decision", safeStr(signoff?.sponsor_decision ?? signoff?.sponsorDecision ?? "—")],
        [
          "PM Name",
          safeStr(signoff?.pm_name ?? signoff?.pmName ?? signoff?.project_manager ?? signoff?.projectManager ?? "—"),
        ],
        ["PM Date", safeStr(signoff?.pm_date ?? signoff?.pmDate ?? "—")],
        ["PM Approved", boolToYesNo(signoff?.pm_approved ?? signoff?.pmApproved)],
      ]
    )
  );

  // Guard: ensure children are valid
  const cleaned = docChildren.filter(Boolean);

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    const ok = ch instanceof Paragraph || ch instanceof Table;
    if (!ok) {
      console.error("[closure-docx] Invalid DOCX child at index", i, ch);
      throw new Error(`Invalid DOCX child at index ${i}: ${Object.prototype.toString.call(ch)}`);
    }
  }

  /* ==================== Document shell ==================== */

  const A4_PORTRAIT_W = convertInchesToTwip(8.27);
  const A4_PORTRAIT_H = convertInchesToTwip(11.69);

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
              width: A4_PORTRAIT_H,
              height: A4_PORTRAIT_W,
            },
          },
        },
        headers: {
          default: new Header({
            children: [
              new Paragraph({
                children: [
                  new TextRun({ text: "Project Closure Report", bold: true, size: 28 }),
                  new TextRun({ text: " • " + safeStr(projectName), size: 24, color: COLORS.slate500 }),
                ],
              }),
            ],
          }),
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  new TextRun({
                    text: `Generated ${safeStr(generatedFooter)} • Page `,
                    size: 18,
                    color: COLORS.slate500,
                  }),
                  PageNumber.CURRENT,
                  new TextRun({ text: " of ", size: 18, color: COLORS.slate500 }),
                  PageNumber.TOTAL_PAGES,
                ],
              }),
            ],
          }),
        },
        children: cleaned,
      },
    ],
  });

  return await Packer.toBuffer(document);
}