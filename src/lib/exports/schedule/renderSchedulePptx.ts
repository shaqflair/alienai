// src/lib/exports/schedule/renderSchedulePptx.ts
import PptxGenJS from "pptxgenjs";

import type { TimeWindow } from "./types";
import { normalizeSchedule } from "./normalize";
import {
  addDaysUTC,
  clamp01,
  daysBetweenUTC,
  safeFileName,
  startOfDayUTC,
  startOfWeekUTC,
  fmtDateShortUTC,
} from "./utils";
import {
  assignLanes,
  buildTimeWindowsWeekly,
  buildWeekSegments,
  clampWindowInclusive,
} from "./layout";

/* ---------------- progress helper (kept local; PPTX-only heuristic) ---------------- */

function inferProgress(item: any) {
  const p = item?.progress;
  if (typeof p === "number" && Number.isFinite(p)) {
    if (p > 1) return clamp01(p / 100);
    return clamp01(p);
  }

  const s = String(item?.status || "").toLowerCase();
  if (s === "done" || s === "completed" || s === "complete" || s === "approved") return 1;
  if (s === "delayed" || s === "red") return 0.35;
  if (s === "at_risk" || s === "risk" || s === "amber") return 0.55;
  if (s === "on_track" || s === "green") return 0.7;
  return 0.5;
}

/* ---------------- Design System - World Class Executive Style (UNCHANGED) ---------------- */

const colors = {
  // Types
  task: {
    stroke: "2563EB", // blue-600
    fill: "FFFFFF",
    progress: "BFDBFE", // blue-200
    dot: "2563EB",
  },
  deliverable: {
    stroke: "7C3AED", // violet-600
    fill: "FFFFFF",
    progress: "DDD6FE", // violet-200
    dot: "7C3AED",
  },
  milestone: {
    fill: "EA580C", // orange-600
    stroke: "C2410C", // orange-700
  },
  // Status
  status: {
    on_track: "059669", // emerald-600
    at_risk: "D97706", // amber-600
    delayed: "DC2626", // red-600
    done: "2563EB", // blue-600
    default: "94A3B8", // slate-400
  },
  // UI
  background: "FFFFFF",
  surface: "F8FAFC",
  border: "E2E8F0",
  grid: "F1F5F9",
  text: {
    primary: "0F172A", // slate-900
    secondary: "475569", // slate-600
    muted: "94A3B8", // slate-400
    inverse: "FFFFFF",
  },
  today: "059669", // emerald-600
};

export type RenderSchedulePptxArgs = {
  title?: string;
  pmName?: string; // kept for parity (not used in slide design currently)
  contentJson: any;

  // Optional view range (inclusive-ish; matches previous route behavior)
  viewStart?: Date | null;
  viewEnd?: Date | null;

  weeksPerSlide?: number;
};

