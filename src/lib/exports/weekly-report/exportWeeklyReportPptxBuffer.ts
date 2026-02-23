// src/lib/exports/weekly-report/exportWeeklyReportPptxBuffer.ts
import "server-only";

import PptxGenJS from "pptxgenjs";
import { sanitizeFilename, safeStr } from "@/lib/exports/_shared/utils";
import type { WeeklyReportV1 } from "./types";

/* ================================================================
   HELPERS
================================================================ */

type Rag = "green" | "amber" | "red";

function asRag(x: any): Rag | null {
  const r = safeStr(x).trim().toLowerCase();
  if (r === "green" || r === "amber" || r === "red") return r;
  return null;
}

function ragLabel(rag: any) {
  const r = asRag(rag) ?? "green";
  return r === "red" ? "RED" : r === "amber" ? "AMBER" : "GREEN";
}
function ragFill(rag: any) {
  const r = asRag(rag) ?? "green";
  return r === "red" ? "FEE2E2" : r === "amber" ? "FEF3C7" : "DCFCE7";
}
function ragText(rag: any) {
  const r = asRag(rag) ?? "green";
  return r === "red" ? "991B1B" : r === "amber" ? "92400E" : "065F46";
}
function ragDot(rag: any) {
  const r = asRag(rag) ?? "green";
  return r === "red" ? "DC2626" : r === "amber" ? "F59E0B" : "16A34A";
}

function ragScore(r: Rag) {
  return r === "green" ? 3 : r === "amber" ? 2 : 1;
}
function trendArrow(now: Rag | null, last: Rag | null) {
  if (!now || !last) return "";
  const dn = ragScore(now) - ragScore(last);
  if (dn > 0) return " ↑";
  if (dn < 0) return " ↓";
  return " →";
}

function normLines(s: any) {
  return safeStr(s).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function listTexts(items: any): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((x) => (typeof x === "string" ? safeStr(x).trim() : safeStr(x?.text).trim()))
    .filter(Boolean);
}

function clampBullets(items: string[], max: number) {
  const xs = items.filter(Boolean);
  if (xs.length <= max) return xs.length ? xs : ["—"];
  const head = xs.slice(0, max - 1);
  head.push(`+${xs.length - (max - 1)} more…`);
  return head;
}

function sectionFallback(title: string) {
  if (title.startsWith("2)")) return "None yet.";
  if (title.startsWith("3)")) return "No due-soon items detected for next period focus.";
  if (title.startsWith("4)")) return "No resource hotspots detected from due-soon workload.";
  if (title.startsWith("5)")) return "No key decisions detected in this period.";
  if (title.startsWith("6)")) return "No operational blockers detected.";
  return "—";
}

function clampText(s: string, maxChars: number) {
  const t = safeStr(s).trim();
  if (!t) return "—";
  if (t.length <= maxChars) return t;
  return t.slice(0, Math.max(0, maxChars - 1)).trimEnd() + "…";
}

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function formatDateUkShort(x: any) {
  const s = safeStr(x).trim();
  if (!s) return "—";

  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const yyyy = Number(m[1]);
    const mm = Number(m[2]);
    const dd = Number(m[3]);
    if (Number.isFinite(yyyy) && Number.isFinite(mm) && Number.isFinite(dd)) {
      return `${pad2(dd)}/${pad2(mm)}/${pad2(yyyy % 100)}`;
    }
  }

  const d = new Date(s);
  if (!isNaN(d.getTime())) {
    const dd = d.getUTCDate();
    const mm = d.getUTCMonth() + 1;
    const yy = d.getUTCFullYear() % 100;
    return `${pad2(dd)}/${pad2(mm)}/${pad2(yy)}`;
  }

  return "—";
}

function getPrevSnapshot(model: WeeklyReportV1): any {
  const m: any = model as any;
  return m?.meta?.sources?.previous_snapshot ?? m?.meta?.previous ?? null;
}

