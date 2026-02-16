// src/lib/exports/weekly-report/exportWeeklyReportPptxBuffer.ts
import "server-only";

import PptxGenJS from "pptxgenjs";
import { sanitizeFilename, safeStr } from "@/lib/exports/_shared/utils";
import type { WeeklyReportV1 } from "./types";

/* ---------------- helpers ---------------- */

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
  if (dn > 0) return " ▲";
  if (dn < 0) return " ▼";
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

/* ---------------- date format: DD/MM/YY ---------------- */

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
    .slice(0, max) as Array<{ name: string; baseline: string; forecast: string; ragNow: Rag; ragLast: Rag | null }>;
}

/**
 * Ensure the narrative keeps the due-soon line and fits.
 */
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

/* ===============================
   MAIN EXPORT
================================ */

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

  // geometry
  const W = 13.33;
  const H = 7.5;
  const M = 0.45;

  const C = {
    // ✅ match PDF title green (darker than the old one)
    titleGreen: "1B7F4B",
    text: "111827",
    muted: "6B7280",
    line: "CBD5E1",
    headerCell: "94A3B8",
    headerText: "FFFFFF",
    panelBg: "FFFFFF",
    panelHdr: "B6C2CD",
    canvas: "FFFFFF",
  };

  const projName = safeStr(args.projectName || model.project?.name).trim() || "TBC";
  const projCode = safeStr(args.projectCode || model.project?.code).trim() || "TBC";

  const status = safeStr(model.summary.headline).trim() || "TBC";
  const supplierPm = safeStr(model.project?.managerName).trim() || "TBC";

  const periodFrom = formatDateUkShort(model.period.from);
  const periodTo = formatDateUkShort(model.period.to);

  const ragNow = asRag(model.summary.rag) ?? "green";
  const prevSnap = getPrevSnapshot(model);
  const ragLast = asRag(prevSnap?.summary?.rag) ?? asRag((model as any)?.meta?.previous?.summary?.rag);

  // Time/Cost/Quality/Scope optional auto-generated values
  const dims = (model as any)?.meta?.dimensions || {};
  const ragTime = asRag(dims.time) ?? ragNow;
  const ragCost = asRag(dims.cost) ?? ragNow;
  const ragQuality = asRag(dims.quality) ?? ragNow;
  const ragScope = asRag(dims.scope) ?? ragNow;

  /* ---------------- Title ---------------- */

  s.addText("PROJECT STATUS REPORT", {
    x: M,
    y: 0.25,
    w: W - 2 * M,
    h: 0.4,
    fontSize: 28,
    bold: true,
    color: C.titleGreen,
  });

  s.addText(`Period covered: ${periodFrom} → ${periodTo}.`, {
    x: M,
    y: 0.68,
    w: W - 2 * M,
    h: 0.22,
    fontSize: 12,
    color: C.muted,
  });

  /* ---------------- Compact Time/Cost/Quality/Scope strip (top) ---------------- */
  /* ✅ Remove circled GREEN text — keep only the coloured dot + label */

  const stripTopY = 0.95;
  const stripTopH = 0.32;
  const chipW = (W - 2 * M) / 4;

  const chips: Array<{ k: string; rag: Rag }> = [
    { k: "Time", rag: ragTime },
    { k: "Cost", rag: ragCost },
    { k: "Quality", rag: ragQuality },
    { k: "Scope", rag: ragScope },
  ];

  for (let i = 0; i < chips.length; i++) {
    const x = M + i * chipW;

    s.addShape(pptx.ShapeType.roundRect, {
      x,
      y: stripTopY,
      w: chipW - 0.06,
      h: stripTopH,
      fill: { color: C.canvas },
      line: { color: C.line },
      radius: 0.12,
    });

    const r = 0.08;
    s.addShape(pptx.ShapeType.ellipse, {
      x: x + 0.14,
      y: stripTopY + stripTopH / 2 - r,
      w: 2 * r,
      h: 2 * r,
      fill: { color: ragDot(chips[i].rag) },
      line: { color: ragDot(chips[i].rag) },
    });

    // ✅ label only
    s.addText(chips[i].k, {
      x: x + 0.14 + 2 * r + 0.1,
      y: stripTopY + 0.06,
      w: chipW - 0.14 - 2 * r - 0.22,
      h: stripTopH - 0.1,
      fontSize: 11,
      bold: true,
      color: C.text,
      valign: "mid",
    });
  }

  /* ---------------- Meta table ---------------- */

  const metaY = stripTopY + stripTopH + 0.12;
  const metaHHeader = 0.40;
  const metaHRow = 0.44;

  // Total width must equal (W - 2*M) = 12.43
  const cols = [
    { k: "Project Name", w: 3.5, v: projName },
    { k: "Status", w: 3.2, v: status },
    { k: "PM", w: 2.3, v: supplierPm },
    { k: "Overall RAG (This Period)", w: 1.9, v: ragLabel(ragNow) + trendArrow(ragNow, ragLast) },
    { k: "Overall RAG (Last Period)", w: 1.53, v: ragLast ? ragLabel(ragLast) : "—" },
  ];

  let cx = M;
  for (const c of cols) {
    // header
    s.addShape(pptx.ShapeType.rect, {
      x: cx,
      y: metaY,
      w: c.w,
      h: metaHHeader,
      fill: { color: C.canvas },
      line: { color: C.line },
    });
    s.addText(c.k, {
      x: cx + 0.08,
      y: metaY + 0.1,
      w: c.w - 0.16,
      h: metaHHeader - 0.1,
      fontSize: 10,
      bold: true,
      color: C.text,
    });

    // value
    s.addShape(pptx.ShapeType.rect, {
      x: cx,
      y: metaY + metaHHeader,
      w: c.w,
      h: metaHRow,
      fill: { color: C.canvas },
      line: { color: C.line },
    });

    const isNow = c.k.includes("This Period");
    const isLast = c.k.includes("Last Period");

    if (isNow) {
      s.addShape(pptx.ShapeType.roundRect, {
        x: cx + 0.14,
        y: metaY + metaHHeader + 0.10,
        w: c.w - 0.28,
        h: metaHRow - 0.20,
        fill: { color: ragFill(ragNow) },
        line: { color: ragText(ragNow) },
        radius: 0.12,
      });
      s.addText(c.v, {
        x: cx,
        y: metaY + metaHHeader + 0.12,
        w: c.w,
        h: metaHRow - 0.12,
        align: "center",
        fontSize: 12,
        bold: true,
        color: ragText(ragNow),
      });
    } else if (isLast) {
      const lastVal = ragLast ? ragLabel(ragLast) : "—";
      if (ragLast) {
        s.addShape(pptx.ShapeType.roundRect, {
          x: cx + 0.14,
          y: metaY + metaHHeader + 0.10,
          w: c.w - 0.28,
          h: metaHRow - 0.20,
          fill: { color: ragFill(ragLast) },
          line: { color: ragText(ragLast) },
          radius: 0.12,
        });
        s.addText(lastVal, {
          x: cx,
          y: metaY + metaHHeader + 0.12,
          w: c.w,
          h: metaHRow - 0.12,
          align: "center",
          fontSize: 12,
          bold: true,
          color: ragText(ragLast),
        });
      } else {
        s.addText("—", {
          x: cx,
          y: metaY + metaHHeader + 0.12,
          w: c.w,
          h: metaHRow,
          align: "center",
          fontSize: 12,
          color: C.muted,
        });
      }
    } else {
      s.addText(clampText(c.v, c.k === "Status" ? 70 : 44), {
        x: cx + 0.08,
        y: metaY + metaHHeader + 0.12,
        w: c.w - 0.16,
        h: metaHRow - 0.12,
        fontSize: 11,
        color: C.text,
      });
    }

    cx += c.w;
  }

  /* ---------------- Layout: main area + bottom strip ---------------- */

  const contentTop = metaY + metaHHeader + metaHRow + 0.18;

  const stripH = 0.85;
  const stripBottomMargin = 0.3;
  const stripY = H - stripH - stripBottomMargin;

  const mainGap = 0.15;
  const mainY = contentTop;
  const mainH = Math.max(0.1, stripY - mainY - mainGap);

  const leftW = 6.2;
  const rightW = (W - 2 * M) - leftW - 0.2;
  const leftX = M;
  const rightX = leftX + leftW + 0.2;

  function panel(
    title: string,
    x: number,
    y: number,
    w: number,
    h: number,
    body: string,
    opts?: { fontSize?: number }
  ) {
    s.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: C.panelBg }, line: { color: C.line } });
    s.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.42, fill: { color: C.panelHdr }, line: { color: C.line } });
    s.addText(title, {
      x: x + 0.15,
      y: y + 0.1,
      w: w - 0.3,
      h: 0.3,
      fontSize: 12,
      bold: true,
      color: C.text,
    });
    s.addText(body, {
      x: x + 0.25,
      y: y + 0.62,
      w: w - 0.5,
      h: h - 0.8,
      fontSize: opts?.fontSize ?? 12,
      color: C.text,
      valign: "top",
    });
  }

  // LEFT: Executive summary + completed
  const execH = mainH * 0.56;
  const compH = Math.max(0.2, mainH - execH - 0.2);

  const headline = clampText(safeStr(model.summary.headline), 110);
  const narrative = normalizeExecNarrative(safeStr(model.summary.narrative));

  panel(
    "1) Executive Summary",
    leftX,
    mainY,
    leftW,
    execH,
    `Headline: ${headline}\n\nNarrative:\n${narrative}`,
    { fontSize: 11 }
  );

  const completed = clampBullets(listTexts(model.delivered), 7);
  panel(
    "2) Completed This Period",
    leftX,
    mainY + execH + 0.2,
    leftW,
    compH,
    completed.length ? completed.map((t) => `• ${t}`).join("\n") : `• ${sectionFallback("2)")}`
  );

  // RIGHT: Milestones table + Next Period Focus
  s.addShape(pptx.ShapeType.rect, {
    x: rightX,
    y: mainY,
    w: rightW,
    h: mainH,
    fill: { color: C.canvas },
    line: { color: C.line },
  });

  const focusPanelH = 1.05;
  const focusPanelY = mainY + mainH - focusPanelH;

  const tableY = mainY;
  const tableH = Math.max(0.1, mainH - focusPanelH - 0.12);
  const tableHeaderH = 0.42;

  s.addShape(pptx.ShapeType.rect, {
    x: rightX,
    y: tableY,
    w: rightW,
    h: tableHeaderH,
    fill: { color: C.headerCell },
    line: { color: C.line },
  });

  const cw = [rightW * 0.44, rightW * 0.18, rightW * 0.18, rightW * 0.10, rightW * 0.10];
  const headers = ["Milestone / Epic", "Baseline", "Forecast", "RAG (Now)", "RAG (Last)"];

  let tx = rightX;
  for (let i = 0; i < headers.length; i++) {
    s.addText(headers[i], {
      x: tx + 0.12,
      y: tableY + 0.1,
      w: cw[i] - 0.24,
      h: tableHeaderH - 0.1,
      fontSize: 11,
      bold: true,
      color: C.headerText,
    });
    tx += cw[i];
  }

  const rows = getMilestoneRows(model, 6);
  const usableRows = 6;
  const rowH = Math.max(0.28, (tableH - tableHeaderH) / usableRows);

  for (let r = 0; r < usableRows; r++) {
    const y = tableY + tableHeaderH + r * rowH;

    const row =
      rows[r] ?? {
        name: "Enter milestone",
        baseline: "TBC",
        forecast: "TBC",
        ragNow: ragNow,
        ragLast: null,
      };

    let x = rightX;

    const cells = [row.name, row.baseline, row.forecast];
    for (let c = 0; c < 3; c++) {
      s.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: cw[c],
        h: rowH,
        fill: { color: C.canvas },
        line: { color: C.line },
      });
      s.addText(clampText(cells[c], c === 0 ? 48 : 20), {
        x: x + 0.12,
        y: y + 0.12,
        w: cw[c] - 0.24,
        h: rowH - 0.2,
        fontSize: 11,
        color: C.text,
      });
      x += cw[c];
    }

    s.addShape(pptx.ShapeType.rect, {
      x,
      y,
      w: cw[3],
      h: rowH,
      fill: { color: ragFill(row.ragNow) },
      line: { color: C.line },
    });
    s.addText(ragLabel(row.ragNow) + trendArrow(row.ragNow, row.ragLast), {
      x,
      y: y + 0.12,
      w: cw[3],
      h: rowH - 0.2,
      fontSize: 10,
      bold: true,
      align: "center",
      color: ragText(row.ragNow),
    });
    x += cw[3];

    if (row.ragLast) {
      s.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: cw[4],
        h: rowH,
        fill: { color: ragFill(row.ragLast) },
        line: { color: C.line },
      });
      s.addText(ragLabel(row.ragLast), {
        x,
        y: y + 0.12,
        w: cw[4],
        h: rowH - 0.2,
        fontSize: 10,
        bold: true,
        align: "center",
        color: ragText(row.ragLast),
      });
    } else {
      s.addShape(pptx.ShapeType.rect, {
        x,
        y,
        w: cw[4],
        h: rowH,
        fill: { color: C.canvas },
        line: { color: C.line },
      });
      s.addText("—", { x, y: y + 0.12, w: cw[4], h: rowH - 0.2, fontSize: 10, align: "center", color: C.muted });
    }
  }

  const next = clampBullets(listTexts(model.planNextWeek), 4);
  panel(
    "3) Next Period Focus",
    rightX,
    focusPanelY,
    rightW,
    focusPanelH,
    next.length ? next.map((t) => `• ${t}`).join("\n") : `• ${sectionFallback("3)")}`
  );

  /* ---------------- Bottom strip: 4/5/6 ---------------- */
  /* ✅ ensure “overload/workload” text fits: smaller font + room */

  const stripGap = 0.18;
  const stripW = (W - 2 * M - stripGap * 2) / 3;

  const res = clampBullets(listTexts(model.resourceSummary), 3);
  const dec = clampBullets(listTexts(model.keyDecisions), 3);
  const blk = clampBullets(listTexts(model.blockers), 3);

  panel(
    "4) Resource Summary",
    M,
    stripY,
    stripW,
    stripH,
    res.length ? res.map((t) => `• ${t}`).join("\n") : `• ${sectionFallback("4)")}`,
    { fontSize: 11 }
  );
  panel(
    "5) Key Decisions Taken",
    M + stripW + stripGap,
    stripY,
    stripW,
    stripH,
    dec.length ? dec.map((t) => `• ${t}`).join("\n") : `• ${sectionFallback("5)")}`,
    { fontSize: 11 }
  );
  panel(
    "6) Operational Blockers",
    M + (stripW + stripGap) * 2,
    stripY,
    stripW,
    stripH,
    blk.length ? blk.map((t) => `• ${t}`).join("\n") : `• ${sectionFallback("6)")}`,
    { fontSize: 11 }
  );

  /* ---------------- export ---------------- */

  const fromRaw = safeStr(model.period.from).trim();
  const toRaw = safeStr(model.period.to).trim();

  const filename = sanitizeFilename(
    `Project_Status_Report-${projCode || "Project"}-${fromRaw || "from"}_to_${toRaw || "to"}.pptx`,
    "Project_Status_Report.pptx"
  );

  const buffer = (await pptx.write("nodebuffer")) as Buffer;
  return { filename, buffer };
}