export async function renderSchedulePptx(args: RenderSchedulePptxArgs): Promise<Buffer> {
  const title = args.title || "Project Roadmap";
  const viewStart = args.viewStart ?? null;
  const viewEnd = args.viewEnd ?? null;
  const weeksPerSlide = Math.max(1, Math.min(12, Number(args.weeksPerSlide ?? 8) || 8));

  const schedule = normalizeSchedule(args.contentJson);
  const phases = schedule.phases;
  const items = schedule.items;

  // Compute date range (Change-strict: shared helper)
  const { minDate, maxDate } = clampWindowInclusive(items);

  // Build windows
  const timeWindows: TimeWindow[] =
    viewStart && viewEnd
      ? (() => {
          const s = startOfWeekUTC(startOfDayUTC(viewStart));
          const eEx = addDaysUTC(startOfWeekUTC(addDaysUTC(startOfDayUTC(viewEnd), 7)), 7);
          const segs = buildWeekSegments(s, eEx);
          return [{ start: s, endExclusive: eEx, weekSegs: segs, label: "" }];
        })()
      : buildTimeWindowsWeekly(minDate, maxDate, weeksPerSlide);

  // PPTX setup
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  pptx.author = "Project Management System";
  pptx.company = "";
  pptx.subject = title;
  pptx.title = title;

  const SLIDE_W = 13.333;
  const SLIDE_H = 7.5;

  // Premium layout constants (UNCHANGED)
  const margin = 0.4;
  const leftPanelW = 2.4;
  const timelineStartX = margin + leftPanelW + 0.2;
  const timelineW = SLIDE_W - timelineStartX - margin;

  const headerTop = 0.35;
  const legendH = 0.35;
  const timelineHeaderH = 0.65;
  const gridStartY = headerTop + legendH + timelineHeaderH + 0.3;
  const gridBottomY = SLIDE_H - margin - 0.2;

  const phaseHeaderH = 0.5;
  const laneH = 0.5;
  const barH = 0.26;
  const milestoneSize = 0.2;
  const phaseGap = 0.04;

  const slides: any[] = [];
  function newSlide() {
    const s = pptx.addSlide();
    s.background = { color: colors.background };
    slides.push(s);
    return s;
  }

  for (let wIdx = 0; wIdx < timeWindows.length; wIdx++) {
    const win = timeWindows[wIdx];
    const rangeStart = win.start;
    const rangeEndExclusive = win.endExclusive;
    const weekSegs = win.weekSegs;

    const totalDays = Math.max(1, daysBetweenUTC(rangeStart, rangeEndExclusive));
    const pxPerDay = timelineW / totalDays;

    function xFromDate(d: Date) {
      return timelineStartX + daysBetweenUTC(rangeStart, d) * pxPerDay;
    }

    function addHeader(slide: any) {
      // Title - left aligned, elegant
      slide.addText(title, {
        x: margin,
        y: headerTop,
        w: SLIDE_W * 0.6,
        h: 0.4,
        fontSize: 22,
        bold: true,
        color: colors.text.primary,
        align: "left",
        valign: "middle",
        fontFace: "Segoe UI",
      });

      // Date range subtitle
      if (win.label) {
        slide.addText(win.label, {
          x: margin,
          y: headerTop + 0.38,
          w: SLIDE_W * 0.4,
          h: 0.25,
          fontSize: 11,
          color: colors.text.secondary,
          align: "left",
          valign: "middle",
          fontFace: "Segoe UI",
        });
      }

      // Legend - top right, polished
      const legendY = headerTop + 0.05;
      const legendItemW = 1.1;
      const legendStartX = SLIDE_W - margin - legendItemW * 3 - 0.2;

      // Milestone
      slide.addShape(pptx.ShapeType.diamond, {
        x: legendStartX,
        y: legendY + 0.06,
        w: 0.12,
        h: 0.12,
        fill: { color: colors.milestone.fill },
        line: { color: colors.milestone.stroke, width: 1 },
      });
      slide.addText("Milestone", {
        x: legendStartX + 0.18,
        y: legendY,
        w: 0.9,
        h: 0.24,
        fontSize: 10,
        color: colors.text.secondary,
        valign: "middle",
        fontFace: "Segoe UI",
      });

      // Task
      slide.addShape(pptx.ShapeType.ellipse, {
        x: legendStartX + legendItemW,
        y: legendY + 0.08,
        w: 0.1,
        h: 0.1,
        fill: { color: colors.task.dot },
      });
      slide.addText("Task", {
        x: legendStartX + legendItemW + 0.16,
        y: legendY,
        w: 0.7,
        h: 0.24,
        fontSize: 10,
        color: colors.text.secondary,
        valign: "middle",
        fontFace: "Segoe UI",
      });

      // Deliverable
      slide.addShape(pptx.ShapeType.ellipse, {
        x: legendStartX + legendItemW * 2,
        y: legendY + 0.08,
        w: 0.1,
        h: 0.1,
        fill: { color: colors.deliverable.dot },
      });
      slide.addText("Deliverable", {
        x: legendStartX + legendItemW * 2 + 0.16,
        y: legendY,
        w: 0.8,
        h: 0.24,
        fontSize: 10,
        color: colors.text.secondary,
        valign: "middle",
        fontFace: "Segoe UI",
      });

      // Subtle divider line
      slide.addShape(pptx.ShapeType.line, {
        x: margin,
        y: headerTop + legendH + 0.05,
        w: SLIDE_W - margin * 2,
        h: 0,
        line: { color: colors.border, width: 1 },
      });

      // Timeline header background
      const headerY = headerTop + legendH + 0.15;
      slide.addShape(pptx.ShapeType.rect, {
        x: timelineStartX,
        y: headerY,
        w: timelineW,
        h: timelineHeaderH,
        fill: { color: colors.surface },
        line: { color: colors.border, width: 0.5 },
      });

      // Week columns
      weekSegs.forEach((seg, idx) => {
        const segX = xFromDate(seg.start);
        const segX2 = xFromDate(seg.endExclusive);
        const segW = Math.max(0.05, segX2 - segX);
        const isEven = idx % 2 === 0;

        // Alternating column backgrounds extending full height
        slide.addShape(pptx.ShapeType.rect, {
          x: segX,
          y: headerY,
          w: segW,
          h: gridBottomY - headerY,
          fill: { color: isEven ? colors.background : "FAFAFA" },
          line: { color: "FFFFFF", width: 0 },
        });

        // Week label
        slide.addText(seg.label, {
          x: segX,
          y: headerY + 0.1,
          w: segW,
          h: 0.22,
          fontSize: 11,
          bold: true,
          color: colors.text.primary,
          align: "center",
          valign: "middle",
          fontFace: "Segoe UI",
        });

        // Date range
        slide.addText(seg.dateRange, {
          x: segX,
          y: headerY + 0.32,
          w: segW,
          h: 0.18,
          fontSize: 8,
          color: colors.text.muted,
          align: "center",
          valign: "middle",
          fontFace: "Segoe UI",
        });

        // Vertical grid line
        slide.addShape(pptx.ShapeType.line, {
          x: segX,
          y: headerY,
          w: 0,
          h: gridBottomY - headerY,
          line: { color: colors.border, width: 0.5 },
        });
      });

      // Final grid line
      const lastX = xFromDate(rangeEndExclusive);
      slide.addShape(pptx.ShapeType.line, {
        x: lastX,
        y: headerY,
        w: 0,
        h: gridBottomY - headerY,
        line: { color: colors.border, width: 0.5 },
      });

      // Today marker - elegant vertical line with label
      const today = startOfDayUTC(new Date());
      if (today >= rangeStart && today < rangeEndExclusive) {
        const x = xFromDate(today);

        // Vertical dashed line
        slide.addShape(pptx.ShapeType.line, {
          x,
          y: headerY,
          w: 0,
          h: gridBottomY - headerY,
          line: { color: colors.today, width: 1.5, dashType: "dash" },
        });

        // Today label at top
        slide.addText("TODAY", {
          x: x - 0.4,
          y: headerY - 0.18,
          w: 0.8,
          h: 0.15,
          fontSize: 8,
          bold: true,
          color: colors.today,
          align: "center",
          valign: "middle",
          fontFace: "Segoe UI",
        });
      }
    }

    let slide = newSlide();
    addHeader(slide);

    let currentY = gridStartY;

    for (let pIdx = 0; pIdx < phases.length; pIdx++) {
      const phase = phases[pIdx];

      const phaseAll = items.filter((i) => i.phaseId === phase.id);
      const phaseVisible = phaseAll.filter((it) => {
        const s = it.start;
        const e = it.end ?? it.start;
        return e >= rangeStart && s < rangeEndExclusive;
      });

      const laneInfo = phaseVisible.length ? assignLanes(phaseVisible) : { laneOf: {}, lanesCount: 1 };
      const lanes = Math.max(1, laneInfo.lanesCount);
      const blockH = phaseHeaderH + lanes * laneH + phaseGap;

      // Page break if needed
      if (currentY + blockH > gridBottomY && currentY > gridStartY + 0.5) {
        slide = newSlide();
        addHeader(slide);
        currentY = gridStartY;
      }

      // Phase row container
      const isEvenPhase = pIdx % 2 === 0;
      const phaseBg = isEvenPhase ? colors.background : colors.surface;

      slide.addShape(pptx.ShapeType.rect, {
        x: margin,
        y: currentY,
        w: SLIDE_W - margin * 2,
        h: phaseHeaderH + lanes * laneH,
        fill: { color: phaseBg },
        line: { color: colors.border, width: 0.5 },
      });

      // Phase sidebar - clean, minimal
      slide.addText(phase.name, {
        x: margin + 0.15,
        y: currentY,
        w: leftPanelW - 0.3,
        h: phaseHeaderH,
        fontSize: 12,
        bold: true,
        color: colors.text.primary,
        valign: "middle",
        fontFace: "Segoe UI",
      });

      // Subtle bottom border for phase
      slide.addShape(pptx.ShapeType.line, {
        x: margin,
        y: currentY + phaseHeaderH + lanes * laneH,
        w: SLIDE_W - margin * 2,
        h: 0,
        line: { color: colors.border, width: 0.5 },
      });

      // Sort items
      const sorted = [...phaseVisible].sort((a, b) => a.start.getTime() - b.start.getTime());

      for (const item of sorted) {
        const s = item.start;
        const e = item.end ?? item.start;

        const clampedStart = s < rangeStart ? rangeStart : s;
        const clampedEndInclusive =
          e >= addDaysUTC(rangeEndExclusive, -1) ? addDaysUTC(rangeEndExclusive, -1) : e;

        const startX = xFromDate(clampedStart);
        const endForWidth = item.type === "milestone" ? clampedStart : addDaysUTC(clampedEndInclusive, 1);
        const endX = xFromDate(endForWidth);

        const laneIdx = (laneInfo as any).laneOf?.[item.id] ?? 0;
        const itemY = currentY + phaseHeaderH + laneIdx * laneH;
        const centerY = itemY + laneH / 2;

        // Status color
        const status = String(item.status || "").toLowerCase();
        let statusColor = colors.status.default;
        if (status === "done" || status === "completed") statusColor = colors.status.done;
        else if (status === "delayed") statusColor = colors.status.delayed;
        else if (status === "at_risk") statusColor = colors.status.at_risk;
        else if (status === "on_track") statusColor = colors.status.on_track;

        if (item.type === "milestone") {
          // Diamond marker
          const mx = startX - milestoneSize / 2;
          const my = centerY - milestoneSize / 2;

          slide.addShape(pptx.ShapeType.diamond, {
            x: mx,
            y: my,
            w: milestoneSize,
            h: milestoneSize,
            fill: { color: colors.milestone.fill },
            line: { color: colors.milestone.stroke, width: 1.5 },
          });

          // Label to right with breathing room
          slide.addText(item.name, {
            x: mx + milestoneSize + 0.12,
            y: my - 0.02,
            w: 2.8,
            h: milestoneSize + 0.04,
            fontSize: 10,
            color: colors.text.primary,
            valign: "middle",
            fontFace: "Segoe UI",
          });
        } else {
          // Task or Deliverable
          const isDeliverable = item.type === "deliverable";
          const colorSet = isDeliverable ? colors.deliverable : colors.task;
          const strokeColor = status ? statusColor : colorSet.stroke;

          const barW = Math.max(0.5, endX - startX);
          const by = centerY - barH / 2;

          // Type indicator dot (left of bar)
          slide.addShape(pptx.ShapeType.ellipse, {
            x: startX - 0.18,
            y: centerY - 0.06,
            w: 0.12,
            h: 0.12,
            fill: { color: colorSet.dot },
          });

          // Main bar
          slide.addShape(pptx.ShapeType.roundRect, {
            x: startX,
            y: by,
            w: barW,
            h: barH,
            fill: { color: colorSet.fill },
            line: { color: strokeColor, width: 1.5 },
            radius: 0.1,
          });

          // Progress fill
          const prog = typeof item.progress === "number" ? item.progress : inferProgress(item);
          if (prog > 0) {
            const fillW = Math.max(0.04, barW * clamp01(prog));
            slide.addShape(pptx.ShapeType.roundRect, {
              x: startX,
              y: by,
              w: fillW,
              h: barH,
              fill: { color: colorSet.progress },
              line: { color: "FFFFFF", width: 0 },
              radius: 0.1,
            });
          }

          // Label
          const minTextW = 0.8;
          if (barW >= minTextW) {
            slide.addText(item.name, {
              x: startX + 0.08,
              y: by,
              w: barW - 0.16,
              h: barH,
              fontSize: 9,
              color: colors.text.primary,
              align: "left",
              valign: "middle",
              fontFace: "Segoe UI",
            });
          } else {
            slide.addText(item.name, {
              x: startX + barW + 0.1,
              y: by - 0.01,
              w: Math.max(2.0, timelineStartX + timelineW - startX - barW - 0.2),
              h: barH + 0.02,
              fontSize: 9,
              color: colors.text.primary,
              align: "left",
              valign: "middle",
              fontFace: "Segoe UI",
            });
          }
        }
      }

      currentY += blockH;
    }
  }

  // Footer with slide numbers
  slides.forEach((s, idx) => {
    s.addText(`${idx + 1} / ${slides.length}`, {
      x: SLIDE_W - margin - 0.8,
      y: SLIDE_H - margin - 0.1,
      w: 0.6,
      h: 0.15,
      fontSize: 8,
      color: colors.text.muted,
      align: "right",
      fontFace: "Segoe UI",
    });
  });

  const buffer = await pptx.write({ outputType: "nodebuffer" });
  return Buffer.from(buffer);
}