function getMilestoneRows(model: WeeklyReportV1, max = 6) {
  const cur = Array.isArray(model.milestones) ? model.milestones : [];

  const prev = getPrevSnapshot(model);
  const prevByName =
    prev?.milestonesByName && typeof prev.milestonesByName === "object" ? prev.milestonesByName : {};

  return cur
    .map((m) => {
      const name = safeStr(m?.name).trim();
      if (!name) return null;

      const baseline = m?.due ? formatDateUkShort(m.due) : "—";
      const forecast = m?.due ? formatDateUkShort(m.due) : "—";

      const ragNow = asRag(m?.status) ?? asRag((model as any)?.summary?.rag) ?? "green";
      const ragLast = asRag(prevByName?.[name]?.rag);

      return { name, baseline, forecast, ragNow, ragLast };
    })
    .filter(Boolean)
    .slice(0, max) as Array<{
    name: string;
    baseline: string;
    forecast: string;
    ragNow: Rag;
    ragLast: Rag | null;
  }>;
}

function normalizeExecNarrative(narrativeRaw: string) {
  const lines = normLines(narrativeRaw)
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const keepLast = lines.find((l) => /^next period focus items \(due soon\):/i.test(l)) || "";

  const keep: string[] = [];
  const period = lines.find((l) => /^period covered:/i.test(l)) || "";
  const completed = lines.find((l) => /^completed:/i.test(l)) || "";
  const overdue = lines.find((l) => /^overdue items:/i.test(l)) || "";
  const blockers = lines.find((l) => /^operational blockers/i.test(l)) || "";

  if (period) keep.push(period);
  if (completed) keep.push(completed);
  if (overdue) keep.push(overdue);
  if (blockers) keep.push(blockers);
  if (keepLast && !keep.includes(keepLast)) keep.push(keepLast);

  if (!keep.length) return "—";

  const dueIdx = keep.findIndex((l) => /^next period focus items \(due soon\):/i.test(l));
  const dueLine = dueIdx >= 0 ? keep[dueIdx] : "";

  let out = keep.filter((_, i) => i !== dueIdx).slice(0, 4);
  if (dueLine) out.push(dueLine);

  out = out.map((l) => clampText(l, 78));
  return out.join("\n");
}

/* ================================================================
   MAIN EXPORT
================================================================ */

export async function exportWeeklyReportPptxBuffer(args: {
  model: WeeklyReportV1;
  projectName: string;
  projectCode: string;
  clientName?: string;
  orgName?: string;
}) {
  const { model } = args;

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const s = pptx.addSlide();

  /* ── Dimensions ── */
  const W = 13.33;
  const H = 7.5;

  /* ── Colour Palette: Midnight Executive ── */
  const C = {
    navy: "0F2044",          // dominant dark navy
    navyMid: "1A3461",       // mid-navy for gradient-like layering
    navyLight: "1E3E75",     // lighter navy accent
    iceBlue: "C8D8F0",       // ice blue for panel headers
    iceBlueDark: "A4BAD8",   // slightly darker ice for borders
    accent: "2E86DE",        // vivid blue accent
    accentLight: "EBF4FF",   // very light blue tint for panel bg
    white: "FFFFFF",
    offWhite: "F7F9FC",
    canvas: "F0F4FA",        // slide background
    text: "0D1B38",          // very dark navy for body text
    textMid: "2D4470",       // mid-tone for secondary text
    muted: "7B8EAD",         // muted blue-grey
    border: "CBD8EC",        // panel borders
    ragGreenBg: "DCFCE7",
    ragGreenTxt: "065F46",
    ragGreenDot: "16A34A",
    ragAmberBg: "FEF3C7",
    ragAmberTxt: "92400E",
    ragAmberDot: "F59E0B",
    ragRedBg: "FEE2E2",
    ragRedTxt: "991B1B",
    ragRedDot: "DC2626",
    divider: "D1DCF0",
  };

  /* ── Derived project data ── */
  const projName = safeStr(args.projectName || model.project?.name).trim() || "TBC";
  const projCode = safeStr(args.projectCode || model.project?.code).trim() || "TBC";
  const status = safeStr(model.summary.headline).trim() || "TBC";
  const supplierPm = safeStr(model.project?.managerName).trim() || "TBC";
  const periodFrom = formatDateUkShort(model.period.from);
  const periodTo = formatDateUkShort(model.period.to);

  const ragNow = asRag(model.summary.rag) ?? "green";
  const prevSnap = getPrevSnapshot(model);
  const ragLast = asRag(prevSnap?.summary?.rag) ?? asRag((model as any)?.meta?.previous?.summary?.rag);

  const dims = (model as any)?.meta?.dimensions || {};
  const ragTime = asRag(dims.time) ?? ragNow;
  const ragCost = asRag(dims.cost) ?? ragNow;
  const ragQuality = asRag(dims.quality) ?? ragNow;
  const ragScope = asRag(dims.scope) ?? ragNow;

  /* ─────────────────────────────────────────────
     SLIDE BACKGROUND
  ───────────────────────────────────────────── */
  s.background = { color: C.canvas };

  /* ─────────────────────────────────────────────
     LEFT SIDEBAR (dark navy accent strip)
  ───────────────────────────────────────────── */
  const sideW = 0.28;
  s.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: sideW, h: H,
    fill: { color: C.navy },
    line: { color: C.navy },
  });

  /* ─────────────────────────────────────────────
     HEADER BAR
  ───────────────────────────────────────────── */
  const hdrH = 1.22;
  s.addShape(pptx.ShapeType.rect, {
    x: sideW, y: 0, w: W - sideW, h: hdrH,
    fill: { color: C.navy },
    line: { color: C.navy },
  });

  // Title text
  s.addText("PROJECT STATUS REPORT", {
    x: sideW + 0.35, y: 0.12, w: 7.5, h: 0.54,
    fontSize: 26,
    bold: true,
    color: C.white,
    fontFace: "Calibri",
    charSpacing: 1,
    margin: 0,
  });

  // Period pill / badge
  s.addShape(pptx.ShapeType.rect, {
    x: sideW + 0.35, y: 0.72, w: 3.1, h: 0.32,
    fill: { color: C.navyLight },
    line: { color: C.iceBlue },
  });
  s.addText(`Period: ${periodFrom}  →  ${periodTo}`, {
    x: sideW + 0.35, y: 0.72, w: 3.1, h: 0.32,
    fontSize: 10,
    color: C.iceBlue,
    align: "center",
    valign: "mid",
    margin: 0,
    fontFace: "Calibri",
  });

  // Project code badge (top-right of header)
  const badgeX = W - 2.4;
  s.addShape(pptx.ShapeType.rect, {
    x: badgeX, y: 0.15, w: 1.9, h: 0.55,
    fill: { color: C.navyLight },
    line: { color: C.iceBlueDark },
  });
  s.addText("PROJECT CODE", {
    x: badgeX, y: 0.16, w: 1.9, h: 0.2,
    fontSize: 7,
    color: C.iceBlue,
    align: "center",
    margin: 0,
    fontFace: "Calibri",
  });
  s.addText(projCode, {
    x: badgeX, y: 0.34, w: 1.9, h: 0.3,
    fontSize: 16,
    bold: true,
    color: C.white,
    align: "center",
    valign: "mid",
    margin: 0,
    fontFace: "Calibri",
  });

  /* ─────────────────────────────────────────────
     RAG DIMENSION CHIPS (below header)
  ───────────────────────────────────────────── */
  const chipY = hdrH + 0.14;
  const chipH = 0.36;
  const chipGap = 0.1;
  const totalChipW = W - sideW - 0.35 - 0.25;
  const chipW = (totalChipW - chipGap * 3) / 4;

  const chips: Array<{ k: string; rag: Rag }> = [
    { k: "TIME", rag: ragTime },
    { k: "COST", rag: ragCost },
    { k: "QUALITY", rag: ragQuality },
    { k: "SCOPE", rag: ragScope },
  ];

  for (let i = 0; i < 4; i++) {
    const cx = sideW + 0.35 + i * (chipW + chipGap);
    const chip = chips[i];

    // Card bg
    s.addShape(pptx.ShapeType.rect, {
      x: cx, y: chipY, w: chipW, h: chipH,
      fill: { color: C.white },
      line: { color: C.border },
      shadow: { type: "outer", color: "000000", opacity: 0.06, blur: 4, offset: 1, angle: 135 },
    });

    // Left accent bar for RAG colour
    s.addShape(pptx.ShapeType.rect, {
      x: cx, y: chipY, w: 0.07, h: chipH,
      fill: { color: ragDot(chip.rag) },
      line: { color: ragDot(chip.rag) },
    });

    // Dot
    const dotR = 0.065;
    s.addShape(pptx.ShapeType.ellipse, {
      x: cx + 0.17, y: chipY + chipH / 2 - dotR,
      w: dotR * 2, h: dotR * 2,
      fill: { color: ragDot(chip.rag) },
      line: { color: ragDot(chip.rag) },
    });

    // Label
    s.addText(chip.k, {
      x: cx + 0.17 + dotR * 2 + 0.09, y: chipY + 0.06,
      w: chipW * 0.42, h: chipH - 0.1,
      fontSize: 10, bold: true, color: C.textMid,
      fontFace: "Calibri", margin: 0, valign: "mid",
    });

    // RAG badge (right side)
    const badgeInW = chipW * 0.37;
    const badgeInX = cx + chipW - badgeInW - 0.1;
    s.addShape(pptx.ShapeType.rect, {
      x: badgeInX, y: chipY + 0.07, w: badgeInW, h: chipH - 0.14,
      fill: { color: ragFill(chip.rag) },
      line: { color: ragText(chip.rag) },
    });
    s.addText(ragLabel(chip.rag), {
      x: badgeInX, y: chipY + 0.07, w: badgeInW, h: chipH - 0.14,
      fontSize: 8, bold: true, color: ragText(chip.rag),
      align: "center", valign: "mid", margin: 0, fontFace: "Calibri",
    });
  }

  /* ─────────────────────────────────────────────
     META INFO BAND
  ───────────────────────────────────────────── */
  const metaY = chipY + chipH + 0.12;
  const metaH = 0.72;

  s.addShape(pptx.ShapeType.rect, {
    x: sideW, y: metaY, w: W - sideW, h: metaH,
    fill: { color: C.white },
    line: { color: C.border },
    shadow: { type: "outer", color: "000000", opacity: 0.05, blur: 3, offset: 1, angle: 135 },
  });

  // Top label row + bottom value row inside the band
  const metaCols = [
    { k: "PROJECT NAME", w: 3.3, v: projName },
    { k: "HEADLINE STATUS", w: 3.1, v: status },
    { k: "PROJECT MANAGER", w: 2.15, v: supplierPm },
    { k: "THIS PERIOD RAG", w: 2.0, v: ragLabel(ragNow) + trendArrow(ragNow, ragLast), isRag: ragNow },
    { k: "LAST PERIOD RAG", w: 2.0, v: ragLast ? ragLabel(ragLast) : "—", isRag: ragLast ?? null },
  ] as Array<{ k: string; w: number; v: string; isRag?: Rag | null }>;

  let mx = sideW + 0.0;
  for (let i = 0; i < metaCols.length; i++) {
    const col = metaCols[i];
    const pad = 0.22;

    // Vertical divider between columns
    if (i > 0) {
      s.addShape(pptx.ShapeType.rect, {
        x: mx, y: metaY + 0.1, w: 0.01, h: metaH - 0.2,
        fill: { color: C.divider }, line: { color: C.divider },
      });
    }

    // Column header label
    s.addText(col.k, {
      x: mx + pad, y: metaY + 0.08, w: col.w - pad * 2, h: 0.22,
      fontSize: 7.5, bold: true, color: C.muted,
      fontFace: "Calibri", margin: 0, charSpacing: 0.5,
    });

    if (col.isRag) {
      const ragR = col.isRag as Rag;
      // RAG coloured pill
      const pillW = col.w - pad * 2;
      const pillH = 0.32;
      const pillY = metaY + 0.33;
      s.addShape(pptx.ShapeType.rect, {
        x: mx + pad, y: pillY, w: pillW, h: pillH,
        fill: { color: ragFill(ragR) },
        line: { color: ragText(ragR) },
      });
      s.addText(col.v, {
        x: mx + pad, y: pillY, w: pillW, h: pillH,
        fontSize: 13, bold: true, color: ragText(ragR),
        align: "center", valign: "mid", margin: 0, fontFace: "Calibri",
      });
    } else if (col.isRag === null && metaCols[i].k === "LAST PERIOD RAG") {
      // no last period
      s.addText("—", {
        x: mx + pad, y: metaY + 0.33, w: col.w - pad * 2, h: 0.32,
        fontSize: 13, color: C.muted,
        align: "center", valign: "mid", margin: 0, fontFace: "Calibri",
      });
    } else {
      s.addText(clampText(col.v, col.k === "HEADLINE STATUS" ? 68 : 44), {
        x: mx + pad, y: metaY + 0.32, w: col.w - pad * 2, h: 0.35,
        fontSize: 11.5, bold: false, color: C.text,
        fontFace: "Calibri", margin: 0, valign: "mid",
      });
    }

    mx += col.w;
  }

  /* ─────────────────────────────────────────────
     MAIN CONTENT LAYOUT
  ───────────────────────────────────────────── */
  const contentTop = metaY + metaH + 0.14;
  const bottomStripH = 0.97;
  const bottomStripY = H - bottomStripH - 0.2;
  const mainH = bottomStripY - contentTop - 0.12;

  const leftW = 5.65;
  const rightW = W - sideW - 0.35 - leftW - 0.25 - 0.15;
  const leftX = sideW + 0.35;
  const rightX = leftX + leftW + 0.15;

  /* ── Helper: section panel ── */
  function addPanel(
    title: string,
    sectionNum: string,
    x: number,
    y: number,
    w: number,
    h: number,
    bodyFn: () => void
  ) {
    // Panel card
    s.addShape(pptx.ShapeType.rect, {
      x, y, w, h,
      fill: { color: C.white },
      line: { color: C.border },
      shadow: { type: "outer", color: "000000", opacity: 0.05, blur: 4, offset: 1, angle: 135 },
    });

    // Header background
    const panelHdrH = 0.37;
    s.addShape(pptx.ShapeType.rect, {
      x, y, w, h: panelHdrH,
      fill: { color: C.navy },
      line: { color: C.navy },
    });

    // Section number badge
    s.addShape(pptx.ShapeType.rect, {
      x: x + 0.14, y: y + 0.07, w: 0.22, h: 0.23,
      fill: { color: C.accent },
      line: { color: C.accent },
    });
    s.addText(sectionNum, {
      x: x + 0.14, y: y + 0.07, w: 0.22, h: 0.23,
      fontSize: 9, bold: true, color: C.white,
      align: "center", valign: "mid", margin: 0, fontFace: "Calibri",
    });

    // Panel title
    s.addText(title, {
      x: x + 0.44, y: y + 0.08, w: w - 0.55, h: 0.25,
      fontSize: 10, bold: true, color: C.white,
      fontFace: "Calibri", margin: 0, valign: "mid", charSpacing: 0.3,
    });

    bodyFn();
  }

  /* ── Helper: bullet list in panel ── */
  function addBullets(
    items: string[],
    x: number,
    y: number,
    w: number,
    h: number,
    fontSize = 10
  ) {
    const richItems = items.flatMap((t, i) => {
      const runs: any[] = [
        { text: t, options: { bullet: true, breakLine: i < items.length - 1 } },
      ];
      return runs;
    });
    s.addText(richItems, {
      x, y, w, h,
      fontSize,
      color: C.text,
      fontFace: "Calibri",
      valign: "top",
      paraSpaceAfter: 2,
    });
  }

  /* ─────────────────────────────────────────────
     LEFT PANELS: Executive Summary + Completed
  ───────────────────────────────────────────── */
  const execH = mainH * 0.58;
  const completedH = mainH - execH - 0.13;

  // 1) Executive Summary
  const headline = clampText(safeStr(model.summary.headline), 110);
  const narrative = normalizeExecNarrative(safeStr(model.summary.narrative));
  const execBodyStr = `Headline: ${headline}\n\nNarrative:\n${narrative}`;

  addPanel("Executive Summary", "1", leftX, contentTop, leftW, execH, () => {
    s.addText(execBodyStr, {
      x: leftX + 0.22, y: contentTop + 0.52, w: leftW - 0.44, h: execH - 0.65,
      fontSize: 10.5, color: C.text, fontFace: "Calibri",
      valign: "top", paraSpaceAfter: 3,
    });
  });

  // 2) Completed This Period
  const completedItems = clampBullets(listTexts(model.delivered), 7);
  addPanel("Completed This Period", "2", leftX, contentTop + execH + 0.13, leftW, completedH, () => {
    addBullets(
      completedItems,
      leftX + 0.22, contentTop + execH + 0.13 + 0.5,
      leftW - 0.44, completedH - 0.62, 10
    );
  });

  /* ─────────────────────────────────────────────
     RIGHT SIDE: Milestones table + Next Period Focus
  ───────────────────────────────────────────── */
  const focusPanelH = 1.12;
  const focusPanelY = contentTop + mainH - focusPanelH;
  const milestoneH = mainH - focusPanelH - 0.12;

  /* ── Milestone Table ── */
  const tblHdrH = 0.37;
  const rowCount = 6;

  // Table outer card
  s.addShape(pptx.ShapeType.rect, {
    x: rightX, y: contentTop, w: rightW, h: milestoneH,
    fill: { color: C.white }, line: { color: C.border },
    shadow: { type: "outer", color: "000000", opacity: 0.05, blur: 4, offset: 1, angle: 135 },
  });

  // Table header row (dark navy)
  s.addShape(pptx.ShapeType.rect, {
    x: rightX, y: contentTop, w: rightW, h: tblHdrH,
    fill: { color: C.navy }, line: { color: C.navy },
  });

  // Section badge in table header
  s.addShape(pptx.ShapeType.rect, {
    x: rightX + 0.14, y: contentTop + 0.07, w: 0.22, h: 0.23,
    fill: { color: C.accent }, line: { color: C.accent },
  });
  s.addText("M", {
    x: rightX + 0.14, y: contentTop + 0.07, w: 0.22, h: 0.23,
    fontSize: 9, bold: true, color: C.white,
    align: "center", valign: "mid", margin: 0, fontFace: "Calibri",
  });
  s.addText("Milestones & Epics", {
    x: rightX + 0.44, y: contentTop + 0.08, w: rightW - 0.55, h: 0.25,
    fontSize: 10, bold: true, color: C.white,
    fontFace: "Calibri", margin: 0, valign: "mid", charSpacing: 0.3,
  });

  // Sub-header row for columns
  const subHdrH = 0.28;
  const subHdrY = contentTop + tblHdrH;
  s.addShape(pptx.ShapeType.rect, {
    x: rightX, y: subHdrY, w: rightW, h: subHdrH,
    fill: { color: C.iceBlue }, line: { color: C.iceBlueDark },
  });

  // Column widths (sum = rightW)
  const cw = [
    rightW * 0.40,  // Milestone name
    rightW * 0.155, // Baseline
    rightW * 0.155, // Forecast
    rightW * 0.145, // RAG Now
    rightW * 0.145, // RAG Last
  ];

  const colHeaders = ["Milestone / Epic", "Baseline", "Forecast", "RAG Now", "RAG Last"];
  let thx = rightX;
  for (let i = 0; i < colHeaders.length; i++) {
    s.addText(colHeaders[i], {
      x: thx + 0.08, y: subHdrY + 0.04, w: cw[i] - 0.1, h: subHdrH - 0.06,
      fontSize: 8.5, bold: true, color: C.textMid,
      fontFace: "Calibri", margin: 0,
    });
    thx += cw[i];
  }

  // Data rows
  const usableH = milestoneH - tblHdrH - subHdrH;
  const rowH = usableH / rowCount;
  const rows = getMilestoneRows(model, rowCount);

  for (let r = 0; r < rowCount; r++) {
    const ry = subHdrY + subHdrH + r * rowH;
    const rowBg = r % 2 === 0 ? C.white : C.offWhite;

    const row = rows[r] ?? {
      name: "Enter milestone",
      baseline: "TBC",
      forecast: "TBC",
      ragNow,
      ragLast: null,
    };

    let rx = rightX;

    // Milestone name + baseline + forecast
    const cells = [row.name, row.baseline, row.forecast];
    for (let c = 0; c < 3; c++) {
      s.addShape(pptx.ShapeType.rect, {
        x: rx, y: ry, w: cw[c], h: rowH,
        fill: { color: rowBg }, line: { color: C.border },
      });
      s.addText(clampText(cells[c], c === 0 ? 44 : 18), {
        x: rx + 0.1, y: ry + 0.05, w: cw[c] - 0.15, h: rowH - 0.08,
        fontSize: c === 0 ? 9.5 : 9, color: c === 0 ? C.text : C.textMid,
        fontFace: "Calibri", margin: 0, valign: "mid",
        bold: c === 0,
      });
      rx += cw[c];
    }

    // RAG Now
    s.addShape(pptx.ShapeType.rect, {
      x: rx, y: ry, w: cw[3], h: rowH,
      fill: { color: ragFill(row.ragNow) }, line: { color: C.border },
    });
    s.addText(ragLabel(row.ragNow) + trendArrow(row.ragNow, row.ragLast), {
      x: rx, y: ry + 0.04, w: cw[3], h: rowH - 0.06,
      fontSize: 8.5, bold: true, align: "center", color: ragText(row.ragNow),
      fontFace: "Calibri", margin: 0, valign: "mid",
    });
    rx += cw[3];

    // RAG Last
    if (row.ragLast) {
      s.addShape(pptx.ShapeType.rect, {
        x: rx, y: ry, w: cw[4], h: rowH,
        fill: { color: ragFill(row.ragLast) }, line: { color: C.border },
      });
      s.addText(ragLabel(row.ragLast), {
        x: rx, y: ry + 0.04, w: cw[4], h: rowH - 0.06,
        fontSize: 8.5, bold: true, align: "center", color: ragText(row.ragLast),
        fontFace: "Calibri", margin: 0, valign: "mid",
      });
    } else {
      s.addShape(pptx.ShapeType.rect, {
        x: rx, y: ry, w: cw[4], h: rowH,
        fill: { color: rowBg }, line: { color: C.border },
      });
      s.addText("—", {
        x: rx, y: ry + 0.04, w: cw[4], h: rowH - 0.06,
        fontSize: 9, align: "center", color: C.muted,
        fontFace: "Calibri", margin: 0, valign: "mid",
      });
    }
  }

  // 3) Next Period Focus panel
  const nextItems = clampBullets(listTexts(model.planNextWeek), 4);
  addPanel("Next Period Focus", "3", rightX, focusPanelY, rightW, focusPanelH, () => {
    addBullets(
      nextItems,
      rightX + 0.22, focusPanelY + 0.51,
      rightW - 0.44, focusPanelH - 0.64, 9.5
    );
  });

  /* ─────────────────────────────────────────────
     BOTTOM STRIP: 4 / 5 / 6
  ───────────────────────────────────────────── */
  const stripGap = 0.14;
  const totalStripW = W - sideW - 0.35 - 0.15;
  const stripW = (totalStripW - stripGap * 2) / 3;

  const bottomPanels = [
    { num: "4", title: "Resource Summary", key: "resourceSummary" as const },
    { num: "5", title: "Key Decisions Taken", key: "keyDecisions" as const },
    { num: "6", title: "Operational Blockers", key: "blockers" as const },
  ];

  for (let i = 0; i < 3; i++) {
    const bp = bottomPanels[i];
    const bx = leftX + i * (stripW + stripGap);
    const items = clampBullets(listTexts(model[bp.key]), 3);

    addPanel(bp.title, bp.num, bx, bottomStripY, stripW, bottomStripH, () => {
      addBullets(
        items,
        bx + 0.2, bottomStripY + 0.5,
        stripW - 0.38, bottomStripH - 0.62, 9.5
      );
    });
  }

  /* ─────────────────────────────────────────────
     FOOTER
  ───────────────────────────────────────────── */
  const footerY = H - 0.18;
  s.addText(`${projName}  ·  ${projCode}  ·  Period ${periodFrom} – ${periodTo}`, {
    x: sideW + 0.35, y: footerY, w: 8, h: 0.16,
    fontSize: 7, color: C.muted,
    fontFace: "Calibri", margin: 0, valign: "mid",
  });
  s.addText("CONFIDENTIAL", {
    x: W - 2.0, y: footerY, w: 1.8, h: 0.16,
    fontSize: 7, color: C.muted, align: "right",
    fontFace: "Calibri", margin: 0, valign: "mid",
  });

  /* ─────────────────────────────────────────────
     EXPORT
  ───────────────────────────────────────────── */
  const fromRaw = safeStr(model.period.from).trim();
  const toRaw = safeStr(model.period.to).trim();

  const filename = sanitizeFilename(
    `Project_Status_Report-${projCode || "Project"}-${fromRaw || "from"}_to_${toRaw || "to"}.pptx`,
    "Project_Status_Report.pptx"
  );

  const buffer = (await pptx.write("nodebuffer")) as Buffer;
  return { filename, buffer };
}